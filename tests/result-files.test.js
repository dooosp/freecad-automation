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

const manufacturingArtifacts = [
  artifact({ id: 'action-dictionary', type: 'manufacturing_action_dictionary', fileName: 'manufacturing_action_dictionary.json', extension: '.json' }),
  artifact({ id: 'episode', type: 'manufacturing_episode_annotation', fileName: 'manufacturing_episode_annotation.json', extension: '.json' }),
  artifact({ id: 'validation', type: 'manufacturing_data_validation_report', fileName: 'manufacturing_data_validation_report.json', extension: '.json' }),
  artifact({ id: 'dataset-manifest', type: 'manufacturing_robotics_dataset_manifest', fileName: 'manufacturing_robotics_dataset_manifest.json', extension: '.json' }),
  artifact({ id: 'handoff-json', type: 'design_manufacturing_quality_handoff', fileName: 'design_manufacturing_quality_handoff.json', extension: '.json' }),
  artifact({ id: 'handoff-markdown', type: 'design_manufacturing_quality_handoff.md', fileName: 'design_manufacturing_quality_handoff.md', extension: '.md' }),
  artifact({ id: 'artifact-manifest', type: 'artifact.manifest', fileName: 'artifact-manifest.json', extension: '.json' }),
  artifact({ id: 'output-manifest', type: 'output.manifest', fileName: 'output-manifest.json', extension: '.json' }),
];
assert.equal(manufacturingArtifacts.length, 8);
assert.equal(
  selectPrimaryResultArtifact(manufacturingArtifacts, { jobType: 'manufacturing-action-dataset' })?.id,
  'dataset-manifest'
);
const manufacturingGroups = Object.fromEntries(
  collectResultFileGroups(manufacturingArtifacts).map((group) => [
    group.id,
    group.artifacts.map((entry) => entry.id),
  ])
);
assert.deepEqual(manufacturingGroups.quality, ['validation', 'handoff-json', 'handoff-markdown']);
assert.deepEqual(manufacturingGroups.technical, ['action-dictionary', 'episode']);
assert.deepEqual(manufacturingGroups.system, ['dataset-manifest', 'artifact-manifest', 'output-manifest']);
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
