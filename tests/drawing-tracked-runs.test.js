import assert from 'node:assert/strict';

import {
  deriveDrawingTrackedRunPresentation,
  ensureDrawingTrackedRunState,
  updateDrawingTrackedRunFromJob,
} from '../public/js/studio/drawing-tracked-runs.js';

const drawing = ensureDrawingTrackedRunState({
  trackedRun: {
    lastJobId: '',
    status: 'idle',
  },
});

const idle = deriveDrawingTrackedRunPresentation({ drawing });
assert.equal(idle.title, 'Tracked draw idle');
assert.equal(idle.canOpenArtifacts, false);

const trackedRun = updateDrawingTrackedRunFromJob(drawing, {
  id: 'job-draw-12345678',
  status: 'queued',
  request: {
    options: {
      studio: {
        preview_plan: {
          requested: true,
          preserved: true,
          reason: 'preserved',
        },
      },
    },
  },
});

assert.equal(trackedRun.lastJobId, 'job-draw-12345678');
assert.equal(trackedRun.preservedEditedPreview, true);

const running = deriveDrawingTrackedRunPresentation({
  drawing,
  recentJobs: [
    { id: 'job-draw-12345678', type: 'draw', status: 'running' },
  ],
});
assert.equal(running.title, 'Tracked draw running');
assert.match(running.previewPlanCopy, /preserved/i);

const succeeded = deriveDrawingTrackedRunPresentation({
  drawing,
  recentJobs: [
    { id: 'job-draw-12345678', type: 'draw', status: 'succeeded' },
  ],
});
assert.equal(succeeded.canOpenArtifacts, true);
assert.equal(succeeded.job.id, 'job-draw-12345678');

const needsReview = deriveDrawingTrackedRunPresentation({
  drawing,
  recentJobs: [
    {
      id: 'job-draw-12345678',
      type: 'draw',
      status: 'succeeded',
      result: {
        report_summary: {
          config_name: 'drawing_quality_case',
          overall_status: 'warning',
          ready_for_manufacturing_review: false,
        },
      },
    },
  ],
});
assert.equal(needsReview.title, 'Tracked draw needs review');
assert.equal(needsReview.tone, 'warn');
assert.equal(needsReview.canOpenArtifacts, true);
assert.match(needsReview.copy, /Ready No/);

// Shape of a warning-friendly draw result: execution succeeds while QA can fail.
const canonicalFailure = deriveDrawingTrackedRunPresentation({
  drawing,
  recentJobs: [{
    id: 'job-draw-12345678',
    type: 'draw',
    status: 'succeeded',
    result: {
      success: true,
      drawing_paths: ['artifacts/bracket_drawing.svg'],
      drawing_quality: {
        status: 'fail',
        traceability: { coverage_percent: 80, unmapped_required_entities: ['WIDTH'] },
      },
    },
  }],
});
assert.equal(canonicalFailure.title, 'Tracked draw needs review');
assert.equal(canonicalFailure.tone, 'warn');
assert.equal(canonicalFailure.canOpenArtifacts, true);
assert.match(canonicalFailure.copy, /Quality failed/);
assert.equal(canonicalFailure.job.status, 'succeeded');

console.log('drawing-tracked-runs.test.js: ok');
