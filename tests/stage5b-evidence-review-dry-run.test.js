import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PACKAGE_SLUG = 'quality-pass-bracket';
const RUN_ID = `${process.pid}-${Date.now()}`;
const OUTPUT_DIR = `output/stage5b-review-dry-run-${RUN_ID}`;
const INBOX_DIR = `local/stage5b-candidate-evidence-inbox/${PACKAGE_SLUG}/review-dry-run-${RUN_ID}`;
const MANIFEST_NAME = 'stage5b_evidence_review_dry_run_manifest.json';
const RAW_MARKER = 'RAW_SUPPLIER_DO_NOT_COPY_STAGE5B_REVIEW_DRY_RUN_TEST';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeText(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, value, 'utf8');
}

function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
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

function validRawSource(overrides = {}) {
  return {
    package_id: PACKAGE_SLUG,
    inspected_part: PACKAGE_SLUG,
    part_revision: 'A',
    inspection_date: '2026-06-04',
    source_type: 'supplier_inspection_report',
    inspection_status: 'completed',
    inspector: 'Supplier QA Inspector',
    reviewed_by: 'Maintainer QA Reviewer',
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
    raw_supplier_internal_note: RAW_MARKER,
    ...overrides,
  };
}

function manifestPath(outDir = OUTPUT_DIR) {
  return join(ROOT, outDir, MANIFEST_NAME);
}

function findingCodes(manifest) {
  return [
    ...manifest.redaction_findings.source_findings.map((finding) => finding.code),
    ...manifest.redaction_findings.safety_findings.map((finding) => finding.code),
  ];
}

function assertHeldTruth(manifest, label) {
  assert.equal(manifest.readiness_held_truth.readiness_remains_held, true, `${label} should keep readiness held`);
  assert.equal(manifest.readiness_held_truth.canonical_readiness_regenerated, false, `${label} must not regenerate readiness`);
  assert.equal(manifest.readiness_held_truth.canonical_artifacts_mutated, false, `${label} must not mutate canonical artifacts`);
  assert.equal(manifest.readiness_held_truth.packages_marked_ready, false, `${label} must not mark packages ready`);
  assert.match(manifest.readiness_held_truth.statement, /needs_more_evidence \/ hold_for_evidence_completion/i);
}

function assertNoRawSourceCopied(outDir) {
  const grep = spawnSync('grep', ['-R', RAW_MARKER, outDir], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(grep.status, 1, `raw private source marker must not be copied into ${outDir}:\n${grep.stdout}`);
}

const canonicalFiles = trackedDocsExampleFiles();
const canonicalStatusBefore = docsExamplesStatus();
const canonicalHashBefore = hashTrackedFiles(canonicalFiles);

try {
  const missingRun = runFcad([
    'stage5b-evidence-review-dry-run',
    '--package',
    PACKAGE_SLUG,
    '--out-dir',
    `${OUTPUT_DIR}/missing`,
  ], 'missing source review dry-run');
  assert.match(missingRun.stdout, /Source status: READY_FOR_SOURCE/);
  const missingManifest = readJson(manifestPath(`${OUTPUT_DIR}/missing`));
  assert.equal(missingManifest.artifact_type, 'stage5b_evidence_review_dry_run_manifest');
  assert.equal(missingManifest.source_preflight.summary.source_status, 'READY_FOR_SOURCE');
  assert.equal(missingManifest.generated_candidate.path, null);
  assert.equal(missingManifest.downstream_steps.candidate_gate.status, 'skipped');
  assert.equal(missingManifest.summary.evidence_attached, false);
  assertHeldTruth(missingManifest, 'missing source dry-run');

  const rejectCases = [
    {
      label: 'unsafe private source',
      source: `${INBOX_DIR}/unsafe-private-source.json`,
      write() {
        writeJson(join(ROOT, this.source), validRawSource({
          inspector: 'qa.inspector@example.com',
          notes: 'Supplier-private original. Authorization: Bearer abc123. Local raw path /Users/qa/private/report.xlsx',
          source_url: 'https://10.0.0.5/private/report',
        }));
      },
      pattern: /potential_pii|private_url|absolute_local_path|token_or_secret/,
    },
    {
      label: 'surrogate source',
      source: `${INBOX_DIR}/surrogate_inspection_validation.json`,
      write() {
        writeJson(join(ROOT, this.source), {
          artifact_type: 'surrogate_inspection_validation',
          notes: 'Synthetic surrogate non-evidence generated from CAD/spec values.',
        });
      },
      pattern: /surrogate_artifact_not_evidence|synthetic_or_generated_not_evidence/,
    },
    {
      label: 'generated quality source',
      source: 'docs/examples/quality-pass-bracket/quality/quality_pass_bracket_create_quality.json',
      pattern: /cad_or_generated_values_not_evidence|tracked_source_file/,
    },
    {
      label: 'readiness source',
      source: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
      pattern: /readiness_artifact_not_evidence|tracked_source_file/,
    },
    {
      label: 'CI metadata source',
      source: '.github/workflows/automation-ci.yml',
      pattern: /ci_artifact_not_evidence|tracked_source_file|unsupported_source_format/,
    },
  ];

  for (const testCase of rejectCases) {
    testCase.write?.();
    runFcad([
      'stage5b-evidence-review-dry-run',
      '--package',
      PACKAGE_SLUG,
      '--source',
      testCase.source,
      '--out-dir',
      `${OUTPUT_DIR}/${testCase.label.replaceAll(' ', '-')}`,
    ], testCase.label);
    const manifest = readJson(manifestPath(`${OUTPUT_DIR}/${testCase.label.replaceAll(' ', '-')}`));
    assert.equal(manifest.source_preflight.classification, 'unsafe_or_not_evidence', `${testCase.label} should be rejected`);
    assert.equal(manifest.generated_candidate.path, null, `${testCase.label} should not create candidate material`);
    assert.match(findingCodes(manifest).join('\n'), testCase.pattern, `${testCase.label} should record rejection codes`);
    assertHeldTruth(manifest, `${testCase.label} dry-run`);
  }

  const fixtureRun = runFcad([
    'stage5b-evidence-review-dry-run',
    '--package',
    PACKAGE_SLUG,
    '--source',
    `${INBOX_DIR}/synthetic-fixture-source.json`,
    '--out-dir',
    `${OUTPUT_DIR}/fixture`,
    '--fixture',
  ], 'fixture review dry-run');
  assert.match(fixtureRun.stdout, /Fixture mode: yes/);
  assert.match(fixtureRun.stdout, /Canonical readiness remains held: yes/);
  const fixtureManifest = readJson(manifestPath(`${OUTPUT_DIR}/fixture`));
  assert.equal(fixtureManifest.test_scope.fixture_mode, true);
  assert.equal(fixtureManifest.test_scope.non_evidence_fixture, true);
  assert.equal(fixtureManifest.source_preflight.classification, 'ready_for_stage5b_review');
  assert.equal(fixtureManifest.generated_candidate.review_scoped_only, true);
  assert.equal(fixtureManifest.generated_candidate.raw_source_copied, false);
  assert.equal(existsSync(join(ROOT, fixtureManifest.generated_candidate.path)), true, 'review candidate should be written');
  assert.equal(existsSync(join(ROOT, fixtureManifest.downstream_steps.candidate_gate.output_path)), true, 'candidate gate report should be written');
  assert.equal(fixtureManifest.downstream_steps.candidate_gate.report.summary.eligible_for_stage5b_intake_review, false);
  assert.match(
    fixtureManifest.downstream_steps.candidate_gate.report.summary.rejection_codes.join('\n'),
    /candidate_path_not_repo_safe|generated_control_artifact_type_not_evidence|non_genuine_candidate_wording/
  );
  assert.equal(existsSync(join(ROOT, fixtureManifest.downstream_steps.audit.outputs.stage5b_audit_manifest.path)), true);
  assert.equal(fixtureManifest.summary.evidence_attached, false);
  assert.equal(fixtureManifest.summary.canonical_artifacts_mutated, false);
  assert.equal(fixtureManifest.summary.canonical_readiness_regenerated, false);
  assert.equal(fixtureManifest.summary.packages_marked_ready, false);
  assert.match(fixtureManifest.next_required_authorization_step.action, /authorization/i);
  assertHeldTruth(fixtureManifest, 'fixture review dry-run');
  assertNoRawSourceCopied(`${OUTPUT_DIR}/fixture`);

  const rawSource = `${INBOX_DIR}/valid-source-with-raw-marker.json`;
  writeJson(join(ROOT, rawSource), validRawSource());
  runFcad([
    'stage5b-evidence-review-dry-run',
    '--package',
    PACKAGE_SLUG,
    '--source',
    rawSource,
    '--out-dir',
    `${OUTPUT_DIR}/valid-source`,
  ], 'valid source review dry-run');
  const validManifest = readJson(manifestPath(`${OUTPUT_DIR}/valid-source`));
  assert.equal(validManifest.source_preflight.classification, 'ready_for_stage5b_review');
  assert.equal(validManifest.generated_candidate.raw_source_copied, false);
  assertNoRawSourceCopied(`${OUTPUT_DIR}/valid-source`);

  const canonicalFilesAfter = trackedDocsExampleFiles();
  const canonicalStatusAfter = docsExamplesStatus();
  const canonicalHashAfter = hashTrackedFiles(canonicalFilesAfter);
  assert.deepEqual(canonicalFilesAfter, canonicalFiles, 'review dry-run must not add or remove tracked docs/examples files');
  assert.equal(canonicalStatusAfter, canonicalStatusBefore, 'review dry-run must not change docs/examples git status');
  assert.equal(canonicalHashAfter, canonicalHashBefore, 'review dry-run must not mutate canonical docs/examples package artifacts');
} finally {
  rmSync(join(ROOT, OUTPUT_DIR), { recursive: true, force: true });
  rmSync(join(ROOT, INBOX_DIR), { recursive: true, force: true });
}

console.log('stage5b-evidence-review-dry-run.test.js: ok');
