import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  REVISION_IMPACT_CHANGE_TYPES,
  REVISION_IMPACT_DECISIONS,
  REVISION_IMPACT_EVIDENCE_STATUSES,
  REVISION_IMPACT_SCHEMA_VERSION,
  RevisionImpactValidationError,
  assertValidRevisionImpactReport,
  buildRevisionImpactStableId,
  canonicalizeRevisionImpactJson,
  hashRevisionImpactValue,
  renderRevisionImpactMarkdown,
  validateRevisionImpactReport,
} from '../lib/revision-impact-contract.js';

const GENERATED_AT = '2026-07-11T00:00:00Z';
const BASELINE_REF = 'tests/fixtures/revision-impact/baseline_review_pack.json';
const CANDIDATE_REF = 'tests/fixtures/revision-impact/candidate_review_pack.json';
const BASELINE_HASH = hashRevisionImpactValue({ fixture: 'baseline-review-pack' });
const CANDIDATE_HASH = hashRevisionImpactValue({ fixture: 'candidate-review-pack' });

function clone(value) {
  return structuredClone(value);
}

function boundaries() {
  return {
    generated_review_artifact: true,
    inspection_evidence_attached: false,
    existing_evidence_mutated: false,
    evidence_superseded: false,
    readiness_regenerated: false,
    canonical_artifacts_mutated: false,
    release_published: false,
    measured_values_generated: false,
  };
}

function revisionIdentity(revision, ref, hash) {
  return {
    package_slug: 'sample-bracket',
    part_id: 'PART-100',
    revision,
    artifact_refs: [ref],
    source_hashes: { review_pack: hash },
  };
}

function buildNoChangeReport() {
  return {
    artifact_type: 'revision_impact_report',
    schema_version: '1.0',
    generated_at: GENERATED_AT,
    baseline: revisionIdentity('A', BASELINE_REF, BASELINE_HASH),
    candidate: revisionIdentity('A', CANDIDATE_REF, CANDIDATE_HASH),
    summary: {
      decision: 'no_material_change',
      material_change_count: 0,
      review_required_count: 0,
      reinspection_required_count: 0,
      unable_to_determine_count: 0,
      readiness_review_required: false,
    },
    changes: [],
    evidence_applicability: {
      assessments: [],
      authoritative_evidence_state_changed: false,
    },
    reinspection_plan: {
      status: 'not_required',
      items: [],
      human_authorization_required: true,
    },
    boundaries: boundaries(),
  };
}

function buildReinspectionReport() {
  const changeId = buildRevisionImpactStableId('change', {
    affected_entity_id: 'CHAR.HOLE_DIAMETER',
    after_value: { lower: -0.1, upper: 0.1 },
    before_value: { lower: -0.2, upper: 0.2 },
    candidate_revision: 'B',
    change_type: 'tolerance_change',
    package_slug: 'sample-bracket',
  });
  const assessmentId = buildRevisionImpactStableId('assessment', {
    candidate_revision: 'B',
    evidence_or_characteristic_id: 'CHAR.HOLE_DIAMETER',
    related_change_ids: [changeId],
    status: 'reinspection_required',
  });
  const planItemId = buildRevisionImpactStableId('plan', {
    affected_entity_id: 'CHAR.HOLE_DIAMETER',
    candidate_revision: 'B',
    related_change_ids: [changeId],
  });

  return {
    artifact_type: 'revision_impact_report',
    schema_version: '1.0',
    generated_at: GENERATED_AT,
    baseline: revisionIdentity('A', BASELINE_REF, BASELINE_HASH),
    candidate: revisionIdentity('B', CANDIDATE_REF, CANDIDATE_HASH),
    summary: {
      decision: 'reinspection_required',
      material_change_count: 1,
      review_required_count: 0,
      reinspection_required_count: 1,
      unable_to_determine_count: 0,
      readiness_review_required: true,
    },
    changes: [{
      change_id: changeId,
      change_type: 'tolerance_change',
      affected_entity_id: 'CHAR.HOLE_DIAMETER',
      baseline_source_ref: BASELINE_REF,
      candidate_source_ref: CANDIDATE_REF,
      before_value: { upper: 0.2, lower: -0.2 },
      after_value: { upper: 0.1, lower: -0.1 },
      unit: 'mm',
      determinability: 'determined',
      rationale: 'The released characteristic tolerance is tighter in the candidate revision.',
      severity: 'high',
      required_action: 'reinspect',
      source_hashes: {
        baseline: BASELINE_HASH,
        candidate: CANDIDATE_HASH,
      },
    }],
    evidence_applicability: {
      assessments: [{
        assessment_id: assessmentId,
        evidence_or_characteristic_id: 'CHAR.HOLE_DIAMETER',
        source_envelope_or_receipt_ref: 'docs/examples/sample-bracket/inspection/inspection_evidence_attachment.json',
        baseline_package_revision: 'A',
        candidate_package_revision: 'B',
        related_change_ids: [changeId],
        applicability_status: 'reinspection_required',
        rationale: 'The prior characteristic result used the wider baseline tolerance.',
        reinspection_action: 'Repeat the released characteristic inspection for revision B.',
        human_decision_required: true,
        authoritative_evidence_state_changed: false,
      }],
      authoritative_evidence_state_changed: false,
    },
    reinspection_plan: {
      status: 'planned',
      items: [{
        plan_item_id: planItemId,
        package_slug: 'sample-bracket',
        candidate_revision: 'B',
        affected_entity_id: 'CHAR.HOLE_DIAMETER',
        related_change_ids: [changeId],
        nominal_value: 10,
        tolerance: { lower: -0.1, upper: 0.1, unit: 'mm' },
        specification_ref: 'DWG-100:HOLE_DIAMETER',
        recommended_inspection_scope: 'Inspect the hole diameter against the revision B drawing requirement.',
        suggested_method: 'calibrated_bore_gauge',
        required_evidence_fields: [
          'inspector_identity_ref',
          'measured_value',
          'source_checksum',
        ],
        reason: 'The authoritative tolerance changed and the prior result does not prove the candidate requirement.',
        source_artifact_refs: [CANDIDATE_REF],
        human_reviewer_required: true,
        attachment_authorization_required: true,
        readiness_regeneration_required_later: true,
        execution_status: 'not_started',
      }],
      human_authorization_required: true,
    },
    boundaries: boundaries(),
  };
}

function buildReviewReport() {
  const changeId = buildRevisionImpactStableId('change', {
    after_revision: 'B',
    before_revision: 'A',
    change_type: 'revision_identity_change',
    package_slug: 'sample-bracket',
  });
  const report = buildNoChangeReport();
  report.candidate.revision = 'B';
  report.summary = {
    decision: 'review_required',
    material_change_count: 0,
    review_required_count: 1,
    reinspection_required_count: 0,
    unable_to_determine_count: 0,
    readiness_review_required: true,
  };
  report.changes = [{
    change_id: changeId,
    change_type: 'revision_identity_change',
    affected_entity_id: 'package.revision',
    baseline_source_ref: BASELINE_REF,
    candidate_source_ref: CANDIDATE_REF,
    before_value: 'A',
    after_value: 'B',
    unit: null,
    determinability: 'determined',
    rationale: 'The revision identifier changed without a normalized engineering-content change.',
    severity: 'low',
    required_action: 'human_review',
    source_hashes: { baseline: BASELINE_HASH, candidate: CANDIDATE_HASH },
  }];
  report.reinspection_plan.status = 'review_required';
  return report;
}

function buildBlockedIdentityReport() {
  const changeId = buildRevisionImpactStableId('change', {
    candidate_revision: 'B',
    change_type: 'unresolved_identity_change',
    package_slug: 'sample-bracket',
    reason: 'baseline_revision_missing',
  });
  const assessmentId = buildRevisionImpactStableId('assessment', {
    candidate_revision: 'B',
    evidence_or_characteristic_id: 'package.identity_mapping',
    related_change_ids: [changeId],
    status: 'unable_to_determine',
  });
  const report = buildNoChangeReport();
  report.baseline.revision = null;
  report.candidate.revision = 'B';
  report.summary = {
    decision: 'blocked_insufficient_identity_or_inputs',
    material_change_count: 1,
    review_required_count: 0,
    reinspection_required_count: 0,
    unable_to_determine_count: 2,
    readiness_review_required: true,
  };
  report.changes = [{
    change_id: changeId,
    change_type: 'unresolved_identity_change',
    affected_entity_id: null,
    baseline_source_ref: BASELINE_REF,
    candidate_source_ref: CANDIDATE_REF,
    before_value: null,
    after_value: 'Candidate revision B has no trustworthy baseline revision mapping.',
    unit: null,
    determinability: 'unable_to_determine',
    rationale: 'The authoritative baseline revision is missing, so identity equivalence is not inferred.',
    severity: 'blocking',
    required_action: 'resolve_identity_or_inputs',
    source_hashes: { baseline: BASELINE_HASH, candidate: CANDIDATE_HASH },
  }];
  report.evidence_applicability.assessments = [{
    assessment_id: assessmentId,
    evidence_or_characteristic_id: 'package.identity_mapping',
    source_envelope_or_receipt_ref: null,
    baseline_package_revision: null,
    candidate_package_revision: 'B',
    related_change_ids: [changeId],
    applicability_status: 'unable_to_determine',
    rationale: 'No characteristic mapping is authoritative without the baseline revision identity.',
    reinspection_action: 'Resolve the baseline revision and repeat the applicability assessment.',
    human_decision_required: true,
    authoritative_evidence_state_changed: false,
  }];
  report.reinspection_plan.status = 'blocked';
  return report;
}

function errorCodes(report) {
  return validateRevisionImpactReport(report).errors.map((error) => error.code);
}

function assertInvalidWith(report, expectedCode) {
  const validation = validateRevisionImpactReport(report);
  assert.equal(validation.ok, false, `expected invalid report for ${expectedCode}`);
  assert.equal(
    validation.errors.some((error) => error.code === expectedCode),
    true,
    `expected ${expectedCode}; received ${validation.errors.map((error) => `${error.code}:${error.path}`).join(', ')}`
  );
  return validation;
}

assert.equal(REVISION_IMPACT_SCHEMA_VERSION, '1.0');
assert.deepEqual(REVISION_IMPACT_DECISIONS, [
  'no_material_change',
  'review_required',
  'reinspection_required',
  'blocked_insufficient_identity_or_inputs',
]);
assert.equal(REVISION_IMPACT_CHANGE_TYPES.length, 17);
assert.equal(REVISION_IMPACT_CHANGE_TYPES.includes('tolerance_change'), true);
assert.equal(REVISION_IMPACT_CHANGE_TYPES.includes('unresolved_identity_change'), true);
assert.deepEqual(REVISION_IMPACT_EVIDENCE_STATUSES, [
  'unaffected',
  'review_required',
  'reinspection_required',
  'potentially_stale',
  'unable_to_determine',
  'not_applicable',
]);

// Canonical JSON sorts every object key without silently reordering arrays.
const canonicalInput = {
  z: 3,
  a: { z: 4, a: 1 },
  array: [{ z: 2, a: 1 }, 'second'],
};
const canonicalExpected = [
  '{',
  '  "a": {',
  '    "a": 1,',
  '    "z": 4',
  '  },',
  '  "array": [',
  '    {',
  '      "a": 1,',
  '      "z": 2',
  '    },',
  '    "second"',
  '  ],',
  '  "z": 3',
  '}',
  '',
].join('\n');
assert.equal(canonicalizeRevisionImpactJson(canonicalInput), canonicalExpected);
assert.equal(
  hashRevisionImpactValue(canonicalInput),
  createHash('sha256').update(canonicalExpected).digest('hex')
);
assert.equal(
  hashRevisionImpactValue({ z: 3, a: { z: 4, a: 1 }, array: [{ z: 2, a: 1 }, 'second'] }),
  hashRevisionImpactValue({ array: [{ a: 1, z: 2 }, 'second'], a: { a: 1, z: 4 }, z: 3 })
);
assert.equal(
  buildRevisionImpactStableId('change', { entity: 'CHAR.A', type: 'tolerance_change' }),
  buildRevisionImpactStableId('change', { type: 'tolerance_change', entity: 'CHAR.A' })
);
assert.match(buildRevisionImpactStableId('plan', { entity: 'CHAR.A' }), /^plan_[a-f0-9]{64}$/);
assert.throws(
  () => buildRevisionImpactStableId('change', { generated_at: GENERATED_AT, entity: 'CHAR.A' }),
  (error) => error.code === 'volatile_stable_id_basis'
);
assert.throws(
  () => buildRevisionImpactStableId('../change', { entity: 'CHAR.A' }),
  (error) => error.code === 'invalid_stable_id_prefix'
);
assert.throws(() => canonicalizeRevisionImpactJson({ invalid: Number.NaN }), (error) => error.code === 'non_finite_number');
assert.throws(() => canonicalizeRevisionImpactJson({ invalid: undefined }), (error) => error.code === 'non_json_value');
assert.throws(() => canonicalizeRevisionImpactJson({ invalid: new Date(GENERATED_AT) }), (error) => error.code === 'non_json_object');
const sparse = [];
sparse.length = 1;
assert.throws(() => canonicalizeRevisionImpactJson(sparse), (error) => error.code === 'non_json_value');
const cyclic = {};
cyclic.self = cyclic;
assert.throws(() => canonicalizeRevisionImpactJson(cyclic), (error) => error.code === 'json_cycle_forbidden');

// The strict shape and semantic contract accept all three safe decision modes.
const noChangeReport = buildNoChangeReport();
const reviewReport = buildReviewReport();
const reinspectionReport = buildReinspectionReport();
const blockedReport = buildBlockedIdentityReport();
for (const report of [noChangeReport, reviewReport, reinspectionReport, blockedReport]) {
  const before = canonicalizeRevisionImpactJson(report);
  assert.deepEqual(validateRevisionImpactReport(report), { ok: true, errors: [] });
  assert.equal(assertValidRevisionImpactReport(report), report);
  const markdown = renderRevisionImpactMarkdown(report);
  assert.match(markdown, /^# Revision Impact Report\n/);
  assert.match(markdown, /canonical_artifacts_mutated: <code>false<\/code>/);
  assert.equal(markdown, renderRevisionImpactMarkdown(report));
  assert.equal(canonicalizeRevisionImpactJson(report), before, 'validation and rendering must not mutate the report');
}
assert.match(renderRevisionImpactMarkdown(reinspectionReport), new RegExp(reinspectionReport.changes[0].change_id));
assert.match(renderRevisionImpactMarkdown(reinspectionReport), new RegExp(reinspectionReport.reinspection_plan.items[0].plan_item_id));

// Reordered object insertion must not affect canonical JSON or Markdown bytes.
const reorderedNoChange = {
  boundaries: clone(noChangeReport.boundaries),
  reinspection_plan: clone(noChangeReport.reinspection_plan),
  evidence_applicability: clone(noChangeReport.evidence_applicability),
  changes: clone(noChangeReport.changes),
  summary: Object.fromEntries(Object.entries(noChangeReport.summary).reverse()),
  candidate: Object.fromEntries(Object.entries(noChangeReport.candidate).reverse()),
  baseline: Object.fromEntries(Object.entries(noChangeReport.baseline).reverse()),
  generated_at: noChangeReport.generated_at,
  schema_version: noChangeReport.schema_version,
  artifact_type: noChangeReport.artifact_type,
};
assert.equal(canonicalizeRevisionImpactJson(noChangeReport), canonicalizeRevisionImpactJson(reorderedNoChange));
assert.equal(renderRevisionImpactMarkdown(noChangeReport), renderRevisionImpactMarkdown(reorderedNoChange));

// Thin, open-ended, or out-of-taxonomy documents fail AJV structural validation.
assertInvalidWith({ artifact_type: 'revision_impact_report', schema_version: '1.0' }, 'schema_required');
const extraField = clone(noChangeReport);
extraField.claim = 'unbounded';
assertInvalidWith(extraField, 'schema_additionalProperties');
const invalidTaxonomy = clone(reinspectionReport);
invalidTaxonomy.changes[0].change_type = 'approximately_the_same';
assertInvalidWith(invalidTaxonomy, 'schema_enum');
const invalidTimestamp = clone(noChangeReport);
invalidTimestamp.generated_at = '2026-99-99T00:00:00Z';
assertInvalidWith(invalidTimestamp, 'invalid_generated_at');

// Duplicate stable identities and duplicate characteristic assessments fail semantically.
const duplicateChange = clone(reinspectionReport);
duplicateChange.changes.push({ ...clone(duplicateChange.changes[0]), rationale: 'Duplicate stable change identity.' });
assertInvalidWith(duplicateChange, 'duplicate_change_id');
const duplicateAssessmentId = clone(reinspectionReport);
duplicateAssessmentId.evidence_applicability.assessments.push({
  ...clone(duplicateAssessmentId.evidence_applicability.assessments[0]),
  rationale: 'Duplicate assessment identity.',
});
assertInvalidWith(duplicateAssessmentId, 'duplicate_assessment_id');
const duplicateCharacteristic = clone(reinspectionReport);
duplicateCharacteristic.evidence_applicability.assessments.push({
  ...clone(duplicateCharacteristic.evidence_applicability.assessments[0]),
  assessment_id: buildRevisionImpactStableId('assessment', { duplicate: 'characteristic-target' }),
  rationale: 'A second assessment for the same characteristic.',
});
duplicateCharacteristic.evidence_applicability.assessments.sort((left, right) => (
  left.assessment_id < right.assessment_id ? -1 : 1
));
assertInvalidWith(duplicateCharacteristic, 'duplicate_characteristic_assessment');
const duplicatePlanItem = clone(reinspectionReport);
duplicatePlanItem.reinspection_plan.items.push({
  ...clone(duplicatePlanItem.reinspection_plan.items[0]),
  reason: 'Duplicate plan identity.',
});
assertInvalidWith(duplicatePlanItem, 'duplicate_plan_item_id');
const duplicateStableIdAcrossSections = clone(reinspectionReport);
duplicateStableIdAcrossSections.evidence_applicability.assessments[0].assessment_id = (
  duplicateStableIdAcrossSections.changes[0].change_id
);
assertInvalidWith(duplicateStableIdAcrossSections, 'duplicate_stable_id');

// Every assessment and plan item must link to a known canonical change.
const danglingAssessment = clone(reinspectionReport);
danglingAssessment.evidence_applicability.assessments[0].related_change_ids = [
  buildRevisionImpactStableId('change', { missing: 'assessment-link' }),
];
assertInvalidWith(danglingAssessment, 'unknown_related_change_id');
const danglingPlan = clone(reinspectionReport);
danglingPlan.reinspection_plan.items[0].related_change_ids = [
  buildRevisionImpactStableId('change', { missing: 'plan-link' }),
];
assertInvalidWith(danglingPlan, 'unknown_related_change_id');

// Counts, decision/status coupling, revision binding, and deterministic arrays are semantic invariants.
const wrongCount = clone(reinspectionReport);
wrongCount.summary.reinspection_required_count = 0;
assertInvalidWith(wrongCount, 'summary_count_mismatch');
const wrongStatus = clone(reinspectionReport);
wrongStatus.reinspection_plan.status = 'review_required';
assertInvalidWith(wrongStatus, 'reinspection_required_decision_inconsistent');
const revisionMismatch = clone(reinspectionReport);
revisionMismatch.evidence_applicability.assessments[0].candidate_package_revision = 'C';
assertInvalidWith(revisionMismatch, 'assessment_candidate_revision_mismatch');
const packageMismatch = clone(blockedReport);
packageMismatch.candidate.package_slug = 'other-package';
assertInvalidWith(packageMismatch, 'package_mismatch');
const partMismatch = clone(blockedReport);
partMismatch.candidate.part_id = 'PART-OTHER';
assertInvalidWith(partMismatch, 'part_id_mismatch');
const unstableRefs = clone(noChangeReport);
unstableRefs.baseline.artifact_refs = ['z/source.json', 'a/source.json'];
assertInvalidWith(unstableRefs, 'non_deterministic_order');
const identicalDelta = clone(reinspectionReport);
identicalDelta.changes[0].after_value = clone(identicalDelta.changes[0].before_value);
assertInvalidWith(identicalDelta, 'change_without_delta');

// Non-mutation boundaries are enforced even when AJV also rejects the const.
for (const key of [
  'inspection_evidence_attached',
  'existing_evidence_mutated',
  'evidence_superseded',
  'readiness_regenerated',
  'canonical_artifacts_mutated',
  'release_published',
  'measured_values_generated',
]) {
  const mutated = clone(noChangeReport);
  mutated.boundaries[key] = true;
  assertInvalidWith(mutated, 'mutation_boundary_violation');
}
const evidenceMutation = clone(noChangeReport);
evidenceMutation.evidence_applicability.authoritative_evidence_state_changed = true;
assertInvalidWith(evidenceMutation, 'evidence_state_mutation_forbidden');

// Finite numbers, portable refs, and onboarding-grade control-material privacy remain mandatory.
const nonFinite = clone(reinspectionReport);
nonFinite.changes[0].after_value = Number.POSITIVE_INFINITY;
assertInvalidWith(nonFinite, 'non_finite_number');
const absolutePath = clone(noChangeReport);
absolutePath.baseline.artifact_refs = ['/Users/alice/private/review.json'];
assertInvalidWith(absolutePath, 'private_path_exposed');
const traversalRef = clone(noChangeReport);
traversalRef.baseline.artifact_refs = ['../private/review.json'];
assertInvalidWith(traversalRef, 'schema_pattern');
for (const unsafeRef of [
  'local/inspection-evidence-quarantine/sample-bracket/receipt.json',
  'local/stage5b-candidate-evidence-inbox/sample-bracket/source.csv',
  'output/revision-impact/private-source.json',
  'tmp/codex/revision-impact/private-source.json',
]) {
  const localRef = clone(reinspectionReport);
  localRef.evidence_applicability.assessments[0].source_envelope_or_receipt_ref = unsafeRef;
  assertInvalidWith(localRef, 'unsafe_public_artifact_ref');
}
const privateUrl = clone(reinspectionReport);
privateUrl.changes[0].rationale = 'http://127.0.0.1:8787/private-report';
assertInvalidWith(privateUrl, 'private_url_exposed');
const secret = clone(reinspectionReport);
secret.changes[0].rationale = 'api_key=TOPSECRET';
assertInvalidWith(secret, 'secret_material_exposed');
const credentialUrl = clone(reinspectionReport);
credentialUrl.changes[0].rationale = 'https://supplier.example/report?access_token=TOPSECRET';
assertInvalidWith(credentialUrl, 'secret_material_exposed');
const bearerToken = clone(reinspectionReport);
bearerToken.changes[0].rationale = 'Authorization material: Bearer abcdefghijklmnopqrstuvwxyz';
assertInvalidWith(bearerToken, 'secret_material_exposed');
const rawSupplierContent = clone(reinspectionReport);
rawSupplierContent.changes[0].before_value = { supplier_report_content: 'private source payload' };
assertInvalidWith(rawSupplierContent, 'raw_private_source_content_exposed');

// The report may recommend future work, but cannot claim authority or completed evidence/readiness state.
for (const claim of [
  'Inspection passed for revision B.',
  'The comparison concludes that inspection passed for revision B.',
  'Evidence has been accepted for revision B.',
  'The comparison says evidence was attached to revision B.',
  'Package is ready for production.',
  'Production-ready revision B.',
  'Readiness has been approved.',
]) {
  const unsafeClaim = clone(reinspectionReport);
  unsafeClaim.changes[0].rationale = claim;
  assertInvalidWith(unsafeClaim, 'forbidden_authority_claim');
  assert.throws(
    () => renderRevisionImpactMarkdown(unsafeClaim),
    (error) => error instanceof RevisionImpactValidationError
      && error.code === 'revision_impact_report_validation_failed'
  );
}

// Validation errors are stable, structured, and thrown only by the asserting API.
const invalid = clone(noChangeReport);
invalid.summary.material_change_count = 4;
const firstErrors = validateRevisionImpactReport(invalid);
const secondErrors = validateRevisionImpactReport(invalid);
assert.deepEqual(firstErrors, secondErrors);
assert.equal(errorCodes(invalid).includes('summary_count_mismatch'), true);
assert.throws(
  () => assertValidRevisionImpactReport(invalid, { context: 'focused contract test' }),
  (error) => error instanceof RevisionImpactValidationError
    && error.code === 'revision_impact_report_validation_failed'
    && error.context === 'focused contract test'
    && error.errors.some((entry) => entry.code === 'summary_count_mismatch')
);

console.log('revision-impact-contract.test.js: ok');
