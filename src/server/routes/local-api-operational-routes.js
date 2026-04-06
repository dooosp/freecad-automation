import { LOCAL_API_VERSION } from '../local-api-contract.js';
import { buildHealthPayload } from '../local-api-health.js';
import { loadExampleConfigs } from '../local-api-landing.js';
import { assertResponse, createErrorResponse } from '../local-api-response-helpers.js';
import { listShopProfiles } from '../../api/config.js';

export function registerOperationalRoutes(app, {
  projectRoot,
  jobsDir,
  runtimeDiagnosticsFactory,
}) {
  app.get('/health', (_req, res) => {
    const payload = buildHealthPayload({
      jobsDir,
      runtimeDiagnostics: runtimeDiagnosticsFactory(),
    });
    res.json(assertResponse('health', payload));
  });

  app.get('/api/examples', async (_req, res, next) => {
    try {
      res.json(await loadExampleConfigs());
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/config/profiles', async (_req, res) => {
    try {
      res.json({
        api_version: LOCAL_API_VERSION,
        ok: true,
        profiles: await listShopProfiles(projectRoot),
      });
    } catch (error) {
      const response = createErrorResponse(
        'config_profiles_unavailable',
        [error instanceof Error ? error.message : String(error)],
        500
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });
}
