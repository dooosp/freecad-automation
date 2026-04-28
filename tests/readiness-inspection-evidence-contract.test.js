import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { buildReadinessReportFromReviewPack } from '../src/workflows/canonical-readiness-builders.js';

const ROOT = resolve(import.meta.dirname, '..');
const REVIEW_PACK_FIXTURE_PATH = join(ROOT, 'tests/fixtures/d-artifacts/sample_review_pack.canonical.json');
const INSPECTION_SOURCE_REF = 'tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json';

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function basePartialInspectionPack() {
  const reviewPack = clone(readJson(REVIEW_PACK_FIXTURE_PATH));
  reviewPack.inspection_linkage = { summary: {}, records: [] };
  reviewPack.inspection_anomalies = [];
  reviewPack.inspection_anomaly_linkage = { summary: {}, records: [] };
  reviewPack.coverage = {
    ...(reviewPack.coverage || {}),
    inspection_record_count: 0,
    inspection_outlier_count: 0,
  };
  reviewPack.evidence_ledger = {
    record_count: 0,
    counts_by_type: {
      geometry_hotspot: 0,
      inspection_anomaly: 0,
      quality_pattern: 0,
    },
    records: [],
  };
  reviewPack.uncertainty_coverage_report = {
    analysis_confidence: 'heuristic',
    numeric_score: 0.72,
    partial_evidence: true,
    missing_inputs: ['inspection_evidence'],
    coverage: {
      source_file_count: 1,
      inspection_anomaly_count: 0,
      quality_pattern_count: 1,
      evidence_record_count: 0,
    },
    warnings: [],
  };
  reviewPack.data_quality_notes = [{
    severity: 'info',
    message: 'Missing or limited inspection evidence; review-pack remains usable with partial evidence.',
  }];
  reviewPack.source_artifact_refs = (reviewPack.source_artifact_refs || [])
    .filter((ref) => ref.artifact_type !== 'inspection_evidence');
  return reviewPack;
}

function validInspectionEvidenceLedgerRecord() {
  return {
    evidence_id: `package:inspection_evidence:${INSPECTION_SOURCE_REF}`,
    type: 'inspection_evidence',
    artifact_type: 'inspection_evidence',
    category: 'inspection_evidence',
    classifications: ['inspection_evidence'],
    source_ref: INSPECTION_SOURCE_REF,
    file_name: 'valid-manual-caliper-inspection.json',
    title: 'Inspection evidence',
    score: null,
    rationale: 'Validated inspection evidence supplied as explicit review-context side input.',
    confidence: null,
    size_bytes: 1024,
    sha256: 'a'.repeat(64),
    inspection_evidence: true,
  };
}

function addLedgerRecords(reviewPack, records) {
  reviewPack.evidence_ledger.records = records;
  reviewPack.evidence_ledger.record_count = records.length;
  reviewPack.evidence_ledger.counts_by_type = records.reduce((counts, record) => {
    const type = record.type || 'unknown';
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
}

function missingInputsFrom(report) {
  return report.review_pack.uncertainty_coverage_report.missing_inputs || [];
}

function assertInspectionEvidenceMissing(name, reviewPack) {
  const report = buildReadinessReportFromReviewPack({
    reviewPack,
    reviewPackPath: 'tmp/non-canonical/review_pack.json',
    generatedAt: '2026-04-27T00:00:00Z',
  });
  assert.equal(
    missingInputsFrom(report).includes('inspection_evidence'),
    true,
    `${name} should not satisfy inspection_evidence`
  );
  assert.equal(report.process_plan.summary.missing_inputs.includes('inspection_evidence'), true);
  assert.equal(report.quality_risk.summary.missing_inputs.includes('inspection_evidence'), true);
  assert.equal(report.readiness_summary.status, 'needs_more_evidence');
}

const withoutInspectionEvidence = basePartialInspectionPack();
assertInspectionEvidenceMissing('review_pack without explicit inspection evidence', withoutInspectionEvidence);

const generatedEvidenceOnly = basePartialInspectionPack();
addLedgerRecords(generatedEvidenceOnly, [
  {
    evidence_id: 'package:create_quality_report:docs/examples/motor-mount/quality/cnc_motor_mount_bracket_create_quality.json',
    type: 'create_quality_report',
    artifact_type: 'create_quality_report',
    category: 'quality_evidence',
    classifications: ['quality_evidence'],
    source_ref: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_create_quality.json',
    sha256: 'b'.repeat(64),
    inspection_evidence: false,
  },
  {
    evidence_id: 'package:drawing_quality_report:docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_quality.json',
    type: 'drawing_quality_report',
    artifact_type: 'drawing_quality_report',
    category: 'quality_evidence',
    classifications: ['quality_evidence', 'drawing_evidence'],
    source_ref: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_quality.json',
    sha256: 'c'.repeat(64),
    inspection_evidence: false,
  },
  {
    evidence_id: 'package:drawing_qa_report:docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_qa.json',
    type: 'drawing_qa_report',
    artifact_type: 'drawing_qa_report',
    category: 'quality_evidence',
    classifications: ['quality_evidence', 'drawing_evidence'],
    source_ref: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_qa.json',
    sha256: 'd'.repeat(64),
    inspection_evidence: false,
  },
  {
    evidence_id: 'package:drawing_intent:docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_drawing_intent.json',
    type: 'drawing_intent',
    artifact_type: 'drawing_intent',
    category: 'design_traceability_evidence',
    classifications: ['design_traceability_evidence', 'advisory_context'],
    source_ref: 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_drawing_intent.json',
    sha256: 'e'.repeat(64),
    inspection_evidence: false,
  },
  {
    evidence_id: 'package:feature_catalog:docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_feature_catalog.json',
    type: 'feature_catalog',
    artifact_type: 'feature_catalog',
    category: 'design_traceability_evidence',
    classifications: ['design_traceability_evidence', 'advisory_context'],
    source_ref: 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_feature_catalog.json',
    sha256: 'f'.repeat(64),
    inspection_evidence: false,
  },
  {
    evidence_id: 'package:dfm_report:docs/examples/motor-mount/review/dfm_report.json',
    type: 'dfm_report',
    artifact_type: 'dfm_report',
    category: 'quality_evidence',
    classifications: ['quality_evidence'],
    source_ref: 'docs/examples/motor-mount/review/dfm_report.json',
    sha256: '1'.repeat(64),
    inspection_evidence: false,
  },
]);
assertInspectionEvidenceMissing('generated quality and drawing evidence only', generatedEvidenceOnly);

const genericEvidence = basePartialInspectionPack();
addLedgerRecords(genericEvidence, [
  {
    evidence_id: 'package:generic:inspection-note',
    type: 'generic_evidence',
    artifact_type: 'generic_evidence',
    category: 'inspection_evidence',
    classifications: ['inspection_evidence'],
    source_ref: INSPECTION_SOURCE_REF,
    sha256: '2'.repeat(64),
    inspection_evidence: true,
  },
]);
genericEvidence.source_artifact_refs.push({
  artifact_type: 'generic_evidence',
  path: INSPECTION_SOURCE_REF,
  role: 'evidence',
  label: 'Generic evidence',
});
assertInspectionEvidenceMissing('generic evidence with inspection-like classification', genericEvidence);

const withValidatedInspectionEvidence = basePartialInspectionPack();
addLedgerRecords(withValidatedInspectionEvidence, [validInspectionEvidenceLedgerRecord()]);
withValidatedInspectionEvidence.source_artifact_refs.push({
  artifact_type: 'inspection_evidence',
  path: INSPECTION_SOURCE_REF,
  role: 'evidence',
  label: 'Inspection evidence',
});

const recognizedReport = buildReadinessReportFromReviewPack({
  reviewPack: withValidatedInspectionEvidence,
  reviewPackPath: 'tmp/non-canonical/review_pack.json',
  generatedAt: '2026-04-27T00:00:00Z',
});
assert.equal(missingInputsFrom(recognizedReport).includes('inspection_evidence'), false);
assert.equal(
  recognizedReport.process_plan.summary.missing_inputs.includes('inspection_evidence'),
  false
);
assert.equal(
  recognizedReport.quality_risk.summary.missing_inputs.includes('inspection_evidence'),
  false
);
assert.equal(
  recognizedReport.review_pack.uncertainty_coverage_report.coverage.inspection_evidence_record_count,
  1
);
assert.equal(
  (recognizedReport.review_pack.data_quality_notes || []).some((note) => (
    /Missing or limited inspection evidence/i.test(note.message || '')
  )),
  false
);

console.log('readiness-inspection-evidence-contract.test.js: ok');
