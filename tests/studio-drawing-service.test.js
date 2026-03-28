import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createStudioDrawingService } from '../src/server/studio-drawing-service.js';

const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-studio-drawing-service-'));

function createFakeDrawingService() {
  return async function generateDrawing({ config }) {
    const outputDir = config.export.directory;
    const currentValue = config.drawing_plan?.dim_intents?.find((entry) => entry.id === 'WIDTH')?.value_mm ?? 42;
    const svgPath = join(outputDir, `${config.name}_drawing.svg`);
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 297">',
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

  await service.dispose();
  console.log('studio-drawing-service.test.js: ok');
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
