import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { createDrawingPdfService } from '../src/services/drawing/drawing-pdf-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 840 594"><path d="M20 20 L220 20"/><text>9.0 mm</text></svg>';
const PDF = '%PDF-1.4\nfixture vector renderer boundary\n%%EOF\n';
const MEASUREMENTS = { success: true, physical_width_mm: 420, physical_height_mm: 297, page_box_tolerance_mm: 0.2 };

async function fixture(t) {
  await mkdir(join(ROOT, 'tmp'), { recursive: true });
  const temporary = await realpath(await mkdtemp(join(ROOT, 'tmp/drawing-pdf-service-')));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const outputDir = join(temporary, 'artifacts');
  await mkdir(outputDir);
  const svgPath = join(outputDir, 'bracket_drawing.svg');
  await writeFile(svgPath, SVG);
  return { temporary, outputDir, svgPath, input: { projectRoot: ROOT, outputDir, drawingResult: { success: true, drawing_paths: [{ format: 'svg', path: svgPath }] } } };
}

function service(runPythonJsonScriptFn) {
  return createDrawingPdfService({
    getFreeCADRuntimeFn: () => ({ pythonExecutable: '/fixture/FreeCAD/python' }), runPythonJsonScriptFn,
  });
}

test('export uses detached final SVG bytes and bundled Python, then publishes only the verified staged PDF', async (t) => {
  const env = await fixture(t);
  let staged;
  const exportPdf = service(async (root, script, payload, options) => {
    assert.equal(root, ROOT);
    assert.equal(script, 'scripts/drawing_pdf.py');
    assert.equal(options.pythonCommand, '/fixture/FreeCAD/python');
    assert.equal(payload.svg, SVG);
    assert.ok(!Object.hasOwn(payload, 'source_path'));
    staged = payload.output_path;
    assert.notEqual(dirname(staged), env.outputDir);
    assert.equal(dirname(dirname(staged)), dirname(env.outputDir));
    assert.equal(basename(staged), 'drawing.pdf');
    await writeFile(staged, PDF);
    return MEASUREMENTS;
  });
  const result = await exportPdf(env.input);
  assert.equal(result.path, join(env.outputDir, 'bracket_drawing.pdf'));
  assert.equal(result.source_svg_sha256, createHash('sha256').update(SVG).digest('hex'));
  assert.equal(result.physical_width_mm, 420);
  assert.equal(result.physical_height_mm, 297);
  assert.equal(result.page_box_tolerance_mm, 0.2);
  assert.equal(await readFile(result.path, 'utf8'), PDF);
  assert.equal(await readFile(env.svgPath, 'utf8'), SVG);
  await assert.rejects(readFile(staged), { code: 'ENOENT' });
  assert.deepEqual((await readdir(env.outputDir)).sort(), ['bracket_drawing.pdf', 'bracket_drawing.svg']);
});

test('rejects outside, symlinked and hardlinked SVG sources before invoking Python', async (t) => {
  const env = await fixture(t);
  const outside = join(env.temporary, 'outside.svg');
  await writeFile(outside, SVG);
  const symlinkPath = join(env.outputDir, 'linked.svg');
  const hardlinkPath = join(env.outputDir, 'hardlinked.svg');
  await symlink(outside, symlinkPath);
  await link(outside, hardlinkPath);
  const exportPdf = service(() => { assert.fail('must reject before Python'); });
  for (const path of [outside, symlinkPath, hardlinkPath]) {
    await assert.rejects(exportPdf({ ...env.input, drawingResult: { success: true, drawing_paths: [{ format: 'svg', path }] } }));
  }
});

test('rejects missing runtime and oversized source before any process or output', async (t) => {
  const env = await fixture(t);
  const exportPdf = createDrawingPdfService({
    getFreeCADRuntimeFn: () => ({}), runPythonJsonScriptFn: () => { assert.fail('no runtime'); },
  });
  await assert.rejects(exportPdf(env.input), /Python/);
  await writeFile(env.svgPath, Buffer.alloc(16 * 1024 * 1024 + 1));
  await assert.rejects(service(() => { assert.fail('oversized source'); })(env.input), /size/i);
  assert.deepEqual(await readdir(env.outputDir), ['bracket_drawing.svg']);
});

test('cleans partial renderer output, invalid PDF bytes, failed result, and linked staging targets', async (t) => {
  for (const mode of ['throws', 'invalid', 'failed', 'linked', 'metadata']) {
    const env = await fixture(t);
    const exportPdf = service(async (_root, _script, payload) => {
      if (mode === 'linked') await symlink(env.svgPath, payload.output_path);
      else await writeFile(payload.output_path, mode === 'invalid' ? '<svg>not a PDF</svg>' : PDF);
      if (mode === 'throws') throw new Error('renderer failed');
      if (mode === 'failed') return { success: false, error: 'renderer failed' };
      if (mode === 'metadata') return { ...MEASUREMENTS, physical_width_mm: NaN };
      return MEASUREMENTS;
    });
    await assert.rejects(exportPdf(env.input), undefined, mode);
    assert.equal(await readFile(env.svgPath, 'utf8'), SVG);
    assert.deepEqual(await readdir(env.outputDir), ['bracket_drawing.svg'], mode);
  }
});

test('refuses publication if source bytes or output directory identity change during rendering', async (t) => {
  for (const mode of ['source', 'directory']) {
    const env = await fixture(t);
    const moved = `${env.outputDir}-moved`;
    const exportPdf = service(async (_root, _script, payload) => {
      await writeFile(payload.output_path, PDF);
      if (mode === 'source') await writeFile(env.svgPath, SVG.replace('9.0', '8.0'));
      else {
        await rename(env.outputDir, moved);
        await mkdir(env.outputDir);
      }
      return MEASUREMENTS;
    });
    await assert.rejects(exportPdf(env.input), /changed/i);
    assert.ok(!(await readdir(env.outputDir)).includes('bracket_drawing.pdf'));
    if (mode === 'directory') assert.deepEqual(await readdir(moved), ['bracket_drawing.svg']);
  }
});

test('does not replace an existing destination or follow its symlink', async (t) => {
  const env = await fixture(t);
  const target = join(env.outputDir, 'bracket_drawing.pdf');
  const outside = join(env.temporary, 'preserve.pdf');
  await writeFile(outside, 'preserve these bytes');
  await symlink(outside, target);
  const exportPdf = service(async (_root, _script, payload) => {
    await writeFile(payload.output_path, PDF);
    return MEASUREMENTS;
  });
  await assert.rejects(exportPdf(env.input));
  assert.equal(await readFile(outside, 'utf8'), 'preserve these bytes');
  assert.equal(await readFile(target, 'utf8'), 'preserve these bytes');
  assert.deepEqual((await readdir(env.outputDir)).sort(), ['bracket_drawing.pdf', 'bracket_drawing.svg']);
});
