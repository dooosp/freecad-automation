import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { createLocalApiServer } from '../src/server/local-api-server.js';
import { LOCAL_API_VERSION } from '../src/server/local-api-contract.js';
import { validateLocalApiResponse } from '../src/server/local-api-schemas.js';
import { hasFreeCADRuntime } from '../lib/paths.js';

const ROOT = resolve(import.meta.dirname, '..');

function rewriteConfigForOutput(sourcePath, outputDir, nextName) {
  const source = readFileSync(sourcePath, 'utf8');
  return source
    .replace(/^name\s*=\s*"[^"]*"/m, `name = "${nextName}"`)
    .replace(/directory\s*=\s*"[^"]*"/m, `directory = "${outputDir.replace(/\\/g, '\\\\')}"`);
}

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

async function waitForJob(baseUrl, jobId, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`${baseUrl}/jobs/${jobId}`);
    const payload = await response.json();
    if (payload.job.status === 'succeeded' || payload.job.status === 'failed') {
      return payload.job;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

if (!hasFreeCADRuntime()) {
  console.log('local-api.integration.test.js: skipped (FreeCAD runtime unavailable)');
} else {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-local-api-int-'));
  const jobsDir = join(tmpRoot, 'jobs');
  const outputDir = join(tmpRoot, 'output');
  const configPath = join(tmpRoot, 'api-create.toml');
  const configText = rewriteConfigForOutput(
    join(ROOT, 'configs', 'examples', 'ks_bracket.toml'),
    outputDir,
    'api_create_integration'
  );
  writeFileSync(configPath, configText, 'utf8');

  const { server } = createLocalApiServer({
    projectRoot: ROOT,
    jobsDir,
  });

  try {
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}`;

    const healthResponse = await fetch(`${baseUrl}/health`);
    const health = await healthResponse.json();
    assert.equal(health.api_version, LOCAL_API_VERSION);
    assert.equal(health.ok, true);
    assert.equal(health.status, 'ok');
    assert.equal(typeof health.runtime.available, 'boolean');
    assert.equal(typeof health.runtime.description, 'string');
    assert.equal(typeof health.runtime.diagnostics_version, 'string');
    assert.equal(Array.isArray(health.runtime.command_classes.freecad_backed), true);
    assert.equal(validateLocalApiResponse('health', health).ok, true);

    const createResponse = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'create',
        config_path: configPath,
      }),
    });
    assert.equal(createResponse.status, 202);
    const created = await createResponse.json();
    assert.equal(created.api_version, LOCAL_API_VERSION);
    assert.equal(created.ok, true);
    assert.equal(validateLocalApiResponse('job', created).ok, true);
    assert.equal(created.job.storage.files.request.exists, true);
    assert.equal(created.job.storage.files.log.exists, true);

    const completedJob = await waitForJob(baseUrl, created.job.id);
    assert.equal(completedJob.status, 'succeeded', JSON.stringify(completedJob.error));
    assert.equal(Array.isArray(completedJob.artifacts.exports), true);
    assert.equal(completedJob.manifest.command, 'create');
    assert.equal(completedJob.manifest.artifacts.some((artifact) => artifact.type === 'model.step'), true);
    assert.equal(existsSync(join(outputDir, 'api_create_integration.step')), true);
    assert.equal(completedJob.storage.files.job.exists, true);
    assert.equal(completedJob.storage.files.request.exists, true);
    assert.equal(completedJob.storage.files.log.exists, true);
    assert.equal(completedJob.storage.files.manifest.exists, true);

    const artifactResponse = await fetch(`${baseUrl}/jobs/${created.job.id}/artifacts`);
    const artifactsPayload = await artifactResponse.json();
    assert.equal(artifactsPayload.api_version, LOCAL_API_VERSION);
    assert.equal(artifactsPayload.ok, true);
    assert.equal(validateLocalApiResponse('artifacts', artifactsPayload).ok, true);
    assert.equal(artifactsPayload.manifest.command, 'create');
    assert.equal(artifactsPayload.storage.files.log.exists, true);
    assert(artifactsPayload.artifacts.some((artifact) => artifact.exists && artifact.path.endsWith('.step')));

    const recentJobsResponse = await fetch(`${baseUrl}/jobs?limit=1`);
    const recentJobsPayload = await recentJobsResponse.json();
    assert.equal(recentJobsPayload.api_version, LOCAL_API_VERSION);
    assert.equal(recentJobsPayload.ok, true);
    assert.equal(validateLocalApiResponse('jobs', recentJobsPayload).ok, true);
    assert.equal(recentJobsPayload.jobs.length, 1);
    assert.equal(recentJobsPayload.jobs[0].id, created.job.id);

    console.log('local-api.integration.test.js: ok');
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}
