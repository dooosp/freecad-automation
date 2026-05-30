import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { discoverInspectionEvidenceIntake } from '../src/services/inspection-evidence-intake/inspection-evidence-intake-service.js';
import { writeInspectionEvidencePromotionDryRunManifest } from '../src/services/inspection-evidence-intake/promotion-dry-run-service.js';
import { writeStage5bEvidenceAuditBundle } from '../src/services/inspection-evidence-intake/stage5b-evidence-audit-service.js';
import { createJobExecutor } from '../src/services/jobs/job-executor.js';
import { createJobStore } from '../src/services/jobs/job-store.js';
import {
  assertValidStage5bAuditManifest,
  assertValidStage5bArtifact,
  assertValidStage5bIntakeReport,
  assertValidStage5bPromotionDryRunManifest,
} from '../src/services/inspection-evidence-intake/stage5b-runtime-validation.js';

const ROOT = resolve(import.meta.dirname, '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureValidationFailure(label, fn, pattern) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.name, 'Stage5bRuntimeValidationError');
    assert.match(error.message, pattern, label);
    return error;
  }
  assert.fail(`${label} should fail validation`);
}

async function captureValidationRejection(label, fn, pattern) {
  try {
    await fn();
  } catch (error) {
    assert.equal(error.name, 'Stage5bRuntimeValidationError');
    assert.match(error.message, pattern, label);
    return error;
  }
  assert.fail(`${label} should reject validation`);
}

function diagnosticsFrom(error) {
  assert.equal(Array.isArray(error.diagnostics), true, 'validation error should expose diagnostics');
  assert.equal(error.diagnostics.length > 0, true, 'validation error should contain at least one diagnostic');
  return error.diagnostics;
}

function assertDiagnosticShape(diagnostic) {
  [
    'artifact_type',
    'artifact_path',
    'validation_stage',
    'severity',
    'code',
    'message',
    'json_pointer',
    'remediation',
    'evidence_boundary_note',
    'safe_source_ref',
  ].forEach((field) => {
    assert.equal(Object.hasOwn(diagnostic, field), true, `diagnostic should include ${field}`);
  });
  assert.equal(diagnostic.severity, 'error');
  assert.match(diagnostic.code, /^stage5b\./);
  assert.match(diagnostic.evidence_boundary_note, /Only genuine completed physical\/supplier\/lab\/QA inspection records/);
}

function assertNoSecretOrAbsolutePath(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes(ROOT), false, 'diagnostics must not leak the repo absolute path');
  assert.equal(/gho_[A-Za-z0-9_]+/.test(text), false, 'diagnostics must not leak GitHub tokens');
  assert.equal(/authorization/i.test(text), false, 'diagnostics must not leak authorization headers');
}

const tempRoot = mkdtempSync(join(ROOT, 'tmp/codex/stage5b-runtime-validation-'));

try {
  const generatedAt = '2026-05-24T00:00:00.000Z';
  const intake = await discoverInspectionEvidenceIntake({
    projectRoot: ROOT,
    packageSlugs: ['quality-pass-bracket'],
    includeGitHub: false,
    generatedAt,
  });
  assertValidStage5bIntakeReport(intake, { label: 'generated intake report' });
  assertValidStage5bArtifact(intake, { label: 'generated intake report dispatcher' });

  const dryRunPath = join(tempRoot, 'promotion_dry_run_manifest.json');
  const dryRunResult = await writeInspectionEvidencePromotionDryRunManifest({
    projectRoot: ROOT,
    intakeReport: intake,
    intakeReportPath: join(tempRoot, 'intake_report.json'),
    outputPath: dryRunPath,
    generatedAt,
  });
  assertValidStage5bPromotionDryRunManifest(dryRunResult.manifest, { label: 'generated promotion dry-run manifest' });
  assertValidStage5bArtifact(readJson(dryRunPath), { label: 'written promotion dry-run manifest' });

  const auditDir = join(tempRoot, 'audit');
  const auditResult = await writeStage5bEvidenceAuditBundle({
    projectRoot: ROOT,
    outDir: auditDir,
    packageSlugs: ['quality-pass-bracket'],
    includeGitHub: false,
    generatedAt,
  });
  const auditManifest = readJson(join(auditDir, 'stage5b_audit_manifest.json'));
  assertValidStage5bAuditManifest(auditResult.manifest, { label: 'generated audit manifest' });
  assertValidStage5bArtifact(auditManifest, { label: 'written audit manifest' });
  assert.equal(auditManifest.summary.genuine_inspection_evidence_found, false);
  assert.equal(auditManifest.summary.promotion_can_run, false);
  assert.equal(auditManifest.summary.readiness_remains_held, true);
  assert.equal(auditManifest.readiness_held_truth.no_genuine_completed_inspection_evidence_found, true);

  const malformedError = captureValidationFailure(
    'malformed intake report fails clearly',
    () => assertValidStage5bIntakeReport({
      artifact_type: 'inspection_evidence_intake_report',
      schema_version: '1.0',
    }, { label: 'malformed intake report' }),
    /Invalid Stage 5B malformed intake report.*summary.*required/is
  );
  const malformedDiagnostics = diagnosticsFrom(malformedError);
  assertDiagnosticShape(malformedDiagnostics[0]);
  assert.equal(malformedDiagnostics[0].artifact_type, 'inspection_evidence_intake_report');
  assert.equal(malformedDiagnostics[0].validation_stage, 'schema');
  assert.equal(malformedDiagnostics.some((diagnostic) => /^\/summary/.test(diagnostic.json_pointer)), true);
  assert.match(malformedDiagnostics[0].remediation, /required field|schema/i);

  const unsafeIntake = clone(intake);
  unsafeIntake.rejected_candidates.push({
    path: '../outside/inspection_evidence.json',
    source_kind: 'tracked_repo_file',
    source_format: 'json',
    classification: 'invalid_provenance',
    normalized_source_ref: '/private/tmp/inspection_evidence.json',
    attachment_plan: {
      matched_package: null,
      match_confidence: 'none',
      candidate_package_matches: [],
      matched_features: [],
      unmatched_features: [],
      missing_required_features: [],
      attachment_ready: false,
      blockers: ['missing_explicit_provenance'],
      canonical_next_command: null,
    },
  });
  unsafeIntake.summary.rejected_candidate_count += 1;
  const unsafeError = captureValidationFailure(
    'unsafe path and provenance fail',
    () => assertValidStage5bIntakeReport(unsafeIntake, { label: 'unsafe intake report' }),
    /safe repo-relative path|sanitized public URL/i
  );
  const unsafeDiagnostics = diagnosticsFrom(unsafeError);
  const unsafePathDiagnostic = unsafeDiagnostics.find((diagnostic) => diagnostic.code === 'stage5b.unsafe_path');
  const unsafeSourceDiagnostic = unsafeDiagnostics.find((diagnostic) => diagnostic.code === 'stage5b.unsafe_source_ref');
  assertDiagnosticShape(unsafePathDiagnostic);
  assertDiagnosticShape(unsafeSourceDiagnostic);
  assert.equal(unsafeSourceDiagnostic.safe_source_ref, null);
  assert.match(unsafeSourceDiagnostic.remediation, /repo-relative path or sanitized public URL/i);
  assertNoSecretOrAbsolutePath(unsafeDiagnostics);

  const fakePromotion = clone(dryRunResult.manifest);
  fakePromotion.summary.genuine_inspection_evidence_found = false;
  fakePromotion.summary.ready_package_count = 1;
  fakePromotion.summary.blocked_package_count = fakePromotion.packages.length - 1;
  fakePromotion.summary.promotion_can_run = true;
  fakePromotion.packages[0].promotion_status = 'ready_for_future_promotion_dry_run';
  fakePromotion.packages[0].blockers = [];
  const fakePromotionError = captureValidationFailure(
    'fake readiness promotion fails',
    () => assertValidStage5bPromotionDryRunManifest(fakePromotion, { label: 'fake promotion manifest' }),
    /promotion_can_run.*genuine inspection evidence|ready_package_count/i
  );
  assert.equal(
    diagnosticsFrom(fakePromotionError).some((diagnostic) => diagnostic.code === 'stage5b.readiness_overclaim'),
    true,
    'fake promotion should emit an overclaim diagnostic'
  );

  const generatedEvidenceLeak = clone(intake);
  generatedEvidenceLeak.accepted_candidates = [{
    path: 'output/stage5b/intake_report.json',
    source_kind: 'tracked_repo_file',
    source_format: 'json',
    classification: 'genuine_valid',
    matched_package: 'quality-pass-bracket',
    match_confidence: 'high',
    attachment_ready: true,
    blockers: [],
    normalized_source_ref: 'output/stage5b/intake_report.json',
    attachment_plan: {
      matched_package: 'quality-pass-bracket',
      match_confidence: 'high',
      candidate_package_matches: [{ slug: 'quality-pass-bracket', score: 100, match_signals: ['test_generated_control_artifact'] }],
      matched_features: [],
      unmatched_features: [],
      missing_required_features: [],
      attachment_ready: true,
      blockers: [],
      canonical_next_command: [
        'fcad',
        'review-context',
        '--inspection-evidence',
        'output/stage5b/intake_report.json',
      ],
    },
  }];
  generatedEvidenceLeak.summary.accepted_candidate_count = 1;
  generatedEvidenceLeak.summary.attachment_ready_candidate_count = 1;
  generatedEvidenceLeak.summary.genuine_inspection_evidence_found = true;
  const generatedLeakError = captureValidationFailure(
    'generated control artifact cannot become inspection evidence',
    () => assertValidStage5bIntakeReport(generatedEvidenceLeak, { label: 'generated control evidence leak' }),
    /control file|generated artifact|not inspection evidence/i
  );
  assert.equal(
    diagnosticsFrom(generatedLeakError).some((diagnostic) => diagnostic.code === 'stage5b.generated_control_artifact_not_evidence'),
    true,
    'generated control artifacts should get an explicit non-evidence diagnostic'
  );

  const malformedReportPath = join(tempRoot, 'malformed-intake.json');
  writeJson(malformedReportPath, unsafeIntake);
  const writerError = await captureValidationRejection(
    'runtime writer rejects malformed intake input',
    () => writeInspectionEvidencePromotionDryRunManifest({
      projectRoot: ROOT,
      intakeReport: unsafeIntake,
      intakeReportPath: malformedReportPath,
      outputPath: join(tempRoot, 'should-not-write.json'),
      generatedAt,
    }),
    /Invalid Stage 5B source intake report/i
  );
  assert.equal(diagnosticsFrom(writerError).some((diagnostic) => diagnostic.validation_stage === 'semantic'), true);

  const noEvidenceValidation = assertValidStage5bAuditManifest(auditResult.manifest, { label: 'no-evidence held audit manifest' });
  assert.deepEqual(noEvidenceValidation.diagnostics, [], 'held no-evidence audit manifests should pass without diagnostics');

  const cliOutputDir = join(tempRoot, 'cli-failure');
  mkdirSync(cliOutputDir, { recursive: true });
  const cliDiagnosticsPath = join(cliOutputDir, 'validation_diagnostics.json');
  const cliResult = spawnSync(process.execPath, [
    'bin/fcad.js',
    'inspection-evidence-promotion-dry-run',
    '--intake-report',
    relative(ROOT, malformedReportPath),
    '--out',
    relative(ROOT, join(cliOutputDir, 'promotion_dry_run_manifest.json')),
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.notEqual(cliResult.status, 0, 'malformed CLI promotion dry-run should fail');
  assert.match(cliResult.stderr, /Stage 5B validation failed/i);
  assert.match(cliResult.stderr, /validation_diagnostics\.json/);
  assert.equal(existsSync(cliDiagnosticsPath), true, 'CLI should write validation_diagnostics.json beside requested output');
  const cliDiagnostics = readJson(cliDiagnosticsPath);
  assert.equal(cliDiagnostics.artifact_type, 'inspection_evidence_intake_report');
  assert.equal(Array.isArray(cliDiagnostics.diagnostics), true);
  assertDiagnosticShape(cliDiagnostics.diagnostics[0]);
  assertNoSecretOrAbsolutePath(cliDiagnostics);

  const jobReportPath = join(tempRoot, 'job-malformed-intake.json');
  writeJson(jobReportPath, unsafeIntake);
  const jobStore = createJobStore({ jobsDir: join(tempRoot, 'jobs') });
  const executor = createJobExecutor({ projectRoot: ROOT, jobStore });
  const job = await jobStore.createJob({
    type: 'inspection-evidence-promotion-dry-run',
    intake_report_path: relative(ROOT, jobReportPath),
  });
  await executor.execute(job.id);
  const failedJob = await jobStore.getJob(job.id);
  assert.equal(failedJob.status, 'failed');
  assert.equal(failedJob.diagnostics.stage5b_validation_diagnostics.artifact_type, 'inspection_evidence_intake_report');
  assert.equal(Array.isArray(failedJob.diagnostics.stage5b_validation_diagnostics.diagnostics), true);
  assertDiagnosticShape(failedJob.diagnostics.stage5b_validation_diagnostics.diagnostics[0]);
  assertNoSecretOrAbsolutePath(failedJob.diagnostics.stage5b_validation_diagnostics);
  assert.equal(existsSync(failedJob.artifacts.stage5b_validation_diagnostics), true);
  const jobArtifacts = await jobStore.listArtifacts(job.id);
  const diagnosticsArtifact = jobArtifacts.find((artifact) => artifact.type === 'stage5b.validation-diagnostics');
  assert.equal(Boolean(diagnosticsArtifact), true, 'failed tracked jobs should register validation diagnostics artifacts');
  assert.equal(diagnosticsArtifact.file_name, 'validation_diagnostics.json');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('stage5b-runtime-validation.test.js: ok');
