import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildArtifactManifest } from '../lib/artifact-manifest.js';
import { createJobStore } from '../src/services/jobs/job-store.js';
import { LOCAL_API_VERSION } from '../src/server/local-api-contract.js';
import { validateJobRequest } from '../src/services/jobs/job-executor.js';
import { validateLocalApiResponse } from '../src/server/local-api-schemas.js';

const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-job-api-'));

try {
  const invalid = validateJobRequest({ type: 'draw' });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join('\n'), /config_path|config/);

  const invalidExtraField = validateJobRequest({
    type: 'inspect',
    file_path: 'output/sample.step',
    unexpected: true,
  });
  assert.equal(invalidExtraField.ok, false);
  assert.match(invalidExtraField.errors.join('\n'), /unsupported property "unexpected"/);

  const invalidDualConfig = validateJobRequest({
    type: 'create',
    config_path: 'configs/examples/ks_bracket.toml',
    config: { name: 'duplicate-source' },
  });
  assert.equal(invalidDualConfig.ok, false);
  assert.match(invalidDualConfig.errors.join('\n'), /must NOT be valid|unsupported|config/);

  const valid = validateJobRequest({
    type: 'report',
    config: {
      name: 'api_report',
      shapes: [{ id: 'body', type: 'box', length: 10, width: 10, height: 10 }],
      export: { formats: ['step'], directory: 'output' },
    },
    options: {
      include_tolerance: false,
    },
  });
  assert.equal(valid.ok, true);

  const store = createJobStore({ jobsDir: join(tmpRoot, 'jobs') });
  const job = await store.createJob(valid.request);
  await store.appendLog(job.id, 'queued');

  const artifactPath = await store.writeJobFile(job.id, 'artifacts/sample.json', '{"ok":true}\n');
  const manifest = await buildArtifactManifest({
    projectRoot: process.cwd(),
    interface: 'api',
    command: 'report',
    jobType: 'report',
    status: 'succeeded',
    requestId: job.id,
    artifacts: [
      {
        type: 'report.sample',
        path: artifactPath,
        label: 'Sample artifact',
        scope: 'user-facing',
        stability: 'stable',
      },
    ],
    timestamps: {
      created_at: job.created_at,
      started_at: job.started_at,
      finished_at: new Date().toISOString(),
    },
  });
  await store.completeJob(job.id, { success: true }, { sample: artifactPath }, { config_warnings: [] }, manifest);

  const persistedJob = await store.getJob(job.id);
  assert.equal(persistedJob.status, 'succeeded');
  assert.equal(persistedJob.result.success, true);
  assert.equal(persistedJob.manifest.manifest_version, '1.0');
  assert.equal(persistedJob.manifest.command, 'report');
  assert.match(readFileSync(persistedJob.paths.log, 'utf8'), /queued/);

  const artifacts = await store.listArtifacts(job.id);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].exists, true);
  assert.equal(artifacts[0].key, 'Sample artifact');
  assert.equal(artifacts[0].type, 'report.sample');

  const storage = await store.describeStorage(job.id);
  assert.equal(storage.root.endsWith(job.id), true);
  assert.equal(storage.files.job.exists, true);
  assert.equal(storage.files.request.exists, true);
  assert.equal(storage.files.log.exists, true);
  assert.equal(storage.files.manifest.exists, true);

  const responseValidation = validateLocalApiResponse('job', {
    api_version: LOCAL_API_VERSION,
    ok: true,
    job: {
      id: job.id,
      type: job.type,
      status: persistedJob.status,
      created_at: persistedJob.created_at,
      updated_at: persistedJob.updated_at,
      started_at: persistedJob.started_at,
      finished_at: persistedJob.finished_at,
      error: persistedJob.error,
      request: persistedJob.request,
      diagnostics: persistedJob.diagnostics,
      artifacts: persistedJob.artifacts,
      manifest: persistedJob.manifest,
      result: persistedJob.result,
      status_history: persistedJob.status_history,
      storage,
      links: {
        self: `/jobs/${job.id}`,
        artifacts: `/jobs/${job.id}/artifacts`,
      },
    },
  });
  assert.equal(responseValidation.ok, true, responseValidation.errors.join('\n'));

  const artifactsResponseValidation = validateLocalApiResponse('artifacts', {
    api_version: LOCAL_API_VERSION,
    ok: true,
    job_id: job.id,
    artifacts,
    manifest: persistedJob.manifest,
    storage,
  });
  assert.equal(artifactsResponseValidation.ok, true, artifactsResponseValidation.errors.join('\n'));

  console.log('job-api.test.js: ok');
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
