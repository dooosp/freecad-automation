import assert from 'node:assert/strict';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  MANUFACTURING_ACTION_DATASET_OUTPUT_FILENAMES,
  generateManufacturingActionDataset,
} from '../src/services/manufacturing-action-dataset/manufacturing-action-dataset-service.js';
import {
  MANUFACTURING_ACTION_DEMO_ERROR_CODES,
  MANUFACTURING_ACTION_DEMO_EXPECTED_OUTPUT_COUNT,
  MANUFACTURING_ACTION_DEMO_PROFILE_ID,
  MANUFACTURING_ACTION_DEMO_REVISION_MISMATCH,
  mapManufacturingActionDemoFailure,
  resolveManufacturingActionDemoProfile,
} from '../src/services/manufacturing-action-dataset/manufacturing-action-demo-profile.js';

const ROOT = resolve(import.meta.dirname, '..');
const EXPECTED_SOURCE_HASHES = Object.freeze({
  authoritative_config: '992cf687e1da65f9ac89c12bd36ad7cd2b57367deb0cc6d50a74d4c03b7a52d1',
  review_pack: 'edc47d89e71b4cd02a8d7e4f610e767bc835d1d5a2c5c963980b9a6af5d1383c',
  inspection_plan: '01d1514141313e7cad0b00efd66ef403c3f3d09dfb26f30dcd852200aed8264e',
  robot_config: 'afa6ab4970687c062b569618c81f8661d6865cfc1324764b25dc40f3168d4368',
  manufacturing_task_plan: 'fceb305e28f9ad6dee3dc8b460055b7dd454149e9fb38991a41feddea81f3589',
});

function serviceOptions(resolution, outDir, trustedOutputRoots = []) {
  return {
    projectRoot: ROOT,
    ...resolution.input_paths,
    generatedAt: resolution.generated_at,
    proofLineage: resolution.proof_lineage,
    outDir,
    trustedOutputRoots,
    expectedSourceBindings: resolution.input_sources,
  };
}

async function pathExists(pathValue) {
  try {
    await access(pathValue);
    return true;
  } catch {
    return false;
  }
}

test('server-owned profile resolves only pinned success and revision-mismatch inputs', async () => {
  const success = await resolveManufacturingActionDemoProfile({
    projectRoot: ROOT,
    demoProfile: MANUFACTURING_ACTION_DEMO_PROFILE_ID,
  });
  assert.equal(success.demo_profile, MANUFACTURING_ACTION_DEMO_PROFILE_ID);
  assert.equal(success.trust_demo, null);
  assert.equal(success.proof_lineage, true);
  assert.equal(success.identity.revision, 'A');
  assert.equal(success.received_identity, null);
  assert.deepEqual(
    Object.fromEntries(success.input_sources.map((entry) => [entry.role, entry.sha256])),
    EXPECTED_SOURCE_HASHES
  );
  assert.deepEqual(success.input_paths, {
    configPath: 'configs/examples/hinge_block.toml',
    reviewPackPath: 'configs/examples/manufacturing/hinge_block_synthetic_inspection_v1/review_pack.json',
    inspectionPlanPath: 'configs/examples/manufacturing/hinge_block_synthetic_inspection_v1/inspection_plan.json',
    robotConfigPath: 'configs/examples/robot_arm_6axis.toml',
    taskPlanPath: 'configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json',
  });
  assert.equal(success.boundaries.synthetic_demo, true);
  assert.equal(success.boundaries.lerobot_compatible, false);
  assert.equal(success.boundaries.training_ready, false);

  const mismatch = await resolveManufacturingActionDemoProfile({
    projectRoot: ROOT,
    demoProfile: MANUFACTURING_ACTION_DEMO_PROFILE_ID,
    trustDemo: MANUFACTURING_ACTION_DEMO_REVISION_MISMATCH,
  });
  assert.equal(mismatch.trust_demo, MANUFACTURING_ACTION_DEMO_REVISION_MISMATCH);
  assert.equal(mismatch.expected_identity.revision, 'A');
  assert.equal(mismatch.received_identity.revision, 'B');
  assert.equal(
    mismatch.input_sources.find((entry) => entry.role === 'review_pack').sha256,
    'cf7b52374539a53f8a54505ad9e243fb34dfc6ef8db23613c20c3064c2f44667'
  );
  assert.match(mismatch.input_paths.reviewPackPath, /review_pack_revision_b\.json$/);

  await assert.rejects(
    () => resolveManufacturingActionDemoProfile({
      projectRoot: ROOT,
      demoProfile: '../hinge-block-synthetic-inspection-v1',
    }),
    (error) => error?.code === MANUFACTURING_ACTION_DEMO_ERROR_CODES.PROFILE_NOT_SUPPORTED
  );
  await assert.rejects(
    () => resolveManufacturingActionDemoProfile({
      projectRoot: ROOT,
      demoProfile: MANUFACTURING_ACTION_DEMO_PROFILE_ID,
      trustDemo: 'revision-A-to-C',
    }),
    (error) => error?.code === MANUFACTURING_ACTION_DEMO_ERROR_CODES.TRUST_DEMO_NOT_SUPPORTED
  );
});

test('profile source bindings reject byte drift in an isolated repository-shaped root', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'fcad-manufacturing-profile-sources-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const success = await resolveManufacturingActionDemoProfile({
    projectRoot: ROOT,
    demoProfile: MANUFACTURING_ACTION_DEMO_PROFILE_ID,
  });

  for (const source of success.input_sources) {
    const target = resolve(tempRoot, source.path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(ROOT, source.path), target);
  }
  const baseline = await resolveManufacturingActionDemoProfile({
    projectRoot: tempRoot,
    demoProfile: MANUFACTURING_ACTION_DEMO_PROFILE_ID,
  });
  assert.deepEqual(
    baseline.input_sources.map((entry) => entry.sha256),
    success.input_sources.map((entry) => entry.sha256)
  );

  for (const source of success.input_sources) {
    const target = resolve(tempRoot, source.path);
    const original = await readFile(target);
    await writeFile(target, Buffer.concat([original, Buffer.from(' ')]));
    await assert.rejects(
      () => resolveManufacturingActionDemoProfile({
        projectRoot: tempRoot,
        demoProfile: MANUFACTURING_ACTION_DEMO_PROFILE_ID,
      }),
      (error) => error?.code === MANUFACTURING_ACTION_DEMO_ERROR_CODES.PROFILE_SOURCE_MISMATCH
        && error?.details?.role === source.role
    );
    await writeFile(target, original);
  }
});

test('trusted server output root publishes the exact eight files outside the repository', async (t) => {
  const jobRoot = await mkdtemp(join(tmpdir(), 'fcad-manufacturing-profile-job-'));
  const secondJobRoot = await mkdtemp(join(tmpdir(), 'fcad-manufacturing-profile-job-'));
  t.after(() => rm(jobRoot, { recursive: true, force: true }));
  t.after(() => rm(secondJobRoot, { recursive: true, force: true }));
  const resolution = await resolveManufacturingActionDemoProfile({
    projectRoot: ROOT,
    demoProfile: MANUFACTURING_ACTION_DEMO_PROFILE_ID,
  });
  const outputDirectory = join(jobRoot, 'artifacts');

  await assert.rejects(
    () => generateManufacturingActionDataset(serviceOptions(resolution, outputDirectory)),
    (error) => error?.code === 'unsafe_path'
  );
  await assert.rejects(
    () => generateManufacturingActionDataset(serviceOptions(
      resolution,
      join(dirname(jobRoot), 'outside-job-artifacts'),
      [jobRoot]
    )),
    (error) => error?.code === 'unsafe_output_path'
  );
  const mismatchedBindingOptions = serviceOptions(resolution, outputDirectory, [jobRoot]);
  mismatchedBindingOptions.expectedSourceBindings = resolution.input_sources.map((entry) => (
    entry.role === 'manufacturing_task_plan'
      ? { ...entry, sha256: '0'.repeat(64) }
      : { ...entry }
  ));
  await assert.rejects(
    () => generateManufacturingActionDataset(mismatchedBindingOptions),
    (error) => error?.code === 'profile_source_mismatch'
      && error?.details?.role === 'manufacturing_task_plan'
  );
  const incompleteBindingOptions = serviceOptions(resolution, outputDirectory, [jobRoot]);
  incompleteBindingOptions.expectedSourceBindings = resolution.input_sources.slice(0, 4);
  await assert.rejects(
    () => generateManufacturingActionDataset(incompleteBindingOptions),
    (error) => error?.code === 'profile_source_binding_invalid'
  );
  assert.equal(await pathExists(outputDirectory), false);

  const result = await generateManufacturingActionDataset(serviceOptions(
    resolution,
    outputDirectory,
    [jobRoot]
  ));
  const canonicalJobRoot = await realpath(jobRoot);
  assert.equal(result.output_dir, join(canonicalJobRoot, 'artifacts'));
  assert.deepEqual(
    (await readdir(result.output_dir)).sort(),
    Object.values(MANUFACTURING_ACTION_DATASET_OUTPUT_FILENAMES).sort()
  );
  assert.equal(result.source_snapshots.length, 5);
  assert.equal(result.revision_lineage.identity.revision, 'A');
  assert.match(result.bundle_sha256, /^[a-f0-9]{64}$/);
  for (const filename of Object.values(MANUFACTURING_ACTION_DATASET_OUTPUT_FILENAMES)) {
    const bytes = await readFile(join(result.output_dir, filename));
    assert.equal(bytes.includes(Buffer.from(jobRoot)), false, `${filename} leaked the trusted job root`);
  }

  const second = await generateManufacturingActionDataset(serviceOptions(
    resolution,
    join(secondJobRoot, 'artifacts'),
    [secondJobRoot]
  ));
  for (const filename of Object.values(MANUFACTURING_ACTION_DATASET_OUTPUT_FILENAMES)) {
    assert.deepEqual(
      await readFile(join(second.output_dir, filename)),
      await readFile(join(result.output_dir, filename)),
      `${filename} changed between fixed-profile job roots`
    );
  }
});

test('trusted server output root rejects a symlinked child', async (t) => {
  const jobRoot = await mkdtemp(join(tmpdir(), 'fcad-manufacturing-profile-symlink-'));
  const outside = await mkdtemp(join(tmpdir(), 'fcad-manufacturing-profile-outside-'));
  t.after(() => rm(jobRoot, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(jobRoot, 'alias'));
  const resolution = await resolveManufacturingActionDemoProfile({
    projectRoot: ROOT,
    demoProfile: MANUFACTURING_ACTION_DEMO_PROFILE_ID,
  });
  await assert.rejects(
    () => generateManufacturingActionDataset(serviceOptions(
      resolution,
      join(jobRoot, 'alias', 'artifacts'),
      [jobRoot]
    )),
    (error) => error?.code === 'unsafe_output_path'
  );
  assert.equal(await pathExists(join(outside, 'artifacts')), false);
});

test('bounded revision mismatch maps to the public contract and publishes zero of eight', async (t) => {
  const jobRoot = await mkdtemp(join(tmpdir(), 'fcad-manufacturing-profile-mismatch-'));
  t.after(() => rm(jobRoot, { recursive: true, force: true }));
  const resolution = await resolveManufacturingActionDemoProfile({
    projectRoot: ROOT,
    demoProfile: MANUFACTURING_ACTION_DEMO_PROFILE_ID,
    trustDemo: MANUFACTURING_ACTION_DEMO_REVISION_MISMATCH,
  });
  const outputDirectory = join(jobRoot, 'artifacts');
  let underlying;
  try {
    await generateManufacturingActionDataset(serviceOptions(
      resolution,
      outputDirectory,
      [jobRoot]
    ));
  } catch (error) {
    underlying = error;
  }
  assert(underlying, 'revision mismatch must fail');
  assert.equal(underlying.code, 'conflicting_identity');
  assert.equal(underlying.stage, 'lineage');
  const mapped = mapManufacturingActionDemoFailure(underlying, resolution);
  assert.equal(mapped.code, 'REVISION_LINEAGE_IDENTITY_MISMATCH');
  assert.equal(mapped.reason_code, mapped.code);
  assert.equal(mapped.status, 'blocked');
  assert.equal(mapped.expected.revision, 'A');
  assert.equal(mapped.received.revision, 'B');
  assert.deepEqual(mapped.published, {
    expected_count: MANUFACTURING_ACTION_DEMO_EXPECTED_OUTPUT_COUNT,
    published_count: 0,
  });
  assert.equal(mapped.next_action.code, 'REGENERATE_REVIEW_FROM_AUTHORITATIVE_REVISION_A');
  const unrelated = Object.assign(new Error('different lineage failure'), {
    code: 'digest_mismatch',
    stage: 'lineage',
  });
  assert.equal(mapManufacturingActionDemoFailure(unrelated, resolution), unrelated);
  assert.equal(await pathExists(outputDirectory), false);
});
