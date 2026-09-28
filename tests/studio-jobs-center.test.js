import assert from 'node:assert/strict';
import { workspaceDefinitions } from '../public/js/studio/workspaces.js';
import { createStudioShellState } from '../public/js/studio/studio-shell-store.js';
import { setLocale } from '../public/js/i18n/index.js';
import { installDrawingTestDom } from './helpers/drawing-test-dom.js';

import {
  collectJobsCenterJobs,
  deriveJobsCenterActionEligibility,
} from '../public/js/studio/jobs-center.js';
import {
  deriveRecentJobDecisionState,
  deriveRecentJobQualityStatus,
  formatRecentJobQualityLine,
  formatJobDisplayName,
} from '../public/js/studio/recent-job-quality-status.js';

for (const [name, revision] of [['Motor bracket', 'A'], ['Sensor bracket', 'B']]) {
  const job = {
    type: 'review-context', status: 'succeeded',
    artifacts: { context: 'review_pack_context.json' },
    result: { reviewPackDocument: { part: { part_id: name.toLowerCase().replaceAll(' ', '_'), name, revision } } },
  };
  assert.equal(deriveRecentJobQualityStatus(job).configName, name, 'recorded part identity must win over generic output filenames');
  assert.equal(formatJobDisplayName(job, 'en'), `${name} · Rev ${revision}`);
  assert.equal(formatJobDisplayName(job, 'ko'), `${name} · 리비전 ${revision}`);
  job.result.reviewPackDocument.part.revision = null;
  assert.equal(formatJobDisplayName(job, 'en'), name, 'unknown revisions must not be invented');
}

{
  const restore = installDrawingTestDom();
  try {
    const state = createStudioShellState();
    state.data.recentJobs = { status: 'ready', items: [
      { id: 'part-a', type: 'review-context', status: 'succeeded', result: { reviewPackDocument: { part: { name: 'Motor bracket', revision: 'A' } } } },
      { id: 'part-b', type: 'review-context', status: 'succeeded', result: { reviewPackDocument: { part: { name: 'Sensor bracket', revision: 'B' } } } },
    ] };
    setLocale('en', { persist: false });
    const en = workspaceDefinitions.history.render(state).textContent;
    assert.match(en, /Motor bracket · Rev A/);
    assert.match(en, /Sensor bracket · Rev B/);
    setLocale('ko', { persist: false });
    const ko = workspaceDefinitions.history.render(state).textContent;
    assert.match(ko, /Motor bracket · 리비전 A/);
    assert.match(ko, /Sensor bracket · 리비전 B/);
  } finally {
    setLocale('en', { persist: false });
    restore();
  }
}

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

for (const [status, expected] of [
  ['pass', 'Quality passed'],
  ['fail', 'Quality failed'],
  ['warning', 'Quality warning'],
  ['not_run', 'Quality Unknown'],
]) {
  const job = {
    type: 'create',
    status: 'succeeded',
    request: { config: { name: 'tracked_bracket' } },
    result: { create_quality: { status } },
  };
  const actual = deriveRecentJobQualityStatus(job);
  assert.equal(actual.qualityStatus, expected);
  assert.equal(actual.jobExecutionStatus, 'Job succeeded');
  assert.equal(actual.readyForManufacturingReview, 'Ready Unknown', 'geometry checks never establish manufacturing readiness');
  if (status === 'fail') {
    assert.equal(deriveRecentJobDecisionState(job).needsAttention, true);
    assert.equal(deriveRecentJobDecisionState(job).reason, 'quality');
  }
}

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
    id: 'held-readiness',
    type: 'readiness-pack',
    status: 'succeeded',
    result: {
      report_summary: {
        config_name: 'quality_pass_bracket',
        overall_status: 'pass',
        ready_for_manufacturing_review: true,
      },
      readiness_summary: {
        status: 'needs_more_evidence',
        gate_decision: 'hold_for_evidence_completion',
        missing_inputs: ['inspection_evidence'],
      },
    },
  };
  assert.deepEqual(deriveRecentJobQualityStatus(job), {
    configName: 'quality_pass_bracket',
    jobExecutionStatus: 'Job succeeded',
    qualityStatus: 'Quality passed',
    readyForManufacturingReview: 'Ready held: missing inspection_evidence',
    hasQualityDecision: true,
  });
  assert.equal(
    formatRecentJobQualityLine(job, 'held-rea'),
    'readiness-pack held-rea · quality_pass_bracket · Job succeeded · Quality passed · Ready held: missing inspection_evidence'
  );
  assert.deepEqual(deriveRecentJobDecisionState(job), {
    label: 'Ready held: missing inspection_evidence',
    tone: 'warn',
    needsAttention: true,
    reason: 'readiness',
  });
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
  assert.deepEqual(deriveRecentJobDecisionState(job), {
    label: 'Job succeeded',
    tone: 'ok',
    needsAttention: false,
    reason: 'execution',
  });
}

{
  const job = {
    id: 'quality-failed',
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
  assert.deepEqual(deriveRecentJobDecisionState(job), {
    label: 'Ready No',
    tone: 'warn',
    needsAttention: true,
    reason: 'readiness',
  });
}

{
  const job = {
    id: 'partial-report',
    type: 'report',
    status: 'succeeded',
    result: {
      report_summary: {
        config_name: 'partial_report',
      },
    },
  };
  assert.deepEqual(deriveRecentJobDecisionState(job), {
    label: 'Decision unknown',
    tone: 'warn',
    needsAttention: true,
    reason: 'unknown_decision',
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
    type: 'inspection-evidence-intake',
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
