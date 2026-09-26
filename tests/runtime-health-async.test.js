import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildRuntimeDiagnostics } from '../lib/runtime-diagnostics.js';
import { createLocalApiServer } from '../src/server/local-api-server.js';

const directory = await mkdtemp(join(tmpdir(), 'fcad-health-async-'));
const diagnostics = buildRuntimeDiagnostics({ runtime: { available: false, executable: '', checkedCandidates: [] } });
let enter;
let finish;
let pending = null;
let rejectNext = false;
const entered = new Promise((done) => { enter = done; });
const gate = new Promise((done) => { finish = done; });
const { server } = createLocalApiServer({
  projectRoot: resolve(import.meta.dirname, '..'), jobsDir: join(directory, 'jobs'),
  async runtimeDiagnosticsFactory() {
    enter();
    await gate;
    if (rejectNext) throw new Error('Runtime probe unavailable.');
    return diagnostics;
  },
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  let completed = false;
  pending = fetch(`${base}/health`).then((response) => { completed = true; return response; });
  await entered;
  const jobs = await fetch(`${base}/jobs`);
  assert.equal(jobs.status, 200, 'job listing must work while a runtime probe is pending');
  assert.equal(completed, false, 'health must wait for diagnostics rather than serializing a Promise');
  finish();
  const response = await pending;
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.runtime.available, false);
  assert.equal(body.runtime.status, 'runtime_not_detected');
  assert.equal(body.runtime.inspection_evidence_status, 'not_inspection_evidence');
  assert.equal(JSON.stringify(body).includes(directory), false);
  rejectNext = true;
  const failed = await fetch(`${base}/health`);
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).error.code, 'runtime_diagnostics_unavailable');
  assert.equal((await fetch(`${base}/jobs`)).status, 200);
  console.log('runtime-health-async.test.js: ok');
} finally {
  finish();
  await pending;
  await new Promise((done) => server.close(done));
  await rm(directory, { recursive: true, force: true });
}
