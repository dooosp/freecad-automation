import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { createLocalApiServer } from '../src/server/local-api-server.js';

const ROOT = resolve(import.meta.dirname, '..');

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
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

async function waitForJob(baseUrl, jobId, expectedStatus = 'succeeded') {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${baseUrl}/jobs/${jobId}`, {
      headers: {
        accept: 'application/json',
      },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    if (payload.job.status === expectedStatus) return payload.job;
    if (payload.job.status === 'failed') {
      throw new Error(`Job ${jobId} failed: ${payload.job.error?.message || 'unknown error'}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const repoTmpBase = join(ROOT, 'tmp/codex');
mkdirSync(repoTmpBase, { recursive: true });
const repoTmpRoot = mkdtempSync(join(repoTmpBase, 'fcad-evidence-graph-job-'));
let server;

try {
  const created = createLocalApiServer({
    projectRoot: ROOT,
    jobsDir: join(repoTmpRoot, 'jobs'),
  });
  server = created.server;
  const { jobStore } = created;
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  const { response, payload } = await postJson(`${baseUrl}/api/studio/jobs`, {
    type: 'evidence-graph',
    package_id: 'quality-pass-bracket',
    review_pack_path: 'docs/examples/quality-pass-bracket/review/review_pack.json',
    readiness_report_path: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
  });

  assert.equal(response.status, 202, JSON.stringify(payload));
  assert.equal(payload.job.type, 'evidence-graph');
  assert.equal(payload.job.request.package_id, 'quality-pass-bracket');
  assert.equal('review_pack_path' in payload.job.request, false);
  assert.equal('readiness_report_path' in payload.job.request, false);

  const job = await waitForJob(baseUrl, payload.job.id);
  assert.equal(job.execution.command, 'evidence-graph');
  assert.equal(job.execution.lifecycle_state, 'succeeded');

  const artifactsPayload = await fetchArtifacts(baseUrl, job.id);
  const evidenceGraphArtifact = artifactsPayload.artifacts.find((artifact) => artifact.type === 'evidence-graph.json');
  assert.equal(Boolean(evidenceGraphArtifact), true);
  assert.equal(evidenceGraphArtifact.scope, 'user-facing');
  assert.equal(evidenceGraphArtifact.file_name, 'evidence_graph.json');

  const storedArtifacts = await jobStore.listArtifacts(job.id);
  const storedEvidenceGraphArtifact = storedArtifacts.find((artifact) => artifact.type === 'evidence-graph.json');
  assert.equal(Boolean(storedEvidenceGraphArtifact), true);
  assert.equal(basename(storedEvidenceGraphArtifact.path), 'evidence_graph.json');
  assert.equal(existsSync(storedEvidenceGraphArtifact.path), true);

  const graph = readJson(storedEvidenceGraphArtifact.path);
  assert.equal(graph.schema_version, '1.0');
  assert.equal(graph.artifact_type, 'evidence_graph');
  assert.equal(graph.package_id, 'quality-pass-bracket');
  assert.deepEqual(graph.source_artifact_refs.map((ref) => ref.artifact_type), ['review_pack', 'readiness_report']);
  assert.deepEqual(graph.source_artifact_refs.map((ref) => ref.path), [
    'docs/examples/quality-pass-bracket/review/review_pack.json',
    'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
  ]);

  const persistedJob = await jobStore.getJob(job.id);
  assert.equal(
    persistedJob.manifest.artifacts.some((artifact) => artifact.type === 'input.review-pack'),
    true,
    'tracked evidence graph job should record review-pack input provenance'
  );
  assert.equal(
    persistedJob.manifest.artifacts.some((artifact) => artifact.type === 'input.readiness-report'),
    true,
    'tracked evidence graph job should record readiness-report input provenance'
  );

  await new Promise((resolveClose) => server.close(resolveClose));
  server = null;
  console.log('evidence-graph-tracked-job.test.js: ok');
} finally {
  if (server) {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  rmSync(repoTmpRoot, { recursive: true, force: true });
}
