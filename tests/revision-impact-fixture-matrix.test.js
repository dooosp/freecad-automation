import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateDArtifact } from '../lib/d-artifact-schema.js';
import {
  buildRevisionImpactReport,
  loadRevisionImpactInputSet,
} from '../src/services/revision-impact/revision-impact-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const GENERATED_AT = '2026-07-11T00:00:00Z';
const matrix = JSON.parse(readFileSync(
  resolve(ROOT, 'tests/fixtures/revision-impact/case-matrix.json'),
  'utf8'
));

assert.equal(matrix.test_scope, 'fixture');
assert.equal(matrix.production_trust, false);
assert.equal(matrix.artifact_type, 'revision_impact_fixture_matrix');
assert.equal(matrix.cases.length, 18);

const ids = matrix.cases.map((entry) => entry.id);
assert.equal(new Set(ids).size, ids.length, 'fixture case IDs must be unique');

for (const required of [
  'no_material_change',
  'metadata_only_change',
  'nominal_dimension_change',
  'tightened_tolerance',
  'loosened_tolerance',
  'changed_datum',
  'added_critical_characteristic',
  'removed_characteristic',
  'material_change',
  'manufacturing_process_change',
  'content_change_without_revision_increment',
  'revision_increment_without_engineering_change',
  'missing_baseline_revision',
  'missing_stable_feature_identity',
  'evidence_receipt_revision_mismatch',
  'evidence_source_checksum_mismatch',
  'synthetic_generated_evidence_marker',
  'unrelated_characteristic_unaffected',
]) {
  assert.equal(ids.includes(required), true, `missing fixture case ${required}`);
}

for (const entry of matrix.cases.filter((item) => item.baseline_evidence)) {
  assert.equal(entry.baseline_evidence.test_scope, 'fixture');
  assert.equal(entry.baseline_evidence.production_trust, false);
}

function readFixture(relativePath) {
  return JSON.parse(readFileSync(resolve(ROOT, relativePath), 'utf8'));
}

function assertSafeFixtureReviewPack(document, relativePath) {
  const validation = validateDArtifact('review_pack', document);
  assert.equal(validation.ok, true, `${relativePath} schema errors:\n${validation.errors.join('\n')}`);
  assert.equal(document.test_scope, 'fixture', `${relativePath} must declare fixture scope`);
  assert.equal(document.production_trust, false, `${relativePath} must deny production trust`);
  assert.equal(document.artifact_type, 'review_pack');
  assert.equal(document.schema_version, '1.0');
  assert.equal(document.package_slug, 'fixture-bracket');
  assert.equal(document.metadata.package_slug, 'fixture-bracket');
  assert.equal(document.inspection_linkage.records.length, 1);
  const requirement = document.inspection_linkage.records[0];
  assert.equal(requirement.test_scope, 'fixture');
  assert.equal(requirement.production_trust, false);
  assert.equal(requirement.record_role, 'inspection_requirement');
  assert.equal(Object.hasOwn(requirement, 'measured_value'), false, 'fixture must not fabricate a measured value');
  assert.equal(Object.hasOwn(requirement, 'inspection_result'), false, 'fixture must not fabricate an inspection result');

  const intentRef = document.source_artifact_refs.find((entry) => entry.artifact_type === 'drawing_intent');
  assert.ok(intentRef, `${relativePath} must declare its drawing-intent input`);
  const intentBytes = readFileSync(resolve(ROOT, intentRef.path));
  const intent = JSON.parse(intentBytes);
  assert.equal(intent.test_scope, 'fixture');
  assert.equal(intent.production_trust, false);
  assert.equal(intent.required_dimensions.length, 1);
  assert.equal(intent.required_dimensions[0].id, 'CHAR.HOLE_DIAMETER');
  assert.equal(Object.hasOwn(intent.required_dimensions[0], 'measured_value'), false);
  const ledgerRecord = document.evidence_ledger.records.find((entry) => entry.source_ref === intentRef.path);
  assert.equal(document.evidence_ledger.test_scope, 'fixture');
  assert.equal(document.evidence_ledger.production_trust, false);
  assert.ok(ledgerRecord, `${relativePath} must bind the drawing-intent ref in its evidence ledger`);
  assert.equal(ledgerRecord.test_scope, 'fixture');
  assert.equal(ledgerRecord.production_trust, false);
  assert.equal(ledgerRecord.inspection_evidence, false);
  assert.equal(ledgerRecord.size_bytes, intentBytes.length);
  assert.equal(ledgerRecord.sha256, createHash('sha256').update(intentBytes).digest('hex'));
  return intent;
}

const cliScenarioNames = Object.keys(matrix.cli_scenarios);
assert.deepEqual(cliScenarioNames, ['unchanged', 'tightened_tolerance', 'missing_identity']);
const loadedByPath = new Map();
const intentByReviewPackPath = new Map();
for (const scenario of Object.values(matrix.cli_scenarios)) {
  for (const key of ['baseline_review_pack', 'candidate_review_pack']) {
    const relativePath = scenario[key];
    if (!loadedByPath.has(relativePath)) loadedByPath.set(relativePath, readFixture(relativePath));
    intentByReviewPackPath.set(
      relativePath,
      assertSafeFixtureReviewPack(loadedByPath.get(relativePath), relativePath)
    );
  }
}

const unchangedScenario = matrix.cli_scenarios.unchanged;
const unchangedBaselineBytes = readFileSync(resolve(ROOT, unchangedScenario.baseline_review_pack));
const unchangedCandidateBytes = readFileSync(resolve(ROOT, unchangedScenario.candidate_review_pack));
assert.deepEqual(unchangedBaselineBytes, unchangedCandidateBytes, 'unchanged CLI inputs must be byte-identical');
const unchanged = loadedByPath.get(unchangedScenario.baseline_review_pack);
const unchangedIntent = intentByReviewPackPath.get(unchangedScenario.baseline_review_pack);
assert.equal(unchanged.revision, 'A');
assert.equal(unchanged.part.revision, 'A');
assert.equal(unchanged.package_slug, 'fixture-bracket');
assert.equal(unchangedIntent.revision, 'A');
assert.equal(unchangedIntent.required_dimensions[0].tolerance, '±0.20 mm');
assert.deepEqual(unchanged.fixture_expectation, {
  decision: 'no_material_change',
  material_change_count: 0,
  reinspection_required_count: 0,
  unable_to_determine_count: 0,
});

const tightenedScenario = matrix.cli_scenarios.tightened_tolerance;
const tightenedBaseline = loadedByPath.get(tightenedScenario.baseline_review_pack);
const tightenedCandidate = loadedByPath.get(tightenedScenario.candidate_review_pack);
const tightenedBaselineIntent = intentByReviewPackPath.get(tightenedScenario.baseline_review_pack);
const tightenedCandidateIntent = intentByReviewPackPath.get(tightenedScenario.candidate_review_pack);
const baselineCharacteristic = tightenedBaseline.inspection_linkage.records[0];
const candidateCharacteristic = tightenedCandidate.inspection_linkage.records[0];
assert.equal(tightenedBaseline.revision, 'A');
assert.equal(tightenedCandidate.revision, 'B');
assert.equal(baselineCharacteristic.characteristic_id, 'CHAR.HOLE_DIAMETER');
assert.equal(candidateCharacteristic.characteristic_id, baselineCharacteristic.characteristic_id);
assert.equal(candidateCharacteristic.feature_id, baselineCharacteristic.feature_id);
assert.equal(candidateCharacteristic.nominal_value, baselineCharacteristic.nominal_value);
assert.equal(candidateCharacteristic.unit, baselineCharacteristic.unit);
assert.equal(candidateCharacteristic.datum_reference, baselineCharacteristic.datum_reference);
assert.deepEqual(baselineCharacteristic.tolerance, { lower: -0.2, upper: 0.2 });
assert.deepEqual(candidateCharacteristic.tolerance, { lower: -0.1, upper: 0.1 });
assert.equal(tightenedBaselineIntent.required_dimensions[0].id, 'CHAR.HOLE_DIAMETER');
assert.equal(tightenedCandidateIntent.required_dimensions[0].id, 'CHAR.HOLE_DIAMETER');
assert.equal(tightenedBaselineIntent.required_dimensions[0].tolerance, '±0.20 mm');
assert.equal(tightenedCandidateIntent.required_dimensions[0].tolerance, '±0.10 mm');
assert.equal(tightenedCandidateIntent.required_dimensions[0].value_mm, 6);
assert.equal(tightenedCandidateIntent.required_dimensions[0].inspection_method, 'CMM');
assert.ok(
  candidateCharacteristic.tolerance.upper - candidateCharacteristic.tolerance.lower
    < baselineCharacteristic.tolerance.upper - baselineCharacteristic.tolerance.lower,
  'candidate tolerance must be strictly tighter than baseline tolerance'
);
assert.deepEqual(tightenedBaseline.fixture_expectation, tightenedCandidate.fixture_expectation);
assert.equal(tightenedCandidate.fixture_expectation.change_type, 'tolerance_change');
assert.equal(tightenedCandidate.fixture_expectation.applicability_status, 'reinspection_required');
assert.equal(tightenedCandidate.fixture_expectation.reinspection_required_count, 1);

const missingScenario = matrix.cli_scenarios.missing_identity;
const missingBaseline = loadedByPath.get(missingScenario.baseline_review_pack);
const missingCandidate = loadedByPath.get(missingScenario.candidate_review_pack);
const missingBaselineIntent = intentByReviewPackPath.get(missingScenario.baseline_review_pack);
const missingCandidateIntent = intentByReviewPackPath.get(missingScenario.candidate_review_pack);
assert.equal(missingBaseline.package_slug, 'fixture-bracket');
assert.equal(missingBaseline.metadata.package_slug, 'fixture-bracket');
assert.equal(missingBaseline.revision, null);
assert.equal(missingBaseline.part.revision, null);
assert.equal(missingCandidate.revision, 'B');
assert.equal(missingCandidate.part.revision, 'B');
assert.equal(missingBaselineIntent.package_slug, 'fixture-bracket');
assert.equal(missingBaselineIntent.revision, null, 'drawing intent must not repair the missing baseline revision');
assert.equal(missingCandidateIntent.revision, 'B');
assert.equal(missingBaseline.fixture_expectation.decision, 'blocked_insufficient_identity_or_inputs');
assert.equal(missingBaseline.fixture_expectation.change_type, 'unresolved_identity_change');
assert.equal(missingBaseline.fixture_expectation.determinability, 'unable_to_determine');
assert.equal(missingBaseline.fixture_expectation.guessed_identity, false);
assert.equal(missingBaseline.fixture_expectation.baseline_revision, null);
assert.deepEqual(missingBaseline.fixture_expectation, missingCandidate.fixture_expectation);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(value, key) {
  return Object.hasOwn(value, key);
}

function overrideValue(record, overrides) {
  return overrides ? { ...record, ...cloneJson(overrides) } : record;
}

function buildEvidenceInputs(entry, base, baselineRevision) {
  const fixture = entry.baseline_evidence;
  if (!fixture) return {};
  const sourceSha256 = fixture.envelope_source_sha256
    || fixture.source_document_sha256
    || 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
  const envelope = {
    test_scope: fixture.test_scope,
    production_trust: fixture.production_trust,
    synthetic: fixture.synthetic === true,
    generated: fixture.generated === true,
    evidence_id: fixture.evidence_id,
    package: {
      slug: base.package_slug,
      revision: baselineRevision,
    },
    source: {
      document: { sha256: sourceSha256 },
    },
    measured_characteristics: fixture.synthetic === true
      ? [{
        characteristic_id: 'HOLE_LEFT_DIA',
        specification_ref: 'DRW-100:A',
      }]
      : [],
  };
  if (fixture.synthetic === true) return { evidenceEnvelope: envelope };
  return {
    evidenceEnvelope: envelope,
    evidenceReceipt: {
      test_scope: fixture.test_scope,
      production_trust: fixture.production_trust,
      evidence_id: fixture.evidence_id,
      package_slug: base.package_slug,
      package_revision: fixture.package_revision ?? baselineRevision,
      source_document_sha256: fixture.receipt_source_sha256 || sourceSha256,
      resulting_canonical_artifacts: [],
    },
  };
}

function buildPolicySide(base, entry, sideName) {
  const baseline = sideName === 'baseline';
  const revisionKey = baseline ? 'baseline_revision' : 'candidate_revision';
  const defaultRevision = baseline ? base.baseline_revision : base.candidate_revision;
  const revision = hasOwn(entry, revisionKey) ? entry[revisionKey] : defaultRevision;
  const material = !baseline && hasOwn(entry, 'candidate_material')
    ? entry.candidate_material
    : base.material;
  const process = !baseline && hasOwn(entry, 'candidate_manufacturing_process')
    ? entry.candidate_manufacturing_process
    : base.manufacturing_process;
  const features = cloneJson(base.features);
  const characteristics = cloneJson(base.characteristics);

  if (!baseline) {
    for (const [id, overrides] of Object.entries(entry.candidate_feature_overrides || {})) {
      const index = features.findIndex((feature) => feature.feature_id === id);
      assert.notEqual(index, -1, `${entry.id}: unknown feature override ${id}`);
      features[index] = overrideValue(features[index], overrides);
    }
    features.push(...cloneJson(entry.candidate_features_added || []));

    for (const [id, overrides] of Object.entries(entry.candidate_characteristic_overrides || {})) {
      const index = characteristics.findIndex((characteristic) => characteristic.characteristic_id === id);
      assert.notEqual(index, -1, `${entry.id}: unknown characteristic override ${id}`);
      characteristics[index] = overrideValue(characteristics[index], overrides);
    }
    for (const id of entry.candidate_characteristics_removed || []) {
      const index = characteristics.findIndex((characteristic) => characteristic.characteristic_id === id);
      assert.notEqual(index, -1, `${entry.id}: unknown characteristic removal ${id}`);
      characteristics.splice(index, 1);
    }
    characteristics.push(...cloneJson(entry.candidate_characteristics_added || []));
  }

  const description = !baseline && entry.candidate_metadata
    ? entry.candidate_metadata.description ?? null
    : null;
  const drawingIntent = {
    material,
    manufacturing_process: process,
    required_dimensions: characteristics.map((characteristic) => ({
      id: characteristic.characteristic_id,
      feature: characteristic.feature_id,
      nominal_value: characteristic.nominal_value,
      unit: characteristic.unit,
      tolerance: characteristic.tolerance,
      datum: characteristic.datum_reference,
      required: true,
      process_sensitive: characteristic.process_sensitive === true,
      specification_ref: characteristic.specification_reference,
      inspection_method: characteristic.inspection_method,
    })),
    critical_features: features
      .filter((feature) => feature.critical === true && feature.feature_id)
      .map((feature) => feature.feature_id),
    required_notes: [],
    required_views: ['top'],
    datum_strategy: { primary: 'A' },
  };
  const side = {
    reviewPack: {
      artifact_type: 'review_pack',
      package_slug: base.package_slug,
      revision,
      part_id: base.part_id,
      part: {
        part_id: base.part_id,
        revision,
        material,
        process,
        description,
      },
      metadata: { package_slug: base.package_slug },
      geometry_features: { records: [] },
    },
    artifacts: {
      drawing_intent: { document: drawingIntent },
      feature_catalog: {
        document: {
          features: features.map((feature) => ({
            feature_id: feature.feature_id,
            type: feature.feature_type,
            critical: feature.critical === true,
            dimensions: feature.dimensions || {},
          })),
        },
      },
    },
  };
  return baseline ? { ...side, ...buildEvidenceInputs(entry, base, revision) } : side;
}

const EXPECTED_BOUNDARIES = {
  generated_review_artifact: true,
  inspection_evidence_attached: false,
  existing_evidence_mutated: false,
  evidence_superseded: false,
  readiness_regenerated: false,
  canonical_artifacts_mutated: false,
  release_published: false,
  measured_values_generated: false,
};

function assertFuturePlan(report, label) {
  const changeIds = new Set(report.changes.map((change) => change.change_id));
  for (const item of report.reinspection_plan.items) {
    assert.equal(item.execution_status, 'not_started', `${label}: plan work must remain future work`);
    assert.equal(item.human_reviewer_required, true, `${label}: plan requires a human reviewer`);
    assert.equal(item.attachment_authorization_required, true, `${label}: plan cannot attach evidence`);
    assert.equal(item.readiness_regeneration_required_later, true, `${label}: readiness work must remain later`);
    assert.equal(hasOwn(item, 'measured_value'), false, `${label}: plan must not fabricate measurements`);
    assert.equal(hasOwn(item, 'inspection_result'), false, `${label}: plan must not fabricate results`);
    assert.equal(item.related_change_ids.length > 0, true, `${label}: plan must link a material change`);
    item.related_change_ids.forEach((id) => {
      assert.equal(changeIds.has(id), true, `${label}: plan change ${id} must exist`);
    });
  }
}

function assertPolicyExpectation(entry, report) {
  const label = `fixture case ${entry.id}`;
  assert.equal(report.summary.decision, entry.expected_decision, `${label}: decision`);
  assert.equal(
    report.summary.reinspection_required_count,
    entry.expected_reinspection_count,
    `${label}: summary reinspection count`
  );
  assert.equal(report.reinspection_plan.items.length, entry.expected_reinspection_count, `${label}: plan count`);
  assert.equal(report.reinspection_plan.status, entry.expected_plan_status, `${label}: plan status`);
  assert.equal(
    report.summary.readiness_review_required,
    entry.expected_decision !== 'no_material_change',
    `${label}: readiness review flag`
  );
  assert.deepEqual(report.boundaries, EXPECTED_BOUNDARIES, `${label}: non-mutation boundaries`);
  assert.equal(report.evidence_applicability.authoritative_evidence_state_changed, false, `${label}: evidence state`);
  report.evidence_applicability.assessments.forEach((assessment) => {
    assert.equal(assessment.authoritative_evidence_state_changed, false, `${label}: assessment evidence state`);
  });

  if (hasOwn(entry, 'expected_change_count')) {
    assert.equal(report.changes.length, entry.expected_change_count, `${label}: exact change count`);
  }
  let expectedChange = null;
  if (entry.expected_change_type) {
    expectedChange = report.changes.find((change) => (
      change.change_type === entry.expected_change_type
      && (!hasOwn(entry, 'expected_change_entity')
        || change.affected_entity_id === entry.expected_change_entity)
    ));
    assert.ok(expectedChange, `${label}: expected ${entry.expected_change_type} change`);
    if (entry.expected_required_action) {
      assert.equal(expectedChange.required_action, entry.expected_required_action, `${label}: required action`);
    }
    if (entry.expected_determinability) {
      assert.equal(expectedChange.determinability, entry.expected_determinability, `${label}: determinability`);
    }
    if (entry.expected_binding_issue) {
      assert.equal(
        expectedChange.after_value?.fields?.includes(entry.expected_binding_issue),
        true,
        `${label}: receipt binding issue`
      );
    }
  }
  if (entry.expected_unable_to_determine_min !== undefined) {
    assert.equal(
      report.summary.unable_to_determine_count >= entry.expected_unable_to_determine_min,
      true,
      `${label}: unable-to-determine count`
    );
  }

  if (entry.expected_assessment_entity) {
    const assessment = report.evidence_applicability.assessments.find((item) => (
      item.evidence_or_characteristic_id === entry.expected_assessment_entity
    ));
    if (entry.expected_assessment_present === false) {
      assert.equal(assessment, undefined, `${label}: unrelated or removed entity has no evidence assessment`);
      if (entry.expected_applicability === 'unaffected') {
        assert.equal(
          report.changes.some((change) => change.affected_entity_id === entry.expected_assessment_entity),
          false,
          `${label}: unrelated characteristic must have no linked change`
        );
      }
      if (entry.expected_applicability === 'review_required') {
        assert.equal(expectedChange?.required_action, 'human_review', `${label}: removed characteristic review policy`);
      }
      assert.equal(
        report.reinspection_plan.items.some((item) => item.affected_entity_id === entry.expected_assessment_entity),
        false,
        `${label}: entity must not receive reinspection work`
      );
    } else {
      assert.ok(assessment, `${label}: expected assessment ${entry.expected_assessment_entity}`);
      assert.equal(assessment.applicability_status, entry.expected_applicability, `${label}: applicability`);
      assert.equal(
        assessment.human_decision_required,
        !['unaffected', 'not_applicable'].includes(entry.expected_applicability),
        `${label}: human decision flag`
      );
    }
  }
  if (entry.expected_additional_assessment_entity) {
    const assessment = report.evidence_applicability.assessments.find((item) => (
      item.evidence_or_characteristic_id === entry.expected_additional_assessment_entity
    ));
    assert.ok(assessment, `${label}: expected assessment ${entry.expected_additional_assessment_entity}`);
    assert.equal(
      assessment.applicability_status,
      entry.expected_additional_applicability,
      `${label}: additional applicability`
    );
  }
  assertFuturePlan(report, label);
}

for (const [name, scenario] of Object.entries(matrix.cli_scenarios)) {
  const inputs = await loadRevisionImpactInputSet({
    projectRoot: ROOT,
    baselineReviewPackPath: scenario.baseline_review_pack,
    candidateReviewPackPath: scenario.candidate_review_pack,
  });
  const before = JSON.stringify(inputs);
  const report = buildRevisionImpactReport({ ...inputs, generatedAt: GENERATED_AT });
  assert.equal(JSON.stringify(inputs), before, `CLI scenario ${name}: builder must not mutate loaded inputs`);
  assert.equal(report.summary.decision, scenario.expected_decision, `CLI scenario ${name}: decision`);
  assert.equal(
    report.summary.reinspection_required_count,
    scenario.expected_reinspection_count ?? 0,
    `CLI scenario ${name}: reinspection count`
  );
  if (scenario.expected_change_type) {
    const change = report.changes.find((item) => item.change_type === scenario.expected_change_type);
    assert.ok(change, `CLI scenario ${name}: expected ${scenario.expected_change_type}`);
    if (scenario.expected_characteristic_id) {
      assert.equal(change.affected_entity_id, scenario.expected_characteristic_id);
    }
    if (scenario.expected_determinability) {
      assert.equal(change.determinability, scenario.expected_determinability);
    }
  }
  assertFuturePlan(report, `CLI scenario ${name}`);
}

for (const entry of matrix.cases) {
  const baseline = buildPolicySide(matrix.base, entry, 'baseline');
  const candidate = buildPolicySide(matrix.base, entry, 'candidate');
  const before = JSON.stringify({ baseline, candidate });
  const report = buildRevisionImpactReport({ baseline, candidate, generatedAt: GENERATED_AT });
  assert.equal(
    JSON.stringify({ baseline, candidate }),
    before,
    `${entry.id}: report builder must not mutate inputs`
  );
  const rerun = buildRevisionImpactReport({
    baseline: cloneJson(baseline),
    candidate: cloneJson(candidate),
    generatedAt: GENERATED_AT,
  });
  assert.deepEqual(rerun, report, `${entry.id}: fixed-time report must be deterministic`);
  assertPolicyExpectation(entry, report);
}

console.log('revision-impact-fixture-matrix.test.js: ok');
