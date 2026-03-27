import express from 'express';
import { createServer } from 'node:http';
import { buildRuntimeDiagnostics } from '../../lib/runtime-diagnostics.js';
import { createJobStore } from '../services/jobs/job-store.js';
import { createJobExecutor, validateJobRequest } from '../services/jobs/job-executor.js';
import { LOCAL_API_SERVICE, LOCAL_API_VERSION } from './local-api-contract.js';
import { validateLocalApiResponse } from './local-api-schemas.js';

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
  console.log(`fcad local API listening on http://127.0.0.1:${actualPort}`);
  console.log(`Job store: ${jobStore.jobsDir}`);
  return { server, port: actualPort, jobsDir: jobStore.jobsDir };
}
