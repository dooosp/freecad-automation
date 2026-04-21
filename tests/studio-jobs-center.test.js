import assert from 'node:assert/strict';

import {
  collectJobsCenterJobs,
  deriveJobsCenterActionEligibility,
} from '../public/js/studio/jobs-center.js';
import {
  deriveRecentJobQualityStatus,
  formatRecentJobQualityLine,
} from '../public/js/studio/recent-job-quality-status.js';

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

{
  const job = {
    id: '6230c792',
    type: 'report',
    status: 'succeeded',
    result: {
      report_summary: {
        config_name: 'ks_bracket',
        overall_status: 'fail',
        ready_for_manufacturing_review: false,
      },
    },
  };
  assert.deepEqual(deriveRecentJobQualityStatus(job), {
    configName: 'ks_bracket',
    jobExecutionStatus: 'Job succeeded',
    qualityStatus: 'Quality failed',
    readyForManufacturingReview: 'Ready No',
    hasQualityDecision: true,
  });
  assert.equal(
    formatRecentJobQualityLine(job, '6230c792'),
    'report 6230c792 · ks_bracket · Job succeeded · Quality failed · Ready No'
  );
}

{
  const job = {
    id: '9d02714d',
    type: 'report',
    status: 'succeeded',
    result: {
      report_summary: {
        config_name: 'quality_pass_bracket',
        overall_status: 'pass',
        ready_for_manufacturing_review: true,
      },
    },
  };
  assert.deepEqual(deriveRecentJobQualityStatus(job), {
    configName: 'quality_pass_bracket',
    jobExecutionStatus: 'Job succeeded',
    qualityStatus: 'Quality passed',
    readyForManufacturingReview: 'Ready Yes',
    hasQualityDecision: true,
  });
  assert.equal(
    formatRecentJobQualityLine(job, '9d02714d'),
    'report 9d02714d · quality_pass_bracket · Job succeeded · Quality passed · Ready Yes'
  );
}

{
  const job = {
    id: 'missing-quality',
    type: 'report',
    status: 'succeeded',
    artifacts: {
      summary_json: '/tmp/output/custom_bracket_report_summary.json',
    },
  };
  assert.deepEqual(deriveRecentJobQualityStatus(job), {
    configName: 'custom_bracket',
    jobExecutionStatus: 'Job succeeded',
    qualityStatus: 'Quality Unknown',
    readyForManufacturingReview: 'Ready Unknown',
    hasQualityDecision: false,
  });
}

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
