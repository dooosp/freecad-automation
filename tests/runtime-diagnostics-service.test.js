import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntimeDiagnosticsService } from '../src/server/runtime-diagnostics-service.js';
import { FREECAD_ENV_OVERRIDES } from '../lib/paths.js';

const fixture = new URL('./fixtures/runtime/diagnostics-worker.js', import.meta.url);
const startWorker = (workerData) => new Worker(fixture, { workerData });
let workers = 0;
const service = createRuntimeDiagnosticsService({ workerFactory: () => { workers += 1; return startWorker({}); } });
try {
  let eventLoopRan = false;
  const first = service.read();
  const concurrent = service.read();
  assert.equal(first, concurrent, 'overlapping health requests share one active probe');
  setImmediate(() => { eventLoopRan = true; });
  assert.deepEqual(await first, { calls: 1, available: false });
  assert.equal(eventLoopRan, true, 'blocking probe work must execute outside the server thread');
  assert.deepEqual(await service.read(), { calls: 2, available: true });
  assert.deepEqual(await service.read(), { calls: 3, available: false }, 'a completed ready result must not survive the next failed probe');
  assert.equal(workers, 1, 'reuse the worker, without caching its result');
  const closing = service.read();
  const closed = assert.rejects(closing, /closed/);
  await service.dispose();
  await closed;
  await assert.rejects(service.read(), /closed/);
} finally { await service.dispose(); }

for (const mode of ['crash', 'exit', 'timeout']) {
  let attempts = 0;
  const retrying = createRuntimeDiagnosticsService({
    timeoutMs: 500,
    workerFactory: () => startWorker(++attempts === 1 ? { mode, delayMs: 10_000 } : { delayMs: 10 }),
  });
  try {
    await assert.rejects(retrying.read(), /crash|exited|timed out/);
    assert.deepEqual(await retrying.read(), { calls: 1, available: false }, 'failed workers must be replaced on the next request');
    assert.equal(attempts, 2);
  } finally { await retrying.dispose(); }
}

// A synthetic executable tests fresh discovery, without requiring FreeCAD in this test lane.
const savedEnv = Object.fromEntries(FREECAD_ENV_OVERRIDES.map((key) => [key, process.env[key]]));
const fresh = createRuntimeDiagnosticsService();
try {
  for (const key of FREECAD_ENV_OVERRIDES) delete process.env[key];
  process.env.FREECAD_BIN = join(tmpdir(), `missing-fcad-health-${process.pid}`);
  assert.equal((await fresh.read()).available, false);
  process.env.FREECAD_BIN = process.execPath;
  const ready = await fresh.read();
  assert.equal(ready.available, true, 'an override change must be rediscovered by an existing worker');
  assert.equal(ready.runtime_executable, process.execPath);
  process.env.FREECAD_BIN = join(tmpdir(), `missing-fcad-health-${process.pid}`);
  const missing = await fresh.read();
  assert.equal(missing.available, false, 'removing the selected runtime must clear ready status');
  assert.equal(missing.status, 'runtime_not_detected');
  assert.equal(missing.inspection_evidence_status, 'not_inspection_evidence');
} finally {
  await fresh.dispose();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
console.log('runtime-diagnostics-service.test.js: ok');
