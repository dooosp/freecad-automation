import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { writeStage5bEvidenceAuditBundle } from '../src/services/inspection-evidence-intake/stage5b-evidence-audit-service.js';
import {
  validateStage5bArtifact,
  validateStage5bAuditManifest,
  validateStage5bEvidencePipelineDoctorManifest,
  validateStage5bAuditSummaryMarkdown,
  validateStage5bIntakeReport,
  validateStage5bPromotionDryRunManifest,
} from '../lib/stage5b-artifact-contracts.js';

const ROOT = resolve(import.meta.dirname, '..');
const HARD_EVIDENCE_RULE = 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.';

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

const tempParent = join(ROOT, 'tmp/codex');
mkdirSync(tempParent, { recursive: true });
const tempRoot = mkdtempSync(join(tempParent, 'stage5b-contracts-'));

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

  const pipelineDoctor = {
    artifact_type: 'stage5b_evidence_pipeline_doctor_manifest',
    schema_version: '1.0',
    generated_at: '2026-05-24T00:00:00.000Z',
    dry_run: true,
    fixture_only: true,
    non_mutating: true,
    package_slug: 'quality-pass-bracket',
    repo_preflight: {
      repo_root_basename: 'freecad-automation',
      repo_identity_ok: true,
      current_branch: 'codex/test',
      head_sha: 'abc123',
      remote_default_head: 'origin/master',
      dirty_tree: false,
      checkout_safety: {},
    },
    command_contract: {
      required_commands: ['stage5b-evidence-pipeline-doctor'],
      entries: [],
    },
    commands_run: [
      {
        name: 'stage5b-evidence-attachment-controller',
        command: ['fcad', 'stage5b-evidence-attachment-controller', '--review-manifest', 'output/stage5b-review/stage5b_evidence_review_dry_run_manifest.json', '--out-dir', 'output/stage5b-controller', '--dry-run'],
        expected_status: 2,
        actual_status: 2,
        status: 'expected_hold',
        accepted_as_fail_closed: true,
        mutates_canonical_artifacts: false,
      },
    ],
    artifacts: [],
    schemas: [{ path: 'schemas/stage5b-evidence-pipeline-doctor-manifest.schema.json', exists: true }],
    artifact_catalog: {
      required_ids: ['stage5b_evidence_pipeline_doctor_manifest'],
      present_ids: ['stage5b_evidence_pipeline_doctor_manifest'],
      missing_ids: [],
    },
    docs_runbook: [],
    npm_scripts: {},
    ci_workflows: [],
    readiness_packages: [
      {
        slug: 'quality-pass-bracket',
        path: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
        exists: true,
        status: 'needs_more_evidence',
        gate_decision: 'hold_for_evidence_completion',
        missing_inputs: ['inspection_evidence'],
        readiness_remains_held: true,
      },
    ],
    non_evidence_guards: [
      {
        kind: 'readiness',
        source: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
        classification: 'unsafe_or_not_evidence',
        canonical_evidence_eligible: false,
        evidence_attached: false,
        report_path: 'output/stage5b-doctor/non-evidence-guards/readiness.json',
      },
    ],
    raw_private_copy_guard: {
      marker_copied_to_output: false,
      raw_inbox_tracked: false,
    },
    blockers: [],
    next_human_step: {
      required: true,
      instructions: 'Later, after a genuine completed physical/supplier/lab/QA inspection record is received, start a separate explicit real attachment/regeneration goal.',
      canonical_attachment_allowed_now: false,
      canonical_readiness_regeneration_allowed_now: false,
    },
    evidence_boundary: {
      hard_evidence_rule: HARD_EVIDENCE_RULE,
      pipeline_doctor_does_not_attach_evidence: true,
      pipeline_doctor_does_not_promote_evidence: true,
      pipeline_doctor_does_not_regenerate_readiness: true,
      pipeline_doctor_does_not_mark_packages_ready: true,
      later_explicit_real_attachment_regeneration_goal_required: true,
      fixture_surrogate_generated_docs_ci_readiness_cad_are_not_evidence: true,
      rejected_as_real_evidence: [
        'generated artifacts',
        'fixtures',
        'templates',
        'collection guides',
        'release bundles',
        'intake reports',
        'dry-run manifests',
        'audit manifests',
      ],
    },
    readiness_held_truth: {
      readiness_remains_held: true,
      status: 'needs_more_evidence',
      gate_decision: 'hold_for_evidence_completion',
      canonical_readiness_regenerated: false,
      canonical_artifacts_mutated: false,
      packages_marked_ready: false,
    },
    summary: {
      pipeline_status: 'pass_fixture_only_readiness_held',
      decision: 'pass',
      blocker_count: 0,
      fixture_only: true,
      evidence_attached: false,
      canonical_artifacts_mutated: false,
      canonical_readiness_regenerated: false,
      packages_marked_ready: false,
      readiness_status: 'needs_more_evidence',
      readiness_gate_decision: 'hold_for_evidence_completion',
      readiness_remains_held: true,
      attachment_controller_fail_closed_proven: true,
      next_human_step: 'Later, after a genuine completed physical/supplier/lab/QA inspection record is received, start a separate explicit real attachment/regeneration goal.',
    },
    outputs: {
      manifest: {
        path: 'output/stage5b-doctor/stage5b_evidence_pipeline_doctor_manifest.json',
        artifact_type: 'stage5b_evidence_pipeline_doctor_manifest',
        sha256: null,
      },
    },
  };
  assertPasses('fixture pipeline doctor manifest', validateStage5bEvidencePipelineDoctorManifest(pipelineDoctor));
  assertPasses('artifact dispatcher for pipeline doctor', validateStage5bArtifact(pipelineDoctor));

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

  const doctorOverclaim = clone(pipelineDoctor);
  doctorOverclaim.summary.readiness_status = 'ready';
  doctorOverclaim.summary.attachment_controller_fail_closed_proven = false;
  assertFails(
    'pipeline doctor readiness overclaim',
    validateStage5bEvidencePipelineDoctorManifest(doctorOverclaim),
    /needs_more_evidence|fail_closed/i
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
