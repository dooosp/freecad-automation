import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createLocalApiServer } from '../src/server/local-api-server.js';
import { buildArtifactManifest } from '../lib/artifact-manifest.js';

const root = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(join(tmpdir(), 'fcad-artifact-preview-'));
const { server, jobStore } = createLocalApiServer({
  projectRoot: root, jobsDir: join(temporary, 'jobs'),
  artifactModelPreviewServiceFactory: () => ({
    async readMesh({ sourcePath }) { return Buffer.concat([Buffer.from('mesh:'), await readFile(sourcePath)]); },
    async dispose() {},
  }),
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
async function fixture(name, extension = '.step', scope = 'user-facing') {
  const job = await jobStore.createJob({ type: 'create' });
  const path = await jobStore.writeJobFile(job.id, `artifacts/${name}${extension}`, name);
  const manifest = await buildArtifactManifest({ projectRoot: root, interface: 'api', command: 'create', status: 'succeeded',
    artifacts: [{ type: `model${extension}`, path, scope, stability: 'stable' }] });
  await jobStore.completeJob(job.id, { success: true }, { exports: [path] }, {}, manifest);
  const response = await fetch(`${base}/jobs/${job.id}/artifacts`);
  assert.equal(response.status, 200);
  return { job, path, artifact: (await response.json()).artifacts[0] };
}
try {
  const first = await fixture('first');
  const second = await fixture('second');
  assert.equal(first.artifact.capabilities.can_preview_model, true);
  assert.match(first.artifact.links.model_preview, new RegExp(first.job.id));
  for (const source of [first, second]) {
    const response = await fetch(base + source.artifact.links.model_preview, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /model\/stl/);
    assert.equal(await response.text(), `mesh:${source === first ? 'first' : 'second'}`);
  }
  const privateFile = await fixture('private', '.step', 'internal');
  const html = await fixture('unsafe', '.html');
  for (const blocked of [privateFile, html]) {
    assert.notEqual(blocked.artifact.capabilities.can_preview_model, true);
    const response = await fetch(`${base}/artifacts/${blocked.job.id}/${blocked.artifact.id}/model-preview`, { method: 'POST' });
    assert.equal(response.status, 403);
  }
  assert.equal((await fetch(`${base}/artifacts/${first.job.id}/unregistered/model-preview`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(base + first.artifact.links.model_preview, { method: 'POST', headers: { Origin: 'https://audit.invalid' } })).status, 403);
  await rm(first.path);
  assert.equal((await fetch(base + first.artifact.links.model_preview, { method: 'POST' })).status, 404);
  await symlink(second.path, first.path);
  assert.equal((await fetch(base + first.artifact.links.model_preview, { method: 'POST' })).status, 403, 'another job directory is outside this artifact authority');
  console.log('artifact-model-preview-api.test.js: ok');
} finally {
  await new Promise((done) => server.close(done));
  await rm(temporary, { recursive: true, force: true });
}
