import assert from 'node:assert/strict';

import {
  collectJobsCenterJobs,
  deriveJobsCenterActionEligibility,
} from '../public/js/studio/jobs-center.js';

const jobs = collectJobsCenterJobs({
  recentJobs: [
    { id: 'job-older', type: 'draw', status: 'succeeded', updated_at: '2026-03-28T01:00:00.000Z' },
    { id: 'job-retry', type: 'report', status: 'failed', updated_at: '2026-03-28T03:00:00.000Z' },
  ],
  jobMonitor: {
    items: [
      { id: 'job-active', type: 'inspect', status: 'running', updated_at: '2026-03-28T05:00:00.000Z', enabled: true },
      { id: 'job-retry', type: 'report', status: 'failed', updated_at: '2026-03-28T03:00:00.000Z', enabled: false },
    ],
  },
  limit: 4,
});

assert.deepEqual(jobs.map((job) => job.id), ['job-active', 'job-retry', 'job-older']);

assert.deepEqual(
  deriveJobsCenterActionEligibility({
    id: 'job-active',
    type: 'inspect',
    status: 'running',
    capabilities: {
      cancellation_supported: true,
      retry_supported: false,
    },
  }),
  {
    canOpenArtifacts: true,
    canOpenReview: false,
    canCancel: true,
    canRetry: false,
  }
);

assert.deepEqual(
  deriveJobsCenterActionEligibility({
    id: 'job-review',
    type: 'report',
    status: 'succeeded',
    capabilities: {
      cancellation_supported: false,
      retry_supported: false,
    },
  }),
  {
    canOpenArtifacts: true,
    canOpenReview: true,
    canCancel: false,
    canRetry: false,
  }
);

assert.deepEqual(
  deriveJobsCenterActionEligibility({
    id: 'job-retry',
    type: 'draw',
    status: 'failed',
    capabilities: {
      cancellation_supported: false,
      retry_supported: true,
    },
  }),
  {
    canOpenArtifacts: true,
    canOpenReview: false,
    canCancel: false,
    canRetry: true,
  }
);

console.log('studio-jobs-center.test.js: ok');
