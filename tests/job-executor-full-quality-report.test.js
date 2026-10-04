import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createJobExecutor, validateJobRequest } from '../src/services/jobs/job-executor.js';
import { createJobStore } from '../src/services/jobs/job-store.js';
import { generateCreateQualityArtifact } from '../src/services/model/create-quality-service.js';
import { createReportService } from '../src/services/report/report-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const NAME = 'full_quality_report';
const model = {
  valid_shape: true, volume: 1000, area: 600, solid_count: 1, face_count: 6, edge_count: 12,
  bounding_box: { min: [0, 0, 0], max: [10, 10, 10], size: [10, 10, 10] },
};

test('full_quality is a boolean option accepted only for report jobs', () => {
  for (const value of ['true', 1, null, [], {}]) {
    const validation = validateJobRequest({ type: 'report', config: {}, options: { full_quality: value } });
    assert.equal(validation.ok, false, `reject ${JSON.stringify(value)}`);
    assert.match(validation.errors.join(' '), /full_quality.*boolean/);
  }
  for (const type of ['create', 'draw', 'inspect']) {
    const source = type === 'inspect' ? { file_path: 'output/model.step' } : { config: {} };
    for (const full_quality of [true, false]) {
      const validation = validateJobRequest({ type, ...source, options: { full_quality } });
      assert.equal(validation.ok, false, `reject full_quality for ${type}`);
      assert.match(validation.errors.join(' '), /full_quality.*report/);
    }
  }
  for (const full_quality of [true, false]) {
    const validation = validateJobRequest({ type: 'report', config: {}, options: { full_quality } });
    assert.equal(validation.ok, true, validation.errors.join(' '));
  }
});

async function runReport(t, { invalidShape = false, createFailure = false, runtimeAvailable = true, formats, fullQuality = true, pathInput = false, unsafeHole = false } = {}) {
  await mkdir(join(ROOT, 'tmp'), { recursive: true });
  const temp = await mkdtemp(join(ROOT, 'tmp/full-quality-report-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const ambient = join(temp, 'ambient');
  await mkdir(ambient);
  const config = {
    name: NAME, shapes: [{ id: 'body', type: 'box', length: 10, width: 10, height: 10 }],
    manufacturing: { process: 'machining', material: 'AL6061' },
    drawing: { views: ['front'], scale: '1:2' },
    ...(formats ? { export: { directory: ambient, formats } } : {}),
  };
  if (unsafeHole) {
    config.shapes.push({ id: 'hole', type: 'cylinder', radius: 1, height: 12, position: [1.5, 1.5, -1] });
    config.operations = [{ op: 'cut', base: 'body', tool: 'hole', result: 'body' }];
  }
  const original = structuredClone(config);
  for (const [file, value] of [
    [`${NAME}_create_quality.json`, { status: 'fail', blocking_issues: ['STALE AMBIENT QUALITY'] }],
    [`${NAME}_drawing_quality.json`, { status: 'fail', score: 0 }],
  ]) await writeFile(join(ambient, file), JSON.stringify(value));
  await writeFile(join(ambient, `${NAME}.step`), 'STALE AMBIENT MODEL');
  const configPath = join(temp, 'source.json');
  await writeFile(configPath, JSON.stringify(config));
  const calls = [];
  let createConfig;
  let drawingConfig;
  let reportInput;
  const runtime = async (script, input) => {
    calls.push(script);
    if (script === 'create_model.py') {
      createConfig = structuredClone(input);
      if (createFailure) return { success: false, error: 'fixture create execution failed' };
      if (pathInput) await writeFile(configPath, JSON.stringify({ ...config, shapes: [{ id: 'body', type: 'box', length: 999, width: 10, height: 10 }] }));
      const exports = [];
      for (const format of input.export.formats) {
        const path = join(input.export.directory, `${NAME}.${format}`);
        await writeFile(path, `CURRENT ${format}`);
        exports.push({ format, path, size_bytes: (await readFile(path)).length });
      }
      return { success: true, model: { ...model, valid_shape: !invalidShape }, exports };
    }
    if (script === 'inspect_model.py') return {
      success: true,
      model: input.file.endsWith('.stl')
        ? { triangle_count: 12, points: 8, watertight_or_closed: true, bbox: model.bounding_box }
        : model,
    };
    if (script === 'engineering_report.py') {
      reportInput = input;
      const path = join(input._report_output_dir, `${NAME}_report.pdf`);
      await writeFile(path, '%PDF-1.4\nfixture renderer boundary\n');
      return { success: true, path };
    }
    throw new Error(`Unexpected native script: ${script}`);
  };
  const store = createJobStore({ jobsDir: join(temp, 'jobs') });
  const realReport = createReportService();
  const executor = createJobExecutor({
    projectRoot: ROOT, jobStore: store, runScriptFn: runtime,
    generateCreateQuality: (input) => generateCreateQualityArtifact({ ...input, runtimeAvailable }),
    generateDrawing: async ({ config: drawn }) => {
      calls.push('drawing');
      drawingConfig = structuredClone(drawn);
      const path = join(drawn.export.directory, `${NAME}_drawing.svg`);
      await writeFile(path, '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210"><rect x="20" y="20" width="50" height="50" fill="none" stroke="black"/></svg>');
      return { success: true, drawing_paths: [{ format: 'svg', path }], views: ['front'], scale: '1:2' };
    },
    generateReport: (input) => realReport({ ...input, runScript: runtime }),
  });
  const queued = await store.createJob({
    type: 'report', ...(pathInput ? { config_path: configPath } : { config }),
    options: {
      full_quality: fullQuality, include_dfm: false, include_drawing: false,
      analysis_results: { dfm: unsafeHole
        ? { status: 'pass', score: 100, checks: [], summary: { errors: 0, warnings: 0 } }
        : { status: 'fail', score: -999, checks: [], summary: { error: 99 } } },
    },
  });
  await executor.execute(queued.id);
  assert.deepEqual(config, original, 'caller config must remain unchanged');
  return { job: await store.getJob(queued.id), artifacts: await store.listArtifacts(queued.id), calls, createConfig, drawingConfig, reportInput };
}

test('full report creates and reimports exports, ignores ambient evidence and supplied DFM, and publishes one manifest', async (t) => {
  const result = await runReport(t, { formats: ['brep'], pathInput: true });
  assert.equal(result.job.status, 'succeeded', result.job.error?.message);
  assert.ok(result.job.result.create_result, 'full report must run create before report');
  assert.equal(result.job.result.create_result.create_quality.status, 'pass');
  assert.deepEqual(result.createConfig.export.formats, ['brep', 'step', 'stl']);
  assert.equal(result.drawingConfig.shapes[0].length, 10, 'drawing must use captured config even if source changes');
  assert.equal(result.reportInput.shapes[0].length, 10);
  assert.deepEqual(result.job.result.seeded_artifacts, {});
  assert.equal(result.reportInput._report_options.include_dfm, true);
  assert.equal(result.reportInput._report_options.include_drawing, true);
  assert.equal(result.reportInput.dfm_results.score, 100, 'real DFM replaces caller-supplied stale analysis');
  assert.equal(result.job.result.report_summary.surfaces.create_quality.status, 'pass');
  assert.ok(!JSON.stringify(result.job.result).includes('STALE AMBIENT'));
  assert.ok(result.calls.indexOf('create_model.py') < result.calls.indexOf('drawing'));
  assert.ok(result.calls.indexOf('drawing') < result.calls.indexOf('engineering_report.py'));
  for (const type of ['model.step', 'model.stl', 'model.brep', 'model.create-quality', 'drawing.svg', 'drawing.quality-summary', 'report.pdf', 'report.summary-json']) {
    const matches = result.artifacts.filter((artifact) => artifact.type === type);
    assert.equal(matches.length, 1, `one ${type} entry`);
    assert.equal(matches[0].exists, true);
  }
  const keys = result.artifacts.map((artifact) => `${artifact.type}:${artifact.path}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('full report adds STEP and STL when the captured config has no export block', async (t) => {
  const result = await runReport(t);
  assert.equal(result.job.status, 'succeeded', result.job.error?.message);
  assert.ok(result.createConfig, 'full report must create a model');
  assert.deepEqual(result.createConfig.export.formats, ['step', 'stl']);
  assert.equal(result.job.result.create_result.create_quality.step_roundtrip.reimport_valid, true);
  assert.equal(result.job.result.create_result.create_quality.stl_quality.triangle_count, 12);
});

test('create quality failure remains a failed quality decision while PDF execution succeeds', async (t) => {
  const result = await runReport(t, { invalidShape: true });
  assert.equal(result.job.status, 'succeeded', result.job.error?.message);
  assert.ok(result.job.result.create_result, 'full report must include create evidence');
  assert.equal(result.job.result.create_result.create_quality.status, 'fail');
  assert.equal(result.job.result.report_summary.overall_status, 'fail');
  assert.equal(result.job.result.report_summary.ready_for_manufacturing_review, false);
  assert.ok(result.artifacts.some((artifact) => artifact.type === 'report.pdf' && artifact.exists));
});

test('fresh DFM failures override caller-supplied passing analysis in full mode', async (t) => {
  const result = await runReport(t, { unsafeHole: true });
  assert.equal(result.job.status, 'succeeded', result.job.error?.message);
  assert.ok(result.reportInput.dfm_results.checks.some((check) => check.rule_id === 'DFM-02' && check.status === 'fail'));
  assert.ok(result.reportInput.dfm_results.score < 100);
  assert.equal(result.job.result.report_summary.surfaces.dfm.status, 'fail');
  assert.equal(result.job.result.report_summary.overall_status, 'fail');
  assert.equal(result.job.result.report_summary.ready_for_manufacturing_review, false);
});

test('unavailable reimport evidence remains skipped in full report quality', async (t) => {
  const result = await runReport(t, { runtimeAvailable: false });
  assert.equal(result.job.status, 'succeeded', result.job.error?.message);
  assert.ok(result.job.result.create_result, 'full report must include create evidence');
  assert.equal(result.job.result.create_result.create_quality.status, 'skipped');
  assert.equal(result.job.result.report_summary.surfaces.create_quality.status, 'skipped');
  assert.notEqual(result.job.result.report_summary.overall_status, 'pass');
});

test('create execution failure stops drawing and prevents a successful PDF report', async (t) => {
  const result = await runReport(t, { createFailure: true });
  assert.equal(result.job.status, 'failed');
  assert.match(result.job.error.message, /create execution failed/);
  assert.deepEqual(result.calls, ['create_model.py']);
  assert.ok(!result.artifacts.some((artifact) => artifact.type === 'report.pdf'));
});

test('ordinary report retains its existing explicit-analysis and no-create behavior', async (t) => {
  const result = await runReport(t, { fullQuality: false });
  assert.equal(result.job.status, 'succeeded', result.job.error?.message);
  assert.equal(result.job.result.create_result, undefined);
  assert.equal(result.job.result.drawing_result, undefined);
  assert.deepEqual(result.calls, ['engineering_report.py']);
  assert.equal(result.reportInput._analysis_results.dfm.score, -999);
});
