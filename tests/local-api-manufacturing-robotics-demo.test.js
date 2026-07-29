import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createLocalApiServer } from '../src/server/local-api-server.js';

const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = 'hinge-block-synthetic-inspection-v1';

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

async function close(server) {
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

async function waitForTerminalJob(baseUrl, id) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${baseUrl}/jobs/${id}`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    if (['succeeded', 'failed', 'cancelled'].includes(payload.job.status)) return payload.job;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Tracked job ${id} did not reach a terminal state.`);
}

const externalRoot = await mkdtemp(join(tmpdir(), 'fcad-local-api-manufacturing-demo-'));
const { server } = createLocalApiServer({
  projectRoot: ROOT,
  jobsDir: join(externalRoot, 'jobs'),
  studioModelServiceFactory: () => ({ dispose: async () => {} }),
  studioDrawingServiceFactory: () => ({
    getTrackedDrawPlan: async () => ({ drawingPlan: null, reason: 'not_requested' }),
    dispose: async () => {},
  }),
  bootstrapImportServiceFactory: () => async () => {
    throw new Error('not used by manufacturing demo test');
  },
});

try {
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  const acceptedResponse = await fetch(`${baseUrl}/api/studio/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'manufacturing-action-dataset',
      demo_profile: PROFILE,
    }),
  });
  assert.equal(acceptedResponse.status, 202);
  const accepted = await acceptedResponse.json();
  assert.deepEqual(accepted.job.request, {
    type: 'manufacturing-action-dataset',
    demo_profile: PROFILE,
  });

  const succeeded = await waitForTerminalJob(baseUrl, accepted.job.id);
  assert.equal(succeeded.status, 'succeeded', succeeded.error?.message);
  assert.equal(succeeded.result.publication.published_count, 8);
  assert.equal(succeeded.diagnostics.manufacturing_action_demo.source_inputs.length, 5);
  assert.equal(JSON.stringify(succeeded).includes(externalRoot), false);
  assert.equal(JSON.stringify(succeeded).includes(ROOT), false);

  const artifactsResponse = await fetch(`${baseUrl}/jobs/${accepted.job.id}/artifacts`);
  assert.equal(artifactsResponse.status, 200);
  const artifactsPayload = await artifactsResponse.json();
  assert.equal(artifactsPayload.artifacts.length, 8);
  assert.equal(artifactsPayload.artifacts.every((artifact) => artifact.scope === 'user-facing'), true);
  assert.equal(artifactsPayload.artifacts.every((artifact) => artifact.capabilities.can_open), true);
  assert.equal(JSON.stringify(artifactsPayload).includes(externalRoot), false);
  for (const artifact of artifactsPayload.artifacts) {
    const contentResponse = await fetch(`${baseUrl}${artifact.links.open}`);
    assert.equal(contentResponse.status, 200, artifact.file_name);
    const text = await contentResponse.text();
    assert(text.length > 0, artifact.file_name);
    if (artifact.extension === '.json') JSON.parse(text);
  }

  for (const body of [
    {
      type: 'manufacturing-action-dataset',
      demo_profile: PROFILE,
      config_path: 'configs/examples/hinge_block.toml',
    },
    {
      type: 'manufacturing-action-dataset',
      demo_profile: PROFILE,
      options: { proof_lineage: false },
    },
    {
      type: 'manufacturing-action-dataset',
      demo_profile: 'unregistered-profile',
    },
  ]) {
    const rejectedResponse = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(rejectedResponse.status, 400, JSON.stringify(body));
  }

  const mismatchResponse = await fetch(`${baseUrl}/api/studio/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'manufacturing-action-dataset',
      demo_profile: PROFILE,
      trust_demo: 'revision-mismatch',
    }),
  });
  assert.equal(mismatchResponse.status, 202);
  const mismatchAccepted = await mismatchResponse.json();
  const failed = await waitForTerminalJob(baseUrl, mismatchAccepted.job.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.result.reason_code, 'REVISION_LINEAGE_IDENTITY_MISMATCH');
  assert.equal(failed.result.expected.revision, 'A');
  assert.equal(failed.result.received.revision, 'B');
  assert.deepEqual(failed.result.published, { expected_count: 8, published_count: 0 });
  assert.equal(JSON.stringify(failed).includes(externalRoot), false);

  const failedArtifactsResponse = await fetch(`${baseUrl}/jobs/${mismatchAccepted.job.id}/artifacts`);
  assert.equal(failedArtifactsResponse.status, 200);
  const failedArtifacts = await failedArtifactsResponse.json();
  assert.equal(failedArtifacts.artifacts.length, 0);
} finally {
  if (server.listening) await close(server);
  await rm(externalRoot, { recursive: true, force: true });
}

console.log('local-api-manufacturing-robotics-demo.test.js: ok');
