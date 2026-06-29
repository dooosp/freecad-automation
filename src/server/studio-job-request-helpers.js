import {
  isLocalStage5bCandidateEvidenceInboxPath,
  normalizeRepoRelativePathText,
} from '../shared/stage5b-path-boundary.js';

const MAX_TRACKED_ID_LENGTH = 128;

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateOptionalObject(value, fieldName, errors) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${fieldName} must be an object when provided.`);
  }
}

export function validateStage5bAuditOptions(options, errors) {
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

export function validateInspectionEvidenceIntakeOptions(options, errors) {
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

export function buildInspectionEvidenceIntakeOptions(request) {
  const options = {};
  if (request.options?.include_github === true || request.options?.include_github === false) {
    options.include_github = request.options.include_github;
  }
  if (Array.isArray(request.options?.package_slugs)) {
    options.package_slugs = request.options.package_slugs.map((slug) => slug.trim());
  }
  return options;
}

export function buildStage5bAuditOptions(request) {
  const options = {};
  if (request.options?.include_github === true || request.options?.include_github === false) {
    options.include_github = request.options.include_github;
  }
  return options;
}

export function validateArtifactRef(value, fieldName, errors) {
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

export function trimArtifactRef(value = {}) {
  return {
    job_id: String(value.job_id || '').trim(),
    artifact_id: String(value.artifact_id || '').trim(),
  };
}

export function internalArtifactRefError() {
  return 'artifact_ref points to an internal tracked artifact; use a user-facing tracked artifact.';
}

export function isInternalResolvedArtifact(resolved = {}) {
  return resolved?.artifact?.scope === 'internal';
}

export function isSafeTrackedId(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const lower = raw.toLowerCase();
  return Boolean(raw)
    && raw.length <= MAX_TRACKED_ID_LENGTH
    && raw !== '.'
    && raw !== '..'
    && !raw.includes('/')
    && !raw.includes('\\')
    && !lower.includes('%2f')
    && !lower.includes('%5c')
    && !raw.includes('\0')
    && !raw.startsWith('~');
}

export function trimOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

export function isSafeRepoRelativeJsonPath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const raw = value.trim();
  const normalized = normalizeRepoRelativePathText(raw);
  if (raw.includes('\\')) return false;
  if (normalized.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw) || normalized.startsWith('~')) return false;
  if (normalized.includes('\0') || normalized.includes('<') || normalized.includes('>')) return false;
  if (normalized.split('/').includes('..')) return false;
  if (isLocalStage5bCandidateEvidenceInboxPath(normalized)) return false;
  return /\.json$/i.test(normalized);
}

export function isSafeRepoRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const raw = value.trim();
  const normalized = normalizeRepoRelativePathText(raw);
  if (raw.includes('\\')) return false;
  if (normalized.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw) || normalized.startsWith('~')) return false;
  if (normalized.includes('\0') || normalized.includes('<') || normalized.includes('>')) return false;
  if (normalized.split('/').includes('..')) return false;
  if (isLocalStage5bCandidateEvidenceInboxPath(normalized)) return false;
  return true;
}
