import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { buildRuntimeDiagnostics } from '../lib/runtime-diagnostics.js';
import { createLocalApiServer } from '../src/server/local-api-server.js';
import { validateLocalApiResponse } from '../src/server/local-api-schemas.js';

const ROOT = resolve(import.meta.dirname, '..');
const TMP_ROOT = mkdtempSync(join(tmpdir(), 'fcad-public-path-redaction-'));
const JOBS_DIR = join(TMP_ROOT, 'jobs');
const PUBLIC_PROJECT_FIXTURE = '/Users/example/freecad-automation';
const PRIVATE_TMP_FIXTURE = '/private/tmp/freecad-homepage-smoke';
const MACOS_RUNTIME_FIXTURE = '/Applications/FreeCAD.app/Contents/MacOS/FreeCAD';
const WINDOWS_RUNTIME_FIXTURE = 'C:\\Program Files\\FreeCAD 1.1\\bin\\FreeCADCmd.exe';

function assertNoLeakedPathStrings(payload, blocked = []) {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  blocked.filter(Boolean).forEach((value) => {
    assert.equal(serialized.includes(String(value)), false, `Payload leaked path-like value: ${value}`);
  });
}

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

const fixtureDiagnostics = buildRuntimeDiagnostics({
  runtime: {
    available: true,
    source: 'FREECAD_BIN',
    mode: 'macos-bundle',
    pathStyle: 'posix',
    executable: MACOS_RUNTIME_FIXTURE,
    bundleRoot: '/Applications/FreeCAD.app',
    installRoot: '',
    runtimeExecutable: WINDOWS_RUNTIME_FIXTURE,
    pythonExecutable: `${PRIVATE_TMP_FIXTURE}/bin/python`,
    guiExecutable: MACOS_RUNTIME_FIXTURE,
    checkedCandidates: [
      PUBLIC_PROJECT_FIXTURE,
      PRIVATE_TMP_FIXTURE,
      MACOS_RUNTIME_FIXTURE,
      WINDOWS_RUNTIME_FIXTURE,
    ],
  },
  platform: 'darwin',
  env: {
    FREECAD_APP: '/Applications/FreeCAD.app',
    FREECAD_DIR: PUBLIC_PROJECT_FIXTURE,
    FREECAD_BIN: WINDOWS_RUNTIME_FIXTURE,
    FREECAD_PYTHON: `${PRIVATE_TMP_FIXTURE}/bin/python`,
  },
  detectDetails: () => ({
    python: {
      executable: `${PRIVATE_TMP_FIXTURE}/bin/python`,
      version: '3.11.8',
      platform: 'darwin',
      source: 'python-import',
      error: `Probe fallback at ${PRIVATE_TMP_FIXTURE}/logs/python-probe.txt`,
    },
    freecad: {
      executable: WINDOWS_RUNTIME_FIXTURE,
      version: '1.1.0',
      homePath: '/Applications/FreeCAD.app/Contents/Resources',
      modulePath: `${PUBLIC_PROJECT_FIXTURE}/runtime/FreeCAD.so`,
      source: 'python-import',
      error: `Runtime mismatch for ${MACOS_RUNTIME_FIXTURE}`,
    },
  }),
});

const { server } = createLocalApiServer({
  projectRoot: ROOT,
  jobsDir: JOBS_DIR,
  runtimeDiagnosticsFactory: () => fixtureDiagnostics,
});

try {
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  const apiHtmlResponse = await fetch(`${baseUrl}/api`, {
    headers: {
      accept: 'text/html',
    },
  });
  assert.equal(apiHtmlResponse.status, 200);
  const apiHtml = await apiHtmlResponse.text();
  assert.match(apiHtml, /fcad Local API/);
  assert.match(apiHtml, /GET \/health/);
  assertNoLeakedPathStrings(apiHtml, [ROOT, JOBS_DIR]);

  const apiJsonResponse = await fetch(`${baseUrl}/api`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(apiJsonResponse.status, 200);
  const apiPayload = await apiJsonResponse.json();
  assert.equal(apiPayload.ok, true);
  assert.equal(apiPayload.mode, 'local_api');
  assert.equal(apiPayload.endpoints.health, '/health');
  assert.equal(apiPayload.studio.path, '/studio');
  assertNoLeakedPathStrings(apiPayload, [ROOT, JOBS_DIR]);

  const healthResponse = await fetch(`${baseUrl}/health`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(healthResponse.status, 200);
  const healthPayload = await healthResponse.json();
  assert.equal(healthPayload.ok, true);
  assert.equal(validateLocalApiResponse('health', healthPayload).ok, true);
  assert.equal(healthPayload.runtime.available, true);
  assert.equal(healthPayload.runtime.mode, 'macos-bundle');
  assert.equal(healthPayload.runtime.capability_map.inspect.requires_freecad_runtime, true);
  assertNoLeakedPathStrings(healthPayload, [
    ROOT,
    JOBS_DIR,
    PUBLIC_PROJECT_FIXTURE,
    PRIVATE_TMP_FIXTURE,
    MACOS_RUNTIME_FIXTURE,
    WINDOWS_RUNTIME_FIXTURE,
  ]);
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(TMP_ROOT, { recursive: true, force: true });
}

console.log('public-path-redaction.test.js: ok');
