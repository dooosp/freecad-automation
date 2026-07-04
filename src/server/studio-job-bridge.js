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
import {
  buildInspectionEvidenceIntakeOptions,
  buildStage5bAuditOptions,
  internalArtifactRefError,
  isPlainObject,
  isInternalResolvedArtifact,
  isSafeRepoRelativeJsonPath,
  isSafeRepoRelativePath,
  trimArtifactRef,
  trimOptionalString,
  validateArtifactRef,
  validateInspectionEvidenceIntakeOptions,
  validateOptionalObject,
  validateStage5bAuditOptions,
} from './studio-job-request-helpers.js';

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

function artifactReentryTarget(artifact = {}) {
  return String(
    artifact?.contract?.reentry_target
    || artifact?.metadata?.af_contract?.reentry_target
    || ''
  ).trim();
}

function artifactHasReentryTarget(artifact = {}, targets = []) {
  return targets.includes(artifactReentryTarget(artifact));
}

function canonicalReentryError(command, targets = []) {
  const artifactDescription = targets.includes('review_pack')
    ? 'canonical review pack JSON or a release bundle'
    : 'canonical readiness report JSON or a release bundle';
  return `${command} requires ${artifactDescription} with AF contract metadata re-entry target ${targets.join(' or ')}.`;
}

function isSafePackageSlug(value) {
  const raw = trimOptionalString(value);
  return Boolean(raw)
    && raw !== '.'
    && raw !== '..'
    && !raw.includes('/')
    && !raw.includes('\\')
    && !raw.includes('\0')
    && !raw.startsWith('~');
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
    'package_id',
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
    'review_pack_path',
    'readiness_report_path',
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
  const hasReviewPackPath = trimOptionalString(request.review_pack_path).length > 0;
  const hasReadinessReportPath = trimOptionalString(request.readiness_report_path).length > 0;

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
    'review_pack_path',
    'readiness_report_path',
    'intake_report_path',
  ].forEach((fieldName) => {
    if (request[fieldName] !== undefined && trimOptionalString(request[fieldName]).length === 0) {
      errors.push(`${fieldName} must be a non-empty string when provided.`);
    }
  });
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
  ].forEach((fieldName) => {
    if (request[fieldName] !== undefined && trimOptionalString(request[fieldName]).length > 0 && !isSafeRepoRelativePath(request[fieldName])) {
      errors.push(`${fieldName} must be a safe repo-relative path.`);
    }
  });
  [
    'review_pack_path',
    'readiness_report_path',
  ].forEach((fieldName) => {
    if (request[fieldName] !== undefined && trimOptionalString(request[fieldName]).length > 0 && !isSafeRepoRelativeJsonPath(request[fieldName])) {
      errors.push(`${fieldName} must be a safe repo-relative JSON path.`);
    }
  });

  if (request.type === 'review-context') {
    if (!hasContextPath && !hasModelPath) {
      errors.push('review-context requires either context_path or model_path.');
    }
    if (hasConfigToml || hasArtifactRef || hasBaselineArtifactRef || hasCandidateArtifactRef) {
      errors.push('review-context does not accept config_toml, artifact_ref, baseline_artifact_ref, or candidate_artifact_ref.');
    }
  } else if (request.type === 'evidence-graph') {
    const unsupportedEvidenceGraphFields = [
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
    if (unsupportedEvidenceGraphFields.length > 0) {
      errors.push(`evidence-graph does not accept ${unsupportedEvidenceGraphFields.join(', ')}.`);
    }
    if (!isSafePackageSlug(request.package_id)) {
      errors.push('evidence-graph package_id must be a safe package slug.');
    }
    if (!hasReviewPackPath) {
      errors.push('evidence-graph requires review_pack_path.');
    }
    if (!hasReadinessReportPath) {
      errors.push('evidence-graph requires readiness_report_path.');
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

  if (request.type === 'evidence-graph') {
    return {
      ok: true,
      errors: [],
      request: {
        type: 'evidence-graph',
        package_id: trimOptionalString(request.package_id),
        review_pack_path: trimOptionalString(request.review_pack_path),
        readiness_report_path: trimOptionalString(request.readiness_report_path),
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
      if (isInternalResolvedArtifact(resolvedArtifact)) {
        return {
          ok: false,
          errors: [internalArtifactRefError()],
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

    if (isInternalResolvedArtifact(baselineArtifact) || isInternalResolvedArtifact(candidateArtifact)) {
      return {
        ok: false,
        errors: [internalArtifactRefError()],
      };
    }

    if (request.type === 'compare-rev') {
      const baselineReviewPack = findPreferredReviewPackArtifact([baselineArtifact.artifact]);
      const candidateReviewPack = findPreferredReviewPackArtifact([candidateArtifact.artifact]);
      if (
        !baselineReviewPack
        || !candidateReviewPack
        || !artifactHasReentryTarget(baselineReviewPack, ['review_pack'])
        || !artifactHasReentryTarget(candidateReviewPack, ['review_pack'])
      ) {
        return {
          ok: false,
          errors: ['compare-rev needs canonical review-pack JSON artifacts with AF contract re-entry target review_pack for both baseline and candidate.'],
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
      if (
        !baselineReadiness
        || !candidateReadiness
        || !artifactHasReentryTarget(baselineReadiness, ['readiness_report'])
        || !artifactHasReentryTarget(candidateReadiness, ['readiness_report'])
      ) {
        return {
          ok: false,
          errors: ['stabilization-review needs canonical readiness-report JSON artifacts with AF contract re-entry target readiness_report for both baseline and candidate.'],
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
    if (isInternalResolvedArtifact(resolvedArtifact)) {
      return {
        ok: false,
        errors: [internalArtifactRefError()],
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
      if (
        (!isReviewPackArtifact(resolvedArtifact.artifact) && !isReleaseBundleArtifact(resolvedArtifact.artifact))
        || !artifactHasReentryTarget(resolvedArtifact.artifact, ['review_pack', 'release_bundle'])
      ) {
        return {
          ok: false,
          errors: [canonicalReentryError('readiness-pack', ['review_pack', 'release_bundle'])],
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
      if (
        (!isReadinessReportArtifact(selectedArtifact) && !isReleaseBundleArtifact(selectedArtifact))
        || !artifactHasReentryTarget(selectedArtifact, ['readiness_report', 'release_bundle'])
      ) {
        return {
          ok: false,
          errors: [canonicalReentryError('generate-standard-docs', ['readiness_report', 'release_bundle'])],
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
      if (
        (!isReadinessReportArtifact(selectedArtifact) && !isReleaseBundleArtifact(selectedArtifact))
        || !artifactHasReentryTarget(selectedArtifact, ['readiness_report', 'release_bundle'])
      ) {
        return {
          ok: false,
          errors: [canonicalReentryError('pack', ['readiness_report', 'release_bundle'])],
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
