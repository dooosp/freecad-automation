import assert from 'node:assert/strict';

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

console.log('result-files.test.js: ok');
