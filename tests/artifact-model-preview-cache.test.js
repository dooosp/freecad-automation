import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtifactModelPreviewService } from '../src/server/artifact-model-preview-service.js';

const dir = await mkdtemp(join(tmpdir(), 'fcad-mesh-cache-'));
const sourcePath = join(dir, 'source.step');
await writeFile(sourcePath, 'first');
let calls = 0;
let failNext = false;
let pause = null;
const service = createArtifactModelPreviewService({
  maxPreviewBytes: 64,
  async runScript(_script, input) {
    calls += 1;
    if (failNext) { failNext = false; throw new Error('runtime failed'); }
    if (pause) { pause.started(); await pause.wait; pause = null; }
    await writeFile(input.output_path, Buffer.concat([Buffer.from('mesh:'), await readFile(input.file)]));
    return { success: true };
  },
});
const request = { sourcePath, jobId: 'one', artifactId: 'model-step' };
try {
  const results = await Promise.all([service.readMesh(request), service.readMesh(request)]);
  assert.equal(results[0].toString(), 'mesh:first');
  assert.equal(results[1].toString(), 'mesh:first');
  assert.equal(calls, 1, 'simultaneous views of the same source must coalesce');
  await writeFile(sourcePath, 'other');
  assert.equal((await service.readMesh(request)).toString(), 'mesh:other');
  assert.equal(calls, 2, 'same-size changed source bytes must invalidate the old mesh');
  await service.readMesh({ ...request, jobId: 'two' });
  assert.equal(calls, 3, 'cache entries cannot cross job authority');
  failNext = true;
  await writeFile(sourcePath, 'retry');
  await assert.rejects(service.readMesh(request), /runtime failed/);
  assert.equal((await service.readMesh(request)).toString(), 'mesh:retry');
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  let release;
  pause = { started, wait: new Promise((resolve) => { release = resolve; }) };
  await writeFile(sourcePath, 'before');
  const pending = service.readMesh(request);
  await startedPromise;
  await writeFile(sourcePath, 'after');
  release();
  await assert.rejects(pending, (error) => error.status === 409);
  assert.equal((await service.readMesh(request)).toString(), 'mesh:after');
  assert.equal(await readFile(sourcePath, 'utf8'), 'after', 'previewing never changes the source');
  const stl = join(dir, 'large.stl');
  await writeFile(stl, Buffer.alloc(65));
  await assert.rejects(service.readMesh({ ...request, sourcePath: stl }), (error) => error.status === 413);
  const beforeCloseCalls = calls;
  const closing = service.readMesh({ ...request, jobId: 'closing' });
  await service.dispose();
  await assert.rejects(closing, (error) => error.status === 503);
  assert.equal(calls, beforeCloseCalls, 'closing the server during source I/O must not launch new runtime work');
  console.log('artifact-model-preview-cache.test.js: ok');
} finally {
  await service.dispose();
  await rm(dir, { recursive: true, force: true });
}
