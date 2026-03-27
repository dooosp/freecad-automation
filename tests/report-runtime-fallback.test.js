import assert from 'node:assert/strict';

import { createReportService } from '../src/services/report/report-service.js';

let primaryRunCount = 0;
let fallbackRunCount = 0;
let readFileCount = 0;

const generateReport = createReportService({
  loadShopProfileFn: async () => null,
  getFreeCADRuntimeFn: () => ({
    mode: 'macos-bundle',
    pythonExecutable: '/Applications/FreeCAD.app/Contents/Resources/bin/python',
  }),
  runPythonJsonScriptFn: async (projectRoot, scriptRelativePath, payload, opts = {}) => {
    fallbackRunCount += 1;
    assert.equal(projectRoot, '/tmp/freecad-automation');
    assert.equal(scriptRelativePath, 'scripts/engineering_report.py');
    assert.equal(payload.name, 'report_fallback_probe');
    assert.equal(opts.pythonCommand, '/Applications/FreeCAD.app/Contents/Resources/bin/python');
    return {
      success: true,
      path: '/tmp/freecad-automation/output/report_fallback_probe_report.pdf',
      size_bytes: 1234,
    };
  },
  readFileFn: async (filePath, encoding) => {
    readFileCount += 1;
    assert.equal(filePath, '/tmp/freecad-automation/output/report_fallback_probe_report.pdf');
    assert.equal(encoding, undefined);
    return Buffer.from('pdf-bytes');
  },
});

const result = await generateReport({
  freecadRoot: '/tmp/freecad-automation',
  runScript: async () => {
    primaryRunCount += 1;
    throw new Error(
      'No JSON found in stdout of engineering_report.py\nstdout: FreeCAD 1.1.0 banner only\nstderr:'
    );
  },
  loadConfig: async () => ({
    name: 'report_fallback_probe',
    export: { directory: 'output' },
  }),
  config: {
    name: 'report_fallback_probe',
    export: { directory: 'output' },
  },
  includeDrawing: false,
  includeDfm: false,
  includeTolerance: false,
  includeCost: false,
});

assert.equal(primaryRunCount, 1);
assert.equal(fallbackRunCount, 1);
assert.equal(readFileCount, 1);
assert.equal(result.success, true);
assert.equal(result.path, '/tmp/freecad-automation/output/report_fallback_probe_report.pdf');
assert.equal(result.pdfBase64, Buffer.from('pdf-bytes').toString('base64'));

console.log('report-runtime-fallback.test.js: ok');
