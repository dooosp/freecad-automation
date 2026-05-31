import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  evaluateStage5bCandidateEvidence,
  evaluateStage5bCandidateEvidenceFile,
  STAGE5B_CANDIDATE_HARD_EVIDENCE_RULE,
  STAGE5B_CANDIDATE_GATE_PASSING_MEANING,
} from '../lib/stage5b-candidate-evidence-gate.js';
import {
  validateStage5bArtifact,
  validateStage5bCandidateGateReport,
} from '../lib/stage5b-artifact-contracts.js';

const ROOT = resolve(import.meta.dirname, '..');
const LOCAL_INBOX_ROOT = 'local/stage5b-candidate-evidence-inbox';

function writeText(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, value, 'utf8');
}

function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assertGitIgnored(path, label) {
  const result = spawnSync('git', ['check-ignore', '--quiet', path], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${label} should be ignored by git: ${result.stderr || result.stdout}`);
}

function validCandidate(overrides = {}) {
  return {
    schema_version: '1.0',
    evidence_type: 'inspection_evidence',
    source_type: 'supplier_inspection_report',
    package_id: 'candidate-gate-bracket',
    inspected_part: 'CANDIDATE-GATE-BRACKET',
    part_revision: 'A',
    inspected_at: '2026-05-21T08:00:00Z',
    inspection_status: 'completed',
    inspector: 'Supplier QA inspector 42',
    reviewed_by: 'Maintainer QA reviewer',
    measurement_system: 'metric',
    units: 'mm',
    source_ref: 'docs/examples/candidate-gate-bracket/inspection/supplier-final-inspection.json',
    measured_features: [
      {
        feature_id: 'mount_hole_a_diameter',
        drawing_ref: 'CGB-DWG-001:A',
        requirement_ref: 'MOUNT_HOLE_A_DIA',
        nominal_value: 8,
        measured_value: 8.01,
        tolerance_upper: 0.05,
        tolerance_lower: -0.05,
        units: 'mm',
        result: 'pass',
        measurement_method: 'supplier_cmm',
      },
    ],
    overall_result: 'pass',
    traceability_refs: ['CGB-DWG-001 rev A', 'SUPPLIER-CERT-2026-05'],
    notes: 'Gate shape test record only. Passing this local gate never attaches evidence or changes readiness.',
    ...overrides,
  };
}

function assertRejected(report, code, label) {
  assertCandidateReportContract(report, label, { eligible: false });
  assert.equal(report.summary.eligible_for_stage5b_intake_review, false, `${label} should be rejected`);
  assert.equal(report.summary.decision, 'reject', `${label} should have reject summary decision`);
  assert.equal(report.decision.result, 'reject', `${label} should have reject decision`);
  assert.equal(report.summary.candidate_status, 'rejected', `${label} should have rejected status`);
  assert(
    report.summary.rejection_codes.includes(code),
    `${label} should include rejection code ${code}; got ${report.summary.rejection_codes.join(', ')}`
  );
  assert.equal(report.summary.canonical_artifacts_mutated, false, `${label} should not mutate canonical artifacts`);
  assert.equal(report.summary.genuine_evidence_attached, false, `${label} should not attach evidence`);
  assert.equal(report.readiness_unchanged.unchanged, true, `${label} should preserve readiness unchanged`);
  assert.equal(report.readiness_unchanged.gate_decision, 'hold_for_evidence_completion');
}

function assertPassesValidation(label, validation) {
  assert.equal(validation.ok, true, `${label} should validate:\n${validation.errors.join('\n')}`);
}

function assertFailsValidation(label, validation, pattern) {
  assert.equal(validation.ok, false, `${label} should fail validation`);
  assert.match(validation.errors.join('\n'), pattern, `${label} should explain contract failure`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertCandidateReportContract(report, label, { eligible }) {
  assertPassesValidation(`${label} candidate gate report schema/semantics`, validateStage5bCandidateGateReport(report));
  assertPassesValidation(`${label} candidate gate artifact dispatcher`, validateStage5bArtifact(report));
  assert.equal(report.summary.eligible_for_stage5b_intake_review, eligible, `${label} eligibility should match expectation`);
  assert.equal(report.decision.eligible_for_stage5b_intake_review, eligible, `${label} decision eligibility should match summary`);
  assert.equal(report.decision.does_not_attach_evidence, true, `${label} decision should not attach evidence`);
  assert.equal(report.decision.does_not_promote_evidence, true, `${label} decision should not promote evidence`);
  assert.equal(report.decision.does_not_satisfy_readiness, true, `${label} decision should not satisfy readiness`);
  assert.equal(report.decision.does_not_mutate_canonical_artifacts, true, `${label} decision should not mutate canonical artifacts`);
  assert.match(report.decision.reviewer_note, /only a pre-intake eligibility signal/i);
  assert.equal(report.report_contract.passing_report_means, STAGE5B_CANDIDATE_GATE_PASSING_MEANING);
  for (const field of ['evidence_attached', 'evidence_promoted', 'readiness_satisfied', 'canonical_artifacts_mutated']) {
    assert.equal(
      report.report_contract.passing_report_does_not_mean.includes(field),
      true,
      `${label} report contract should deny ${field}`
    );
  }
  for (const section of ['candidate', 'summary', 'decision', 'checklist', 'rejections', 'path_safety', 'readiness_unchanged', 'evidence_boundary', 'non_evidence_boundary']) {
    assert.equal(
      report.report_contract.required_sections.includes(section),
      true,
      `${label} report contract should require ${section}`
    );
  }
  assert.equal(report.readiness_unchanged.canonical_package_status, 'needs_more_evidence');
  assert.equal(report.readiness_unchanged.gate_decision, 'hold_for_evidence_completion');
  assert.equal(report.readiness_unchanged.missing_input, 'inspection_evidence');
  assert.equal(report.readiness_unchanged.genuine_evidence_attached, false);
  assert.equal(report.readiness_unchanged.evidence_promoted, false);
  assert.equal(report.readiness_unchanged.readiness_satisfied, false);
  assert.equal(report.path_safety.safe_repo_relative_paths_required, true);
  assert.equal(report.path_safety.absolute_paths_rejected, true);
  assert.equal(report.path_safety.traversal_rejected, true);
  assert.equal(report.path_safety.output_and_tmp_codex_rejected, true);
  assert.equal(report.path_safety.secret_bearing_refs_rejected, true);
  assert.match(report.path_safety.redaction_note, /absolute paths|tokens|credentials|authorization headers/i);
  assert.equal(report.non_evidence_boundary.candidate_gate_reports_do_not_satisfy_inspection_evidence, true);
  assert.equal(report.non_evidence_boundary.readiness_reports_do_not_satisfy_inspection_evidence, true);
  assert.equal(report.non_evidence_boundary.release_bundles_do_not_satisfy_inspection_evidence, true);
  assert.equal(report.non_evidence_boundary.cad_generated_measurements_are_not_evidence, true);
}

const tempRoot = mkdtempSync(join(tmpdir(), 'fcad-stage5b-candidate-gate-'));

try {
  assertGitIgnored(
    `${LOCAL_INBOX_ROOT}/quality-pass-bracket/supplier-final-inspection.json`,
    'local Stage 5B inbox candidate record'
  );
  assertGitIgnored(
    `${LOCAL_INBOX_ROOT}/quality-pass-bracket/candidate-gate-report.json`,
    'local Stage 5B inbox candidate gate report'
  );
  assertGitIgnored(
    `${LOCAL_INBOX_ROOT}/quality-pass-bracket/private-url-redaction-notes.txt`,
    'local Stage 5B inbox private redaction notes'
  );

  const candidatePath = 'docs/examples/candidate-gate-bracket/inspection/supplier-final-inspection.json';
  writeJson(join(tempRoot, candidatePath), validCandidate());

  const accepted = await evaluateStage5bCandidateEvidenceFile({
    projectRoot: tempRoot,
    candidatePath,
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  assert.equal(accepted.artifact_type, 'stage5b_candidate_evidence_acceptance_report');
  assert.equal(accepted.dry_run, true);
  assertCandidateReportContract(accepted, 'accepted candidate', { eligible: true });
  assert.equal(accepted.summary.eligible_for_stage5b_intake_review, true);
  assert.equal(accepted.summary.decision, 'accept');
  assert.equal(accepted.decision.result, 'accept');
  assert.equal(accepted.decision.meaning, 'eligible for later Stage 5B intake review only');
  assert.equal(accepted.decision.next_allowed_step, 'later_authorized_stage5b_intake_review');
  assert.equal(accepted.summary.candidate_status, 'eligible_for_intake_review');
  assert.equal(accepted.summary.canonical_artifacts_mutated, false);
  assert.equal(accepted.summary.genuine_evidence_attached, false);
  assert.match(accepted.summary.readiness_truth, /needs_more_evidence \/ hold_for_evidence_completion/);
  assert.equal(accepted.path_safety.candidate_path_is_safe_repo_relative, true);
  assert.deepEqual(accepted.path_safety.candidate_path_rejection_codes, []);
  assert.equal(accepted.path_safety.source_ref_is_safe_or_null, true);
  assert.deepEqual(accepted.path_safety.source_ref_rejection_codes, []);
  assert.equal(
    accepted.checklist.every((item) => item.status === 'pass'),
    true,
    `accepted candidate checklist should pass: ${JSON.stringify(accepted.checklist, null, 2)}`
  );
  assert.equal(accepted.evidence_boundary.hard_evidence_rule, STAGE5B_CANDIDATE_HARD_EVIDENCE_RULE);

  const overclaimedReadiness = clone(accepted);
  overclaimedReadiness.readiness_unchanged.readiness_satisfied = true;
  assertFailsValidation(
    'candidate report readiness overclaim',
    validateStage5bCandidateGateReport(overclaimedReadiness),
    /readiness_satisfied|non-mutating candidate gate boundary/i
  );

  const mismatchedDecision = clone(accepted);
  mismatchedDecision.decision.result = 'reject';
  assertFailsValidation(
    'candidate report decision mismatch',
    validateStage5bCandidateGateReport(mismatchedDecision),
    /summary\.decision must match decision\.result|accept when eligible/i
  );

  const missingBoundary = clone(accepted);
  delete missingBoundary.path_safety.redaction_note;
  assertFailsValidation(
    'candidate report missing path redaction note',
    validateStage5bCandidateGateReport(missingBoundary),
    /path_safety\/redaction_note|redaction_note/i
  );

  const missingCompleted = evaluateStage5bCandidateEvidence({
    document: validCandidate({ inspection_status: undefined, status: undefined }),
    candidatePath,
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  assertRejected(missingCompleted, 'inspection_status_not_completed', 'missing completed inspection status');

  const missingReviewer = evaluateStage5bCandidateEvidence({
    document: validCandidate({
      reviewed_by: undefined,
      approved_by: undefined,
      qa_reviewer: undefined,
      reviewer: undefined,
      traceability_refs: [],
    }),
    candidatePath,
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  assertRejected(missingReviewer, 'reviewer_traceability_missing', 'missing reviewer traceability');

  const missingRevision = evaluateStage5bCandidateEvidence({
    document: validCandidate({
      part_revision: undefined,
      revision: undefined,
      drawing_revision: undefined,
      package_revision: undefined,
      inspected_revision: undefined,
    }),
    candidatePath,
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  assertRejected(missingRevision, 'revision_mapping_missing', 'missing revision mapping');

  const selfLabeledNonEvidence = evaluateStage5bCandidateEvidence({
    document: validCandidate({
      notes: 'Control/non-evidence fixture for parser testing only.',
    }),
    candidatePath,
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  assertRejected(selfLabeledNonEvidence, 'non_genuine_candidate_wording', 'self-labeled non-evidence candidate');

  const otherOrigin = evaluateStage5bCandidateEvidence({
    document: validCandidate({
      source_type: 'other_inspection_source',
      origin_category: undefined,
    }),
    candidatePath,
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  assertRejected(otherOrigin, 'other_origin_missing_physical_supplier_lab_or_qa_category', 'other origin without category');

  const invalidPathCases = [
    ['generated/control artifact', 'docs/examples/candidate-gate-bracket/quality/candidate_gate_bracket_create_quality.json', 'generated_control_artifact'],
    ['diagnostics', 'docs/examples/candidate-gate-bracket/inspection/validation_diagnostics.json', 'diagnostics_not_evidence'],
    ['schema', 'schemas/inspection-evidence.schema.json', 'schema_not_evidence'],
    ['fixture', 'tests/fixtures/inspection-evidence/control-non-evidence.json', 'fixture_not_evidence'],
    ['intake output', 'output/stage5b/intake_report.json', 'intake_output_not_evidence'],
    ['promotion dry-run output', 'output/stage5b/promotion_dry_run_manifest.json', 'promotion_dry_run_output_not_evidence'],
    ['audit manifest output', 'output/stage5b/stage5b_audit_manifest.json', 'audit_output_not_evidence'],
    ['GitHub/CI metadata', '.github/workflows/automation-ci.yml', 'github_ci_metadata_not_evidence'],
    ['screenshot', 'docs/examples/candidate-gate-bracket/inspection/supplier-screenshot.png', 'screenshot_not_evidence'],
    ['template', 'docs/examples/candidate-gate-bracket/inspection/template-inspection.json', 'template_not_evidence'],
    ['generated example', 'docs/examples/candidate-gate-bracket/inspection/example-generated-inspection.json', 'template_not_evidence'],
    ['guide', 'docs/inspection-evidence-collection/candidate-gate-bracket.md', 'guide_not_evidence'],
    ['comment', 'docs/examples/candidate-gate-bracket/inspection/comment.md', 'comment_or_pr_body_not_evidence'],
    ['PR body', 'docs/examples/candidate-gate-bracket/inspection/pr-body.md', 'comment_or_pr_body_not_evidence'],
    ['docs artifact', 'docs/stage-5b-operational-runbook.md', 'guide_not_evidence'],
    ['release bundle', 'docs/examples/candidate-gate-bracket/release/release_bundle.zip', 'release_bundle_not_evidence'],
  ];

  for (const [label, path, code] of invalidPathCases) {
    const fullPath = join(tempRoot, path);
    if (path.endsWith('.json')) {
      writeJson(fullPath, validCandidate({ source_ref: path }));
    } else {
      writeText(fullPath, 'Control/non-evidence fixture for candidate gate rejection tests.\n');
    }
    const report = await evaluateStage5bCandidateEvidenceFile({
      projectRoot: tempRoot,
      candidatePath: path,
      generatedAt: '2026-05-30T00:00:00.000Z',
    });
    assertRejected(report, code, label);
  }

  const artifactTypeCases = [
    ['GitHub metadata', 'github_check_run'],
    ['CI summary', 'ci_summary'],
    ['comment body', 'github_comment'],
    ['PR body', 'github_pr_body'],
    ['docs manifest', 'docs_manifest'],
  ];
  for (const [label, artifactType] of artifactTypeCases) {
    const report = evaluateStage5bCandidateEvidence({
      document: validCandidate({ artifact_type: artifactType }),
      candidatePath,
      generatedAt: '2026-05-30T00:00:00.000Z',
    });
    assertRejected(report, 'generated_control_artifact_type_not_evidence', label);
  }

  const cadGenerated = evaluateStage5bCandidateEvidence({
    document: validCandidate({
      measured_features: [
        {
          feature_id: 'mount_hole_a_diameter',
          measured_value: 8.01,
          result: 'pass',
          measurement_method: 'FreeCAD CAD-generated geometry probe',
        },
      ],
    }),
    candidatePath,
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  assertRejected(cadGenerated, 'cad_generated_measurement_not_evidence', 'CAD-generated measurements');

  const cliReportPath = 'output/stage5b-candidate-gate-report.json';
  const cliAccepted = spawnSync(process.execPath, [
    'scripts/stage5b-candidate-evidence-gate.js',
    '--project-root',
    tempRoot,
    '--candidate',
    candidatePath,
    '--out',
    cliReportPath,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(cliAccepted.status, 0, cliAccepted.stderr || cliAccepted.stdout);
  assert.match(cliAccepted.stdout, /eligible_for_intake_review/);
  assert.equal(existsSync(join(tempRoot, cliReportPath)), true, 'CLI should write the non-production gate report');
  const cliAcceptedReport = readJson(join(tempRoot, cliReportPath));
  assertCandidateReportContract(cliAcceptedReport, 'CLI accepted candidate report', { eligible: true });
  assert.equal(cliAcceptedReport.summary.genuine_evidence_attached, false);

  const fixtureCli = spawnSync(process.execPath, [
    'scripts/stage5b-candidate-evidence-gate.js',
    '--project-root',
    tempRoot,
    '--candidate',
    'tests/fixtures/inspection-evidence/control-non-evidence.json',
    '--json',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.notEqual(fixtureCli.status, 0, 'fixture candidate CLI should fail closed');
  assert.match(fixtureCli.stdout, /fixture_not_evidence/);
  assert.equal(fixtureCli.stdout.includes(tempRoot), false, 'CLI JSON must not leak temp root absolute path');

  const unsafeOutCli = spawnSync(process.execPath, [
    'scripts/stage5b-candidate-evidence-gate.js',
    '--project-root',
    tempRoot,
    '--candidate',
    candidatePath,
    '--out',
    '../outside-report.json',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(unsafeOutCli.status, 2, 'candidate gate report output must stay inside project root');
  assert.match(unsafeOutCli.stderr, /--out must resolve inside the project root/);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('stage5b-candidate-evidence-gate.test.js: ok');
