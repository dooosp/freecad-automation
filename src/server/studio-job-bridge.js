import { parse as parseTOML } from 'smol-toml';

import { validateConfigDocument } from '../../lib/config-schema.js';
import {
  isConfigLikeArtifact,
  isInspectableModelArtifact,
} from '../../public/js/studio/artifact-actions.js';
import {
  applyStudioDrawingSettings,
  normalizeStudioDrawingSettings,
} from './studio-drawing-config.js';

const STUDIO_JOB_TYPES = new Set(['create', 'draw', 'inspect', 'report']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateOptionalObject(value, fieldName, errors) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${fieldName} must be an object when provided.`);
  }
}

function validateArtifactRef(value, fieldName, errors) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${fieldName} must be an object when provided.`);
    return;
  }

  if (typeof value.job_id !== 'string' || value.job_id.trim().length === 0) {
    errors.push(`${fieldName}.job_id must be a non-empty string.`);
  }
  if (typeof value.artifact_id !== 'string' || value.artifact_id.trim().length === 0) {
    errors.push(`${fieldName}.artifact_id must be a non-empty string.`);
  }
}

function trimArtifactRef(value = {}) {
  return {
    job_id: String(value.job_id || '').trim(),
    artifact_id: String(value.artifact_id || '').trim(),
  };
}

function buildResolvedArtifactOptions(request, resolvedArtifact) {
  const options = isPlainObject(request.options) ? structuredClone(request.options) : {};
  options.studio = {
    ...(isPlainObject(options.studio) ? options.studio : {}),
    source: 'artifact-reference',
    source_job_id: resolvedArtifact.jobId,
    source_artifact_id: resolvedArtifact.artifact.id,
    source_artifact_type: resolvedArtifact.artifact.type || '',
    source_label: resolvedArtifact.artifact.key || resolvedArtifact.artifact.file_name || resolvedArtifact.artifact.type || resolvedArtifact.artifact.id,
    source_artifact_path: resolvedArtifact.artifact.path,
  };
  return options;
}

function parseStudioConfigToml(configToml) {
  let parsed;
  try {
    parsed = parseTOML(configToml);
  } catch (error) {
    throw new Error(`TOML parse error: ${error instanceof Error ? error.message : String(error)}`);
  }
  const validation = validateConfigDocument(parsed, { filepath: 'studio:tracked-job' });
  if (!validation.valid) {
    throw new Error(validation.summary.errors.join(' | '));
  }
  return validation.config;
}

export function validateStudioJobSubmission(body) {
  if (!isPlainObject(body)) {
    return { ok: false, errors: ['Request body must be a JSON object.'] };
  }

  const request = structuredClone(body);
  const errors = [];
  const supportedFields = new Set([
    'type',
    'config_toml',
    'artifact_ref',
    'drawing_settings',
    'drawing_preview_id',
    'drawing_plan',
    'report_options',
    'options',
  ]);

  Object.keys(request).forEach((key) => {
    if (!supportedFields.has(key)) {
      errors.push(`Unsupported property "${key}" for studio tracked job submission.`);
    }
  });

  if (!STUDIO_JOB_TYPES.has(request.type)) {
    errors.push('type must be one of create, draw, inspect, or report.');
  }

  const hasConfigToml = typeof request.config_toml === 'string' && request.config_toml.trim().length > 0;
  const hasArtifactRef = request.artifact_ref !== undefined;

  validateArtifactRef(request.artifact_ref, 'artifact_ref', errors);
  validateOptionalObject(request.drawing_settings, 'drawing_settings', errors);
  if (request.drawing_preview_id !== undefined && (typeof request.drawing_preview_id !== 'string' || request.drawing_preview_id.trim().length === 0)) {
    errors.push('drawing_preview_id must be a non-empty string when provided.');
  }
  validateOptionalObject(request.drawing_plan, 'drawing_plan', errors);
  validateOptionalObject(request.report_options, 'report_options', errors);
  validateOptionalObject(request.options, 'options', errors);

  if (request.type === 'inspect') {
    if (!hasArtifactRef) {
      errors.push('artifact_ref is required for type "inspect".');
    }
    if (hasConfigToml) {
      errors.push('config_toml is not supported for type "inspect".');
    }
  } else if (!hasConfigToml && !hasArtifactRef) {
    errors.push('config_toml is required.');
  } else if (request.type === 'report' && hasConfigToml && hasArtifactRef) {
    errors.push('Provide either config_toml or artifact_ref for type "report", not both.');
  }

  if (request.type !== 'draw' && request.drawing_settings !== undefined) {
    errors.push('drawing_settings is only supported for type "draw".');
  }

  if (request.type !== 'draw' && request.drawing_preview_id !== undefined) {
    errors.push('drawing_preview_id is only supported for type "draw".');
  }

  if (request.type !== 'draw' && request.drawing_plan !== undefined) {
    errors.push('drawing_plan is only supported for type "draw".');
  }

  if (request.type !== 'report' && request.report_options !== undefined) {
    errors.push('report_options is only supported for type "report".');
  }

  if (request.type !== 'inspect' && request.type !== 'report' && request.artifact_ref !== undefined) {
    errors.push('artifact_ref is only supported for type "inspect" or "report".');
  }

  return {
    ok: errors.length === 0,
    errors,
    request,
  };
}

export async function translateStudioJobSubmission(body, { resolveArtifactRef } = {}) {
  const validation = validateStudioJobSubmission(body);
  if (!validation.ok) {
    return validation;
  }

  const request = validation.request;
  if (request.artifact_ref) {
    if (typeof resolveArtifactRef !== 'function') {
      return {
        ok: false,
        errors: ['artifact_ref requires a resolver on this studio serve path.'],
      };
    }

    let resolvedArtifact;
    try {
      resolvedArtifact = await resolveArtifactRef(trimArtifactRef(request.artifact_ref));
    } catch (error) {
      return {
        ok: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }

    if (request.type === 'inspect') {
      if (!isInspectableModelArtifact(resolvedArtifact.artifact)) {
        return {
          ok: false,
          errors: ['artifact_ref must point to a supported model artifact for type "inspect".'],
        };
      }

      return {
        ok: true,
        request: {
          type: 'inspect',
          file_path: resolvedArtifact.artifact.path,
          options: buildResolvedArtifactOptions(request, resolvedArtifact),
        },
      };
    }

    if (!isConfigLikeArtifact(resolvedArtifact.artifact)) {
      return {
        ok: false,
        errors: ['artifact_ref must point to a config-like artifact for tracked report reruns.'],
      };
    }

    const options = buildResolvedArtifactOptions(request, resolvedArtifact);
    if (isPlainObject(request.report_options)) {
      options.report_options = structuredClone(request.report_options);
    }

    return {
      ok: true,
      request: {
        type: request.type,
        config_path: resolvedArtifact.artifact.path,
        ...(Object.keys(options).length > 0 ? { options } : {}),
      },
    };
  }

  let config;
  try {
    config = parseStudioConfigToml(request.config_toml.trim());
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  const translatedConfig = structuredClone(config);
  if (request.type === 'draw') {
    if (isPlainObject(request.drawing_plan)) {
      translatedConfig.drawing_plan = structuredClone(request.drawing_plan);
    }
    const drawingSettings = normalizeStudioDrawingSettings(request.drawing_settings || {}, translatedConfig);
    applyStudioDrawingSettings(translatedConfig, drawingSettings);
  }

  const options = isPlainObject(request.options) ? structuredClone(request.options) : {};
  if (request.type === 'report' && isPlainObject(request.report_options)) {
    options.report_options = structuredClone(request.report_options);
  }

  return {
    ok: true,
    request: {
      type: request.type,
      config: translatedConfig,
      ...(Object.keys(options).length > 0 ? { options } : {}),
    },
  };
}
