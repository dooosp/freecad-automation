import assert from 'node:assert/strict';

import {
  findResumableStudioJob,
  isActiveStudioJobStatus,
  studioJobTone,
} from '../public/js/studio/jobs-client.js';

assert.equal(isActiveStudioJobStatus('queued'), true);
assert.equal(isActiveStudioJobStatus('running'), true);
assert.equal(isActiveStudioJobStatus('succeeded'), false);
assert.equal(isActiveStudioJobStatus('failed'), false);

assert.equal(studioJobTone('queued'), 'info');
assert.equal(studioJobTone('running'), 'warn');
assert.equal(studioJobTone('succeeded'), 'ok');
assert.equal(studioJobTone('failed'), 'bad');

const resumable = findResumableStudioJob([
  { id: 'done', status: 'succeeded' },
  { id: 'queued-job', status: 'queued' },
  { id: 'running-job', status: 'running' },
]);

assert.equal(resumable.id, 'queued-job');

console.log('studio-jobs-client.test.js: ok');
