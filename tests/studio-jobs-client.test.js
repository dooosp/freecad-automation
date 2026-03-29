import assert from 'node:assert/strict';

import {
  findResumableStudioJob,
  findResumableStudioJobs,
  isReviewableStudioJob,
  isActiveStudioJobStatus,
  supportsStudioJobCancellation,
  supportsStudioJobRetry,
  studioJobTone,
} from '../public/js/studio/jobs-client.js';

assert.equal(isActiveStudioJobStatus('queued'), true);
assert.equal(isActiveStudioJobStatus('running'), true);
assert.equal(isActiveStudioJobStatus('succeeded'), false);
assert.equal(isActiveStudioJobStatus('failed'), false);
assert.equal(isActiveStudioJobStatus('cancelled'), false);

assert.equal(studioJobTone('queued'), 'info');
assert.equal(studioJobTone('running'), 'warn');
assert.equal(studioJobTone('succeeded'), 'ok');
assert.equal(studioJobTone('failed'), 'bad');
assert.equal(studioJobTone('cancelled'), 'bad');

const resumable = findResumableStudioJob([
  { id: 'done', status: 'succeeded' },
  { id: 'queued-job', status: 'queued' },
  { id: 'running-job', status: 'running' },
]);

assert.equal(resumable.id, 'queued-job');
assert.deepEqual(
  findResumableStudioJobs([
    { id: 'done', status: 'succeeded' },
    { id: 'queued-job', status: 'queued' },
    { id: 'running-job', status: 'running' },
  ]).map((job) => job.id),
  ['queued-job', 'running-job']
);
assert.equal(supportsStudioJobCancellation({ capabilities: { cancellation_supported: true } }), true);
assert.equal(supportsStudioJobCancellation({ capabilities: { cancellation_supported: false } }), false);
assert.equal(supportsStudioJobRetry({ capabilities: { retry_supported: true } }), true);
assert.equal(supportsStudioJobRetry({ capabilities: { retry_supported: false } }), false);
assert.equal(isReviewableStudioJob({ type: 'report', status: 'succeeded' }), true);
assert.equal(isReviewableStudioJob({ type: 'draw', status: 'succeeded' }), false);
assert.equal(isReviewableStudioJob({ type: 'inspect', status: 'running' }), false);

console.log('studio-jobs-client.test.js: ok');
