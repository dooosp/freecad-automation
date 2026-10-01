import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReportService } from '../src/services/report/report-service.js';

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
console.log('report-drawing-sheet.test.js: ok');
