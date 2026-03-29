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

console.log('drawing-tracked-runs.test.js: ok');
