import { readFile } from 'node:fs/promises';
import { basename, posix, relative, resolve, sep, win32 } from 'node:path';
import { runScript } from '../../../lib/runner.js';
import { translateStudioJobSubmission } from '../studio-job-bridge.js';
import { toPublicDrawingPreviewPayload } from '../public-drawing-preview.js';
import { assertResponse, createErrorResponse } from '../local-api-response-helpers.js';

function isAbsoluteFilesystemPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && (posix.isAbsolute(value) || win32.isAbsolute(value));
}

function isPathInside(baseDir, targetPath) {
  const base = resolve(baseDir);
  const target = resolve(targetPath);
  return target === base || target.startsWith(`${base}${sep}`);
}

function basenameFromAnyPath(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (win32.isAbsolute(value)) return win32.basename(value);
  return basename(value);
}

function trimOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function toProjectDisplayPath(projectRoot, value) {
  const trimmed = trimOptionalString(value);
  if (!trimmed) return '';
  const resolvedPath = resolve(trimmed);
  if (isPathInside(projectRoot, resolvedPath)) {
    const next = relative(projectRoot, resolvedPath);
    return next || '.';
  }
  return basenameFromAnyPath(trimmed);
}

function toProjectAbsolutePath(projectRoot, value) {
  const trimmed = trimOptionalString(value);
  if (!trimmed) return '';
  return resolve(projectRoot, trimmed);
}

function toBootstrapFileInput(body = {}, prefix, projectRoot) {
  const upload = body?.[`${prefix}_upload`];
  if (upload && typeof upload === 'object') {
    return upload;
  }

  const filePath = trimOptionalString(body?.[`${prefix}_path`]);
  if (!filePath) return null;
  return {
    path: toProjectAbsolutePath(projectRoot, filePath),
  };
}

function redactBootstrapPreviewPaths(projectRoot, value) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactBootstrapPreviewPaths(projectRoot, entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactBootstrapPreviewPaths(projectRoot, entry)])
    );
  }

  if (isAbsoluteFilesystemPath(value)) {
    return toProjectDisplayPath(projectRoot, value);
  }

  return value;
}

export function registerStudioRoutes(app, {
  projectRoot,
  studioModelService,
  studioDrawingService,
  studioBootstrapImportService,
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

  app.post('/api/studio/import-bootstrap', async (req, res) => {
    try {
      const payload = await studioBootstrapImportService({
        projectRoot,
        runScript,
        model: toBootstrapFileInput(req.body, 'model', projectRoot),
        bom: toBootstrapFileInput(req.body, 'bom', projectRoot),
        inspection: toBootstrapFileInput(req.body, 'inspection', projectRoot),
        quality: toBootstrapFileInput(req.body, 'quality', projectRoot),
        metadata: req.body?.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata)
          ? req.body.metadata
          : {},
      });
      res.json({
        ok: true,
        ...redactBootstrapPreviewPaths(projectRoot, payload),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /required|unsupported|must stay inside|must be inside|failed bootstrap intake/i.test(message) ? 400 : 500;
      const response = createErrorResponse(
        'import_bootstrap_failed',
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
