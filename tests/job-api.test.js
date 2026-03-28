import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildArtifactManifest } from '../lib/artifact-manifest.js';
import { createJobStore } from '../src/services/jobs/job-store.js';
import { LOCAL_API_VERSION } from '../src/server/local-api-contract.js';
import { toPublicJobRequest } from '../src/server/public-job-request.js';
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

  const publicArtifactRequest = toPublicJobRequest({
    type: 'report',
    config_path: '/tmp/private/effective-config.json',
    options: {
      override_path: '/tmp/private/override.toml',
      studio: {
        source: 'artifact-reference',
        source_job_id: 'job-upstream',
        source_artifact_id: 'effective-config',
        source_artifact_type: 'config.effective',
        source_label: 'Effective config copy',
        source_artifact_path: '/tmp/private/effective-config.json',
      },
      metadata: {
        nested_path: 'C:\\temp\\private\\source.fcstd',
      },
    },
  });
  assert.equal(publicArtifactRequest.type, 'report');
  assert.deepEqual(publicArtifactRequest.artifact_ref, {
    job_id: 'job-upstream',
    artifact_id: 'effective-config',
  });
  assert.equal(publicArtifactRequest.source_label, 'Effective config copy');
  assert.equal('config_path' in publicArtifactRequest, false);
  assert.equal('source_artifact_path' in (publicArtifactRequest.options?.studio || {}), false);
  assert.equal(publicArtifactRequest.options.override_path, 'override.toml');
  assert.equal(publicArtifactRequest.options.metadata.nested_path, 'source.fcstd');
  assert.equal(JSON.stringify(publicArtifactRequest).includes('/tmp/private'), false);
  assert.equal(JSON.stringify(publicArtifactRequest).includes('C:\\\\temp\\\\private'), false);

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
  assert.match(artifacts[0].id, /sample|report-sample|artifact/i);
  assert.equal(artifacts[0].key, 'Sample artifact');
  assert.equal(artifacts[0].type, 'report.sample');
  assert.equal(artifacts[0].file_name, 'sample.json');
  assert.equal(artifacts[0].extension, '.json');
  const apiArtifacts = artifacts.map((artifact) => ({
    ...artifact,
    content_type: 'application/json; charset=utf-8',
    capabilities: {
      can_open: true,
      can_download: true,
      browser_safe: true,
    },
    links: {
      open: `/jobs/${job.id}/artifacts/${artifact.id}/content`,
      download: `/jobs/${job.id}/artifacts/${artifact.id}/content?download=1`,
    },
  }));

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
      retried_from_job_id: persistedJob.retried_from_job_id,
      request: toPublicJobRequest(persistedJob.request),
      diagnostics: persistedJob.diagnostics,
      artifacts: persistedJob.artifacts,
      manifest: persistedJob.manifest,
      result: persistedJob.result,
      status_history: persistedJob.status_history,
      storage,
      capabilities: {
        cancellation_supported: false,
        retry_supported: false,
      },
      links: {
        self: `/jobs/${job.id}`,
        artifacts: `/jobs/${job.id}/artifacts`,
        cancel: `/jobs/${job.id}/cancel`,
        retry: `/jobs/${job.id}/retry`,
      },
    },
  });
  assert.equal(responseValidation.ok, true, responseValidation.errors.join('\n'));

  const artifactsResponseValidation = validateLocalApiResponse('artifacts', {
    api_version: LOCAL_API_VERSION,
    ok: true,
    job_id: job.id,
    artifacts: apiArtifacts,
    manifest: persistedJob.manifest,
    storage,
  });
  assert.equal(artifactsResponseValidation.ok, true, artifactsResponseValidation.errors.join('\n'));

  console.log('job-api.test.js: ok');
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
