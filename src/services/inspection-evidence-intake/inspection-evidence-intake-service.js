import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

import { validateInspectionEvidence } from '../../../lib/inspection-evidence.js';
import { CANONICAL_PACKAGE_SLUGS } from '../../server/canonical-package-discovery.js';

const execFile = promisify(execFileCallback);

const REPORT_SCHEMA_VERSION = '1.0';

const GENERATED_PATH_PATTERNS = Object.freeze([
  /(^|\/)[^/]*_create_quality\.json$/i,
  /(^|\/)[^/]*_drawing_quality\.json$/i,
  /(^|\/)[^/]*_drawing_qa\.json$/i,
  /(^|\/)[^/]*_drawing_intent\.json$/i,
  /(^|\/)[^/]*_feature_catalog\.json$/i,
  /(^|\/)(?:review_pack|review-pack)\.(?:json|md|pdf)$/i,
  /(^|\/)(?:readiness_report|readiness-report)\.(?:json|md|pdf)$/i,
  /(^|\/)standard_docs_manifest\.json$/i,
  /(^|\/)release_bundle(?:\.zip|_manifest\.json|_log\.json|_checksums\.sha256)$/i,
  /(^|\/)release-bundle(?:\.zip|-manifest\.json|-log\.json|-checksums\.sha256)$/i,
  /(^|\/)(?:artifact-manifest|output-manifest)\.json$/i,
]);

const EVIDENCE_PATH_PATTERNS = Object.freeze([
  /inspection[-_]?evidence/i,
  /(^|\/)inspection\//i,
  /cmm/i,
  /caliper/i,
  /(^|[-_/])gauge([-_/]|$)/i,
  /first[-_ ]?article/i,
  /supplier[-_ ]?inspection/i,
]);

const NON_GENUINE_TEXT_PATTERN = /synthetic|fixture|template|collection guide|generated|not readiness evidence|not package readiness evidence/i;

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function normalizeRepoPath(pathValue) {
  return String(pathValue || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function nowIso(explicitValue = null) {
  return explicitValue || new Date().toISOString();
}

function isGeneratedArtifactPath(relativePath) {
  const normalized = normalizeRepoPath(relativePath);
  return GENERATED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isEvidencePathCandidate(relativePath) {
  const normalized = normalizeRepoPath(relativePath);
  if (!normalized || normalized.startsWith('.git/') || normalized.includes('/node_modules/')) return false;
  if (isGeneratedArtifactPath(normalized)) return true;
  return EVIDENCE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function packageSlugFromPath(relativePath, packageSlugs = []) {
  const normalized = normalizeRepoPath(relativePath);
  const match = normalized.match(/^docs\/examples\/([^/]+)\//);
  if (match && packageSlugs.includes(match[1])) return match[1];
  const guideMatch = normalized.match(/^docs\/inspection-evidence-collection\/([^/.]+)\.md$/);
  if (guideMatch && packageSlugs.includes(guideMatch[1])) return guideMatch[1];
  return null;
}

function isPackageInspectionPath(relativePath, slug) {
  return normalizeRepoPath(relativePath).startsWith(`docs/examples/${slug}/inspection/`);
}

async function pathExists(projectRoot, relativePath) {
  try {
    await stat(resolve(projectRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfPossible(projectRoot, relativePath) {
  try {
    const raw = await readFile(resolve(projectRoot, relativePath), 'utf8');
    return {
      ok: true,
      raw,
      document: JSON.parse(raw),
    };
  } catch (error) {
    return {
      ok: false,
      raw: null,
      document: null,
      error,
    };
  }
}

async function listTrackedPaths(projectRoot, explicitTrackedPaths = null) {
  if (Array.isArray(explicitTrackedPaths)) {
    return explicitTrackedPaths.map(normalizeRepoPath).filter(Boolean).sort();
  }
  try {
    const { stdout } = await execFile('git', ['ls-files'], {
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.split(/\r?\n/).map(normalizeRepoPath).filter(Boolean).sort();
  } catch {
    return [];
  }
}

function classifyNonJsonPath(relativePath) {
  const normalized = normalizeRepoPath(relativePath);
  if (normalized.startsWith('docs/inspection-evidence-collection/')) {
    return {
      classification: 'invalid_provenance',
      reasons: ['inspection collection guides are templates/instructions, not completed inspection records'],
      validation_errors: [],
    };
  }
  return {
    classification: 'invalid_schema',
    reasons: ['candidate is not a JSON inspection evidence record'],
    validation_errors: ['inspection evidence intake currently accepts JSON records only'],
  };
}

function sourcePathFromDocument(document = {}) {
  return normalizeRepoPath(document.source_ref || document.source_file || '');
}

function documentText(document = {}) {
  return [
    document.notes,
    document.inspected_part,
    document.package_id,
    document.inspector,
    document.inspection_author,
    document.source_ref,
    document.source_file,
  ].filter((value) => typeof value === 'string').join('\n');
}

async function hasGenuineLocalProvenance({
  projectRoot,
  relativePath,
  document,
  packageSlugs,
}) {
  const reasons = [];
  const slug = packageSlugFromPath(relativePath, packageSlugs);
  if (!slug || !isPackageInspectionPath(relativePath, slug)) {
    reasons.push('valid inspection-shaped JSON is not located under a canonical package inspection directory');
  }

  if (/^tests\/fixtures\//.test(relativePath) || /^schemas\//.test(relativePath)) {
    reasons.push('fixtures and schemas are contract references, not genuine completed inspection evidence');
  }

  if (NON_GENUINE_TEXT_PATTERN.test(documentText(document))) {
    reasons.push('document provenance text marks it as synthetic, generated, fixture, template, or guide material');
  }

  const sourcePath = sourcePathFromDocument(document);
  if (!sourcePath) {
    reasons.push('document does not provide a source_ref/source_file provenance path');
  } else if (isGeneratedArtifactPath(sourcePath)) {
    reasons.push('source_ref/source_file points at generated non-inspection output');
  } else if (/^tests\/fixtures\//.test(sourcePath) || /^schemas\//.test(sourcePath)) {
    reasons.push('source_ref/source_file points at fixture or schema material');
  } else if (slug && !isPackageInspectionPath(sourcePath, slug)) {
    reasons.push('source_ref/source_file is not under the same canonical package inspection directory');
  } else if (!(await pathExists(projectRoot, sourcePath)) && sourcePath !== relativePath) {
    reasons.push('source_ref/source_file provenance path was not found in the checkout');
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

async function classifyCandidate({
  projectRoot,
  relativePath,
  packageSlugs,
  sourceKind = 'tracked_repo_file',
}) {
  const normalized = normalizeRepoPath(relativePath);
  const slug = packageSlugFromPath(normalized, packageSlugs);
  const baseCandidate = {
    path: normalized,
    source_kind: sourceKind,
    package_slug: slug,
    classification: null,
    reasons: [],
    validation_errors: [],
    contract_ok: false,
    evidence_type: null,
    source_type: null,
    measured_feature_count: null,
  };

  if (isGeneratedArtifactPath(normalized)) {
    return {
      ...baseCandidate,
      classification: 'invalid_generated',
      reasons: ['generated CAD, drawing, readiness, review, docs, release, or manifest artifacts are not inspection evidence'],
    };
  }

  if (!normalized.toLowerCase().endsWith('.json')) {
    return {
      ...baseCandidate,
      ...classifyNonJsonPath(normalized),
    };
  }

  const parsed = await readJsonIfPossible(projectRoot, normalized);
  if (!parsed.ok) {
    return {
      ...baseCandidate,
      classification: 'invalid_schema',
      reasons: ['candidate could not be parsed as JSON inspection evidence'],
      validation_errors: [parsed.error?.message || 'invalid JSON'],
    };
  }

  const document = safeObject(parsed.document);
  const validation = validateInspectionEvidence(document);
  const enriched = {
    ...baseCandidate,
    contract_ok: validation.ok,
    evidence_type: document.evidence_type || document.artifact_type || document.type || null,
    source_type: document.source_type || null,
    measured_feature_count: Array.isArray(document.measured_features) ? document.measured_features.length : null,
    validation_errors: validation.errors,
  };

  if (!validation.ok) {
    const generatedError = validation.errors.some((error) => /generated .*artifacts are not inspection evidence|generated artifact path/i.test(error));
    return {
      ...enriched,
      classification: generatedError ? 'invalid_generated' : 'invalid_schema',
      reasons: generatedError
        ? ['candidate is generated/non-inspection output even though it is inspection-shaped']
        : ['candidate does not satisfy the inspection evidence schema/contract'],
    };
  }

  const provenance = await hasGenuineLocalProvenance({
    projectRoot,
    relativePath: normalized,
    document,
    packageSlugs,
  });
  if (!provenance.ok) {
    return {
      ...enriched,
      classification: 'invalid_provenance',
      reasons: provenance.reasons,
    };
  }

  return {
    ...enriched,
    classification: 'genuine_valid',
    reasons: ['contract-valid completed inspection record with local canonical package provenance'],
  };
}

async function readReadinessState(projectRoot, slug) {
  const readinessPath = `docs/examples/${slug}/readiness/readiness_report.json`;
  const parsed = await readJsonIfPossible(projectRoot, readinessPath);
  const summary = safeObject(parsed.document?.readiness_summary);
  const missingInputs = Array.isArray(summary.missing_inputs)
    ? summary.missing_inputs
    : uniqueStrings([
      ...safeList(parsed.document?.review_pack?.uncertainty_coverage_report?.missing_inputs),
      ...safeList(parsed.document?.process_plan?.summary?.missing_inputs),
      ...safeList(parsed.document?.quality_risk?.summary?.missing_inputs),
    ]);
  return {
    status: summary.status || null,
    score: summary.score ?? null,
    gate_decision: summary.gate_decision || null,
    missing_inputs: missingInputs,
    inspection_evidence_missing: missingInputs.includes('inspection_evidence'),
    source_of_truth_path: readinessPath,
  };
}

function canonicalCommandPlan(slug, acceptedCandidate) {
  const packageRoot = `docs/examples/${slug}`;
  const candidatePath = acceptedCandidate.path;
  return {
    review_context: [
      'fcad',
      'review-context',
      '--model',
      `${packageRoot}/cad/<canonical-model-file>`,
      '--inspection-evidence',
      candidatePath,
      '--out',
      `${packageRoot}/review/review_pack.json`,
    ],
    readiness_pack: [
      'fcad',
      'readiness-pack',
      '--review-pack',
      `${packageRoot}/review/review_pack.json`,
      '--out',
      `${packageRoot}/readiness/readiness_report.json`,
    ],
    generate_standard_docs: [
      'fcad',
      'generate-standard-docs',
      `${packageRoot}/config.toml`,
      '--readiness-report',
      `${packageRoot}/readiness/readiness_report.json`,
      '--out-dir',
      `${packageRoot}/standard-docs`,
    ],
    pack: [
      'fcad',
      'pack',
      '--readiness',
      `${packageRoot}/readiness/readiness_report.json`,
      '--out',
      `${packageRoot}/release/release_bundle.zip`,
    ],
  };
}

function packageClassification({ acceptedCandidates, packageRejectedCandidates }) {
  if (acceptedCandidates.length > 0) return 'genuine_valid';
  const inspectionRecordRejects = packageRejectedCandidates.filter((candidate) => (
    candidate.package_candidate === true
  ));
  if (inspectionRecordRejects.length === 0) return 'no_candidate';
  if (inspectionRecordRejects.some((candidate) => candidate.classification === 'invalid_generated')) return 'invalid_generated';
  if (inspectionRecordRejects.some((candidate) => candidate.classification === 'invalid_provenance')) return 'invalid_provenance';
  return 'invalid_schema';
}

function isPackageCandidate(candidate, slug) {
  return candidate.package_slug === slug && isPackageInspectionPath(candidate.path, slug);
}

function normalizeGithubEntries(kind, parsed) {
  if (kind === 'github_actions_artifacts') {
    const pages = Array.isArray(parsed) ? parsed : [parsed];
    return pages
      .flatMap((page) => safeList(page?.artifacts))
      .map((artifact) => ({
        name: artifact.name || null,
        expired: artifact.expired ?? null,
        createdAt: artifact.created_at || null,
        url: artifact.archive_download_url || null,
        workflowRun: artifact.workflow_run?.html_url || null,
      }));
  }

  if (kind === 'github_issue_comments' || kind === 'github_pull_review_comments') {
    const pages = Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed : [parsed];
    return pages
      .flatMap((page) => safeList(page))
      .map((comment) => ({
        url: comment.html_url || null,
        body: comment.body || null,
        updatedAt: comment.updated_at || null,
      }));
  }

  return Array.isArray(parsed) ? parsed : [];
}

async function githubSearchResults({ githubRepo, githubRunner = execFile }) {
  const sources = [];
  const rejected = [];
  const repoApiPath = `repos/${githubRepo}`;
  const commands = [
    {
      kind: 'github_issues_open',
      args: ['search', 'issues', 'inspection evidence', '--repo', githubRepo, '--state', 'open', '--include-prs', '--json', 'number,title,state,url,isPullRequest,body,updatedAt', '--limit', '100'],
    },
    {
      kind: 'github_issues_closed',
      args: ['search', 'issues', 'inspection evidence', '--repo', githubRepo, '--state', 'closed', '--include-prs', '--json', 'number,title,state,url,isPullRequest,body,updatedAt', '--limit', '100'],
    },
    {
      kind: 'github_physical_inspection_terms_open',
      args: ['search', 'issues', 'CMM OR caliper OR gauge OR first article OR supplier inspection', '--repo', githubRepo, '--state', 'open', '--include-prs', '--json', 'number,title,state,url,isPullRequest,body,updatedAt', '--limit', '100'],
    },
    {
      kind: 'github_physical_inspection_terms_closed',
      args: ['search', 'issues', 'CMM OR caliper OR gauge OR first article OR supplier inspection', '--repo', githubRepo, '--state', 'closed', '--include-prs', '--json', 'number,title,state,url,isPullRequest,body,updatedAt', '--limit', '100'],
    },
    {
      kind: 'github_issue_comments',
      args: ['api', `${repoApiPath}/issues/comments`, '--paginate', '--slurp'],
    },
    {
      kind: 'github_pull_review_comments',
      args: ['api', `${repoApiPath}/pulls/comments`, '--paginate', '--slurp'],
    },
    {
      kind: 'github_actions_artifacts',
      args: ['api', `${repoApiPath}/actions/artifacts`, '--paginate', '--slurp'],
    },
    {
      kind: 'github_release_records',
      args: ['release', 'list', '--repo', githubRepo, '--limit', '100', '--json', 'tagName,name,isDraft,isPrerelease,publishedAt'],
    },
  ];

  for (const command of commands) {
    try {
      const { stdout } = await githubRunner('gh', command.args, {
        maxBuffer: 10 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout || '[]');
      const entries = normalizeGithubEntries(command.kind, parsed);
      const matchingEntries = entries.filter((entry) => (
        /inspection|cmm|caliper|gauge|first.article|supplier/i.test(JSON.stringify(entry))
      ));
      sources.push({
        kind: command.kind,
        status: 'searched',
        entry_count: entries.length,
        candidate_count: matchingEntries.length,
      });
      matchingEntries.forEach((entry) => {
        rejected.push({
          path: entry.url || entry.tagName || entry.name || command.kind,
          source_kind: command.kind,
          package_slug: null,
          classification: 'invalid_provenance',
          reasons: ['GitHub metadata mention is not an attached machine-readable completed inspection record'],
          validation_errors: [],
          contract_ok: false,
          evidence_type: null,
          source_type: null,
          measured_feature_count: null,
        });
      });
    } catch (error) {
      sources.push({
        kind: command.kind,
        status: 'failed',
        error: error.message,
      });
    }
  }

  return { sources, rejected };
}

export async function discoverInspectionEvidenceIntake({
  projectRoot,
  packageSlugs = CANONICAL_PACKAGE_SLUGS,
  trackedPaths = null,
  includeGitHub = false,
  githubRepo = 'dooosp/freecad-automation',
  githubRunner = execFile,
  generatedAt = null,
} = {}) {
  const resolvedRoot = resolve(projectRoot || process.cwd());
  const slugs = safeList(packageSlugs).length > 0 ? packageSlugs : CANONICAL_PACKAGE_SLUGS;
  const normalizedSlugs = slugs.map(String);
  const tracked = await listTrackedPaths(resolvedRoot, trackedPaths);
  const candidatePaths = uniqueStrings([
    ...tracked.filter(isEvidencePathCandidate),
    ...normalizedSlugs.map((slug) => `docs/examples/${slug}/inspection/inspection_evidence.json`),
  ]).filter((candidatePath) => tracked.includes(candidatePath) || isEvidencePathCandidate(candidatePath));

  const localCandidates = [];
  for (const candidatePath of candidatePaths) {
    if (!(tracked.includes(candidatePath) || await pathExists(resolvedRoot, candidatePath))) continue;
    localCandidates.push(await classifyCandidate({
      projectRoot: resolvedRoot,
      relativePath: candidatePath,
      packageSlugs: normalizedSlugs,
    }));
  }

  const github = includeGitHub
    ? await githubSearchResults({ githubRepo, githubRunner })
    : {
        sources: [{
          kind: 'github_public_metadata',
          status: 'not_requested',
          reason: 'Use --include-github in connected environments; hosted tests keep network disabled.',
        }],
        rejected: [],
      };

  const allCandidates = [...localCandidates, ...github.rejected];
  const acceptedCandidates = allCandidates.filter((candidate) => candidate.classification === 'genuine_valid');
  const rejectedCandidates = allCandidates
    .filter((candidate) => candidate.classification !== 'genuine_valid')
    .map((candidate) => ({
      ...candidate,
      package_candidate: candidate.package_slug
        ? isPackageCandidate(candidate, candidate.package_slug)
        : false,
    }));

  const packages = [];
  for (const slug of normalizedSlugs) {
    const packageAccepted = acceptedCandidates.filter((candidate) => candidate.package_slug === slug);
    const packageRejected = rejectedCandidates.filter((candidate) => candidate.package_slug === slug);
    const readiness = await readReadinessState(resolvedRoot, slug);
    const classification = packageClassification({
      acceptedCandidates: packageAccepted,
      packageRejectedCandidates: packageRejected,
    });
    packages.push({
      slug,
      classification,
      readiness_before: readiness,
      readiness_after: packageAccepted.length > 0
        ? {
            ...readiness,
            status: readiness.status || 'pending_regeneration',
            gate_decision: readiness.gate_decision || 'pending_canonical_regeneration',
          }
        : readiness,
      searched_sources: [
        {
          kind: 'canonical_package_expected_path',
          status: await pathExists(resolvedRoot, `docs/examples/${slug}/inspection/inspection_evidence.json`)
            ? 'found'
            : 'missing',
          path: `docs/examples/${slug}/inspection/inspection_evidence.json`,
        },
        {
          kind: 'tracked_repo_files',
          status: 'searched',
          candidate_path_count: candidatePaths.length,
        },
        ...github.sources,
      ],
      accepted_candidates: packageAccepted,
      rejected_candidates: packageRejected,
      intake_action: packageAccepted.length > 0
        ? {
            status: 'ready_for_canonical_attachment',
            mode: 'canonical_review_context_chain_required',
            candidate_path: packageAccepted[0].path,
            canonical_commands: canonicalCommandPlan(slug, packageAccepted[0]),
            note: 'Attach only through review-context, then regenerate readiness, standard-doc, and release artifacts.',
          }
        : {
            status: 'hold_for_evidence_completion',
            mode: 'no_human_measurement_entry_requested',
            note: 'No genuine completed inspection evidence was found; readiness must remain held.',
          },
    });
  }

  return {
    artifact_type: 'inspection_evidence_intake_report',
    schema_version: REPORT_SCHEMA_VERSION,
    generated_at: nowIso(generatedAt),
    source_boundary: {
      allowed_sources: [
        'tracked repo files',
        'docs/examples/tests/fixtures inside the checkout',
        'existing non-secret local files in the checkout',
        'public GitHub metadata when --include-github is used',
      ],
      hard_evidence_rule: 'Only real completed physical/supplier/lab/QA inspection records with measured feature records, result semantics, and provenance can be accepted.',
      rejected_as_final_evidence: [
        'generated CAD/drawing/quality/readiness/review/standard-doc/release artifacts',
        'fixtures',
        'templates',
        'collection guides',
        'CI summaries',
        'release bundles',
      ],
    },
    searched_sources: [
      {
        kind: 'tracked_repo_files',
        status: 'searched',
        path_count: tracked.length,
        candidate_path_count: candidatePaths.length,
      },
      ...github.sources,
    ],
    packages,
    accepted_candidates: acceptedCandidates,
    rejected_candidates: rejectedCandidates,
    summary: {
      package_count: packages.length,
      candidate_count: allCandidates.length,
      accepted_candidate_count: acceptedCandidates.length,
      rejected_candidate_count: rejectedCandidates.length,
      genuine_inspection_evidence_found: acceptedCandidates.length > 0,
      packages_with_genuine_evidence: packages
        .filter((pkg) => pkg.classification === 'genuine_valid')
        .map((pkg) => pkg.slug),
      packages_without_genuine_evidence: packages
        .filter((pkg) => pkg.classification !== 'genuine_valid')
        .map((pkg) => pkg.slug),
      requires_human_measurement_entry: false,
      readiness_truth: acceptedCandidates.length > 0
        ? 'valid candidates require canonical review-context attachment/regeneration before readiness may change'
        : 'readiness remains needs_more_evidence / hold_for_evidence_completion',
    },
  };
}
