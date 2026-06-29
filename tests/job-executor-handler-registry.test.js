import assert from 'node:assert/strict';

import { JOB_EXECUTOR_COMMANDS } from '../src/shared/command-manifest.js';
import {
  JOB_HANDLER_REGISTRY,
  createJobHandlerRegistry,
  executeJobByType,
} from '../src/services/jobs/execution/handler-registry.js';

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

await assert.rejects(
  () => executeJobByType({ type: 'unsupported-command' }, {}),
  /Unsupported job type: unsupported-command/,
  'executeJobByType should reject unsupported commands'
);

console.log('job-executor-handler-registry.test.js: ok');
