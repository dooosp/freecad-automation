import express from 'express';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { buildRuntimeDiagnostics } from '../../lib/runtime-diagnostics.js';
import { createJobStore } from '../services/jobs/job-store.js';
import { createJobExecutor, validateJobRequest } from '../services/jobs/job-executor.js';
import { LOCAL_API_SERVICE, LOCAL_API_VERSION } from './local-api-contract.js';
import { validateLocalApiResponse } from './local-api-schemas.js';

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public');
const STUDIO_HTML = join(PUBLIC_DIR, 'studio.html');
const STUDIO_CSS = join(PUBLIC_DIR, 'css', 'studio.css');
const STUDIO_SHELL_JS = join(PUBLIC_DIR, 'js', 'studio-shell.js');
const APP_JS_DIR = join(PUBLIC_DIR, 'js', 'app');
const STUDIO_JS_DIR = join(PUBLIC_DIR, 'js', 'studio');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createErrorResponse(code, messages, status = 400) {
  return {
    status,
    body: {
      api_version: LOCAL_API_VERSION,
      ok: false,
      error: {
        code,
        messages,
      },
    },
  };
}

function buildLandingPayload({
  projectRoot,
  jobsDir,
}) {
  return {
    api_version: LOCAL_API_VERSION,
    ok: true,
    status: 'ok',
    service: LOCAL_API_SERVICE,
    mode: 'local_api',
    project_root: projectRoot,
    jobs_dir: jobsDir,
    endpoints: {
      health: '/health',
      jobs: '/jobs',
    },
    studio: {
      available: true,
      path: '/studio',
      note: 'Future-facing browser shell served in parallel with the local API.',
    },
    viewer: {
      available: true,
      command: 'fcad serve --legacy-viewer',
      npm_script: 'npm run serve:legacy',
    },
    examples: {
      health_curl: 'curl http://127.0.0.1:3000/health',
    },
    notes: [
      'This server is the local API, not the legacy browser viewer.',
      'Open /studio for the parallel browser shell foundation.',
      'Open /health for the runtime diagnostics payload and POST /jobs to enqueue work.',
      'If localhost resolves to another listener on your machine, use 127.0.0.1 explicitly.',
    ],
  };
}

function renderLandingPage(payload) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>fcad Local API</title>
  <style>
    :root {
      color-scheme: light;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f7fb;
      color: #18212f;
    }
    body {
      margin: 0;
      padding: 32px 20px;
      background:
        radial-gradient(circle at top right, rgba(82, 153, 255, 0.18), transparent 32%),
        linear-gradient(180deg, #f7f9fc 0%, #eef2f7 100%);
    }
    main {
      max-width: 760px;
      margin: 0 auto;
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(24, 33, 47, 0.08);
      border-radius: 20px;
      padding: 28px;
      box-shadow: 0 20px 60px rgba(24, 33, 47, 0.08);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 1.9rem;
    }
    p, li {
      line-height: 1.6;
    }
    code, pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.95rem;
    }
    .card {
      margin-top: 18px;
      padding: 16px;
      background: #f4f7fb;
      border-radius: 14px;
      border: 1px solid rgba(24, 33, 47, 0.08);
    }
    pre {
      margin: 12px 0 0;
      padding: 14px;
      overflow-x: auto;
      background: #18212f;
      color: #f4f7fb;
      border-radius: 12px;
    }
    ul {
      padding-left: 20px;
    }
    a {
      color: #0b57d0;
    }
  </style>
</head>
<body>
  <main>
    <h1>fcad Local API</h1>
    <p>This server is the local API for job orchestration. It does not serve the legacy browser viewer UI.</p>
    <div class="card">
      <strong>Project root</strong>
      <div><code>${escapeHtml(payload.project_root)}</code></div>
    </div>
    <div class="card">
      <strong>API endpoints</strong>
      <ul>
        <li><a href="/health"><code>GET /health</code></a> for runtime diagnostics</li>
        <li><a href="/jobs"><code>/jobs</code></a> for job creation targets and route discovery</li>
        <li><a href="/jobs/example-job"><code>/jobs/:id</code></a> to inspect a job status response shape</li>
        <li><a href="/jobs/example-job/artifacts"><code>/jobs/:id/artifacts</code></a> to inspect artifact response shape</li>
      </ul>
    </div>
    <div class="card">
      <strong>Parallel studio shell</strong>
      <p><a href="${escapeHtml(payload.studio.path)}"><code>${escapeHtml(payload.studio.path)}</code></a> hosts the new workspace-style browser shell while the legacy viewer remains available separately.</p>
    </div>
    <div class="card">
      <strong>Quick check</strong>
      <pre>${escapeHtml(payload.examples.health_curl)}</pre>
    </div>
    <div class="card">
      <strong>Need the browser demo instead?</strong>
      <pre>${escapeHtml(payload.viewer.command)}
${escapeHtml(payload.viewer.npm_script)}</pre>
    </div>
    <div class="card">
      <strong>Tip</strong>
      <p>If <code>http://localhost</code> shows a different process on your machine, open <code>http://127.0.0.1</code> with the same port explicitly.</p>
    </div>
  </main>
</body>
</html>`;
}

function assertResponse(kind, payload) {
  const validation = validateLocalApiResponse(kind, payload);
  if (!validation.ok) {
    throw new Error(`Invalid ${kind} response: ${validation.errors.join(' | ')}`);
  }
  return payload;
}

export function buildHealthPayload({
  jobsDir,
  runtimeDiagnostics = buildRuntimeDiagnostics(),
}) {
  return {
    api_version: LOCAL_API_VERSION,
    ok: true,
    status: 'ok',
    service: LOCAL_API_SERVICE,
    jobs_dir: jobsDir,
    runtime: runtimeDiagnostics,
  };
}

async function toJobResponse(jobStore, job) {
  const storage = await jobStore.describeStorage(job.id);
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    created_at: job.created_at,
    updated_at: job.updated_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    error: job.error,
    request: job.request,
    diagnostics: job.diagnostics,
    artifacts: job.artifacts,
    manifest: job.manifest,
    result: job.result,
    status_history: job.status_history,
    storage,
    links: {
      self: `/jobs/${job.id}`,
      artifacts: `/jobs/${job.id}/artifacts`,
    },
  };
}

export function createLocalApiServer({
  projectRoot,
  jobsDir,
  runtimeDiagnosticsFactory = buildRuntimeDiagnostics,
}) {
  const app = express();
  const server = createServer(app);
  const jobStore = createJobStore({ jobsDir });
  const executor = createJobExecutor({
    projectRoot,
    jobStore,
  });

  app.use(express.json({ limit: '5mb' }));
  app.use('/js/app', express.static(APP_JS_DIR, { index: false }));
  app.use('/js/studio', express.static(STUDIO_JS_DIR, { index: false }));

  app.use((error, _req, res, next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      const response = createErrorResponse('invalid_json', ['Request body must be valid JSON.']);
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }
    next(error);
  });

  app.get('/health', (_req, res) => {
    const payload = buildHealthPayload({
      jobsDir: jobStore.jobsDir,
      runtimeDiagnostics: runtimeDiagnosticsFactory(),
    });
    res.json(assertResponse('health', payload));
  });

  app.get('/', (req, res) => {
    const payload = buildLandingPayload({
      projectRoot,
      jobsDir: jobStore.jobsDir,
    });
    const accepted = req.accepts(['html', 'json', 'text']);
    if (accepted === 'json') {
      res.json(payload);
      return;
    }
    if (accepted === 'text') {
      res.type('text/plain').send([
        'fcad local API',
        'This server is the local API, not the legacy browser viewer.',
        `Project root: ${projectRoot}`,
        'Health: /health',
        'Studio shell: /studio',
        'Jobs: POST /jobs',
        'Job status shape: /jobs/example-job',
        'Artifact shape: /jobs/example-job/artifacts',
        'Quick check: curl http://127.0.0.1:3000/health',
        'Parallel browser shell: /studio',
        'Browser demo: fcad serve --legacy-viewer',
        'Fallback browser demo: npm run serve:legacy',
      ].join('\n'));
      return;
    }
    res.type('html').send(renderLandingPage(payload));
  });

  app.get(['/studio', '/studio/'], (_req, res) => {
    res.sendFile(STUDIO_HTML);
  });

  app.get('/css/studio.css', (_req, res) => {
    res.sendFile(STUDIO_CSS);
  });

  app.get('/js/studio-shell.js', (_req, res) => {
    res.sendFile(STUDIO_SHELL_JS);
  });

  app.post('/jobs', async (req, res) => {
    const validation = validateJobRequest(req.body);
    if (!validation.ok) {
      const response = createErrorResponse('invalid_request', validation.errors);
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }

    const job = await jobStore.createJob(validation.request);
    const payload = {
      api_version: LOCAL_API_VERSION,
      ok: true,
      job: await toJobResponse(jobStore, job),
    };
    res.status(202).json(assertResponse('job', payload));

    setImmediate(() => {
      executor.execute(job.id).catch(() => {
        // The executor persists failures in the job store.
      });
    });
  });

  app.get('/jobs/:id', async (req, res) => {
    try {
      const job = await jobStore.getJob(req.params.id);
      const payload = {
        api_version: LOCAL_API_VERSION,
        ok: true,
        job: await toJobResponse(jobStore, job),
      };
      res.json(assertResponse('job', payload));
    } catch {
      const response = createErrorResponse('job_not_found', [`No job found for id ${req.params.id}.`], 404);
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.get('/jobs/:id/artifacts', async (req, res) => {
    try {
      const job = await jobStore.getJob(req.params.id);
      const artifacts = await jobStore.listArtifacts(req.params.id);
      const storage = await jobStore.describeStorage(req.params.id);
      const payload = {
        api_version: LOCAL_API_VERSION,
        ok: true,
        job_id: req.params.id,
        artifacts,
        manifest: job.manifest,
        storage,
      };
      res.json(assertResponse('artifacts', payload));
    } catch {
      const response = createErrorResponse('job_not_found', [`No job found for id ${req.params.id}.`], 404);
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.use((error, _req, res, _next) => {
    const response = createErrorResponse(
      'internal_error',
      [error instanceof Error ? error.message : String(error)],
      500
    );
    res.status(response.status).json(assertResponse('error', response.body));
  });

  return {
    app,
    server,
    jobStore,
    executor,
  };
}

export async function startLocalApiServer({
  port = 3000,
  jobsDir,
  projectRoot,
}) {
  const { server, jobStore } = createLocalApiServer({
    projectRoot,
    jobsDir,
  });

  await new Promise((resolveListen) => {
    server.listen(port, '127.0.0.1', resolveListen);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`Project root: ${projectRoot}`);
  console.log(`fcad local API listening on http://127.0.0.1:${actualPort}`);
  console.log(`Open http://127.0.0.1:${actualPort}/ for API info page`);
  console.log(`Studio shell: http://127.0.0.1:${actualPort}/studio`);
  console.log(`Health endpoint: http://127.0.0.1:${actualPort}/health`);
  console.log('This is the local API, not the legacy browser viewer.');
  console.log(`Legacy viewer: fcad serve ${actualPort} --legacy-viewer`);
  console.log('If localhost resolves to another process on your machine, use 127.0.0.1 explicitly.');
  console.log(`Job store: ${jobStore.jobsDir}`);
  return { server, port: actualPort, jobsDir: jobStore.jobsDir };
}
