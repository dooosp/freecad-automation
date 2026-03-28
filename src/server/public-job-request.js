import { basename, posix, win32 } from 'node:path';

const INTERNAL_REQUEST_FIELDS = new Set([
  'file_path',
  'config_path',
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
    return {};
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

export function toPublicJobRequest(request = {}) {
  const next = sanitizeRequestValue(structuredClone(request));
  return {
    ...next,
    ...buildArtifactRefMetadata(request),
  };
}
