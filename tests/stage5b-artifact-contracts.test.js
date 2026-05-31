import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { writeStage5bEvidenceAuditBundle } from '../src/services/inspection-evidence-intake/stage5b-evidence-audit-service.js';
import {
  validateStage5bArtifact,
  validateStage5bAuditManifest,
  validateStage5bAuditSummaryMarkdown,
  validateStage5bIntakeReport,
  validateStage5bPromotionDryRunManifest,
} from '../lib/stage5b-artifact-contracts.js';

const ROOT = resolve(import.meta.dirname, '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertPasses(label, validation) {
  assert.equal(validation.ok, true, `${label} should pass:\n${validation.errors.join('\n')}`);
}

function assertFails(label, validation, pattern) {
  assert.equal(validation.ok, false, `${label} should fail`);
  assert.match(validation.errors.join('\n'), pattern, `${label} should explain the contract failure`);
}

const tempRoot = mkdtempSync(join(ROOT, 'tmp/codex/stage5b-contracts-'));

try {
  const result = await writeStage5bEvidenceAuditBundle({
    projectRoot: ROOT,
    outDir: tempRoot,
    packageSlugs: ['quality-pass-bracket'],
    includeGitHub: false,
    generatedAt: '2026-05-24T00:00:00.000Z',
  });

  const intakePath = join(tempRoot, 'intake_report.json');
  const dryRunPath = join(tempRoot, 'promotion_dry_run_manifest.json');
  const auditManifestPath = join(tempRoot, 'stage5b_audit_manifest.json');
  const auditSummaryPath = join(tempRoot, 'stage5b_audit_summary.md');

  assert.equal(existsSync(intakePath), true);
  assert.equal(existsSync(dryRunPath), true);
  assert.equal(existsSync(auditManifestPath), true);
  assert.equal(existsSync(auditSummaryPath), true);

  const intake = readJson(intakePath);
  const dryRun = readJson(dryRunPath);
  const audit = readJson(auditManifestPath);
  const summaryMarkdown = readFileSync(auditSummaryPath, 'utf8');

  assertPasses('generated intake_report.json', validateStage5bIntakeReport(intake));
  assertPasses('generated promotion_dry_run_manifest.json', validateStage5bPromotionDryRunManifest(dryRun));
  assertPasses('generated stage5b_audit_manifest.json', validateStage5bAuditManifest(audit));
  assertPasses('generated audit summary markdown', validateStage5bAuditSummaryMarkdown(summaryMarkdown));
  assertPasses('artifact dispatcher for intake', validateStage5bArtifact(intake));
  assertPasses('artifact dispatcher for dry-run', validateStage5bArtifact(dryRun));
  assertPasses('artifact dispatcher for audit', validateStage5bArtifact(audit));

  assert.equal(result.manifest.summary.genuine_inspection_evidence_found, false);
  assert.equal(audit.summary.genuine_inspection_evidence_found, false);
  assert.equal(audit.summary.promotion_can_run, false);
  assert.equal(audit.summary.readiness_remains_held, true);
  assert.equal(audit.readiness_held_truth.no_genuine_completed_inspection_evidence_found, true);
  assert.equal(audit.evidence_boundary.generated_artifacts_do_not_satisfy_inspection_evidence, true);

  const missingSummary = clone(audit);
  delete missingSummary.summary;
  assertFails(
    'missing required summary',
    validateStage5bAuditManifest(missingSummary),
    /summary|required/i
  );

  const unsafeOutputPath = clone(audit);
  unsafeOutputPath.outputs.intake_report.path = '../outside/intake_report.json';
  assertFails(
    'unsafe audit output reference',
    validateStage5bAuditManifest(unsafeOutputPath),
    /safe repo-relative path|outputs\.intake_report\.path/i
  );

  const fakePromotion = clone(dryRun);
  fakePromotion.summary.genuine_inspection_evidence_found = false;
  fakePromotion.summary.ready_package_count = 1;
  fakePromotion.summary.promotion_can_run = true;
  fakePromotion.packages[0].promotion_status = 'ready_for_future_promotion_dry_run';
  fakePromotion.packages[0].blockers = [];
  assertFails(
    'fake readiness promotion without genuine evidence',
    validateStage5bPromotionDryRunManifest(fakePromotion),
    /promotion_can_run|genuine inspection evidence/i
  );

  const generatedEvidenceLeak = clone(intake);
  generatedEvidenceLeak.accepted_candidates = [{
    path: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
    source_kind: 'tracked_repo_file',
    source_format: 'json',
    classification: 'genuine_valid',
    matched_package: 'quality-pass-bracket',
    match_confidence: 'high',
    attachment_ready: true,
    blockers: [],
    normalized_source_ref: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
    attachment_plan: {
      matched_package: 'quality-pass-bracket',
      match_confidence: 'high',
      candidate_package_matches: [{ slug: 'quality-pass-bracket', score: 100, match_signals: ['source_ref_package_inspection_dir'] }],
      matched_features: [],
      unmatched_features: [],
      missing_required_features: [],
      attachment_ready: true,
      blockers: [],
      canonical_next_command: [
        'fcad',
        'review-context',
        '--inspection-evidence',
        'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
      ],
    },
  }];
  generatedEvidenceLeak.summary.accepted_candidate_count = 1;
  generatedEvidenceLeak.summary.attachment_ready_candidate_count = 1;
  generatedEvidenceLeak.summary.genuine_inspection_evidence_found = true;
  assertFails(
    'generated readiness report claimed as evidence',
    validateStage5bIntakeReport(generatedEvidenceLeak),
    /generated artifact|not inspection evidence/i
  );

  const malformedAttachmentPlan = clone(intake);
  malformedAttachmentPlan.packages[0].attachment_plan = {
    matched_package: 'quality-pass-bracket',
    match_confidence: 'certain',
    attachment_ready: true,
    blockers: ['missing_explicit_provenance'],
    canonical_next_command: ['fcad', 'review-context', '--inspection-evidence', '/tmp/fake.json'],
  };
  assertFails(
    'malformed attachment plan',
    validateStage5bIntakeReport(malformedAttachmentPlan),
    /match_confidence|attachment_ready|canonical_next_command|safe repo-relative path/i
  );

  const auditOverclaim = clone(audit);
  auditOverclaim.summary.genuine_inspection_evidence_found = false;
  auditOverclaim.summary.promotion_can_run = true;
  auditOverclaim.summary.readiness_remains_held = false;
  auditOverclaim.readiness_held_truth.no_genuine_completed_inspection_evidence_found = true;
  auditOverclaim.readiness_held_truth.no_promotion_can_run = false;
  assertFails(
    'audit readiness overclaim',
    validateStage5bAuditManifest(auditOverclaim),
    /readiness_remains_held|promotion_can_run|no genuine/i
  );

  const malformedAuditAttachmentCandidate = clone(audit);
  malformedAuditAttachmentCandidate.attachment_ready = {
    count: 1,
    candidates: [
      {
        path: 'docs/examples/quality-pass-bracket/inspection/inspection_evidence.json',
        source_kind: 'tracked_repo_file',
        source_format: 'json',
        matched_package: 'quality-pass-bracket',
        match_confidence: 'certain',
        fixture_or_test_source: false,
      },
    ],
  };
  assertFails(
    'audit attachment-ready confidence contract',
    validateStage5bAuditManifest(malformedAuditAttachmentCandidate),
    /match_confidence|allowed value|enum/i
  );

  assertFails(
    'summary markdown wording missing boundary',
    validateStage5bAuditSummaryMarkdown(summaryMarkdown.replace(/Readiness remains held: yes/i, 'Readiness complete: yes')),
    /Readiness remains held|Evidence Boundary/i
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('stage5b-artifact-contracts.test.js: ok');
