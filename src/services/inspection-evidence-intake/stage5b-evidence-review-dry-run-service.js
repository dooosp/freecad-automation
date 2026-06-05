import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  evaluateStage5bCandidateEvidence,
  writeStage5bCandidateEvidenceGateReport,
} from '../../../lib/stage5b-candidate-evidence-gate.js';
import { CANONICAL_PACKAGE_SLUGS } from '../../server/canonical-package-discovery.js';
import {
  loadStage5bEvidenceSourceDocument,
  preflightStage5bEvidenceSource,
} from './stage5b-evidence-source-kit-service.js';
import { writeStage5bEvidenceAuditBundle } from './stage5b-evidence-audit-service.js';
import { assertValidStage5bEvidenceReviewDryRunManifest } from './stage5b-runtime-validation.js';

const execFile = promisify(execFileCallback);

export const STAGE5B_EVIDENCE_REVIEW_DRY_RUN_ARTIFACT_TYPE = 'stage5b_evidence_review_dry_run_manifest';
export const STAGE5B_EVIDENCE_REVIEW_DRY_RUN_SCHEMA_VERSION = '1.0';

const MANIFEST_FILE_NAME = 'stage5b_evidence_review_dry_run_manifest.json';
const PREFLIGHT_FILE_NAME = 'source_preflight_report.json';
const CANDIDATE_FILE_NAME = 'stage5b_review_candidate.redacted.json';
const GATE_FILE_NAME = 'candidate_gate_report.json';
const AUDIT_DIR_NAME = 'audit';
const HARD_EVIDENCE_RULE = 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.';

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nowIso(value = null) {
  return value || new Date().toISOString();
}

function normalizeRepoPath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
}

function assertCanonicalPackageSlug(slug) {
  const normalized = normalizeRepoPath(slug).toLowerCase();
  if (!CANONICAL_PACKAGE_SLUGS.includes(normalized)) {
    throw new Error(`Stage 5B review dry-run package must be a canonical package slug: ${slug}`);
  }
  return normalized;
}

function repoRelativePath(projectRoot, pathValue) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) return pathValue;
  const root = resolve(projectRoot);
  const absolute = isAbsolute(pathValue) || isWindowsAbsolutePath(pathValue)
    ? resolve(pathValue)
    : resolve(root, pathValue);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : pathValue;
}

async function runGit(projectRoot, args = []) {
  try {
    const { stdout } = await execFile('git', args, {
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, status: 0, stdout: stdout || '' };
  } catch (error) {
    return {
      ok: false,
      status: typeof error?.code === 'number' ? error.code : 1,
      stdout: error?.stdout || '',
      stderr: error?.stderr || error?.message || '',
    };
  }
}

async function isGitIgnored(projectRoot, relativePath) {
  const result = await runGit(projectRoot, ['check-ignore', '-q', '--', relativePath]);
  if (result.ok) return true;
  if (result.status === 1) return false;
  return null;
}

function assertPathInsideProject(projectRoot, pathValue, label) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    throw new Error(`${label} is required`);
  }
  if (pathValue.includes('\0') || pathValue.includes('\\') || pathValue.startsWith('~') || isWindowsAbsolutePath(pathValue)) {
    throw new Error(`${label} failed repository path safety checks`);
  }
  const root = resolve(projectRoot);
  const absolute = isAbsolute(pathValue) ? resolve(pathValue) : resolve(root, pathValue);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${label} must stay inside the repository root`);
  }
  if (rel.split('/').includes('..')) {
    throw new Error(`${label} failed repository path safety checks`);
  }
  return { absolute, relative: rel };
}

async function assertIgnoredOutputDir(projectRoot, outDir) {
  const outputDir = assertPathInsideProject(projectRoot, outDir, 'stage5b review dry-run out-dir');
  const ignored = await isGitIgnored(projectRoot, outputDir.relative);
  if (ignored !== true) {
    throw new Error('stage5b review dry-run out-dir must be ignored by git so review/control material cannot become tracked output');
  }
  await mkdir(outputDir.absolute, { recursive: true });
  return outputDir;
}

async function writeJsonFile(pathValue, data) {
  await mkdir(dirname(pathValue), { recursive: true });
  await writeFile(pathValue, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return pathValue;
}

async function sha256IfReadable(pathValue) {
  try {
    return createHash('sha256').update(await readFile(pathValue)).digest('hex');
  } catch {
    return null;
  }
}

function outputRef(projectRoot, pathValue, artifactType, sha256 = null) {
  return {
    path: repoRelativePath(projectRoot, pathValue),
    artifact_type: artifactType,
    sha256,
  };
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function firstString(document = {}, fields = []) {
  const doc = safeObject(document);
  for (const field of fields) {
    const value = doc[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function measuredFeatures(document = {}) {
  return safeList(safeObject(document).measured_features).filter((feature) => feature && typeof feature === 'object' && !Array.isArray(feature));
}

function buildFixtureSource(slug, generatedAt) {
  return {
    package_id: slug,
    inspected_part: slug,
    part_revision: 'A',
    inspection_date: String(generatedAt).slice(0, 10),
    source_type: 'supplier_inspection_report',
    inspection_status: 'completed',
    inspector: 'Stage5B Fixture Inspector',
    reviewed_by: 'Stage5B Fixture Reviewer',
    units: 'mm',
    overall_result: 'pass',
    measured_features: [
      {
        feature_id: 'hole_left_diameter',
        measured_value: 8.01,
        tolerance_upper: 0.05,
        tolerance_lower: -0.05,
        units: 'mm',
        result: 'pass',
        measurement_method: 'supplier_cmm',
      },
    ],
  };
}

async function ensureFixtureSource({ projectRoot, sourcePath, slug, generatedAt }) {
  const source = assertPathInsideProject(projectRoot, sourcePath, 'stage5b review dry-run fixture source');
  const expectedPrefix = `local/stage5b-candidate-evidence-inbox/${slug}/`;
  if (!source.relative.startsWith(expectedPrefix)) {
    throw new Error(`--fixture source must stay under ${expectedPrefix}`);
  }
  await writeJsonFile(source.absolute, buildFixtureSource(slug, generatedAt));
  return source.relative;
}

function sourceIsIgnoredOrFixtureSafe(preflight, { fixtureMode = false } = {}) {
  const source = safeObject(preflight.source);
  const sourcePath = normalizeRepoPath(source.path);
  const ignoredAndUntracked = source.ignored_by_git === true && source.tracked_by_git !== true;
  return {
    ok: source.exists !== true || ignoredAndUntracked,
    ignored_and_untracked: ignoredAndUntracked,
    fixture_safe: fixtureMode === true
      && ignoredAndUntracked
      && sourcePath.startsWith(`local/stage5b-candidate-evidence-inbox/${preflight.package_slug}/`),
    source_path: source.path || null,
    rule: 'Raw sources must be ignored and untracked, except --fixture may create a synthetic ignored local-inbox source for orchestration tests.',
  };
}

function sanitizeFeature(feature = {}) {
  const allowed = {};
  for (const key of [
    'feature_id',
    'drawing_ref',
    'requirement_ref',
    'nominal_value',
    'measured_value',
    'tolerance_upper',
    'tolerance_lower',
    'units',
    'result',
    'measurement_method',
  ]) {
    if (feature[key] !== undefined) allowed[key] = feature[key];
  }
  return allowed;
}

function buildReviewCandidate({ slug, document, candidateSourceRef }) {
  const candidate = {
    artifact_type: 'stage5b_evidence_review_dry_run_candidate',
    schema_version: '1.0',
    evidence_type: 'inspection_evidence',
    source_type: document.source_type || 'other_inspection_source',
    package_id: firstString(document, ['package_id', 'package', 'package_slug']) || slug,
    inspected_part: firstString(document, ['inspected_part', 'part', 'part_id']) || slug,
    part_revision: firstString(document, ['part_revision', 'revision', 'drawing_revision', 'package_revision', 'inspected_revision']) || 'unknown',
    inspection_date: firstString(document, ['inspection_date', 'inspected_at', 'date', 'completed_at']) || new Date().toISOString().slice(0, 10),
    inspection_status: firstString(document, ['inspection_status', 'status', 'completion_status', 'record_status']) || 'completed',
    inspector: firstString(document, ['inspector', 'inspection_author']) || 'redacted inspection trace',
    reviewed_by: firstString(document, ['reviewed_by', 'approved_by', 'qa_reviewer', 'reviewer', 'quality_reviewer']) || 'redacted reviewer trace',
    measurement_system: document.measurement_system || 'metric',
    units: document.units || measuredFeatures(document)[0]?.units || 'mm',
    source_ref: candidateSourceRef,
    overall_result: document.overall_result || 'partial',
    measured_features: measuredFeatures(document).map(sanitizeFeature),
    traceability_refs: uniqueStrings(safeList(document.traceability_refs)),
    review_scope: {
      dry_run: true,
      review_scoped_only: true,
      raw_source_copied: false,
      canonical_evidence_eligible: false,
    },
    notes: 'Stage 5B review dry-run derivative. This is non-evidence control material and must not be attached or promoted.',
  };
  return candidate;
}

function provenanceFieldsFromPreflight(preflight = {}, candidate = null) {
  const summary = safeObject(preflight.parsed_source_summary);
  return {
    source_type: summary.source_type || candidate?.source_type || null,
    inspection_status: summary.inspection_status || candidate?.inspection_status || null,
    inspection_date: summary.inspection_date || candidate?.inspection_date || null,
    revision: summary.revision || candidate?.part_revision || null,
    overall_result: summary.overall_result || candidate?.overall_result || null,
    measured_feature_count: summary.measured_feature_count || measuredFeatures(candidate).length || 0,
    measured_feature_ids: safeList(summary.measured_feature_ids).length > 0
      ? summary.measured_feature_ids
      : uniqueStrings(measuredFeatures(candidate).map((feature) => feature.feature_id)),
    reviewer_traceability_present: preflight.required_field_checks?.some((check) => (
      check.id === 'reviewer_approver_traceability' && check.status === 'pass'
    )) || Boolean(candidate?.reviewed_by),
    source_ref: candidate?.source_ref || null,
  };
}

function packageMappingFromPreflight(preflight = {}, slug) {
  const summary = safeObject(preflight.parsed_source_summary);
  return {
    requested_package: slug,
    source_package_id: summary.package_id || null,
    source_inspected_part: summary.inspected_part || null,
    source_revision: summary.revision || null,
    review_package_slug: slug,
    explicit_package_match: summary.package_id === slug || summary.inspected_part === slug,
  };
}

function redactionFindings(preflight = {}) {
  const sourceFindings = safeList(preflight.source_findings);
  const safetyFindings = safeList(preflight.safety_findings);
  return {
    source_findings: sourceFindings,
    safety_findings: safetyFindings,
    source_finding_codes: uniqueStrings(sourceFindings.map((finding) => finding.code)),
    safety_finding_codes: uniqueStrings(safetyFindings.map((finding) => finding.code)),
    redacted_or_omitted_fields: [
      'raw_source_text',
      'absolute_path',
      'private_urls',
      'tokens_or_credentials',
      'unnecessary_pii',
      'unrecognized_source_fields',
    ],
    raw_source_copied: false,
    note: 'Review dry-run outputs copy only whitelisted inspection-shape fields into an ignored review-scoped derivative.',
  };
}

function heldTruth() {
  return {
    readiness_remains_held: true,
    canonical_readiness_regenerated: false,
    canonical_artifacts_mutated: false,
    packages_marked_ready: false,
    statement: 'Canonical package readiness remains needs_more_evidence / hold_for_evidence_completion until a later explicitly authorized attachment task validates, reviews, attaches genuine evidence, and regenerates canonical package artifacts.',
  };
}

function nextAuthorizationStep(preflightReady) {
  if (!preflightReady) {
    return {
      required: true,
      action: 'Provide, repair, or redact a genuine completed source until source preflight returns ready_for_stage5b_review.',
      canonical_attachment_command_allowed_now: false,
      later_required_flow: [
        'source_preflight_ready',
        'candidate_gate_acceptance_review',
        'intake_dry_run_audit_review',
        'stage5b_attachment_authorization_record',
        'separate_explicit_attachment_task',
      ],
    };
  }
  return {
    required: true,
    action: 'Complete Stage 5B attachment authorization with human approval and a separate later task before any review-context --inspection-evidence command may run.',
    canonical_attachment_command_allowed_now: false,
    later_required_flow: [
      'review accepted candidate gate and redaction findings',
      'review intake, promotion dry-run, and audit outputs',
      'complete Stage 5B attachment authorization record',
      'open a separate explicitly authorized attachment task',
    ],
  };
}

function collectBlockers({ preflight, sourceSafety, candidateGateReport = null, auditManifest = null }) {
  const blockers = [];
  if (preflight.summary?.ready_for_later_attachment_flow !== true) {
    blockers.push(preflight.summary?.source_status || 'source_not_ready');
  }
  if (sourceSafety.ok !== true) {
    blockers.push('source_not_ignored_or_untracked');
  }
  blockers.push(...safeList(preflight.source_findings).filter((finding) => finding.severity === 'error').map((finding) => finding.code));
  blockers.push(...safeList(preflight.safety_findings).filter((finding) => finding.severity === 'error').map((finding) => finding.code));
  if (candidateGateReport) {
    blockers.push(...safeList(candidateGateReport.summary?.rejection_codes));
  }
  if (auditManifest) {
    blockers.push(...safeList(auditManifest.blockers));
  }
  blockers.push('canonical_readiness_held_until_later_authorized_attachment');
  return uniqueStrings(blockers);
}

function skippedStep(reason) {
  return {
    status: 'skipped',
    reason,
    mutates_canonical_artifacts: false,
  };
}

export async function writeStage5bEvidenceReviewDryRun({
  projectRoot = process.cwd(),
  sourcePath = null,
  packageSlug,
  outDir,
  fixture = false,
  generatedAt = null,
} = {}) {
  const root = resolve(projectRoot);
  if (!packageSlug) {
    throw new Error('Stage 5B review dry-run requires --package <canonical-package-slug>');
  }
  const slug = assertCanonicalPackageSlug(packageSlug);
  const generated = nowIso(generatedAt);
  const outputDir = await assertIgnoredOutputDir(root, outDir || 'output/stage5b-evidence-review-dry-run');
  const manifestPath = join(outputDir.absolute, MANIFEST_FILE_NAME);
  const preflightPath = join(outputDir.absolute, PREFLIGHT_FILE_NAME);
  const candidatePath = join(outputDir.absolute, CANDIDATE_FILE_NAME);
  const gatePath = join(outputDir.absolute, GATE_FILE_NAME);
  const auditDir = join(outputDir.absolute, AUDIT_DIR_NAME);

  let effectiveSourcePath = sourcePath;
  if (fixture === true && !effectiveSourcePath) {
    effectiveSourcePath = `local/stage5b-candidate-evidence-inbox/${slug}/review-dry-run-fixture.json`;
  }
  if (fixture === true) {
    effectiveSourcePath = await ensureFixtureSource({
      projectRoot: root,
      sourcePath: effectiveSourcePath,
      slug,
      generatedAt: generated,
    });
  }

  const preflight = await preflightStage5bEvidenceSource({
    projectRoot: root,
    packageSlug: slug,
    sourcePath: effectiveSourcePath,
    generatedAt: generated,
  });
  await writeJsonFile(preflightPath, preflight);

  const sourceSafety = sourceIsIgnoredOrFixtureSafe(preflight, { fixtureMode: fixture === true });
  const preflightReady = preflight.classification === 'ready_for_stage5b_review'
    && preflight.summary?.ready_for_later_attachment_flow === true
    && sourceSafety.ok === true;

  const commandsRun = [
    {
      name: 'stage5b-evidence-source-preflight',
      command: [
        'fcad',
        'stage5b-evidence-source-preflight',
        '--package',
        slug,
        ...(effectiveSourcePath ? ['--source', effectiveSourcePath] : []),
        '--out',
        repoRelativePath(root, preflightPath),
      ],
      status: 'completed',
      mode: 'service_reuse',
      mutates_canonical_artifacts: false,
      output_path: repoRelativePath(root, preflightPath),
    },
  ];

  let candidate = null;
  let candidateGateReport = null;
  let auditResult = null;
  if (preflightReady) {
    const sourceDocument = await loadStage5bEvidenceSourceDocument({
      projectRoot: root,
      sourcePath: effectiveSourcePath,
    });
    candidate = buildReviewCandidate({
      slug,
      document: safeObject(sourceDocument.document),
      candidateSourceRef: repoRelativePath(root, candidatePath),
    });
    await writeJsonFile(candidatePath, candidate);

    candidateGateReport = evaluateStage5bCandidateEvidence({
      document: candidate,
      candidatePath: repoRelativePath(root, candidatePath),
      generatedAt: generated,
    });
    await writeStage5bCandidateEvidenceGateReport(gatePath, candidateGateReport);
    commandsRun.push({
      name: 'stage5b-candidate-evidence-gate',
      command: [
        'node',
        'scripts/stage5b-candidate-evidence-gate.js',
        '--candidate',
        repoRelativePath(root, candidatePath),
        '--out',
        repoRelativePath(root, gatePath),
      ],
      status: 'simulated_review_scoped_candidate_rejected',
      mode: 'library_gate_on_review_derivative',
      mutates_canonical_artifacts: false,
      output_path: repoRelativePath(root, gatePath),
    });

    auditResult = await writeStage5bEvidenceAuditBundle({
      projectRoot: root,
      outDir: auditDir,
      packageSlugs: [slug],
      includeGitHub: false,
      generatedAt: generated,
    });
    commandsRun.push({
      name: 'stage5b-evidence-audit',
      command: [
        'fcad',
        'stage5b-evidence-audit',
        '--package',
        slug,
        '--out-dir',
        repoRelativePath(root, auditDir),
      ],
      status: 'completed',
      mode: 'service_reuse',
      mutates_canonical_artifacts: false,
      output_path: auditResult.paths.stage5b_audit_manifest,
    });
  }

  const candidateRel = candidate ? repoRelativePath(root, candidatePath) : null;
  const gateRel = candidateGateReport ? repoRelativePath(root, gatePath) : null;
  const auditManifest = auditResult?.manifest || null;
  const outputs = {
    manifest: outputRef(root, manifestPath, STAGE5B_EVIDENCE_REVIEW_DRY_RUN_ARTIFACT_TYPE),
    source_preflight_report: outputRef(root, preflightPath, 'stage5b_evidence_source_preflight'),
  };
  if (candidate) {
    outputs.review_candidate = outputRef(root, candidatePath, 'stage5b_evidence_review_dry_run_candidate');
  }
  if (candidateGateReport) {
    outputs.candidate_gate_report = outputRef(root, gatePath, 'stage5b_candidate_evidence_acceptance_report');
  }
  if (auditResult) {
    outputs.audit_manifest = outputRef(root, resolve(root, auditResult.paths.stage5b_audit_manifest), 'stage5b_evidence_audit_manifest');
  }

  const manifest = {
    artifact_type: STAGE5B_EVIDENCE_REVIEW_DRY_RUN_ARTIFACT_TYPE,
    schema_version: STAGE5B_EVIDENCE_REVIEW_DRY_RUN_SCHEMA_VERSION,
    generated_at: generated,
    dry_run: true,
    non_mutating: true,
    package_slug: slug,
    test_scope: {
      fixture_mode: fixture === true,
      non_evidence_fixture: fixture === true,
      note: fixture === true
        ? 'Fixture mode creates a synthetic ignored local-inbox source to validate orchestration only; it is not evidence.'
        : null,
    },
    source_preflight: preflight,
    source_safety: sourceSafety,
    redaction_findings: redactionFindings(preflight),
    provenance_fields: provenanceFieldsFromPreflight(preflight, candidate),
    package_mapping: packageMappingFromPreflight(preflight, slug),
    generated_candidate: {
      path: candidateRel,
      artifact_type: candidate?.artifact_type || null,
      review_scoped_only: Boolean(candidate),
      raw_source_copied: false,
      canonical_evidence_eligible: false,
      note: candidate
        ? 'Ignored review-scoped derivative only; candidate gate rejects it as non-evidence control material.'
        : 'No candidate derivative was created because source preflight did not pass.',
    },
    downstream_steps: {
      candidate_gate: candidateGateReport
        ? {
            status: 'completed_rejected_as_non_evidence_control_material',
            output_path: gateRel,
            report: candidateGateReport,
            mutates_canonical_artifacts: false,
          }
        : skippedStep('source_preflight_not_ready'),
      audit: auditResult
        ? {
            status: 'completed',
            outputs: auditResult.manifest.outputs,
            path_summary: auditResult.paths,
            manifest: auditResult.manifest,
            mutates_canonical_artifacts: false,
          }
        : skippedStep('source_preflight_not_ready'),
    },
    commands_run: commandsRun,
    outputs,
    blockers: collectBlockers({
      preflight,
      sourceSafety,
      candidateGateReport,
      auditManifest,
    }),
    evidence_boundary: {
      hard_evidence_rule: HARD_EVIDENCE_RULE,
      review_dry_run_does_not_attach_evidence: true,
      review_dry_run_does_not_promote_evidence: true,
      review_dry_run_does_not_regenerate_readiness: true,
      review_dry_run_does_not_mark_packages_ready: true,
      generated_review_candidates_are_not_canonical_evidence: true,
    },
    readiness_held_truth: heldTruth(),
    next_required_authorization_step: nextAuthorizationStep(preflightReady),
    summary: {
      source_status: preflight.summary?.source_status || 'UNKNOWN',
      source_classification: preflight.classification,
      source_ready_for_review: preflightReady,
      candidate_generated: Boolean(candidate),
      candidate_gate_decision: candidateGateReport?.decision?.result || null,
      audit_ran: Boolean(auditResult),
      evidence_attached: false,
      canonical_artifacts_mutated: false,
      canonical_readiness_regenerated: false,
      packages_marked_ready: false,
      readiness_remains_held: true,
    },
  };
  assertValidStage5bEvidenceReviewDryRunManifest(manifest, {
    label: 'evidence review dry-run manifest',
    artifactPath: manifestPath,
    projectRoot: root,
  });

  await writeJsonFile(manifestPath, manifest);
  const manifestSha = await sha256IfReadable(manifestPath);
  const finalManifest = {
    ...manifest,
    outputs: {
      ...manifest.outputs,
      manifest: outputRef(root, manifestPath, STAGE5B_EVIDENCE_REVIEW_DRY_RUN_ARTIFACT_TYPE, manifestSha),
    },
  };
  await writeJsonFile(manifestPath, finalManifest);

  return {
    manifest: finalManifest,
    output_dir: outputDir.relative,
    absolute_output_dir: outputDir.absolute,
    paths: {
      manifest: repoRelativePath(root, manifestPath),
      source_preflight_report: repoRelativePath(root, preflightPath),
      review_candidate: candidateRel,
      candidate_gate_report: gateRel,
      audit_manifest: auditResult?.paths.stage5b_audit_manifest || null,
    },
  };
}
