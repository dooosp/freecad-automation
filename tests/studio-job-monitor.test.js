import assert from 'node:assert/strict';

import {
  countActiveStudioMonitoredJobs,
  buildStudioJobCompletionNotice,
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
assert.deepEqual(
  resolveMonitoredJobCompletionTarget(
    {
      type: 'manufacturing-action-dataset',
      status: 'failed',
      diagnostics: {
        manufacturing_action_demo: {
          reason_code: 'REVISION_LINEAGE_IDENTITY_MISMATCH',
        },
      },
    },
    {
      completionAction: {
        preferredRoute: 'review',
        failureRoute: 'review',
      },
    }
  ),
  {
    route: 'review',
    secondaryRoute: '',
    hasReviewOutputs: false,
  },
  'The bounded mismatch may opt in to opening its blocked Review result.'
);
assert.deepEqual(
  resolveMonitoredJobCompletionTarget(
    {
      type: 'manufacturing-action-dataset',
      status: 'failed',
      diagnostics: {
        manufacturing_action_demo: {
          reason_code: 'SOURCE_HASH_MISMATCH',
        },
      },
    },
    { completionAction: { failureRoute: 'review' } }
  ),
  {
    route: '',
    secondaryRoute: '',
    hasReviewOutputs: false,
  },
  'A generic manufacturing failure must not route to the bounded Review state.'
);
assert.deepEqual(
  resolveMonitoredJobCompletionTarget(
    { type: 'report', status: 'failed' },
    { completionAction: { preferredRoute: 'review' } }
  ),
  {
    route: '',
    secondaryRoute: '',
    hasReviewOutputs: false,
  },
  'Generic failures must retain the existing Jobs-center completion behavior.'
);
assert.equal(
  resolveMonitoredJobCompletionRoute(
    {
      type: 'manufacturing-action-dataset',
      status: 'cancelled',
      diagnostics: {
        manufacturing_action_demo: {
          reason_code: 'REVISION_LINEAGE_IDENTITY_MISMATCH',
        },
      },
    },
    { failureRoute: 'review' }
  ),
  '',
  'Cancellation must not be treated as the bounded failed result.'
);

const passedCompletionNotice = buildStudioJobCompletionNotice(
  {
    id: 'job-pass-123456789',
    type: 'report',
    status: 'succeeded',
    result: {
      report_summary: {
        config_name: 'quality_pass_bracket',
        overall_status: 'pass',
        ready_for_manufacturing_review: true,
      },
    },
  },
  {
    route: 'review',
    secondaryRoute: 'artifacts',
  },
  0
);
assert.equal(passedCompletionNotice.tone, 'ok');
assert.equal(passedCompletionNotice.title, 'Tracked report completed');
assert.match(passedCompletionNotice.message, /Job succeeded/);
assert.match(passedCompletionNotice.message, /Quality passed/);
assert.match(passedCompletionNotice.message, /Ready Yes/);
assert.deepEqual(passedCompletionNotice.messageParts, [
  'Job succeeded.',
  'Quality passed.',
  'Ready Yes.',
  'Open Review for decision context or Artifacts for generated files.',
]);
assert.deepEqual(
  passedCompletionNotice.actions.map((action) => [action.label, action.action, action.route]),
  [
    ['Open Review', 'open-job', 'review'],
    ['Open Artifacts', 'open-job', 'artifacts'],
  ]
);

const manufacturingCompletionNotice = buildStudioJobCompletionNotice(
  {
    id: 'job-manufacturing-success-123456789',
    type: 'manufacturing-action-dataset',
    status: 'succeeded',
    result: {
      status: 'valid_synthetic_demo',
      publication: { expected_count: 8, published_count: 8, exact: true },
    },
  },
  {
    route: 'review',
    secondaryRoute: 'artifacts',
  },
  0
);
assert.equal(manufacturingCompletionNotice.tone, 'ok');
assert.equal(manufacturingCompletionNotice.title, 'Tracked manufacturing-action-dataset completed');
assert.deepEqual(
  manufacturingCompletionNotice.actions.map((action) => [action.label, action.action, action.route]),
  [
    ['Open Review', 'open-job', 'review'],
    ['Open Artifacts', 'open-job', 'artifacts'],
  ]
);

const heldReadinessCompletionNotice = buildStudioJobCompletionNotice(
  {
    id: 'job-held-readiness-123456789',
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
  },
  {
    route: 'review',
    secondaryRoute: 'artifacts',
  },
  0
);
assert.equal(heldReadinessCompletionNotice.tone, 'warn');
assert.equal(heldReadinessCompletionNotice.title, 'Tracked readiness-pack completed');
assert.match(heldReadinessCompletionNotice.message, /Quality passed/);
assert.match(heldReadinessCompletionNotice.message, /Ready held: missing inspection_evidence/);
assert.equal(heldReadinessCompletionNotice.message.includes('Ready Yes'), false);
assert.deepEqual(heldReadinessCompletionNotice.messageParts, [
  'Job succeeded.',
  'Quality passed.',
  'Ready held: missing inspection_evidence.',
  'Open Review for decision context or Artifacts for generated files.',
]);

const failedQualityCompletionNotice = buildStudioJobCompletionNotice(
  {
    id: 'job-quality-fail-123456789',
    type: 'report',
    status: 'succeeded',
    result: {
      report_summary: {
        config_name: 'ks_bracket',
        overall_status: 'fail',
        ready_for_manufacturing_review: false,
      },
    },
  },
  {
    route: 'artifacts',
    secondaryRoute: '',
  },
  1
);
assert.equal(failedQualityCompletionNotice.tone, 'warn');
assert.equal(failedQualityCompletionNotice.title, 'Tracked report completed');
assert.match(failedQualityCompletionNotice.message, /Quality failed/);
assert.match(failedQualityCompletionNotice.message, /Ready No/);
assert.match(failedQualityCompletionNotice.message, /1 other active job still running/);
assert.equal(failedQualityCompletionNotice.messageParts.includes('1 other active job still running.'), true);

const failedJobCompletionNotice = buildStudioJobCompletionNotice(
  {
    id: 'job-failed-123456789',
    type: 'create',
    status: 'failed',
  },
  {},
  0
);
assert.equal(failedJobCompletionNotice.tone, 'bad');
assert.equal(failedJobCompletionNotice.title, 'Tracked create failed');
assert.match(failedJobCompletionNotice.message, /Open Jobs center/);
assert.deepEqual(
  failedJobCompletionNotice.actions.map((action) => [action.label, action.action]),
  [
    ['Retry tracked job', 'retry-job'],
    ['Open Jobs center', 'open-jobs-center'],
  ]
);

const mismatchCompletionNotice = buildStudioJobCompletionNotice(
  {
    id: 'job-manufacturing-mismatch-123456789',
    type: 'manufacturing-action-dataset',
    status: 'failed',
    diagnostics: {
      manufacturing_action_demo: {
        reason_code: 'REVISION_LINEAGE_IDENTITY_MISMATCH',
      },
    },
  },
  { route: 'review' },
  0
);
assert.equal(mismatchCompletionNotice.tone, 'bad');
assert.equal(mismatchCompletionNotice.title, 'Tracked manufacturing-action-dataset failed');
assert.equal(mismatchCompletionNotice.primaryRoute, 'review');
assert.equal(mismatchCompletionNotice.primaryLabel, 'Open Review');
assert.match(mismatchCompletionNotice.message, /bounded revision mismatch/i);
assert.match(mismatchCompletionNotice.message, /server-pinned synthetic Revision A recovery/);
assert.equal(mismatchCompletionNotice.message.includes('retry when the source issue is fixed'), false);
assert.deepEqual(
  mismatchCompletionNotice.actions.map((action) => [action.label, action.action, action.route || '']),
  [
    ['Open Review', 'open-job', 'review'],
    ['Open Jobs center', 'open-jobs-center', ''],
  ]
);
assert.equal(mismatchCompletionNotice.actions.some((action) => action.action === 'retry-job'), false);

const cancelledJobCompletionNotice = buildStudioJobCompletionNotice(
  {
    id: 'job-cancelled-123456789',
    type: 'draw',
    status: 'cancelled',
  },
  {},
  0
);
assert.equal(cancelledJobCompletionNotice.tone, 'warn');
assert.equal(cancelledJobCompletionNotice.title, 'Tracked draw cancelled');
assert.equal(cancelledJobCompletionNotice.actions[0].action, 'open-jobs-center');

const af5PackJob = {
  id: 'af5-pack-job-123456789',
  type: 'pack',
  status: 'succeeded',
  updated_at: '2026-03-28T12:00:00.000Z',
  request: {
    artifact_ref: {
      job_id: 'af5-docs-job-123456789',
      artifact_id: 'readiness-report',
    },
    source_job_id: 'af5-docs-job-123456789',
    source_artifact_id: 'readiness-report',
    source_label: 'readiness_report.json',
  },
};
const af5RecentJobs = mergeTrackedJobIntoRecentJobs(
  af5PackJob,
  [
    { id: 'af5-review-job-123456789', type: 'review-context', status: 'succeeded', updated_at: '2026-03-28T09:00:00.000Z' },
    { id: 'af5-readiness-job-123456789', type: 'readiness-pack', status: 'succeeded', updated_at: '2026-03-28T10:00:00.000Z' },
    { id: 'af5-docs-job-123456789', type: 'generate-standard-docs', status: 'succeeded', updated_at: '2026-03-28T11:00:00.000Z' },
  ],
  4
);

assert.deepEqual(af5RecentJobs.map((job) => job.id), [
  'af5-pack-job-123456789',
  'af5-docs-job-123456789',
  'af5-readiness-job-123456789',
  'af5-review-job-123456789',
]);
assert.deepEqual(af5RecentJobs[0].request.artifact_ref, {
  job_id: 'af5-docs-job-123456789',
  artifact_id: 'readiness-report',
});
assert.equal('config_toml' in af5RecentJobs[0].request, false);
assert.equal('context_path' in af5RecentJobs[0].request, false);
assert.equal('model_path' in af5RecentJobs[0].request, false);

const af5CompletionTarget = resolveMonitoredJobCompletionTarget(
  af5PackJob,
  {
    artifacts: [
      { type: 'review-pack.json', file_name: 'review_pack.json', exists: true, contract: { reentry_target: 'review_pack' } },
      { type: 'readiness-report.json', file_name: 'readiness_report.json', exists: true, contract: { reentry_target: 'readiness_report' } },
      { type: 'standard-docs.summary', file_name: 'standard_docs_manifest.json', exists: true },
      { type: 'release-bundle.manifest.json', file_name: 'release_bundle_manifest.json', exists: true },
      { type: 'release-bundle.zip', file_name: 'release_bundle.zip', extension: '.zip', exists: true, contract: { reentry_target: 'release_bundle' } },
    ],
    completionAction: {
      type: 'tracked-run-completion',
      sourceArtifactFamily: 'review',
    },
  }
);
assert.deepEqual(af5CompletionTarget, {
  route: 'review',
  secondaryRoute: 'artifacts',
  hasReviewOutputs: true,
});
const af5CompletionNotice = buildStudioJobCompletionNotice(af5PackJob, af5CompletionTarget, 0);
assert.deepEqual(
  af5CompletionNotice.actions.map((action) => [action.label, action.action, action.route]),
  [
    ['Open Review', 'open-job', 'review'],
    ['Open Artifacts', 'open-job', 'artifacts'],
  ]
);

console.log('studio-job-monitor.test.js: ok');
