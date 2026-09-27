import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createArtifactModelPreviewService } from '../src/server/artifact-model-preview-service.js';
import { createLocalApiServer } from '../src/server/local-api-server.js';
import { buildArtifactManifest } from '../lib/artifact-manifest.js';

const deferred = () => {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
};
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    assert(Date.now() < deadline, 'preview did not reach the expected state');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function fixture(t, options = {}, failFirst = false) {
  const directory = await mkdtemp(join(tmpdir(), 'fcad-preview-limits-'));
  const requests = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
    const sourcePath = join(directory, `source-${i}.step`);
    await writeFile(sourcePath, `source-${i}`);
    return { sourcePath, jobId: 'limits', artifactId: String(i) };
  }));
  let gate = null;
  const state = { started: [], active: 0, peak: 0, outcomes: [], promises: [], directories: [] };
  const service = createArtifactModelPreviewService({ ...options,
    async runScript(script, input, runnerOptions) {
      assert.equal(script, 'preview_model.py');
      assert.equal(runnerOptions.timeout, 120_000);
      const source = await readFile(input.file, 'utf8');
      state.started.push(source);
      state.directories.push(dirname(input.file));
      state.active += 1;
      state.peak = Math.max(state.peak, state.active);
      try {
        if (gate) await gate.promise;
        if (failFirst && source === 'source-0') throw new Error('runtime failed');
        await writeFile(input.output_path, `mesh:${source}`);
        return { success: true };
      } finally { state.active -= 1; }
    },
  });
  const track = (request) => {
    const promise = service.readMesh(request).then(
      (bytes) => ({ id: request.artifactId, bytes }),
      (error) => ({ id: request.artifactId, error }),
    ).then((outcome) => { state.outcomes.push(outcome); return outcome; });
    state.promises.push(promise);
    return promise;
  };
  t.after(async () => {
    gate?.resolve();
    await service.dispose();
    await Promise.all(state.promises);
    await rm(directory, { recursive: true, force: true });
  });
  return { service, requests, state, track, directory,
    block() { gate = deferred(); }, release() { gate?.resolve(); },
  };
}

test('bounds default conversions and queue while sharing duplicates and serving cached meshes', async (t) => {
  const f = await fixture(t);
  await f.service.readMesh(f.requests[0]);
  f.block();
  f.track(f.requests[1]); f.track(f.requests[2]);
  await until(() => f.state.started.length === 3);
  for (const request of f.requests.slice(3)) f.track(request);
  await until(() => f.state.outcomes.length > 0 || f.state.started.length > 3);
  assert.equal(f.state.started.length, 3, 'only two uncached conversions may start while their slots are occupied');
  assert.equal(f.state.outcomes.length, 1, 'eight distinct requests may wait; the ninth must be rejected');
  const rejected = f.state.outcomes[0];
  assert.equal(rejected.error?.status, 503);
  const queued = f.requests.slice(3).find((request) => request.artifactId !== rejected.id);
  const duplicateActive = f.track(f.requests[1]);
  const duplicateQueued = f.track(queued);
  assert.equal((await f.service.readMesh(f.requests[0])).toString(), 'mesh:source-0', 'cache hits need no conversion slot');
  const stl = join(f.directory, 'saved.stl'); await writeFile(stl, 'saved mesh');
  assert.equal((await f.service.readMesh({ ...f.requests[0], sourcePath: stl })).toString(), 'saved mesh');
  f.release();
  await Promise.all(f.state.promises);
  assert.equal((await duplicateActive).bytes.toString(), 'mesh:source-1');
  assert.equal((await duplicateQueued).bytes.toString(), `mesh:source-${queued.artifactId}`);
  assert.equal(f.state.started.length, 11, 'duplicates must not spawn another conversion');
  assert.equal(f.state.peak, 2);
  assert.equal(f.state.outcomes.filter((outcome) => outcome.error).length, 1);
});

test('a failed conversion releases its slot, cleans its files and allows a retry', async (t) => {
  const f = await fixture(t, { maxConcurrent: 1, maxQueued: 1 }, true);
  f.block(); const first = f.track(f.requests[0]);
  await until(() => f.state.started.length === 1);
  f.track(f.requests[1]); f.track(f.requests[2]);
  await until(() => f.state.outcomes.length > 0 || f.state.started.length > 1);
  assert.equal(f.state.started.length, 1);
  const rejected = f.state.outcomes[0]; assert.equal(rejected.error?.status, 503);
  f.release(); await Promise.all(f.state.promises);
  assert.match((await first).error.message, /runtime failed/);
  assert.equal(f.state.outcomes.filter((outcome) => outcome.bytes).length, 1, 'the queued request must continue after failure');
  for (const directory of f.state.directories) await assert.rejects(access(directory), (error) => error.code === 'ENOENT');
  assert.equal((await f.service.readMesh(f.requests[Number(rejected.id)])).toString(), `mesh:source-${rejected.id}`, 'a rejected request can retry after capacity becomes available');
  assert.equal(f.state.peak, 1);
});

test('shutdown rejects queued conversions without starting them and waits only for active work', async (t) => {
  const f = await fixture(t, { maxConcurrent: 1, maxQueued: 1 });
  f.block(); const active = f.track(f.requests[0]);
  await until(() => f.state.started.length === 1);
  f.track(f.requests[1]); f.track(f.requests[2]);
  await until(() => f.state.outcomes.length > 0 || f.state.started.length > 1);
  assert.equal(f.state.started.length, 1);
  let disposed = false;
  const closing = f.service.dispose().then(() => { disposed = true; });
  await until(() => f.state.outcomes.length === 2);
  assert.equal(disposed, false);
  assert(f.state.outcomes.every((outcome) => outcome.error?.status === 503));
  await assert.rejects(f.service.readMesh(f.requests[3]), (error) => error.status === 503);
  f.release(); await closing;
  assert.equal((await active).bytes.toString(), 'mesh:source-0');
  assert.deepEqual(f.state.started, ['source-0']);
});

test('invalid resource limits cannot disable bounds or leave requests permanently queued', () => {
  for (const maxConcurrent of [0, -1, 1.5, NaN, Infinity, '2']) {
    assert.throws(() => createArtifactModelPreviewService({ maxConcurrent }), RangeError);
  }
  for (const maxQueued of [-1, 1.5, NaN, Infinity, '8']) {
    assert.throws(() => createArtifactModelPreviewService({ maxQueued }), RangeError);
  }
});

test('HTTP saturation returns 503 while individual and all-client cancellation preserve bounded shared work', async (t) => {
  const f = await fixture(t, { maxConcurrent: 1, maxQueued: 0 });
  const root = resolve(import.meta.dirname, '..'); let entered = 0;
  const { server, jobStore } = createLocalApiServer({ projectRoot: root, jobsDir: join(f.directory, 'jobs'),
    artifactModelPreviewServiceFactory: () => ({
      readMesh(request) { entered += 1; return f.service.readMesh(request); },
      dispose: () => f.service.dispose(),
    }),
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { f.release(); await new Promise((done) => server.close(done)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function artifact(name) {
    const job = await jobStore.createJob({ type: 'create' });
    const path = await jobStore.writeJobFile(job.id, `artifacts/${name}.step`, name);
    const manifest = await buildArtifactManifest({ projectRoot: root, interface: 'api', command: 'create', status: 'succeeded', artifacts: [{ type: 'model.step', path, scope: 'user-facing', stability: 'stable' }] });
    await jobStore.completeJob(job.id, { success: true }, { exports: [path] }, {}, manifest);
    const payload = await (await fetch(`${base}/jobs/${job.id}/artifacts`)).json();
    return base + payload.artifacts[0].links.model_preview;
  }
  const firstUrl = await artifact('first'), secondUrl = await artifact('second');
  const request = (url, controller) => fetch(url, { method: 'POST', signal: controller.signal }).then(
    async (response) => ({ status: response.status, text: await response.text() }),
    (error) => ({ error: error.name }),
  );
  f.block();
  const a = new AbortController(), b = new AbortController();
  const first = request(firstUrl, a), second = request(firstUrl, b);
  await until(() => entered === 2 && f.state.started.length === 1);
  const busy = await fetch(secondUrl, { method: 'POST', signal: AbortSignal.timeout(2000) });
  assert.equal(busy.status, 503);
  const error = await busy.json(); assert.equal(error.error.code, 'model_preview_failed');
  assert.match(error.error.messages.join(' '), /busy/i);
  a.abort(); assert.deepEqual(await first, { error: 'AbortError' });
  f.release(); assert.deepEqual(await second, { status: 200, text: 'mesh:first' });
  assert.equal(f.state.started.length, 1);

  f.block(); const c = new AbortController(), d = new AbortController();
  const third = request(secondUrl, c), fourth = request(secondUrl, d);
  await until(() => entered === 5 && f.state.started.length === 2);
  c.abort(); d.abort();
  assert.deepEqual(await third, { error: 'AbortError' }); assert.deepEqual(await fourth, { error: 'AbortError' });
  const thirdUrl = await artifact('third');
  const stillBusy = await fetch(thirdUrl, { method: 'POST' }); assert.equal(stillBusy.status, 503); await stillBusy.arrayBuffer();
  f.release();
  const completed = await fetch(secondUrl, { method: 'POST' });
  assert.equal(completed.status, 200); assert.equal(await completed.text(), 'mesh:second');
  assert.equal(f.state.started.length, 2, 'all-client cancellation keeps the bounded conversion and its cache result');
  assert.equal(f.state.peak, 1);
});
