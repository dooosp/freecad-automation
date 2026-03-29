import assert from 'node:assert/strict';

import {
  buildTrackedReportJobOptions,
  collectValidationNotes,
  deriveModelTrackedRunPresentation,
  ensureModelTrackedRunState,
  normalizeModelReportOptions,
} from '../public/js/studio/model-tracked-runs.js';

const reportOptions = normalizeModelReportOptions({
  includeDrawing: false,
  includeTolerance: true,
  includeDfm: true,
  includeCost: false,
  profileName: 'site_korea_ulsan',
});

assert.deepEqual(buildTrackedReportJobOptions(reportOptions), {
  include_drawing: false,
  include_tolerance: true,
  include_dfm: true,
  include_cost: false,
  profile_name: 'site_korea_ulsan',
});

assert.deepEqual(
  collectValidationNotes({
    warnings: ['Missing export directory'],
    changed_fields: ['Converted drawing.scale to drawing_plan.scale'],
    deprecated_fields: ['legacy_field is deprecated'],
  }).map((entry) => `${entry.category}:${entry.message}`),
  [
    'Warning:Missing export directory',
    'Migration:Converted drawing.scale to drawing_plan.scale',
    'Deprecated:legacy_field is deprecated',
  ],
);

const model = ensureModelTrackedRunState({
  trackedRun: {
    type: 'report',
    lastJobId: 'job-123456789',
    status: 'queued',
  },
});

const queuedPresentation = deriveModelTrackedRunPresentation({
  model,
  recentJobs: [{ id: 'job-123456789', type: 'report', status: 'queued' }],
});
assert.equal(queuedPresentation.status, 'queued');
assert.equal(queuedPresentation.badgeLabel, 'Tracked report queued');
assert.equal(queuedPresentation.canOpenArtifacts, false);

const succeededPresentation = deriveModelTrackedRunPresentation({
  model,
  recentJobs: [{ id: 'job-123456789', type: 'report', status: 'succeeded' }],
});
assert.equal(succeededPresentation.status, 'succeeded');
assert.equal(succeededPresentation.canOpenArtifacts, true);
assert.match(succeededPresentation.copy, /artifact trail/i);

const failedPresentation = deriveModelTrackedRunPresentation({
  model: ensureModelTrackedRunState({
    trackedRun: {
      type: 'create',
      status: 'failed',
      error: 'Queue rejected',
    },
  }),
});
assert.equal(failedPresentation.status, 'failed');
assert.match(failedPresentation.copy, /Queue rejected/);

console.log('model-tracked-runs.test.js: ok');
