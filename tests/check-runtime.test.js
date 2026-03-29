import assert from 'node:assert/strict';

import { buildRuntimeDiagnostics } from '../lib/runtime-diagnostics.js';
import { printRuntimeDiagnostics } from '../scripts/check-runtime.js';

function collectOutput(callback) {
  const lines = [];
  const exitCode = callback((line) => lines.push(line));
  return { exitCode, text: lines.join('\n') };
}

const readyRuntime = {
  available: true,
  source: 'FREECAD_APP',
  mode: 'macos-bundle',
  executable: '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
  bundleRoot: '/Applications/FreeCAD.app',
  runtimeExecutable: '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
  pythonExecutable: '/Applications/FreeCAD.app/Contents/Resources/bin/python',
  guiExecutable: '/Applications/FreeCAD.app/Contents/MacOS/FreeCAD',
  checkedCandidates: [
    '/Applications/FreeCAD.app/Contents/Resources/bin/python',
    '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
  ],
};

const readyResult = collectOutput((logger) => printRuntimeDiagnostics({
  logger,
  runtime: readyRuntime,
  platform: 'darwin',
  env: {
    FREECAD_APP: '/Applications/FreeCAD.app',
  },
  detectDetails: () => ({
    python: {
      executable: readyRuntime.pythonExecutable,
      version: '3.11.8',
      platform: 'darwin',
      error: null,
    },
    freecad: {
      executable: readyRuntime.runtimeExecutable,
      version: '1.1.0',
      homePath: '/Applications/FreeCAD.app/Contents/Resources',
      modulePath: '/Applications/FreeCAD.app/Contents/Resources/lib/FreeCAD.so',
      error: null,
    },
  }),
}));

const readyJsonResult = collectOutput((logger) => printRuntimeDiagnostics({
  logger,
  format: 'json',
  runtime: readyRuntime,
  platform: 'darwin',
  env: {
    FREECAD_APP: '/Applications/FreeCAD.app',
  },
  detectDetails: () => ({
    python: {
      executable: readyRuntime.pythonExecutable,
      version: '3.11.8',
      platform: 'darwin',
      error: null,
      source: 'python-import',
    },
    freecad: {
      executable: readyRuntime.runtimeExecutable,
      version: '1.1.0',
      homePath: '/Applications/FreeCAD.app/Contents/Resources',
      modulePath: '/Applications/FreeCAD.app/Contents/Resources/lib/FreeCAD.so',
      error: null,
      source: 'python-import',
    },
  }),
}));

assert.equal(readyResult.exitCode, 0);
assert.match(readyResult.text, /Status: ready/);
assert.match(readyResult.text, /Resolution order: FREECAD_PYTHON -> FREECAD_BIN -> FREECAD_CMD -> FREECAD_APP -> FREECAD_DIR/);
assert.match(readyResult.text, /FREECAD_APP: \/Applications\/FreeCAD\.app \[selected\]/);
assert.match(readyResult.text, /Searched paths:/);
assert.match(readyResult.text, /FreeCAD version: 1\.1\.0/);
assert.match(readyResult.text, /Commands that require FreeCAD:/);
assert.match(readyResult.text, /Commands that can run in plain Python \/ Node mode:/);
assert.match(readyResult.text, /validate-config/);
assert.match(readyResult.text, /migrate-config/);
assert.match(readyResult.text, /Next steps:/);

assert.equal(readyJsonResult.exitCode, 0);
const readyJson = JSON.parse(readyJsonResult.text);
assert.deepEqual(readyJson, buildRuntimeDiagnostics({
  runtime: readyRuntime,
  platform: 'darwin',
  env: {
    FREECAD_APP: '/Applications/FreeCAD.app',
  },
  detectDetails: () => ({
    python: {
      executable: readyRuntime.pythonExecutable,
      version: '3.11.8',
      platform: 'darwin',
      error: null,
      source: 'python-import',
    },
    freecad: {
      executable: readyRuntime.runtimeExecutable,
      version: '1.1.0',
      homePath: '/Applications/FreeCAD.app/Contents/Resources',
      modulePath: '/Applications/FreeCAD.app/Contents/Resources/lib/FreeCAD.so',
      error: null,
      source: 'python-import',
    },
  }),
}));
assert.equal(readyJson.command_classes.freecad_backed.includes('inspect'), true);
assert.equal(readyJson.capability_map['check-runtime'].classification, 'diagnostics');
assert.equal(readyJson.support_boundary_note, null);

const missingRuntime = {
  available: false,
  source: 'FREECAD_BIN',
  mode: 'native',
  executable: '',
  bundleRoot: '',
  installRoot: '',
  runtimeExecutable: '',
  pythonExecutable: '',
  guiExecutable: '',
  checkedCandidates: ['/opt/freecad/bin/FreeCADCmd'],
};

const missingResult = collectOutput((logger) => printRuntimeDiagnostics({
  logger,
  runtime: missingRuntime,
  platform: 'linux',
  env: {
    FREECAD_BIN: '/opt/freecad/bin/FreeCADCmd',
  },
  detectDetails: () => ({
    python: { executable: '', version: null, platform: null, error: null },
    freecad: { executable: '', version: null, homePath: null, modulePath: null, error: null },
  }),
}));

const missingJsonResult = collectOutput((logger) => printRuntimeDiagnostics({
  logger,
  format: 'json',
  runtime: missingRuntime,
  platform: 'linux',
  env: {
    FREECAD_BIN: '/opt/freecad/bin/FreeCADCmd',
  },
  detectDetails: () => ({
    python: { executable: '', version: null, platform: null, error: null, source: null },
    freecad: { executable: '', version: null, homePath: null, modulePath: null, error: null, source: null },
  }),
}));

assert.equal(missingResult.exitCode, 1);
assert.match(missingResult.text, /Status: runtime not detected/);
assert.match(missingResult.text, /FREECAD_BIN: \/opt\/freecad\/bin\/FreeCADCmd \[selected\]/);
assert.match(missingResult.text, /Remediation:/);
assert.match(missingResult.text, /Review the active FREECAD_\* overrides below and fix or remove any stale paths before retrying\./);
assert.match(missingResult.text, /export FREECAD_BIN="\/path\/to\/FreeCADCmd"/);
assert.match(missingResult.text, /If you only need the manufacturing-review layer for now, stay on the plain-Python commands listed below while FreeCAD is being fixed\./);

assert.equal(missingJsonResult.exitCode, 1);
const missingJson = JSON.parse(missingJsonResult.text);
assert.equal(missingJson.status, 'runtime_not_detected');
assert.equal(missingJson.errors.includes('FreeCAD runtime not detected.'), true);
assert.equal(missingJson.env_overrides.values[1].selected, true);
assert.match(missingJson.support_boundary_note, /compatibility paths/);
assert.equal(missingJson.remediation.length > 0, true);

console.log('check-runtime.test.js: ok');
