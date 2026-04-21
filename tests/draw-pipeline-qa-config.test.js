import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { runDrawPipeline } from '../src/orchestration/draw-pipeline.js';

const TEST_FILE = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(TEST_FILE);
const PROJECT_ROOT = dirname(TEST_DIR);

const tempRoot = mkdtempSync(join(tmpdir(), 'fcad-draw-qa-'));

try {
  const outputDir = join(tempRoot, 'output');
  mkdirSync(outputDir, { recursive: true });

  const configPath = join(tempRoot, 'qa_dfm_bridge.json');
  const svgPath = join(outputDir, 'qa_dfm_bridge_drawing.svg');

  const config = {
    name: 'qa_dfm_bridge',
    manufacturing: {
      process: 'machining',
      material: 'aluminum',
    },
    shapes: [
      { id: 'body', type: 'box', size: [20, 20, 5], position: [0, 0, 0] },
      { id: 'hole1', type: 'cylinder', diameter: 10, height: 5, position: [8, 10, 0] },
    ],
    operations: [
      { op: 'cut', base: 'body', tool: 'hole1' },
    ],
    drawing: {
      views: ['front', 'top', 'right', 'iso'],
    },
    drawing_plan: {
      part_type: 'bracket',
      views: { enabled: ['front', 'top', 'right', 'iso'] },
      dimensioning: { qa_weight_preset: 'bracket' },
      dim_intents: [],
    },
    export: {
      directory: outputDir,
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  writeFileSync(
    svgPath,
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="297" viewBox="0 0 420 297">',
      '  <g class="geometry-front"><rect x="25" y="30" width="70" height="40" /></g>',
      '  <g class="dimensions-front"><text x="40" y="160">10</text></g>',
      '  <g class="general-notes"><text x="20" y="230">MACHINED PART</text></g>',
      '</svg>',
    ].join('\n'),
    'utf8'
  );

  const result = await runDrawPipeline({
    projectRoot: PROJECT_ROOT,
    configPath,
    flags: ['--raw', '--no-plan'],
    loadConfig: async () => structuredClone(config),
    deepMerge: (target, source) => Object.assign(target, source),
    generateDrawing: async () => ({
      success: true,
      drawing_paths: [
        {
          format: 'svg',
          path: svgPath,
          size_bytes: readFileSync(svgPath).length,
        },
      ],
      views: ['front', 'top', 'right', 'iso'],
      scale: '1:1',
      layout_report: { summary: { view_count: 4 } },
      dimension_map: { auto_dimensions: [], plan_dimensions: [], summary: {} },
      dim_conflicts: { conflicts: [], summary: { count: 0 } },
      traceability: {
        schema_version: '0.1',
        model_name: 'qa_dfm_bridge',
        features: [],
        dimensions: [],
        links: [],
        summary: {
          feature_count: 0,
          dimension_count: 0,
          linked_dimensions: 0,
          unresolved_dimensions: [],
        },
      },
    }),
    runScript: async () => {
      throw new Error('runScript should not be called in this test');
    },
  });

  assert.equal(result.success, true);

  const qaJsonPath = svgPath.replace('.svg', '_qa.json');
  const drawingQualityPath = svgPath.replace('.svg', '_quality.json');
  const extractedSemanticsPath = join(outputDir, 'qa_dfm_bridge_extracted_drawing_semantics.json');
  const runLogPath = join(outputDir, 'qa_dfm_bridge_run_log.json');
  assert.equal(existsSync(qaJsonPath), true);
  assert.equal(existsSync(drawingQualityPath), true);
  assert.equal(existsSync(extractedSemanticsPath), true);
  assert.equal(existsSync(runLogPath), true);

  const qaReport = JSON.parse(readFileSync(qaJsonPath, 'utf8'));
  assert.equal(qaReport.metrics.dfm_error_count, 0);
  assert.equal(qaReport.metrics.dfm_warning_count, 1);

  const drawingQuality = JSON.parse(readFileSync(drawingQualityPath, 'utf8'));
  assert.equal(drawingQuality.command, 'draw');
  assert.equal(drawingQuality.drawing_svg, svgPath);
  assert.equal(drawingQuality.qa_file, qaJsonPath);
  assert.equal(drawingQuality.status, 'pass');
  assert.equal(drawingQuality.extracted_drawing_semantics_file, extractedSemanticsPath);
  assert.equal(drawingQuality.semantic_quality.extracted_evidence.status, 'available');

  const runLog = JSON.parse(readFileSync(runLogPath, 'utf8'));
  assert.equal(existsSync(runLog.artifacts.effective_config), true);
  assert.equal(runLog.artifacts.drawing_quality, drawingQualityPath);
  assert.equal(runLog.artifacts.extracted_drawing_semantics, extractedSemanticsPath);

  const effectiveConfig = JSON.parse(readFileSync(runLog.artifacts.effective_config, 'utf8'));
  assert.equal(effectiveConfig.manufacturing.process, 'machining');
  assert.equal(effectiveConfig.operations[0].op, 'cut');

  const strictOutputDir = join(tempRoot, 'strict-output');
  mkdirSync(strictOutputDir, { recursive: true });
  const strictSvgPath = join(strictOutputDir, 'qa_dfm_bridge_strict_drawing.svg');
  writeFileSync(strictSvgPath, readFileSync(svgPath, 'utf8'), 'utf8');

  await assert.rejects(
    runDrawPipeline({
      projectRoot: PROJECT_ROOT,
      configPath,
      flags: ['--raw', '--no-plan'],
      strictQuality: true,
      loadConfig: async () => ({
        ...structuredClone(config),
        name: 'qa_dfm_bridge_strict',
        export: { directory: strictOutputDir },
      }),
      deepMerge: (target, source) => Object.assign(target, source),
      generateDrawing: async () => ({
        success: true,
        drawing_paths: [
          {
            format: 'svg',
            path: strictSvgPath,
            size_bytes: readFileSync(strictSvgPath).length,
          },
        ],
        views: ['front', 'top', 'right', 'iso'],
        scale: '1:1',
        layout_report: { summary: { view_count: 4, overflow_views: ['front'], all_within_limits: false } },
        dimension_map: { auto_dimensions: [], plan_dimensions: [], summary: {} },
        dim_conflicts: { conflicts: [], summary: { count: 0 } },
        traceability: {
          schema_version: '0.1',
          model_name: 'qa_dfm_bridge_strict',
          features: [],
          dimensions: [],
          links: [],
          summary: {
            feature_count: 0,
            dimension_count: 0,
            linked_dimensions: 0,
            unresolved_dimensions: [],
          },
        },
      }),
      runScript: async () => {
        throw new Error('runScript should not be called in strict test');
      },
    }),
    /Strict drawing quality gate failed/
  );

  console.log('draw-pipeline-qa-config.test.js: ok');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
