import { parse as parseTOML } from 'smol-toml';

import { validateConfigDocument } from '../../lib/config-schema.js';
import {
  findPreferredConfigArtifact,
  findPreferredDocsManifestArtifact,
  findPreferredReadinessReportArtifact,
  findPreferredReviewPackArtifact,
  isConfigLikeArtifact,
  isInspectableModelArtifact,
  isReviewContextArtifact,
  isReadinessReportArtifact,
  isReleaseBundleArtifact,
  isReviewPackArtifact,
} from '../../public/js/studio/artifact-actions.js';
import {
  applyStudioDrawingSettings,
  normalizeStudioDrawingSettings,
} from './studio-drawing-config.js';

const STUDIO_JOB_TYPES = new Set([
  'create',
  'draw',
  'inspect',
  'report',
  'review-context',
  'compare-rev',
  'readiness-pack',
  'stabilization-review',
  'generate-standard-docs',
  'pack',
]);
const STUDIO_AF_ARTIFACT_JOB_TYPES = new Set(['readiness-pack', 'generate-standard-docs', 'pack']);

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

function trimOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
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

function buildReadinessRehydrationOptions(request, resolvedArtifact) {
  const options = buildResolvedArtifactOptions(request, resolvedArtifact);
  options.studio = {
    ...options.studio,
    config_rehydration: 'readiness_report',
  };
  return options;
}

function buildResolvedPairOptions(request, baselineArtifact, candidateArtifact) {
  const options = isPlainObject(request.options) ? structuredClone(request.options) : {};
  options.studio = {
    ...(isPlainObject(options.studio) ? options.studio : {}),
    source: 'artifact-comparison',
    baseline_job_id: baselineArtifact.jobId,
    baseline_artifact_id: baselineArtifact.artifact.id,
    baseline_artifact_type: baselineArtifact.artifact.type || '',
    baseline_label: baselineArtifact.artifact.key || baselineArtifact.artifact.file_name || baselineArtifact.artifact.type || baselineArtifact.artifact.id,
    candidate_job_id: candidateArtifact.jobId,
    candidate_artifact_id: candidateArtifact.artifact.id,
    candidate_artifact_type: candidateArtifact.artifact.type || '',
    candidate_label: candidateArtifact.artifact.key || candidateArtifact.artifact.file_name || candidateArtifact.artifact.type || candidateArtifact.artifact.id,
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
    'baseline_artifact_ref',
    'candidate_artifact_ref',
    'context_path',
    'model_path',
    'bom_path',
    'inspection_path',
    'quality_path',
    'compare_to_path',
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
    errors.push('type must be one of create, draw, inspect, report, review-context, compare-rev, readiness-pack, stabilization-review, generate-standard-docs, or pack.');
  }

  const hasConfigToml = typeof request.config_toml === 'string' && request.config_toml.trim().length > 0;
  const hasArtifactRef = request.artifact_ref !== undefined;
  const hasBaselineArtifactRef = request.baseline_artifact_ref !== undefined;
  const hasCandidateArtifactRef = request.candidate_artifact_ref !== undefined;
  const hasContextPath = trimOptionalString(request.context_path).length > 0;
  const hasModelPath = trimOptionalString(request.model_path).length > 0;
  const hasCompareToPath = trimOptionalString(request.compare_to_path).length > 0;

  validateArtifactRef(request.artifact_ref, 'artifact_ref', errors);
  validateArtifactRef(request.baseline_artifact_ref, 'baseline_artifact_ref', errors);
  validateArtifactRef(request.candidate_artifact_ref, 'candidate_artifact_ref', errors);
  validateOptionalObject(request.drawing_settings, 'drawing_settings', errors);
  if (request.drawing_preview_id !== undefined && (typeof request.drawing_preview_id !== 'string' || request.drawing_preview_id.trim().length === 0)) {
    errors.push('drawing_preview_id must be a non-empty string when provided.');
  }
  validateOptionalObject(request.drawing_plan, 'drawing_plan', errors);
  validateOptionalObject(request.report_options, 'report_options', errors);
  validateOptionalObject(request.options, 'options', errors);
  ['context_path', 'model_path', 'bom_path', 'inspection_path', 'quality_path', 'compare_to_path'].forEach((fieldName) => {
    if (request[fieldName] !== undefined && trimOptionalString(request[fieldName]).length === 0) {
      errors.push(`${fieldName} must be a non-empty string when provided.`);
    }
  });

  if (request.type === 'review-context') {
    if (!hasContextPath && !hasModelPath) {
      errors.push('review-context requires either context_path or model_path.');
    }
    if (hasConfigToml || hasArtifactRef || hasBaselineArtifactRef || hasCandidateArtifactRef) {
      errors.push('review-context does not accept config_toml, artifact_ref, baseline_artifact_ref, or candidate_artifact_ref.');
    }
  } else if (request.type === 'inspect') {
    if (!hasArtifactRef) {
      errors.push('artifact_ref is required for type "inspect".');
    }
    if (hasConfigToml) {
      errors.push('config_toml is not supported for type "inspect".');
    }
  } else if (STUDIO_AF_ARTIFACT_JOB_TYPES.has(request.type)) {
    if (!hasArtifactRef) {
      errors.push(`artifact_ref is required for type "${request.type}".`);
    }
    if (hasConfigToml) {
      errors.push(`config_toml is not supported for type "${request.type}".`);
    }
  } else if (request.type === 'compare-rev' || request.type === 'stabilization-review') {
    if (!hasBaselineArtifactRef || !hasCandidateArtifactRef) {
      errors.push(`${request.type} requires both baseline_artifact_ref and candidate_artifact_ref.`);
    }
    if (hasConfigToml || hasArtifactRef) {
      errors.push(`${request.type} does not accept config_toml or artifact_ref.`);
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

  if (
    request.type !== 'inspect'
    && request.type !== 'review-context'
    && request.type !== 'report'
    && !STUDIO_AF_ARTIFACT_JOB_TYPES.has(request.type)
    && request.type !== 'review-context'
    && request.type !== 'compare-rev'
    && request.type !== 'stabilization-review'
    && request.artifact_ref !== undefined
  ) {
    errors.push('artifact_ref is only supported for type "inspect", "report", "review-context", "readiness-pack", "generate-standard-docs", or "pack".');
  }

  if (
    request.type !== 'compare-rev'
    && request.type !== 'stabilization-review'
    && (request.baseline_artifact_ref !== undefined || request.candidate_artifact_ref !== undefined)
  ) {
    errors.push('baseline_artifact_ref and candidate_artifact_ref are only supported for type "compare-rev" or "stabilization-review".');
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
  if (request.type === 'review-context') {
    return {
      ok: true,
      errors: [],
      request: {
        type: 'review-context',
        ...(trimOptionalString(request.context_path) ? { context_path: trimOptionalString(request.context_path) } : {}),
        ...(trimOptionalString(request.model_path) ? { model_path: trimOptionalString(request.model_path) } : {}),
        ...(trimOptionalString(request.bom_path) ? { bom_path: trimOptionalString(request.bom_path) } : {}),
        ...(trimOptionalString(request.inspection_path) ? { inspection_path: trimOptionalString(request.inspection_path) } : {}),
        ...(trimOptionalString(request.quality_path) ? { quality_path: trimOptionalString(request.quality_path) } : {}),
        ...(trimOptionalString(request.compare_to_path) ? { compare_to_path: trimOptionalString(request.compare_to_path) } : {}),
        ...(isPlainObject(request.options) ? { options: structuredClone(request.options) } : {}),
      },
    };
  }

  if (request.baseline_artifact_ref || request.candidate_artifact_ref) {
    if (typeof resolveArtifactRef !== 'function') {
      return {
        ok: false,
        errors: ['artifact_ref requires a resolver on this studio serve path.'],
      };
    }

    let baselineArtifact;
    let candidateArtifact;
    try {
      [baselineArtifact, candidateArtifact] = await Promise.all([
        resolveArtifactRef(trimArtifactRef(request.baseline_artifact_ref)),
        resolveArtifactRef(trimArtifactRef(request.candidate_artifact_ref)),
      ]);
    } catch (error) {
      return {
        ok: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }

    if (request.type === 'compare-rev') {
      const baselineReviewPack = findPreferredReviewPackArtifact([baselineArtifact.artifact]);
      const candidateReviewPack = findPreferredReviewPackArtifact([candidateArtifact.artifact]);
      if (!baselineReviewPack || !candidateReviewPack) {
        return {
          ok: false,
          errors: ['compare-rev needs canonical review-pack JSON artifacts for both baseline and candidate.'],
        };
      }

      return {
        ok: true,
        request: {
          type: 'compare-rev',
          baseline_path: baselineReviewPack.path,
          candidate_path: candidateReviewPack.path,
          options: buildResolvedPairOptions(request, baselineArtifact, candidateArtifact),
        },
      };
    }

    if (request.type === 'stabilization-review') {
      const baselineReadiness = findPreferredReadinessReportArtifact([baselineArtifact.artifact]);
      const candidateReadiness = findPreferredReadinessReportArtifact([candidateArtifact.artifact]);
      if (!baselineReadiness || !candidateReadiness) {
        return {
          ok: false,
          errors: ['stabilization-review needs canonical readiness-report JSON artifacts for both baseline and candidate.'],
        };
      }

      return {
        ok: true,
        request: {
          type: 'stabilization-review',
          baseline_path: baselineReadiness.path,
          candidate_path: candidateReadiness.path,
          options: buildResolvedPairOptions(request, baselineArtifact, candidateArtifact),
        },
      };
    }
  }

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

    if (request.type === 'review-context') {
      if (isReviewContextArtifact(resolvedArtifact.artifact)) {
        return {
          ok: true,
          request: {
            type: 'review-context',
            context_path: resolvedArtifact.artifact.path,
            options: buildResolvedArtifactOptions(request, resolvedArtifact),
          },
        };
      }

      if (!isInspectableModelArtifact(resolvedArtifact.artifact)) {
        return {
          ok: false,
          errors: ['artifact_ref must point to a supported model artifact or tracked context JSON for type "review-context".'],
        };
      }

      return {
        ok: true,
        request: {
          type: 'review-context',
          model_path: resolvedArtifact.artifact.path,
          options: buildResolvedArtifactOptions(request, resolvedArtifact),
        },
      };
    }

    if (request.type === 'readiness-pack') {
      if (!isReviewPackArtifact(resolvedArtifact.artifact) && !isReleaseBundleArtifact(resolvedArtifact.artifact)) {
        return {
          ok: false,
          errors: ['artifact_ref must point to a canonical review-pack JSON or a release bundle for type "readiness-pack".'],
        };
      }

      return {
        ok: true,
        request: {
          type: 'readiness-pack',
          review_pack_path: resolvedArtifact.artifact.path,
          options: buildResolvedArtifactOptions(request, resolvedArtifact),
        },
      };
    }

    if (request.type === 'generate-standard-docs') {
      const selectedArtifact = resolvedArtifact.artifact;
      if (!isReadinessReportArtifact(selectedArtifact) && !isReleaseBundleArtifact(selectedArtifact)) {
        return {
          ok: false,
          errors: ['artifact_ref must point to a canonical readiness report JSON or a release bundle for type "generate-standard-docs".'],
        };
      }

      const configArtifact = isReleaseBundleArtifact(selectedArtifact)
        ? selectedArtifact
        : findPreferredConfigArtifact(resolvedArtifact.jobArtifacts || []);
      if (configArtifact?.path) {
        return {
          ok: true,
          request: {
            type: 'generate-standard-docs',
            config_path: configArtifact.path,
            readiness_report_path: selectedArtifact.path,
            options: buildResolvedArtifactOptions(request, resolvedArtifact),
          },
        };
      }

      if (isReadinessReportArtifact(selectedArtifact)) {
        return {
          ok: true,
          request: {
            type: 'generate-standard-docs',
            config_path: selectedArtifact.path,
            readiness_report_path: selectedArtifact.path,
            options: buildReadinessRehydrationOptions(request, resolvedArtifact),
          },
        };
      }

      if (!configArtifact?.path) {
        return {
          ok: false,
          errors: ['generate-standard-docs needs a config-like artifact in the same tracked job, or a release bundle that already carries canonical inputs.'],
        };
      }
    }

    if (request.type === 'pack') {
      const selectedArtifact = resolvedArtifact.artifact;
      if (!isReadinessReportArtifact(selectedArtifact) && !isReleaseBundleArtifact(selectedArtifact)) {
        return {
          ok: false,
          errors: ['artifact_ref must point to a canonical readiness report JSON or a release bundle for type "pack".'],
        };
      }

      const docsManifestArtifact = isReleaseBundleArtifact(selectedArtifact)
        ? null
        : findPreferredDocsManifestArtifact(resolvedArtifact.jobArtifacts || []);

      return {
        ok: true,
        request: {
          type: 'pack',
          readiness_report_path: selectedArtifact.path,
          ...(docsManifestArtifact?.path ? { docs_manifest_path: docsManifestArtifact.path } : {}),
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
