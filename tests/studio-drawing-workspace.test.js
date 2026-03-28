import assert from 'node:assert/strict';

import {
  buildDrawingCanvasCaption,
  buildDrawingPreviewReadySummary,
  buildDrawingPreviewResultSummary,
} from '../public/js/studio/drawing-preview-copy.js';

const preview = {
  id: 'preview-1',
  preview_reference: 'drawing-preview:preview-1',
  drawn_at: '2026-03-28T12:01:00.000Z',
  editable_plan_available: true,
  bom: [
    { id: 'body', count: 1 },
  ],
  dimensions: [
    { id: 'WIDTH', value_mm: 45 },
  ],
  scale: '1:2',
  plan_path: '/tmp/demo-sheet_plan.toml',
};

const caption = buildDrawingCanvasCaption(preview);
assert.match(caption, /Preview reference: drawing-preview:preview-1/);
assert.match(caption, /Edit loop: Editable preview available/);
assert.equal(caption.includes('/tmp/demo-sheet_plan.toml'), false);

const summary = buildDrawingPreviewReadySummary(preview, { scale: 'auto' });
assert.match(summary, /Preview: Ready/);
assert.match(summary, /Preview reference: drawing-preview:preview-1/);
assert.match(summary, /Updated: 2026-03-28 12:01 UTC/);
assert.equal(summary.includes('/tmp/demo-sheet_plan.toml'), false);

const resultSummary = buildDrawingPreviewResultSummary(preview, { scale: 'auto' });
assert.match(resultSummary, /Preview ID: preview-1/);
assert.match(resultSummary, /Preview reference: drawing-preview:preview-1/);
assert.match(resultSummary, /BOM lines: 1/);
assert.match(resultSummary, /Editable dimensions: 1/);
assert.equal(resultSummary.includes('/tmp/demo-sheet_plan.toml'), false);

console.log('studio-drawing-workspace.test.js: ok');
