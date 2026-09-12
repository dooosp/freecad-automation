import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { parse as parseTOML, stringify as stringifyTOML } from 'smol-toml';

import { compileDrawingPlan } from '../src/orchestration/drawing-prep.js';
import { createLocalApiJobCoordinator } from '../src/server/local-api-job-operations.js';
import { toPublicDrawingPreviewPayload } from '../src/server/public-drawing-preview.js';
import { createStudioDrawingService } from '../src/server/studio-drawing-service.js';
import { translateStudioJobSubmission } from '../src/server/studio-job-bridge.js';

const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-studio-drawing-service-'));

function createFakeDrawingService() {
  return async function generateDrawing({ config }) {
    const outputDir = config.export.directory;
    const currentValue = config.drawing_plan?.dim_intents?.find((entry) => entry.id === 'WIDTH')?.value_mm ?? 42;
    const svgPath = join(outputDir, `${config.name}_drawing.svg`);
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 297">',
      `  <!-- ${svgPath} -->`,
      `  <text data-dim-id="WIDTH" data-value-mm="${currentValue}" x="40" y="40">${currentValue}</text>`,
      '</svg>',
    ].join('\n');
    writeFileSync(svgPath, svg, 'utf8');
    return {
      success: true,
      svgContent: svg,
      drawing_paths: [
        { format: 'svg', path: svgPath, size_bytes: svg.length },
      ],
      bom: [
        { id: 'body', material: 'AL6061', count: 1 },
      ],
      views: config.drawing.views,
      scale: config.drawing.scale || 'auto',
      qa: { score: 88, weightProfile: 'default' },
      dimension_map: {
        summary: {
          plan_dimension_count: 1,
          plan_rendered_count: 1,
          auto_dimension_count: 0,
        },
      },
      dim_conflicts: {
        summary: { count: 0 },
        conflicts: [],
      },
    };
  };
}

try {
  const configToml = readFileSync(new URL('../configs/examples/ks_bracket.toml', import.meta.url), 'utf8');
  const service = createStudioDrawingService({
    projectRoot: process.cwd(),
    generateDrawing: createFakeDrawingService(),
    compileDrawingPlanFn({ config }) {
      config.drawing_plan = {
        notes: {
          general: ['Machine all sharp edges before release.'],
        },
        dim_intents: [
          {
            id: 'WIDTH',
            value_mm: 42,
            feature: 'body_width',
            required: true,
          },
        ],
      };
      return { applied: true, partType: 'bracket' };
    },
  });

  const first = await service.buildPreview({
    configToml,
    drawingSettings: {
      views: ['front', 'right'],
      scale: '1:2',
      section_assist: true,
    },
  });

  assert.equal(first.preview.overview.scale, '1:2');
  assert.deepEqual(first.preview.views, ['front', 'right']);
  assert.equal(first.preview.qa_summary.score, 88);
  assert.equal(first.preview.dimensions.length, 1);
  assert.equal(first.preview.dimensions[0].id, 'WIDTH');
  assert.equal(first.preview.dimensions[0].value_mm, 42);
  assert.equal(first.preview.annotations.includes('Machine all sharp edges before release.'), true);
  assert.match(first.preview.plan_path, /_plan\.toml$/);
  const publicFirst = toPublicDrawingPreviewPayload(first);
  assert.equal(publicFirst.preview.preview_reference, `drawing-preview:${first.preview.id}`);
  assert.equal(publicFirst.preview.editable_plan_reference, `preview-plan:${first.preview.id}`);
  assert.equal('plan_path' in publicFirst.preview, false);
  assert.equal('artifacts' in publicFirst.preview, false);
  assert.equal(publicFirst.preview.svg.includes(first.preview.plan_path), false);
  assert.equal(publicFirst.preview.svg.includes(first.preview.artifacts.drawing), false);

  const trackedBeforeUpdate = await service.getTrackedDrawPlan({
    previewId: first.preview.id,
    configToml,
  });
  assert.equal(trackedBeforeUpdate.reason, 'preserved');
  assert.equal(trackedBeforeUpdate.drawingPlan.dim_intents[0].value_mm, 42);

  const updated = await service.updateDimension({
    previewId: first.preview.id,
    dimId: 'WIDTH',
    valueMm: 45,
  });

  assert.equal(updated.update.dim_id, 'WIDTH');
  assert.equal(updated.update.old_value, 42);
  assert.equal(updated.update.new_value, 45);
  assert.equal(updated.preview.dimensions[0].value_mm, 45);
  assert.match(updated.preview.svg, /data-value-mm="45"/);
  const publicUpdated = toPublicDrawingPreviewPayload(updated);
  assert.equal(publicUpdated.preview.editable_plan_reference, `preview-plan:${updated.preview.id}`);
  assert.equal('plan_path' in publicUpdated.preview, false);
  assert.equal(publicUpdated.preview.svg.includes(updated.preview.plan_path), false);

  const trackedAfterUpdate = await service.getTrackedDrawPlan({
    previewId: first.preview.id,
    configToml,
  });
  assert.equal(trackedAfterUpdate.reason, 'preserved');
  assert.equal(trackedAfterUpdate.drawingPlan.dim_intents[0].value_mm, 45);

  await service.dispose();
  console.log('studio-drawing-service.test.js: ok');
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

// Keep compilation, TOML persistence, editing, and tracked translation real.
// Only the external FreeCAD renderer is replaced in these focused regressions.
const bracketConfig = parseTOML(readFileSync(new URL('../configs/examples/ks_bracket.toml', import.meta.url), 'utf8'));

function parityService(t, overrides = {}) {
  const service = createStudioDrawingService({
    projectRoot: process.cwd(),
    generateDrawing: createFakeDrawingService(),
    ...overrides,
  });
  t.after(() => service.dispose());
  return service;
}

function partialConfigToml() {
  const config = structuredClone(bracketConfig);
  config.drawing_plan = { notes: { general: ['Preserve this explicit plan note.'] } };
  return stringifyTOML(config);
}

function fullConfigToml() {
  const config = parseTOML(partialConfigToml());
  compileDrawingPlan({ projectRoot: process.cwd(), config });
  return stringifyTOML(config);
}

test('partial plans receive compiled editable dimensions without losing explicit notes', async (t) => {
  const service = parityService(t);
  const { preview } = await service.buildPreview({ configToml: partialConfigToml() });
  assert.equal(preview.dimensions.length, 8);
  assert.equal(preview.dimensions.find((dim) => dim.id === 'WIDTH').value_mm, 120);
  assert.ok(preview.annotations.includes('Preserve this explicit plan note.'));
  assert.equal(toPublicDrawingPreviewPayload({ preview }).preview.editable_plan_available, true);
});

test('edited full plans survive actual TOML loading and the tracked job coordinator', async (t) => {
  const service = parityService(t);
  const configToml = fullConfigToml();
  const first = await service.buildPreview({ configToml });
  const edited = await service.updateDimension({ previewId: first.preview.id, dimId: 'WIDTH', valueMm: 150 });
  assert.equal(edited.preview.dimensions.find((dim) => dim.id === 'WIDTH').value_mm, 150);
  const coordinator = createLocalApiJobCoordinator({ studioDrawingService: service });
  const body = await coordinator.prepareStudioJobBody({
    type: 'draw', config_toml: configToml, drawing_preview_id: first.preview.id,
    drawing_settings: { views: ['front', 'top', 'right'], scale: '1:2' },
  });
  assert.equal(body.options.studio.preview_plan.preserved, true);
  assert.equal(body.options.studio.preview_plan.reason, 'preserved');
  const translated = await translateStudioJobSubmission(body);
  assert.equal(translated.ok, true, translated.errors?.join('\n'));
  compileDrawingPlan({ projectRoot: process.cwd(), config: translated.request.config });
  assert.equal(translated.request.config.drawing_plan.dim_intents.find((dim) => dim.id === 'WIDTH').value_mm, 150);
  const missing = await coordinator.prepareStudioJobBody({ type: 'draw', config_toml: configToml, drawing_preview_id: 'expired' });
  assert.deepEqual(missing.options.studio.preview_plan, { requested: true, preserved: false, reason: 'preview_not_found' });
  const changed = await coordinator.prepareStudioJobBody({ type: 'draw', config_toml: `${configToml}\n# changed`, drawing_preview_id: first.preview.id });
  assert.equal(changed.options.studio.preview_plan.reason, 'config_changed');
  assert.equal(changed.options.studio.preview_plan.preserved, false);
});

test('explicit Studio views and scale survive tracked recompilation as in preview', async (t) => {
  const service = parityService(t);
  const config = parseTOML(fullConfigToml());
  config.drawing.views = ['front', 'top'];
  config.drawing_plan.views.enabled = ['front', 'top', 'right', 'iso'];
  const configToml = stringifyTOML(config);
  const drawingSettings = { views: ['front', 'top', 'right'], scale: '1:2' };
  const { preview } = await service.buildPreview({ configToml, drawingSettings });
  const savedPlan = parseTOML(readFileSync(preview.plan_path, 'utf8')).drawing_plan;
  assert.deepEqual(savedPlan.views.enabled, drawingSettings.views);
  const translated = await translateStudioJobSubmission({ type: 'draw', config_toml: configToml, drawing_settings: drawingSettings });
  compileDrawingPlan({ projectRoot: process.cwd(), config: translated.request.config });
  assert.deepEqual(translated.request.config.drawing.views, preview.views);
  assert.deepEqual(translated.request.config.drawing_plan.views.enabled, drawingSettings.views);
  assert.equal(translated.request.config.drawing.scale, preview.settings.scale);
  const noSettings = await translateStudioJobSubmission({ type: 'draw', config_toml: configToml });
  compileDrawingPlan({ projectRoot: process.cwd(), config: noSettings.request.config });
  assert.deepEqual(noSettings.request.config.drawing.views, ['front', 'top', 'right', 'iso']);
});

test('QA summary reads the actual generator telemetry field names', async (t) => {
  const service = parityService(t, {
    generateDrawing: async (args) => ({
      ...await createFakeDrawingService()(args),
      dimension_map: { summary: { plan_count: 8, rendered_plan_count: 5, auto_count: 3 } },
    }),
  });
  const { preview } = await service.buildPreview({ configToml: fullConfigToml() });
  assert.equal(preview.qa_summary.planned_dimension_count, 8);
  assert.equal(preview.qa_summary.rendered_dimension_count, 5);
  assert.equal(preview.qa_summary.auto_dimension_count, 3);
});

test('an existing plan file without numeric editable intents does not advertise editing', () => {
  for (const dimensions of [[], [{ id: 'NOTE' }], [{ id: 'ZERO', value_mm: 0 }], [{ id: 'BAD', value_mm: Infinity }], [{ value_mm: 1 }]]) {
    const { preview } = toPublicDrawingPreviewPayload({ preview: { id: 'notes', plan_path: '/tmp/notes_plan.toml', dimensions } });
    assert.equal(preview.editable_plan_available, false);
    assert.equal(preview.dimension_editing_available, false);
    assert.equal(preview.editable_plan_reference, '');
    assert.equal(preview.artifact_capabilities.editable_plan, false);
  }
});

test('QA counts all generated dimensions and separates info notices from unresolved conflicts', async (t) => {
  const telemetry = {
    dimension_map: { summary: { auto_count: 10, plan_count: 7, rendered_plan_count: 1, conflict_count: 7 } },
    dim_conflicts: {
      summary: { count: 7 },
      conflicts: [
        ...Array.from({ length: 4 }, () => ({ category: 'dedupe', reason: 'plan_dim_skipped_due_to_auto_match', severity: 'info' })),
        ...Array.from({ length: 3 }, () => ({ category: 'overall_width', reason: 'cross_view_redundant', severity: 'info' })),
      ],
    },
  };
  const service = parityService(t, {
    generateDrawing: async (args) => ({ ...await createFakeDrawingService()(args), ...telemetry }),
  });
  const configToml = fullConfigToml();
  const { preview } = await service.buildPreview({ configToml });
  assert.equal(preview.qa_summary.rendered_dimension_count, 1, 'retain the plan-only legacy field');
  assert.equal(preview.qa_summary.total_rendered_dimension_count, 11);
  assert.equal(preview.qa_summary.informational_conflict_count, 7);
  assert.equal(preview.qa_summary.conflict_count, 0);
  telemetry.dim_conflicts.conflicts.push({ severity: 'warning', reason: 'cell_bottom_limit' });
  telemetry.dim_conflicts.summary.count = 9;
  const withWarning = await service.buildPreview({ configToml });
  assert.equal(withWarning.preview.qa_summary.conflict_count, 2, 'keep listed warning and unexplained summary conflict');
  telemetry.dim_conflicts.summary.count = 0;
  const staleSummary = await service.buildPreview({ configToml });
  assert.equal(staleSummary.preview.qa_summary.conflict_count, 1, 'stale count must not hide a warning');
  telemetry.dimension_map.summary.auto_count = undefined;
  const missingTelemetry = await service.buildPreview({ configToml });
  assert.equal(missingTelemetry.preview.qa_summary.total_rendered_dimension_count, null, 'unknown auto count is not zero');
});
