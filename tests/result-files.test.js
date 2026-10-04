import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyResultFilePurpose,
  collectResultFileGroups,
  deriveResultFileAction,
  resultFileLabelKey,
  selectPrimaryResultArtifact,
} from '../public/js/studio/result-files.js';

for (const [type, file_name, extension, purpose, label] of [
  ['config.source', 'quality_pass_bracket.toml', '.toml', 'technical', ''],
  ['config.effective', 'inspection_manifest.json', '.json', 'technical', ''],
  ['model.step', 'quality_pass_bracket.step', '.step', 'technical', 'studio.artifacts.file.step'],
  ['model.stl', 'inspection_report.stl', '.stl', 'technical', 'studio.artifacts.file.stl'],
  ['drawing.svg', 'quality_pass_bracket.svg', '.svg', 'immediate', 'studio.artifacts.file.drawing'],
  ['report.sample', 'sample-report.json', '.json', 'immediate', 'studio.artifacts.file.report'],
  ['report.sample', 'drawing-report.json', '.json', 'immediate', 'studio.artifacts.file.report'],
  ['model.create-quality', 'checks.json', '.json', 'quality', 'studio.artifacts.file.quality'],
  ['output.manifest.json', 'review_quality.json', '.json', 'system', 'studio.artifacts.file.system'],
  ['runtime.fingerprint', 'record.json', '.json', 'system', 'studio.artifacts.file.system'],
]) {
  const file = { type, file_name, extension };
  assert.equal(classifyResultFilePurpose(file), purpose, `${file_name} must follow its contract, not words in its name`);
  assert.equal(resultFileLabelKey(file), label, file_name);
}

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

for (const [type, fileName, purpose, label] of [
  ['drawing.qa-report', 'bracket_drawing_qa.json', 'quality', 'studio.artifacts.file.quality'],
  ['drawing.qa-issues', 'bracket_drawing_qa_issues.json', 'quality', 'studio.artifacts.file.quality'],
  ['', 'legacy_drawing_qa.json', 'quality', 'studio.artifacts.file.quality'],
  ['drawing.extracted-semantics', 'bracket_extracted_drawing_semantics.json', 'technical', ''],
  ['feature-catalog.json', 'bracket_drawing_feature_catalog.json', 'technical', ''],
  ['drawing-intent.json', 'bracket_drawing_intent.json', 'technical', ''],
  ['drawing.planner', 'bracket_drawing_planner.json', 'technical', ''],
  ['drawing.repair-report', 'bracket_drawing_repair_report.json', 'technical', ''],
  ['report.summary-json', 'bracket_report_summary.json', 'quality', 'studio.artifacts.file.quality'],
]) {
  const sidecar = artifact({ id: type || 'legacy-qa', type, fileName, extension: '.json' });
  assert.equal(classifyResultFilePurpose(sidecar), purpose, `${fileName} is supporting evidence, not a rendered drawing`);
  assert.equal(resultFileLabelKey(sidecar), label);
  for (const extension of ['.svg', '.pdf', '.dxf']) {
    const sheet = artifact({
      id: 'sheet', type: `drawing${extension}`, fileName: `bracket${extension}`, extension, canOpen: false,
    });
    assert.equal(selectPrimaryResultArtifact([sidecar, sheet], { jobType: 'draw' })?.id, 'sheet',
      'downloadable drawings must outrank openable JSON sidecars');
  }
}

assert.equal(selectPrimaryResultArtifact([report, quality], { jobType: 'review-context' })?.id, 'quality');
assert.equal(resultFileLabelKey(report), 'studio.artifacts.file.report');
assert.equal(resultFileLabelKey(step), 'studio.artifacts.file.step');
assert.equal(resultFileLabelKey(quality), 'studio.artifacts.file.quality');
assert.equal(resultFileLabelKey(drawingQuality), 'studio.artifacts.file.quality');

assert.deepEqual(deriveResultFileAction(report), {
  kind: 'open',
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

const drawingPdf = artifact({
  id: 'drawing-pdf', type: 'drawing.pdf', fileName: 'bracket_drawing.pdf', extension: '.pdf',
});

test('only the declared drawing PDF type receives the print drawing label', () => {
  assert.equal(resultFileLabelKey(drawingPdf), 'studio.artifacts.file.drawing-pdf');
  assert.equal(classifyResultFilePurpose(drawingPdf), 'immediate');
  assert.equal(resultFileLabelKey({ ...drawingPdf, file_name: 'quality_inspection_report.pdf' }), 'studio.artifacts.file.drawing-pdf');
  for (const type of ['', 'artifact', 'report.pdf', 'drawing.pdf.backup']) {
    assert.equal(resultFileLabelKey({ ...drawingPdf, type, file_name: 'print_drawing.pdf' }), 'studio.artifacts.file.report',
      'A PDF filename must not claim a verified print drawing contract');
  }
  assert.deepEqual(collectResultFileGroups([drawingPdf, quality]).find((group) => group.id === 'immediate').artifacts, [drawingPdf]);
});

test('drawing PDF actions honor public open and download capabilities', () => {
  assert.deepEqual(deriveResultFileAction(drawingPdf), {
    kind: 'open', href: drawingPdf.links.open, openHref: drawingPdf.links.open, downloadHref: drawingPdf.links.download,
  });
  const downloadable = { ...drawingPdf, capabilities: { can_open: false, can_download: true } };
  assert.deepEqual(deriveResultFileAction(downloadable), {
    kind: 'download', href: drawingPdf.links.download, openHref: '', downloadHref: drawingPdf.links.download,
  });
  for (const unavailable of [
    { ...drawingPdf, exists: false },
    { ...drawingPdf, capabilities: { can_open: false, can_download: false } },
  ]) {
    assert.deepEqual(deriveResultFileAction(unavailable), {
      kind: 'details', href: '', openHref: '', downloadHref: '',
    });
  }
});

test('report jobs keep their report PDF primary when a drawing PDF is also present', () => {
  for (const artifacts of [[drawingPdf, report], [report, drawingPdf]]) {
    assert.equal(selectPrimaryResultArtifact(artifacts, { jobType: 'report' })?.id, 'report-pdf');
  }
  const downloadOnlyReport = { ...report, capabilities: { can_open: false, can_download: true } };
  assert.equal(selectPrimaryResultArtifact([drawingPdf, downloadOnlyReport], { jobType: 'report' })?.id, 'report-pdf');
  assert.equal(selectPrimaryResultArtifact([missingReport, drawingPdf], { jobType: 'report' })?.id, 'drawing-pdf');
  assert.equal(selectPrimaryResultArtifact([quality, drawingPdf], { jobType: 'draw' })?.id, 'drawing-pdf');
});
