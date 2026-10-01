import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse } from 'smol-toml';
import { createJobExecutor } from '../src/services/jobs/job-executor.js';
import { createJobStore } from '../src/services/jobs/job-store.js';

const ROOT = resolve(import.meta.dirname, '..');
await mkdir(join(ROOT, 'tmp'), { recursive: true });
const temp = await mkdtemp(join(ROOT, 'tmp/drawing-report-test-'));
try {
  const ambient = join(temp, 'ambient');
  await mkdir(ambient);
  const config = parse(await readFile(join(ROOT, 'configs/examples/quality_pass_bracket.toml'), 'utf8'));
  config.export.directory = ambient;
  config.drawing.scale = '1:2';
  config.drawing.views = ['front', 'top'];
  config.drawing_plan.views.enabled = ['front', 'top'];
  config.drawing_plan.dim_intents.find((dim) => dim.id === 'HOLE_LEFT_DIA').value_mm = 8;
  await writeFile(join(ambient, 'quality_pass_bracket_drawing.svg'), '<svg>STALE AMBIENT DRAWING</svg>');
  await writeFile(join(ambient, 'quality_pass_bracket_create_quality.json'), JSON.stringify({ status: 'pass' }));
  await writeFile(join(ambient, 'quality_pass_bracket_drawing_quality.json'), JSON.stringify({ status: 'pass', score: 100 }));
  const store = createJobStore({ jobsDir: join(temp, 'jobs') });
  let drawCalls = 0;
  let reportInput;
  const executor = createJobExecutor({
    projectRoot: ROOT, jobStore: store,
    generateDrawing: async ({ config: drawn }) => {
      drawCalls += 1;
      assert.equal(drawn.drawing_plan.dim_intents.find((dim) => dim.id === 'HOLE_LEFT_DIA').value_mm, 8);
      assert.equal(drawn.drawing.scale, '1:2');
      assert.deepEqual(drawn.drawing.views, ['front', 'top']);
      const svg = join(drawn.export.directory, 'quality_pass_bracket_drawing.svg');
      await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210"><rect x="10" y="10" width="90" height="60" fill="none" stroke="black"/><text x="20" y="90">8.0 mm</text></svg>');
      return { success: true, drawing_paths: [{ format: 'svg', path: svg }], views: drawn.drawing.views, scale: '1:2' };
    },
    generateReport: async (input) => {
      reportInput = input;
      const path = join(input.outputDir, 'quality_pass_bracket_report.pdf');
      await writeFile(path, '%PDF-1.4\nfixture\n');
      return { success: true, path };
    },
  });
  const queued = await store.createJob({ type: 'report', config, options: {
    report_options: { include_drawing: true }, include_dfm: false,
    studio: { preview_plan: { preserved: true } },
  } });
  await executor.execute(queued.id);
  const completed = await store.getJob(queued.id);
  assert.equal(completed.status, 'succeeded', completed.error?.message);
  assert.equal(drawCalls, 1, 'Drawing report must generate from its edited plan instead of ambient files');
  assert.equal(reportInput.drawingResult.scale, '1:2');
  assert.equal(reportInput.includeDrawing, true);
  assert.deepEqual(completed.result.seeded_artifacts, {}, 'unbound ambient quality must not enter a Drawing report');
  const artifacts = await store.listArtifacts(queued.id);
  for (const type of ['report.pdf', 'drawing.svg', 'drawing.quality-summary', 'draw.plan.toml', 'draw.traceability']) {
    assert.ok(artifacts.some((artifact) => artifact.type === type && artifact.exists), `missing ${type}`);
  }
  assert.ok(!artifacts.some((artifact) => artifact.type === 'model.quality-summary'));
  const svg = artifacts.find((artifact) => artifact.type === 'drawing.svg');
  assert.match(await readFile(svg.path, 'utf8'), /8\.0 mm/);
  assert.ok(!JSON.stringify(completed.result).includes('STALE AMBIENT'));

  const ordinary = await store.createJob({ type: 'report', config, options: { include_drawing: true, include_dfm: false } });
  await executor.execute(ordinary.id);
  assert.equal((await store.getJob(ordinary.id)).status, 'succeeded');
  assert.equal(drawCalls, 1, 'ordinary report behavior must not gain a drawing generation step');
  assert.equal(reportInput.drawingResult, null);
} finally {
  await rm(temp, { recursive: true, force: true });
}
console.log('job-executor-drawing-report.test.js: ok');
