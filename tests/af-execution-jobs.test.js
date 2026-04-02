import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { createLocalApiServer } from '../src/server/local-api-server.js';

const ROOT = resolve(import.meta.dirname, '..');
const REVIEW_PACK_FIXTURE = resolve(ROOT, 'tests/fixtures/d-artifacts/sample_review_pack.canonical.json');

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

async function waitForJob(baseUrl, jobId, expectedStatus = 'succeeded') {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${baseUrl}/jobs/${jobId}`, {
      headers: {
        accept: 'application/json',
      },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    if (payload.job.status === expectedStatus) {
      return payload.job;
    }
    if (payload.job.status === 'failed') {
      throw new Error(`Job ${jobId} failed: ${payload.job.error?.message || 'unknown error'}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-af-jobs-'));

try {
  const { server } = createLocalApiServer({
    projectRoot: ROOT,
    jobsDir: join(tmpRoot, 'jobs'),
  });
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  const readinessResponse = await fetch(`${baseUrl}/jobs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      type: 'readiness-pack',
      review_pack_path: REVIEW_PACK_FIXTURE,
    }),
  });
  assert.equal(readinessResponse.status, 202);
  const readinessPayload = await readinessResponse.json();
  assert.equal(readinessPayload.job.execution.command, 'readiness-pack');
  assert.equal(readinessPayload.job.execution.lifecycle_state, 'queued');

  const readinessJob = await waitForJob(baseUrl, readinessPayload.job.id);
  assert.equal(readinessJob.execution.command, 'readiness-pack');
  assert.equal(readinessJob.execution.lifecycle_state, 'succeeded');

  const readinessArtifactsResponse = await fetch(`${baseUrl}/jobs/${readinessJob.id}/artifacts`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(readinessArtifactsResponse.status, 200);
  const readinessArtifactsPayload = await readinessArtifactsResponse.json();
  const readinessArtifact = readinessArtifactsPayload.artifacts.find((artifact) => artifact.contract?.reentry_target === 'readiness_report');
  assert.equal(Boolean(readinessArtifact), true);
  assert.equal(readinessArtifact.contract.canonical_file_name, 'readiness_report.json');

  const packResponse = await fetch(`${baseUrl}/jobs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      type: 'pack',
      readiness_report_path: join(tmpRoot, 'jobs', readinessJob.id, 'artifacts', 'readiness_report.json'),
    }),
  });
  assert.equal(packResponse.status, 202);
  const packPayload = await packResponse.json();
  assert.equal(packPayload.job.execution.command, 'pack');

  const packJob = await waitForJob(baseUrl, packPayload.job.id);
  assert.equal(packJob.execution.lifecycle_state, 'succeeded');

  const packArtifactsResponse = await fetch(`${baseUrl}/jobs/${packJob.id}/artifacts`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(packArtifactsResponse.status, 200);
  const packArtifactsPayload = await packArtifactsResponse.json();
  const bundleArtifact = packArtifactsPayload.artifacts.find((artifact) => artifact.contract?.reentry_target === 'release_bundle');
  assert.equal(Boolean(bundleArtifact), true);
  assert.equal(bundleArtifact.contract.canonical_file_name, 'release_bundle.zip');

  await new Promise((resolveClose) => server.close(resolveClose));
  console.log('af-execution-jobs.test.js: ok');
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
