import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import {
  assertValidStage5bIntakeReport,
  assertValidStage5bPromotionDryRunManifest,
} from './stage5b-runtime-validation.js';

const MANIFEST_SCHEMA_VERSION = '1.0';
const REVIEW_CONTEXT_SIDE_INPUTS = Object.freeze([
  Object.freeze({
    option: '--create-quality',
    directory: 'quality',
    pattern: /_create_quality\.json$/i,
    label: 'Create quality report',
  }),
  Object.freeze({
    option: '--drawing-quality',
    directory: 'quality',
    pattern: /_drawing_quality\.json$/i,
    label: 'Drawing quality report',
  }),
  Object.freeze({
    option: '--drawing-qa',
    directory: 'quality',
    pattern: /_drawing_qa\.json$/i,
    label: 'Drawing QA report',
  }),
  Object.freeze({
    option: '--drawing-intent',
    directory: 'drawing',
    pattern: /_drawing_intent\.json$/i,
    label: 'Drawing intent',
  }),
  Object.freeze({
    option: '--feature-catalog',
    directory: 'drawing',
    pattern: /_feature_catalog\.json$/i,
    label: 'Feature catalog',
  }),
  Object.freeze({
    option: '--dfm-report',
    directory: 'quality',
    pattern: /_dfm_report\.json$/i,
    label: 'DFM report',
  }),
]);

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function nowIso(explicitValue = null) {
  return explicitValue || new Date().toISOString();
}

function normalizeRepoPath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
}

function isSafeRepoPath(value) {
  const normalized = normalizeRepoPath(value);
  if (!normalized) return false;
  if (normalized.includes('\0')) return false;
  if (normalized.includes('\\')) return false;
  if (normalized.startsWith('/') || isAbsolute(normalized) || isWindowsAbsolutePath(normalized)) return false;
  if (normalized.startsWith('~')) return false;
  if (normalized.includes('<') || normalized.includes('>')) return false;
  return !normalized.split('/').includes('..');
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

function assertPathInsideProject(projectRoot, pathValue, label) {
  const root = resolve(projectRoot);
  const absolute = isAbsolute(pathValue) || isWindowsAbsolutePath(pathValue)
    ? resolve(pathValue)
    : resolve(root, pathValue);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${label} must stay inside the repository root`);
  }
  if (!isSafeRepoPath(rel)) {
    throw new Error(`${label} failed repository path safety checks`);
  }
  return { absolute, relative: rel };
}

function sha256IfReadable(projectRoot, pathValue) {
  if (!pathValue || !isSafeRepoPath(pathValue)) return null;
  const absolute = resolve(projectRoot, pathValue);
  try {
    return createHash('sha256').update(readFileSync(absolute)).digest('hex');
  } catch {
    return null;
  }
}

function sortedFiles(projectRoot, directory) {
  try {
    return readdirSync(resolve(projectRoot, directory)).sort();
  } catch {
    return [];
  }
}

function findCanonicalModelPath(projectRoot, slug) {
  const cadDir = `docs/examples/${slug}/cad`;
  const entries = sortedFiles(projectRoot, cadDir);
  const preferred = [
    entries.find((entry) => /\.step$/i.test(entry)),
    entries.find((entry) => /\.stp$/i.test(entry)),
    entries.find((entry) => /\.fcstd$/i.test(entry)),
    entries.find((entry) => /\.stl$/i.test(entry)),
  ].find(Boolean);
  return preferred ? `${cadDir}/${preferred}` : null;
}

function findSideInputPath(projectRoot, slug, definition) {
  const directory = `docs/examples/${slug}/${definition.directory}`;
  const entry = sortedFiles(projectRoot, directory).find((fileName) => definition.pattern.test(fileName));
  return entry ? `${directory}/${entry}` : null;
}

function fileExists(projectRoot, relativePath) {
  if (!relativePath || !isSafeRepoPath(relativePath)) return false;
  try {
    return statSync(resolve(projectRoot, relativePath)).isFile();
  } catch {
    return false;
  }
}

function isExternalCandidate(candidate = {}) {
  const kind = String(candidate.source_kind || '');
  return kind.startsWith('github_') || kind === 'repo_doc_public_link';
}

function candidateEvidenceSourceRef(candidate = {}) {
  if (!candidate || typeof candidate !== 'object') return null;
  const signals = safeObject(candidate.document_signals);
  const provenance = safeObject(candidate.source_provenance);
  return candidate.normalized_source_ref
    || signals.source_ref
    || provenance.source_url
    || candidate.path
    || null;
}

function isFixtureCandidate(candidate = {}) {
  if (!candidate || typeof candidate !== 'object') return false;
  const path = normalizeRepoPath(candidate.path);
  const ref = normalizeRepoPath(candidateEvidenceSourceRef(candidate));
  return path.startsWith('tests/fixtures/')
    || ref.startsWith('tests/fixtures/')
    || String(candidate.source_kind || '').includes('fixture');
}

function packageRoot(slug) {
  return `docs/examples/${slug}`;
}

function packagePath(slug, suffix) {
  return `${packageRoot(slug)}/${suffix}`;
}

function commandContainsOnlySafePaths(command = []) {
  for (const value of command) {
    if (typeof value !== 'string') return false;
    if (!value.includes('/')) continue;
    if (/^https?:\/\//i.test(value)) continue;
    if (!isSafeRepoPath(value)) return false;
  }
  return true;
}

function expectedArtifacts(slug, { normalizationRequired = false } = {}) {
  return [
    ...(normalizationRequired ? [{
      path: packagePath(slug, 'inspection/inspection_evidence.json'),
      artifact_type: 'inspection_evidence',
      action: 'would_write_before_review_context',
    }] : []),
    { path: packagePath(slug, 'review/review_pack.json'), artifact_type: 'review_pack', action: 'would_write' },
    { path: packagePath(slug, 'review/review_pack.md'), artifact_type: 'review_pack_markdown', action: 'would_write' },
    { path: packagePath(slug, 'review/review_pack.pdf'), artifact_type: 'review_pack_pdf', action: 'would_write' },
    { path: packagePath(slug, 'readiness/readiness_report.json'), artifact_type: 'readiness_report', action: 'would_write' },
    { path: packagePath(slug, 'readiness/readiness_report.md'), artifact_type: 'readiness_report_markdown', action: 'would_write' },
    { path: packagePath(slug, 'standard-docs/standard_docs_manifest.json'), artifact_type: 'standard_docs_manifest', action: 'would_write' },
    { path: packagePath(slug, 'standard-docs/process_flow.md'), artifact_type: 'process_flow', action: 'would_write' },
    { path: packagePath(slug, 'standard-docs/control_plan_draft.csv'), artifact_type: 'control_plan', action: 'would_write' },
    { path: packagePath(slug, 'standard-docs/inspection_checksheet_draft.csv'), artifact_type: 'inspection_checksheet', action: 'would_write' },
    { path: packagePath(slug, 'standard-docs/pfmea_seed.csv'), artifact_type: 'pfmea_seed', action: 'would_write' },
    { path: packagePath(slug, 'standard-docs/work_instruction_draft.md'), artifact_type: 'work_instruction', action: 'would_write' },
    { path: packagePath(slug, 'release/release_bundle.zip'), artifact_type: 'release_bundle', action: 'would_write' },
    { path: packagePath(slug, 'release/release_bundle_manifest.json'), artifact_type: 'release_bundle_manifest', action: 'would_write' },
    { path: packagePath(slug, 'release/release_bundle_checksums.sha256'), artifact_type: 'release_bundle_checksums', action: 'would_write' },
    { path: packagePath(slug, 'release/release_bundle_log.json'), artifact_type: 'release_bundle_log', action: 'would_write' },
  ];
}

function buildCommands(projectRoot, slug, candidate) {
  const modelPath = findCanonicalModelPath(projectRoot, slug);
  const configPath = packagePath(slug, 'config.toml');
  const normalizationRequired = candidate.source_format !== 'json' || isExternalCandidate(candidate);
  const evidencePath = normalizationRequired
    ? packagePath(slug, 'inspection/inspection_evidence.json')
    : normalizeRepoPath(candidate.path);
  const sideInputs = REVIEW_CONTEXT_SIDE_INPUTS
    .map((definition) => ({
      ...definition,
      path: findSideInputPath(projectRoot, slug, definition),
    }))
    .filter((entry) => entry.path);
  const reviewCommand = [
    'fcad',
    'review-context',
    '--model',
    modelPath,
    ...sideInputs.flatMap((entry) => [entry.option, entry.path]),
    '--inspection-evidence',
    evidencePath,
    '--out',
    packagePath(slug, 'review/review_pack.json'),
  ];
  const readinessCommand = [
    'fcad',
    'readiness-pack',
    '--review-pack',
    packagePath(slug, 'review/review_pack.json'),
    '--out',
    packagePath(slug, 'readiness/readiness_report.json'),
  ];
  const docsCommand = [
    'fcad',
    'generate-standard-docs',
    configPath,
    '--readiness-report',
    packagePath(slug, 'readiness/readiness_report.json'),
    '--out-dir',
    packagePath(slug, 'standard-docs'),
  ];
  const packCommand = [
    'fcad',
    'pack',
    '--readiness',
    packagePath(slug, 'readiness/readiness_report.json'),
    '--docs-manifest',
    packagePath(slug, 'standard-docs/standard_docs_manifest.json'),
    '--out',
    packagePath(slug, 'release/release_bundle.zip'),
  ];
  const artifacts = expectedArtifacts(slug, { normalizationRequired });
  return {
    modelPath,
    configPath,
    evidencePath,
    normalizationRequired,
    sideInputs,
    commands: [
      {
        step: 'attach_inspection_evidence',
        command: reviewCommand,
        expected_outputs: artifacts.filter((artifact) => artifact.path.includes('/review/')),
        files_that_would_be_mutated: artifacts
          .filter((artifact) => artifact.path.includes('/review/') || artifact.path.includes('/inspection/'))
          .map((artifact) => artifact.path),
      },
      {
        step: 'regenerate_readiness',
        command: readinessCommand,
        expected_outputs: artifacts.filter((artifact) => artifact.path.includes('/readiness/')),
        files_that_would_be_mutated: artifacts
          .filter((artifact) => artifact.path.includes('/readiness/'))
          .map((artifact) => artifact.path),
      },
      {
        step: 'regenerate_standard_docs',
        command: docsCommand,
        expected_outputs: artifacts.filter((artifact) => artifact.path.includes('/standard-docs/')),
        files_that_would_be_mutated: artifacts
          .filter((artifact) => artifact.path.includes('/standard-docs/'))
          .map((artifact) => artifact.path),
      },
      {
        step: 'regenerate_release_bundle',
        command: packCommand,
        expected_outputs: artifacts.filter((artifact) => artifact.path.includes('/release/')),
        files_that_would_be_mutated: artifacts
          .filter((artifact) => artifact.path.includes('/release/'))
          .map((artifact) => artifact.path),
      },
    ],
    expectedArtifacts: artifacts,
  };
}

function findPackageReadyCandidates(pkg = {}, report = {}) {
  const slug = pkg.slug;
  return uniqueCandidateList([
    ...safeList(pkg.accepted_candidates),
    ...safeList(report.accepted_candidates).filter((candidate) => candidate.matched_package === slug),
  ].filter((candidate) => candidate?.attachment_ready === true));
}

function uniqueCandidateList(candidates = []) {
  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    const key = [
      candidate.path || '',
      candidate.source_kind || '',
      candidate.matched_package || '',
      candidate.match_confidence || '',
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result.sort((left, right) => String(left.path || '').localeCompare(String(right.path || '')));
}

function planBlockers(pkg, candidate, readyCandidates, { testOnly = false } = {}) {
  const blockers = [
    ...safeList(pkg.attachment_plan?.blockers),
    ...safeList(pkg.intake_action?.blockers),
    ...safeList(candidate?.blockers),
  ];
  if (!candidate) {
    blockers.push('no_genuine_valid_candidate');
  } else {
    if (candidate.classification !== 'genuine_valid') blockers.push('candidate_not_genuine_valid');
    if (candidate.attachment_ready !== true) blockers.push('attachment_not_ready');
    if (candidate.match_confidence !== 'high') blockers.push('insufficient_package_match_confidence');
    if (!candidateEvidenceSourceRef(candidate)) blockers.push('missing_explicit_provenance');
    if (readyCandidates.length > 1) blockers.push('multiple_attachment_ready_candidates');
    if (isFixtureCandidate(candidate) && !testOnly) blockers.push('fixture_candidate_not_canonical_evidence');
  }
  if (pkg.classification === 'invalid_generated' || safeList(pkg.rejected_candidates).some((entry) => entry.classification === 'invalid_generated')) {
    blockers.push('generated_candidate_rejected');
  }
  if (pkg.attachment_plan?.match_confidence === 'ambiguous' || safeList(pkg.attachment_plan?.blockers).includes('ambiguous_package_match')) {
    blockers.push('ambiguous_package_match');
  }
  return uniqueStrings(blockers);
}

function safetyCheck(name, ok, reason) {
  return {
    name,
    status: ok ? 'pass' : 'fail',
    reason,
  };
}

function buildPackageChecks({
  intakeReportOk,
  boundaryOk,
  pkg,
  candidate,
  commandPlan,
  evidencePathSafe,
  commandPathsSafe,
  configExists,
  testOnly,
}) {
  return [
    safetyCheck('intake_report_contract', intakeReportOk, intakeReportOk
      ? 'Input artifact is an inspection_evidence_intake_report.'
      : 'Input artifact is not an inspection evidence intake report.'),
    safetyCheck('hard_evidence_boundary_declared', boundaryOk, boundaryOk
      ? 'Hard evidence rule is present in the intake report.'
      : 'Hard evidence rule is missing from the intake report.'),
    safetyCheck('genuine_completed_evidence_candidate', candidate?.classification === 'genuine_valid', candidate
      ? 'Candidate is classified as genuine_valid by intake.'
      : 'No genuine_valid candidate is available for this package.'),
    safetyCheck('fixture_scope', !isFixtureCandidate(candidate) || testOnly, isFixtureCandidate(candidate)
      ? 'Fixture-backed candidates are test-only and cannot become canonical evidence.'
      : 'Candidate is not a tests/fixtures source.'),
    safetyCheck('attachment_ready', candidate?.attachment_ready === true, candidate?.attachment_ready === true
      ? 'Candidate attachment plan is ready.'
      : 'Candidate attachment plan is not ready.'),
    safetyCheck('high_confidence_match', candidate?.match_confidence === 'high', candidate?.match_confidence === 'high'
      ? 'Candidate has a high-confidence package match.'
      : 'Candidate does not have a high-confidence package match.'),
    safetyCheck('explicit_provenance', Boolean(candidateEvidenceSourceRef(candidate)), candidateEvidenceSourceRef(candidate)
      ? 'Candidate carries explicit source provenance.'
      : 'Candidate is missing explicit provenance.'),
    safetyCheck('evidence_path_safe', evidencePathSafe, evidencePathSafe
      ? 'Evidence path stays under the canonical package inspection boundary or has a safe normalization target.'
      : 'Evidence path is unsafe or outside the canonical package inspection boundary.'),
    safetyCheck('canonical_model_path_resolved', Boolean(commandPlan?.modelPath), commandPlan?.modelPath
      ? `Canonical model path resolved: ${commandPlan.modelPath}.`
      : 'No canonical model file was found for the package.'),
    safetyCheck('package_config_exists', configExists, configExists
      ? 'Package config.toml exists for standard-doc regeneration.'
      : 'Package config.toml is missing.'),
    safetyCheck('command_paths_safe', commandPathsSafe, commandPathsSafe
      ? 'Dry-run commands contain only safe repo-relative paths.'
      : 'One or more dry-run command paths failed safety checks.'),
    safetyCheck('dry_run_no_canonical_writes', true, 'This dry-run only serializes the promotion manifest; it does not run promotion commands.'),
  ];
}

function evidencePathIsSafeForPackage(candidate, slug, evidencePath) {
  if (!candidate) return false;
  if (!isSafeRepoPath(evidencePath)) return false;
  if (candidate.source_format !== 'json' || isExternalCandidate(candidate)) {
    return evidencePath === packagePath(slug, 'inspection/inspection_evidence.json');
  }
  return evidencePath.startsWith(`${packageRoot(slug)}/inspection/`);
}

function promotionStatus({ candidate, blockers }) {
  if (blockers.includes('unsafe_evidence_path') || blockers.includes('unsafe_command_path')) {
    return 'blocked_safety_checks';
  }
  if (blockers.includes('generated_candidate_rejected')) return 'blocked_generated_candidate';
  if (blockers.includes('ambiguous_package_match')) return 'blocked_ambiguous_candidate';
  if (!candidate || blockers.includes('no_genuine_valid_candidate')) return 'blocked_no_valid_candidate';
  if (blockers.length > 0) return 'blocked_attachment_not_ready';
  return 'ready_for_future_promotion_dry_run';
}

function readinessExpectation(pkg, ready) {
  const before = safeObject(pkg.readiness_before);
  const after = safeObject(pkg.readiness_after);
  return {
    dry_run: {
      status: after.status || before.status || 'needs_more_evidence',
      gate_decision: after.gate_decision || before.gate_decision || 'hold_for_evidence_completion',
      missing_inputs: safeList(after.missing_inputs).length > 0 ? after.missing_inputs : before.missing_inputs || ['inspection_evidence'],
      note: 'Dry-run does not mutate readiness; current held state remains the source of truth.',
    },
    after_future_promotion: ready
      ? {
          expected_action: 'rerun review-context, readiness-pack, generate-standard-docs, and pack from the listed commands',
          inspection_evidence_gap: 'expected_to_clear_only_if_review-context records the genuine inspection_evidence ledger entry',
          readiness_overclaim_guard: 'Do not claim production readiness from this manifest; inspect regenerated readiness_report.json after the future run.',
        }
      : {
          expected_action: 'no promotion command should run',
          inspection_evidence_gap: 'remains_missing',
          readiness_overclaim_guard: 'Canonical readiness remains held.',
        },
  };
}

function packageMutationBoundary(slug, commands, expected, ready) {
  return {
    dry_run_writes: ['promotion_dry_run_manifest.json'],
    canonical_artifacts_mutated_by_dry_run: false,
    allowed_future_mutation_roots: ready ? [
      packagePath(slug, 'inspection/'),
      packagePath(slug, 'review/'),
      packagePath(slug, 'readiness/'),
      packagePath(slug, 'standard-docs/'),
      packagePath(slug, 'release/'),
    ] : [],
    files_that_would_be_mutated: ready ? expected.map((artifact) => artifact.path) : [],
    command_count: commands.length,
  };
}

function rollbackGuidance(slug, ready) {
  if (!ready) {
    return [
      'No rollback is needed because no promotion commands should run.',
      'Keep the canonical package readiness held until genuine completed inspection evidence is available.',
    ];
  }
  return [
    `Before any future promotion, review git diff for ${packageRoot(slug)} and confirm only the listed package artifacts changed.`,
    `If a future promotion command is run by mistake, restore the affected ${packageRoot(slug)} files from version control or a clean branch before continuing.`,
    'Delete the dry-run manifest if it is only a temporary control artifact.',
  ];
}

function buildPackageDryRun({ projectRoot, intakeReport, pkg, testOnly, intakeReportOk, boundaryOk }) {
  const slug = String(pkg.slug || '').trim();
  const readyCandidates = findPackageReadyCandidates(pkg, intakeReport);
  const candidate = readyCandidates[0] || null;
  const commandPlan = candidate ? buildCommands(projectRoot, slug, candidate) : null;
  const evidencePathSafe = candidate
    ? evidencePathIsSafeForPackage(candidate, slug, commandPlan.evidencePath)
    : false;
  const configExists = commandPlan ? fileExists(projectRoot, commandPlan.configPath) : false;
  const commandsSafe = commandPlan
    ? commandPlan.commands.every((entry) => commandContainsOnlySafePaths(entry.command))
    : false;
  const blockers = planBlockers(pkg, candidate, readyCandidates, { testOnly });
  if (candidate && !evidencePathSafe) blockers.push('unsafe_evidence_path');
  if (candidate && !commandsSafe) blockers.push('unsafe_command_path');
  if (candidate && !commandPlan.modelPath) blockers.push('missing_canonical_model_file');
  if (candidate && !configExists) blockers.push('missing_package_config');
  const uniqueBlockers = uniqueStrings(blockers);
  const ready = candidate && uniqueBlockers.length === 0;
  const checks = buildPackageChecks({
    intakeReportOk,
    boundaryOk,
    pkg,
    candidate,
    commandPlan,
    evidencePathSafe,
    commandPathsSafe: commandsSafe,
    configExists,
    testOnly,
  });
  const expected = ready ? commandPlan.expectedArtifacts : [];
  const commands = ready ? commandPlan.commands : [];

  return {
    package_slug: slug,
    promotion_status: promotionStatus({ candidate, blockers: uniqueBlockers }),
    evidence_source_ref: candidateEvidenceSourceRef(candidate),
    candidate_path: candidate?.path || null,
    candidate_classification: candidate?.classification || pkg.classification || 'no_candidate',
    match_confidence: candidate?.match_confidence || pkg.attachment_plan?.match_confidence || 'none',
    attachment_ready: candidate?.attachment_ready === true,
    test_only: testOnly === true,
    fixture_warning: testOnly === true
      ? 'Test-only dry-run success proves orchestration only; it is not canonical inspection evidence.'
      : null,
    blockers: uniqueBlockers,
    canonical_next_command: commands[0]?.command || null,
    commands_to_run: commands,
    expected_artifacts: expected,
    files_that_would_be_mutated: expected.map((artifact) => artifact.path),
    mutation_boundaries: packageMutationBoundary(slug, commands, expected, ready),
    safety_checks: checks,
    readiness_expectation: readinessExpectation(pkg, ready),
    rollback_guidance: rollbackGuidance(slug, ready),
  };
}

export function buildInspectionEvidencePromotionDryRunManifest({
  projectRoot,
  intakeReport,
  intakeReportPath = null,
  generatedAt = null,
  testOnly = false,
} = {}) {
  const resolvedRoot = resolve(projectRoot || process.cwd());
  const report = safeObject(intakeReport);
  const intakeReportOk = report.artifact_type === 'inspection_evidence_intake_report';
  const boundaryOk = typeof report.source_boundary?.hard_evidence_rule === 'string'
    && report.source_boundary.hard_evidence_rule.trim().length > 0;
  const packages = safeList(report.packages)
    .filter((pkg) => pkg && typeof pkg === 'object' && typeof pkg.slug === 'string' && pkg.slug.trim())
    .map((pkg) => buildPackageDryRun({
      projectRoot: resolvedRoot,
      intakeReport: report,
      pkg,
      testOnly: testOnly === true || report.test_only === true,
      intakeReportOk,
      boundaryOk,
    }));
  const readyPackages = packages.filter((pkg) => pkg.promotion_status === 'ready_for_future_promotion_dry_run');
  const blockedPackages = packages.filter((pkg) => pkg.promotion_status !== 'ready_for_future_promotion_dry_run');
  const reportRelativePath = intakeReportPath ? repoRelativePath(resolvedRoot, intakeReportPath) : null;

  return {
    artifact_type: 'inspection_evidence_promotion_dry_run_manifest',
    schema_version: MANIFEST_SCHEMA_VERSION,
    generated_at: nowIso(generatedAt),
    dry_run: true,
    source_intake_report: {
      path: reportRelativePath,
      artifact_type: report.artifact_type || null,
      schema_version: report.schema_version || null,
      generated_at: report.generated_at || null,
      sha256: reportRelativePath ? sha256IfReadable(resolvedRoot, reportRelativePath) : null,
    },
    hard_evidence_rule: report.source_boundary?.hard_evidence_rule || 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.',
    evidence_boundary: {
      rejected_as_final_evidence: safeList(report.source_boundary?.rejected_as_final_evidence),
      dry_run_does_not_attach_evidence: true,
      fixture_success_path_proves_orchestration_only: true,
    },
    test_scope: {
      test_only: testOnly === true || report.test_only === true,
      note: (testOnly === true || report.test_only === true)
        ? 'This dry-run is labeled test-only and must not be treated as canonical package evidence.'
        : null,
    },
    summary: {
      package_count: packages.length,
      ready_package_count: readyPackages.length,
      blocked_package_count: blockedPackages.length,
      promotion_can_run: readyPackages.length > 0,
      canonical_artifacts_mutated: false,
      dry_run_manifest_only: true,
      genuine_inspection_evidence_found: report.summary?.genuine_inspection_evidence_found === true,
      attachment_ready_candidate_count: report.summary?.attachment_ready_candidate_count ?? readyPackages.length,
      readiness_expectation: readyPackages.length > 0
        ? 'Future promotion commands are listed, but readiness remains unchanged until those commands are deliberately run with genuine evidence.'
        : 'No promotion can run; readiness remains needs_more_evidence / hold_for_evidence_completion.',
      blockers: uniqueStrings(blockedPackages.flatMap((pkg) => pkg.blockers)),
    },
    packages,
    mutation_boundaries: {
      dry_run_writes_only_manifest: true,
      canonical_package_artifacts_mutated_by_dry_run: false,
      future_mutation_roots: uniqueStrings(packages.flatMap((pkg) => safeList(pkg.mutation_boundaries?.allowed_future_mutation_roots))),
    },
    rollback_guidance: [
      'Dry-run rollback is deleting the generated promotion_dry_run_manifest.json control artifact.',
      'If future promotion commands are deliberately executed, use git status and git diff to inspect every changed canonical package file before committing.',
    ],
  };
}

export async function writeInspectionEvidencePromotionDryRunManifest({
  projectRoot,
  intakeReport,
  intakeReportPath = null,
  outputPath,
  generatedAt = null,
  testOnly = false,
} = {}) {
  if (!outputPath) {
    throw new Error('outputPath is required for inspection evidence promotion dry-run manifests');
  }
  const resolvedRoot = resolve(projectRoot || process.cwd());
  const output = assertPathInsideProject(resolvedRoot, outputPath, 'promotion dry-run output path');
  assertValidStage5bIntakeReport(intakeReport, { label: 'source intake report' });
  const manifest = buildInspectionEvidencePromotionDryRunManifest({
    projectRoot: resolvedRoot,
    intakeReport,
    intakeReportPath,
    generatedAt,
    testOnly,
  });
  assertValidStage5bPromotionDryRunManifest(manifest, { label: 'promotion dry-run manifest' });
  mkdirSync(dirname(output.absolute), { recursive: true });
  writeFileSync(output.absolute, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    manifest,
    output_path: output.relative,
    absolute_output_path: output.absolute,
  };
}
