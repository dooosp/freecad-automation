import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { createLocalApiServer } from '../src/server/local-api-server.js';
import { LOCAL_API_VERSION } from '../src/server/local-api-contract.js';
import { validateLocalApiResponse } from '../src/server/local-api-schemas.js';
import { hasFreeCADRuntime } from '../lib/paths.js';

const ROOT = resolve(import.meta.dirname, '..');

function assertNoLeakedPathStrings(payload, blocked = []) {
  const serialized = JSON.stringify(payload);
  blocked.filter(Boolean).forEach((value) => {
    assert.equal(serialized.includes(String(value)), false, `Payload leaked path-like value: ${value}`);
  });
}

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
  const trackedReportName = 'demo_artifact_cleanup_integration';
  const trackedReportLeakPath = join(ROOT, 'output', `${trackedReportName}_report.pdf`);
  const configText = rewriteConfigForOutput(
    join(ROOT, 'configs', 'examples', 'ks_bracket.toml'),
    outputDir,
    'api_create_integration'
  );
  writeFileSync(configPath, configText, 'utf8');

  rmSync(trackedReportLeakPath, { force: true });

  const { server, jobStore } = createLocalApiServer({
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
    assert.equal('config_path' in created.job.request, false);
    assert.equal(JSON.stringify(created.job.request).includes(configPath), false);
    assert.equal('root' in created.job.storage, false);
    assert.equal('path' in created.job.storage.files.request, false);
    assert.equal(created.job.storage.files.request.exists, true);
    assert.equal(created.job.storage.files.log.exists, true);
    assertNoLeakedPathStrings(created, [configPath, jobsDir, tmpRoot]);

    const completedJob = await waitForJob(baseUrl, created.job.id);
    assert.equal(completedJob.status, 'succeeded', JSON.stringify(completedJob.error));
    assert.equal(Array.isArray(completedJob.artifacts.exports), true);
    assert.equal(completedJob.artifacts.exports.includes('api_create_integration.step'), true);
    assert.equal(completedJob.manifest.command, 'create');
    assert.equal(completedJob.manifest.artifacts.some((artifact) => artifact.type === 'model.step'), true);
    assert.equal('config_path' in completedJob.request, false);
    assert.equal(JSON.stringify(completedJob.request).includes(configPath), false);
    assert.equal(existsSync(join(outputDir, 'api_create_integration.step')), true);
    assert.equal('root' in completedJob.storage, false);
    assert.equal('path' in completedJob.storage.files.job, false);
    assert.equal(completedJob.storage.files.job.exists, true);
    assert.equal(completedJob.storage.files.request.exists, true);
    assert.equal(completedJob.storage.files.log.exists, true);
    assert.equal(completedJob.storage.files.manifest.exists, true);
    assertNoLeakedPathStrings(completedJob, [configPath, outputDir, jobsDir, tmpRoot]);

    const artifactResponse = await fetch(`${baseUrl}/jobs/${created.job.id}/artifacts`);
    const artifactsPayload = await artifactResponse.json();
    assert.equal(artifactsPayload.api_version, LOCAL_API_VERSION);
    assert.equal(artifactsPayload.ok, true);
    assert.equal(validateLocalApiResponse('artifacts', artifactsPayload).ok, true);
    assert.equal(artifactsPayload.manifest.command, 'create');
    assert.equal(artifactsPayload.storage.files.log.exists, true);
    assert.equal('root' in artifactsPayload.storage, false);
    assert.equal('path' in artifactsPayload.storage.files.log, false);
    assert(artifactsPayload.artifacts.some((artifact) => artifact.exists && artifact.file_name.endsWith('.step')));
    const stepArtifact = artifactsPayload.artifacts.find((artifact) => artifact.exists && artifact.file_name.endsWith('.step'));
    assert.equal('path' in stepArtifact, false);
    assert.equal(typeof stepArtifact.id, 'string');
    assert.equal(typeof stepArtifact.file_name, 'string');
    assert.equal(typeof stepArtifact.links.open, 'string');
    assert.equal(stepArtifact.capabilities.can_download, true);
    assertNoLeakedPathStrings(artifactsPayload, [configPath, outputDir, jobsDir, tmpRoot]);

    const artifactContentResponse = await fetch(`${baseUrl}${stepArtifact.links.open}`);
    assert.equal(artifactContentResponse.status, 200);
    const artifactContentBytes = await artifactContentResponse.arrayBuffer();
    assert(artifactContentBytes.byteLength > 0);

    const trackedReportResponse = await fetch(`${baseUrl}/api/studio/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'report',
        config_toml: [
          `name = "${trackedReportName}"`,
          '[[shapes]]',
          'id = "body"',
          'type = "box"',
          'length = 10',
          'width = 10',
          'height = 10',
        ].join('\n'),
        report_options: {
          style: 'summary',
        },
      }),
    });
    assert.equal(trackedReportResponse.status, 202);
    const trackedReportPayload = await trackedReportResponse.json();
    assert.equal(trackedReportPayload.ok, true);
    assert.equal(validateLocalApiResponse('job', trackedReportPayload).ok, true);
    const completedTrackedReport = await waitForJob(baseUrl, trackedReportPayload.job.id);
    assert.equal(completedTrackedReport.status, 'succeeded', JSON.stringify(completedTrackedReport.error));

    const storedTrackedReport = await jobStore.getJob(trackedReportPayload.job.id);
    const expectedTrackedPdfPath = join(jobsDir, trackedReportPayload.job.id, 'artifacts', `${trackedReportName}_report.pdf`);
    assert.equal(storedTrackedReport.artifacts.pdf, expectedTrackedPdfPath);
    assert.equal(storedTrackedReport.result.path, expectedTrackedPdfPath);
    assert.equal(existsSync(expectedTrackedPdfPath), true);
    assert.equal(existsSync(trackedReportLeakPath), false);

    const trackedReportArtifactsResponse = await fetch(`${baseUrl}/jobs/${trackedReportPayload.job.id}/artifacts`);
    assert.equal(trackedReportArtifactsResponse.status, 200);
    const trackedReportArtifactsPayload = await trackedReportArtifactsResponse.json();
    assert.equal(validateLocalApiResponse('artifacts', trackedReportArtifactsPayload).ok, true);
    const trackedPdfArtifact = trackedReportArtifactsPayload.artifacts.find((artifact) => artifact.type === 'report.pdf');
    assert(trackedPdfArtifact, 'Tracked report PDF artifact should be listed');
    assert.equal(trackedPdfArtifact.file_name, `${trackedReportName}_report.pdf`);
    assertNoLeakedPathStrings(trackedReportArtifactsPayload, [jobsDir, tmpRoot, trackedReportLeakPath]);

    const trackedPdfOpenResponse = await fetch(`${baseUrl}${trackedPdfArtifact.links.open}`);
    assert.equal(trackedPdfOpenResponse.status, 200);
    assert.match(trackedPdfOpenResponse.headers.get('content-disposition') || '', /^inline;/);
    const trackedPdfOpenBytes = await trackedPdfOpenResponse.arrayBuffer();
    assert(trackedPdfOpenBytes.byteLength > 0);

    const trackedPdfDownloadResponse = await fetch(`${baseUrl}${trackedPdfArtifact.links.download}`);
    assert.equal(trackedPdfDownloadResponse.status, 200);
    assert.match(trackedPdfDownloadResponse.headers.get('content-disposition') || '', /^attachment;/);
    const trackedPdfDownloadBytes = await trackedPdfDownloadResponse.arrayBuffer();
    assert(trackedPdfDownloadBytes.byteLength > 0);

    const recentJobsResponse = await fetch(`${baseUrl}/jobs?limit=1`);
    const recentJobsPayload = await recentJobsResponse.json();
    assert.equal(recentJobsPayload.api_version, LOCAL_API_VERSION);
    assert.equal(recentJobsPayload.ok, true);
    assert.equal(validateLocalApiResponse('jobs', recentJobsPayload).ok, true);
    assert.equal(recentJobsPayload.jobs.length, 1);
    assert.equal(recentJobsPayload.jobs[0].id, trackedReportPayload.job.id);
    assert.equal('root' in recentJobsPayload.jobs[0].storage, false);
    assert.equal('path' in recentJobsPayload.jobs[0].storage.files.job, false);
    assertNoLeakedPathStrings(recentJobsPayload, [configPath, outputDir, jobsDir, tmpRoot]);

    const validatePreviewResponse = await fetch(`${baseUrl}/api/studio/validate-config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        config_toml: configText,
      }),
    });
    assert.equal(validatePreviewResponse.status, 200);
    const validatePreviewPayload = await validatePreviewResponse.json();
    assert.equal(validatePreviewPayload.ok, true);
    assert.equal(validatePreviewPayload.overview.name, 'api_create_integration');

    const previewResponse = await fetch(`${baseUrl}/api/studio/model-preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        config_toml: configText,
        build_settings: {
          include_step: true,
        },
      }),
    });
    assert.equal(previewResponse.status, 200);
    const previewPayload = await previewResponse.json();
    assert.equal(previewPayload.ok, true);
    assert.equal(typeof previewPayload.preview.id, 'string');
    assert.equal(previewPayload.preview.model.name, 'api_create_integration');
    assert.equal(Array.isArray(previewPayload.preview.logs), true);
    assert.equal(typeof previewPayload.preview.model_asset_url, 'string');

    const previewAssetResponse = await fetch(`${baseUrl}${previewPayload.preview.model_asset_url}`);
    assert.equal(previewAssetResponse.status, 200);
    const previewAssetBytes = await previewAssetResponse.arrayBuffer();
    assert(previewAssetBytes.byteLength > 0);

    console.log('local-api.integration.test.js: ok');
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(trackedReportLeakPath, { force: true });
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}
