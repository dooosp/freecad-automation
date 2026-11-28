import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { deepMerge } from '../lib/config-loader.js';
import { loadConfigWithDiagnostics } from '../lib/config-schema.js';
import { createDrawingService } from '../src/services/drawing/drawing-service.js';

async function fixture(t) {
  const controlRoot = resolve(import.meta.dirname, '../tmp/codex');
  await mkdir(controlRoot, { recursive: true });
  const root = await mkdtemp(join(controlRoot, 'drawing-service-effective-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'configs/overrides/presets'), { recursive: true });
  await mkdir(join(root, 'scripts'), { recursive: true });
  await writeFile(join(root, 'scripts/qa_scorer.py'), '# QA dependency fixture\n');
  await writeFile(join(root, 'scripts/postprocess_svg.py'), '# Postprocess dependency fixture\n');
  const configPath = join(root, 'base.json');
  const svgPath = join(root, 'plate_drawing.svg');
  const baseConfig = {
    name: 'plate',
    standard: 'ISO',
    shapes: [{ id: 'plate', type: 'box', length: 40, width: 20, height: 8 }],
    export: { directory: root, formats: ['step'] },
  };
  await writeFile(configPath, JSON.stringify(baseConfig, null, 2));
  const calls = {};
  const generate = createDrawingService({
    toLocalPathFn: (path) => path,
    runQaScorerFn: async (projectRoot, path, options) => {
      calls.qa = { projectRoot, path, options };
      return { score: 96 };
    },
    postprocessSvgFn: async (projectRoot, path, options) => { calls.postprocess = { projectRoot, path, options }; },
  });
  return {
    root, configPath, svgPath, baseConfig, calls,
    async run(options = {}, duringRender = async () => {}) {
      return generate({
        freecadRoot: root, configPath, deepMerge,
        loadConfig: async (path) => (await loadConfigWithDiagnostics(path)).config,
        postprocess: false, qa: false,
        ...options,
        runScript: async (script, input) => {
          assert.equal(script, 'generate_drawing.py');
          calls.runtimeInput = structuredClone(input);
          await duringRender(input);
          await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"/>');
          return { success: true, drawing_paths: [{ format: 'svg', path: svgPath }] };
        },
      });
    },
    async preset(text) {
      const path = join(root, 'configs/overrides/presets/tall.toml');
      await writeFile(path, text);
      return { path, sha256: createHash('sha256').update(text).digest('hex'), size_bytes: Buffer.byteLength(text) };
    },
  };
}

test('authored and runtime drawing snapshots preserve actual payload and caller config', async (t) => {
  const f = await fixture(t);
  const config = structuredClone(f.baseConfig);
  const document = await loadConfigWithDiagnostics(f.configPath);
  const sources = [{ role: 'config', ...document.input_record }];
  const result = await f.run({ config, sourceInputs: sources, dxfExport: true });
  assert.deepEqual(config, f.baseConfig);
  assert.deepEqual(result.authored_config, f.baseConfig);
  assert.deepEqual(result.effective_config, { ...f.baseConfig, standard: 'KS', drawing: { dxf: true } });
  assert.deepEqual(result.effective_config, f.calls.runtimeInput);
  assert.deepEqual(JSON.parse(await readFile(result.effective_config_path, 'utf8')), f.calls.runtimeInput);
  assert.deepEqual(JSON.parse(await readFile(result.authored_config_path, 'utf8')), f.baseConfig);
  assert.deepEqual(result.effective_input.sources, sources);
  sources[0].sha256 = 'changed-by-caller';
  assert.equal(result.effective_input.sources[0].sha256, document.input_record.sha256);
  assert.equal(result.effective_input.recipe.kind, 'draw-service-v1');
  assert.equal(result.effective_input.recipe.standard, 'KS');
  assert.equal(result.effective_input.recipe.dxf_export, true);
  assert.equal(result.effective_input.recipe.preset, null);
  assert.equal(result.effective_input.recipe.postprocess, false);
  assert.equal(result.effective_input.recipe.qa, false);
  assert.equal(Object.hasOwn(f.calls.runtimeInput, 'sourceInputs'), false);
  assert.equal(Object.hasOwn(f.calls.runtimeInput, 'input_record'), false);
});

test('real preset input receipt binds the file used to generate the overridden height', async (t) => {
  const f = await fixture(t);
  const preset = await f.preset([
    'name = "plate"',
    '[[shapes]]', 'id = "plate"', 'type = "box"', 'length = 40', 'width = 20', 'height = 10',
  ].join('\n'));
  const baseDocument = await loadConfigWithDiagnostics(f.configPath);
  const result = await f.run({
    preset: 'tall', loadConfigSnapshot: loadConfigWithDiagnostics,
  }, async () => { await writeFile(preset.path, 'name = "replacement"'); });
  assert.equal(result.authored_config.shapes[0].height, 10);
  assert.equal(result.authored_config.standard, 'ISO');
  assert.equal(result.effective_config.shapes[0].height, 10);
  assert.equal(result.effective_config.standard, 'KS');
  assert.deepEqual(result.effective_config, f.calls.runtimeInput);
  assert.deepEqual(result.effective_input.sources, [
    { role: 'config', ...baseDocument.input_record },
    { role: 'preset', ...preset },
  ]);
  assert.equal(result.effective_input.recipe.preset, 'tall');
});

test('preset standard keeps its precedence over explicit service standard', async (t) => {
  const f = await fixture(t);
  await f.preset('name = "plate"\nstandard = "JIS"\n');
  const result = await f.run({
    config: f.baseConfig, preset: 'tall', standard: 'ASME', loadConfigSnapshot: loadConfigWithDiagnostics,
  });
  assert.equal(f.calls.runtimeInput.standard, 'JIS');
  assert.equal(result.authored_config.standard, 'JIS');
  assert.equal(result.effective_input.recipe.standard, 'JIS');
});

test('QA recipe records the explicit selected weight preset and preserves service options', async (t) => {
  const f = await fixture(t);
  const config = {
    ...f.baseConfig,
    drawing_plan: { dimensioning: { qa_weight_preset: 'auto' }, style: { stroke_profile: 'ks' } },
  };
  const result = await f.run({ config, weightsPreset: 'bracket', standard: 'ISO', postprocess: true, qa: true });
  assert.equal(result.effective_input.recipe.weights_preset, 'bracket');
  assert.equal(result.effective_input.recipe.postprocess, true);
  assert.equal(result.effective_input.recipe.qa, true);
  assert.equal(result.effective_input.recipe.standard, 'ISO');
  assert.equal(f.calls.qa.options.weightsPreset, 'bracket');
  assert.equal(f.calls.qa.options.configPath, result.effective_config_path);
  assert.equal(f.calls.postprocess.options.profile, 'ks');
  assert.deepEqual(result.effective_config, f.calls.runtimeInput);
  for (const [role, filename] of [['qa-scorer', 'qa_scorer.py'], ['postprocess', 'postprocess_svg.py']]) {
    const path = join(f.root, 'scripts', filename);
    const bytes = await readFile(path);
    assert.deepEqual(result.effective_input.sources.find((record) => record.role === role), {
      role, path, sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length,
    });
  }
});

test('missing direct QA or postprocess script is recorded as unverified without blocking legacy execution', async (t) => {
  const f = await fixture(t);
  await rm(join(f.root, 'scripts/qa_scorer.py'));
  await rm(join(f.root, 'scripts/postprocess_svg.py'));
  const result = await f.run({ config: f.baseConfig, postprocess: true, qa: true });
  assert.equal(result.success, true);
  for (const [role, filename] of [['qa-scorer', 'qa_scorer.py'], ['postprocess', 'postprocess_svg.py']]) {
    assert.deepEqual(result.effective_input.sources.find((record) => record.role === role), {
      role, path: join(f.root, 'scripts', filename), sha256: null, size_bytes: null,
    });
  }
});

test('legacy custom config loader remains supported without inventing source receipts', async (t) => {
  const f = await fixture(t);
  const result = await f.run({
    preset: 'custom',
    loadConfig: async (path) => path.endsWith('custom.toml')
      ? { shapes: [{ id: 'plate', type: 'box', length: 40, width: 20, height: 10 }] }
      : structuredClone(f.baseConfig),
  });
  assert.equal(result.effective_config.shapes[0].height, 10);
  assert.equal(result.effective_config.standard, 'KS');
  assert.deepEqual(result.effective_input.sources, []);
  assert.equal(result.effective_input.recipe.preset, 'custom');
});
