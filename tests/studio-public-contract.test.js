import assert from 'node:assert/strict';

import {
  buildArtifactDetailItems,
  buildArtifactDetailNotes,
} from '../public/js/studio/artifact-insights.js';
import {
  collectGeneratedArtifactGroups,
} from '../public/js/studio/artifacts-workspace.js';
import {
  findStudioExampleById,
  getSelectedStudioExample,
  getStudioExampleValue,
  resolveSelectedStudioExampleId,
  VERIFIED_BRACKET_EXAMPLE_ID,
} from '../public/js/studio/examples.js';
import { toPublicDrawingPreviewPayload } from '../src/server/public-drawing-preview.js';

const examples = [
  {
    id: 'ks_bracket',
    name: 'ks_bracket.toml',
    content: 'name = "ks_bracket"',
    path: '/Users/tester/Documents/freecad-automation/configs/examples/ks_bracket.toml',
  },
  {
    id: 'controller_housing',
    name: 'controller_housing.toml',
    content: 'name = "controller_housing"',
    path: '/Users/tester/Documents/freecad-automation/configs/examples/controller_housing.toml',
  },
  {
    id: 'quality_pass_bracket',
    name: 'quality_pass_bracket.toml',
    content: 'name = "quality_pass_bracket"',
    path: '/Users/tester/Documents/freecad-automation/configs/examples/quality_pass_bracket.toml',
  },
];

assert.equal(VERIFIED_BRACKET_EXAMPLE_ID, 'quality_pass_bracket');
assert.equal(getStudioExampleValue(examples[0]), 'ks_bracket');
assert.equal(resolveSelectedStudioExampleId(examples, 'controller_housing'), 'controller_housing');
assert.equal(resolveSelectedStudioExampleId(examples, 'missing-example'), 'ks_bracket');
assert.equal(findStudioExampleById(examples, VERIFIED_BRACKET_EXAMPLE_ID)?.name, 'quality_pass_bracket.toml');
assert.equal(
  getSelectedStudioExample({
    items: examples,
    selectedId: 'controller_housing',
  })?.name,
  'controller_housing.toml'
);
assert.equal(resolveSelectedStudioExampleId(examples, '/Users/tester/Documents/freecad-automation/configs/examples/controller_housing.toml'), 'ks_bracket');

const activeJob = {
  summary: {
    request: {
      source_label: 'Effective config copy',
    },
  },
  manifest: {
    warnings: [
      'Manifest warning one',
      'Manifest warning two',
    ],
  },
};

const artifact = {
  id: 'artifact-effective-config',
  key: 'effective_config',
  type: 'config.effective',
  file_name: 'effective-config.json',
  extension: '.json',
  content_type: 'application/json',
  exists: true,
  size_bytes: 4096,
  scope: 'user-facing',
  stability: 'stable',
  capabilities: {
    can_open: true,
    can_download: true,
    browser_safe: true,
  },
  links: {
    open: '/artifacts/job-1/artifact-effective-config',
    download: '/artifacts/job-1/artifact-effective-config/download',
  },
  path: '/Users/tester/Documents/freecad-automation/output/jobs/job-1/artifacts/effective-config.json',
};

const detailItems = buildArtifactDetailItems(artifact, activeJob);
const detailMap = Object.fromEntries(detailItems.map((item) => [item.label, item]));

assert.equal(detailMap['File name'].value, 'effective-config.json');
assert.equal(detailMap['Content type'].value, 'application/json');
assert.equal(detailMap['Exists / size'].value, 'Available • 4.0 KB');
assert.equal(detailMap['Scope / stability'].value, 'user-facing • stable');
assert.equal(detailMap['Open route'].value, 'Available');
assert.equal(detailMap['Download route'].value, 'Available');
assert.equal(detailMap['Tracked source'].value, 'Effective config copy');
assert.equal(detailItems.some((item) => item.label === 'Path'), false);
assert.equal(JSON.stringify(detailItems).includes('/Users/'), false);
assert.equal(JSON.stringify(detailItems).includes('effective-config.json'), true);

const detailNotes = buildArtifactDetailNotes(artifact, activeJob);
assert.deepEqual(detailNotes, [
  'Artifact ID: artifact-effective-config',
  'Tracked source label: Effective config copy',
  'Manifest warning one',
  'Manifest warning two',
]);
assert.equal(JSON.stringify(detailNotes).includes('/Users/'), false);

function makeGeneratedArtifact({
  id,
  key,
  type,
  fileName,
  extension,
  canOpen = true,
  canDownload = true,
  exists = true,
}) {
  return {
    id,
    key,
    type,
    file_name: fileName,
    extension,
    content_type: extension === '.json' ? 'application/json' : 'application/octet-stream',
    exists,
    capabilities: {
      can_open: canOpen,
      can_download: canDownload,
    },
    links: {
      open: `/artifacts/job-1/${id}`,
      download: `/artifacts/job-1/${id}/download`,
    },
  };
}

const generatedGroups = collectGeneratedArtifactGroups([
  makeGeneratedArtifact({
    id: 'step-model',
    key: 'step',
    type: 'model.step',
    fileName: 'quality_pass_bracket.step',
    extension: '.step',
  }),
  makeGeneratedArtifact({
    id: 'stl-mesh',
    key: 'stl',
    type: 'model.stl',
    fileName: 'quality_pass_bracket.stl',
    extension: '.stl',
    canOpen: false,
  }),
  makeGeneratedArtifact({
    id: 'report-pdf',
    key: 'report_pdf',
    type: 'report.pdf',
    fileName: 'quality_pass_bracket_report.pdf',
    extension: '.pdf',
  }),
  makeGeneratedArtifact({
    id: 'report-summary',
    key: 'report_summary_json',
    type: 'report.summary-json',
    fileName: 'quality_pass_bracket_report_summary.json',
    extension: '.json',
  }),
  makeGeneratedArtifact({
    id: 'create-quality',
    key: 'create_quality',
    type: 'model.quality-summary',
    fileName: 'quality_pass_bracket_create_quality.json',
    extension: '.json',
  }),
  makeGeneratedArtifact({
    id: 'drawing-quality',
    key: 'drawing_quality',
    type: 'drawing.quality-summary',
    fileName: 'quality_pass_bracket_drawing_quality.json',
    extension: '.json',
  }),
  makeGeneratedArtifact({
    id: 'manifest',
    key: 'create_manifest',
    type: 'output.manifest.json',
    fileName: 'quality_pass_bracket_manifest.json',
    extension: '.json',
    canDownload: false,
  }),
  makeGeneratedArtifact({
    id: 'missing-step',
    key: 'missing_step',
    type: 'model.step',
    fileName: 'missing.step',
    extension: '.step',
    exists: false,
  }),
]);
const generatedGroupMap = Object.fromEntries(generatedGroups.map((group) => [group.id, group]));
assert.deepEqual(generatedGroupMap['cad-exports'].rows.map((row) => row.label), ['STEP model', 'STL mesh']);
assert.deepEqual(generatedGroupMap.reports.rows.map((row) => row.label), ['PDF report', 'Report summary']);
assert.deepEqual(generatedGroupMap['quality-evidence'].rows.map((row) => row.label), [
  'Create quality JSON',
  'Drawing quality JSON',
  'Manifest',
]);
assert.equal(generatedGroupMap['cad-exports'].rows.find((row) => row.id === 'step').canOpen, true);
assert.equal(generatedGroupMap['cad-exports'].rows.find((row) => row.id === 'stl').canOpen, false);
assert.equal(generatedGroupMap['cad-exports'].rows.find((row) => row.id === 'stl').canDownload, true);
assert.equal(generatedGroupMap['quality-evidence'].rows.find((row) => row.id === 'manifest').canDownload, false);
assert.equal(JSON.stringify(generatedGroups).includes('missing.step'), false);

const sparseGeneratedGroups = collectGeneratedArtifactGroups([
  makeGeneratedArtifact({
    id: 'create-quality-only',
    key: 'create_quality',
    type: 'model.quality-summary',
    fileName: 'partial_create_quality.json',
    extension: '.json',
    canOpen: false,
  }),
]);
assert.equal(sparseGeneratedGroups.find((group) => group.id === 'cad-exports').rows.length, 0);
assert.equal(sparseGeneratedGroups.find((group) => group.id === 'reports').rows.length, 0);
assert.equal(sparseGeneratedGroups.find((group) => group.id === 'quality-evidence').rows[0].label, 'Create quality JSON');
assert.equal(sparseGeneratedGroups.find((group) => group.id === 'quality-evidence').rows[0].canOpen, false);

const previewPayload = toPublicDrawingPreviewPayload({
  preview: {
    id: 'preview-1',
    drawn_at: '2026-03-28T12:00:00.000Z',
    overview: {
      name: 'demo-sheet',
      scale: '1:2',
      notes: 'Generated from /tmp/demo-sheet_plan.toml',
    },
    scale: '1:2',
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><!-- /tmp/demo-sheet_plan.toml --><text x="10" y="10">/tmp/demo-sheet_plan.toml</text></svg>',
    bom: [],
    annotations: ['Edited from /tmp/demo-sheet_plan.toml'],
    qa_summary: { score: 92 },
    dimensions: [
      {
        id: 'WIDTH',
        value_mm: 42,
        feature: 'body_width',
        required: true,
      },
    ],
    logs: ['Saved editable plan to /tmp/demo-sheet_plan.toml before rendering.'],
    plan_path: '/tmp/demo-sheet_plan.toml',
    artifacts: {
      plan_toml: '/tmp/demo-sheet_plan.toml',
      dimension_map: '/tmp/demo-sheet_dimension_map.json',
      working_dir: '/tmp/preview-workdir',
    },
    run_log: {
      path: '/tmp/demo-sheet_run_log.json',
    },
  },
});

assert.equal(previewPayload.preview.preview_reference, 'drawing-preview:preview-1');
assert.equal(previewPayload.preview.editable_plan_reference, 'preview-plan:preview-1');
assert.equal(previewPayload.preview.editable_plan_available, true);
assert.equal(previewPayload.preview.dimension_editing_available, true);
assert.equal(previewPayload.preview.tracked_draw_bridge_available, true);
assert.equal(previewPayload.preview.artifact_capabilities.editable_plan, true);
assert.equal(previewPayload.preview.artifact_capabilities.dimension_map, true);
assert.equal('plan_path' in previewPayload.preview, false);
assert.equal('artifacts' in previewPayload.preview, false);
assert.equal('logs' in previewPayload.preview, false);
assert.equal('run_log' in previewPayload.preview, false);
assert.equal(previewPayload.preview.svg.includes('/tmp/demo-sheet_plan.toml'), false);
assert.equal(previewPayload.preview.overview.notes.includes('/tmp/demo-sheet_plan.toml'), false);
assert.equal(previewPayload.preview.annotations[0].includes('/tmp/demo-sheet_plan.toml'), false);

console.log('studio-public-contract.test.js: ok');
