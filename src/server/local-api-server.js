import express from 'express';
import { createServer } from 'node:http';
import { buildRuntimeDiagnostics } from '../../lib/runtime-diagnostics.js';
import { createJobStore } from '../services/jobs/job-store.js';
import { createJobExecutor } from '../services/jobs/job-executor.js';
import { createBootstrapImportService } from '../services/import/bootstrap-import-service.js';
import { createStudioModelService } from './studio-model-service.js';
import { createStudioDrawingService } from './studio-drawing-service.js';
import { createInvalidJsonMiddleware, createInternalErrorMiddleware } from './local-api-response-helpers.js';
import { createLocalApiJobCoordinator } from './local-api-job-operations.js';
import { registerArtifactRoutes } from './routes/local-api-artifact-routes.js';
import { registerJobRoutes } from './routes/local-api-job-routes.js';
import { registerLandingRoutes } from './routes/local-api-landing-routes.js';
import { registerOperationalRoutes } from './routes/local-api-operational-routes.js';
import { registerStudioRoutes } from './routes/local-api-studio-routes.js';

export { buildHealthPayload } from './local-api-health.js';

export function createLocalApiServer({
  projectRoot,
  jobsDir,
  runtimeDiagnosticsFactory = buildRuntimeDiagnostics,
  studioModelServiceFactory = createStudioModelService,
  studioDrawingServiceFactory = createStudioDrawingService,
  bootstrapImportServiceFactory = createBootstrapImportService,
  executorFactory = null,
}) {
  const app = express();
  const server = createServer(app);
  const jobStore = createJobStore({ jobsDir });
  const baseExecutor = createJobExecutor({
    projectRoot,
    jobStore,
  });
  const executor = typeof executorFactory === 'function'
    ? executorFactory({
        projectRoot,
        jobStore,
        baseExecutor,
      })
    : baseExecutor;
  const studioModelService = studioModelServiceFactory({ projectRoot });
  const studioDrawingService = studioDrawingServiceFactory({ projectRoot });
  const studioBootstrapImportService = bootstrapImportServiceFactory();
  const jobCoordinator = createLocalApiJobCoordinator({
    jobStore,
    executor,
    studioDrawingService,
  });

  app.use(express.json({ limit: '5mb' }));
  registerLandingRoutes(app, {
    projectRoot,
    jobsDir: jobStore.jobsDir,
  });
  app.use(createInvalidJsonMiddleware());
  registerOperationalRoutes(app, {
    projectRoot,
    jobsDir: jobStore.jobsDir,
    runtimeDiagnosticsFactory,
  });
  registerStudioRoutes(app, {
    projectRoot,
    studioModelService,
    studioDrawingService,
    studioBootstrapImportService,
    jobCoordinator,
  });
  registerJobRoutes(app, {
    jobStore,
    executor,
    jobCoordinator,
  });
  registerArtifactRoutes(app, { jobStore });
  app.use(createInternalErrorMiddleware());

  server.on('close', () => {
    studioModelService.dispose().catch(() => {});
    studioDrawingService.dispose().catch(() => {});
  });

  return {
    app,
    server,
    jobStore,
    executor,
    studioModelService,
    studioDrawingService,
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
  console.log(`Studio shell: http://127.0.0.1:${actualPort}/`);
  console.log(`Direct studio route: http://127.0.0.1:${actualPort}/studio`);
  console.log(`API info page: http://127.0.0.1:${actualPort}/api`);
  console.log(`Health endpoint: http://127.0.0.1:${actualPort}/health`);
  console.log('Browser requests open the studio shell by default; JSON/text callers still reach the local API on /.');
  console.log(`Legacy viewer: fcad serve ${actualPort} --legacy-viewer`);
  console.log('If localhost resolves to another process on your machine, use 127.0.0.1 explicitly.');
  console.log(`Job store: ${jobStore.jobsDir}`);
  return { server, port: actualPort, jobsDir: jobStore.jobsDir };
}
