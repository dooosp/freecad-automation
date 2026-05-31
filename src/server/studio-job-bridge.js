import { parse as parseTOML } from 'smol-toml';

import { validateConfigDocument } from '../../lib/config-schema.js';
import {
  findPreferredConfigArtifact,
  findPreferredDocsManifestArtifact,
  isInspectionEvidenceIntakeArtifact,
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
import {
  STUDIO_ARTIFACT_COMPATIBLE_JOB_COMMANDS,
  STUDIO_ARTIFACT_JOB_COMMANDS,
  STUDIO_JOB_COMMANDS,
  STUDIO_PAIRED_ARTIFACT_JOB_COMMANDS,
  formatCommandNameList,
} from '../shared/command-manifest.js';

const STUDIO_SUBMISSION_JOB_COMMANDS = Object.freeze([
  ...STUDIO_JOB_COMMANDS,
  'review-context',
]);
const STUDIO_JOB_TYPES = new Set(STUDIO_SUBMISSION_JOB_COMMANDS);
const STUDIO_AF_ARTIFACT_JOB_TYPES = new Set(STUDIO_ARTIFACT_JOB_COMMANDS);
const STUDIO_ARTIFACT_COMPATIBLE_JOB_TYPES = new Set(STUDIO_ARTIFACT_COMPATIBLE_JOB_COMMANDS);
const STUDIO_PAIRED_ARTIFACT_JOB_TYPES = new Set(STUDIO_PAIRED_ARTIFACT_JOB_COMMANDS);
const STUDIO_JOB_TYPE_SENTENCE = formatCommandNameList(STUDIO_SUBMISSION_JOB_COMMANDS, { conjunction: 'or' });
const STUDIO_ARTIFACT_TYPE_SENTENCE = formatCommandNameList(STUDIO_ARTIFACT_COMPATIBLE_JOB_COMMANDS, { conjunction: 'or', quote: 'double' });
const STUDIO_PAIRED_ARTIFACT_TYPE_SENTENCE = formatCommandNameList(STUDIO_PAIRED_ARTIFACT_JOB_COMMANDS, { conjunction: 'or', quote: 'double' });

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateOptionalObject(value, fieldName, errors) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${fieldName} must be an object when provided.`);
  }
}

function validateStage5bAuditOptions(options, errors) {
  if (options === undefined) return;
  if (!isPlainObject(options)) return;
  const unsupportedOptions = Object.keys(options).filter((key) => key !== 'include_github');
  if (unsupportedOptions.length > 0) {
    errors.push(`stage5b-evidence-audit options only accepts include_github; unsupported option(s): ${unsupportedOptions.join(', ')}.`);
  }
  if (
    Object.hasOwn(options, 'include_github')
    && typeof options.include_github !== 'boolean'
  ) {
    errors.push('stage5b-evidence-audit options.include_github must be a boolean when provided.');
  }
}

function validateInspectionEvidenceIntakeOptions(options, errors) {
  if (options === undefined) return;
  if (!isPlainObject(options)) return;
  const unsupportedOptions = Object.keys(options).filter((key) => !['include_github', 'package_slugs'].includes(key));
  if (unsupportedOptions.length > 0) {
    errors.push(`inspection-evidence-intake options only accepts include_github and package_slugs; unsupported option(s): ${unsupportedOptions.join(', ')}.`);
  }
  if (
    Object.hasOwn(options, 'include_github')
    && typeof options.include_github !== 'boolean'
  ) {
    errors.push('inspection-evidence-intake options.include_github must be a boolean when provided.');
  }
  if (
    Object.hasOwn(options, 'package_slugs')
    && (!Array.isArray(options.package_slugs)
      || options.package_slugs.some((slug) => typeof slug !== 'string' || slug.trim().length === 0))
  ) {
    errors.push('inspection-evidence-intake options.package_slugs must be an array of non-empty strings when provided.');
  }
}

function buildInspectionEvidenceIntakeOptions(request) {
  const options = {};
  if (request.options?.include_github === true || request.options?.include_github === false) {
    options.include_github = request.options.include_github;
  }
  if (Array.isArray(request.options?.package_slugs)) {
    options.package_slugs = request.options.package_slugs.map((slug) => slug.trim());
  }
  return options;
}

function buildStage5bAuditOptions(request) {
  const options = {};
  if (request.options?.include_github === true || request.options?.include_github === false) {
    options.include_github = request.options.include_github;
  }
  return options;
}

function validateArtifactRef(value, fieldName, errors) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${fieldName} must be an object when provided.`);
    return;
  }

  if (typeof value.job_id !== 'string' || value.job_id.trim().length === 0) {
    errors.push(`${fieldName}.job_id must be a non-empty string.`);
  } else if (!isSafeTrackedId(value.job_id)) {
    errors.push(`${fieldName}.job_id must be a safe tracked id.`);
  }
  if (typeof value.artifact_id !== 'string' || value.artifact_id.trim().length === 0) {
    errors.push(`${fieldName}.artifact_id must be a non-empty string.`);
  } else if (!isSafeTrackedId(value.artifact_id)) {
    errors.push(`${fieldName}.artifact_id must be a safe tracked id.`);
  }
}

function trimArtifactRef(value = {}) {
  return {
    job_id: String(value.job_id || '').trim(),
    artifact_id: String(value.artifact_id || '').trim(),
  };
}

function isSafeTrackedId(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const lower = raw.toLowerCase();
  return Boolean(raw)
    && raw !== '.'
    && raw !== '..'
    && !raw.includes('/')
    && !raw.includes('\\')
    && !lower.includes('%2f')
    && !lower.includes('%5c')
    && !raw.includes('\0')
    && !raw.startsWith('~');
}

function trimOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function isSafeRepoRelativeJsonPath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const raw = value.trim();
  const normalized = raw.replaceAll('\\', '/').replace(/^\.\//, '');
  if (raw.includes('\\')) return false;
  if (normalized.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw) || normalized.startsWith('~')) return false;
  if (normalized.includes('\0') || normalized.includes('<') || normalized.includes('>')) return false;
  if (normalized.split('/').includes('..')) return false;
  return /\.json$/i.test(normalized);
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
    'create_quality_path',
    'drawing_quality_path',
    'drawing_qa_path',
    'drawing_intent_path',
    'feature_catalog_path',
    'dfm_report_path',
    'compare_to_path',
    'intake_report_path',
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
    errors.push(`type must be one of ${STUDIO_JOB_TYPE_SENTENCE}.`);
  }

  const hasConfigToml = typeof request.config_toml === 'string' && request.config_toml.trim().length > 0;
  const hasArtifactRef = request.artifact_ref !== undefined;
  const hasBaselineArtifactRef = request.baseline_artifact_ref !== undefined;
  const hasCandidateArtifactRef = request.candidate_artifact_ref !== undefined;
  const hasContextPath = trimOptionalString(request.context_path).length > 0;
  const hasModelPath = trimOptionalString(request.model_path).length > 0;
  const hasCompareToPath = trimOptionalString(request.compare_to_path).length > 0;
  const hasIntakeReportPath = trimOptionalString(request.intake_report_path).length > 0;

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
  [
    'context_path',
    'model_path',
    'bom_path',
    'inspection_path',
    'quality_path',
    'create_quality_path',
    'drawing_quality_path',
    'drawing_qa_path',
    'drawing_intent_path',
    'feature_catalog_path',
    'dfm_report_path',
    'compare_to_path',
    'intake_report_path',
  ].forEach((fieldName) => {
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
  } else if (request.type === 'inspection-evidence-intake') {
    const unsupportedIntakeFields = [
      'config_toml',
      'artifact_ref',
      'baseline_artifact_ref',
      'candidate_artifact_ref',
      'context_path',
      'model_path',
      'bom_path',
      'inspection_path',
      'quality_path',
      'create_quality_path',
      'drawing_quality_path',
      'drawing_qa_path',
      'drawing_intent_path',
      'feature_catalog_path',
      'dfm_report_path',
      'compare_to_path',
      'intake_report_path',
      'drawing_settings',
      'drawing_preview_id',
      'drawing_plan',
      'report_options',
    ].filter((fieldName) => request[fieldName] !== undefined);
    if (unsupportedIntakeFields.length > 0) {
      errors.push(`inspection-evidence-intake does not accept ${unsupportedIntakeFields.join(', ')}.`);
    }
    validateInspectionEvidenceIntakeOptions(request.options, errors);
  } else if (request.type === 'inspection-evidence-promotion-dry-run') {
    const unsupportedDryRunFields = [
      'config_toml',
      'baseline_artifact_ref',
      'candidate_artifact_ref',
      'context_path',
      'model_path',
      'bom_path',
      'inspection_path',
      'quality_path',
      'create_quality_path',
      'drawing_quality_path',
      'drawing_qa_path',
      'drawing_intent_path',
      'feature_catalog_path',
      'dfm_report_path',
      'compare_to_path',
      'drawing_settings',
      'drawing_preview_id',
      'drawing_plan',
      'report_options',
    ].filter((fieldName) => request[fieldName] !== undefined);
    if (unsupportedDryRunFields.length > 0) {
      errors.push(`inspection-evidence-promotion-dry-run does not accept ${unsupportedDryRunFields.join(', ')}.`);
    }
    if (!hasArtifactRef && !hasIntakeReportPath) {
      errors.push('inspection-evidence-promotion-dry-run requires artifact_ref or intake_report_path.');
    }
    if (hasArtifactRef && hasIntakeReportPath) {
      errors.push('inspection-evidence-promotion-dry-run accepts only one intake report source.');
    }
    if (hasIntakeReportPath && !isSafeRepoRelativeJsonPath(request.intake_report_path)) {
      errors.push('inspection-evidence-promotion-dry-run intake_report_path must be a safe repo-relative JSON path.');
    }
  } else if (request.type === 'stage5b-evidence-audit') {
    const unsupportedAuditFields = [
      'config_toml',
      'artifact_ref',
      'baseline_artifact_ref',
      'candidate_artifact_ref',
      'context_path',
      'model_path',
      'bom_path',
      'inspection_path',
      'quality_path',
      'create_quality_path',
      'drawing_quality_path',
      'drawing_qa_path',
      'drawing_intent_path',
      'feature_catalog_path',
      'dfm_report_path',
      'compare_to_path',
      'intake_report_path',
      'drawing_settings',
      'drawing_preview_id',
      'drawing_plan',
      'report_options',
    ].filter((fieldName) => request[fieldName] !== undefined);
    if (unsupportedAuditFields.length > 0) {
      errors.push(`stage5b-evidence-audit does not accept ${unsupportedAuditFields.join(', ')}.`);
    }
    validateStage5bAuditOptions(request.options, errors);
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
    !STUDIO_ARTIFACT_COMPATIBLE_JOB_TYPES.has(request.type)
    && !STUDIO_PAIRED_ARTIFACT_JOB_TYPES.has(request.type)
    && request.artifact_ref !== undefined
  ) {
    errors.push(`artifact_ref is only supported for type ${STUDIO_ARTIFACT_TYPE_SENTENCE}.`);
  }

  if (
    !STUDIO_PAIRED_ARTIFACT_JOB_TYPES.has(request.type)
    && (request.baseline_artifact_ref !== undefined || request.candidate_artifact_ref !== undefined)
  ) {
    errors.push(`baseline_artifact_ref and candidate_artifact_ref are only supported for type ${STUDIO_PAIRED_ARTIFACT_TYPE_SENTENCE}.`);
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
        ...(trimOptionalString(request.create_quality_path) ? { create_quality_path: trimOptionalString(request.create_quality_path) } : {}),
        ...(trimOptionalString(request.drawing_quality_path) ? { drawing_quality_path: trimOptionalString(request.drawing_quality_path) } : {}),
        ...(trimOptionalString(request.drawing_qa_path) ? { drawing_qa_path: trimOptionalString(request.drawing_qa_path) } : {}),
        ...(trimOptionalString(request.drawing_intent_path) ? { drawing_intent_path: trimOptionalString(request.drawing_intent_path) } : {}),
        ...(trimOptionalString(request.feature_catalog_path) ? { feature_catalog_path: trimOptionalString(request.feature_catalog_path) } : {}),
        ...(trimOptionalString(request.dfm_report_path) ? { dfm_report_path: trimOptionalString(request.dfm_report_path) } : {}),
        ...(trimOptionalString(request.compare_to_path) ? { compare_to_path: trimOptionalString(request.compare_to_path) } : {}),
        ...(isPlainObject(request.options) ? { options: structuredClone(request.options) } : {}),
      },
    };
  }

  if (request.type === 'inspection-evidence-intake') {
    const options = buildInspectionEvidenceIntakeOptions(request);
    return {
      ok: true,
      errors: [],
      request: {
        type: 'inspection-evidence-intake',
        ...(Object.keys(options).length > 0 ? { options } : {}),
      },
    };
  }

  if (request.type === 'inspection-evidence-promotion-dry-run') {
    if (request.artifact_ref) {
      if (typeof resolveArtifactRef !== 'function') {
        return {
          ok: false,
          errors: ['artifact_ref requires a resolver on this studio serve path.'],
        };
      }

      const ref = trimArtifactRef(request.artifact_ref);
      let resolvedArtifact;
      try {
        resolvedArtifact = await resolveArtifactRef(ref);
      } catch (error) {
        return {
          ok: false,
          errors: [error instanceof Error ? error.message : String(error)],
        };
      }

      if (!isInspectionEvidenceIntakeArtifact(resolvedArtifact.artifact)) {
        return {
          ok: false,
          errors: ['inspection-evidence-promotion-dry-run requires a registered inspection-evidence intake report artifact.'],
        };
      }

      return {
        ok: true,
        errors: [],
        request: {
          type: 'inspection-evidence-promotion-dry-run',
          intake_report_artifact_ref: ref,
          options: buildResolvedArtifactOptions(request, resolvedArtifact),
        },
      };
    }

    return {
      ok: true,
      errors: [],
      request: {
        type: 'inspection-evidence-promotion-dry-run',
        intake_report_path: trimOptionalString(request.intake_report_path),
        ...(isPlainObject(request.options) ? { options: structuredClone(request.options) } : {}),
      },
    };
  }

  if (request.type === 'stage5b-evidence-audit') {
    const options = buildStage5bAuditOptions(request);
    return {
      ok: true,
      errors: [],
      request: {
        type: 'stage5b-evidence-audit',
        ...(Object.keys(options).length > 0 ? { options } : {}),
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
          artifact_ref: trimArtifactRef(request.artifact_ref),
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
