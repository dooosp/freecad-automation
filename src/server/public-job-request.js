import { basename, posix, win32 } from 'node:path';

const INTERNAL_REQUEST_FIELDS = new Set([
  'config_path',
  'file_path',
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
  'baseline_path',
  'candidate_path',
  'review_pack_path',
  'process_plan_path',
  'quality_risk_path',
  'readiness_report_path',
  'docs_manifest_path',
  'intake_report_path',
  'intake_report_artifact_ref',
  'source_artifact_path',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAbsoluteFilesystemPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && (posix.isAbsolute(value) || win32.isAbsolute(value));
}

function basenameFromAnyPath(value) {
  if (win32.isAbsolute(value)) return win32.basename(value);
  return basename(value);
}

function sanitizeRequestValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeRequestValue(entry));
  }

  if (isPlainObject(value)) {
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
      if (INTERNAL_REQUEST_FIELDS.has(key)) continue;
      next[key] = sanitizeRequestValue(entry);
    }
    return next;
  }

  if (isAbsoluteFilesystemPath(value)) {
    const shortName = basenameFromAnyPath(value);
    return shortName && shortName !== '.' ? shortName : '[hidden-path]';
  }

  return value;
}

function buildArtifactRefMetadata(request = {}) {
  const studio = request.options?.studio;
  if (!isPlainObject(studio) || studio.source !== 'artifact-reference') {
    return buildDirectArtifactRefMetadata(request);
  }

  const sourceJobId = typeof studio.source_job_id === 'string' ? studio.source_job_id.trim() : '';
  const sourceArtifactId = typeof studio.source_artifact_id === 'string' ? studio.source_artifact_id.trim() : '';
  const sourceArtifactType = typeof studio.source_artifact_type === 'string' ? studio.source_artifact_type.trim() : '';
  const sourceLabel = typeof studio.source_label === 'string' ? studio.source_label.trim() : '';

  if (!sourceJobId || !sourceArtifactId) {
    return {};
  }

  return {
    artifact_ref: {
      job_id: sourceJobId,
      artifact_id: sourceArtifactId,
    },
    source_job_id: sourceJobId,
    source_artifact_id: sourceArtifactId,
    ...(sourceArtifactType ? { source_artifact_type: sourceArtifactType } : {}),
    ...(sourceLabel ? { source_label: sourceLabel } : {}),
  };
}

function buildDirectArtifactRefMetadata(request = {}) {
  const ref = request.intake_report_artifact_ref;
  if (!isPlainObject(ref)) return {};

  const sourceJobId = typeof ref.job_id === 'string' ? ref.job_id.trim() : '';
  const sourceArtifactId = typeof ref.artifact_id === 'string' ? ref.artifact_id.trim() : '';
  if (!sourceJobId || !sourceArtifactId) return {};

  return {
    artifact_ref: {
      job_id: sourceJobId,
      artifact_id: sourceArtifactId,
    },
    source_job_id: sourceJobId,
    source_artifact_id: sourceArtifactId,
  };
}

export function toPublicJobRequest(request = {}) {
  const next = sanitizeRequestValue(structuredClone(request));
  return {
    ...next,
    ...buildArtifactRefMetadata(request),
  };
}
