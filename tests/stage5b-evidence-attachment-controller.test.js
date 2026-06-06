import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PACKAGE_SLUG = 'quality-pass-bracket';
const RUN_ID = `${process.pid}-${Date.now()}`;
const OUTPUT_DIR = `output/stage5b-attachment-controller-${RUN_ID}`;
const INBOX_DIR = `local/stage5b-candidate-evidence-inbox/${PACKAGE_SLUG}/attachment-controller-${RUN_ID}`;
const MANIFEST_NAME = 'stage5b_evidence_review_dry_run_manifest.json';
const CONTROL_MANIFEST_NAME = 'stage5b_evidence_attachment_control_manifest.json';
const RAW_MARKER = 'RAW_SUPPLIER_DO_NOT_COPY_STAGE5B_ATTACHMENT_CONTROLLER_TEST';

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

function runFcad(args, label, { expectStatus = 0 } = {}) {
  const result = spawnSync(process.execPath, ['bin/fcad.js', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    expectStatus,
    `${label} unexpected status ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
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

function reviewManifestPath(name) {
  return `${OUTPUT_DIR}/${name}/${MANIFEST_NAME}`;
}

function controlManifestPath(name) {
  return join(ROOT, OUTPUT_DIR, name, 'controller', CONTROL_MANIFEST_NAME);
}

function gateById(manifest, id) {
  return manifest.gates.find((gate) => gate.id === id);
}

function blockerCodes(manifest) {
  return manifest.blockers.map((blocker) => blocker.code).join('\n');
}

function writeAuthorizationRecord(path, reviewManifest, overrides = {}) {
  const reviewManifestRef = reviewManifest.outputs.manifest.path;
  const reviewCandidateRef = reviewManifest.generated_candidate.path;
  const sourceRef = reviewManifest.source_preflight.source.path;
  const auth = {
    schema_version: '1.0',
    record_type: 'stage5b_attachment_authorization',
    authorized_attachment: true,
    package_slug: reviewManifest.package_slug,
    review_manifest_ref: reviewManifestRef,
    source_preflight_ref: reviewManifest.outputs.source_preflight_report.path,
    reviewed_redacted_evidence_json_ref: reviewCandidateRef,
    reviewed_source_ref: sourceRef,
    candidate_gate_report_ref: reviewManifest.outputs.candidate_gate_report?.path || 'unknown',
    intake_report_ref: reviewManifest.downstream_steps.audit?.outputs?.intake_report?.path || 'unknown',
    promotion_dry_run_ref: reviewManifest.downstream_steps.audit?.outputs?.promotion_dry_run_manifest?.path || 'unknown',
    audit_output_ref: reviewManifest.outputs.audit_manifest?.path || 'unknown',
    human_authorizer: 'Fixture maintainer authorization',
    authorized_at: '2026-06-06T00:00:00Z',
    dry_run_controller_only: true,
    later_attachment_task_boundary: 'fixture-only Stage 5B attachment-controller validation; no canonical mutation allowed',
    redaction_review: {
      status: 'complete',
      reviewed_by: 'Fixture redaction reviewer',
      reviewed_at: '2026-06-06T00:01:00Z',
      private_paths_redacted: true,
      private_data_removed: true,
    },
    provenance_review: {
      status: 'complete',
      reviewed_by: 'Fixture provenance reviewer',
      reviewed_at: '2026-06-06T00:02:00Z',
    },
    package_mapping_review: {
      status: 'complete',
      reviewed_by: 'Fixture package mapping reviewer',
      reviewed_at: '2026-06-06T00:03:00Z',
    },
    intake_review: {
      status: 'complete',
      reviewed_by: 'Fixture intake reviewer',
      reviewed_at: '2026-06-06T00:04:00Z',
    },
    promotion_dry_run_review: {
      status: 'complete',
      reviewed_by: 'Fixture promotion dry-run reviewer',
      reviewed_at: '2026-06-06T00:05:00Z',
    },
    audit_review: {
      status: 'complete',
      reviewed_by: 'Fixture audit reviewer',
      reviewed_at: '2026-06-06T00:06:00Z',
    },
    approved_commands: [
      `fcad review-context --inspection-evidence ${reviewCandidateRef} --attachment-authorization ${path}`,
    ],
    readiness_held_acknowledgement: 'Canonical package readiness remains needs_more_evidence / hold_for_evidence_completion until a later authorized attachment task regenerates package artifacts.',
    evidence_boundary_acknowledgement: 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.',
    ...overrides,
  };
  writeJson(join(ROOT, path), auth);
  return auth;
}

function runReviewDryRun({ name, source, fixture = false }) {
  const args = [
    'stage5b-evidence-review-dry-run',
    '--package',
    PACKAGE_SLUG,
    '--out-dir',
    `${OUTPUT_DIR}/${name}`,
  ];
  if (source) {
    args.push('--source', source);
  }
  if (fixture) {
    args.push('--fixture');
  }
  runFcad(args, `${name} review dry-run`);
  return readJson(join(ROOT, reviewManifestPath(name)));
}

function runController({ name, reviewManifest, authorizationRecord, expectStatus = 0 }) {
  return runFcad([
    'stage5b-evidence-attachment-controller',
    '--review-manifest',
    reviewManifest,
    '--authorization-record',
    authorizationRecord,
    '--out-dir',
    `${OUTPUT_DIR}/${name}/controller`,
    '--dry-run',
  ], `${name} attachment controller`, { expectStatus });
}

function assertControllerHeld(manifest, expectedCode) {
  assert.equal(manifest.summary.attachment_control_status, 'hold_for_attachment_controller_blockers');
  assert.equal(manifest.summary.decision, 'hold');
  assert.equal(manifest.summary.evidence_attached, false);
  assert.equal(manifest.summary.canonical_readiness_regenerated, false);
  assert.equal(manifest.summary.readiness_status, 'needs_more_evidence');
  assert.equal(manifest.summary.readiness_gate_decision, 'hold_for_evidence_completion');
  assert.match(blockerCodes(manifest), expectedCode);
}

function assertControllerReadyDryRun(manifest) {
  assert.equal(manifest.summary.attachment_control_status, 'authorized_attachment_ready_dry_run');
  assert.equal(manifest.summary.decision, 'pass');
  assert.equal(manifest.summary.future_explicit_attachment_prerequisites_met, true);
  assert.equal(manifest.summary.evidence_attached, false);
  assert.equal(manifest.summary.canonical_artifacts_mutated, false);
  assert.equal(manifest.summary.canonical_readiness_regenerated, false);
  assert.equal(manifest.summary.packages_marked_ready, false);
  assert.equal(manifest.summary.readiness_status, 'needs_more_evidence');
  assert.equal(manifest.summary.readiness_gate_decision, 'hold_for_evidence_completion');
  assert.equal(gateById(manifest, 'review_manifest_from_stage5b_review_dry_run').status, 'pass');
  assert.equal(gateById(manifest, 'source_preflight_ready').status, 'pass');
  assert.equal(gateById(manifest, 'source_ignored_or_explicitly_safe').status, 'pass');
  assert.equal(gateById(manifest, 'candidate_json_redacted_package_scoped_provenance_complete').status, 'pass');
  assert.equal(gateById(manifest, 'authorization_record_scopes_attachment_attempt').status, 'pass');
  assert.equal(gateById(manifest, 'non_evidence_sources_rejected_as_real_evidence').status, 'pass');
  assert.equal(manifest.readiness_held_truth.readiness_remains_held, true);
  assert.equal(manifest.readiness_held_truth.canonical_readiness_regenerated, false);
  assert.equal(manifest.evidence_boundary.controller_does_not_attach_evidence, true);
  assert.equal(manifest.evidence_boundary.later_explicit_attachment_task_required, true);
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

try {
  const rawSource = `${INBOX_DIR}/received-valid-shaped-source.json`;
  writeJson(join(ROOT, rawSource), validRawSource());
  const validReview = runReviewDryRun({ name: 'valid-shaped-fixture', source: rawSource });
  const validAuthPath = `${OUTPUT_DIR}/valid-shaped-fixture/attachment-authorization.json`;
  writeAuthorizationRecord(validAuthPath, validReview);

  runController({
    name: 'valid-shaped-fixture',
    reviewManifest: reviewManifestPath('valid-shaped-fixture'),
    authorizationRecord: validAuthPath,
  });
  const validControl = readJson(controlManifestPath('valid-shaped-fixture'));
  assertControllerReadyDryRun(validControl);
  assertNoRawSourceCopied(`${OUTPUT_DIR}/valid-shaped-fixture/controller`);

  const missingManifestAuthPath = `${OUTPUT_DIR}/missing-manifest/attachment-authorization.json`;
  writeAuthorizationRecord(missingManifestAuthPath, validReview, {
    review_manifest_ref: 'output/missing/stage5b_evidence_review_dry_run_manifest.json',
  });
  runController({
    name: 'missing-manifest',
    reviewManifest: `${OUTPUT_DIR}/missing-manifest/does-not-exist.json`,
    authorizationRecord: missingManifestAuthPath,
    expectStatus: 2,
  });
  assertControllerHeld(readJson(controlManifestPath('missing-manifest')), /review_manifest_missing/);

  const missingSourceReview = runReviewDryRun({ name: 'missing-source' });
  const missingSourceAuthPath = `${OUTPUT_DIR}/missing-source/attachment-authorization.json`;
  writeAuthorizationRecord(missingSourceAuthPath, missingSourceReview, {
    reviewed_redacted_evidence_json_ref: 'unknown',
  });
  runController({
    name: 'missing-source',
    reviewManifest: reviewManifestPath('missing-source'),
    authorizationRecord: missingSourceAuthPath,
    expectStatus: 2,
  });
  assertControllerHeld(readJson(controlManifestPath('missing-source')), /source_preflight_not_ready|source_missing/);

  runController({
    name: 'missing-authorization',
    reviewManifest: reviewManifestPath('valid-shaped-fixture'),
    authorizationRecord: `${OUTPUT_DIR}/missing-authorization/missing-auth.json`,
    expectStatus: 2,
  });
  assertControllerHeld(readJson(controlManifestPath('missing-authorization')), /authorization_record_missing/);

  const unsafeCandidateReview = structuredClone(validReview);
  const unsafeCandidatePath = join(ROOT, unsafeCandidateReview.generated_candidate.path);
  const unsafeCandidate = readJson(unsafeCandidatePath);
  unsafeCandidate.inspector = 'qa.inspector@example.com';
  unsafeCandidate.source_ref = 'https://10.0.0.5/private/report?token=secret-token';
  unsafeCandidate.notes = 'Unredacted absolute local path /Users/qa/private/report.xlsx and Authorization: Bearer abc123';
  const unsafeCandidateCopy = `${OUTPUT_DIR}/unsafe-candidate/${MANIFEST_NAME}`;
  mkdirSync(join(ROOT, OUTPUT_DIR, 'unsafe-candidate'), { recursive: true });
  const unsafeCandidateJsonPath = `${OUTPUT_DIR}/unsafe-candidate/stage5b_review_candidate.redacted.json`;
  writeJson(join(ROOT, unsafeCandidateJsonPath), unsafeCandidate);
  unsafeCandidateReview.generated_candidate.path = unsafeCandidateJsonPath;
  unsafeCandidateReview.outputs.review_candidate.path = unsafeCandidateJsonPath;
  unsafeCandidateReview.outputs.manifest.path = unsafeCandidateCopy;
  writeJson(join(ROOT, unsafeCandidateCopy), unsafeCandidateReview);
  const unsafeAuthPath = `${OUTPUT_DIR}/unsafe-candidate/attachment-authorization.json`;
  writeAuthorizationRecord(unsafeAuthPath, unsafeCandidateReview);
  runController({
    name: 'unsafe-candidate',
    reviewManifest: unsafeCandidateCopy,
    authorizationRecord: unsafeAuthPath,
    expectStatus: 2,
  });
  assertControllerHeld(
    readJson(controlManifestPath('unsafe-candidate')),
    /candidate_private_url|candidate_token_or_secret|candidate_pii|candidate_absolute_path/
  );

  const rejectedInputs = [
    {
      name: 'surrogate-source',
      source: `${INBOX_DIR}/surrogate_inspection_validation.json`,
      write() {
        writeJson(join(ROOT, this.source), {
          artifact_type: 'surrogate_inspection_validation',
          notes: 'Synthetic surrogate non-evidence generated from CAD/spec values.',
        });
      },
      expected: /surrogate_artifact_not_evidence/,
    },
    {
      name: 'synthetic-source',
      source: `${INBOX_DIR}/synthetic-fixture-source.json`,
      write() {
        writeJson(join(ROOT, this.source), validRawSource({
          raw_supplier_internal_note: undefined,
          notes: 'Synthetic fixture generated for automation only, not readiness evidence.',
        }));
      },
      expected: /synthetic_or_generated_not_evidence/,
    },
    {
      name: 'generated-quality-source',
      source: 'docs/examples/quality-pass-bracket/quality/quality_pass_bracket_create_quality.json',
      expected: /cad_or_generated_values_not_evidence|tracked_source_file/,
    },
    {
      name: 'cad-source',
      source: 'docs/examples/quality-pass-bracket/cad/quality_pass_bracket.step',
      expected: /cad_or_generated_values_not_evidence|unsupported_source_format|tracked_source_file/,
    },
    {
      name: 'docs-source',
      source: 'docs/stage-5b-operational-runbook.md',
      expected: /docs_or_collection_guide_not_evidence|unsupported_source_format|tracked_source_file/,
    },
    {
      name: 'ci-source',
      source: '.github/workflows/automation-ci.yml',
      expected: /ci_artifact_not_evidence|unsupported_source_format|tracked_source_file/,
    },
    {
      name: 'readiness-source',
      source: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
      expected: /readiness_artifact_not_evidence|tracked_source_file/,
    },
    {
      name: 'spec-source',
      source: 'schemas/inspection-evidence.schema.json',
      expected: /schema_not_evidence|tracked_source_file/,
    },
  ];

  for (const testCase of rejectedInputs) {
    testCase.write?.();
    const review = runReviewDryRun({ name: testCase.name, source: testCase.source });
    const authPath = `${OUTPUT_DIR}/${testCase.name}/attachment-authorization.json`;
    writeAuthorizationRecord(authPath, review, {
      reviewed_redacted_evidence_json_ref: review.generated_candidate.path || 'unknown',
    });
    runController({
      name: testCase.name,
      reviewManifest: reviewManifestPath(testCase.name),
      authorizationRecord: authPath,
      expectStatus: 2,
    });
    const control = readJson(controlManifestPath(testCase.name));
    assertControllerHeld(control, testCase.expected);
    assert.match(blockerCodes(control), /source_preflight_not_ready|source_boundary_rejected/);
  }

  const canonicalFilesAfter = trackedDocsExampleFiles();
  const canonicalStatusAfter = docsExamplesStatus();
  assert.deepEqual(canonicalFilesAfter, canonicalFiles, 'attachment controller must not add or remove tracked docs/examples files');
  assert.equal(canonicalStatusAfter, canonicalStatusBefore, 'attachment controller must not change docs/examples git status');
  assert.equal(runGit(['status', '--short', '--', 'local/stage5b-candidate-evidence-inbox']).trim(), '');
  assert.equal(runGit(['status', '--short', '--', OUTPUT_DIR]).trim(), '');
} finally {
  rmSync(join(ROOT, OUTPUT_DIR), { recursive: true, force: true });
  rmSync(join(ROOT, INBOX_DIR), { recursive: true, force: true });
}

console.log('stage5b-evidence-attachment-controller.test.js: ok');
