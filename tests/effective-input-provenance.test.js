import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { loadConfigWithDiagnostics } from '../lib/config-schema.js';
import { deepMerge } from '../lib/config-loader.js';
import { buildOutputManifest } from '../lib/output-manifest.js';
import { compileDrawingPlan, ensureDrawSchema, ensureDrawingViews } from '../src/orchestration/drawing-prep.js';
import { runDrawPipeline } from '../src/orchestration/draw-pipeline.js';
import { createDrawingService } from '../src/services/drawing/drawing-service.js';
import { createReportEvidenceFixture } from './helpers/report-evidence-fixture.js';

async function source(role, path) {
  const bytes = await readFile(path);
  return { role, path, sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length };
}

test('pipeline records override authorship and preserves the exact generator input for QA', async () => {
  const f = await createReportEvidenceFixture();
  try {
    const overridePath = join(f.directory, 'pipeline-override.json');
    await f.writeJson(overridePath, { name: 'part', shapes: [{ ...f.rawConfig.shapes[0], height: 10 }] });
    let runtimeInput;
    const result = await runDrawPipeline({
      projectRoot: f.root, configPath: f.configPath, overridePath,
      flags: ['--bom', '--raw', '--no-score'], weightsPresetValue: 'bracket',
      loadConfig: async (path) => (await loadConfigWithDiagnostics(path)).config,
      loadConfigSnapshot: loadConfigWithDiagnostics, deepMerge,
      generateDrawing: createDrawingService(),
      runScript: async (script, input) => {
        assert.equal(script, 'generate_drawing.py'); runtimeInput = structuredClone(input);
        return { success: true, drawing_paths: [{ format: 'svg', path: f.paths.svg }], views: input.drawing.views, scale: '1:1' };
      },
    });
    const effective = await f.readJson(join(f.directory, 'part_effective_config.json'));
    assert.deepEqual(effective, runtimeInput, 'QA effective config must be the exact runtime snapshot');
    assert.equal(result.effective_input.recipe.kind, 'draw-pipeline-v1');
    assert.equal(result.effective_input.recipe.weights_preset, 'bracket');
    assert.equal(result.effective_input.recipe.plan_status, 'applied');
    assert.equal(result.effective_input.sources.find((record) => record.role === 'override')?.sha256, (await source('override', overridePath)).sha256);
    const authored = await f.readJson(result.authored_config_path);
    assert.equal(authored.shapes[0].height, 10);
    assert.equal(authored.drawing_plan, undefined, 'generated plan must not enter authored expectations');
    assert.equal(effective.standard, 'KS');
  } finally { await f.cleanup(); }
});

test('unscored drawing API preset keeps readiness unknown and rejects later preset changes', async () => {
  const f = await effectiveFixture();
  try {
    const presets = join(f.directory, 'configs/overrides/presets');
    await mkdir(presets, { recursive: true });
    const presetPath = join(presets, 'tall.toml');
    await writeFile(presetPath, 'name = "part"\n[[shapes]]\nid = "plate"\ntype = "box"\nlength = 40\nwidth = 20\nheight = 10\n');
    const result = await createDrawingService()({
      freecadRoot: f.directory, configPath: f.configPath, preset: 'tall',
      loadConfigSnapshot: loadConfigWithDiagnostics, deepMerge, postprocess: false, qa: false,
      runScript: async () => ({ success: true, drawing_paths: [{ format: 'svg', path: f.paths.svg }] }),
    });
    const manifest = await buildOutputManifest({
      projectRoot: f.root, command: 'draw', commandArgs: [f.configPath], inputPath: f.configPath,
      effectiveInput: result.effective_input,
      outputs: [
        { path: f.paths.drawing, kind: 'drawing.quality-json' }, { path: f.paths.svg, kind: 'drawing.svg' },
        { path: f.paths.semantics, kind: 'drawing.extracted-semantics-json' },
        { path: result.authored_config_path, kind: 'drawing.authored-config-json' },
        { path: result.effective_config_path, kind: 'drawing.effective-config-json' },
      ], status: 'pass', runtimeDiagnostics: { available: true },
    });
    await f.writeJson(f.paths.drawingManifest, manifest);
    const accepted = await f.report({ configPath: f.reportPath, config: f.reportConfig });
    assert.equal(accepted.summary.overall_status, 'incomplete');
    assert(accepted.summary.surfaces.drawing_quality.evidence_provenance.reason_codes.includes('producer-qa-not-run'));
    assert.equal(accepted.summary.surfaces.drawing_quality.evidence_provenance.effective_input.recipe.preset, 'tall');
    await writeFile(presetPath, 'name = "different"\n');
    const rejected = await f.report({ configPath: f.reportPath, config: f.reportConfig });
    assert.equal(rejected.summary.overall_status, 'fail');
    assert(rejected.summary.surfaces.drawing_quality.evidence_provenance.reason_codes.includes('side-input-content-mismatch'));
  } finally { await f.cleanup(); }
});

async function effectiveFixture() {
  const f = await createReportEvidenceFixture();
  f.paths.authored = join(f.directory, 'part_authored_config.json');
  f.paths.runtime = join(f.directory, 'part_effective_config.json');
  f.paths.createEffective = join(f.directory, 'part_create_effective_config.json');
  f.overridePath = join(f.directory, 'override.json');
  await f.writeJson(f.overridePath, { name: 'part', shapes: [{ ...f.rawConfig.shapes[0], height: 10 }] });
  f.reportPath = join(f.directory, 'merged.json');
  const authored = structuredClone(f.config); authored.shapes[0].height = 10;
  await f.writeJson(f.reportPath, authored);
  f.reportConfig = (await loadConfigWithDiagnostics(f.reportPath)).config;
  await f.writeJson(f.paths.authored, f.reportConfig);
  await f.writeJson(f.paths.createEffective, f.reportConfig);
  const runtime = structuredClone(f.reportConfig);
  ensureDrawSchema(runtime); runtime.drawing.bom_csv = true; ensureDrawingViews(runtime);
  compileDrawingPlan({ projectRoot: f.root, config: runtime });
  runtime.standard = 'KS';
  await f.writeJson(f.paths.runtime, runtime);
  const drawSources = [await source('config', f.configPath), await source('override', f.overridePath), await source('compiler', join(f.root, 'scripts/intent_compiler.py')), await source('qa-scorer', join(f.root, 'scripts/qa_scorer.py')), await source('postprocess', join(f.root, 'scripts/postprocess_svg.py'))];
  const templatePath = join(f.root, 'configs/templates', `${runtime.drawing_plan.part_type}.toml`);
  if (existsSync(templatePath)) drawSources.push(await source('template', templatePath));
  const createSources = [await source('config', f.reportPath)];
  const drawingManifest = await buildOutputManifest({
    projectRoot: f.root, command: 'draw', commandArgs: [f.configPath, '--override', f.overridePath, '--bom', '--weights-preset', 'bracket'],
    inputRecord: (await loadConfigWithDiagnostics(f.configPath)).input_record,
    inputPath: f.configPath,
    outputs: [
      { path: f.paths.drawing, kind: 'drawing.quality-json' }, { path: f.paths.svg, kind: 'drawing.svg' },
      { path: f.paths.semantics, kind: 'drawing.extracted-semantics-json' },
      { path: f.paths.authored, kind: 'drawing.authored-config-json' }, { path: f.paths.runtime, kind: 'drawing.effective-config-json' },
    ],
    effectiveInput: {
      schema_version: '1.0', authored_config_kind: 'drawing.authored-config-json', runtime_config_kind: 'drawing.effective-config-json',
      sources: drawSources,
      recipe: { kind: 'draw-pipeline-v1', bom: true, no_plan: false, plan_status: 'applied', standard: 'KS', weights_preset: 'bracket', raw: false, no_score: false, fail_under: null, override: true, unsupported_flags: [], working_directory: f.root },
    }, status: 'pass', runtimeDiagnostics: { available: true },
  });
  const createManifest = await buildOutputManifest({
    projectRoot: f.root, command: 'create', commandArgs: [f.reportPath], inputPath: f.reportPath,
    inputRecord: (await loadConfigWithDiagnostics(f.reportPath)).input_record,
    outputs: [{ path: f.paths.create, kind: 'model.create-quality-json' }, { path: f.paths.createEffective, kind: 'model.effective-config-json' }],
    effectiveInput: { schema_version: '1.0', authored_config_kind: 'model.effective-config-json', runtime_config_kind: 'model.effective-config-json', sources: createSources, recipe: { kind: 'create-v1' } },
    status: 'pass', runtimeDiagnostics: { available: true },
  });
  await f.writeJson(f.paths.drawingManifest, drawingManifest);
  await f.writeJson(f.paths.createManifest, createManifest);
  return f;
}

async function effectiveApiFixture() {
  const f = await effectiveFixture();
  const runtime = structuredClone(f.reportConfig);
  runtime.standard = 'KS';
  runtime.drawing ||= {};
  await f.writeJson(f.paths.runtime, runtime);
  const manifest = await f.readJson(f.paths.drawingManifest);
  const runtimeRecord = await source('runtime', f.paths.runtime);
  Object.assign(manifest.outputs.find((entry) => entry.kind === 'drawing.effective-config-json'), { sha256: runtimeRecord.sha256, size_bytes: runtimeRecord.size_bytes });
  manifest.input = (await loadConfigWithDiagnostics(f.reportPath)).input_record;
  manifest.command_args = [f.reportPath];
  manifest.effective_input.sources = [await source('config', f.reportPath), await source('qa-scorer', join(f.root, 'scripts/qa_scorer.py')), await source('postprocess', join(f.root, 'scripts/postprocess_svg.py'))];
  manifest.effective_input.recipe = { kind: 'draw-service-v1', standard: 'KS', dxf_export: false, preset: null, weights_preset: 'bracket', qa: true, postprocess: true };
  await f.writeJson(f.paths.drawingManifest, manifest);
  return f;
}

for (const [name, mutate, expectedStatus, reason] of [
  ['complete API recipe binds declared QA and postprocessing receipts', () => {}, 'pass', null],
  ['API required receipts cannot be erased by omitting their recipe flags', (manifest) => {
    manifest.effective_input.sources = manifest.effective_input.sources.filter((entry) => !['qa-scorer', 'postprocess'].includes(entry.role));
    delete manifest.effective_input.recipe.qa;
    delete manifest.effective_input.recipe.postprocess;
  }, 'incomplete', 'effective-proof-unsupported'],
  ['API false-like nonboolean QA flag is not evidence of disabled QA', (manifest) => {
    manifest.effective_input.recipe.qa = 0;
    manifest.effective_input.sources = manifest.effective_input.sources.filter((entry) => entry.role !== 'qa-scorer');
  }, 'incomplete', 'effective-proof-unsupported'],
  ['API null postprocess flag cannot erase a required script receipt', (manifest) => {
    manifest.effective_input.recipe.postprocess = null;
    manifest.effective_input.sources = manifest.effective_input.sources.filter((entry) => entry.role !== 'postprocess');
  }, 'incomplete', 'effective-proof-unsupported'],
  ['API extra override argument is unaccounted producer input', (manifest) => {
    manifest.command_args.push('--override', 'not-attested.json');
  }, 'incomplete', 'producer-arguments-unverified'],
  ['API extra weights option cannot bypass the serialized argument contract', (manifest) => {
    manifest.command_args.push('--weights-preset', 'bracket');
  }, 'incomplete', 'producer-arguments-unverified'],
  ['API positional input must identify the consumed source receipt', (manifest, f) => {
    manifest.command_args = [f.configPath];
  }, 'incomplete', 'producer-arguments-unverified'],
  ['complete API false postprocess flag does not require a postprocessor receipt', (manifest) => {
    manifest.effective_input.recipe.postprocess = false;
    manifest.effective_input.sources = manifest.effective_input.sources.filter((entry) => entry.role !== 'postprocess');
  }, 'pass', null],
  ['explicit API QA false keeps readiness unknown despite a scored quality JSON', (manifest) => {
    manifest.effective_input.recipe.qa = false;
    manifest.effective_input.recipe.postprocess = false;
    manifest.effective_input.sources = manifest.effective_input.sources.filter((entry) => !['qa-scorer', 'postprocess'].includes(entry.role));
  }, 'incomplete', 'producer-qa-not-run'],
]) {
  test(name, async () => {
    const f = await effectiveApiFixture();
    try {
      const manifest = await f.readJson(f.paths.drawingManifest);
      mutate(manifest, f);
      await f.writeJson(f.paths.drawingManifest, manifest);
      const { summary, pdfSummary } = await f.report({ configPath: f.reportPath, config: f.reportConfig });
      assert.equal(summary.overall_status, expectedStatus);
      assert.equal(summary.ready_for_manufacturing_review, expectedStatus === 'pass');
      assert.equal(pdfSummary.overall_status, expectedStatus);
      if (reason) assert(summary.surfaces.drawing_quality.evidence_provenance.reason_codes.includes(reason), reason);
    } finally { await f.cleanup(); }
  });
}

for (const [name, mutate, status, reason] of [
  ['merged report10 accepts create10 and draw base8+override10+weights preset', async () => {}, 'pass', null],
  ['relative override is resolved using the recorded producer working directory', async (f) => {
    const manifest = await f.readJson(f.paths.drawingManifest);
    manifest.command_args[2] = 'override.json';
    manifest.effective_input.recipe.working_directory = f.directory;
    await f.writeJson(f.paths.drawingManifest, manifest);
  }, 'pass', null],
  ['report8 cannot be silently transformed by producer override10', async (f) => { f.reportPath = f.configPath; f.reportConfig = f.config; }, 'fail', 'effective-config-mismatch'],
  ['changed override bytes reject previous effective evidence', async (f) => { await f.writeJson(f.overridePath, { shapes: [{ ...f.rawConfig.shapes[0], height: 12 }] }); }, 'fail', 'side-input-content-mismatch'],
  ['missing override bytes remain unknown', async (f) => { await rm(f.overridePath); }, 'incomplete', 'side-input-unreadable'],
  ['create8 evidence cannot authorize merged report10', async (f) => {
    const manifest = await f.readJson(f.paths.createManifest);
    await f.writeJson(f.paths.createEffective, f.config);
    const receipt = await source('runtime', f.paths.createEffective);
    Object.assign(manifest.outputs.find((record) => record.kind === 'model.effective-config-json'), { sha256: receipt.sha256, size_bytes: receipt.size_bytes });
    manifest.input = (await loadConfigWithDiagnostics(f.configPath)).input_record;
    manifest.effective_input.sources = [await source('config', f.configPath)];
    await f.writeJson(f.paths.createManifest, manifest);
  }, 'fail', 'effective-config-mismatch'],
  ['recorded create source8 cannot authorize a hash-valid effective10 snapshot', async (f) => {
    const manifest = await f.readJson(f.paths.createManifest);
    manifest.input = (await loadConfigWithDiagnostics(f.configPath)).input_record;
    manifest.effective_input.sources = [await source('config', f.configPath)];
    await f.writeJson(f.paths.createManifest, manifest);
  }, 'fail', 'source-effective-config-mismatch'],
  ['recorded override12 cannot authorize a hash-valid authored10 snapshot', async (f) => {
    await f.writeJson(f.overridePath, { name: 'part', shapes: [{ ...f.rawConfig.shapes[0], height: 12 }] });
    const manifest = await f.readJson(f.paths.drawingManifest);
    manifest.effective_input.sources = await Promise.all(manifest.effective_input.sources.map((entry) => entry.role === 'override' ? source('override', f.overridePath) : entry));
    await f.writeJson(f.paths.drawingManifest, manifest);
  }, 'fail', 'source-effective-config-mismatch'],
  ['missing compiler receipt cannot attest a compiled drawing', async (f) => {
    const manifest = await f.readJson(f.paths.drawingManifest);
    manifest.effective_input.sources = manifest.effective_input.sources.filter((entry) => entry.role !== 'compiler');
    await f.writeJson(f.paths.drawingManifest, manifest);
  }, 'incomplete', 'effective-source-proof-missing'],
  ['missing QA preset implementation receipt cannot attest a scored drawing', async (f) => {
    const manifest = await f.readJson(f.paths.drawingManifest);
    manifest.effective_input.sources = manifest.effective_input.sources.filter((entry) => entry.role !== 'qa-scorer');
    await f.writeJson(f.paths.drawingManifest, manifest);
  }, 'incomplete', 'effective-source-proof-missing'],
  ['CLI no-score cannot reuse a passing quality sidecar as current QA evidence', async (f) => {
    const manifest = await f.readJson(f.paths.drawingManifest);
    manifest.effective_input.recipe.no_score = true;
    manifest.effective_input.recipe.raw = true;
    manifest.command_args.push('--no-score', '--raw');
    manifest.effective_input.sources = manifest.effective_input.sources.filter((entry) => !['qa-scorer', 'postprocess'].includes(entry.role));
    await f.writeJson(f.paths.drawingManifest, manifest);
  }, 'incomplete', 'producer-qa-not-run'],
  ['missing postprocessor receipt cannot attest repaired drawing content', async (f) => {
    const manifest = await f.readJson(f.paths.drawingManifest);
    manifest.effective_input.sources = manifest.effective_input.sources.filter((entry) => entry.role !== 'postprocess');
    await f.writeJson(f.paths.drawingManifest, manifest);
  }, 'incomplete', 'effective-source-proof-missing'],
  ['malformed effective source collection remains readable unknown', async (f) => {
    const manifest = await f.readJson(f.paths.drawingManifest); manifest.effective_input.sources = {};
    await f.writeJson(f.paths.drawingManifest, manifest);
  }, 'incomplete', 'effective-proof-unsupported'],
  ['malformed effective source entry remains readable unknown', async (f) => {
    const manifest = await f.readJson(f.paths.drawingManifest); manifest.effective_input.sources = [null];
    await f.writeJson(f.paths.drawingManifest, manifest);
  }, 'incomplete', 'effective-proof-unsupported'],
  ['tampered authored snapshot cannot authorize readiness', async (f) => { await f.writeJson(f.paths.authored, f.config); }, 'fail', 'output-content-mismatch'],
  ['tampered runtime snapshot cannot authorize readiness', async (f) => { await f.writeJson(f.paths.runtime, f.config); }, 'fail', 'output-content-mismatch'],
  ['hash-valid runtime contradicting authored derivation still fails', async (f) => {
    const runtime = await f.readJson(f.paths.runtime); runtime.shapes[0].height = 12;
    await f.writeJson(f.paths.runtime, runtime);
    const manifest = await f.readJson(f.paths.drawingManifest);
    const receipt = await source('runtime', f.paths.runtime);
    Object.assign(manifest.outputs.find((record) => record.kind === 'drawing.effective-config-json'), { sha256: receipt.sha256, size_bytes: receipt.size_bytes });
    await f.writeJson(f.paths.drawingManifest, manifest);
  }, 'fail', 'effective-derivation-mismatch'],
  ['legacy modifier without effective proof remains unknown', async (f) => {
    const manifest = await f.readJson(f.paths.drawingManifest); delete manifest.effective_input;
    // Use the same raw report input to isolate missing modifier proof from stale input.
    manifest.input = (await loadConfigWithDiagnostics(f.reportPath)).input_record;
    await f.writeJson(f.paths.drawingManifest, manifest);
  }, 'incomplete', 'producer-arguments-unverified'],
  ['copied effective files validate against producer output digests', async (f) => {
    for (const key of ['drawingManifest', 'createManifest']) {
      const manifest = await f.readJson(f.paths[key]);
      for (const record of manifest.outputs) record.path = join(f.directory, 'producer-original', record.kind);
      await f.writeJson(f.paths[key], manifest);
    }
  }, 'pass', null],
]) {
  test(name, async () => {
    const f = await effectiveFixture();
    try {
      await mutate(f);
      const { summary, pdfSummary } = await f.report({ configPath: f.reportPath, config: f.reportConfig });
      assert.equal(summary.overall_status, status);
      assert.equal(summary.ready_for_manufacturing_review, status === 'pass');
      assert.equal(pdfSummary.overall_status, status);
      if (reason) assert([summary.surfaces.create_quality, summary.surfaces.drawing_quality].some((surface) => surface.evidence_provenance.reason_codes.includes(reason)), reason);
    } finally { await f.cleanup(); }
  });
}
