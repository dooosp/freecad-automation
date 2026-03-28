import assert from 'node:assert/strict';

import {
  countActiveStudioMonitoredJobs,
  describeJobMonitorTransition,
  ensureStudioJobMonitorState,
  findStudioMonitoredJob,
  listActiveStudioMonitoredJobs,
  mergeTrackedJobIntoRecentJobs,
  resolveMonitoredJobCompletionTarget,
  resolveMonitoredJobCompletionRoute,
  syncActiveJobsIntoMonitor,
  sortStudioJobsByUpdatedAt,
  upsertStudioMonitoredJob,
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

const monitor = syncActiveJobsIntoMonitor({}, [
  { id: 'job-queued', type: 'draw', status: 'queued', updated_at: '2026-03-28T05:00:00.000Z' },
  { id: 'job-terminal', type: 'create', status: 'succeeded', updated_at: '2026-03-28T06:00:00.000Z' },
  { id: 'job-running', type: 'report', status: 'running', updated_at: '2026-03-28T07:00:00.000Z' },
]);

assert.equal(countActiveStudioMonitoredJobs(monitor), 2);
assert.deepEqual(listActiveStudioMonitoredJobs(monitor).map((job) => job.id), ['job-running', 'job-queued']);

const updatedMonitor = upsertStudioMonitoredJob(monitor, {
  id: 'job-queued',
  type: 'draw',
  status: 'cancelled',
  updated_at: '2026-03-28T08:00:00.000Z',
}, {
  completionAction: { type: 'open-artifacts-on-success' },
});

assert.equal(findStudioMonitoredJob(updatedMonitor, 'job-queued').enabled, false);
assert.equal(findStudioMonitoredJob(updatedMonitor, 'job-queued').completionAction.type, 'open-artifacts-on-success');
assert.equal(countActiveStudioMonitoredJobs(updatedMonitor), 1);

const preservedMonitor = syncActiveJobsIntoMonitor(ensureStudioJobMonitorState({
  items: [
    { id: 'job-failed', type: 'create', status: 'failed', updated_at: '2026-03-28T02:00:00.000Z', enabled: false },
  ],
}), [
  { id: 'job-running', type: 'draw', status: 'running', updated_at: '2026-03-28T09:00:00.000Z' },
  { id: 'job-failed', type: 'create', status: 'failed', updated_at: '2026-03-28T02:00:00.000Z' },
]);

assert.deepEqual(preservedMonitor.items.map((job) => [job.id, job.enabled]), [
  ['job-running', true],
  ['job-failed', false],
]);

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

assert.deepEqual(
  resolveMonitoredJobCompletionTarget(
    { type: 'create', status: 'succeeded' }
  ),
  {
    route: 'artifacts',
    secondaryRoute: '',
    hasReviewOutputs: false,
  }
);

assert.deepEqual(
  resolveMonitoredJobCompletionTarget(
    { type: 'report', status: 'succeeded' },
    {
      artifacts: [
        { type: 'review.readiness', file_name: 'readiness.json', exists: true },
      ],
    }
  ),
  {
    route: 'review',
    secondaryRoute: 'artifacts',
    hasReviewOutputs: true,
  }
);

assert.deepEqual(
  resolveMonitoredJobCompletionTarget(
    { type: 'report', status: 'succeeded' },
    {
      artifacts: [
        { type: 'report.pdf', file_name: 'report.pdf', exists: true },
      ],
    }
  ),
  {
    route: 'artifacts',
    secondaryRoute: '',
    hasReviewOutputs: false,
  }
);

assert.deepEqual(
  resolveMonitoredJobCompletionTarget(
    { type: 'inspect', status: 'succeeded' },
    {
      completionAction: {
        type: 'tracked-run-completion',
        sourceArtifactFamily: 'review',
      },
    }
  ),
  {
    route: 'review',
    secondaryRoute: 'artifacts',
    hasReviewOutputs: false,
  }
);

assert.equal(
  resolveMonitoredJobCompletionRoute(
    { status: 'succeeded' },
    { type: 'open-artifacts-on-success', route: 'review' }
  ),
  'review'
);
assert.equal(
  resolveMonitoredJobCompletionRoute(
    { type: 'draw', status: 'succeeded' },
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
