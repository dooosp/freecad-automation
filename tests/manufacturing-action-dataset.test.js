import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  MANUFACTURING_ACTION_BOUNDARIES,
  MANUFACTURING_ACTION_SEQUENCE,
  assertManufacturingActionArtifact,
} from '../lib/manufacturing-action-contracts.js';
import {
  MANUFACTURING_ACTION_DATASET_OUTPUT_FILENAMES,
  generateManufacturingActionDataset,
  prepareManufacturingActionDataset,
} from '../src/services/manufacturing-action-dataset/manufacturing-action-dataset-service.js';
import { createManufacturingActionDatasetFixture } from './helpers/manufacturing-action-dataset-fixture.js';

const ROOT = resolve(import.meta.dirname, '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

async function readOutputSet(directory) {
  return Object.fromEntries(await Promise.all(
    Object.values(MANUFACTURING_ACTION_DATASET_OUTPUT_FILENAMES).map(async (name) => [
      name,
      await readFile(resolve(directory, name)),
    ])
  ));
}

test('service prepares and atomically publishes the exact deterministic synthetic dataset', async (t) => {
  const fixture = await createManufacturingActionDatasetFixture({ projectRoot: ROOT });
  t.after(() => fixture.cleanup());
  const optionsA = fixture.outputOptions('dataset-a');
  const optionsB = fixture.outputOptions('dataset-b');
  const expectedRepoContext = {
    branch: git(['branch', '--show-current']) || null,
    head_sha: git(['rev-parse', 'HEAD']) || null,
    dirty_at_start: Boolean(git(['status', '--porcelain'])),
  };

  const prepared = await prepareManufacturingActionDataset(optionsA);
  assert.equal(prepared.status, 'valid_synthetic_demo');
  assert.deepEqual(prepared.boundaries, MANUFACTURING_ACTION_BOUNDARIES);
  assert.equal(Object.keys(prepared.payloads).length, 8);
  assert.deepEqual(
    Object.keys(prepared.payloads).sort(),
    Object.values(MANUFACTURING_ACTION_DATASET_OUTPUT_FILENAMES).sort()
  );

  const resultA = await generateManufacturingActionDataset(optionsA);
  const resultB = await generateManufacturingActionDataset(optionsB);
  assert.equal(resultA.status, 'valid_synthetic_demo');
  assert.equal(resultA.validation_report.metrics.unknown_reference_count, 0);
  assert.equal(resultA.validation_report.metrics.transition_violation_count, 0);
  assert.equal(resultA.validation_report.metrics.timeline_violation_count, 0);
  assert.equal(resultA.validation_report.metrics.language_coverage.korean_percent, 100);
  assert.equal(resultA.validation_report.metrics.language_coverage.english_percent, 100);

  assert.deepEqual(
    (await readdir(resultA.output_dir)).sort(),
    Object.values(MANUFACTURING_ACTION_DATASET_OUTPUT_FILENAMES).sort()
  );
  const bytesA = await readOutputSet(resultA.output_dir);
  const bytesB = await readOutputSet(resultB.output_dir);
  for (const name of Object.keys(bytesA)) {
    assert.deepEqual(bytesA[name], bytesB[name], `${name} must be byte-identical across fixed-time runs`);
    assert.equal(bytesA[name].includes(Buffer.from('/Users/')), false, `${name} must not expose a user path`);
  }

  const dictionary = JSON.parse(bytesA['manufacturing_action_dictionary.json']);
  const episode = JSON.parse(bytesA['manufacturing_episode_annotation.json']);
  const validation = JSON.parse(bytesA['manufacturing_data_validation_report.json']);
  const datasetManifest = JSON.parse(bytesA['manufacturing_robotics_dataset_manifest.json']);
  const handoff = JSON.parse(bytesA['design_manufacturing_quality_handoff.json']);
  assertManufacturingActionArtifact(dictionary, { expectedType: 'manufacturing_action_dictionary' });
  assertManufacturingActionArtifact(episode, { expectedType: 'manufacturing_episode_annotation' });
  assertManufacturingActionArtifact(validation, { expectedType: 'manufacturing_data_validation_report' });
  assertManufacturingActionArtifact(datasetManifest, { expectedType: 'manufacturing_robotics_dataset_manifest' });
  assertManufacturingActionArtifact(handoff, { expectedType: 'design_manufacturing_quality_handoff' });
  assert.deepEqual(dictionary.actions.map((entry) => entry.action_id), MANUFACTURING_ACTION_SEQUENCE);
  assert.equal(episode.confidence.value, null);
  assert.equal(episode.confidence.applicability, 'not_applicable');
  assert.equal(episode.segments[0].start_ms, 0);
  episode.segments.forEach((segment, index) => {
    assert.equal(segment.action_id, MANUFACTURING_ACTION_SEQUENCE[index]);
    assert.equal(segment.end_ms - segment.start_ms, segment.duration_ms);
    if (index > 0) assert.equal(segment.start_ms, episode.segments[index - 1].end_ms);
  });
  assert.deepEqual(datasetManifest.members.map((entry) => entry.role), [
    'manufacturing_task_plan',
    'action_dictionary',
    'episode_annotation',
  ]);
  assert.equal(datasetManifest.members[1].sha256, sha256(bytesA['manufacturing_action_dictionary.json']));
  assert.equal(datasetManifest.members[2].sha256, sha256(bytesA['manufacturing_episode_annotation.json']));
  assert.equal(handoff.approvals.release, false);
  assert.equal(handoff.quality.inspection_evidence, false);
  assert.equal(handoff.trust.remaining_holds.includes('PRODUCTION_RELEASE: NOT_PERFORMED'), true);

  const artifactManifest = JSON.parse(bytesA['artifact-manifest.json']);
  assert.equal(artifactManifest.artifacts.length, 6);
  for (const record of artifactManifest.artifacts) {
    const name = record.path.replace(/^run\//, '');
    assert.equal(record.sha256, sha256(bytesA[name]));
    assert.equal(record.size_bytes, bytesA[name].length);
  }
  const outputManifest = JSON.parse(bytesA['output-manifest.json']);
  assert.equal(outputManifest.outputs.length, 7);
  assert.equal(outputManifest.outputs.some((entry) => entry.path.endsWith('output-manifest.json')), false);
  assert.equal(outputManifest.runtime.freecad_probe_status, 'not_invoked');
  assert.equal(artifactManifest.runtime.freecad.probe_status, 'not_invoked');
  assert.deepEqual(outputManifest.repo, {
    root: 'repo/root',
    ...expectedRepoContext,
  });
  assert.deepEqual(outputManifest.command_args, [
    '--config', 'configs/examples/hinge_block.toml',
    '--review-pack', 'run/review_pack.json',
    '--inspection-plan', 'run/inspection_plan.json',
    '--robot-config', 'configs/examples/robot_arm_6axis.toml',
    '--task-plan', 'configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json',
    '--proof-lineage',
    '--generated-at', optionsA.generatedAt,
    '--out-dir', 'run/',
  ]);
});
