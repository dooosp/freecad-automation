import {
  MANUFACTURING_ACTION_BOUNDARIES,
} from '../../../lib/manufacturing-action-contracts.js';
import {
  readAuthoritativeConfigSnapshot,
  readRevisionLineageFileSnapshot,
} from '../../../lib/revision-lineage-contract.js';

export const MANUFACTURING_ACTION_DEMO_PROFILE_ID = 'hinge-block-synthetic-inspection-v1';
export const MANUFACTURING_ACTION_DEMO_REVISION_MISMATCH = 'revision-mismatch';
export const MANUFACTURING_ACTION_DEMO_GENERATED_AT = '2026-07-28T00:00:00.000Z';
export const MANUFACTURING_ACTION_DEMO_EXPECTED_OUTPUT_COUNT = 8;

export const MANUFACTURING_ACTION_DEMO_ERROR_CODES = Object.freeze({
  PROFILE_NOT_SUPPORTED: 'MANUFACTURING_ACTION_DEMO_PROFILE_NOT_SUPPORTED',
  TRUST_DEMO_NOT_SUPPORTED: 'MANUFACTURING_ACTION_TRUST_DEMO_NOT_SUPPORTED',
  PROFILE_SOURCE_UNAVAILABLE: 'MANUFACTURING_ACTION_DEMO_PROFILE_SOURCE_UNAVAILABLE',
  PROFILE_SOURCE_MISMATCH: 'MANUFACTURING_ACTION_DEMO_PROFILE_SOURCE_MISMATCH',
  REVISION_LINEAGE_IDENTITY_MISMATCH: 'REVISION_LINEAGE_IDENTITY_MISMATCH',
});

const EXPECTED_IDENTITY = Object.freeze({
  package_slug: 'hinge-block',
  part_id: 'hinge_block',
  revision: 'A',
  config_sha256: '992cf687e1da65f9ac89c12bd36ad7cd2b57367deb0cc6d50a74d4c03b7a52d1',
});

const RECEIVED_MISMATCH_IDENTITY = Object.freeze({
  ...EXPECTED_IDENTITY,
  revision: 'B',
});

const FIXTURE_ROOT = 'configs/examples/manufacturing/hinge_block_synthetic_inspection_v1';

const PROFILE_SOURCES = Object.freeze({
  authoritative_config: Object.freeze({
    role: 'authoritative_config',
    artifact_type: 'config',
    path: 'configs/examples/hinge_block.toml',
    sha256: EXPECTED_IDENTITY.config_sha256,
    size_bytes: 7116,
  }),
  review_pack: Object.freeze({
    role: 'review_pack',
    artifact_type: 'review_pack',
    path: `${FIXTURE_ROOT}/review_pack.json`,
    sha256: 'edc47d89e71b4cd02a8d7e4f610e767bc835d1d5a2c5c963980b9a6af5d1383c',
    size_bytes: 785,
  }),
  revision_mismatch_review_pack: Object.freeze({
    role: 'review_pack',
    artifact_type: 'review_pack',
    path: `${FIXTURE_ROOT}/review_pack_revision_b.json`,
    sha256: 'cf7b52374539a53f8a54505ad9e243fb34dfc6ef8db23613c20c3064c2f44667',
    size_bytes: 785,
  }),
  inspection_plan: Object.freeze({
    role: 'inspection_plan',
    artifact_type: 'inspection_plan',
    path: `${FIXTURE_ROOT}/inspection_plan.json`,
    sha256: '01d1514141313e7cad0b00efd66ef403c3f3d09dfb26f30dcd852200aed8264e',
    size_bytes: 2523,
  }),
  robot_config: Object.freeze({
    role: 'robot_config',
    artifact_type: 'robot_config',
    path: 'configs/examples/robot_arm_6axis.toml',
    sha256: 'afa6ab4970687c062b569618c81f8661d6865cfc1324764b25dc40f3168d4368',
    size_bytes: 5159,
  }),
  manufacturing_task_plan: Object.freeze({
    role: 'manufacturing_task_plan',
    artifact_type: 'manufacturing_task_plan',
    path: 'configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json',
    sha256: 'fceb305e28f9ad6dee3dc8b460055b7dd454149e9fb38991a41feddea81f3589',
    size_bytes: 21702,
  }),
});

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function clone(value) {
  return structuredClone(value);
}

export class ManufacturingActionDemoProfileError extends Error {
  constructor(code, message, {
    stage = 'profile',
    details = {},
    cause = undefined,
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ManufacturingActionDemoProfileError';
    this.code = code;
    this.reason_code = code;
    this.stage = stage;
    this.details = deepFreeze(clone(details));
  }
}

function profileError(code, message, options = {}) {
  return new ManufacturingActionDemoProfileError(code, message, options);
}

function selectedSources(trustDemo) {
  return [
    PROFILE_SOURCES.authoritative_config,
    trustDemo === MANUFACTURING_ACTION_DEMO_REVISION_MISMATCH
      ? PROFILE_SOURCES.revision_mismatch_review_pack
      : PROFILE_SOURCES.review_pack,
    PROFILE_SOURCES.inspection_plan,
    PROFILE_SOURCES.robot_config,
    PROFILE_SOURCES.manufacturing_task_plan,
  ];
}

function assertRequestSelection(demoProfile, trustDemo) {
  if (demoProfile !== MANUFACTURING_ACTION_DEMO_PROFILE_ID) {
    throw profileError(
      MANUFACTURING_ACTION_DEMO_ERROR_CODES.PROFILE_NOT_SUPPORTED,
      'The requested manufacturing action demo profile is not supported.'
    );
  }
  if (trustDemo !== null
    && trustDemo !== undefined
    && trustDemo !== MANUFACTURING_ACTION_DEMO_REVISION_MISMATCH) {
    throw profileError(
      MANUFACTURING_ACTION_DEMO_ERROR_CODES.TRUST_DEMO_NOT_SUPPORTED,
      'The requested manufacturing action trust demonstration is not supported.'
    );
  }
}

async function readSourceSnapshot(projectRoot, source) {
  try {
    if (source.role === 'authoritative_config') {
      return await readAuthoritativeConfigSnapshot({
        projectRoot,
        configPath: source.path,
      });
    }
    return await readRevisionLineageFileSnapshot({
      projectRoot,
      path: source.path,
    });
  } catch (error) {
    throw profileError(
      MANUFACTURING_ACTION_DEMO_ERROR_CODES.PROFILE_SOURCE_UNAVAILABLE,
      `The approved ${source.role} source is unavailable or unsafe.`,
      {
        details: { role: source.role },
        cause: error,
      }
    );
  }
}

function assertSourceBinding(source, snapshot) {
  if (snapshot.path !== source.path
    || snapshot.sha256 !== source.sha256
    || snapshot.size_bytes !== source.size_bytes) {
    throw profileError(
      MANUFACTURING_ACTION_DEMO_ERROR_CODES.PROFILE_SOURCE_MISMATCH,
      `The approved ${source.role} source no longer matches the pinned demo profile.`,
      {
        details: {
          role: source.role,
          expected_sha256: source.sha256,
          actual_sha256: snapshot.sha256,
          expected_size_bytes: source.size_bytes,
          actual_size_bytes: snapshot.size_bytes,
        },
      }
    );
  }
}

function serviceInputPaths(sources) {
  const byRole = new Map(sources.map((entry) => [entry.role, entry]));
  return {
    configPath: byRole.get('authoritative_config').path,
    reviewPackPath: byRole.get('review_pack').path,
    inspectionPlanPath: byRole.get('inspection_plan').path,
    robotConfigPath: byRole.get('robot_config').path,
    taskPlanPath: byRole.get('manufacturing_task_plan').path,
  };
}

export async function resolveManufacturingActionDemoProfile({
  projectRoot,
  demoProfile,
  trustDemo = null,
} = {}) {
  if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
    throw profileError(
      MANUFACTURING_ACTION_DEMO_ERROR_CODES.PROFILE_SOURCE_UNAVAILABLE,
      'A project root is required to resolve the manufacturing action demo profile.'
    );
  }
  assertRequestSelection(demoProfile, trustDemo);
  const normalizedTrustDemo = trustDemo || null;
  const sources = selectedSources(normalizedTrustDemo);
  const snapshots = await Promise.all(
    sources.map((source) => readSourceSnapshot(projectRoot, source))
  );
  sources.forEach((source, index) => assertSourceBinding(source, snapshots[index]));
  const configIdentity = snapshots[0].identity;
  if (Object.keys(EXPECTED_IDENTITY).some(
    (key) => configIdentity?.[key] !== EXPECTED_IDENTITY[key]
  )) {
    throw profileError(
      MANUFACTURING_ACTION_DEMO_ERROR_CODES.PROFILE_SOURCE_MISMATCH,
      'The authoritative config identity no longer matches the pinned demo profile.',
      { details: { role: 'authoritative_config' } }
    );
  }

  return deepFreeze({
    demo_profile: MANUFACTURING_ACTION_DEMO_PROFILE_ID,
    trust_demo: normalizedTrustDemo,
    generated_at: MANUFACTURING_ACTION_DEMO_GENERATED_AT,
    identity: clone(EXPECTED_IDENTITY),
    expected_identity: clone(EXPECTED_IDENTITY),
    received_identity: normalizedTrustDemo === MANUFACTURING_ACTION_DEMO_REVISION_MISMATCH
      ? clone(RECEIVED_MISMATCH_IDENTITY)
      : null,
    proof_lineage: true,
    input_paths: serviceInputPaths(sources),
    input_sources: sources.map((source) => ({ ...source })),
    boundaries: clone(MANUFACTURING_ACTION_BOUNDARIES),
  });
}

export function mapManufacturingActionDemoFailure(error, resolution) {
  const isExpectedMismatch = resolution?.demo_profile === MANUFACTURING_ACTION_DEMO_PROFILE_ID
    && resolution?.trust_demo === MANUFACTURING_ACTION_DEMO_REVISION_MISMATCH
    && error?.code === 'conflicting_identity'
    && error?.stage === 'lineage';
  if (!isExpectedMismatch) return error;

  const contract = {
    status: 'blocked',
    code: MANUFACTURING_ACTION_DEMO_ERROR_CODES.REVISION_LINEAGE_IDENTITY_MISMATCH,
    reason_code: MANUFACTURING_ACTION_DEMO_ERROR_CODES.REVISION_LINEAGE_IDENTITY_MISMATCH,
    expected: clone(EXPECTED_IDENTITY),
    received: clone(RECEIVED_MISMATCH_IDENTITY),
    published: {
      expected_count: MANUFACTURING_ACTION_DEMO_EXPECTED_OUTPUT_COUNT,
      published_count: 0,
    },
    next_action: {
      code: 'REGENERATE_REVIEW_FROM_AUTHORITATIVE_REVISION_A',
      message: 'Regenerate the review artifact from the authoritative Revision A config.',
    },
  };
  const mapped = profileError(
    contract.code,
    'The selected proof review revision does not match the authoritative demo profile.',
    {
      stage: 'lineage',
      details: contract,
      cause: error,
    }
  );
  Object.assign(mapped, deepFreeze(clone(contract)));
  return mapped;
}

export function getManufacturingActionDemoProfileCatalog() {
  return [deepFreeze({
    demo_profile: MANUFACTURING_ACTION_DEMO_PROFILE_ID,
    trust_demos: [MANUFACTURING_ACTION_DEMO_REVISION_MISMATCH],
    generated_at: MANUFACTURING_ACTION_DEMO_GENERATED_AT,
    expected_identity: clone(EXPECTED_IDENTITY),
    expected_output_count: MANUFACTURING_ACTION_DEMO_EXPECTED_OUTPUT_COUNT,
    boundaries: clone(MANUFACTURING_ACTION_BOUNDARIES),
  })];
}
