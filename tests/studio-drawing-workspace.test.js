import assert from 'node:assert/strict';

import {
  buildDrawingCanvasCaption,
  buildDrawingPreviewReadySummary,
  buildDrawingPreviewResultSummary,
} from '../public/js/studio/drawing-preview-copy.js';
import en from '../public/js/i18n/en.js';
import ko from '../public/js/i18n/ko.js';

const preview = {
  id: 'preview-1',
  preview_reference: 'drawing-preview:preview-1',
  editable_plan_reference: 'preview-plan:preview-1',
  drawn_at: '2026-03-28T12:01:00.000Z',
  editable_plan_available: true,
  bom: [
    { id: 'body', count: 1 },
  ],
  dimensions: [
    { id: 'WIDTH', value_mm: 45 },
  ],
  scale: '1:2',
};

const caption = buildDrawingCanvasCaption(preview);
assert.match(caption, /Preview reference: drawing-preview:preview-1/);
assert.match(caption, /Edit loop source: preview-plan:preview-1/);
assert.match(caption, /Edit loop: Editable preview available/);

const summary = buildDrawingPreviewReadySummary(preview, { scale: 'auto' });
assert.match(summary, /Preview: Ready/);
assert.match(summary, /Preview reference: drawing-preview:preview-1/);
assert.match(summary, /Edit loop source: preview-plan:preview-1/);
assert.match(summary, /Updated: 2026-03-28 12:01 UTC/);

const resultSummary = buildDrawingPreviewResultSummary(preview, { scale: 'auto' });
assert.match(resultSummary, /Preview ID: preview-1/);
assert.match(resultSummary, /Preview reference: drawing-preview:preview-1/);
assert.match(resultSummary, /Edit loop source: preview-plan:preview-1/);
assert.match(resultSummary, /BOM lines: 1/);
assert.match(resultSummary, /Editable dimensions: 1/);

for (const dictionary of [en, ko]) {
  assert.match(dictionary.messages['studio.drawing.report.summary-copy'], /current loaded config|현재 불러온 설정/);
  assert.match(dictionary.messages['studio.drawing.report.summary-copy'], /regenerates its drawing|도면을 다시 생성/);
  assert.match(dictionary.messages['studio.drawing.report.safety'], /not included|포함되지 않습니다/);
  assert.equal(typeof dictionary.messages['studio.drawing.canvas.label'], 'string');
  assert.equal(dictionary.messages['studio.drawing.canvas.label'].length > 0, true);
}

console.log('studio-drawing-workspace.test.js: ok');
