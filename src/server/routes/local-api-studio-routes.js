import { readFile } from 'node:fs/promises';
import { basename, posix, relative, resolve, sep, win32 } from 'node:path';
import { runScript } from '../../../lib/runner.js';
import { translateStudioJobSubmission } from '../studio-job-bridge.js';
import { toPublicDrawingPreviewPayload } from '../public-drawing-preview.js';
import { LOCAL_API_VERSION } from '../local-api-contract.js';
import { assertResponse, createErrorResponse } from '../local-api-response-helpers.js';
import { redactPublicPathValues } from '../local-api-artifacts.js';

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalidRequest(res, messages) {
  const response = createErrorResponse('invalid_request', messages);
  res.status(response.status).json(assertResponse('error', response.body));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function publicErrorMessage(error) {
  const message = redactPublicPathValues(errorMessage(error));
  return typeof message === 'string' && message.trim().length > 0 ? message : 'Request failed.';
}

function validateObjectRequestBody(body, errors) {
  if (!isPlainObject(body)) {
    errors.push('Request body must be a JSON object.');
  }
}

function validateOptionalPlainObject(body, fieldName, errors) {
  if (body?.[fieldName] !== undefined && !isPlainObject(body[fieldName])) {
    errors.push(`${fieldName} must be an object when provided.`);
  }
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
      res.json(assertResponse('studio_validate_config', {
        api_version: LOCAL_API_VERSION,
        ok: true,
        validation: payload.summary,
        overview: payload.overview,
      }));
    } catch (error) {
      const response = createErrorResponse(
        'invalid_config',
        [publicErrorMessage(error)]
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.post('/api/studio/design', async (req, res) => {
    try {
      const payload = await studioModelService.designFromPrompt(req.body?.description);
      res.json(assertResponse('studio_design', {
        api_version: LOCAL_API_VERSION,
        ok: true,
        ...payload,
      }));
    } catch (error) {
      const response = createErrorResponse(
        'design_failed',
        [publicErrorMessage(error)]
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.post('/api/studio/model-preview', async (req, res) => {
    const requestErrors = [];
    validateObjectRequestBody(req.body, requestErrors);
    validateOptionalPlainObject(req.body, 'build_settings', requestErrors);
    if (requestErrors.length > 0) {
      invalidRequest(res, requestErrors);
      return;
    }
    try {
      const payload = await studioModelService.buildPreview({
        configToml: req.body?.config_toml,
        buildSettings: req.body?.build_settings || {},
      });
      res.json(assertResponse('studio_model_preview', {
        api_version: LOCAL_API_VERSION,
        ok: true,
        ...payload,
      }));
    } catch (error) {
      const rawMessage = errorMessage(error);
      const status = /TOML parse error|Config TOML is required|must include|invalid/i.test(rawMessage) ? 400 : 500;
      const response = createErrorResponse(
        'model_preview_failed',
        [publicErrorMessage(error)],
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
      res.json(assertResponse('studio_import_bootstrap', {
        api_version: LOCAL_API_VERSION,
        ok: true,
        ...redactBootstrapPreviewPaths(projectRoot, payload),
      }));
    } catch (error) {
      const rawMessage = errorMessage(error);
      const status = /required|unsupported|must stay inside|must be inside|failed bootstrap intake/i.test(rawMessage) ? 400 : 500;
      const response = createErrorResponse(
        'import_bootstrap_failed',
        [publicErrorMessage(error)],
        status
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.post('/api/studio/drawing-preview', async (req, res) => {
    const requestErrors = [];
    validateObjectRequestBody(req.body, requestErrors);
    validateOptionalPlainObject(req.body, 'drawing_settings', requestErrors);
    if (requestErrors.length > 0) {
      invalidRequest(res, requestErrors);
      return;
    }
    try {
      const payload = await studioDrawingService.buildPreview({
        configToml: req.body?.config_toml,
        drawingSettings: req.body?.drawing_settings || {},
      });
      res.json(assertResponse('studio_drawing_preview', {
        api_version: LOCAL_API_VERSION,
        ok: true,
        ...toPublicDrawingPreviewPayload(payload),
      }));
    } catch (error) {
      const rawMessage = errorMessage(error);
      const status = /TOML parse error|Config TOML is required|must include|invalid/i.test(rawMessage) ? 400 : 500;
      const response = createErrorResponse(
        'drawing_preview_failed',
        [publicErrorMessage(error)],
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
    const requestErrors = [];
    validateObjectRequestBody(req.body, requestErrors);
    if (req.body?.dim_id !== undefined && (typeof req.body.dim_id !== 'string' || req.body.dim_id.trim().length === 0)) {
      requestErrors.push('dim_id must be a non-empty string when provided.');
    }
    if (req.body?.value_mm !== undefined && !Number.isFinite(Number(req.body.value_mm))) {
      requestErrors.push('value_mm must be a finite number when provided.');
    }
    if (req.body?.history_op !== undefined && (typeof req.body.history_op !== 'string' || !['edit', 'undo', 'redo'].includes(req.body.history_op))) {
      requestErrors.push('history_op must be edit, undo, or redo when provided.');
    }
    if (requestErrors.length > 0) {
      invalidRequest(res, requestErrors);
      return;
    }
    try {
      const payload = await studioDrawingService.updateDimension({
        previewId: req.params.id,
        dimId: req.body?.dim_id,
        valueMm: req.body?.value_mm,
        historyOp: req.body?.history_op,
      });
      res.json(assertResponse('studio_drawing_preview', {
        api_version: LOCAL_API_VERSION,
        ok: true,
        ...toPublicDrawingPreviewPayload(payload),
      }));
    } catch (error) {
      const rawMessage = errorMessage(error);
      const status = /No drawing preview found|editable plan path|Could not update|dim_intent|Invalid value|positive/i.test(rawMessage) ? 400 : 500;
      const response = createErrorResponse(
        'drawing_dimension_update_failed',
        [publicErrorMessage(error)],
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
