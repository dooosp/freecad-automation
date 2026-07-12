import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildInspectionEvidenceIntakeCard,
  buildInspectionEvidencePromotionDryRunCard,
  buildEvidenceReadinessAuditCard,
  buildStage5bEvidenceAuditCard,
  buildReviewCards,
} from '../public/js/studio/artifact-insights.js';
import { EVIDENCE_GRAPH_BOUNDARY } from '../public/js/studio/evidence-graph-panel.js';
import { translateText } from '../public/js/i18n/index.js';
import { renderReviewWorkspace } from '../public/js/studio/review-workspace.js';

const ROOT = resolve(import.meta.dirname, '..');
const reviewWorkspaceSource = readFileSync(resolve(ROOT, 'public/js/studio/review-workspace.js'), 'utf8');

const intakeReport = {
  artifact_type: 'inspection_evidence_intake_report',
  schema_version: '1.0',
  generated_at: '2026-05-23T00:00:00.000Z',
  source_boundary: {
    hard_evidence_rule: 'Only real completed physical/supplier/lab/QA inspection records with measured feature records, result semantics, and provenance can be accepted.',
    rejected_as_final_evidence: [
      'generated CAD/drawing/quality/readiness/review/standard-doc/release artifacts',
      'fixtures',
      'templates',
      'collection guides',
    ],
  },
  searched_sources: [
    { kind: 'tracked_repo_files', status: 'searched', candidate_path_count: 4 },
    { kind: 'github_public_metadata', status: 'not_requested' },
  ],
  packages: [
    {
      slug: 'quality-pass-bracket',
      classification: 'invalid_generated',
      readiness_after: {
        status: 'needs_more_evidence',
        gate_decision: 'hold_for_evidence_completion',
        missing_inputs: ['inspection_evidence'],
      },
      intake_action: {
        status: 'hold_for_evidence_completion',
        mode: 'no_human_measurement_entry_requested',
        note: 'No genuine completed inspection evidence was found; readiness must remain held.',
      },
    },
    {
      slug: 'hinge-block',
      classification: 'no_candidate',
      readiness_after: {
        status: 'needs_more_evidence',
        gate_decision: 'hold_for_evidence_completion',
        missing_inputs: ['inspection_evidence'],
      },
      intake_action: {
        status: 'hold_for_evidence_completion',
        mode: 'no_human_measurement_entry_requested',
        note: 'No genuine completed inspection evidence was found; readiness must remain held.',
      },
    },
  ],
  accepted_candidates: [],
  rejected_candidates: [
    { classification: 'invalid_generated', source_kind: 'tracked_repo_file' },
    { classification: 'invalid_schema', source_kind: 'tracked_repo_file' },
    { classification: 'invalid_provenance', source_kind: 'github_issue_comments' },
  ],
  summary: {
    package_count: 2,
    candidate_count: 3,
    accepted_candidate_count: 0,
    rejected_candidate_count: 3,
    attachment_ready_candidate_count: 0,
    genuine_inspection_evidence_found: false,
    packages_with_genuine_evidence: [],
    packages_without_genuine_evidence: ['quality-pass-bracket', 'hinge-block'],
    requires_human_measurement_entry: false,
    readiness_truth: 'readiness remains needs_more_evidence / hold_for_evidence_completion',
  },
};

const intakeArtifact = {
  id: 'inspection-evidence-intake-report-0',
  key: 'Stage 5B intake report',
  type: 'inspection-evidence.intake-report',
  file_name: 'inspection-evidence-intake-report.json',
  extension: '.json',
  content_type: 'application/json; charset=utf-8',
  exists: true,
  capabilities: {
    can_open: true,
    can_download: true,
    browser_safe: true,
  },
  links: {
    open: '/jobs/job-1/artifacts/inspection-evidence-intake-report-0/content',
    download: '/jobs/job-1/artifacts/inspection-evidence-intake-report-0/content?download=1',
  },
};

const promotionDryRunManifest = {
  artifact_type: 'inspection_evidence_promotion_dry_run_manifest',
  schema_version: '1.0',
  dry_run: true,
  hard_evidence_rule: 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.',
  evidence_boundary: {
    dry_run_does_not_attach_evidence: true,
    rejected_as_final_evidence: [
      'dry-run manifests',
      'intake reports',
      'generated CAD/drawing/quality/readiness/review reports',
      'GitHub metadata',
    ],
  },
  summary: {
    package_count: 1,
    ready_package_count: 0,
    blocked_package_count: 1,
    promotion_can_run: false,
    canonical_artifacts_mutated: false,
    dry_run_manifest_only: true,
    readiness_expectation: 'No promotion can run; readiness remains needs_more_evidence / hold_for_evidence_completion.',
    blockers: ['no_genuine_valid_candidate'],
  },
  packages: [
    {
      package_slug: 'quality-pass-bracket',
      attachment_ready: false,
      match_confidence: 'none',
      blockers: ['no_genuine_valid_candidate'],
      canonical_next_command: null,
      expected_artifacts: [],
      mutation_boundaries: {
        dry_run_writes: ['promotion_dry_run_manifest.json'],
        canonical_artifacts_mutated_by_dry_run: false,
        allowed_future_mutation_roots: [],
        files_that_would_be_mutated: [],
      },
      readiness_expectation: {
        dry_run: {
          status: 'needs_more_evidence',
          gate_decision: 'hold_for_evidence_completion',
          missing_inputs: ['inspection_evidence'],
        },
        after_future_promotion: {
          expected_action: 'no promotion command should run',
        },
      },
      rollback_guidance: [
        'No rollback is needed because no promotion commands should run.',
        'Keep the canonical package readiness held until genuine completed inspection evidence is available.',
      ],
    },
  ],
};

const promotionDryRunArtifact = {
  id: 'inspection-evidence-promotion-dry-run-manifest-0',
  key: 'Stage 5B promotion dry-run manifest',
  type: 'inspection-evidence.promotion-dry-run-manifest',
  file_name: 'promotion_dry_run_manifest.json',
  extension: '.json',
  content_type: 'application/json; charset=utf-8',
  exists: true,
  capabilities: {
    can_open: true,
    can_download: true,
    browser_safe: true,
  },
  links: {
    open: '/jobs/job-2/artifacts/inspection-evidence-promotion-dry-run-manifest-0/content',
    download: '/jobs/job-2/artifacts/inspection-evidence-promotion-dry-run-manifest-0/content?download=1',
  },
};

const stage5bAuditManifest = {
  artifact_type: 'stage5b_evidence_audit_manifest',
  schema_version: '1.0',
  dry_run: true,
  non_mutating: true,
  include_github: false,
  outputs: {
    intake_report: {
      path: 'output/jobs/job-audit/artifacts/intake_report.json',
      artifact_type: 'inspection_evidence_intake_report',
    },
    promotion_dry_run_manifest: {
      path: 'output/jobs/job-audit/artifacts/promotion_dry_run_manifest.json',
      artifact_type: 'inspection_evidence_promotion_dry_run_manifest',
    },
    stage5b_audit_manifest: {
      path: 'output/jobs/job-audit/artifacts/stage5b_audit_manifest.json',
      artifact_type: 'stage5b_evidence_audit_manifest',
    },
    stage5b_audit_summary: {
      path: 'output/jobs/job-audit/artifacts/stage5b_audit_summary.md',
      artifact_type: 'stage5b_evidence_audit_summary_markdown',
    },
  },
  source_classes: {
    searched_source_classes: ['tracked_repo_files', 'github_public_metadata'],
    accepted_count: 0,
    rejected_count: 3,
    rejected_counts: {
      invalid_generated: 2,
      invalid_schema: 1,
    },
  },
  github_summary: {
    enabled: false,
    repo: 'dooosp/freecad-automation',
    searched_source_count: 0,
    skipped_source_count: 0,
    downloaded_candidate_count: 0,
    accepted_candidate_count: 0,
    rejected_candidate_count: 0,
  },
  attachment_ready: {
    count: 0,
    candidates: [],
  },
  blockers: [
    'no_genuine_completed_inspection_evidence',
    'promotion_blocked_readiness_held',
    'no_safe_promotion_command_available',
  ],
  canonical_package_readiness_states: [
    {
      slug: 'quality-pass-bracket',
      promotion_status: 'blocked_no_candidate',
      attachment_ready: false,
      readiness_after: {
        status: 'needs_more_evidence',
        gate_decision: 'hold_for_evidence_completion',
        missing_inputs: ['inspection_evidence'],
      },
      blockers: ['no_genuine_valid_candidate'],
    },
  ],
  evidence_boundary: {
    hard_evidence_rule: 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.',
    rejected_as_final_evidence: [
      'intake reports',
      'promotion dry-run manifests',
      'audit manifests',
      'fixtures',
      'generated CAD/drawing/quality/DFM/readiness/review reports',
      'release bundles',
      'screenshots',
      'CI summaries',
      'templates',
      'collection guides',
      'GitHub metadata alone',
    ],
  },
  next_safe_commands: [
    {
      name: 'stage5b_evidence_audit',
      command: ['fcad', 'stage5b-evidence-audit', '--out-dir', 'output/jobs/job-audit/artifacts'],
      mutates_canonical_artifacts: false,
    },
    {
      name: 'promotion_dry_run',
      command: ['fcad', 'inspection-evidence-promotion-dry-run', '--intake-report', 'output/jobs/job-audit/artifacts/intake_report.json'],
      mutates_canonical_artifacts: false,
    },
  ],
  readiness_held_truth: {
    statement: 'No genuine completed inspection evidence is available for promotion; no promotion can run and readiness remains needs_more_evidence / hold_for_evidence_completion.',
    no_genuine_completed_inspection_evidence_found: true,
    no_promotion_can_run: true,
    readiness_remains_held: true,
    canonical_package_artifacts_mutated: false,
    requires_human_measurement_entry: false,
  },
  summary: {
    package_count: 1,
    accepted_candidate_count: 0,
    rejected_candidate_count: 3,
    attachment_ready_candidate_count: 0,
    genuine_inspection_evidence_found: false,
    promotion_can_run: false,
    readiness_remains_held: true,
    canonical_artifacts_mutated: false,
    requires_human_measurement_entry: false,
    audit_bundle_only: true,
  },
};

const stage5bAuditArtifact = {
  id: 'stage5b-evidence-audit-manifest-0',
  key: 'Stage 5B evidence audit manifest',
  type: 'stage5b.evidence-audit-manifest',
  file_name: 'stage5b_audit_manifest.json',
  extension: '.json',
  content_type: 'application/json; charset=utf-8',
  exists: true,
  capabilities: {
    can_open: true,
    can_download: true,
    browser_safe: true,
  },
  links: {
    open: '/jobs/job-audit/artifacts/stage5b-evidence-audit-manifest-0/content',
    download: '/jobs/job-audit/artifacts/stage5b-evidence-audit-manifest-0/content?download=1',
  },
};

const evidenceReadinessAuditManifest = {
  artifact_type: 'evidence_readiness_audit',
  schema_version: '1.0',
  generated_at: '2026-07-05T00:00:00.000Z',
  non_mutating: true,
  dry_run: true,
  boundary: {
    canonical_artifacts_mutated: false,
    inspection_evidence_attached: false,
    readiness_regenerated: false,
    release_published: false,
    hard_evidence_rule: 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.',
  },
  repo_context: {
    repo_root_basename: 'freecad-automation',
    current_branch: 'codex/evidence-readiness-audit',
    head_sha: 'a'.repeat(40),
    default_branch: 'origin/master',
    dirty_path_count: 0,
  },
  runtime_context: {
    available: true,
    versions: {
      freecad: '1.1.1',
    },
  },
  summary: {
    package_count: 5,
    held_package_count: 5,
    ready_package_count: 0,
    authorized_inspection_evidence_record_count: 0,
    trusted_evidence_record_count: 0,
    generated_review_artifact_count: 45,
    evidence_graph_package_count: 1,
    runtime_fingerprint_package_count: 1,
    qif_lite_package_count: 1,
    pr170_artifact_coverage: {
      evidence_graph_package_count: 1,
      runtime_fingerprint_package_count: 1,
      qif_lite_package_count: 1,
      complete_package_count: 1,
      missing_package_count: 4,
    },
    release_overclaim_risk_count: 5,
    decision: 'hold',
    primary_hold_reasons: ['inspection_evidence'],
  },
  packages: [
    {
      slug: 'quality-pass-bracket',
      readiness: {
        status: 'needs_more_evidence',
        score: 61,
        gate_decision: 'hold_for_evidence_completion',
        hold_reasons: ['inspection_evidence'],
      },
      evidence_counts: {
        trusted_inspection: 0,
        generated_review: 9,
      },
      release_decision: {
        overclaim_if_marked_ready: true,
        reason: 'Release bundle presence does not mean production-ready.',
      },
      pr170_artifacts: {
        evidence_graph: {
          status: 'present_generated_control',
          trusted_inspection_evidence: false,
        },
        runtime_fingerprint: {
          status: 'present_generated_control',
          trusted_inspection_evidence: false,
        },
        qif_lite: {
          status: 'present_generated_control',
          trusted_inspection_evidence: false,
        },
      },
    },
    {
      slug: 'hinge-block',
      readiness: {
        status: 'needs_more_evidence',
        score: 52,
        gate_decision: 'hold_for_evidence_completion',
        hold_reasons: ['inspection_evidence'],
      },
      evidence_counts: {
        trusted_inspection: 0,
        generated_review: 8,
      },
      release_decision: {
        overclaim_if_marked_ready: true,
        reason: 'Release bundle presence does not mean production-ready.',
      },
      pr170_artifacts: {
        evidence_graph: {
          status: 'missing',
          trusted_inspection_evidence: false,
        },
        runtime_fingerprint: {
          status: 'missing',
          trusted_inspection_evidence: false,
        },
        qif_lite: {
          status: 'missing',
          trusted_inspection_evidence: false,
        },
      },
    },
  ],
  maintainer_decision: {
    decision: 'hold',
    release_would_overclaim_readiness: true,
    safe_to_publish_release: false,
    reason: 'At least one canonical package remains held.',
  },
  next_safe_commands: [
    {
      name: 'rerun_evidence_readiness_audit',
      command: ['fcad', 'evidence-readiness-audit', '--out-dir', 'output/evidence-readiness-audit', '--clean'],
      mutates_canonical_artifacts: false,
    },
  ],
};

const evidenceReadinessAuditArtifact = {
  id: 'evidence-readiness-audit-json-0',
  key: 'Evidence readiness audit',
  type: 'evidence-readiness.audit-json',
  file_name: 'evidence_readiness_audit.json',
  extension: '.json',
  content_type: 'application/json; charset=utf-8',
  exists: true,
  capabilities: {
    can_open: true,
    can_download: true,
    browser_safe: true,
  },
  links: {
    open: '/jobs/job-evidence-readiness/artifacts/evidence-readiness-audit-json-0/content',
    download: '/jobs/job-evidence-readiness/artifacts/evidence-readiness-audit-json-0/content?download=1',
  },
};

const validationDiagnostics = {
  artifact_type: 'inspection_evidence_intake_report',
  artifact_path: 'output/jobs/job-validation/artifacts/intake_report.json',
  validation_status: 'failed',
  diagnostics: [
    {
      artifact_type: 'inspection_evidence_intake_report',
      artifact_path: 'output/jobs/job-validation/artifacts/intake_report.json',
      validation_stage: 'semantic',
      severity: 'error',
      code: 'stage5b.generated_control_artifact_not_evidence',
      message: 'accepted_candidates[0] points at a fixture, control file, or generated artifact; that is not inspection evidence',
      json_pointer: '/accepted_candidates/0/path',
      remediation: 'Use only genuine completed physical/supplier/lab/QA inspection records; control artifacts cannot satisfy inspection_evidence.',
      evidence_boundary_note: 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.',
      safe_source_ref: null,
    },
    {
      artifact_type: 'inspection_evidence_intake_report',
      artifact_path: 'output/jobs/job-validation/artifacts/intake_report.json',
      validation_stage: 'semantic',
      severity: 'error',
      code: 'stage5b.readiness_overclaim',
      message: 'summary.promotion_can_run must be false when no genuine inspection evidence was found',
      json_pointer: '/summary/promotion_can_run',
      remediation: 'Keep readiness held until genuine completed inspection evidence is attached through the canonical flow.',
      evidence_boundary_note: 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.',
      safe_source_ref: null,
    },
  ],
  evidence_boundary_note: 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.',
};

const validationDiagnosticsArtifact = {
  id: 'stage5b-validation-diagnostics-0',
  key: 'Stage 5B validation diagnostics',
  type: 'stage5b.validation-diagnostics',
  file_name: 'validation_diagnostics.json',
  extension: '.json',
  content_type: 'application/json; charset=utf-8',
  exists: true,
  capabilities: {
    can_open: true,
    can_download: true,
    browser_safe: true,
  },
  links: {
    open: '/jobs/job-validation/artifacts/stage5b-validation-diagnostics-0/content',
    download: '/jobs/job-validation/artifacts/stage5b-validation-diagnostics-0/content?download=1',
  },
};

const evidenceGraph = {
  schema_version: '1.0',
  package_id: 'quality-pass-bracket',
  summary: {
    node_count: 6,
    edge_count: 5,
    inspection_evidence_record_count: 0,
    generated_artifact_count: 5,
    readiness_gate_decision: 'hold_for_evidence_completion',
    readiness_status: 'needs_more_evidence',
  },
  nodes: [],
  edges: [],
};

const evidenceGraphArtifact = {
  id: 'evidence-graph-0',
  key: 'Evidence graph',
  type: 'evidence-graph',
  file_name: 'evidence_graph.json',
  extension: '.json',
  content_type: 'application/json; charset=utf-8',
  exists: true,
  capabilities: {
    can_open: true,
    can_download: true,
    browser_safe: true,
  },
  links: {
    open: '/jobs/job-graph/artifacts/evidence-graph-0/content',
    download: '/jobs/job-graph/artifacts/evidence-graph-0/content?download=1',
  },
};

const raw = JSON.stringify(intakeReport, null, 2);
const card = buildInspectionEvidenceIntakeCard({
  report: intakeReport,
  artifact: intakeArtifact,
  raw,
  manifest: {
    command: 'inspection-evidence-intake',
  },
});

assert.equal(card.id, 'inspection-intake');
assert.equal(card.title, 'Stage 5B inspection evidence intake');
assert.equal(card.status, 'No accepted genuine candidate');
assert.equal(card.score, 0);
assert.equal(card.tone, 'warn');
assert.match(card.summary, /readiness remains needs_more_evidence \/ hold_for_evidence_completion/);
assert.match(card.summary, /No human-entered measurements requested/);
assert.equal(card.artifact, intakeArtifact);
assert.equal(card.raw, raw);

const normalized = Object.fromEntries(card.normalized);
assert.equal(normalized['Searched source classes'], 'tracked_repo_files • github_public_metadata');
assert.equal(normalized['Accepted candidates'], '0');
assert.equal(normalized['Attachment-ready candidates'], '0');
assert.equal(normalized['Inspection evidence attached'], 'No');
assert.equal(normalized['Rejected candidates'], '3');
assert.equal(normalized['Rejection classes'], 'invalid_generated • invalid_schema • invalid_provenance');
assert.equal(normalized['Package readiness'], 'quality-pass-bracket: needs_more_evidence / hold_for_evidence_completion • hinge-block: needs_more_evidence / hold_for_evidence_completion');
assert.equal(normalized['Readiness explanation'], 'readiness remains needs_more_evidence / hold_for_evidence_completion');
assert.equal(normalized['Evidence boundary'], 'Generated CAD/drawing/quality/readiness/review/standard-doc/release artifacts, fixtures, templates, and collection guides are not inspection evidence.');

const candidateFoundReport = structuredClone(intakeReport);
candidateFoundReport.summary.accepted_candidate_count = 1;
candidateFoundReport.summary.genuine_inspection_evidence_found = true;
candidateFoundReport.summary.attachment_ready_candidate_count = 0;
candidateFoundReport.summary.readiness_truth = 'candidate evidence found; readiness remains held until later authorized attachment';
const candidateFoundCard = buildInspectionEvidenceIntakeCard({ report: candidateFoundReport });
assert.equal(candidateFoundCard.tone, 'warn');
assert.equal(candidateFoundCard.status, 'Genuine candidate found; readiness held');
assert.match(candidateFoundCard.summary, /later authorized attachment/);

const dryRunRaw = JSON.stringify(promotionDryRunManifest, null, 2);
const dryRunCard = buildInspectionEvidencePromotionDryRunCard({
  manifest: promotionDryRunManifest,
  artifact: promotionDryRunArtifact,
  raw: dryRunRaw,
});

assert.equal(dryRunCard.id, 'inspection-promotion-dry-run');
assert.equal(dryRunCard.title, 'Stage 5B promotion dry-run');
assert.equal(dryRunCard.status, 'Promotion held');
assert.equal(dryRunCard.tone, 'warn');
assert.match(dryRunCard.summary, /readiness remains needs_more_evidence \/ hold_for_evidence_completion/);
assert.match(dryRunCard.summary, /No canonical artifacts mutated/);
const dryRunNormalized = Object.fromEntries(dryRunCard.normalized);
assert.equal(dryRunNormalized['Package slug'], 'quality-pass-bracket');
assert.equal(dryRunNormalized['Attachment ready'], 'No');
assert.equal(dryRunNormalized['Match confidence'], 'none');
assert.equal(dryRunNormalized['Blockers'], 'no_genuine_valid_candidate');
assert.equal(dryRunNormalized['Canonical next command'], 'None');
assert.equal(dryRunNormalized['Expected artifacts'], 'none');
assert.match(dryRunNormalized['Mutation boundaries'], /canonical_artifacts_mutated_by_dry_run: false/);
assert.match(dryRunNormalized['Readiness expectation'], /needs_more_evidence \/ hold_for_evidence_completion/);
assert.match(dryRunNormalized['Rollback guidance'], /No rollback is needed/);
assert.match(dryRunNormalized['Evidence boundary'], /dry-run manifests.*are not inspection evidence/i);

const auditRaw = JSON.stringify(stage5bAuditManifest, null, 2);
const auditCard = buildStage5bEvidenceAuditCard({
  manifest: stage5bAuditManifest,
  artifact: stage5bAuditArtifact,
  raw: auditRaw,
});

assert.equal(auditCard.id, 'stage5b-evidence-audit');
assert.equal(auditCard.title, 'Stage 5B evidence audit');
assert.equal(auditCard.status, 'Readiness held');
assert.equal(auditCard.tone, 'warn');
assert.equal(auditCard.score, 0);
assert.match(auditCard.summary, /No genuine completed inspection evidence/);
assert.match(auditCard.summary, /No promotion can run/);
const auditNormalized = Object.fromEntries(auditCard.normalized);
assert.equal(auditNormalized['Genuine candidate found'], 'No');
assert.equal(auditNormalized['Inspection evidence attached'], 'No');
assert.equal(auditNormalized['Promotion can run'], 'No');
assert.equal(auditNormalized['Attachment-ready candidates'], '0');
assert.equal(auditNormalized['Blockers'], 'no_genuine_completed_inspection_evidence • promotion_blocked_readiness_held • no_safe_promotion_command_available');
assert.equal(auditNormalized['Package readiness states'], 'quality-pass-bracket: needs_more_evidence / hold_for_evidence_completion (blocked_no_candidate)');
assert.equal(auditNormalized['GitHub summary'], 'Disabled for dooosp/freecad-automation; searched 0, skipped 0, downloaded 0');
assert.match(auditNormalized['Next safe commands'], /stage5b_evidence_audit: fcad stage5b-evidence-audit/);
assert.match(auditNormalized['Readiness-held truth'], /readiness remains needs_more_evidence/);
assert.match(auditNormalized['Evidence boundary'], /GitHub metadata alone.*not evidence/i);

const evidenceReadinessRaw = JSON.stringify(evidenceReadinessAuditManifest, null, 2);
const evidenceReadinessCard = buildEvidenceReadinessAuditCard({
  audit: evidenceReadinessAuditManifest,
  artifact: evidenceReadinessAuditArtifact,
  raw: evidenceReadinessRaw,
});

assert.equal(evidenceReadinessCard.id, 'evidence-readiness-audit');
assert.equal(evidenceReadinessCard.title, 'Evidence/readiness maintainer audit');
assert.equal(evidenceReadinessCard.status, 'Maintainer hold');
assert.equal(evidenceReadinessCard.tone, 'warn');
assert.equal(evidenceReadinessCard.score, 5);
assert.match(evidenceReadinessCard.summary, /5 of 5 canonical packages held/);
assert.match(evidenceReadinessCard.summary, /0 trusted inspection evidence records/);
const evidenceReadinessNormalized = Object.fromEntries(evidenceReadinessCard.normalized);
assert.equal(evidenceReadinessNormalized['Packages held'], '5/5');
assert.equal(evidenceReadinessNormalized['Trusted inspection evidence'], '0');
assert.equal(evidenceReadinessNormalized['Generated review/control artifacts'], '45');
assert.equal(evidenceReadinessNormalized['Evidence graph packages'], '1');
assert.equal(evidenceReadinessNormalized['Runtime fingerprint packages'], '1');
assert.equal(evidenceReadinessNormalized['QIF-lite packages'], '1');
assert.equal(evidenceReadinessNormalized['PR #170 artifact coverage'], 'complete 1/5; missing 4');
assert.match(evidenceReadinessNormalized['PR #170 artifact states'], /quality-pass-bracket: graph present_generated_control/);
assert.match(evidenceReadinessNormalized['PR #170 artifact states'], /qif_lite present_generated_control/);
assert.match(evidenceReadinessNormalized['PR #170 artifact states'], /hinge-block: graph missing/);
assert.equal(evidenceReadinessNormalized['Release overclaim risks'], '5');
assert.equal(evidenceReadinessNormalized['Runtime context'], 'Available');
assert.match(evidenceReadinessNormalized['Next safe commands'], /fcad evidence-readiness-audit/);
assert.match(evidenceReadinessNormalized['Evidence boundary'], /Only genuine completed/);

const cards = buildReviewCards({
  activeJob: {
    manifest: {
      command: 'inspection-evidence-intake',
    },
  },
  artifacts: [intakeArtifact],
  sourceMap: {
    inspectionIntake: intakeReport,
    inspectionIntakeRaw: raw,
  },
});
assert.equal(cards[0].id, 'inspection-intake');
assert.equal(cards[0].empty, false);

const dryRunCards = buildReviewCards({
  activeJob: {
    manifest: {
      command: 'inspection-evidence-promotion-dry-run',
    },
  },
  artifacts: [promotionDryRunArtifact],
  sourceMap: {
    inspectionPromotionDryRun: promotionDryRunManifest,
    inspectionPromotionDryRunRaw: dryRunRaw,
  },
});
assert.equal(dryRunCards[0].id, 'inspection-promotion-dry-run');
assert.equal(dryRunCards[0].empty, false);

const auditCards = buildReviewCards({
  activeJob: {
    manifest: {
      command: 'stage5b-evidence-audit',
    },
  },
  artifacts: [stage5bAuditArtifact],
  sourceMap: {
    stage5bAudit: stage5bAuditManifest,
    stage5bAuditRaw: auditRaw,
  },
});
assert.equal(auditCards[0].id, 'stage5b-evidence-audit');
assert.equal(auditCards[0].empty, false);

const evidenceReadinessCards = buildReviewCards({
  activeJob: {
    manifest: {
      command: 'evidence-readiness-audit',
    },
  },
  artifacts: [evidenceReadinessAuditArtifact],
  sourceMap: {
    evidenceReadinessAudit: evidenceReadinessAuditManifest,
    evidenceReadinessAuditRaw: evidenceReadinessRaw,
  },
});
assert.equal(evidenceReadinessCards[0].id, 'evidence-readiness-audit');
assert.equal(evidenceReadinessCards[0].empty, false);

const validationCards = buildReviewCards({
  activeJob: {
    status: 'failed',
    diagnostics: {
      stage5b_validation_diagnostics: validationDiagnostics,
    },
    manifest: {
      command: 'stage5b-evidence-audit',
    },
  },
  artifacts: [validationDiagnosticsArtifact],
  sourceMap: {
    stage5bValidationDiagnostics: validationDiagnostics,
    stage5bValidationDiagnosticsRaw: JSON.stringify(validationDiagnostics, null, 2),
  },
});
assert.equal(validationCards[0].id, 'stage5b-validation-diagnostics');
assert.equal(validationCards[0].title, 'Stage 5B validation diagnostics');
assert.equal(validationCards[0].status, 'Validation failed');
assert.equal(validationCards[0].tone, 'bad');
assert.equal(validationCards[0].score, 2);
assert.match(validationCards[0].summary, /control artifacts cannot satisfy inspection_evidence|Only genuine completed/);
const validationNormalized = Object.fromEntries(validationCards[0].normalized);
assert.equal(validationNormalized['Artifact type'], 'inspection_evidence_intake_report');
assert.match(validationNormalized['Top diagnostic'], /stage5b\.generated_control_artifact_not_evidence/);
assert.match(validationNormalized['Remediation'], /genuine completed physical\/supplier\/lab\/QA inspection records/);
assert.match(validationNormalized['Evidence boundary'], /Only genuine completed physical\/supplier\/lab\/QA inspection records/);

const evidenceGraphCards = buildReviewCards({
  activeJob: {
    manifest: {
      command: 'evidence-graph',
    },
  },
  artifacts: [evidenceGraphArtifact],
  sourceMap: {
    evidenceGraph,
    evidenceGraphRaw: JSON.stringify(evidenceGraph, null, 2),
  },
});
assert.equal(evidenceGraphCards[0].id, 'evidence-graph');
assert.equal(evidenceGraphCards[0].title, 'Evidence graph');
assert.equal(evidenceGraphCards[0].status, 'needs_more_evidence');
assert.equal(evidenceGraphCards[0].tone, 'warn');
const evidenceGraphNormalized = Object.fromEntries(evidenceGraphCards[0].normalized);
assert.equal(evidenceGraphNormalized['Readiness status'], 'needs_more_evidence');
assert.equal(evidenceGraphNormalized['Gate decision'], 'hold_for_evidence_completion');
assert.equal(evidenceGraphNormalized['Inspection evidence records'], '0');
assert.equal(evidenceGraphNormalized['Generated artifacts'], '5');
assert.match(
  evidenceGraphNormalized['Evidence boundary'],
  /generated review\/control metadata.*do not satisfy inspection_evidence/i
);
assert.equal(
  evidenceGraphCards[0].provenance.some((note) => /generated review\/control metadata.*not inspection evidence/i.test(note)),
  true
);

assert.equal(translateText('Evidence graph', 'ko'), '근거 그래프');
assert.equal(translateText('Evidence decision', 'ko'), '근거 결정');
assert.equal(translateText('Evidence graph summary', 'ko'), '근거 그래프 요약');
assert.equal(translateText('Readiness status', 'ko'), '준비 상태');
assert.equal(translateText('Readiness status: needs_more_evidence', 'ko'), '준비 상태: 추가 근거 필요');
assert.equal(translateText('Gate decision: hold_for_evidence_completion', 'ko'), '게이트 결정: 근거 완료까지 보류');
assert.equal(translateText('Inspection evidence records', 'ko'), '검사 근거 기록');
assert.equal(translateText('Inspection evidence records: 0', 'ko'), '검사 근거 기록: 0');
assert.equal(translateText('Generated artifacts', 'ko'), '생성된 산출물');
assert.equal(translateText('Nodes', 'ko'), '노드');
assert.equal(translateText('needs_more_evidence', 'ko'), '추가 근거 필요');
assert.equal(
  translateText(EVIDENCE_GRAPH_BOUNDARY, 'ko'),
  'Evidence graph 산출물은 생성된 검토/제어 메타데이터일 뿐입니다. 생성/검토/제어 그래프 노드는 검사 근거가 아니며 inspection_evidence를 충족하지 않습니다. 완료된 실제 물리/공급업체/랩/QA 검사 기록만 inspection_evidence를 충족할 수 있습니다.'
);

globalThis.document = {
  createElement(tagName) {
    return {
      tagName: String(tagName).toUpperCase(),
      className: '',
      textContent: '',
      innerHTML: '',
      dataset: {},
      attributes: {},
      children: [],
      append(...children) {
        this.children.push(...children);
      },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
    };
  },
};

const reviewTree = renderReviewWorkspace({
  data: {
    review: {},
    activeJob: {
      status: 'idle',
      summary: null,
      artifacts: [],
      manifest: null,
    },
    recentJobs: {
      items: [],
    },
  },
});
const renderedText = JSON.stringify(reviewTree);
assert.match(renderedText, /Stage 5B audit/);
assert.match(renderedText, /Maintainer audit/);
assert.match(renderedText, /Run maintainer audit/);
assert.match(renderedText, /Run audit/);
assert.match(renderedText, /Open latest audit|No audit bundle yet/);
assert.match(renderedText, /Stage 5B intake/);
assert.match(renderedText, /Run intake/);
assert.match(renderedText, /Run dry-run/);
assert.match(renderedText, /No human-entered measurements/);
assert.doesNotMatch(reviewWorkspaceSource, /source:\s*['"]review-workspace['"]/);

console.log('studio-inspection-evidence-intake-ux.test.js: ok');
