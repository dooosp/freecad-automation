import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  parseInspectionEvidenceJsonBytes,
  serializeCanonicalJson,
  validateJsonDocumentBounds,
} from './inspection-evidence-onboarding.js';

export const MANUFACTURING_ACTION_SCHEMA_VERSION = '1.0';
export const MANUFACTURING_ACTION_MAX_JSON_BYTES = 4 * 1024 * 1024;

export const MANUFACTURING_ACTION_BOUNDARIES = deepFreeze({
  synthetic_demo: true,
  real_shop_floor_data: false,
  automatic_video_segmentation: false,
  computer_vision_model_used: false,
  lerobot_compatible: false,
  training_ready: false,
  inspection_evidence: false,
  evidence_attached: false,
  readiness_regenerated: false,
  product_release: false,
  production_readiness: false,
  human_review_required: true,
});

export const MANUFACTURING_ACTION_ARTIFACT_TYPES = Object.freeze({
  TASK_PLAN: 'manufacturing_task_plan',
  ACTION_DICTIONARY: 'manufacturing_action_dictionary',
  EPISODE_ANNOTATION: 'manufacturing_episode_annotation',
  DATASET_MANIFEST: 'manufacturing_robotics_dataset_manifest',
  VALIDATION_REPORT: 'manufacturing_data_validation_report',
  HANDOFF: 'design_manufacturing_quality_handoff',
});

export const MANUFACTURING_ACTION_OUTPUT_FILENAMES = Object.freeze({
  ACTION_DICTIONARY: 'manufacturing_action_dictionary.json',
  EPISODE_ANNOTATION: 'manufacturing_episode_annotation.json',
  VALIDATION_REPORT: 'manufacturing_data_validation_report.json',
  DATASET_MANIFEST: 'manufacturing_robotics_dataset_manifest.json',
  HANDOFF: 'design_manufacturing_quality_handoff.json',
});

export const MANUFACTURING_ACTION_SEQUENCE = Object.freeze([
  'approach_hinge_block',
  'grasp_hinge_block',
  'transport_to_fixture',
  'align_mounting_interface',
  'seat_on_fixture',
  'probe_left_hinge_pin',
  'probe_right_hinge_pin',
  'inspect_hinge_ears',
  'inspect_mounting_holes',
  'release_and_retract',
]);

export const MANUFACTURING_ACTION_SOURCE_UNIVERSE = deepFreeze({
  part_ids: ['hinge_block'],
  feature_ids: [
    'base_block',
    'left_ear',
    'right_ear',
    'hinge_pin_left',
    'hinge_pin_right',
    'mount_hole_left',
    'mount_hole_right',
  ],
  quality_characteristic_ids: ['cd-01', 'cd-02', 'ftp-01', 'ftp-02'],
  robot_joint_ids: [
    'j1_base_yaw',
    'j2_shoulder_pitch',
    'j3_elbow_pitch',
    'j4_wrist_yaw',
    'j5_wrist_pitch',
    'j6_wrist_roll',
  ],
  tool_interface_ids: ['tool_flange'],
});

const COMMON_SCHEMA = readSchema('../schemas/manufacturing-action-common.schema.json');
const SCHEMA_RECORDS = Object.freeze([
  Object.freeze({
    artifact_type: MANUFACTURING_ACTION_ARTIFACT_TYPES.TASK_PLAN,
    schema_path: 'schemas/manufacturing-task-plan.schema.json',
    filename: 'hinge_block_robot_inspection_task_plan.json',
    role: 'curated_input',
  }),
  Object.freeze({
    artifact_type: MANUFACTURING_ACTION_ARTIFACT_TYPES.ACTION_DICTIONARY,
    schema_path: 'schemas/manufacturing-action-dictionary.schema.json',
    filename: MANUFACTURING_ACTION_OUTPUT_FILENAMES.ACTION_DICTIONARY,
    role: 'domain_output',
  }),
  Object.freeze({
    artifact_type: MANUFACTURING_ACTION_ARTIFACT_TYPES.EPISODE_ANNOTATION,
    schema_path: 'schemas/manufacturing-episode-annotation.schema.json',
    filename: MANUFACTURING_ACTION_OUTPUT_FILENAMES.EPISODE_ANNOTATION,
    role: 'domain_output',
  }),
  Object.freeze({
    artifact_type: MANUFACTURING_ACTION_ARTIFACT_TYPES.DATASET_MANIFEST,
    schema_path: 'schemas/manufacturing-robotics-dataset-manifest.schema.json',
    filename: MANUFACTURING_ACTION_OUTPUT_FILENAMES.DATASET_MANIFEST,
    role: 'domain_output',
  }),
  Object.freeze({
    artifact_type: MANUFACTURING_ACTION_ARTIFACT_TYPES.VALIDATION_REPORT,
    schema_path: 'schemas/manufacturing-data-validation-report.schema.json',
    filename: MANUFACTURING_ACTION_OUTPUT_FILENAMES.VALIDATION_REPORT,
    role: 'domain_output',
  }),
  Object.freeze({
    artifact_type: MANUFACTURING_ACTION_ARTIFACT_TYPES.HANDOFF,
    schema_path: 'schemas/design-manufacturing-quality-handoff.schema.json',
    filename: MANUFACTURING_ACTION_OUTPUT_FILENAMES.HANDOFF,
    role: 'domain_output',
  }),
]);

const EXPECTED_SOURCE_ROLES = Object.freeze([
  'authoritative_config',
  'inspection_plan',
  'manufacturing_task_plan',
  'review_pack',
  'robot_config',
]);
const EXPECTED_REQUIREMENT_CATEGORIES = Object.freeze([
  'fixture',
  'gripper',
  'part_robot_transform',
  'probe',
  'released_tolerance',
  'trajectory',
]);
const EXPECTED_DATASET_MEMBER_ROLES = Object.freeze([
  'manufacturing_task_plan',
  'action_dictionary',
  'episode_annotation',
]);

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
  strictNumbers: true,
  validateFormats: false,
});
ajv.addSchema(COMMON_SCHEMA, COMMON_SCHEMA.$id);

const VALIDATORS = new Map(SCHEMA_RECORDS.map((record) => {
  const schema = readSchema(`../${record.schema_path}`);
  return [record.artifact_type, ajv.compile(schema)];
}));

export class ManufacturingActionContractError extends Error {
  constructor(diagnostic, diagnostics) {
    super(diagnostic?.message || 'Manufacturing action artifact validation failed');
    this.name = 'ManufacturingActionContractError';
    this.code = diagnostic?.code || 'manufacturing_action_invalid';
    this.reason_code = this.code;
    this.stage = diagnostic?.stage || 'semantic';
    this.json_pointer = diagnostic?.json_pointer || '/';
    this.remediation = diagnostic?.remediation || 'Correct the manufacturing action artifact and validate it again.';
    this.diagnostics = deepFreeze(diagnostics.map((entry) => ({ ...entry })));
  }
}

function readSchema(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((entry) => deepFreeze(entry, seen));
  return Object.freeze(value);
}

function escapeJsonPointer(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function schemaErrorPointer(error) {
  const base = error.instancePath || '';
  if (error.keyword === 'required' && error.params?.missingProperty) {
    return `${base}/${escapeJsonPointer(error.params.missingProperty)}` || '/';
  }
  if (error.keyword === 'additionalProperties' && error.params?.additionalProperty) {
    return `${base}/${escapeJsonPointer(error.params.additionalProperty)}` || '/';
  }
  return base || '/';
}

function remediationFor(stage, code) {
  if (stage === 'boundary') {
    return 'Restore every fixed synthetic-only boundary value; v1 callers cannot override these declarations.';
  }
  if (stage === 'lineage') {
    return 'Rebuild the artifact from the exact proof config, review, inspection, robot, and task snapshots.';
  }
  if (stage === 'reference') {
    return 'Use only the IDs established by the selected hinge-block config, robot config, inspection plan, and curated task plan.';
  }
  if (stage === 'timeline') {
    return 'Regenerate the ten contiguous segments from the ordered curated task actions.';
  }
  if (code.includes('language')) {
    return 'Supply substantive human-authored Korean and English instruction text and keep human review required.';
  }
  if (stage === 'schema') {
    return 'Conform the document to the closed JSON Schema 2020-12 contract for its artifact_type.';
  }
  return 'Correct the indicated field and rerun manufacturing action contract validation.';
}

function diagnostic(stage, code, jsonPointer, message) {
  return Object.freeze({
    stage,
    code,
    json_pointer: jsonPointer || '/',
    message,
    remediation: remediationFor(stage, code),
  });
}

function schemaDiagnostics(validator, document) {
  const ok = validator(document);
  if (ok) return [];
  return (validator.errors || []).map((error) => diagnostic(
    'schema',
    `manufacturing_action_schema_${error.keyword}`,
    schemaErrorPointer(error),
    `${schemaErrorPointer(error)} ${error.message}`.trim()
  ));
}

function arraysEqual(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function unique(values) {
  return Array.isArray(values) && new Set(values).size === values.length;
}

function isSafeRepoPath(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()) return false;
  if (isAbsolute(value) || /^[A-Za-z]:/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  if (value.startsWith('~')
    || value.includes('\\')
    || /%(?:2e|2f|5c)/i.test(value)
    || /[\u0000-\u001f\u007f]/.test(value)) return false;
  return value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function sameRecord(left, right) {
  return ['artifact_type', 'role', 'path', 'sha256', 'size_bytes']
    .every((key) => left?.[key] === right?.[key]);
}

function collectCommonDiagnostics(document, artifactType) {
  const diagnostics = [];
  if (artifactType === MANUFACTURING_ACTION_ARTIFACT_TYPES.TASK_PLAN) return diagnostics;

  if (JSON.stringify(document?.boundaries) !== JSON.stringify(MANUFACTURING_ACTION_BOUNDARIES)) {
    diagnostics.push(diagnostic(
      'boundary',
      'manufacturing_action_boundary_override',
      '/boundaries',
      'boundaries must exactly preserve the fixed synthetic-only v1 declarations'
    ));
  }

  const identity = document?.identity;
  const lineageIdentity = document?.revision_lineage?.identity;
  if (identity && lineageIdentity && JSON.stringify(identity) !== JSON.stringify(lineageIdentity)) {
    diagnostics.push(diagnostic(
      'lineage',
      'manufacturing_action_lineage_identity_mismatch',
      '/revision_lineage/identity',
      'revision_lineage.identity must exactly equal the artifact identity'
    ));
  }

  const snapshots = Array.isArray(document?.source_snapshots) ? document.source_snapshots : [];
  const roles = snapshots.map((entry) => entry?.role);
  if (!arraysEqual(roles, EXPECTED_SOURCE_ROLES)) {
    diagnostics.push(diagnostic(
      'lineage',
      'manufacturing_action_source_snapshot_roles',
      '/source_snapshots',
      `source_snapshots must use the exact ordered roles: ${EXPECTED_SOURCE_ROLES.join(', ')}`
    ));
  }
  if (!unique(roles) || !unique(snapshots.map((entry) => entry?.path))) {
    diagnostics.push(diagnostic(
      'lineage',
      'manufacturing_action_duplicate_source_snapshot',
      '/source_snapshots',
      'source snapshot roles and paths must be unique'
    ));
  }
  snapshots.forEach((entry, index) => {
    if (!isSafeRepoPath(entry?.path)) {
      diagnostics.push(diagnostic(
        'lineage',
        'manufacturing_action_unsafe_source_path',
        `/source_snapshots/${index}/path`,
        'source snapshot paths must be safe portable repository-relative locators'
      ));
    }
  });

  const parents = Array.isArray(document?.revision_lineage?.parents)
    ? document.revision_lineage.parents
    : [];
  const parentRoles = parents.map((entry) => entry?.role);
  if (parents.length !== snapshots.length
    || !unique(parentRoles)
    || snapshots.some((snapshot, index) => !sameRecord(snapshot, parents[index]))) {
    diagnostics.push(diagnostic(
      'lineage',
      'manufacturing_action_lineage_parent_mismatch',
      '/revision_lineage/parents',
      'revision lineage parents must bind the exact ordered source snapshot records'
    ));
  }

  if (typeof document?.generated_at === 'string' && Number.isNaN(Date.parse(document.generated_at))) {
    diagnostics.push(diagnostic(
      'schema',
      'manufacturing_action_invalid_timestamp',
      '/generated_at',
      'generated_at must be a real UTC RFC 3339 timestamp'
    ));
  }

  return diagnostics;
}

function collectActionDiagnostics(document, { requireUniverse = true } = {}) {
  const diagnostics = [];
  const actions = Array.isArray(document?.actions) ? document.actions : [];
  const actionIds = actions.map((entry) => entry?.action_id);
  if (!arraysEqual(actionIds, MANUFACTURING_ACTION_SEQUENCE)) {
    diagnostics.push(diagnostic(
      'semantic',
      'manufacturing_action_sequence_mismatch',
      '/actions',
      'actions must contain the exact ordered ten-action hinge-block sequence'
    ));
  }
  if (!unique(actionIds)) {
    diagnostics.push(diagnostic(
      'reference',
      'manufacturing_action_duplicate_action_id',
      '/actions',
      'action IDs must be unique'
    ));
  }

  if (requireUniverse && document?.source_universe) {
    for (const [field, expected] of Object.entries(MANUFACTURING_ACTION_SOURCE_UNIVERSE)) {
      if (!arraysEqual(document.source_universe[field], expected)) {
        diagnostics.push(diagnostic(
          'reference',
          'manufacturing_action_source_universe_mismatch',
          `/source_universe/${field}`,
          `${field} must exactly match the grounded source universe`
        ));
      }
    }
  }

  const requirements = Array.isArray(document?.unresolved_requirements)
    ? document.unresolved_requirements
    : [];
  const requirementIds = requirements.map((entry) => entry?.requirement_id);
  const requirementCategories = requirements.map((entry) => entry?.category).sort();
  if (!unique(requirementIds)) {
    diagnostics.push(diagnostic(
      'reference',
      'manufacturing_action_duplicate_requirement_id',
      '/unresolved_requirements',
      'unresolved requirement IDs must be unique'
    ));
  }
  if (!arraysEqual(requirementCategories, EXPECTED_REQUIREMENT_CATEGORIES)) {
    diagnostics.push(diagnostic(
      'semantic',
      'manufacturing_action_unresolved_requirements_incomplete',
      '/unresolved_requirements',
      'gripper, probe, fixture, part/robot transform, trajectory, and released tolerance needs must remain explicit'
    ));
  }

  const requirementSet = new Set(requirementIds);
  const universes = {
    part_ids: new Set(MANUFACTURING_ACTION_SOURCE_UNIVERSE.part_ids),
    feature_ids: new Set(MANUFACTURING_ACTION_SOURCE_UNIVERSE.feature_ids),
    quality_characteristic_ids: new Set(MANUFACTURING_ACTION_SOURCE_UNIVERSE.quality_characteristic_ids),
    robot_joint_ids: new Set(MANUFACTURING_ACTION_SOURCE_UNIVERSE.robot_joint_ids),
    tool_interface_ids: new Set(MANUFACTURING_ACTION_SOURCE_UNIVERSE.tool_interface_ids),
  };

  actions.forEach((action, index) => {
    const pointer = `/actions/${index}`;
    if (action?.order !== index + 1) {
      diagnostics.push(diagnostic(
        'semantic',
        'manufacturing_action_order_mismatch',
        `${pointer}/order`,
        'action order must be contiguous from 1 through 10'
      ));
    }
    const expectedPrevious = index === 0 ? [] : [MANUFACTURING_ACTION_SEQUENCE[index - 1]];
    const expectedNext = index === MANUFACTURING_ACTION_SEQUENCE.length - 1
      ? []
      : [MANUFACTURING_ACTION_SEQUENCE[index + 1]];
    if (!arraysEqual(action?.allowed_previous_action_ids, expectedPrevious)
      || !arraysEqual(action?.allowed_next_action_ids, expectedNext)) {
      diagnostics.push(diagnostic(
        'semantic',
        'manufacturing_action_transition_mismatch',
        pointer,
        'allowed previous and next actions must match the curated sequence'
      ));
    }

    for (const [field, universe] of Object.entries(universes)) {
      const refs = action?.references?.[field];
      if (Array.isArray(refs) && (!unique(refs) || refs.some((entry) => !universe.has(entry)))) {
        diagnostics.push(diagnostic(
          'reference',
          'manufacturing_action_unknown_or_duplicate_reference',
          `${pointer}/references/${field}`,
          `${field} must be unique and resolve to the grounded source universe`
        ));
      }
    }

    if (!Array.isArray(action?.references?.robot_joint_ids)
      || action.references.robot_joint_ids.length === 0) {
      diagnostics.push(diagnostic(
        'reference',
        'manufacturing_action_missing_robot_joint_reference',
        `${pointer}/references/robot_joint_ids`,
        'every action must reference one or more grounded robot joints'
      ));
    }

    if (Array.isArray(action?.unresolved_requirement_ids)
      && (!unique(action.unresolved_requirement_ids)
        || action.unresolved_requirement_ids.some((entry) => !requirementSet.has(entry)))) {
      diagnostics.push(diagnostic(
        'reference',
        'manufacturing_action_unknown_requirement_reference',
        `${pointer}/unresolved_requirement_ids`,
        'action unresolved requirements must resolve to the plan requirement list'
      ));
    }

    const korean = action?.instruction?.ko;
    const english = action?.instruction?.en;
    if (typeof korean !== 'string' || !/[\u3131-\uD79D]/u.test(korean)
      || typeof english !== 'string' || !/[A-Za-z]/.test(english)
      || /\b(?:todo|tbd|placeholder|lorem)\b/i.test(`${korean || ''} ${english || ''}`)) {
      diagnostics.push(diagnostic(
        'semantic',
        'manufacturing_action_language_coverage_missing',
        `${pointer}/instruction`,
        'every action must have substantive human-authored Korean and English instructions'
      ));
    }
  });

  requirements.forEach((requirement, index) => {
    const refs = requirement?.required_for;
    if (Array.isArray(refs) && (!unique(refs)
      || refs.length === 0
      || refs.some((entry) => !MANUFACTURING_ACTION_SEQUENCE.includes(entry)))) {
      diagnostics.push(diagnostic(
        'reference',
        'manufacturing_action_invalid_requirement_action_reference',
        `/unresolved_requirements/${index}/required_for`,
        'each unresolved requirement must reference one or more known actions'
      ));
    }
  });

  const covered = (field) => new Set(actions.flatMap((action) => action?.references?.[field] || []));
  for (const field of ['feature_ids', 'quality_characteristic_ids', 'robot_joint_ids']) {
    const expected = MANUFACTURING_ACTION_SOURCE_UNIVERSE[field];
    const values = covered(field);
    if (expected.some((entry) => !values.has(entry))) {
      diagnostics.push(diagnostic(
        'reference',
        'manufacturing_action_incomplete_reference_coverage',
        '/actions',
        `actions must collectively reference every grounded ${field}`
      ));
    }
  }
  return diagnostics;
}

function collectEpisodeDiagnostics(document) {
  const diagnostics = [];
  const segments = Array.isArray(document?.segments) ? document.segments : [];
  const ids = segments.map((entry) => entry?.segment_id);
  if (!unique(ids)) {
    diagnostics.push(diagnostic(
      'timeline',
      'manufacturing_action_duplicate_segment_id',
      '/segments',
      'episode segment IDs must be unique'
    ));
  }
  let expectedStart = 0;
  segments.forEach((segment, index) => {
    const pointer = `/segments/${index}`;
    if (segment?.order !== index + 1 || segment?.action_id !== MANUFACTURING_ACTION_SEQUENCE[index]) {
      diagnostics.push(diagnostic(
        'timeline',
        'manufacturing_action_segment_sequence_mismatch',
        pointer,
        'episode segments must resolve one-to-one to the ordered action sequence'
      ));
    }
    if (segment?.start_ms !== expectedStart
      || segment?.end_ms <= segment?.start_ms
      || segment?.duration_ms !== segment?.end_ms - segment?.start_ms) {
      diagnostics.push(diagnostic(
        'timeline',
        'manufacturing_action_invalid_timeline',
        pointer,
        'segments must be positive-duration, contiguous, monotonic, and non-overlapping'
      ));
    }
    expectedStart = Number.isInteger(segment?.end_ms) ? segment.end_ms : expectedStart;
  });
  if (document?.action_dictionary?.artifact_type !== MANUFACTURING_ACTION_ARTIFACT_TYPES.ACTION_DICTIONARY) {
    diagnostics.push(diagnostic(
      'reference',
      'manufacturing_action_dictionary_reference_mismatch',
      '/action_dictionary/artifact_type',
      'episode annotation must bind a manufacturing action dictionary'
    ));
  }
  return diagnostics;
}

function collectDatasetManifestDiagnostics(document) {
  const diagnostics = [];
  const members = Array.isArray(document?.members) ? document.members : [];
  const roles = members.map((entry) => entry?.role);
  if (!arraysEqual(roles, EXPECTED_DATASET_MEMBER_ROLES) || !unique(members.map((entry) => entry?.path))) {
    diagnostics.push(diagnostic(
      'reference',
      'manufacturing_action_dataset_members_mismatch',
      '/members',
      `dataset members must bind exactly ${EXPECTED_DATASET_MEMBER_ROLES.join(', ')} in stable order`
    ));
  }
  const forbidden = new Set([
    MANUFACTURING_ACTION_ARTIFACT_TYPES.DATASET_MANIFEST,
    MANUFACTURING_ACTION_ARTIFACT_TYPES.VALIDATION_REPORT,
    MANUFACTURING_ACTION_ARTIFACT_TYPES.HANDOFF,
  ]);
  if (members.some((entry) => forbidden.has(entry?.artifact_type))) {
    diagnostics.push(diagnostic(
      'reference',
      'manufacturing_action_manifest_cycle',
      '/members',
      'the domain dataset manifest must not hash itself or later validation/handoff artifacts'
    ));
  }
  return diagnostics;
}

function collectValidationReportDiagnostics(document) {
  const diagnostics = [];
  const metrics = document?.metrics || {};
  const checks = Array.isArray(document?.checks) ? document.checks : [];
  if (!unique(checks.map((entry) => entry?.check_id))) {
    diagnostics.push(diagnostic(
      'semantic',
      'manufacturing_action_duplicate_validation_check',
      '/checks',
      'validation check IDs must be unique'
    ));
  }
  if (document?.status === 'valid_synthetic_demo') {
    const zeroFields = [
      'unknown_reference_count',
      'duplicate_reference_count',
      'transition_violation_count',
      'timeline_violation_count',
    ];
    if (zeroFields.some((field) => metrics[field] !== 0)
      || metrics.lineage_status !== 'valid'
      || metrics.boundary_status !== 'valid'
      || metrics.language_coverage?.korean_percent !== 100
      || metrics.language_coverage?.english_percent !== 100
      || (Array.isArray(document?.diagnostics) && document.diagnostics.length !== 0)) {
      diagnostics.push(diagnostic(
        'semantic',
        'manufacturing_action_validation_status_overclaim',
        '/status',
        'valid_synthetic_demo requires zero violations, full bilingual coverage, valid lineage/boundaries, and no diagnostics'
      ));
    }
  }
  checks.forEach((check, index) => {
    if (check?.status === 'pass' && check?.violation_count !== 0) {
      diagnostics.push(diagnostic(
        'semantic',
        'manufacturing_action_check_count_mismatch',
        `/checks/${index}`,
        'a passing validation check must have zero violations'
      ));
    }
  });
  return diagnostics;
}

function collectHandoffDiagnostics(document) {
  const diagnostics = [];
  if (!arraysEqual(document?.manufacturing?.action_ids, MANUFACTURING_ACTION_SEQUENCE)) {
    diagnostics.push(diagnostic(
      'reference',
      'manufacturing_action_handoff_sequence_mismatch',
      '/manufacturing/action_ids',
      'handoff manufacturing actions must preserve the exact curated sequence'
    ));
  }
  if (document?.quality?.inspection_plan_ref?.role !== 'inspection_plan') {
    diagnostics.push(diagnostic(
      'reference',
      'manufacturing_action_handoff_inspection_reference',
      '/quality/inspection_plan_ref',
      'handoff quality must bind the exact inspection-plan source snapshot'
    ));
  }
  const snapshots = Array.isArray(document?.source_snapshots) ? document.source_snapshots : [];
  const hashes = Array.isArray(document?.trust?.exact_hashes) ? document.trust.exact_hashes : [];
  if (hashes.length !== snapshots.length
    || hashes.some((entry, index) => !sameRecord(entry, snapshots[index]))) {
    diagnostics.push(diagnostic(
      'lineage',
      'manufacturing_action_handoff_hash_mismatch',
      '/trust/exact_hashes',
      'handoff trust hashes must repeat the exact ordered source snapshot bindings'
    ));
  }
  return diagnostics;
}

function collectSemanticDiagnostics(document, artifactType) {
  const diagnostics = [
    ...collectCommonDiagnostics(document, artifactType),
  ];
  if (artifactType === MANUFACTURING_ACTION_ARTIFACT_TYPES.TASK_PLAN
    || artifactType === MANUFACTURING_ACTION_ARTIFACT_TYPES.ACTION_DICTIONARY) {
    diagnostics.push(...collectActionDiagnostics(document));
  }
  if (artifactType === MANUFACTURING_ACTION_ARTIFACT_TYPES.TASK_PLAN
    && JSON.stringify(document?.boundaries) !== JSON.stringify(MANUFACTURING_ACTION_BOUNDARIES)) {
    diagnostics.push(diagnostic(
      'boundary',
      'manufacturing_action_boundary_override',
      '/boundaries',
      'task-plan boundaries must exactly preserve the fixed synthetic-only v1 declarations'
    ));
  }
  if (artifactType === MANUFACTURING_ACTION_ARTIFACT_TYPES.EPISODE_ANNOTATION) {
    diagnostics.push(...collectEpisodeDiagnostics(document));
  }
  if (artifactType === MANUFACTURING_ACTION_ARTIFACT_TYPES.DATASET_MANIFEST) {
    diagnostics.push(...collectDatasetManifestDiagnostics(document));
  }
  if (artifactType === MANUFACTURING_ACTION_ARTIFACT_TYPES.VALIDATION_REPORT) {
    diagnostics.push(...collectValidationReportDiagnostics(document));
  }
  if (artifactType === MANUFACTURING_ACTION_ARTIFACT_TYPES.HANDOFF) {
    diagnostics.push(...collectHandoffDiagnostics(document));
  }
  return diagnostics;
}

function normalizeValidationArguments(document, options) {
  if (typeof document === 'string' && options && typeof options === 'object' && !Array.isArray(options)) {
    return { document: options, expectedType: document };
  }
  const expectedType = typeof options === 'string'
    ? options
    : options?.expectedType || options?.artifactType || null;
  return { document, expectedType };
}

export function getManufacturingActionArtifactCatalog() {
  return SCHEMA_RECORDS.map((entry) => ({ ...entry }));
}

export function parseManufacturingActionJsonBytes(bytes, {
  requireCanonical = false,
  maxBytes = MANUFACTURING_ACTION_MAX_JSON_BYTES,
} = {}) {
  const input = Buffer.isBuffer(bytes) ? Buffer.from(bytes) : Buffer.from(bytes || []);
  if (input.length > maxBytes) {
    const error = new SyntaxError(`Manufacturing action JSON exceeds ${maxBytes} bytes`);
    error.code = 'manufacturing_action_json_size_limit';
    throw error;
  }
  if (input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
    const error = new SyntaxError('Manufacturing action JSON must not contain a UTF-8 byte-order mark');
    error.code = 'manufacturing_action_json_bom_forbidden';
    throw error;
  }
  const document = parseInspectionEvidenceJsonBytes(input, { requireCanonical });
  const bounds = validateJsonDocumentBounds(document, { maxDepth: 64, maxNodes: 50_000 });
  if (!bounds.ok) {
    const error = new SyntaxError(bounds.errors[0]?.message || 'Manufacturing action JSON exceeds document bounds');
    error.code = bounds.errors[0]?.code || 'manufacturing_action_json_bounds';
    throw error;
  }
  return document;
}

export function validateManufacturingActionArtifact(document, options = {}) {
  const normalized = normalizeValidationArguments(document, options);
  const artifactType = normalized.expectedType || normalized.document?.artifact_type || null;
  const diagnostics = [];

  if (normalized.expectedType && normalized.document?.artifact_type !== normalized.expectedType) {
    diagnostics.push(diagnostic(
      'schema',
      'manufacturing_action_artifact_type_mismatch',
      '/artifact_type',
      `artifact_type must be ${normalized.expectedType}`
    ));
  }
  const validator = VALIDATORS.get(artifactType);
  if (!validator) {
    diagnostics.push(diagnostic(
      'schema',
      'manufacturing_action_unsupported_artifact_type',
      '/artifact_type',
      `unsupported manufacturing action artifact_type: ${artifactType || 'missing'}`
    ));
  } else {
    const bounds = validateJsonDocumentBounds(normalized.document, { maxDepth: 64, maxNodes: 50_000 });
    if (!bounds.ok) {
      const first = bounds.errors[0];
      diagnostics.push(diagnostic(
        'schema',
        first.code,
        first.path || '/',
        first.message
      ));
    } else {
      diagnostics.push(...schemaDiagnostics(validator, normalized.document));
      diagnostics.push(...collectSemanticDiagnostics(normalized.document, artifactType));
    }
  }

  const frozenDiagnostics = Object.freeze(diagnostics);
  return Object.freeze({
    ok: diagnostics.length === 0,
    artifact_type: artifactType,
    diagnostics: frozenDiagnostics,
    errors: frozenDiagnostics,
  });
}

export function assertManufacturingActionArtifact(document, options = {}) {
  const normalized = normalizeValidationArguments(document, options);
  const result = validateManufacturingActionArtifact(normalized.document, {
    expectedType: normalized.expectedType,
  });
  if (!result.ok) throw new ManufacturingActionContractError(result.diagnostics[0], result.diagnostics);
  return normalized.document;
}

export const assertValidManufacturingActionArtifact = assertManufacturingActionArtifact;

export function serializeManufacturingActionJson(document) {
  return serializeCanonicalJson(document);
}

export const serializeManufacturingActionArtifact = serializeManufacturingActionJson;
export const serializeCanonicalManufacturingActionJson = serializeManufacturingActionJson;
