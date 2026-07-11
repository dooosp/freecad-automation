import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import {
  assertValidStage5bIntakeReport,
  assertValidStage5bPromotionDryRunManifest,
} from './stage5b-runtime-validation.js';

const MANIFEST_SCHEMA_VERSION = '1.0';
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

function promotionStatus({ candidate, blockers }) {
  if (blockers.includes('unsafe_evidence_path') || blockers.includes('unsafe_command_path')) {
    return 'blocked_safety_checks';
  }
  if (blockers.includes('generated_candidate_rejected')) return 'blocked_generated_candidate';
  if (blockers.includes('ambiguous_package_match')) return 'blocked_ambiguous_candidate';
  if (!candidate || blockers.includes('no_genuine_valid_candidate')) return 'blocked_no_valid_candidate';
  return 'blocked_attachment_not_ready';
}

function readinessExpectation(pkg) {
  const before = safeObject(pkg.readiness_before);
  const after = safeObject(pkg.readiness_after);
  return {
    dry_run: {
      status: after.status || before.status || 'needs_more_evidence',
      gate_decision: after.gate_decision || before.gate_decision || 'hold_for_evidence_completion',
      missing_inputs: safeList(after.missing_inputs).length > 0 ? after.missing_inputs : before.missing_inputs || ['inspection_evidence'],
      note: 'Dry-run does not mutate readiness; current held state remains the source of truth.',
    },
    after_future_promotion: {
      expected_action: 'no legacy promotion command should run; enter the quarantine-first onboarding contract instead',
      inspection_evidence_gap: 'remains_missing',
      readiness_overclaim_guard: 'Canonical readiness remains held.',
    },
  };
}

function packageMutationBoundary(commands) {
  return {
    dry_run_writes: ['promotion_dry_run_manifest.json'],
    canonical_artifacts_mutated_by_dry_run: false,
    allowed_future_mutation_roots: [],
    files_that_would_be_mutated: [],
    command_count: commands.length,
  };
}

function rollbackGuidance() {
  return [
    'No rollback is needed because no promotion commands should run.',
    'Keep the canonical package readiness held until genuine completed inspection evidence is available.',
  ];
}

function buildPackageDryRun({ projectRoot, intakeReport, pkg, testOnly, intakeReportOk, boundaryOk }) {
  const slug = String(pkg.slug || '').trim();
  const readyCandidates = findPackageReadyCandidates(pkg, intakeReport);
  const candidate = readyCandidates[0] || null;
  const commandPlan = null;
  const evidencePathSafe = candidate ? isSafeRepoPath(candidateEvidenceSourceRef(candidate)) : false;
  const configExists = false;
  const commandsSafe = false;
  const blockers = planBlockers(pkg, candidate, readyCandidates, { testOnly });
  if (candidate && !evidencePathSafe) blockers.push('unsafe_evidence_path');
  blockers.push('legacy_promotion_flow_superseded_by_quarantine_onboarding');
  const uniqueBlockers = uniqueStrings(blockers);
  const ready = false;
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
  const expected = [];
  const commands = [];

  return {
    package_slug: slug,
    promotion_status: promotionStatus({ candidate, blockers: uniqueBlockers }),
    evidence_source_ref: candidateEvidenceSourceRef(candidate),
    candidate_path: candidate?.path || null,
    candidate_classification: candidate?.classification || pkg.classification || 'no_candidate',
    match_confidence: candidate?.match_confidence || pkg.attachment_plan?.match_confidence || 'none',
    attachment_ready: false,
    test_only: testOnly === true,
    fixture_warning: testOnly === true
      ? 'Legacy test-only dry-run inputs remain blocked; they are not canonical inspection evidence.'
      : null,
    blockers: uniqueBlockers,
    canonical_next_command: commands[0]?.command || null,
    commands_to_run: commands,
    expected_artifacts: expected,
    files_that_would_be_mutated: expected.map((artifact) => artifact.path),
    mutation_boundaries: packageMutationBoundary(commands),
    safety_checks: checks,
    readiness_expectation: readinessExpectation(pkg),
    rollback_guidance: rollbackGuidance(),
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
      attachment_ready_candidate_count: readyPackages.length,
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
  assertValidStage5bIntakeReport(intakeReport, {
    label: 'source intake report',
    artifactPath: intakeReportPath,
    projectRoot: resolvedRoot,
  });
  const manifest = buildInspectionEvidencePromotionDryRunManifest({
    projectRoot: resolvedRoot,
    intakeReport,
    intakeReportPath,
    generatedAt,
    testOnly,
  });
  assertValidStage5bPromotionDryRunManifest(manifest, {
    label: 'promotion dry-run manifest',
    artifactPath: output.absolute,
    projectRoot: resolvedRoot,
  });
  mkdirSync(dirname(output.absolute), { recursive: true });
  writeFileSync(output.absolute, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    manifest,
    output_path: output.relative,
    absolute_output_path: output.absolute,
  };
}
