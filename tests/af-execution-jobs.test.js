import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { createLocalApiServer } from '../src/server/local-api-server.js';

const ROOT = resolve(import.meta.dirname, '..');
const REVIEW_PACK_FIXTURE = resolve(ROOT, 'tests/fixtures/d-artifacts/sample_review_pack.canonical.json');
const READINESS_REPORT_FIXTURE = resolve(ROOT, 'tests/fixtures/c-artifacts/sample_readiness_report.canonical.json');
const CONFIG_EXAMPLE = resolve(ROOT, 'configs/examples/controller_housing_eol.toml');
const REVIEW_CONTEXT_FIXTURE = resolve(ROOT, 'tests/fixtures/sample_part_context.json');

function writeAlignedConfig(filePath, {
  templatePath = CONFIG_EXAMPLE,
  name = 'sample_part',
  revision = 'A',
} = {}) {
  const template = readFileSync(templatePath, 'utf8');
  const next = template
    .replace(/^name = ".*"$/m, `name = "${name}"`)
    .replace(/^revision = ".*"$/m, `revision = "${revision}"`);
  writeFileSync(filePath, next, 'utf8');
}

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

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

async function fetchArtifacts(baseUrl, jobId) {
  const response = await fetch(`${baseUrl}/jobs/${jobId}/artifacts`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(response.status, 200);
  return response.json();
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-af-jobs-'));

try {
  const docsConfigPath = join(tmpRoot, 'sample_part_docs.toml');
  writeAlignedConfig(docsConfigPath);
  const reviewContextPath = join(tmpRoot, 'sample_part_context.runtime-safe.json');
  const reviewContextFixture = JSON.parse(readFileSync(REVIEW_CONTEXT_FIXTURE, 'utf8'));
  if (reviewContextFixture?.geometry_source && typeof reviewContextFixture.geometry_source === 'object') {
    delete reviewContextFixture.geometry_source.path;
  }
  writeFileSync(reviewContextPath, JSON.stringify(reviewContextFixture, null, 2), 'utf8');
  const { server } = createLocalApiServer({
    projectRoot: ROOT,
    jobsDir: join(tmpRoot, 'jobs'),
  });
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  const { response: readinessResponse, payload: readinessPayload } = await postJson(`${baseUrl}/jobs`, {
    type: 'readiness-pack',
    review_pack_path: REVIEW_PACK_FIXTURE,
  });
  assert.equal(readinessResponse.status, 202);
  assert.equal(readinessPayload.job.execution.command, 'readiness-pack');
  assert.equal(readinessPayload.job.execution.lifecycle_state, 'queued');

  const readinessJob = await waitForJob(baseUrl, readinessPayload.job.id);
  assert.equal(readinessJob.execution.command, 'readiness-pack');
  assert.equal(readinessJob.execution.lifecycle_state, 'succeeded');

  const readinessArtifactsPayload = await fetchArtifacts(baseUrl, readinessJob.id);
  const readinessArtifact = readinessArtifactsPayload.artifacts.find((artifact) => artifact.contract?.reentry_target === 'readiness_report');
  assert.equal(Boolean(readinessArtifact), true);
  assert.equal(readinessArtifact.contract.canonical_file_name, 'readiness_report.json');

  const { response: initialReviewResponse, payload: initialReviewPayload } = await postJson(`${baseUrl}/jobs`, {
    type: 'review-context',
    context_path: reviewContextPath,
  });
  assert.equal(initialReviewResponse.status, 202);
  assert.equal(initialReviewPayload.job.execution.command, 'review-context');
  const initialReviewJob = await waitForJob(baseUrl, initialReviewPayload.job.id);
  assert.equal(initialReviewJob.execution.lifecycle_state, 'succeeded');
  const initialReviewArtifactsPayload = await fetchArtifacts(baseUrl, initialReviewJob.id);
  const engineeringContextArtifact = initialReviewArtifactsPayload.artifacts.find((artifact) => artifact.type === 'engineering_context.json');
  assert.equal(Boolean(engineeringContextArtifact), true);
  const directReviewPack = initialReviewArtifactsPayload.artifacts.find((artifact) => artifact.contract?.reentry_target === 'review_pack');
  assert.equal(Boolean(directReviewPack), true);
  assert.equal(directReviewPack.contract.canonical_file_name, 'review_pack.json');

  const { response: compareResponse, payload: comparePayload } = await postJson(`${baseUrl}/jobs`, {
    type: 'compare-rev',
    baseline_path: REVIEW_PACK_FIXTURE,
    candidate_path: REVIEW_PACK_FIXTURE,
  });
  assert.equal(compareResponse.status, 202);
  assert.equal(comparePayload.job.execution.command, 'compare-rev');
  const compareJob = await waitForJob(baseUrl, comparePayload.job.id);
  assert.equal(compareJob.execution.lifecycle_state, 'succeeded');

  const { response: stabilizationResponse, payload: stabilizationPayload } = await postJson(`${baseUrl}/jobs`, {
    type: 'stabilization-review',
    baseline_path: READINESS_REPORT_FIXTURE,
    candidate_path: READINESS_REPORT_FIXTURE,
  });
  assert.equal(stabilizationResponse.status, 202);
  assert.equal(stabilizationPayload.job.execution.command, 'stabilization-review');
  const stabilizationJob = await waitForJob(baseUrl, stabilizationPayload.job.id);
  assert.equal(stabilizationJob.execution.lifecycle_state, 'succeeded');

  const { response: docsResponse, payload: docsPayload } = await postJson(`${baseUrl}/api/studio/jobs`, {
    type: 'generate-standard-docs',
    artifact_ref: {
      job_id: readinessJob.id,
      artifact_id: readinessArtifact.id,
    },
  });
  assert.equal(docsResponse.status, 202);
  assert.equal(docsPayload.job.execution.command, 'generate-standard-docs');
  assert.deepEqual(docsPayload.job.request.artifact_ref, {
    job_id: readinessJob.id,
    artifact_id: readinessArtifact.id,
  });
  const docsJob = await waitForJob(baseUrl, docsPayload.job.id);
  assert.equal(docsJob.execution.lifecycle_state, 'succeeded');

  const docsArtifactsPayload = await fetchArtifacts(baseUrl, docsJob.id);
  const docsReadinessArtifact = docsArtifactsPayload.artifacts.find((artifact) => artifact.contract?.reentry_target === 'readiness_report');
  assert.equal(Boolean(docsReadinessArtifact), true);
  const docsManifestArtifact = docsArtifactsPayload.artifacts.find((artifact) => artifact.type === 'standard-docs.summary');
  assert.equal(Boolean(docsManifestArtifact), true);
  assert.equal(docsArtifactsPayload.artifacts.some((artifact) => artifact.type === 'config.effective'), true);
  assert.equal(docsArtifactsPayload.artifacts.some((artifact) => artifact.type === 'config.input'), true);

  const { response: packFromArtifactResponse, payload: packFromArtifactPayload } = await postJson(`${baseUrl}/api/studio/jobs`, {
    type: 'pack',
    artifact_ref: {
      job_id: docsJob.id,
      artifact_id: docsReadinessArtifact.id,
    },
  });
  assert.equal(packFromArtifactResponse.status, 202);
  assert.equal(packFromArtifactPayload.job.type, 'pack');
  assert.deepEqual(packFromArtifactPayload.job.request.artifact_ref, {
    job_id: docsJob.id,
    artifact_id: docsReadinessArtifact.id,
  });

  const packJob = await waitForJob(baseUrl, packFromArtifactPayload.job.id);
  assert.equal(packJob.execution.lifecycle_state, 'succeeded');
  const packArtifactsPayload = await fetchArtifacts(baseUrl, packJob.id);
  const bundleArtifact = packArtifactsPayload.artifacts.find((artifact) => artifact.contract?.reentry_target === 'release_bundle');
  assert.equal(Boolean(bundleArtifact), true);
  assert.equal(bundleArtifact.contract.canonical_file_name, 'release_bundle.zip');
  assert.equal(packArtifactsPayload.artifacts.some((artifact) => artifact.type === 'input.docs-manifest'), true);

  const { response: repackResponse, payload: repackPayload } = await postJson(`${baseUrl}/api/studio/jobs`, {
    type: 'pack',
    artifact_ref: {
      job_id: packJob.id,
      artifact_id: bundleArtifact.id,
    },
  });
  assert.equal(repackResponse.status, 202);
  assert.equal(repackPayload.job.type, 'pack');
  assert.deepEqual(repackPayload.job.request.artifact_ref, {
    job_id: packJob.id,
    artifact_id: bundleArtifact.id,
  });

  const repackJob = await waitForJob(baseUrl, repackPayload.job.id);
  assert.equal(repackJob.execution.lifecycle_state, 'succeeded');
  const repackArtifactsPayload = await fetchArtifacts(baseUrl, repackJob.id);
  assert.equal(repackArtifactsPayload.artifacts.some((artifact) => artifact.type === 'input.release-bundle'), true);
  assert.equal(repackArtifactsPayload.artifacts.some((artifact) => artifact.type === 'input.bundle.readiness-report'), true);
  assert.equal(repackArtifactsPayload.artifacts.some((artifact) => artifact.type === 'input.bundle.docs-manifest'), true);

  await new Promise((resolveClose) => server.close(resolveClose));
  console.log('af-execution-jobs.test.js: ok');
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
