import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReportService } from '../src/services/report/report-service.js';
import { createReportEvidenceFixture } from './helpers/report-evidence-fixture.js';

const temp = await mkdtemp(join(tmpdir(), 'fcad-report-sheet-'));
try {
  const svgPath = join(temp, 'edited_drawing.svg');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>8.0 mm</text></svg>';
  await writeFile(svgPath, svg);
  const rendererInputs = [];
  const report = createReportService({
    loadShopProfileFn: async () => null,
    loadRuleProfileFn: async () => null,
    getFreeCADRuntimeFn: () => ({ mode: 'unknown', available: false }),
  });
  const input = {
    freecadRoot: process.cwd(), configPath: 'edited.toml',
    config: { name: 'edited', _drawing_sheet: { svg: 'UNTRUSTED CONFIG SVG' } },
    outputDir: temp,
    runScript: async (script, payload) => {
      rendererInputs.push(payload);
      const path = join(temp, 'edited_report.pdf');
      await writeFile(path, '%PDF-1.4\n');
      return { success: true, path };
    },
    drawingResult: {
      success: true, drawing_paths: [{ format: 'svg', path: svgPath }],
      scale: '1:2', views: ['front', 'top'],
    },
  };
  const result = await report(input);
  assert.equal(rendererInputs[0]._drawing_sheet?.svg, svg);
  assert.equal(rendererInputs[0]._drawing_sheet?.scale, '1:2');
  assert.deepEqual(rendererInputs[0]._drawing_sheet?.views, ['front', 'top']);
  assert.match(result.path, /edited_report\.pdf$/);
  assert.match(result.summary_json, /edited_report_summary\.json$/);
  await report({ ...input, drawingResult: null });
  assert.equal(rendererInputs[1]._drawing_sheet, null, 'raw config must not enable drawing embedding');
  await assert.rejects(report({ ...input, drawingResult: { success: true } }), /SVG/i);
  const child = join(temp, 'other-report');
  await mkdir(child);
  await symlink(svgPath, join(child, 'linked.svg'));
  await assert.rejects(report({ ...input, outputDir: child, drawingResult: {
    success: true, drawing_paths: [{ format: 'svg', path: join(child, 'linked.svg') }],
  } }), /inside its report output directory/i);
  assert.equal(await readFile(svgPath, 'utf8'), svg);
} finally {
  await rm(temp, { recursive: true, force: true });
}
for (const [description, matchesProducer] of [
  ['an identical relocated SVG stays verified after the canonical file changes', true],
  ['a different selected SVG fails even if the canonical file still matches', false],
]) {
  await test(description, async () => {
    const f = await createReportEvidenceFixture();
    try {
      const original = await readFile(f.paths.svg, 'utf8');
      const alternate = original.replace('>8<', '>9<');
      assert.notEqual(original, alternate);
      const selected = matchesProducer ? original : alternate;
      const replacement = matchesProducer ? alternate : original;
      const selectedPath = join(await realpath(f.directory), 'selected.svg');
      await writeFile(selectedPath, selected);
      await writeFile(f.paths.svg, replacement);

      let reads = 0;
      let fallbackSummary;
      const render = createReportService({
        loadShopProfileFn: async () => null,
        loadRuleProfileFn: async () => null,
        getFreeCADRuntimeFn: () => ({ mode: 'macos-bundle', pythonExecutable: 'fixture-python' }),
        readFileFn: async (path, encoding) => {
          const bytes = await readFile(path, encoding);
          if (path === selectedPath) {
            reads++;
            await writeFile(path, replacement);
          }
          return bytes;
        },
        runPythonJsonScriptFn: async (_root, _script, payload) => {
          assert.equal(payload._drawing_sheet.svg, selected);
          fallbackSummary = payload._decision_summary;
          await writeFile(f.paths.pdf, '%PDF-fixture');
          return { success: true, path: f.paths.pdf };
        },
      });
      const result = await render({
        freecadRoot: f.root, config: f.config, configPath: f.configPath, outputDir: f.directory,
        drawingResult: { success: true, svg_path: selectedPath },
        analysisResults: { dfm: { score: 96, issues: [], summary: { errors: 0, warnings: 0 } } },
        runScript: async (_script, payload) => {
          assert.equal(payload._drawing_sheet.svg, selected);
          assert.equal(await readFile(selectedPath, 'utf8'), replacement);
          throw new Error('No JSON found in stdout of engineering_report.py');
        },
      });
      const summary = await f.readJson(result.summary_json);
      const provenance = summary.surfaces.drawing_quality.evidence_provenance;
      const check = provenance.output_checks.find((output) => output.kind === 'drawing.svg');
      const expected = matchesProducer ? 'pass' : 'fail';
      assert.equal(summary.overall_status, expected);
      assert.equal(provenance.status, expected);
      assert.equal(check.status, expected);
      assert.deepEqual(check.reason_codes, matchesProducer ? [] : ['output-content-mismatch']);
      assert.equal(check.consumed.path, selectedPath);
      assert.equal(check.consumed.sha256, createHash('sha256').update(selected).digest('hex'));
      assert.deepEqual(fallbackSummary.surfaces, summary.surfaces);
      assert(!JSON.stringify(summary).includes('<svg'));
      assert.equal(reads, 1);
    } finally {
      await f.cleanup();
    }
  });
}
console.log('report-drawing-sheet.test.js: ok');
