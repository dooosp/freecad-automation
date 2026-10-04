import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createJobExecutor } from '../src/services/jobs/job-executor.js';
import { createJobStore } from '../src/services/jobs/job-store.js';
import { collectDrawManifestArtifacts, collectReportManifestArtifacts } from '../src/shared/artifact-surface.js';
import { toArtifactResponse } from '../src/server/local-api-artifacts.js';
import { toJobResponse } from '../src/server/local-api-job-response.js';

const ROOT = resolve(import.meta.dirname, '..');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297"><text x="40" y="40">9.0 mm</text></svg>';

async function fixture(t, { failed = false, type = 'draw' } = {}) {
  await mkdir(join(ROOT, 'tmp'), { recursive: true });
  const temporary = await mkdtemp(join(ROOT, 'tmp/drawing-pdf-job-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const store = createJobStore({ jobsDir: join(temporary, 'jobs') });
  let exportCalls = 0;
  let exportedSvg;
  const executor = createJobExecutor({
    projectRoot: ROOT, jobStore: store,
    generateDrawing: async ({ config }) => {
      const path = join(config.export.directory, 'fixture_drawing.svg');
      await writeFile(path, SVG);
      return { success: true, drawing_paths: [{ format: 'svg', path }], views: ['front'], scale: '1:2' };
    },
    exportDrawingPdf: async ({ drawingResult, outputDir }) => {
      exportCalls += 1;
      exportedSvg = await readFile(drawingResult.drawing_paths[0].path, 'utf8');
      assert.ok(drawingResult.drawing_quality, 'PDF must follow final drawing QA/postprocessing');
      if (failed) throw new Error('private runtime failure /Users/private/FreeCAD/python');
      const path = join(outputDir, 'fixture_drawing.pdf');
      await writeFile(path, '%PDF-1.4\nfixture vector exporter boundary\n%%EOF\n');
      return { path, physical_width_mm: 420, physical_height_mm: 297, page_box_tolerance_mm: 0.2, source_svg_sha256: 'a'.repeat(64) };
    },
    generateReport: async ({ outputDir }) => {
      const path = join(outputDir, 'fixture_report.pdf');
      await writeFile(path, '%PDF-1.4\nreport boundary\n%%EOF\n');
      return { success: true, path };
    },
  });
  const job = await store.createJob({ type, config: {
    name: 'fixture', shapes: [{ id: 'body', type: 'box', length: 10, width: 10, height: 10 }],
    drawing: { views: ['front'], scale: '1:2' },
  }, options: type === 'report' ? { studio: { preview_plan: { preserved: true } } } : {} });
  await executor.execute(job.id);
  const completed = await store.getJob(job.id);
  return {
    job: completed, publicJob: await toJobResponse(store, completed), artifacts: await store.listArtifacts(job.id),
    log: await readFile(join(store.getJobDir(job.id), 'job.log'), 'utf8'), exportCalls, exportedSvg,
  };
}

test('tracked drawing publishes a separate print PDF only after final SVG and retains public PDF capabilities', async (t) => {
  const result = await fixture(t);
  assert.equal(result.job.status, 'succeeded', result.job.error?.message);
  assert.equal(result.exportCalls, 1);
  assert.match(result.exportedSvg, /9\.0 mm/);
  assert.equal(result.job.result.drawing_pdf_export.status, 'succeeded');
  assert.deepEqual(result.publicJob.result.drawing_pdf_export, result.job.result.drawing_pdf_export);
  assert.equal(result.job.result.drawing_pdf_export.page_box_tolerance_mm, 0.2);
  const pdfs = result.artifacts.filter((artifact) => artifact.type === 'drawing.pdf');
  assert.equal(pdfs.length, 1);
  assert.equal(pdfs[0].exists, true);
  assert.equal(pdfs[0].file_name, 'fixture_drawing.pdf');
  const publicPdf = toArtifactResponse(result.job.id, pdfs[0]);
  assert.equal(publicPdf.content_type, 'application/pdf');
  assert.equal(publicPdf.capabilities.can_open, true);
  assert.equal(publicPdf.capabilities.can_download, true);
  assert.equal(toArtifactResponse(result.job.id, pdfs[0], { publicPathAllowed: false }).capabilities.can_open, false);
  assert.equal(toArtifactResponse(result.job.id, { ...pdfs[0], scope: 'internal' }).capabilities.can_download, false);
});

test('Drawing report keeps the report PDF and adds its separate print drawing PDF', async (t) => {
  const result = await fixture(t, { type: 'report' });
  assert.equal(result.job.status, 'succeeded', result.job.error?.message);
  assert.equal(result.exportCalls, 1);
  assert.equal(result.job.result.drawing_result.drawing_pdf_export.status, 'succeeded');
  for (const type of ['drawing.svg', 'drawing.pdf', 'report.pdf']) {
    assert.equal(result.artifacts.filter((artifact) => artifact.type === type && artifact.exists).length, 1, type);
  }
});

test('optional print export failure is explicit while drawing and report execution remain successful', async (t) => {
  for (const type of ['draw', 'report']) {
    const result = await fixture(t, { type, failed: true });
    assert.equal(result.job.status, 'succeeded', result.job.error?.message);
    const drawing = type === 'report' ? result.job.result.drawing_result : result.job.result;
    assert.equal(drawing.drawing_pdf_export?.status, 'failed');
    assert.equal(drawing.drawing_pdf_export.code, 'drawing_pdf_export_failed');
    assert.match(drawing.drawing_pdf_export.message, /SVG drawing remains available/);
    assert.ok(!JSON.stringify(drawing.drawing_pdf_export).includes('/Users/'));
    assert.ok(!result.log.includes('private runtime failure'));
    assert.ok(!result.log.includes('/Users/private/FreeCAD/python'));
    assert.match(result.log, /SVG drawing remains available/);
    const publicDrawing = type === 'report' ? result.publicJob.result.drawing_result : result.publicJob.result;
    assert.deepEqual(publicDrawing.drawing_pdf_export, drawing.drawing_pdf_export);
    assert.equal(drawing.drawing_pdf_path, undefined);
    assert.ok(!result.artifacts.some((artifact) => artifact.type === 'drawing.pdf'));
    assert.ok(result.artifacts.some((artifact) => artifact.type === 'drawing.svg' && artifact.exists));
    if (type === 'report') assert.ok(result.artifacts.some((artifact) => artifact.type === 'report.pdf' && artifact.exists));
  }
});

test('artifact collector never guesses a PDF sibling or registers an explicitly failed PDF path', () => {
  const base = { drawing_paths: [{ format: 'svg', path: '/repo/job/bracket_drawing.svg' }] };
  for (const result of [base, { ...base, drawing_pdf_path: '/repo/job/bracket_drawing.pdf' }, {
    ...base, drawing_pdf_path: '/repo/job/bracket_drawing.pdf', drawing_pdf_export: { status: 'failed' },
  }]) {
    assert.ok(!collectDrawManifestArtifacts(result).some((entry) => entry.type === 'drawing.pdf'));
    assert.ok(!collectReportManifestArtifacts({ drawing_result: result }).some((entry) => entry.type === 'drawing.pdf'));
  }
  const result = { ...base, drawing_pdf_path: '/repo/job/bracket_drawing.pdf', drawing_pdf_export: { status: 'succeeded' } };
  assert.equal(collectDrawManifestArtifacts(result).find((entry) => entry.type === 'drawing.pdf')?.path, result.drawing_pdf_path);
});
