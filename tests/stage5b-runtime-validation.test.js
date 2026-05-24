import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { discoverInspectionEvidenceIntake } from '../src/services/inspection-evidence-intake/inspection-evidence-intake-service.js';
import { writeInspectionEvidencePromotionDryRunManifest } from '../src/services/inspection-evidence-intake/promotion-dry-run-service.js';
import { writeStage5bEvidenceAuditBundle } from '../src/services/inspection-evidence-intake/stage5b-evidence-audit-service.js';
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

function assertValidationFails(label, fn, pattern) {
  assert.throws(
    fn,
    (error) => {
      assert.equal(error.name, 'Stage5bRuntimeValidationError');
      assert.match(error.message, pattern, label);
      return true;
    },
    label
  );
}

async function assertValidationRejects(label, fn, pattern) {
  await assert.rejects(
    fn,
    (error) => {
      assert.equal(error.name, 'Stage5bRuntimeValidationError');
      assert.match(error.message, pattern, label);
      return true;
    },
    label
  );
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

  assertValidationFails(
    'malformed intake report fails clearly',
    () => assertValidStage5bIntakeReport({
      artifact_type: 'inspection_evidence_intake_report',
      schema_version: '1.0',
    }, { label: 'malformed intake report' }),
    /Invalid Stage 5B malformed intake report.*summary.*required/is
  );

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
  assertValidationFails(
    'unsafe path and provenance fail',
    () => assertValidStage5bIntakeReport(unsafeIntake, { label: 'unsafe intake report' }),
    /safe repo-relative path|sanitized public URL/i
  );

  const fakePromotion = clone(dryRunResult.manifest);
  fakePromotion.summary.genuine_inspection_evidence_found = false;
  fakePromotion.summary.ready_package_count = 1;
  fakePromotion.summary.blocked_package_count = fakePromotion.packages.length - 1;
  fakePromotion.summary.promotion_can_run = true;
  fakePromotion.packages[0].promotion_status = 'ready_for_future_promotion_dry_run';
  fakePromotion.packages[0].blockers = [];
  assertValidationFails(
    'fake readiness promotion fails',
    () => assertValidStage5bPromotionDryRunManifest(fakePromotion, { label: 'fake promotion manifest' }),
    /promotion_can_run.*genuine inspection evidence|ready_package_count/i
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
  assertValidationFails(
    'generated control artifact cannot become inspection evidence',
    () => assertValidStage5bIntakeReport(generatedEvidenceLeak, { label: 'generated control evidence leak' }),
    /control file|generated artifact|not inspection evidence/i
  );

  const malformedReportPath = join(tempRoot, 'malformed-intake.json');
  writeJson(malformedReportPath, unsafeIntake);
  await assertValidationRejects(
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
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('stage5b-runtime-validation.test.js: ok');
