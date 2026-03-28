import assert from 'node:assert/strict';

import {
  describeJobMonitorTransition,
  mergeTrackedJobIntoRecentJobs,
  resolveMonitoredJobCompletionRoute,
  sortStudioJobsByUpdatedAt,
} from '../public/js/studio/job-monitor.js';

const sorted = sortStudioJobsByUpdatedAt([
  { id: 'older', updated_at: '2026-03-28T01:00:00.000Z' },
  { id: 'newer', updated_at: '2026-03-28T03:00:00.000Z' },
  { id: 'created-only', created_at: '2026-03-28T02:00:00.000Z' },
]);

assert.deepEqual(sorted.map((job) => job.id), ['newer', 'created-only', 'older']);

const merged = mergeTrackedJobIntoRecentJobs(
  { id: 'job-2', updated_at: '2026-03-28T05:00:00.000Z' },
  [
    { id: 'job-1', updated_at: '2026-03-28T01:00:00.000Z' },
    { id: 'job-2', updated_at: '2026-03-28T02:00:00.000Z' },
    { id: 'job-3', updated_at: '2026-03-28T03:00:00.000Z' },
  ],
  2
);

assert.deepEqual(merged.map((job) => job.id), ['job-2', 'job-3']);

const started = describeJobMonitorTransition(
  { id: 'job-123456789', type: 'draw' },
  '',
  'queued',
  'submit'
);
assert.equal(started.tone, 'info');
assert.match(started.message, /Started monitoring draw job-1234 in queued\./);

const changed = describeJobMonitorTransition(
  { id: 'job-123456789', type: 'draw' },
  'queued',
  'running'
);
assert.equal(changed.tone, 'warn');
assert.match(changed.message, /moved from queued to running/);

assert.equal(
  resolveMonitoredJobCompletionRoute(
    { status: 'succeeded' },
    { type: 'open-artifacts-on-success', route: 'review' }
  ),
  'review'
);
assert.equal(
  resolveMonitoredJobCompletionRoute(
    { status: 'succeeded' },
    { type: 'open-artifacts-on-success' }
  ),
  'artifacts'
);
assert.equal(
  resolveMonitoredJobCompletionRoute(
    { status: 'running' },
    { type: 'open-artifacts-on-success', route: 'review' }
  ),
  ''
);

console.log('studio-job-monitor.test.js: ok');
