import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  MANUFACTURING_ACTION_ARTIFACT_TYPES,
  MANUFACTURING_ACTION_BOUNDARIES,
  MANUFACTURING_ACTION_OUTPUT_FILENAMES,
  MANUFACTURING_ACTION_SEQUENCE,
  MANUFACTURING_ACTION_SOURCE_UNIVERSE,
  ManufacturingActionContractError,
  assertManufacturingActionArtifact,
  getManufacturingActionArtifactCatalog,
  parseManufacturingActionJsonBytes,
  serializeManufacturingActionJson,
  validateManufacturingActionArtifact,
} from '../lib/manufacturing-action-contracts.js';

const ROOT = resolve(import.meta.dirname, '..');
const TASK_PLAN_PATH = resolve(
  ROOT,
  'configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json'
);
const GENERATED_AT = '2026-07-28T00:00:00.000Z';

function clone(value) {
  return structuredClone(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validateOk(document, expectedType) {
  const result = validateManufacturingActionArtifact(document, { expectedType });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(result.diagnostics, []);
  assert.equal(assertManufacturingActionArtifact(document, { expectedType }), document);
  assert.equal(assertManufacturingActionArtifact(expectedType, document), document);
}

function expectDiagnostic(document, expectedType, { stage, code, pointer }) {
  const result = validateManufacturingActionArtifact(document, { expectedType });
  assert.equal(result.ok, false);
  const match = result.diagnostics.find((entry) => (
    (!stage || entry.stage === stage)
    && (!code || entry.code === code)
    && (!pointer || entry.json_pointer === pointer)
  ));
  assert(match, `missing diagnostic ${JSON.stringify({ stage, code, pointer })}: ${JSON.stringify(result.diagnostics, null, 2)}`);
  assert.equal(typeof match.message, 'string');
  assert(match.message.length > 0);
  assert.equal(typeof match.remediation, 'string');
  assert(match.remediation.length > 0);
  return result;
}

const taskBytes = readFileSync(TASK_PLAN_PATH);
const taskPlan = parseManufacturingActionJsonBytes(taskBytes, { requireCanonical: true });
const identity = clone(taskPlan.identity);
const sourceSnapshots = [
  {
    role: 'authoritative_config',
    artifact_type: 'config',
    path: 'configs/examples/hinge_block.toml',
    sha256: identity.config_sha256,
    size_bytes: 100,
  },
  {
    role: 'inspection_plan',
    artifact_type: 'inspection_plan',
    path: 'run/inspection_plan.json',
    sha256: 'c'.repeat(64),
    size_bytes: 300,
  },
  {
    role: 'manufacturing_task_plan',
    artifact_type: 'manufacturing_task_plan',
    path: 'configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json',
    sha256: sha256(taskBytes),
    size_bytes: taskBytes.length,
  },
  {
    role: 'review_pack',
    artifact_type: 'review_pack',
    path: 'run/review_pack.json',
    sha256: 'b'.repeat(64),
    size_bytes: 200,
  },
  {
    role: 'robot_config',
    artifact_type: 'robot_config',
    path: 'configs/examples/robot_arm_6axis.toml',
    sha256: taskPlan.robot.robot_config_sha256,
    size_bytes: 400,
  },
];
const revisionLineage = {
  schema_version: '1.0',
  mode: 'proof',
  identity: clone(identity),
  parents: clone(sourceSnapshots),
};

function generatedHeader(artifactType, artifactId) {
  return {
    schema_version: '1.0',
    artifact_type: artifactType,
    artifact_id: artifactId,
    generated_at: GENERATED_AT,
    identity: clone(identity),
    revision_lineage: clone(revisionLineage),
    source_snapshots: clone(sourceSnapshots),
    boundaries: clone(MANUFACTURING_ACTION_BOUNDARIES),
  };
}

const actionDictionary = {
  ...generatedHeader(
    MANUFACTURING_ACTION_ARTIFACT_TYPES.ACTION_DICTIONARY,
    'manufacturing-action-dictionary.hinge-block.v1'
  ),
  source_universe: clone(MANUFACTURING_ACTION_SOURCE_UNIVERSE),
  actions: clone(taskPlan.actions),
  unresolved_requirements: clone(taskPlan.unresolved_requirements),
};
const dictionaryBytes = Buffer.from(serializeManufacturingActionJson(actionDictionary));

let timelineCursor = 0;
const segments = taskPlan.actions.map((action, index) => {
  const start = timelineCursor;
  timelineCursor += action.duration_ms;
  return {
    segment_id: `segment_${String(index + 1).padStart(2, '0')}_${action.action_id}`,
    order: index + 1,
    action_id: action.action_id,
    start_ms: start,
    end_ms: timelineCursor,
    duration_ms: action.duration_ms,
    instruction: clone(action.instruction),
    human_review_required: true,
  };
});

const episodeAnnotation = {
  ...generatedHeader(
    MANUFACTURING_ACTION_ARTIFACT_TYPES.EPISODE_ANNOTATION,
    'manufacturing-episode-annotation.hinge-block.v1'
  ),
  source: 'synthetic_task_timeline',
  annotation_origin: 'curated_task_plan',
  confidence: {
    value: null,
    applicability: 'not_applicable',
    rationale: 'No model produced these human-authored synthetic action labels.',
  },
  action_dictionary: {
    artifact_type: MANUFACTURING_ACTION_ARTIFACT_TYPES.ACTION_DICTIONARY,
    artifact_id: actionDictionary.artifact_id,
    role: 'action_dictionary',
    path: MANUFACTURING_ACTION_OUTPUT_FILENAMES.ACTION_DICTIONARY,
    sha256: sha256(dictionaryBytes),
    size_bytes: dictionaryBytes.length,
  },
  segments,
};
const episodeBytes = Buffer.from(serializeManufacturingActionJson(episodeAnnotation));

const datasetManifest = {
  ...generatedHeader(
    MANUFACTURING_ACTION_ARTIFACT_TYPES.DATASET_MANIFEST,
    'manufacturing-robotics-dataset-manifest.hinge-block.v1'
  ),
  dataset: {
    source: 'synthetic_task_timeline',
    annotation_origin: 'curated_task_plan',
    action_count: 10,
    segment_count: 10,
  },
  members: [
    {
      artifact_type: MANUFACTURING_ACTION_ARTIFACT_TYPES.TASK_PLAN,
      artifact_id: taskPlan.artifact_id,
      role: 'manufacturing_task_plan',
      path: 'configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json',
      sha256: sha256(taskBytes),
      size_bytes: taskBytes.length,
    },
    {
      artifact_type: MANUFACTURING_ACTION_ARTIFACT_TYPES.ACTION_DICTIONARY,
      artifact_id: actionDictionary.artifact_id,
      role: 'action_dictionary',
      path: MANUFACTURING_ACTION_OUTPUT_FILENAMES.ACTION_DICTIONARY,
      sha256: sha256(dictionaryBytes),
      size_bytes: dictionaryBytes.length,
    },
    {
      artifact_type: MANUFACTURING_ACTION_ARTIFACT_TYPES.EPISODE_ANNOTATION,
      artifact_id: episodeAnnotation.artifact_id,
      role: 'episode_annotation',
      path: MANUFACTURING_ACTION_OUTPUT_FILENAMES.EPISODE_ANNOTATION,
      sha256: sha256(episodeBytes),
      size_bytes: episodeBytes.length,
    },
  ],
};

const validationReport = {
  ...generatedHeader(
    MANUFACTURING_ACTION_ARTIFACT_TYPES.VALIDATION_REPORT,
    'manufacturing-data-validation-report.hinge-block.v1'
  ),
  status: 'valid_synthetic_demo',
  metrics: {
    action_count: 10,
    segment_count: 10,
    unique_primitive_count: 8,
    feature_coverage: {
      referenced_count: 7,
      total_count: 7,
      coverage_percent: 100,
    },
    joint_coverage: {
      referenced_count: 6,
      total_count: 6,
      coverage_percent: 100,
    },
    quality_coverage: {
      referenced_count: 4,
      total_count: 4,
      coverage_percent: 100,
    },
    language_coverage: {
      korean_percent: 100,
      english_percent: 100,
    },
    unknown_reference_count: 0,
    duplicate_reference_count: 0,
    transition_violation_count: 0,
    timeline_violation_count: 0,
    unresolved_requirement_count: 6,
    lineage_status: 'valid',
    boundary_status: 'valid',
  },
  checks: [
    {
      check_id: 'schema_contracts',
      status: 'pass',
      violation_count: 0,
      message: 'All manufacturing action JSON documents satisfy their closed schemas.',
      remediation: null,
    },
    {
      check_id: 'physical_execution_inputs',
      status: 'review_required',
      violation_count: 0,
      message: 'Physical tooling, fixture, transforms, trajectories, and tolerances remain unresolved.',
      remediation: 'Complete human engineering review before any physical execution or acceptance decision.',
    },
  ],
  diagnostics: [],
};

const handoff = {
  ...generatedHeader(
    MANUFACTURING_ACTION_ARTIFACT_TYPES.HANDOFF,
    'design-manufacturing-quality-handoff.hinge-block.v1'
  ),
  design: {
    part_id: 'hinge_block',
    revision: 'A',
    feature_ids: clone(MANUFACTURING_ACTION_SOURCE_UNIVERSE.feature_ids),
    source_digest: identity.config_sha256,
  },
  manufacturing: {
    action_ids: clone(MANUFACTURING_ACTION_SEQUENCE),
    robot_joint_ids: clone(MANUFACTURING_ACTION_SOURCE_UNIVERSE.robot_joint_ids),
    tool_interface_ids: clone(MANUFACTURING_ACTION_SOURCE_UNIVERSE.tool_interface_ids),
    preconditions: taskPlan.actions.flatMap((action) => action.preconditions),
    postconditions: taskPlan.actions.flatMap((action) => action.postconditions),
    unresolved_requirement_ids: taskPlan.unresolved_requirements.map((entry) => entry.requirement_id),
  },
  quality: {
    quality_characteristic_ids: clone(MANUFACTURING_ACTION_SOURCE_UNIVERSE.quality_characteristic_ids),
    inspection_plan_ref: clone(sourceSnapshots.find((entry) => entry.role === 'inspection_plan')),
    inspection_evidence: false,
    approval_granted: false,
  },
  trust: {
    lineage_status: 'valid',
    exact_hashes: clone(sourceSnapshots),
    synthetic_only: true,
    remaining_holds: [
      'Human UAT has not run.',
      'Genuine physical inspection evidence is still required.',
      'Canonical readiness remains held.',
    ],
  },
  localized_summary: {
    ko: '이 인계 자료는 합성 작업 계획이며 설계, 제조, 품질 또는 출하 승인을 부여하지 않습니다.',
    en: 'This handoff is a synthetic task plan and grants no design, manufacturing, quality, or release approval.',
  },
  approvals: {
    engineering: false,
    manufacturing: false,
    quality: false,
    inspection: false,
    readiness: false,
    release: false,
    statement: 'No engineering, manufacturing, quality, inspection, readiness, or release approval is granted.',
  },
};

assert.equal(Object.isFrozen(MANUFACTURING_ACTION_BOUNDARIES), true);
assert.equal(Object.isFrozen(MANUFACTURING_ACTION_SOURCE_UNIVERSE), true);
assert.deepEqual(Object.values(MANUFACTURING_ACTION_ARTIFACT_TYPES), [
  'manufacturing_task_plan',
  'manufacturing_action_dictionary',
  'manufacturing_episode_annotation',
  'manufacturing_robotics_dataset_manifest',
  'manufacturing_data_validation_report',
  'design_manufacturing_quality_handoff',
]);
assert.deepEqual(MANUFACTURING_ACTION_SEQUENCE, taskPlan.actions.map((action) => action.action_id));
assert.equal(taskPlan.actions.length, 10);
assert.equal(new Set(taskPlan.actions.map((action) => action.action_id)).size, 10);
assert.equal(taskPlan.actions.every((action) => action.human_review_required === true), true);
assert.equal(taskPlan.actions.every((action) => action.instruction_origin === 'human_authored'), true);
assert.equal(taskPlan.actions.every((action) => /[\u3131-\uD79D]/u.test(action.instruction.ko)), true);
assert.equal(taskPlan.actions.every((action) => /[A-Za-z]/.test(action.instruction.en)), true);
assert.deepEqual(
  taskPlan.unresolved_requirements.map((entry) => entry.category).sort(),
  ['fixture', 'gripper', 'part_robot_transform', 'probe', 'released_tolerance', 'trajectory']
);

validateOk(taskPlan, MANUFACTURING_ACTION_ARTIFACT_TYPES.TASK_PLAN);
validateOk(actionDictionary, MANUFACTURING_ACTION_ARTIFACT_TYPES.ACTION_DICTIONARY);
validateOk(episodeAnnotation, MANUFACTURING_ACTION_ARTIFACT_TYPES.EPISODE_ANNOTATION);
validateOk(datasetManifest, MANUFACTURING_ACTION_ARTIFACT_TYPES.DATASET_MANIFEST);
validateOk(validationReport, MANUFACTURING_ACTION_ARTIFACT_TYPES.VALIDATION_REPORT);
validateOk(handoff, MANUFACTURING_ACTION_ARTIFACT_TYPES.HANDOFF);

const catalog = getManufacturingActionArtifactCatalog();
assert.equal(catalog.length, 6);
assert.deepEqual(catalog.map((entry) => entry.artifact_type), Object.values(MANUFACTURING_ACTION_ARTIFACT_TYPES));
assert.equal(new Set(catalog.map((entry) => entry.artifact_type)).size, catalog.length);
assert.equal(new Set(catalog.map((entry) => entry.schema_path)).size, catalog.length);
for (const entry of catalog) {
  assert.equal(existsSync(resolve(ROOT, entry.schema_path)), true, `${entry.schema_path} must exist`);
  const schema = JSON.parse(readFileSync(resolve(ROOT, entry.schema_path), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false, `${entry.schema_path} root must be closed`);
}
const catalogMutation = getManufacturingActionArtifactCatalog();
catalogMutation[0].filename = 'mutated.json';
assert.equal(getManufacturingActionArtifactCatalog()[0].filename, 'hinge_block_robot_inspection_task_plan.json');

const canonical = serializeManufacturingActionJson(taskPlan);
assert.equal(canonical, taskBytes.toString('utf8'));
assert.equal(canonical.endsWith('\n'), true);
assert.deepEqual(parseManufacturingActionJsonBytes(Buffer.from(canonical), { requireCanonical: true }), taskPlan);
assert.throws(
  () => parseManufacturingActionJsonBytes(Buffer.from('{"artifact_type":"a","artifact_type":"b"}\n')),
  (error) => error?.code === 'duplicate_json_key'
);
assert.throws(
  () => parseManufacturingActionJsonBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), taskBytes])),
  (error) => error?.code === 'manufacturing_action_json_bom_forbidden'
);
assert.throws(
  () => parseManufacturingActionJsonBytes(Buffer.from(JSON.stringify(taskPlan)), { requireCanonical: true }),
  (error) => error?.code === 'noncanonical_inspection_evidence_json'
);

const wrongType = clone(taskPlan);
wrongType.artifact_type = MANUFACTURING_ACTION_ARTIFACT_TYPES.ACTION_DICTIONARY;
expectDiagnostic(wrongType, MANUFACTURING_ACTION_ARTIFACT_TYPES.TASK_PLAN, {
  stage: 'schema',
  code: 'manufacturing_action_artifact_type_mismatch',
  pointer: '/artifact_type',
});

const additionalProperty = clone(taskPlan);
additionalProperty.actions[0].joint_targets = [0, 0, 0, 0, 0, 0];
expectDiagnostic(additionalProperty, MANUFACTURING_ACTION_ARTIFACT_TYPES.TASK_PLAN, {
  stage: 'schema',
  code: 'manufacturing_action_schema_additionalProperties',
  pointer: '/actions/0/joint_targets',
});

const overclaim = clone(actionDictionary);
overclaim.boundaries.real_shop_floor_data = true;
expectDiagnostic(overclaim, MANUFACTURING_ACTION_ARTIFACT_TYPES.ACTION_DICTIONARY, {
  stage: 'boundary',
  code: 'manufacturing_action_boundary_override',
  pointer: '/boundaries',
});

const unknownFeature = clone(taskPlan);
unknownFeature.actions[0].references.feature_ids = ['invented_feature'];
expectDiagnostic(unknownFeature, MANUFACTURING_ACTION_ARTIFACT_TYPES.TASK_PLAN, {
  stage: 'reference',
  code: 'manufacturing_action_unknown_or_duplicate_reference',
  pointer: '/actions/0/references/feature_ids',
});

const duplicateAction = clone(taskPlan);
duplicateAction.actions[1].action_id = duplicateAction.actions[0].action_id;
expectDiagnostic(duplicateAction, MANUFACTURING_ACTION_ARTIFACT_TYPES.TASK_PLAN, {
  stage: 'reference',
  code: 'manufacturing_action_duplicate_action_id',
  pointer: '/actions',
});

const missingKorean = clone(taskPlan);
missingKorean.actions[0].instruction.ko = 'TBD';
expectDiagnostic(missingKorean, MANUFACTURING_ACTION_ARTIFACT_TYPES.TASK_PLAN, {
  stage: 'semantic',
  code: 'manufacturing_action_language_coverage_missing',
  pointer: '/actions/0/instruction',
});

const invalidTransition = clone(taskPlan);
invalidTransition.actions[0].allowed_next_action_ids = ['release_and_retract'];
expectDiagnostic(invalidTransition, MANUFACTURING_ACTION_ARTIFACT_TYPES.TASK_PLAN, {
  stage: 'semantic',
  code: 'manufacturing_action_transition_mismatch',
  pointer: '/actions/0',
});

const staleLineage = clone(actionDictionary);
staleLineage.revision_lineage.parents[0].sha256 = 'f'.repeat(64);
expectDiagnostic(staleLineage, MANUFACTURING_ACTION_ARTIFACT_TYPES.ACTION_DICTIONARY, {
  stage: 'lineage',
  code: 'manufacturing_action_lineage_parent_mismatch',
  pointer: '/revision_lineage/parents',
});

const reorderedLineage = clone(actionDictionary);
[reorderedLineage.revision_lineage.parents[0], reorderedLineage.revision_lineage.parents[1]] = [
  reorderedLineage.revision_lineage.parents[1],
  reorderedLineage.revision_lineage.parents[0],
];
expectDiagnostic(reorderedLineage, MANUFACTURING_ACTION_ARTIFACT_TYPES.ACTION_DICTIONARY, {
  stage: 'lineage',
  code: 'manufacturing_action_lineage_parent_mismatch',
  pointer: '/revision_lineage/parents',
});

const missingRobotJointReference = clone(taskPlan);
missingRobotJointReference.actions[0].references.robot_joint_ids = [];
expectDiagnostic(missingRobotJointReference, MANUFACTURING_ACTION_ARTIFACT_TYPES.TASK_PLAN, {
  stage: 'reference',
  code: 'manufacturing_action_missing_robot_joint_reference',
  pointer: '/actions/0/references/robot_joint_ids',
});

const encodedTraversal = clone(actionDictionary);
encodedTraversal.source_snapshots[1].path = 'run/%2e%2e/review_pack.json';
expectDiagnostic(encodedTraversal, MANUFACTURING_ACTION_ARTIFACT_TYPES.ACTION_DICTIONARY, {
  stage: 'lineage',
  code: 'manufacturing_action_unsafe_source_path',
  pointer: '/source_snapshots/1/path',
});

const overlappingTimeline = clone(episodeAnnotation);
overlappingTimeline.segments[1].start_ms -= 1;
overlappingTimeline.segments[1].duration_ms += 1;
expectDiagnostic(overlappingTimeline, MANUFACTURING_ACTION_ARTIFACT_TYPES.EPISODE_ANNOTATION, {
  stage: 'timeline',
  code: 'manufacturing_action_invalid_timeline',
  pointer: '/segments/1',
});

const cyclicManifest = clone(datasetManifest);
cyclicManifest.members[2].artifact_type = MANUFACTURING_ACTION_ARTIFACT_TYPES.DATASET_MANIFEST;
expectDiagnostic(cyclicManifest, MANUFACTURING_ACTION_ARTIFACT_TYPES.DATASET_MANIFEST, {
  stage: 'reference',
  code: 'manufacturing_action_manifest_cycle',
  pointer: '/members',
});

const validationOverclaim = clone(validationReport);
validationOverclaim.metrics.timeline_violation_count = 1;
expectDiagnostic(validationOverclaim, MANUFACTURING_ACTION_ARTIFACT_TYPES.VALIDATION_REPORT, {
  stage: 'semantic',
  code: 'manufacturing_action_validation_status_overclaim',
  pointer: '/status',
});

const hashMismatch = clone(handoff);
hashMismatch.trust.exact_hashes[0].sha256 = 'f'.repeat(64);
expectDiagnostic(hashMismatch, MANUFACTURING_ACTION_ARTIFACT_TYPES.HANDOFF, {
  stage: 'lineage',
  code: 'manufacturing_action_handoff_hash_mismatch',
  pointer: '/trust/exact_hashes',
});

assert.throws(
  () => assertManufacturingActionArtifact(overclaim, {
    expectedType: MANUFACTURING_ACTION_ARTIFACT_TYPES.ACTION_DICTIONARY,
  }),
  (error) => error instanceof ManufacturingActionContractError
    && error.code === 'manufacturing_action_schema_const'
    && error.diagnostics.some((entry) => entry.code === 'manufacturing_action_boundary_override')
);

console.log('manufacturing-action-contracts.test.js: ok');
