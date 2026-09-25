import assert from 'node:assert/strict';
import { renderResultSummary } from '../public/js/studio/artifacts-workspace.js';
import { getLocale, setLocale } from '../public/js/i18n/index.js';
import { installDrawingTestDom } from './helpers/drawing-test-dom.js';

import {
  collectResultFileGroups,
  deriveResultFileAction,
  resultFileLabelKey,
  selectPrimaryResultArtifact,
} from '../public/js/studio/result-files.js';

function artifact({
  id,
  type,
  fileName,
  extension,
  canOpen = true,
  canDownload = true,
  exists = true,
  open = `/jobs/job-1/artifacts/${id}`,
  download = `/jobs/job-1/artifacts/${id}/download`,
  path = `/private/output/${fileName}`,
}) {
  return {
    id,
    key: id,
    type,
    file_name: fileName,
    extension,
    exists,
    path,
    capabilities: {
      can_open: canOpen,
      can_download: canDownload,
    },
    links: {
      open,
      download,
    },
  };
}

const report = artifact({
  id: 'report-pdf',
  type: 'report.pdf',
  fileName: 'bracket_report.pdf',
  extension: '.pdf',
});
const quality = artifact({
  id: 'quality',
  type: 'model.quality-summary',
  fileName: 'bracket_create_quality.json',
  extension: '.json',
});
const step = artifact({
  id: 'step',
  type: 'model.step',
  fileName: 'bracket.step',
  extension: '.step',
});
const manifest = artifact({
  id: 'manifest',
  type: 'output.manifest.json',
  fileName: 'bracket_manifest.json',
  extension: '.json',
});

const groups = collectResultFileGroups([manifest, step, quality, report]);
assert.deepEqual(groups.map((group) => group.id), [
  'immediate',
  'quality',
  'technical',
  'system',
]);
assert.deepEqual(groups.map((group) => group.artifacts.map((entry) => entry.id)), [
  ['report-pdf'],
  ['quality'],
  ['step'],
  ['manifest'],
]);
assert.equal(selectPrimaryResultArtifact([manifest, step, quality, report])?.id, 'report-pdf');
assert.equal(selectPrimaryResultArtifact([manifest, step, quality], { jobType: 'create' })?.id, 'step');
const drawing = artifact({
  id: 'drawing',
  type: 'drawing.svg',
  fileName: 'bracket_drawing.svg',
  extension: '.svg',
});
const drawingQuality = artifact({
  id: 'drawing-quality',
  type: 'drawing.quality-summary',
  fileName: 'bracket_drawing_quality.json',
  extension: '.json',
});
assert.equal(selectPrimaryResultArtifact([drawingQuality, drawing], { jobType: 'draw' })?.id, 'drawing');
assert.equal(selectPrimaryResultArtifact([report, quality], { jobType: 'review-context' })?.id, 'quality');
assert.equal(resultFileLabelKey(report), 'studio.artifacts.file.report');
assert.equal(resultFileLabelKey(step), 'studio.artifacts.file.step');
assert.equal(resultFileLabelKey(quality), 'studio.artifacts.file.quality');
assert.equal(resultFileLabelKey(drawingQuality), 'studio.artifacts.file.quality');

assert.deepEqual(deriveResultFileAction(report), {
  kind: 'view',
  href: report.links.open,
  downloadHref: report.links.download,
  openHref: report.links.open,
});

const downloadOnly = artifact({
  id: 'download-only',
  type: 'model.stl',
  fileName: 'bracket.stl',
  extension: '.stl',
  canOpen: false,
});
assert.deepEqual(deriveResultFileAction(downloadOnly), {
  kind: 'download',
  href: downloadOnly.links.download,
  downloadHref: downloadOnly.links.download,
  openHref: '',
});

const blockedBundle = artifact({
  id: 'release-bundle',
  type: 'release-bundle.zip',
  fileName: 'release_bundle.zip',
  extension: '.zip',
  canOpen: false,
  canDownload: false,
});
const blockedAction = deriveResultFileAction(blockedBundle);
assert.deepEqual(blockedAction, {
  kind: 'details',
  href: '',
  downloadHref: '',
  openHref: '',
});
assert.equal(JSON.stringify(blockedAction).includes('/private/output/'), false);

const missingReport = artifact({
  id: 'missing-report',
  type: 'report.pdf',
  fileName: 'missing.pdf',
  extension: '.pdf',
  exists: false,
});
assert.equal(selectPrimaryResultArtifact([missingReport, step])?.id, 'step');

// The real SVG is download-only; its previewable QA JSON must not outrank it.
const drawingSvgDownload = artifact({
  id: 'drawing-svg-0', type: 'drawing.svg',
  fileName: 'usb_hub_surrogate_B_drawing.svg', extension: '.svg', canOpen: false,
});
const drawingQa = artifact({
  id: 'drawing-qa-report', type: 'drawing.qa-report',
  fileName: 'usb_hub_surrogate_B_drawing_qa.json', extension: '.json',
});
const drawingPlan = artifact({
  id: 'drawing-planner', type: 'drawing.planner',
  fileName: 'usb_hub_surrogate_B_drawing_planner.json', extension: '.json',
});
for (const artifacts of [
  [drawingQa, drawingPlan, drawingQuality, drawingSvgDownload],
  [drawingSvgDownload, drawingQuality, drawingPlan, drawingQa],
]) {
  assert.equal(selectPrimaryResultArtifact(artifacts, { jobType: 'draw' }).id, 'drawing-svg-0');
}
assert.equal(collectResultFileGroups([drawingQa]).find((group) => group.id === 'quality').artifacts[0], drawingQa);
assert.equal(resultFileLabelKey(drawingQa), 'studio.artifacts.file.quality');

const qualityNamedDrawing = { ...drawingSvgDownload, file_name: 'quality_pass_bracket_drawing.svg' };
assert.equal(resultFileLabelKey(qualityNamedDrawing), 'studio.artifacts.file.drawing');
assert.equal(collectResultFileGroups([qualityNamedDrawing]).find((group) => group.id === 'immediate').artifacts[0], qualityNamedDrawing);

// Render the same summary used by Packs, including the actual draw result shape.
const restoreDom = installDrawingTestDom();
const previousLocale = getLocale();
try {
  const activeJob = {
    status: 'ready',
    summary: {
      id: 'annotation-only', type: 'draw', status: 'succeeded',
      request: { config: { name: 'usb_hub_surrogate_B' } },
      result: {
        success: true,
        drawing_quality: {
          status: 'fail', score: 89,
          traceability: { coverage_percent: 80, unmapped_required_entities: ['WIDTH'] },
          blocking_issues: [{
            code: 'traceability-coverage',
            message: 'Traceability coverage is 80% and must be at least 95%.',
            details: { unmapped_required_entities: ['WIDTH'] },
          }],
        },
      },
    },
    artifacts: [drawingQa, drawingSvgDownload, drawingQuality],
  };
  for (const [locale, execution, quality, blockerText] of [
    ['en', 'Completed', 'Failed', 'Drawing evidence coverage is 80%'],
    ['ko', '완료', '실패', '도면 근거 연결률이 80%'],
  ]) {
    setLocale(locale, { persist: false });
    const summary = renderResultSummary(activeJob);
    const text = summary.textContent;
    assert.ok(text.includes(execution), text);
    assert.ok(text.includes(quality), text);
    assert.ok(text.includes('WIDTH'), 'The unmapped required dimension must be visible in the summary');
    assert.ok(text.includes(blockerText), text);
    assert.ok(text.includes('usb_hub_surrogate_B_drawing.svg'), text);
    assert.equal(text.includes('usb_hub_surrogate_B_drawing_qa.json'), false);
  }
  activeJob.summary.result.drawing_quality = {
    status: 'pass', score: 89,
    traceability: { coverage_percent: 100, unmapped_required_entities: [] },
    blocking_issues: [],
  };
  const passing = renderResultSummary(activeJob).textContent;
  assert.ok(passing.includes('통과'), passing);
  assert.equal(passing.includes('WIDTH'), false);
  assert.equal(passing.includes('80%'), false);
} finally {
  setLocale(previousLocale, { persist: false });
  restoreDom();
}

console.log('result-files.test.js: ok');
