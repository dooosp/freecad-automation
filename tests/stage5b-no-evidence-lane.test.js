import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_DIR = `output/stage5b-no-evidence-lane-${process.pid}-${Date.now()}`;
const ABSOLUTE_OUTPUT_DIR = join(ROOT, OUTPUT_DIR);
const CANONICAL_PACKAGE_SLUGS = Object.freeze([
  'controller-housing-eol',
  'hinge-block',
  'motor-mount',
  'plate-with-holes',
  'quality-pass-bracket',
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function runFcad(args, label) {
  const result = spawnSync(process.execPath, ['bin/fcad.js', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    `${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  return result;
}

function trackedDocsExampleFiles() {
  return runGit(['ls-files', 'docs/examples'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function docsExamplesStatus() {
  return runGit(['status', '--short', '--', 'docs/examples']);
}

function hashTrackedFiles(paths) {
  const hash = createHash('sha256');
  for (const path of paths) {
    hash.update(`${path}\0`);
    hash.update(readFileSync(join(ROOT, path)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function assertCanonicalPackageSet(packages, label) {
  assert.deepEqual(
    packages.map((pkg) => pkg.slug || pkg.package_slug).sort(),
    [...CANONICAL_PACKAGE_SLUGS].sort(),
    `${label} should cover all canonical packages`
  );
}

function assertReadinessHeld(readiness, label) {
  assert.equal(readiness?.status, 'needs_more_evidence', `${label} should stay needs_more_evidence`);
  assert.equal(readiness?.gate_decision, 'hold_for_evidence_completion', `${label} should stay held`);
  assert.equal(
    Array.isArray(readiness?.missing_inputs) && readiness.missing_inputs.includes('inspection_evidence'),
    true,
    `${label} should keep inspection_evidence missing`
  );
}

function assertNoEvidenceIntake(intake) {
  assert.equal(intake.artifact_type, 'inspection_evidence_intake_report');
  assert.equal(intake.github_discovery?.enabled, false, 'local lane must not enable GitHub discovery by default');
  assert.equal(intake.summary.genuine_inspection_evidence_found, false);
  assert.equal(intake.summary.accepted_candidate_count, 0);
  assert.equal(intake.summary.attachment_ready_candidate_count, 0);
  assert.equal(intake.summary.requires_human_measurement_entry, false);
  assert.match(intake.summary.readiness_truth, /needs_more_evidence \/ hold_for_evidence_completion/);
  assertCanonicalPackageSet(intake.packages, 'intake report');
  for (const pkg of intake.packages) {
    assert.equal(pkg.classification, 'no_candidate', `${pkg.slug} should have no genuine candidate`);
    assert.equal(pkg.accepted_candidates.length, 0, `${pkg.slug} should not accept candidates`);
    assert.equal(pkg.attachment_plan.attachment_ready, false, `${pkg.slug} attachment must not be ready`);
    assert.equal(pkg.attachment_plan.canonical_next_command, null, `${pkg.slug} should not expose a promotion command`);
    assert.equal(pkg.intake_action.status, 'hold_for_evidence_completion', `${pkg.slug} intake action should hold`);
    assertReadinessHeld(pkg.readiness_after, `${pkg.slug} intake readiness`);
  }
}

function assertNoEvidenceDryRun(dryRun) {
  assert.equal(dryRun.artifact_type, 'inspection_evidence_promotion_dry_run_manifest');
  assert.equal(dryRun.dry_run, true);
  assert.equal(dryRun.summary.genuine_inspection_evidence_found, false);
  assert.equal(dryRun.summary.promotion_can_run, false);
  assert.equal(dryRun.summary.ready_package_count, 0);
  assert.equal(dryRun.summary.canonical_artifacts_mutated, false);
  assert.equal(dryRun.summary.attachment_ready_candidate_count, 0);
  assert.match(dryRun.summary.readiness_expectation, /needs_more_evidence \/ hold_for_evidence_completion/);
  assert.equal(dryRun.evidence_boundary.dry_run_does_not_attach_evidence, true);
  assertCanonicalPackageSet(dryRun.packages, 'promotion dry-run');
  for (const pkg of dryRun.packages) {
    assert.equal(pkg.attachment_ready, false, `${pkg.package_slug} dry-run attachment must not be ready`);
    assert.equal(pkg.canonical_next_command, null, `${pkg.package_slug} should not expose a canonical command`);
    assert.equal(pkg.commands_to_run.length, 0, `${pkg.package_slug} should not list promotion commands`);
    assert.equal(pkg.files_that_would_be_mutated.length, 0, `${pkg.package_slug} should not list canonical mutations`);
    assert.equal(pkg.mutation_boundaries.canonical_artifacts_mutated_by_dry_run, false);
    assertReadinessHeld(pkg.readiness_expectation.dry_run, `${pkg.package_slug} dry-run readiness`);
  }
}

function assertNoEvidenceAudit(audit) {
  assert.equal(audit.artifact_type, 'stage5b_evidence_audit_manifest');
  assert.equal(audit.include_github, false, 'local lane must leave GitHub discovery disabled');
  assert.equal(audit.summary.genuine_inspection_evidence_found, false);
  assert.equal(audit.summary.promotion_can_run, false);
  assert.equal(audit.summary.readiness_remains_held, true);
  assert.equal(audit.summary.canonical_artifacts_mutated, false);
  assert.equal(audit.summary.requires_human_measurement_entry, false);
  assert.equal(audit.readiness_held_truth.no_genuine_completed_inspection_evidence_found, true);
  assert.equal(audit.readiness_held_truth.no_promotion_can_run, true);
  assert.equal(audit.readiness_held_truth.readiness_remains_held, true);
  assert.equal(audit.evidence_boundary.generated_artifacts_do_not_satisfy_inspection_evidence, true);
  assert.equal(audit.evidence_boundary.github_metadata_alone_is_not_evidence, true);
  assert.equal(audit.evidence_boundary.human_measurement_entry_requested, false);
  assert.equal(audit.source_classes.accepted_count, 0);
  assert.equal(audit.source_classes.rejected_counts.invalid_generated > 0, true);
  assert.equal(audit.source_classes.rejected_counts.invalid_provenance > 0, true);
  assertCanonicalPackageSet(audit.canonical_package_readiness_states, 'audit readiness states');
  for (const pkg of audit.canonical_package_readiness_states) {
    assert.equal(pkg.attachment_ready, false, `${pkg.slug} audit attachment must not be ready`);
    assert.equal(pkg.readiness_remains_held, true, `${pkg.slug} audit readiness should remain held`);
    assertReadinessHeld(pkg.readiness_after, `${pkg.slug} audit readiness`);
  }
  assert(
    audit.next_safe_commands.every((entry) => entry.mutates_canonical_artifacts === false),
    'audit next safe commands must be non-mutating'
  );
}

function assertRejectedCandidateClasses(intake) {
  assert(
    intake.rejected_candidates.some((candidate) => (
      candidate.path === 'tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json'
      && candidate.classification === 'invalid_provenance'
      && candidate.attachment_ready === false
    )),
    'schema-valid fixture must be rejected as non-genuine provenance'
  );
  assert(
    intake.rejected_candidates.some((candidate) => (
      /readiness\/readiness_report\.json$/.test(candidate.path)
      && candidate.classification === 'invalid_generated'
      && candidate.attachment_ready === false
    )),
    'readiness reports must be rejected as generated/control artifacts'
  );
  assert(
    intake.rejected_candidates.some((candidate) => (
      /release\/release_bundle\.zip$/.test(candidate.path)
      && candidate.classification === 'invalid_generated'
      && candidate.attachment_ready === false
    )),
    'release bundles must be rejected as generated/control artifacts'
  );
}

function assertEvidenceBoundary({ intake, dryRun, audit, auditSummaryMarkdown }) {
  const runbook = readFileSync(join(ROOT, 'docs/stage-5b-operational-runbook.md'), 'utf8');
  const boundaryText = [
    JSON.stringify(intake.source_boundary),
    JSON.stringify(dryRun.evidence_boundary),
    JSON.stringify(audit.evidence_boundary),
    auditSummaryMarkdown,
    runbook,
  ].join('\n');

  const expectedBoundaries = [
    ['diagnostics', /diagnostics/i],
    ['schemas', /schemas/i],
    ['fixtures', /fixtures/i],
    ['intake outputs', /intake reports?/i],
    ['promotion dry-run outputs', /promotion dry-run manifests?/i],
    ['audit outputs', /audit manifests?|audit summaries/i],
    ['GitHub metadata', /GitHub metadata/i],
    ['CI metadata', /CI metadata|CI summaries|workflow metadata/i],
    ['screenshots', /screenshots/i],
    ['templates', /templates/i],
    ['collection guides', /collection guides/i],
    ['comments', /comments/i],
    ['PR bodies', /PR bodies/i],
    ['docs artifacts', /standard-doc|docs/i],
    ['release bundles', /release bundles/i],
  ];

  for (const [label, pattern] of expectedBoundaries) {
    assert.match(boundaryText, pattern, `${label} should be named as non-inspection evidence`);
  }
  assert.match(
    boundaryText,
    /Only genuine completed physical\/supplier\/lab\/QA inspection records can satisfy inspection_evidence/i
  );
}

mkdirSync(ABSOLUTE_OUTPUT_DIR, { recursive: true });
const canonicalFiles = trackedDocsExampleFiles();
const canonicalStatusBefore = docsExamplesStatus();
const canonicalHashBefore = hashTrackedFiles(canonicalFiles);

try {
  const intakeRef = `${OUTPUT_DIR}/inspection-evidence-intake-report.json`;
  const dryRunRef = `${OUTPUT_DIR}/promotion_dry_run_manifest.json`;
  const auditRef = `${OUTPUT_DIR}/audit`;

  const intakeRun = runFcad([
    'inspection-evidence-intake',
    '--out',
    intakeRef,
  ], 'inspection-evidence-intake no-evidence lane');
  assert.match(intakeRun.stdout, /Genuine evidence found: no/);
  assert.match(intakeRun.stdout, /Accepted candidates: 0/);

  const dryRun = runFcad([
    'inspection-evidence-promotion-dry-run',
    '--intake-report',
    intakeRef,
    '--out',
    dryRunRef,
  ], 'inspection-evidence-promotion-dry-run no-evidence lane');
  assert.match(dryRun.stdout, /Promotion can run: no/);
  assert.match(dryRun.stdout, /Canonical artifacts mutated: no/);

  const auditRun = runFcad([
    'stage5b-evidence-audit',
    '--out-dir',
    auditRef,
  ], 'stage5b-evidence-audit no-evidence lane');
  assert.match(auditRun.stdout, /Genuine evidence found: no/);
  assert.match(auditRun.stdout, /Promotion can run: no/);
  assert.match(auditRun.stdout, /Readiness remains held: yes/);

  const intakePath = join(ROOT, intakeRef);
  const dryRunPath = join(ROOT, dryRunRef);
  const auditManifestPath = join(ROOT, auditRef, 'stage5b_audit_manifest.json');
  const auditSummaryPath = join(ROOT, auditRef, 'stage5b_audit_summary.md');

  [
    intakePath,
    dryRunPath,
    join(ROOT, auditRef, 'intake_report.json'),
    join(ROOT, auditRef, 'promotion_dry_run_manifest.json'),
    auditManifestPath,
    auditSummaryPath,
  ].forEach((path) => {
    assert.equal(existsSync(path), true, `${path} should exist`);
  });

  const intake = readJson(intakePath);
  const promotionDryRun = readJson(dryRunPath);
  const audit = readJson(auditManifestPath);
  const auditSummaryMarkdown = readFileSync(auditSummaryPath, 'utf8');

  assertNoEvidenceIntake(intake);
  assertNoEvidenceDryRun(promotionDryRun);
  assertNoEvidenceAudit(audit);
  assertRejectedCandidateClasses(intake);
  assertEvidenceBoundary({ intake, dryRun: promotionDryRun, audit, auditSummaryMarkdown });
  assert.match(auditSummaryMarkdown, /Genuine completed evidence found: no/);
  assert.match(auditSummaryMarkdown, /Promotion can run: no/);
  assert.match(auditSummaryMarkdown, /Readiness remains held: yes/);

  const canonicalFilesAfter = trackedDocsExampleFiles();
  const canonicalStatusAfter = docsExamplesStatus();
  const canonicalHashAfter = hashTrackedFiles(canonicalFilesAfter);
  assert.deepEqual(canonicalFilesAfter, canonicalFiles, 'no-evidence lane must not add or remove tracked docs/examples files');
  assert.equal(canonicalStatusAfter, canonicalStatusBefore, 'no-evidence lane must not change docs/examples git status');
  assert.equal(canonicalHashAfter, canonicalHashBefore, 'no-evidence lane must not mutate canonical docs/examples package artifacts');
} finally {
  rmSync(ABSOLUTE_OUTPUT_DIR, { recursive: true, force: true });
}

console.log('stage5b-no-evidence-lane.test.js: ok');
