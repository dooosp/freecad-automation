import { readFile } from 'node:fs/promises';
import { translateStudioJobSubmission } from '../studio-job-bridge.js';
import { toPublicDrawingPreviewPayload } from '../public-drawing-preview.js';
import { assertResponse, createErrorResponse } from '../local-api-response-helpers.js';

export function registerStudioRoutes(app, {
  studioModelService,
  studioDrawingService,
  jobCoordinator,
}) {
  app.post('/api/studio/validate-config', async (req, res) => {
    try {
      const payload = await studioModelService.validateConfigToml(req.body?.config_toml);
      res.json({
        ok: true,
        validation: payload.summary,
        overview: payload.overview,
      });
    } catch (error) {
      const response = createErrorResponse(
        'invalid_config',
        [error instanceof Error ? error.message : String(error)]
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.post('/api/studio/design', async (req, res) => {
    try {
      const payload = await studioModelService.designFromPrompt(req.body?.description);
      res.json({
        ok: true,
        ...payload,
      });
    } catch (error) {
      const response = createErrorResponse(
        'design_failed',
        [error instanceof Error ? error.message : String(error)]
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.post('/api/studio/model-preview', async (req, res) => {
    try {
      const payload = await studioModelService.buildPreview({
        configToml: req.body?.config_toml,
        buildSettings: req.body?.build_settings || {},
      });
      res.json({
        ok: true,
        ...payload,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /TOML parse error|Config TOML is required|must include|invalid/i.test(message) ? 400 : 500;
      const response = createErrorResponse(
        'model_preview_failed',
        [message],
        status
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.post('/api/studio/drawing-preview', async (req, res) => {
    try {
      const payload = await studioDrawingService.buildPreview({
        configToml: req.body?.config_toml,
        drawingSettings: req.body?.drawing_settings || {},
      });
      res.json({
        ok: true,
        ...toPublicDrawingPreviewPayload(payload),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /TOML parse error|Config TOML is required|must include|invalid/i.test(message) ? 400 : 500;
      const response = createErrorResponse(
        'drawing_preview_failed',
        [message],
        status
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.post('/api/studio/jobs', async (req, res) => {
    const preparedBody = await jobCoordinator.prepareStudioJobBody(req.body);
    const translated = await translateStudioJobSubmission(preparedBody, {
      resolveArtifactRef: jobCoordinator.resolveArtifactRef,
    });
    if (!translated.ok) {
      const response = createErrorResponse('invalid_request', translated.errors);
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }

    await jobCoordinator.enqueueJob(translated.request, res);
  });

  app.post('/api/studio/drawing-previews/:id/dimensions', async (req, res) => {
    try {
      const payload = await studioDrawingService.updateDimension({
        previewId: req.params.id,
        dimId: req.body?.dim_id,
        valueMm: req.body?.value_mm,
        historyOp: req.body?.history_op,
      });
      res.json({
        ok: true,
        ...toPublicDrawingPreviewPayload(payload),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /No drawing preview found|editable plan path|Could not update|dim_intent|Invalid value|positive/i.test(message) ? 400 : 500;
      const response = createErrorResponse(
        'drawing_dimension_update_failed',
        [message],
        status
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.get('/api/studio/model-previews/:id/model', async (req, res, next) => {
    const modelPath = studioModelService.getPreviewModelPath(req.params.id);
    if (!modelPath) {
      const response = createErrorResponse('preview_not_found', [`No model preview found for id ${req.params.id}.`], 404);
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }
    try {
      res.type('model/stl').send(await readFile(modelPath));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/studio/model-previews/:id/parts/:index', async (req, res, next) => {
    const partPath = studioModelService.getPreviewPartPath(req.params.id, Number.parseInt(req.params.index, 10));
    if (!partPath) {
      const response = createErrorResponse(
        'preview_part_not_found',
        [`No preview part ${req.params.index} found for id ${req.params.id}.`],
        404
      );
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }
    try {
      res.type('model/stl').send(await readFile(partPath));
    } catch (error) {
      next(error);
    }
  });
}
