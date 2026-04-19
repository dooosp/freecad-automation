import assert from 'node:assert/strict';

import { buildRuntimeDiagnostics } from '../lib/runtime-diagnostics.js';
import { buildHealthPayload } from '../src/server/local-api-server.js';
import { LOCAL_API_SERVICE, LOCAL_API_VERSION } from '../src/server/local-api-contract.js';

function assertNoLeakedPathStrings(payload, blocked = []) {
  const serialized = JSON.stringify(payload);
  blocked.filter(Boolean).forEach((value) => {
    assert.equal(serialized.includes(String(value)), false, `Payload leaked path-like value: ${value}`);
  });
}

const runtime = {
  available: true,
  source: 'FREECAD_APP',
  mode: 'macos-bundle',
  pathStyle: 'posix',
  executable: '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
  bundleRoot: '/Applications/FreeCAD.app',
  installRoot: '',
  runtimeExecutable: '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
  pythonExecutable: '/Applications/FreeCAD.app/Contents/Resources/bin/python',
  guiExecutable: '/Applications/FreeCAD.app/Contents/MacOS/FreeCAD',
  checkedCandidates: [
    '/Applications/FreeCAD.app/Contents/Resources/bin/python',
    '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
  ],
};

const diagnostics = buildRuntimeDiagnostics({
  runtime,
  platform: 'darwin',
  env: {
    FREECAD_APP: '/Applications/FreeCAD.app',
  },
  detectDetails: () => ({
    python: {
      executable: runtime.pythonExecutable,
      version: '3.11.8',
      platform: 'darwin',
      source: 'python-import',
      error: null,
    },
    freecad: {
      executable: runtime.runtimeExecutable,
      version: '1.1.0',
      homePath: '/Applications/FreeCAD.app/Contents/Resources',
      modulePath: '/Applications/FreeCAD.app/Contents/Resources/lib/FreeCAD.so',
      source: 'python-import',
      error: null,
    },
  }),
});

const health = buildHealthPayload({
  projectRoot: '/Users/example/freecad-automation',
  jobsDir: '/tmp/fcad-jobs',
  runtimeDiagnostics: diagnostics,
});

assert.equal(health.api_version, LOCAL_API_VERSION);
assert.equal(health.service, LOCAL_API_SERVICE);
assert.equal(health.jobs_dir, '<jobs-dir>');
assert.match(health.runtime.description, /<freecad-runtime>/);
assert.match(health.runtime.executable, /<freecad-runtime>/);
assert.match(health.runtime.selected_runtime.summary, /<freecad-runtime>/);
assert.equal(health.runtime.capability_map.inspect.requires_freecad_runtime, true);
assert.equal(health.runtime.command_classes.plain_python_or_node.includes('dfm'), true);
assertNoLeakedPathStrings(health, [
  '/Users/example/freecad-automation',
  '/tmp/fcad-jobs',
  '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
  '/Applications/FreeCAD.app/Contents/Resources/bin/python',
  '/Applications/FreeCAD.app/Contents/MacOS/FreeCAD',
]);

console.log('runtime-health-parity.test.js: ok');
