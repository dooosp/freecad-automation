import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { buildArtifactManifest } from '../lib/artifact-manifest.js';
import { createLocalApiServer } from '../src/server/local-api-server.js';
import { validateLocalApiResponse } from '../src/server/local-api-schemas.js';

const ROOT = resolve(import.meta.dirname, '..');
const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-local-api-root-'));
const jobsDir = join(tmpRoot, 'jobs');

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

async function waitFor(assertion, { attempts = 10, delayMs = 50 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
      }
    }
  }
  throw lastError;
}

const { server, jobStore } = createLocalApiServer({
  projectRoot: ROOT,
  jobsDir,
});

try {
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  const htmlResponse = await fetch(baseUrl, {
    headers: {
      accept: 'text/html',
    },
    redirect: 'manual',
  });
  assert.equal(htmlResponse.status, 302);
  assert.equal(htmlResponse.headers.get('location'), '/studio/');

  const apiHtmlResponse = await fetch(`${baseUrl}/api`, {
    headers: {
      accept: 'text/html',
    },
  });
  assert.equal(apiHtmlResponse.status, 200);
  const html = await apiHtmlResponse.text();
  assert.match(html, /fcad Local API/);
  assert.match(html, /Browser requests to <code>\/<\/code> now land in the studio shell/);
  assert.match(html, /GET \/health/);
  assert.match(html, /\/studio/);
  assert.match(html, /GET \/api/);
  assert.match(html, /fcad serve --legacy-viewer/);
  assert.match(html, new RegExp(ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const jsonResponse = await fetch(baseUrl, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(jsonResponse.status, 200);
  const payload = await jsonResponse.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, 'local_api');
  assert.equal(payload.project_root, ROOT);
  assert.equal(payload.endpoints.health, '/health');
  assert.equal(payload.api_info.path, '/api');
  assert.equal(payload.studio.preferred_path, '/');
  assert.equal(payload.studio.path, '/studio');
  assert.equal(payload.viewer.command, 'fcad serve --legacy-viewer');

  const apiJsonResponse = await fetch(`${baseUrl}/api`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(apiJsonResponse.status, 200);
  const apiPayload = await apiJsonResponse.json();
  assert.equal(apiPayload.ok, true);
  assert.equal(apiPayload.mode, 'local_api');

  const studioResponse = await fetch(`${baseUrl}/studio`);
  assert.equal(studioResponse.status, 200);
  const studioHtml = await studioResponse.text();
  assert.match(studioHtml, /FreeCAD Automation Studio/);
  assert.match(studioHtml, /workspace-nav/);

  const studioCssResponse = await fetch(`${baseUrl}/css/studio.css`);
  assert.equal(studioCssResponse.status, 200);
  const studioCss = await studioCssResponse.text();
  assert.match(studioCss, /--canvas-0/);
  assert.match(studioCss, /\.action-grid/);

  const examplesResponse = await fetch(`${baseUrl}/api/examples`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(examplesResponse.status, 200);
  const examples = await examplesResponse.json();
  assert.equal(Array.isArray(examples), true);
  assert.equal(examples.length > 0, true);
  assert.equal(typeof examples[0].name, 'string');
  assert.equal(typeof examples[0].content, 'string');

  const profilesResponse = await fetch(`${baseUrl}/api/config/profiles`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(profilesResponse.status, 200);
  const profilesPayload = await profilesResponse.json();
  assert.equal(profilesPayload.ok, true);
  assert.equal(Array.isArray(profilesPayload.profiles), true);
  assert.equal(profilesPayload.profiles.length > 0, true);
  assert.equal(typeof profilesPayload.profiles[0].name, 'string');

  const validateResponse = await fetch(`${baseUrl}/api/studio/validate-config`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      config_toml: readFileSync(join(ROOT, 'configs', 'examples', 'ks_bracket.toml'), 'utf8'),
    }),
  });
  assert.equal(validateResponse.status, 200);
  const validationPayload = await validateResponse.json();
  assert.equal(validationPayload.ok, true);
  assert.equal(validationPayload.overview.mode, 'part');
  assert.equal(typeof validationPayload.overview.shape_count, 'number');
  assert.equal(Array.isArray(validationPayload.validation.warnings), true);

  const studioJobResponse = await fetch(`${baseUrl}/api/studio/jobs`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: 'draw',
      config_toml: readFileSync(join(ROOT, 'configs', 'examples', 'ks_bracket.toml'), 'utf8'),
      drawing_settings: {
        views: ['front', 'iso'],
        scale: '1:2',
      },
      options: {
        qa: true,
      },
    }),
  });
  assert.equal(studioJobResponse.status, 202);
  const studioJobPayload = await studioJobResponse.json();
  assert.equal(studioJobPayload.ok, true);
  assert.equal(validateLocalApiResponse('job', studioJobPayload).ok, true);
  assert.equal(studioJobPayload.job.type, 'draw');
  assert.deepEqual(studioJobPayload.job.request.config.drawing.views, ['front', 'iso']);
  assert.equal(studioJobPayload.job.request.config.drawing.scale, '1:2');
  assert.equal(studioJobPayload.job.request.options.qa, true);

  await waitFor(async () => {
    const jobsResponse = await fetch(`${baseUrl}/jobs?limit=5`, {
      headers: {
        accept: 'application/json',
      },
    });
    assert.equal(jobsResponse.status, 200);
    const jobsPayload = await jobsResponse.json();
    assert.equal(jobsPayload.ok, true);
    assert.equal(jobsPayload.jobs.length >= 1, true);
    assert.equal(jobsPayload.jobs[0].id, studioJobPayload.job.id);
  });

  const job = await jobStore.createJob({
    type: 'report',
    config: {
      name: 'artifact_route_test',
      shapes: [{ id: 'body', type: 'box', length: 10, width: 10, height: 10 }],
      export: { formats: ['step'], directory: 'output' },
    },
  });
  const artifactPath = await jobStore.writeJobFile(job.id, 'artifacts/studio-note.json', '{"ok":true}\n');
  const manifest = await buildArtifactManifest({
    projectRoot: ROOT,
    interface: 'api',
    command: 'report',
    jobType: 'report',
    status: 'succeeded',
    requestId: job.id,
    artifacts: [
      {
        type: 'report.sample',
        path: artifactPath,
        label: 'Studio note',
        scope: 'user-facing',
        stability: 'stable',
      },
    ],
    timestamps: {
      created_at: job.created_at,
      finished_at: new Date().toISOString(),
    },
  });
  await jobStore.completeJob(job.id, { success: true }, { sample: artifactPath }, {}, manifest);

  const artifactListResponse = await fetch(`${baseUrl}/jobs/${job.id}/artifacts`);
  assert.equal(artifactListResponse.status, 200);
  const artifactListPayload = await artifactListResponse.json();
  assert.equal(artifactListPayload.artifacts.length, 1);
  assert.equal(artifactListPayload.artifacts[0].file_name, 'studio-note.json');
  assert.equal(artifactListPayload.artifacts[0].extension, '.json');
  assert.equal(artifactListPayload.artifacts[0].content_type, 'application/json; charset=utf-8');
  assert.equal(artifactListPayload.artifacts[0].capabilities.can_open, true);
  assert.equal(artifactListPayload.artifacts[0].capabilities.can_download, true);
  assert.match(artifactListPayload.artifacts[0].links.open, new RegExp(`/artifacts/${job.id}/.+`));
  assert.match(artifactListPayload.artifacts[0].links.download, new RegExp(`/artifacts/${job.id}/.+/download$`));
  assert.match(artifactListPayload.artifacts[0].links.api, new RegExp(`/jobs/${job.id}/artifacts/.+/content$`));

  const artifactOpenResponse = await fetch(`${baseUrl}${artifactListPayload.artifacts[0].links.open}`);
  assert.equal(artifactOpenResponse.status, 200);
  assert.match(artifactOpenResponse.headers.get('content-disposition') || '', /^inline;/);
  assert.equal(await artifactOpenResponse.text(), '{"ok":true}\n');

  const artifactDownloadResponse = await fetch(`${baseUrl}${artifactListPayload.artifacts[0].links.download}`);
  assert.equal(artifactDownloadResponse.status, 200);
  assert.match(artifactDownloadResponse.headers.get('content-disposition') || '', /^attachment;/);

  const artifactApiResponse = await fetch(`${baseUrl}${artifactListPayload.artifacts[0].links.api}`);
  assert.equal(artifactApiResponse.status, 200);
  assert.match(artifactApiResponse.headers.get('content-disposition') || '', /^inline;/);

  console.log('local-api-server.test.js: ok');
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(tmpRoot, { recursive: true, force: true });
}
