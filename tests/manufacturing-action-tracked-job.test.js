import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { toJobResponse } from '../src/server/local-api-job-response.js';
import { createJobExecutor } from '../src/services/jobs/job-executor.js';
import { createJobStore } from '../src/services/jobs/job-store.js';

const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = 'hinge-block-synthetic-inspection-v1';
const MISMATCH_CODE = 'REVISION_LINEAGE_IDENTITY_MISMATCH';
const EXPECTED_FILES = [
  'artifact-manifest.json',
  'design_manufacturing_quality_handoff.json',
  'design_manufacturing_quality_handoff.md',
  'manufacturing_action_dictionary.json',
  'manufacturing_data_validation_report.json',
  'manufacturing_episode_annotation.json',
  'manufacturing_robotics_dataset_manifest.json',
  'output-manifest.json',
].sort();
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function assertSuccessJob(jobStore, executor) {
  const queued = await jobStore.createJob({
    type: 'manufacturing-action-dataset',
    demo_profile: PROFILE,
  });
  await executor.execute(queued.id);
  const completed = await jobStore.getJob(queued.id);
  assert.equal(completed.status, 'succeeded', completed.error?.message);
  assert.deepEqual(completed.request, {
    type: 'manufacturing-action-dataset',
    demo_profile: PROFILE,
  });
  assert.equal(completed.result.status, 'valid_synthetic_demo');
  assert.equal(completed.result.demo_profile, PROFILE);
  assert.equal(completed.result.trust_demo, null);
  assert.deepEqual(completed.result.proof_lineage_policy, { required: true, mode: 'proof' });
  assert.equal(completed.result.identity.package_slug, 'hinge-block');
  assert.equal(completed.result.identity.part_id, 'hinge_block');
  assert.equal(completed.result.identity.revision, 'A');
  assert.equal(SHA256_PATTERN.test(completed.result.identity.config_sha256), true);
  assert.equal(completed.result.source_inputs.length, 5);
  assert.equal(completed.result.source_inputs.every((source) => SHA256_PATTERN.test(source.sha256)), true);
  assert.equal(completed.result.source_inputs.every((source) => !source.path.startsWith('/')), true);
  assert.equal(completed.result.boundaries.synthetic_demo, true);
  assert.equal(completed.result.boundaries.real_shop_floor_data, false);
  assert.equal(completed.result.boundaries.computer_vision_model_used, false);
  assert.equal(completed.result.boundaries.lerobot_compatible, false);
  assert.equal(completed.result.boundaries.training_ready, false);
  assert.equal(completed.result.boundaries.human_review_required, true);
  assert.deepEqual(
    {
      expected_count: completed.result.publication.expected_count,
      published_count: completed.result.publication.published_count,
      exact: completed.result.publication.exact,
    },
    { expected_count: 8, published_count: 8, exact: true }
  );
  assert.equal(SHA256_PATTERN.test(completed.result.publication.bundle_sha256), true);
  assert.equal(completed.result.validation.metrics.action_count, 10);
  assert.equal(completed.result.validation.metrics.lineage_status, 'valid');
  assert.equal(completed.result.validation.metrics.boundary_status, 'valid');
  assert.equal(completed.diagnostics.manufacturing_action_demo.publication.published_count, 8);
  assert.deepEqual(completed.diagnostics.proof_lineage_policy, {
    required: true,
    mode: 'proof',
    authoritative_config_path: 'configs/examples/hinge_block.toml',
    config_sha256: completed.result.identity.config_sha256,
    config_size_bytes: 7116,
  });

  const outputDir = join(jobStore.getJobDir(queued.id), 'artifacts');
  assert.deepEqual((await readdir(outputDir)).sort(), EXPECTED_FILES);
  assert.deepEqual(Object.keys(completed.artifacts).sort(), [
    'action_dictionary',
    'artifact_manifest',
    'dataset_manifest',
    'episode_annotation',
    'handoff_json',
    'handoff_markdown',
    'output_manifest',
    'validation_report',
  ]);

  const registered = await jobStore.listArtifacts(queued.id);
  assert.equal(registered.length, 8);
  assert.equal(registered.every((artifact) => artifact.scope === 'user-facing'), true);
  assert.equal(registered.every((artifact) => artifact.stability === 'stable'), true);
  assert.equal(registered.every((artifact) => artifact.exists), true);
  assert.deepEqual(registered.map((artifact) => artifact.file_name).sort(), EXPECTED_FILES);
  for (const artifact of registered) {
    const bytes = await readFile(artifact.path);
    assert.equal(artifact.size_bytes, bytes.length);
    assert.equal(artifact.sha256, sha256(bytes));
  }

  assert.equal(completed.manifest.status, 'succeeded');
  assert.equal(completed.manifest.effective_policy.proof_lineage, true);
  assert.equal(completed.manifest.artifacts.length, 8);
  assert.equal(completed.manifest.details.request.demo_profile, PROFILE);
  assert.equal(JSON.stringify(completed.manifest).includes(jobStore.jobsDir), false);

  const publicJob = await toJobResponse(jobStore, completed);
  assert.deepEqual(publicJob.request, {
    type: 'manufacturing-action-dataset',
    demo_profile: PROFILE,
  });
  assert.equal(publicJob.result.publication.published_count, 8);
  assert.equal(JSON.stringify(publicJob).includes(jobStore.jobsDir), false);
  return { completed, outputDir };
}

const externalRoot = await mkdtemp(join(tmpdir(), 'fcad-manufacturing-action-jobs-'));
try {
  const jobStore = createJobStore({ jobsDir: join(externalRoot, 'jobs') });
  const executor = createJobExecutor({ projectRoot: ROOT, jobStore });
  const first = await assertSuccessJob(jobStore, executor);
  const second = await assertSuccessJob(jobStore, executor);
  for (const filename of EXPECTED_FILES) {
    assert.deepEqual(
      await readFile(join(first.outputDir, filename)),
      await readFile(join(second.outputDir, filename)),
      `${filename} must remain byte-identical across fixed-profile tracked runs`
    );
  }

  const mismatch = await jobStore.createJob({
    type: 'manufacturing-action-dataset',
    demo_profile: PROFILE,
    trust_demo: 'revision-mismatch',
  });
  await executor.execute(mismatch.id);
  const failed = await jobStore.getJob(mismatch.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.message, 'The selected proof review revision does not match the authoritative demo profile.');
  assert.equal(failed.result.status, 'blocked');
  assert.equal(failed.result.code, MISMATCH_CODE);
  assert.equal(failed.result.reason_code, MISMATCH_CODE);
  assert.equal(failed.result.expected.revision, 'A');
  assert.equal(failed.result.received.revision, 'B');
  assert.deepEqual(failed.result.published, { expected_count: 8, published_count: 0 });
  assert.equal(failed.result.next_action.code, 'REGENERATE_REVIEW_FROM_AUTHORITATIVE_REVISION_A');
  assert.deepEqual(failed.diagnostics.manufacturing_action_demo, failed.result);
  assert.deepEqual(failed.artifacts, {});
  assert.equal(failed.manifest.status, 'failed');
  assert.equal(failed.manifest.artifacts.length, 0);
  assert.equal((await jobStore.listArtifacts(mismatch.id)).length, 0);
  await assert.rejects(() => stat(join(jobStore.getJobDir(mismatch.id), 'artifacts')), /ENOENT/);

  const publicFailure = await toJobResponse(jobStore, failed);
  assert.equal(publicFailure.result.reason_code, MISMATCH_CODE);
  assert.equal(publicFailure.diagnostics.manufacturing_action_demo.published.published_count, 0);
  assert.equal(JSON.stringify(publicFailure).includes(externalRoot), false);
} finally {
  await rm(externalRoot, { recursive: true, force: true });
}

console.log('manufacturing-action-tracked-job.test.js: ok');
