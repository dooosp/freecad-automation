import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateDArtifact } from '../lib/d-artifact-schema.js';

const ROOT = resolve(import.meta.dirname, '..');
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
assert.deepEqual(baselineCharacteristic.tolerance, { lower: -0.1, upper: 0.1 });
assert.deepEqual(candidateCharacteristic.tolerance, { lower: -0.05, upper: 0.05 });
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

console.log('revision-impact-fixture-matrix.test.js: ok');
