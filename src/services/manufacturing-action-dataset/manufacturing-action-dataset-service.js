import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

import { parse as parseToml } from 'smol-toml';

import { buildArtifactManifest } from '../../../lib/artifact-manifest.js';
import {
  INSPECTION_PLAN_PUBLICATION_FILES,
  publishAtomicOutputSet,
} from '../../../lib/atomic-output-publication.js';
import {
  parseInspectionEvidenceJsonBytes,
  validateInspectionEvidenceControlMaterial,
  validateJsonDocumentBounds,
} from '../../../lib/inspection-evidence-onboarding.js';
import { assertValidInspectionPlan } from '../../../lib/inspection-plan-contract.js';
import {
  MANUFACTURING_ACTION_BOUNDARIES,
  MANUFACTURING_ACTION_OUTPUT_FILENAMES,
  MANUFACTURING_ACTION_SEQUENCE,
  MANUFACTURING_ACTION_SOURCE_UNIVERSE,
  assertManufacturingActionArtifact,
  serializeManufacturingActionJson,
} from '../../../lib/manufacturing-action-contracts.js';
import { buildOutputManifest, collectRepoContext } from '../../../lib/output-manifest.js';
import {
  assertRevisionLineage,
  assertRevisionLineageIdentityAgreement,
  assertRevisionLineageSnapshotCurrent,
  buildRevisionLineage,
  buildRevisionLineageParent,
  buildRevisionLineageParentFromSnapshot,
  readAuthoritativeConfigSnapshot,
  readRevisionLineageFileSnapshot,
} from '../../../lib/revision-lineage-contract.js';
import { assertInspectionPlanRevisionLineageContinuity } from '../inspection-plan/inspection-plan-release-service.js';

const MAX_CONTROL_BYTES = 4 * 1024 * 1024;
const GENERATED_AT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/;
const PUBLICATION_TOKEN_PATTERN = /^([1-9][0-9]{0,19})\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EXPECTED_ACTION_IDS = MANUFACTURING_ACTION_SEQUENCE;
const EXPECTED_FEATURE_IDS = MANUFACTURING_ACTION_SOURCE_UNIVERSE.feature_ids;
const EXPECTED_QUALITY_IDS = MANUFACTURING_ACTION_SOURCE_UNIVERSE.quality_characteristic_ids;
const EXPECTED_JOINT_IDS = MANUFACTURING_ACTION_SOURCE_UNIVERSE.robot_joint_ids;
const EXPECTED_TOOL_INTERFACE_IDS = MANUFACTURING_ACTION_SOURCE_UNIVERSE.tool_interface_ids;

const OUTPUT_FILENAMES = Object.freeze({
  action_dictionary: MANUFACTURING_ACTION_OUTPUT_FILENAMES.ACTION_DICTIONARY,
  episode_annotation: MANUFACTURING_ACTION_OUTPUT_FILENAMES.EPISODE_ANNOTATION,
  validation_report: MANUFACTURING_ACTION_OUTPUT_FILENAMES.VALIDATION_REPORT,
  dataset_manifest: MANUFACTURING_ACTION_OUTPUT_FILENAMES.DATASET_MANIFEST,
  handoff_json: MANUFACTURING_ACTION_OUTPUT_FILENAMES.HANDOFF,
  handoff_markdown: 'design_manufacturing_quality_handoff.md',
  artifact_manifest: 'artifact-manifest.json',
  output_manifest: 'output-manifest.json',
});

const DOMAIN_OUTPUTS = Object.freeze([
  ['action_dictionary', 'manufacturing_action_dictionary'],
  ['episode_annotation', 'manufacturing_episode_annotation'],
  ['validation_report', 'manufacturing_data_validation_report'],
  ['dataset_manifest', 'manufacturing_robotics_dataset_manifest'],
  ['handoff_json', 'design_manufacturing_quality_handoff'],
  ['handoff_markdown', 'design_manufacturing_quality_handoff.md'],
]);

const NO_RUNTIME_DIAGNOSTICS = Object.freeze({
  available: false,
  executable_detected: false,
  probe_status: 'not_invoked',
  status: 'not_invoked',
  mode: 'artifact_only',
  source: 'manufacturing_action_dataset',
  executable: '',
  python_executable: '',
  runtime_executable: '',
  gui_executable: '',
  description: 'FreeCAD runtime probing was not invoked for this artifact-only command.',
  version_details: Object.freeze({ freecad: Object.freeze({ version: null }) }),
  checked_candidates: Object.freeze([]),
});

export class ManufacturingActionDatasetError extends Error {
  constructor(code, message, {
    stage = 'semantic',
    jsonPointer = '/',
    remediation = 'Correct the selected proof inputs and run the command again.',
    details = {},
    cause = undefined,
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ManufacturingActionDatasetError';
    this.code = code;
    this.reason_code = code;
    this.stage = stage;
    this.json_pointer = jsonPointer;
    this.remediation = remediation;
    this.details = Object.freeze({ ...details });
  }
}

function serviceError(code, message, options = {}) {
  return new ManufacturingActionDatasetError(code, message, options);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function clone(value) {
  return structuredClone(value);
}

function canonicalJson(value) {
  return serializeManufacturingActionJson(value);
}

function stableArtifactId(prefix, components) {
  return `${prefix}:${sha256(components.join('\0')).slice(0, 24)}`;
}

function assertGeneratedAt(value) {
  const match = typeof value === 'string' ? value.match(GENERATED_AT_PATTERN) : null;
  const parsed = match ? Date.parse(value) : Number.NaN;
  const date = Number.isNaN(parsed) ? null : new Date(parsed);
  const exact = date
    && date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3])
    && date.getUTCHours() === Number(match[4])
    && date.getUTCMinutes() === Number(match[5])
    && date.getUTCSeconds() === Number(match[6])
    && date.getUTCMilliseconds() === Number(match[7] || 0);
  if (!exact) {
    throw serviceError('invalid_generated_at', 'generatedAt must be an explicit UTC RFC 3339 timestamp.', {
      stage: 'schema',
      jsonPointer: '/generated_at',
      remediation: 'Pass --generated-at as YYYY-MM-DDTHH:mm:ssZ or with exactly three fractional digits.',
    });
  }
  return value;
}

function assertProofActivation(value) {
  if (value !== true) {
    throw serviceError('proof_lineage_required', 'Manufacturing action generation requires explicit proof-lineage activation.', {
      stage: 'lineage',
      jsonPointer: '/effective_policy/proof_lineage',
      remediation: 'Invoke the command with the valueless --proof-lineage flag.',
    });
  }
}

function assertRepoRelativePath(value, label) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw serviceError('unsafe_path', `${label} must be an explicit repository-relative path.`, {
      stage: 'schema',
      jsonPointer: `/${label.replaceAll(' ', '_')}`,
    });
  }
  if (isAbsolute(value)
    || value.startsWith('~')
    || value.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(value)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    || /%(?:2e|2f|5c)/i.test(value)) {
    throw serviceError('unsafe_path', `${label} must use a portable repository-relative locator.`, {
      stage: 'schema',
      jsonPointer: `/${label.replaceAll(' ', '_')}`,
    });
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw serviceError('unsafe_path', `${label} must not contain empty, current-directory, or parent-directory segments.`, {
      stage: 'schema',
      jsonPointer: `/${label.replaceAll(' ', '_')}`,
    });
  }
  return value;
}

function assertOutputLocator(value) {
  const locator = assertRepoRelativePath(value, 'out dir');
  if (!(locator.startsWith('output/') || locator.startsWith('tmp/codex/'))) {
    throw serviceError('unsafe_output_path', 'out dir must be strictly below output/ or tmp/codex/.', {
      stage: 'schema',
      jsonPointer: '/out_dir',
      remediation: 'Select a dedicated ignored directory below output/ or tmp/codex/.',
    });
  }
  return locator.replace(/\/$/, '');
}

function strictDescendantLocator(root, target) {
  const locator = relative(root, target).replaceAll('\\', '/');
  if (!locator
    || locator === '..'
    || locator.startsWith('../')
    || isAbsolute(locator)
    || locator.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    return null;
  }
  return locator;
}

async function pinOutputBoundaryRoot(rootValue, label, { requireCanonicalInput = false } = {}) {
  const requestedRoot = resolve(rootValue);
  let info;
  let canonicalRoot;
  try {
    [info, canonicalRoot] = await Promise.all([
      lstat(requestedRoot),
      realpath(requestedRoot),
    ]);
  } catch (error) {
    throw serviceError('unsafe_output_path', `${label} must be an existing real directory.`, {
      stage: 'schema',
      jsonPointer: '/out_dir',
      cause: error,
    });
  }
  if (!info.isDirectory()
    || info.isSymbolicLink()
    || (requireCanonicalInput && canonicalRoot !== requestedRoot)) {
    throw serviceError('unsafe_output_path', `${label} must be a real non-symlink directory.`, {
      stage: 'schema',
      jsonPointer: '/out_dir',
    });
  }
  return Object.freeze({
    requested_root: requestedRoot,
    root: canonicalRoot,
    root_dev: info.dev,
    root_ino: info.ino,
  });
}

async function resolveOutputBoundary({ projectRoot, outDir, trustedOutputRoots = [] }) {
  if (!Array.isArray(trustedOutputRoots)
    || trustedOutputRoots.length > 8
    || trustedOutputRoots.some((entry) => typeof entry !== 'string'
      || !entry.trim()
      || entry !== entry.trim()
      || !isAbsolute(entry)
      || entry.includes('\\')
      || /[\u0000-\u001f\u007f]/.test(entry)
      || resolve(entry) !== entry)) {
    throw serviceError('unsafe_output_path', 'trustedOutputRoots must be a bounded server-owned path list.', {
      stage: 'schema',
      jsonPointer: '/out_dir',
    });
  }

  if (typeof outDir !== 'string' || !isAbsolute(outDir)) {
    const locator = assertOutputLocator(outDir);
    const rootPin = await pinOutputBoundaryRoot(projectRoot, 'projectRoot', {
      requireCanonicalInput: true,
    });
    return Object.freeze({
      ...rootPin,
      locator,
      output_directory: resolve(rootPin.root, locator),
      kind: 'repository_ignored_root',
    });
  }

  if (trustedOutputRoots.length === 0) {
    assertOutputLocator(outDir);
  }

  if (typeof outDir !== 'string'
    || outDir !== outDir.trim()
    || outDir.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(outDir)
    || outDir.split('/').some((segment) => segment === '.' || segment === '..')
    || resolve(outDir) !== outDir) {
    throw serviceError('unsafe_output_path', 'Trusted output path must be an exact normalized absolute path.', {
      stage: 'schema',
      jsonPointer: '/out_dir',
    });
  }

  const matchingRoot = trustedOutputRoots
    .map((entry) => resolve(entry))
    .sort((left, right) => right.length - left.length)
    .find((entry) => strictDescendantLocator(entry, outDir));
  if (!matchingRoot) {
    throw serviceError('unsafe_output_path', 'Absolute out dir must stay below an explicit server-owned trusted output root.', {
      stage: 'schema',
      jsonPointer: '/out_dir',
    });
  }
  const rootPin = await pinOutputBoundaryRoot(matchingRoot, 'Trusted output root');
  const locator = strictDescendantLocator(matchingRoot, outDir);
  return Object.freeze({
    ...rootPin,
    locator,
    output_directory: resolve(rootPin.root, locator),
    kind: 'server_trusted_root',
  });
}

function strictUtf8(bytes, label) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw serviceError('bom_forbidden', `${label} must not contain a UTF-8 byte-order mark.`, {
      stage: 'schema',
    });
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    throw serviceError('invalid_utf8', `${label} must contain valid UTF-8.`, {
      stage: 'schema',
      cause: error,
    });
  }
}

function assertSafeControlDocument(document, label) {
  const bounds = validateJsonDocumentBounds(document, { maxDepth: 64, maxNodes: 50_000 });
  if (!bounds.ok) {
    const first = bounds.errors[0];
    throw serviceError(first.code, `${label} exceeds the bounded control-document limits.`, {
      stage: 'schema',
      jsonPointer: first.path || '/',
    });
  }
  const safety = validateInspectionEvidenceControlMaterial(document);
  if (!safety.ok) {
    const first = safety.errors[0];
    throw serviceError(first.code, `${label} contains unsafe control material.`, {
      stage: 'schema',
      jsonPointer: first.path || '/',
    });
  }
  const stack = [{ value: document, path: '' }];
  while (stack.length > 0) {
    const { value, path } = stack.pop();
    if (!value || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}/${key}`;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw serviceError('unsafe_control_key', `${label} contains a forbidden control-document key.`, {
          stage: 'schema',
          jsonPointer: childPath,
        });
      }
      stack.push({ value: child, path: childPath });
    }
  }
  return document;
}

function parseJsonSnapshot(snapshot, label) {
  strictUtf8(snapshot.bytes, label);
  try {
    return assertSafeControlDocument(
      parseInspectionEvidenceJsonBytes(snapshot.bytes, { requireCanonical: false }),
      label
    );
  } catch (error) {
    if (error instanceof ManufacturingActionDatasetError) throw error;
    throw serviceError(error?.code || 'malformed_json', `${label} is not valid duplicate-safe JSON.`, {
      stage: 'schema',
      cause: error,
    });
  }
}

function parseTomlSnapshot(snapshot, label) {
  const text = strictUtf8(snapshot.bytes, label);
  let document;
  try {
    document = parseToml(text);
  } catch (error) {
    const duplicate = /redefine an already defined table or value/i.test(error?.message || '');
    throw serviceError(duplicate ? 'duplicate_toml_key' : 'malformed_toml', `${label} is not valid duplicate-safe TOML.`, {
      stage: 'schema',
      cause: error,
    });
  }
  return assertSafeControlDocument(document, label);
}

function portableRunLocator(inputRoot, pathValue, label) {
  const rel = relative(inputRoot, pathValue).replaceAll('\\', '/');
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    throw serviceError('path_escape', `${label} must stay inside the proof input directory.`, {
      stage: 'lineage',
    });
  }
  return `run/${rel}`;
}

function exactTextValues(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function documentIdentity(document) {
  const lineage = document?.revision_lineage?.identity || {};
  const packageSlugs = exactTextValues([
    lineage.package_slug,
    document?.package_slug,
    document?.part?.package_slug,
    document?.package?.slug,
    document?.identity?.package_slug,
  ]);
  const partIds = exactTextValues([
    lineage.part_id,
    document?.part_id,
    document?.part?.part_id,
    document?.package?.part_identifier,
    document?.identity?.part_id,
  ]);
  const revisions = exactTextValues([
    lineage.revision,
    document?.revision,
    document?.part?.revision,
    document?.package?.revision,
    document?.identity?.revision,
  ]);
  if (packageSlugs.length !== 1 || partIds.length !== 1 || revisions.length !== 1) {
    throw serviceError('conflicting_identity', 'Proof document identity aliases must resolve to exactly one complete identity.', {
      stage: 'lineage',
      jsonPointer: '/revision_lineage/identity',
    });
  }
  return {
    package_slug: packageSlugs[0],
    part_id: partIds[0],
    revision: revisions[0],
    config_sha256: lineage.config_sha256,
  };
}

function assertExactIdentity(actual, expected, label) {
  for (const key of ['package_slug', 'part_id', 'revision', 'config_sha256']) {
    if (actual?.[key] !== expected[key]) {
      throw serviceError('conflicting_identity', `${label} ${key} does not match the authoritative config identity.`, {
        stage: 'lineage',
        jsonPointer: `/revision_lineage/identity/${key}`,
      });
    }
  }
}

function findExactParent(lineage, expected, label) {
  const matches = lineage.parents.filter((entry) => entry.role === expected.role);
  if (matches.length !== 1) {
    throw serviceError(matches.length === 0 ? 'missing_parent' : 'conflicting_identity', `${label} must contain exactly one ${expected.role} parent.`, {
      stage: 'lineage',
      jsonPointer: '/revision_lineage/parents',
    });
  }
  const actual = matches[0];
  for (const key of ['artifact_type', 'role', 'path', 'sha256', 'size_bytes']) {
    if ((actual[key] ?? null) !== (expected[key] ?? null)) {
      throw serviceError('digest_mismatch', `${label} ${expected.role} parent does not match the exact trusted snapshot.`, {
        stage: 'lineage',
        jsonPointer: '/revision_lineage/parents',
      });
    }
  }
  return actual;
}

function snapshotRecord(snapshot, { artifactType, role, path = snapshot.path }) {
  return Object.freeze({
    role,
    artifact_type: artifactType,
    path,
    sha256: snapshot.sha256,
    size_bytes: snapshot.size_bytes,
  });
}

function assertExpectedSourceBindings(expectedBindings, snapshots) {
  if (expectedBindings === null || expectedBindings === undefined) return;
  const requiredKeys = ['artifact_type', 'path', 'role', 'sha256', 'size_bytes'];
  const expectedRoles = [
    'authoritative_config',
    'review_pack',
    'inspection_plan',
    'robot_config',
    'manufacturing_task_plan',
  ];
  if (!Array.isArray(expectedBindings)
    || expectedBindings.length !== expectedRoles.length
    || expectedBindings.some((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true;
      const keys = Object.keys(entry).sort();
      return keys.length !== requiredKeys.length
        || keys.some((key, index) => key !== requiredKeys[index]);
    })) {
    throw serviceError('profile_source_binding_invalid', 'Expected source bindings must declare the exact five server-owned profile inputs.', {
      stage: 'schema',
      jsonPointer: '/expected_source_bindings',
    });
  }
  const expectedByRole = new Map(expectedBindings.map((entry) => [entry.role, entry]));
  if (expectedByRole.size !== expectedRoles.length
    || expectedRoles.some((role) => !expectedByRole.has(role))) {
    throw serviceError('profile_source_binding_invalid', 'Expected source bindings contain missing or duplicate input roles.', {
      stage: 'schema',
      jsonPointer: '/expected_source_bindings',
    });
  }
  for (const actual of snapshots) {
    const expected = expectedByRole.get(actual.role);
    if (!expected || requiredKeys.some((key) => expected[key] !== actual[key])) {
      throw serviceError('profile_source_mismatch', `The ${actual.role} input does not match the exact server-owned profile binding.`, {
        stage: 'lineage',
        jsonPointer: '/expected_source_bindings',
        details: { role: actual.role },
      });
    }
  }
}

function assertExactOrderedArray(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length
    || actual.some((entry, index) => entry !== expected[index])) {
    throw serviceError('source_universe_mismatch', `${label} must exactly match the grounded source order.`, {
      stage: 'reference',
    });
  }
}

function actionIds(actions) {
  return actions.map((action) => action.action_id);
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw serviceError('duplicate_reference', `${label} must not contain duplicates.`, {
      stage: 'reference',
    });
  }
}

function assertKnownReferences(values, known, label) {
  assertUnique(values, label);
  const unknown = values.filter((value) => !known.has(value));
  if (unknown.length > 0) {
    throw serviceError('unknown_reference', `${label} contains an ungrounded reference.`, {
      stage: 'reference',
      details: { unknown_count: unknown.length },
    });
  }
}

function assertContract(artifactType, document) {
  return assertManufacturingActionArtifact(document, { expectedType: artifactType });
}

function fixedBoundaries() {
  return clone(MANUFACTURING_ACTION_BOUNDARIES);
}

function normalizedAction(action) {
  return {
    order: action.order,
    action_id: action.action_id,
    primitive: action.primitive,
    actor_type: action.actor_type,
    duration_ms: action.duration_ms,
    references: {
      part_ids: [...action.references.part_ids],
      feature_ids: [...action.references.feature_ids],
      quality_characteristic_ids: [...action.references.quality_characteristic_ids],
      robot_joint_ids: [...action.references.robot_joint_ids],
      tool_interface_ids: [...action.references.tool_interface_ids],
      inspection_plan_item_ids: [...action.references.inspection_plan_item_ids],
    },
    preconditions: [...action.preconditions],
    postconditions: [...action.postconditions],
    allowed_previous_action_ids: [...action.allowed_previous_action_ids],
    allowed_next_action_ids: [...action.allowed_next_action_ids],
    instruction: { ko: action.instruction.ko, en: action.instruction.en },
    instruction_origin: action.instruction_origin,
    human_review_required: action.human_review_required,
    unresolved_requirement_ids: [...action.unresolved_requirement_ids],
  };
}

function normalizedRequirement(requirement) {
  return {
    requirement_id: requirement.requirement_id,
    category: requirement.category,
    description: requirement.description,
    required_for: [...requirement.required_for],
    status: requirement.status,
  };
}

function assertTaskSemantics({ taskPlan, config, robot, inspectionPlan }) {
  assertExactIdentity(taskPlan.identity, config.identity, 'manufacturing task plan');
  assertExactOrderedArray(taskPlan.source_universe.part_ids, [config.identity.part_id], 'task part universe');

  const configFeatureIds = (config.config.shapes || []).map((shape) => shape?.id).filter(Boolean);
  const configQualityIds = [
    ...(config.config.quality?.critical_dimensions || []),
    ...(config.config.quality?.functional_test_points || []),
  ].map((entry) => entry?.id).filter(Boolean);
  const robotJointIds = (robot.document.assembly?.joints || []).map((joint) => joint?.id).filter(Boolean);
  const robotPartIds = (robot.document.parts || []).map((part) => part?.id).filter(Boolean);

  assertExactOrderedArray(configFeatureIds, EXPECTED_FEATURE_IDS, 'authoritative feature universe');
  assertExactOrderedArray(configQualityIds, EXPECTED_QUALITY_IDS, 'authoritative quality universe');
  assertExactOrderedArray(robotJointIds, EXPECTED_JOINT_IDS, 'robot joint universe');
  if (!EXPECTED_TOOL_INTERFACE_IDS.every((id) => robotPartIds.includes(id))) {
    throw serviceError('unknown_reference', 'Robot config does not establish the required tool_flange interface.', {
      stage: 'reference',
      jsonPointer: '/robot/tool_interface_id',
    });
  }
  assertExactOrderedArray(taskPlan.source_universe.feature_ids, EXPECTED_FEATURE_IDS, 'task feature universe');
  assertExactOrderedArray(taskPlan.source_universe.quality_characteristic_ids, EXPECTED_QUALITY_IDS, 'task quality universe');
  assertExactOrderedArray(taskPlan.source_universe.robot_joint_ids, EXPECTED_JOINT_IDS, 'task joint universe');
  assertExactOrderedArray(taskPlan.source_universe.tool_interface_ids, EXPECTED_TOOL_INTERFACE_IDS, 'task tool-interface universe');

  if (taskPlan.robot.robot_config_path !== robot.snapshot.path
    || taskPlan.robot.robot_config_sha256 !== robot.snapshot.sha256
    || taskPlan.robot.robot_id !== robot.document.name
    || taskPlan.robot.tool_interface_id !== 'tool_flange') {
    throw serviceError('digest_mismatch', 'Task plan robot binding does not match the exact robot config snapshot.', {
      stage: 'reference',
      jsonPointer: '/robot',
    });
  }
  assertExactOrderedArray(taskPlan.robot.joint_ids, EXPECTED_JOINT_IDS, 'task robot joints');

  const actions = taskPlan.actions;
  assertExactOrderedArray(actionIds(actions), EXPECTED_ACTION_IDS, 'task action sequence');
  const known = {
    part: new Set([config.identity.part_id]),
    feature: new Set(configFeatureIds),
    quality: new Set(configQualityIds),
    joint: new Set(robotJointIds),
    tool: new Set(EXPECTED_TOOL_INTERFACE_IDS),
    planItem: new Set((inspectionPlan.items || []).map((item) => item.plan_item_id)),
  };
  const requirementIds = taskPlan.unresolved_requirements.map((entry) => entry.requirement_id);
  assertUnique(requirementIds, 'unresolved requirement IDs');
  const expectedCategories = ['fixture', 'gripper', 'part_robot_transform', 'probe', 'released_tolerance', 'trajectory'];
  const categories = taskPlan.unresolved_requirements.map((entry) => entry.category).sort();
  assertExactOrderedArray(categories, expectedCategories, 'unresolved requirement categories');

  actions.forEach((action, index) => {
    if (action.order !== index + 1) {
      throw serviceError('invalid_action_order', 'Task action order must be contiguous from 1 through 10.', {
        stage: 'semantic',
        jsonPointer: `/actions/${index}/order`,
      });
    }
    const expectedPrevious = index === 0 ? [] : [actions[index - 1].action_id];
    const expectedNext = index === actions.length - 1 ? [] : [actions[index + 1].action_id];
    assertExactOrderedArray(action.allowed_previous_action_ids, expectedPrevious, `action ${action.action_id} previous transition`);
    assertExactOrderedArray(action.allowed_next_action_ids, expectedNext, `action ${action.action_id} next transition`);
    assertKnownReferences(action.references.part_ids, known.part, `${action.action_id} part references`);
    assertKnownReferences(action.references.feature_ids, known.feature, `${action.action_id} feature references`);
    assertKnownReferences(action.references.quality_characteristic_ids, known.quality, `${action.action_id} quality references`);
    assertKnownReferences(action.references.robot_joint_ids, known.joint, `${action.action_id} joint references`);
    assertKnownReferences(action.references.tool_interface_ids, known.tool, `${action.action_id} tool-interface references`);
    assertKnownReferences(action.references.inspection_plan_item_ids, known.planItem, `${action.action_id} inspection-plan references`);
    assertKnownReferences(action.unresolved_requirement_ids, new Set(requirementIds), `${action.action_id} unresolved requirement references`);
    if (!/[\u3131-\uD79D]/u.test(action.instruction.ko) || !/[A-Za-z]/.test(action.instruction.en)) {
      throw serviceError('language_coverage_missing', 'Every action requires substantive Korean and English instruction text.', {
        stage: 'semantic',
        jsonPointer: `/actions/${index}/instruction`,
      });
    }
  });

  for (const [index, requirement] of taskPlan.unresolved_requirements.entries()) {
    assertKnownReferences(requirement.required_for, new Set(EXPECTED_ACTION_IDS), `unresolved requirement ${requirement.requirement_id} action references`);
    if (requirement.required_for.length === 0) {
      throw serviceError('missing_reference', 'Every unresolved physical requirement must identify an affected action.', {
        stage: 'reference',
        jsonPointer: `/unresolved_requirements/${index}/required_for`,
      });
    }
  }

  const referenced = (field) => new Set(actions.flatMap((action) => action.references[field]));
  for (const [field, expected, label] of [
    ['feature_ids', EXPECTED_FEATURE_IDS, 'feature'],
    ['quality_characteristic_ids', EXPECTED_QUALITY_IDS, 'quality'],
    ['robot_joint_ids', EXPECTED_JOINT_IDS, 'joint'],
  ]) {
    const values = referenced(field);
    if (!expected.every((entry) => values.has(entry))) {
      throw serviceError('incomplete_reference_coverage', `Task plan does not cover the full grounded ${label} universe.`, {
        stage: 'reference',
      });
    }
  }
}

async function readAndReconcileInputs({
  projectRoot,
  configPath,
  reviewPackPath,
  inspectionPlanPath,
  robotConfigPath,
  taskPlanPath,
  expectedSourceBindings = null,
}) {
  const paths = {
    configPath: assertRepoRelativePath(configPath, 'config path'),
    reviewPackPath: assertRepoRelativePath(reviewPackPath, 'review pack path'),
    inspectionPlanPath: assertRepoRelativePath(inspectionPlanPath, 'inspection plan path'),
    robotConfigPath: assertRepoRelativePath(robotConfigPath, 'robot config path'),
    taskPlanPath: assertRepoRelativePath(taskPlanPath, 'task plan path'),
  };
  if (new Set(Object.values(paths)).size !== Object.values(paths).length) {
    throw serviceError('duplicate_input_path', 'Manufacturing action inputs must use five distinct paths.', {
      stage: 'schema',
    });
  }

  const [configSnapshot, reviewSnapshot, inspectionSnapshot, robotSnapshot, taskSnapshot] = await Promise.all([
    readAuthoritativeConfigSnapshot({ projectRoot, configPath: paths.configPath }),
    readRevisionLineageFileSnapshot({ projectRoot, path: paths.reviewPackPath, maxBytes: MAX_CONTROL_BYTES }),
    readRevisionLineageFileSnapshot({ projectRoot, path: paths.inspectionPlanPath, maxBytes: MAX_CONTROL_BYTES }),
    readRevisionLineageFileSnapshot({ projectRoot, path: paths.robotConfigPath, maxBytes: MAX_CONTROL_BYTES }),
    readRevisionLineageFileSnapshot({ projectRoot, path: paths.taskPlanPath, maxBytes: MAX_CONTROL_BYTES }),
  ]);

  assertExpectedSourceBindings(expectedSourceBindings, [
    snapshotRecord(configSnapshot, { artifactType: 'config', role: 'authoritative_config' }),
    snapshotRecord(reviewSnapshot, { artifactType: 'review_pack', role: 'review_pack' }),
    snapshotRecord(inspectionSnapshot, { artifactType: 'inspection_plan', role: 'inspection_plan' }),
    snapshotRecord(robotSnapshot, { artifactType: 'robot_config', role: 'robot_config' }),
    snapshotRecord(taskSnapshot, { artifactType: 'manufacturing_task_plan', role: 'manufacturing_task_plan' }),
  ]);

  const reviewPack = parseJsonSnapshot(reviewSnapshot, 'review pack');
  const inspectionPlan = parseJsonSnapshot(inspectionSnapshot, 'inspection plan');
  const robotDocument = parseTomlSnapshot(robotSnapshot, 'robot config');
  const taskPlan = parseJsonSnapshot(taskSnapshot, 'manufacturing task plan');

  if (reviewPack.artifact_type !== 'review_pack') {
    throw serviceError('unexpected_artifact_type', 'Review input must have artifact_type review_pack.', {
      stage: 'schema',
      jsonPointer: '/artifact_type',
    });
  }
  if (inspectionPlan.artifact_type !== 'inspection_plan') {
    throw serviceError('unexpected_artifact_type', 'Inspection input must have artifact_type inspection_plan.', {
      stage: 'schema',
      jsonPointer: '/artifact_type',
    });
  }
  assertContract('manufacturing_task_plan', taskPlan);
  assertValidInspectionPlan(inspectionPlan);

  const configParent = buildRevisionLineageParentFromSnapshot({
    artifactType: 'config',
    role: 'authoritative_config',
    snapshot: configSnapshot,
  });
  let reviewLineage;
  try {
    reviewLineage = assertRevisionLineage(reviewPack.revision_lineage);
    assertRevisionLineageIdentityAgreement([configSnapshot.identity, reviewLineage]);
  } catch (error) {
    if (error instanceof ManufacturingActionDatasetError) throw error;
    throw serviceError(error?.code || 'unsupported_legacy', 'Review pack is not proof-lineage eligible.', {
      stage: 'lineage',
      cause: error,
    });
  }
  assertExactIdentity(documentIdentity(reviewPack), configSnapshot.identity, 'review pack');
  findExactParent(reviewLineage, configParent, 'review pack');

  let inspectionLineage;
  try {
    inspectionLineage = assertInspectionPlanRevisionLineageContinuity(inspectionPlan);
    assertRevisionLineageIdentityAgreement([configSnapshot.identity, inspectionLineage]);
  } catch (error) {
    throw serviceError(error?.code || 'unsupported_legacy', 'Inspection plan is not proof-lineage eligible.', {
      stage: 'lineage',
      cause: error,
    });
  }
  assertExactIdentity(documentIdentity(inspectionPlan), configSnapshot.identity, 'inspection plan');
  findExactParent(inspectionLineage, configParent, 'inspection plan');

  const proofInputRoot = dirname(reviewSnapshot.path);
  const reviewRunPath = portableRunLocator(proofInputRoot, reviewSnapshot.path, 'review pack');
  const inspectionRunPath = portableRunLocator(proofInputRoot, inspectionSnapshot.path, 'inspection plan');
  const inspectionReviewParent = buildRevisionLineageParent({
    artifactType: 'review_pack',
    role: 'review_pack',
    path: reviewRunPath,
    sha256: reviewSnapshot.sha256,
    sizeBytes: reviewSnapshot.size_bytes,
  });
  findExactParent(inspectionLineage, inspectionReviewParent, 'inspection plan');

  const sourceSnapshotCandidates = [
    snapshotRecord(configSnapshot, { artifactType: 'config', role: 'authoritative_config' }),
    snapshotRecord(reviewSnapshot, { artifactType: 'review_pack', role: 'review_pack', path: reviewRunPath }),
    snapshotRecord(inspectionSnapshot, { artifactType: 'inspection_plan', role: 'inspection_plan', path: inspectionRunPath }),
    snapshotRecord(robotSnapshot, { artifactType: 'robot_config', role: 'robot_config' }),
    snapshotRecord(taskSnapshot, { artifactType: 'manufacturing_task_plan', role: 'manufacturing_task_plan' }),
  ];
  const revisionLineage = buildRevisionLineage({
    identity: configSnapshot.identity,
    parents: sourceSnapshotCandidates.map((entry) => buildRevisionLineageParent(entry)),
  });
  const sourceSnapshots = Object.freeze(
    revisionLineage.parents.map((entry) => Object.freeze({ ...entry }))
  );

  const robot = { document: robotDocument, snapshot: robotSnapshot };
  const config = { config: configSnapshot.config, identity: configSnapshot.identity, snapshot: configSnapshot };
  assertTaskSemantics({ taskPlan, config, robot, inspectionPlan });

  return Object.freeze({
    config,
    reviewPack,
    inspectionPlan,
    robot,
    taskPlan,
    sourceSnapshots,
    revisionLineage,
    proofInputRoot,
    snapshots: Object.freeze([configSnapshot, reviewSnapshot, inspectionSnapshot, robotSnapshot, taskSnapshot]),
  });
}

function commonHeader({ artifactType, artifactId, generatedAt, inputs }) {
  return {
    schema_version: '1.0',
    artifact_type: artifactType,
    artifact_id: artifactId,
    generated_at: generatedAt,
    identity: clone(inputs.config.identity),
    revision_lineage: clone(inputs.revisionLineage),
    source_snapshots: inputs.sourceSnapshots.map((entry) => ({ ...entry })),
    boundaries: fixedBoundaries(),
  };
}

function payloadRecord({ artifactType, artifactId, role, path, bytes }) {
  return {
    artifact_type: artifactType,
    artifact_id: artifactId,
    role,
    path,
    sha256: sha256(bytes),
    size_bytes: bytes.length,
  };
}

function buildEpisodeSegments(actions) {
  let cursor = 0;
  return actions.map((action) => {
    const start = cursor;
    const end = start + action.duration_ms;
    cursor = end;
    return {
      segment_id: `segment_${String(action.order).padStart(2, '0')}_${action.action_id}`,
      order: action.order,
      action_id: action.action_id,
      start_ms: start,
      end_ms: end,
      duration_ms: action.duration_ms,
      instruction: { ko: action.instruction.ko, en: action.instruction.en },
      human_review_required: true,
    };
  });
}

function coverageMetric(actions, field, total) {
  const referenced = new Set(actions.flatMap((action) => action.references[field]));
  return {
    referenced_count: referenced.size,
    total_count: total,
    coverage_percent: total === 0 ? 100 : Number(((referenced.size / total) * 100).toFixed(2)),
  };
}

function renderHandoffMarkdown(handoff) {
  const lines = [
    '# Design · Manufacturing · Quality Handoff',
    '',
    `- Artifact ID: ${handoff.artifact_id}`,
    `- Generated at: ${handoff.generated_at}`,
    `- Package / part / revision: ${handoff.identity.package_slug} / ${handoff.identity.part_id} / ${handoff.identity.revision}`,
    `- Authoritative config SHA-256: ${handoff.identity.config_sha256}`,
    '',
    '## 한국어 요약',
    '',
    handoff.localized_summary.ko,
    '',
    '## English summary',
    '',
    handoff.localized_summary.en,
    '',
    '## Design',
    '',
    `- Part: ${handoff.design.part_id}`,
    `- Revision: ${handoff.design.revision}`,
    `- Features: ${handoff.design.feature_ids.join(', ')}`,
    `- Source digest: ${handoff.design.source_digest}`,
    '',
    '## Manufacturing',
    '',
    ...handoff.manufacturing.action_ids.map((actionId, index) => `${index + 1}. ${actionId}`),
    '',
    `- Robot joints: ${handoff.manufacturing.robot_joint_ids.join(', ')}`,
    `- Grounded tool interface: ${handoff.manufacturing.tool_interface_ids.join(', ')}`,
    `- Unresolved requirements: ${handoff.manufacturing.unresolved_requirement_ids.join(', ')}`,
    '',
    '## Quality',
    '',
    `- Characteristics: ${handoff.quality.quality_characteristic_ids.join(', ')}`,
    `- Inspection plan SHA-256: ${handoff.quality.inspection_plan_ref.sha256}`,
    '- Inspection evidence: false',
    '- Quality approval granted: false',
    '',
    '## Trust and fixed boundaries',
    '',
    ...Object.entries(handoff.boundaries).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '### Remaining holds',
    '',
    ...handoff.trust.remaining_holds.map((hold) => `- ${hold}`),
    '',
    '## Approvals',
    '',
    `- ${handoff.approvals.statement}`,
    '- Engineering: false',
    '- Manufacturing: false',
    '- Quality: false',
    '- Inspection: false',
    '- Readiness: false',
    '- Release: false',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function buildDomainArtifacts({ inputs, generatedAt }) {
  const actions = inputs.taskPlan.actions.map(normalizedAction);
  const unresolvedRequirements = inputs.taskPlan.unresolved_requirements.map(normalizedRequirement);
  const stableComponents = inputs.sourceSnapshots.map((entry) => `${entry.role}:${entry.sha256}`);

  const actionDictionary = {
    ...commonHeader({
      artifactType: 'manufacturing_action_dictionary',
      artifactId: stableArtifactId('manufacturing-action-dictionary', stableComponents),
      generatedAt,
      inputs,
    }),
    source_universe: clone(inputs.taskPlan.source_universe),
    actions,
    unresolved_requirements: unresolvedRequirements,
  };
  assertContract('manufacturing_action_dictionary', actionDictionary);
  const actionDictionaryBytes = Buffer.from(canonicalJson(actionDictionary), 'utf8');
  const actionDictionaryRecord = payloadRecord({
    artifactType: actionDictionary.artifact_type,
    artifactId: actionDictionary.artifact_id,
    role: 'action_dictionary',
    path: OUTPUT_FILENAMES.action_dictionary,
    bytes: actionDictionaryBytes,
  });

  const segments = buildEpisodeSegments(actions);
  const episodeAnnotation = {
    ...commonHeader({
      artifactType: 'manufacturing_episode_annotation',
      artifactId: stableArtifactId('manufacturing-episode-annotation', [...stableComponents, actionDictionaryRecord.sha256]),
      generatedAt,
      inputs,
    }),
    source: 'synthetic_task_timeline',
    annotation_origin: 'curated_task_plan',
    confidence: {
      value: null,
      applicability: 'not_applicable',
      rationale: 'No computer-vision or machine-learning model produced these curated synthetic labels.',
    },
    action_dictionary: actionDictionaryRecord,
    segments,
  };
  assertContract('manufacturing_episode_annotation', episodeAnnotation);
  const episodeBytes = Buffer.from(canonicalJson(episodeAnnotation), 'utf8');
  const episodeRecord = payloadRecord({
    artifactType: episodeAnnotation.artifact_type,
    artifactId: episodeAnnotation.artifact_id,
    role: 'episode_annotation',
    path: OUTPUT_FILENAMES.episode_annotation,
    bytes: episodeBytes,
  });

  const taskSnapshot = inputs.sourceSnapshots.find((entry) => entry.role === 'manufacturing_task_plan');
  const taskRecord = {
    artifact_type: 'manufacturing_task_plan',
    artifact_id: inputs.taskPlan.artifact_id,
    role: 'manufacturing_task_plan',
    path: taskSnapshot.path,
    sha256: taskSnapshot.sha256,
    size_bytes: taskSnapshot.size_bytes,
  };
  const datasetManifest = {
    ...commonHeader({
      artifactType: 'manufacturing_robotics_dataset_manifest',
      artifactId: stableArtifactId('manufacturing-robotics-dataset', [
        taskRecord.sha256,
        actionDictionaryRecord.sha256,
        episodeRecord.sha256,
      ]),
      generatedAt,
      inputs,
    }),
    dataset: {
      source: 'synthetic_task_timeline',
      annotation_origin: 'curated_task_plan',
      action_count: actions.length,
      segment_count: segments.length,
    },
    members: [taskRecord, actionDictionaryRecord, episodeRecord],
  };
  assertContract('manufacturing_robotics_dataset_manifest', datasetManifest);
  const datasetManifestBytes = Buffer.from(canonicalJson(datasetManifest), 'utf8');

  const validationReport = {
    ...commonHeader({
      artifactType: 'manufacturing_data_validation_report',
      artifactId: stableArtifactId('manufacturing-data-validation', [sha256(datasetManifestBytes)]),
      generatedAt,
      inputs,
    }),
    status: 'valid_synthetic_demo',
    metrics: {
      action_count: actions.length,
      segment_count: segments.length,
      unique_primitive_count: new Set(actions.map((action) => action.primitive)).size,
      feature_coverage: coverageMetric(actions, 'feature_ids', EXPECTED_FEATURE_IDS.length),
      joint_coverage: coverageMetric(actions, 'robot_joint_ids', EXPECTED_JOINT_IDS.length),
      quality_coverage: coverageMetric(actions, 'quality_characteristic_ids', EXPECTED_QUALITY_IDS.length),
      language_coverage: {
        korean_percent: 100,
        english_percent: 100,
      },
      unknown_reference_count: 0,
      duplicate_reference_count: 0,
      transition_violation_count: 0,
      timeline_violation_count: 0,
      unresolved_requirement_count: unresolvedRequirements.length,
      lineage_status: 'valid',
      boundary_status: 'valid',
    },
    checks: [
      {
        check_id: 'reference_integrity',
        status: 'pass',
        violation_count: 0,
        message: 'All part, feature, quality, joint, tool-interface, plan-item, and action references resolve to grounded source universes.',
        remediation: null,
      },
      {
        check_id: 'transition_integrity',
        status: 'pass',
        violation_count: 0,
        message: 'The ten curated actions form one exact allowed transition chain.',
        remediation: null,
      },
      {
        check_id: 'timeline_integrity',
        status: 'pass',
        violation_count: 0,
        message: 'All synthetic episode segments are monotonic, contiguous, and non-overlapping.',
        remediation: null,
      },
      {
        check_id: 'lineage_integrity',
        status: 'pass',
        violation_count: 0,
        message: 'Five exact read-once source snapshots agree with the authoritative hinge-block revision identity.',
        remediation: null,
      },
      {
        check_id: 'boundary_integrity',
        status: 'pass',
        violation_count: 0,
        message: 'Synthetic-only, no-evidence, no-readiness, no-release, and human-review boundaries are fixed and valid.',
        remediation: null,
      },
      {
        check_id: 'physical_engineering_inputs',
        status: 'review_required',
        violation_count: unresolvedRequirements.length,
        message: 'Physical gripper, probe, fixture, transform, trajectory, and released-tolerance requirements remain unresolved.',
        remediation: 'Resolve and review physical engineering inputs before any hardware execution, training export, or production claim.',
      },
    ],
    diagnostics: [],
  };
  assertContract('manufacturing_data_validation_report', validationReport);
  const validationBytes = Buffer.from(canonicalJson(validationReport), 'utf8');

  const inspectionSnapshot = inputs.sourceSnapshots.find((entry) => entry.role === 'inspection_plan');
  const remainingHolds = [
    'HUMAN_UAT: NOT_RUN',
    'REAL_SHOP_FLOOR_DATA: NONE',
    'COMPUTER_VISION: NOT_IMPLEMENTED',
    'LEROBOT_EXPORT: NOT_IMPLEMENTED / NOT_CLAIMED',
    'AUTHORITATIVE_BASELINE: HOLD',
    'GENUINE_INSPECTION_INPUT: HOLD',
    'CANONICAL_READINESS: UNCHANGED / HOLD',
    'PRODUCTION_RELEASE: NOT_PERFORMED',
  ];
  const handoff = {
    ...commonHeader({
      artifactType: 'design_manufacturing_quality_handoff',
      artifactId: stableArtifactId('design-manufacturing-quality-handoff', [sha256(datasetManifestBytes)]),
      generatedAt,
      inputs,
    }),
    design: {
      part_id: inputs.config.identity.part_id,
      revision: inputs.config.identity.revision,
      feature_ids: [...EXPECTED_FEATURE_IDS],
      source_digest: inputs.config.identity.config_sha256,
    },
    manufacturing: {
      action_ids: [...EXPECTED_ACTION_IDS],
      robot_joint_ids: [...EXPECTED_JOINT_IDS],
      tool_interface_ids: [...EXPECTED_TOOL_INTERFACE_IDS],
      preconditions: actions.flatMap((action) => action.preconditions),
      postconditions: actions.flatMap((action) => action.postconditions),
      unresolved_requirement_ids: unresolvedRequirements.map((entry) => entry.requirement_id),
    },
    quality: {
      quality_characteristic_ids: [...EXPECTED_QUALITY_IDS],
      inspection_plan_ref: { ...inspectionSnapshot },
      inspection_evidence: false,
      approval_granted: false,
    },
    trust: {
      lineage_status: 'valid',
      exact_hashes: inputs.sourceSnapshots.map((entry) => ({ ...entry })),
      synthetic_only: true,
      remaining_holds: remainingHolds,
    },
    localized_summary: {
      ko: '승인된 hinge-block 리비전 계보와 합성 작업 계획을 연결한 오프라인 데모입니다. 실제 생산 데이터, 검사 증거, 준비 상태 승인 또는 릴리스를 의미하지 않습니다.',
      en: 'This offline demo binds an approved hinge-block revision lineage to a curated synthetic task plan. It is not real production data, inspection evidence, readiness approval, or a release.',
    },
    approvals: {
      engineering: false,
      manufacturing: false,
      quality: false,
      inspection: false,
      readiness: false,
      release: false,
      statement: 'This handoff grants no engineering, manufacturing, quality, inspection, readiness, or release approval.',
    },
  };
  assertContract('design_manufacturing_quality_handoff', handoff);
  const handoffJsonBytes = Buffer.from(canonicalJson(handoff), 'utf8');
  const handoffMarkdownBytes = Buffer.from(renderHandoffMarkdown(handoff), 'utf8');

  return {
    documents: {
      action_dictionary: actionDictionary,
      episode_annotation: episodeAnnotation,
      validation_report: validationReport,
      dataset_manifest: datasetManifest,
      handoff_json: handoff,
    },
    payloads: new Map([
      [OUTPUT_FILENAMES.action_dictionary, actionDictionaryBytes],
      [OUTPUT_FILENAMES.episode_annotation, episodeBytes],
      [OUTPUT_FILENAMES.validation_report, validationBytes],
      [OUTPUT_FILENAMES.dataset_manifest, datasetManifestBytes],
      [OUTPUT_FILENAMES.handoff_json, handoffJsonBytes],
      [OUTPUT_FILENAMES.handoff_markdown, handoffMarkdownBytes],
    ]),
  };
}

function bundleDigest(payloads) {
  const hash = createHash('sha256');
  for (const [name, bytes] of payloads) {
    hash.update(name);
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function buildExecutionManifests({
  projectRoot,
  outputDirectory,
  inputs,
  generatedAt,
  domain,
  repoContext,
}) {
  const domainRecords = DOMAIN_OUTPUTS.map(([key, artifactType]) => {
    const bytes = domain.payloads.get(OUTPUT_FILENAMES[key]);
    return {
      key,
      artifactType,
      path: resolve(outputDirectory, OUTPUT_FILENAMES[key]),
      bytes,
      sha256: sha256(bytes),
      size_bytes: bytes.length,
    };
  });
  const warning = 'Synthetic data only; six physical engineering requirements and all human approvals remain open.';
  const artifactManifest = await buildArtifactManifest({
    projectRoot,
    interface: 'cli',
    command: 'manufacturing-action-dataset',
    jobType: 'manufacturing-action-dataset',
    status: 'succeeded',
    configPath: resolve(projectRoot, inputs.config.snapshot.path),
    configSummary: {
      input_version: inputs.config.config.config_version ?? null,
      target_version: inputs.config.config.config_version ?? null,
      warnings: [],
      deprecated_fields: [],
      changed_fields: [],
    },
    warnings: [warning],
    artifacts: domainRecords.map((record) => ({
      type: record.artifactType,
      path: record.path,
      label: record.key.replaceAll('_', ' '),
      scope: 'user-facing',
      stability: 'stable',
      precomputed: {
        exists: true,
        size_bytes: record.size_bytes,
        sha256: record.sha256,
      },
    })),
    timestamps: {
      created_at: generatedAt,
      started_at: generatedAt,
      finished_at: generatedAt,
    },
    details: {
      dataset_status: 'valid_synthetic_demo',
      artifact_id: domain.documents.dataset_manifest.artifact_id,
      boundaries: fixedBoundaries(),
      unresolved_requirement_count: inputs.taskPlan.unresolved_requirements.length,
    },
    runtimeDiagnostics: NO_RUNTIME_DIAGNOSTICS,
    effectivePolicy: { proof_lineage: true },
    revisionLineage: inputs.revisionLineage,
    portablePathRoot: outputDirectory,
  });
  const artifactManifestBytes = Buffer.from(`${JSON.stringify(artifactManifest, null, 2)}\n`, 'utf8');
  const artifactManifestRecord = {
    path: resolve(outputDirectory, OUTPUT_FILENAMES.artifact_manifest),
    kind: 'artifact_manifest',
    exists: true,
    size_bytes: artifactManifestBytes.length,
    sha256: sha256(artifactManifestBytes),
  };

  const declaredOutputRecords = [
    ...domainRecords.map((record) => ({
      path: record.path,
      kind: record.artifactType,
      exists: true,
      size_bytes: record.size_bytes,
      sha256: record.sha256,
    })),
    artifactManifestRecord,
  ];
  const outputManifest = await buildOutputManifest({
    projectRoot,
    repoContext,
    command: 'manufacturing-action-dataset',
    commandArgs: [
      '--config', inputs.sourceSnapshots.find((entry) => entry.role === 'authoritative_config').path,
      '--review-pack', inputs.sourceSnapshots.find((entry) => entry.role === 'review_pack').path,
      '--inspection-plan', inputs.sourceSnapshots.find((entry) => entry.role === 'inspection_plan').path,
      '--robot-config', inputs.sourceSnapshots.find((entry) => entry.role === 'robot_config').path,
      '--task-plan', inputs.sourceSnapshots.find((entry) => entry.role === 'manufacturing_task_plan').path,
      '--proof-lineage',
      '--generated-at', generatedAt,
      '--out-dir', 'run/',
    ],
    inputPath: resolve(projectRoot, inputs.config.snapshot.path),
    inputRecord: {
      path: resolve(projectRoot, inputs.config.snapshot.path),
      sha256: inputs.config.snapshot.sha256,
      size_bytes: inputs.config.snapshot.size_bytes,
    },
    outputs: declaredOutputRecords.map((record) => ({ path: record.path, kind: record.kind })),
    outputRecords: declaredOutputRecords,
    warnings: [warning],
    status: 'warning',
    timings: {
      startedAt: generatedAt,
      finishedAt: generatedAt,
    },
    runtimeDiagnostics: NO_RUNTIME_DIAGNOSTICS,
    effectivePolicy: { proof_lineage: true },
    revisionLineage: inputs.revisionLineage,
    portablePathRoot: outputDirectory,
  });
  const outputManifestBytes = Buffer.from(`${JSON.stringify(outputManifest, null, 2)}\n`, 'utf8');

  return {
    documents: { artifact_manifest: artifactManifest, output_manifest: outputManifest },
    payloads: new Map([
      [OUTPUT_FILENAMES.artifact_manifest, artifactManifestBytes],
      [OUTPUT_FILENAMES.output_manifest, outputManifestBytes],
    ]),
  };
}

function assertExactPayloadSet(payloads) {
  const expected = Object.values(OUTPUT_FILENAMES);
  const actual = [...payloads.keys()];
  if (actual.length !== expected.length || expected.some((name) => !payloads.has(name))) {
    throw serviceError('output_set_mismatch', 'Prepared manufacturing action output set is not the exact fixed eight-file set.', {
      stage: 'semantic',
    });
  }
  for (const [name, bytes] of payloads) {
    if (!expected.includes(name) || !Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw serviceError('invalid_output_payload', 'Prepared manufacturing action output payload is invalid.', {
        stage: 'semantic',
      });
    }
  }
}

async function assertAllSnapshotsCurrent(inputs, projectRoot) {
  await Promise.all(inputs.snapshots.map((snapshot) => assertRevisionLineageSnapshotCurrent(snapshot, { projectRoot })));
}

async function assertOutputBoundaryRootCurrent(boundary, phase) {
  let info;
  let canonical;
  try {
    [info, canonical] = await Promise.all([
      lstat(boundary.root),
      realpath(boundary.root),
    ]);
  } catch (error) {
    throw serviceError('unsafe_output_path', `Output boundary root became unavailable during ${phase}.`, {
      stage: 'schema',
      jsonPointer: '/out_dir',
      cause: error,
    });
  }
  if (!info.isDirectory()
    || info.isSymbolicLink()
    || canonical !== boundary.root
    || info.dev !== boundary.root_dev
    || info.ino !== boundary.root_ino) {
    throw serviceError('unsafe_output_path', `Output boundary root changed during ${phase}.`, {
      stage: 'schema',
      jsonPointer: '/out_dir',
    });
  }
}

async function prepareSafeOutputDirectory(boundary) {
  await assertOutputBoundaryRootCurrent(boundary, 'output preparation');
  let current = boundary.root;
  const traversed = [];
  for (const segment of boundary.locator.split('/')) {
    traversed.push(segment);
    current = resolve(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError?.code !== 'EEXIST') throw mkdirError;
      }
      info = await lstat(current);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw serviceError('unsafe_output_path', 'Every output directory component must be a real directory.', {
        stage: 'schema',
        jsonPointer: '/out_dir',
      });
    }
    const canonical = await realpath(current);
    const rel = strictDescendantLocator(boundary.root, canonical);
    if (canonical !== current || rel !== traversed.join('/')) {
      throw serviceError('unsafe_output_path', 'Output directory path must not traverse a symbolic-link ancestor or escape its trusted boundary.', {
        stage: 'schema',
        jsonPointer: '/out_dir',
      });
    }
    await assertOutputBoundaryRootCurrent(boundary, 'output preparation');
  }
  return current;
}

async function assertNoUnexpectedOutputEntries(directory) {
  const allowedFinals = new Set(Object.values(OUTPUT_FILENAMES));
  const journal = INSPECTION_PLAN_PUBLICATION_FILES.journal;
  const lock = INSPECTION_PLAN_PUBLICATION_FILES.lock;
  const names = await readdir(directory);
  const allowed = new Set(allowedFinals);
  const hasJournal = names.includes(journal);
  if (hasJournal) {
    const journalPath = resolve(directory, journal);
    let handle;
    let document;
    try {
      handle = await open(journalPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size > 1024 * 1024) {
        throw new Error('journal is not a bounded single-link regular file');
      }
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
        throw new Error('journal changed while being read');
      }
      strictUtf8(bytes, 'atomic publication journal');
      document = parseInspectionEvidenceJsonBytes(bytes, { requireCanonical: false });
    } catch (error) {
      throw serviceError('unsafe_publication_journal', 'Existing atomic publication journal is not safe for recovery.', {
        stage: 'schema',
        jsonPointer: '/out_dir',
        cause: error,
      });
    } finally {
      await handle?.close();
    }
    if (!document
      || document.schema_version !== '1.0'
      || !/^[A-Za-z0-9.-]{1,200}$/.test(document.token || '')
      || !['prepared', 'committing', 'committed'].includes(document.phase)
      || !Array.isArray(document.entries)
      || document.entries.length !== allowedFinals.size) {
      throw serviceError('unsafe_publication_journal', 'Existing atomic publication journal does not bind the exact eight-file output set.', {
        stage: 'schema',
        jsonPointer: '/out_dir',
      });
    }
    const targetNames = new Set();
    for (const entry of document.entries) {
      const targetName = typeof entry?.target === 'string' ? basename(entry.target) : '';
      const expectedTemp = resolve(directory, `.${targetName}.${document.token}.tmp`);
      const expectedBackup = resolve(directory, `.${targetName}.${document.token}.bak`);
      if (!allowedFinals.has(targetName)
        || targetNames.has(targetName)
        || dirname(entry.target) !== directory
        || entry.temp !== expectedTemp
        || entry.backup !== expectedBackup) {
        throw serviceError('unsafe_publication_journal', 'Existing atomic publication journal contains an unexpected or colliding output binding.', {
          stage: 'schema',
          jsonPointer: '/out_dir',
        });
      }
      targetNames.add(targetName);
      allowed.add(basename(entry.temp));
      allowed.add(basename(entry.backup));
    }
    allowed.add(journal);
    allowed.add(lock);
    allowed.add(`.${journal}.${document.token}.tmp`);
    allowed.add(`.${lock}.${document.token}.owner`);
  } else {
    allowed.add(lock);
    const wrappedToken = (name, prefix, suffix) => {
      if (!name.startsWith(prefix) || !name.endsWith(suffix)) return false;
      return PUBLICATION_TOKEN_PATTERN.test(name.slice(prefix.length, name.length - suffix.length));
    };
    for (const name of names) {
      if (wrappedToken(name, `.${lock}.`, '.owner')
        || wrappedToken(name, `.${journal}.`, '.tmp')
        || [...allowedFinals].some((target) => wrappedToken(name, `.${target}.`, '.tmp'))) {
        allowed.add(name);
      }
    }
  }
  const unexpected = names.filter((name) => !allowed.has(name));
  if (unexpected.length > 0) {
    throw serviceError('unexpected_output_entry', 'Output directory contains files outside the fixed manufacturing action output set.', {
      stage: 'schema',
      jsonPointer: '/out_dir',
      details: { unexpected_entry_count: unexpected.length },
      remediation: 'Select a dedicated empty output directory or remove unrelated entries outside this command.',
    });
  }
}

async function assertExactPublishedOutputSet(directory) {
  const expected = Object.values(OUTPUT_FILENAMES).sort();
  const actual = (await readdir(directory)).sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw serviceError('published_output_set_mismatch', 'Published directory does not contain exactly the fixed eight-file output set.', {
      stage: 'semantic',
      jsonPointer: '/outputs',
    });
  }
}

async function prepareInternal(options = {}) {
  const {
    projectRoot,
    configPath,
    reviewPackPath,
    inspectionPlanPath,
    robotConfigPath,
    taskPlanPath,
    generatedAt,
    proofLineage,
    outDir,
    trustedOutputRoots = [],
    expectedSourceBindings = null,
  } = options;
  if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
    throw serviceError('missing_project_root', 'projectRoot is required.', { stage: 'schema' });
  }
  assertProofActivation(proofLineage);
  assertGeneratedAt(generatedAt);
  const requestedRoot = resolve(projectRoot);
  const root = await realpath(requestedRoot);
  if (root !== requestedRoot) {
    throw serviceError('unsafe_project_root', 'projectRoot must not resolve through a symbolic link.', {
      stage: 'schema',
    });
  }
  const outputBoundary = await resolveOutputBoundary({
    projectRoot: root,
    outDir,
    trustedOutputRoots,
  });
  const repoContext = collectRepoContext(root);
  const inputs = await readAndReconcileInputs({
    projectRoot: root,
    configPath,
    reviewPackPath,
    inspectionPlanPath,
    robotConfigPath,
    taskPlanPath,
    expectedSourceBindings,
  });
  const outputDirectory = outputBoundary.output_directory;
  for (const snapshot of inputs.snapshots) {
    const inputAbsolute = resolve(root, snapshot.path);
    const rel = relative(outputDirectory, inputAbsolute).replaceAll('\\', '/');
    if (rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel))) {
      throw serviceError('output_input_overlap', 'Output directory must not contain any trusted source input.', {
        stage: 'schema',
        jsonPointer: '/out_dir',
      });
    }
  }

  const domain = buildDomainArtifacts({ inputs, generatedAt });
  const manifests = await buildExecutionManifests({
    projectRoot: root,
    outputDirectory,
    inputs,
    generatedAt,
    domain,
    repoContext,
  });
  const payloads = new Map([...domain.payloads, ...manifests.payloads]);
  assertExactPayloadSet(payloads);
  await assertAllSnapshotsCurrent(inputs, root);
  return {
    root,
    outputDirectory,
    outputBoundary,
    inputs,
    documents: { ...domain.documents, ...manifests.documents },
    payloads,
    bundle_sha256: bundleDigest(payloads),
  };
}

export async function prepareManufacturingActionDataset(options = {}) {
  const prepared = await prepareInternal(options);
  return Object.freeze({
    status: 'valid_synthetic_demo',
    artifact_id: prepared.documents.dataset_manifest.artifact_id,
    output_dir: prepared.outputDirectory,
    outputs: Object.freeze(Object.fromEntries(
      Object.entries(OUTPUT_FILENAMES).map(([key, filename]) => [key, resolve(prepared.outputDirectory, filename)])
    )),
    documents: clone(prepared.documents),
    payloads: Object.freeze(Object.fromEntries(
      [...prepared.payloads].map(([name, bytes]) => [name, Buffer.from(bytes)])
    )),
    bundle_sha256: prepared.bundle_sha256,
    revision_lineage: clone(prepared.inputs.revisionLineage),
    source_snapshots: Object.freeze(
      prepared.inputs.sourceSnapshots.map((entry) => Object.freeze({ ...entry }))
    ),
    boundaries: Object.freeze(fixedBoundaries()),
  });
}

export async function generateManufacturingActionDataset(options = {}) {
  const prepared = await prepareInternal(options);
  let safelyPreparedDirectory;
  try {
    safelyPreparedDirectory = await prepareSafeOutputDirectory(prepared.outputBoundary);
  } catch (error) {
    if (error instanceof ManufacturingActionDatasetError) throw error;
    throw serviceError('output_directory_preflight_failed', 'Output directory could not be prepared safely.', {
      stage: 'schema',
      jsonPointer: '/out_dir',
      cause: error,
    });
  }
  const canonicalDirectory = await realpath(safelyPreparedDirectory);
  if (canonicalDirectory !== prepared.outputDirectory) {
    throw serviceError('unsafe_output_path', 'Output directory must be a real non-symlink directory.', {
      stage: 'schema',
      jsonPointer: '/out_dir',
    });
  }
  await assertNoUnexpectedOutputEntries(canonicalDirectory);
  if (bundleDigest(prepared.payloads) !== prepared.bundle_sha256) {
    throw serviceError('prepared_bundle_changed', 'Prepared output bytes changed before publication.', {
      stage: 'semantic',
    });
  }
  await assertAllSnapshotsCurrent(prepared.inputs, prepared.root);

  const userHooks = options.publicationHooks && typeof options.publicationHooks === 'object'
    ? options.publicationHooks
    : {};
  try {
    await publishAtomicOutputSet({
      directory: canonicalDirectory,
      outputs: [...prepared.payloads].map(([filename, content]) => ({
        path: resolve(canonicalDirectory, filename),
        content,
      })),
      hooks: {
        beforeCommit: async (context) => {
          await userHooks.beforeCommit?.(context);
          await assertAllSnapshotsCurrent(prepared.inputs, prepared.root);
        },
        afterCommit: async (context) => {
          await userHooks.afterCommit?.(context);
          await assertAllSnapshotsCurrent(prepared.inputs, prepared.root);
        },
      },
    });
  } catch (error) {
    if (error instanceof ManufacturingActionDatasetError) throw error;
    if (error?.code === 'stale_parent') {
      throw serviceError('stale_parent', 'A trusted source snapshot changed before atomic publication completed.', {
        stage: 'lineage',
        jsonPointer: '/source_snapshots',
        cause: error,
      });
    }
    throw serviceError('atomic_publication_failed', 'The fixed output set could not be published atomically; no partial dataset was retained.', {
      stage: 'semantic',
      jsonPointer: '/outputs',
      remediation: 'Inspect the dedicated output directory for unsafe targets or concurrent publication, then retry.',
      cause: error,
    });
  }
  await assertExactPublishedOutputSet(canonicalDirectory);

  return Object.freeze({
    status: 'valid_synthetic_demo',
    artifact_id: prepared.documents.dataset_manifest.artifact_id,
    output_dir: canonicalDirectory,
    outputs: Object.freeze(Object.fromEntries(
      Object.entries(OUTPUT_FILENAMES).map(([key, filename]) => [key, resolve(canonicalDirectory, filename)])
    )),
    bundle_sha256: prepared.bundle_sha256,
    revision_lineage: clone(prepared.inputs.revisionLineage),
    source_snapshots: Object.freeze(
      prepared.inputs.sourceSnapshots.map((entry) => Object.freeze({ ...entry }))
    ),
    validation_report: clone(prepared.documents.validation_report),
    boundaries: Object.freeze(fixedBoundaries()),
  });
}

export const MANUFACTURING_ACTION_DATASET_OUTPUT_FILENAMES = OUTPUT_FILENAMES;
