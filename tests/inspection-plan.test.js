import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { validateInspectionPlan } from '../lib/inspection-plan-contract.js';
import { classifyInspectionEvidenceCandidate } from '../src/services/inspection-evidence-intake/inspection-evidence-onboarding-service.js';
import {
  buildInspectionPlan,
  createInspectionPlanFromPaths,
  renderInspectionChecksheet,
  renderInspectionResultTemplate,
  renderSupplierInspectionRequest,
  writeInspectionPlanOutputs,
} from '../src/services/inspection-plan/inspection-plan-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const REVIEW_PACK = resolve(ROOT, 'tests/fixtures/revision-impact/tightened-tolerance-candidate-review-pack.json');
const GENERATED_AT = '2026-07-12T00:00:00Z';
const REQUIREMENTS = resolve(ROOT, 'tests/fixtures/inspection-plan/complete-requirements.json');

const plan = await createInspectionPlanFromPaths({ projectRoot: ROOT, reviewPackPath: REVIEW_PACK, scope: 'full', generatedAt: GENERATED_AT });
assert.equal(validateInspectionPlan(plan).ok, true);
assert.equal(plan.status, 'ready_for_human_release');
assert.equal(plan.boundaries.human_release_required, true);
assert.equal(plan.boundaries.inspection_evidence, false);
assert.equal(plan.boundaries.measured_results_present, false);
assert.equal(plan.items[0].lower_limit, 5.9);
assert.equal(plan.items[0].upper_limit, 6.1);
assert.equal(plan.items[0].field_authority.required_method, 'explicit_review_requirement');

const released = await createInspectionPlanFromPaths({ projectRoot: ROOT, reviewPackPath: REVIEW_PACK, requirementsPath: REQUIREMENTS, scope: 'full', generatedAt: GENERATED_AT });
assert.equal(released.status, 'blocked');
assert.equal(released.items[0].field_authority.nominal_value, 'authoritative_released_requirement');
assert.equal(released.unresolved_requirements.some((entry) => entry.code === 'conflicting_authoritative_requirements'), true);
await assert.rejects(createInspectionPlanFromPaths({ projectRoot: ROOT, reviewPackPath: REVIEW_PACK, requirementsPath: resolve(ROOT, 'tests/fixtures/inspection-plan/advisory-standard-doc.json'), scope: 'full', generatedAt: GENERATED_AT }), /Expected inspection_requirements/);

const incompleteReviewPack = JSON.parse(await readFile(REVIEW_PACK, 'utf8'));
delete incompleteReviewPack.inspection_linkage.records[0].tolerance;
delete incompleteReviewPack.inspection_linkage.records[0].inspection_method;
const incomplete = buildInspectionPlan({ reviewPack: incompleteReviewPack, sourceSnapshot: plan.source_snapshot, scope: 'full', generatedAt: GENERATED_AT });
assert.equal(incomplete.status, 'review_required');
assert.equal(incomplete.items[0].lower_limit, null);
assert.equal(incomplete.items[0].required_method, null);
assert.equal(incomplete.unresolved_requirements.some((entry) => entry.code === 'tolerance_unresolved'), true);

const changeId = 'change:1234567890abcdef';
const delta = buildInspectionPlan({
  reviewPack: incompleteReviewPack,
  sourceSnapshot: { ...plan.source_snapshot, revision_impact: { artifact_type: 'revision_impact_report', path: 'output/revision_impact_report.json', sha256: 'a'.repeat(64) } },
  scope: 'delta',
  generatedAt: GENERATED_AT,
  revisionImpact: {
    artifact_type: 'revision_impact_report',
    candidate: { package_slug: 'fixture-bracket', revision: 'B' },
    reinspection_plan: { items: [{ affected_entity_id: 'CHAR.HOLE_DIAMETER', related_change_ids: [changeId] }] },
    evidence_applicability: { assessments: [], authoritative_evidence_state_changed: false },
  },
});
assert.deepEqual(delta.items[0].revision_impact_change_ids, [changeId]);
assert.equal(delta.items[0].evidence_state_changed, false);

const removedDelta = buildInspectionPlan({ reviewPack: incompleteReviewPack, sourceSnapshot: delta.source_snapshot, scope: 'delta', generatedAt: GENERATED_AT, revisionImpact: { artifact_type: 'revision_impact_report', candidate: { package_slug: 'fixture-bracket', revision: 'B' }, reinspection_plan: { items: [{ affected_entity_id: 'CHAR.REMOVED', related_change_ids: ['change:removed12345678'] }] }, evidence_applicability: { assessments: [], authoritative_evidence_state_changed: false } } });
assert.equal(removedDelta.items.some((item) => item.characteristic_id === 'CHAR.REMOVED' && item.human_review_required), true);
assert.equal(removedDelta.unresolved_requirements.some((item) => item.code === 'revision_impact_characteristic_unresolved'), true);
const indeterminateDelta = buildInspectionPlan({ reviewPack: incompleteReviewPack, sourceSnapshot: delta.source_snapshot, scope: 'delta', generatedAt: GENERATED_AT, revisionImpact: { artifact_type: 'revision_impact_report', candidate: { package_slug: 'fixture-bracket', revision: 'B' }, reinspection_plan: { items: [] }, evidence_applicability: { assessments: [{ evidence_or_characteristic_id: 'CHAR.UNKNOWN', related_change_ids: ['change:unknown12345678'], applicability_status: 'unable_to_determine' }], authoritative_evidence_state_changed: false } } });
assert.equal(indeterminateDelta.status, 'blocked');
assert.equal(indeterminateDelta.unresolved_requirements.some((item) => item.code === 'revision_impact_unable_to_determine'), true);

const injected = structuredClone(plan);
injected.items[0].characteristic_name = '=HYPERLINK("bad")';
assert.match(renderInspectionChecksheet(injected), /'=HYPERLINK\(""bad""\)/);
const template = renderInspectionResultTemplate(plan);
assert.match(template, /control_material_notice,measured_value,measured_unit,result,completion_status,final_status/);
assert.doesNotMatch(template, /\b(?:PASS|FAIL)\b/);
assert.doesNotMatch(template, /6\.1|5\.9/);
const templateClassification = classifyInspectionEvidenceCandidate({ filename: 'renamed.csv', sourcePathText: 'local/stage5b-candidate-evidence-inbox/quality-pass-bracket/renamed.csv', bytes: Buffer.from(template) });
assert.notEqual(templateClassification.classification, 'candidate');
const request = renderSupplierInspectionRequest(plan, 'b'.repeat(64));
assert.match(request, /remain untrusted candidates/i);
assert.match(request, /not inspection evidence/i);

const duplicate = structuredClone(plan);
duplicate.items.push(structuredClone(duplicate.items[0]));
assert.equal(validateInspectionPlan(duplicate).ok, false);

await mkdir(resolve(ROOT, 'tmp/codex'), { recursive: true });
const temp = await mkdtemp(join(resolve(ROOT, 'tmp/codex'), 'inspection-plan-test-'));
try {
  const args = {
    projectRoot: ROOT,
    plan,
    outputPath: relative(ROOT, join(temp, 'inspection_plan.json')),
    checksheetPath: relative(ROOT, join(temp, 'inspection_checksheet.csv')),
    requestPath: relative(ROOT, join(temp, 'supplier_inspection_request.md')),
    resultTemplatePath: relative(ROOT, join(temp, 'inspection_result_template.csv')),
  };
  await writeInspectionPlanOutputs(args);
  const first = await Promise.all(['inspection_plan.json', 'inspection_checksheet.csv', 'supplier_inspection_request.md', 'inspection_result_template.csv'].map((name) => readFile(join(temp, name))));
  await writeInspectionPlanOutputs(args);
  const second = await Promise.all(['inspection_plan.json', 'inspection_checksheet.csv', 'supplier_inspection_request.md', 'inspection_result_template.csv'].map((name) => readFile(join(temp, name))));
  assert.deepEqual(second, first);
  const raceInput = join(temp, 'race-review-pack.json');
  await writeFile(raceInput, await readFile(REVIEW_PACK));
  const racedPlan = await createInspectionPlanFromPaths({ projectRoot: ROOT, reviewPackPath: raceInput, trustedInputRoots: [temp], scope: 'full', generatedAt: GENERATED_AT, afterSnapshot: async () => { await writeFile(raceInput, `${JSON.stringify({ artifact_type: 'review_pack', revision: 'REPLACED' })}\n`); } });
  assert.equal(racedPlan.package.revision, 'B');
  assert.equal(racedPlan.source_snapshot.review_pack.sha256, plan.source_snapshot.review_pack.sha256);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('inspection-plan.test.js: ok');
