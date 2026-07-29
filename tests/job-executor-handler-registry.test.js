import assert from 'node:assert/strict';

import { JOB_EXECUTOR_COMMANDS } from '../src/shared/command-manifest.js';
import {
  JOB_HANDLER_REGISTRY,
  createJobHandlerRegistry,
  executeJobByType,
} from '../src/services/jobs/execution/handler-registry.js';
import {
  MANUFACTURING_ACTION_TRACKED_ARTIFACTS,
} from '../src/services/jobs/execution/manufacturing-action-handlers.js';

assert.deepEqual(
  Object.keys(JOB_HANDLER_REGISTRY).sort(),
  [...JOB_EXECUTOR_COMMANDS].sort(),
  'default job handler registry should cover exactly the job executor command surface'
);

const defaultRegistry = createJobHandlerRegistry();
assert.deepEqual(
  Object.keys(defaultRegistry).sort(),
  [...JOB_EXECUTOR_COMMANDS].sort(),
  'createJobHandlerRegistry should cover exactly the job executor command surface'
);

for (const command of JOB_EXECUTOR_COMMANDS) {
  assert.equal(
    typeof defaultRegistry[command],
    'function',
    `${command} should have an executable handler`
  );
}

const manufacturingOutputs = Object.fromEntries(
  MANUFACTURING_ACTION_TRACKED_ARTIFACTS.map(({ key, filename }) => [key, `/tmp/job/artifacts/${filename}`])
);
const manufacturingOutcome = await executeJobByType(
  { type: 'manufacturing-action-dataset' },
  {
    executeManufacturingActionDataset: async () => ({
      result: { status: 'valid_synthetic_demo' },
      outputs: manufacturingOutputs,
      diagnostics: { manufacturing_action_demo: { published: { expected_count: 8, published_count: 8 } } },
    }),
  }
);
assert.equal(Object.keys(manufacturingOutcome.artifacts).length, 8);
assert.equal(manufacturingOutcome.manifestArtifacts.length, 8);
assert.equal(manufacturingOutcome.manifestArtifacts.every((artifact) => artifact.scope === 'user-facing'), true);
await assert.rejects(
  () => executeJobByType(
    { type: 'manufacturing-action-dataset' },
    {
      executeManufacturingActionDataset: async () => ({
        result: { status: 'valid_synthetic_demo' },
        outputs: { ...manufacturingOutputs, unexpected: '/tmp/job/artifacts/unexpected.json' },
      }),
    }
  ),
  /fixed eight-file output set/
);

await assert.rejects(
  () => executeJobByType({ type: 'unsupported-command' }, {}),
  /Unsupported job type: unsupported-command/,
  'executeJobByType should reject unsupported commands'
);

console.log('job-executor-handler-registry.test.js: ok');
