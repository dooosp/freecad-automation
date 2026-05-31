import { basename, extname, posix, win32 } from 'node:path';

const POSIX_FILESYSTEM_ROOTS = new Set([
  'Applications',
  'Users',
  'Volumes',
  'etc',
  'home',
  'mnt',
  'opt',
  'private',
  'srv',
  'tmp',
  'usr',
  'var',
]);

const WINDOWS_PATH_PATTERN = /(?:[A-Za-z]:\\(?:[^\\\r\n"'`<>|]+\\?)+|\\\\[^\s"'`<>|]+(?:\\[^\s"'`<>|]+)+)/g;
const POSIX_PATH_PATTERN = /(?:\/(?:[^\/\s"'`<>()]+\/)+[^\/\s"'`<>()]+)/g;
const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/gi;

const INLINE_ARTIFACT_EXTENSIONS = new Set([
  '.csv',
  '.dxf',
  '.json',
  '.log',
  '.md',
  '.markdown',
  '.pdf',
  '.text',
  '.toml',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
  '.step',
]);

export function inferArtifactContentType(filePath = '') {
  const extension = extname(filePath).toLowerCase();
  switch (extension) {
    case '.csv':
      return 'text/csv; charset=utf-8';
    case '.dxf':
      return 'image/vnd.dxf';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.log':
    case '.txt':
    case '.text':
    case '.step':
      return 'text/plain; charset=utf-8';
    case '.md':
    case '.markdown':
      return 'text/markdown; charset=utf-8';
    case '.pdf':
      return 'application/pdf';
    case '.svg':
      return 'image/svg+xml';
    case '.toml':
      return 'application/toml; charset=utf-8';
    case '.xml':
      return 'application/xml; charset=utf-8';
    case '.yaml':
    case '.yml':
      return 'application/yaml; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function isBrowserAddressableArtifact(artifact = {}) {
  return artifact.scope === 'user-facing';
}

function isInlineBlockedArtifact(artifact = {}) {
  return extname(artifact.path || artifact.file_name || '').toLowerCase() === '.html';
}

function isInlinePreviewSafeArtifact(artifact = {}) {
  const filePath = artifact.path || '';
  const extension = extname(filePath).toLowerCase();
  return INLINE_ARTIFACT_EXTENSIONS.has(extension) && !isInlineBlockedArtifact(artifact);
}

function buildArtifactCapabilities(artifact = {}, { publicPathAllowed = true } = {}) {
  const exists = Boolean(artifact.exists);
  const browserSafe = isInlinePreviewSafeArtifact(artifact);
  const browserAddressable = isBrowserAddressableArtifact(artifact);
  return {
    can_open: exists && publicPathAllowed && browserSafe && browserAddressable,
    can_download: exists && publicPathAllowed && browserAddressable,
    browser_safe: browserSafe,
  };
}

function buildArtifactLinks(jobId, artifactId) {
  const encodedJobId = encodeURIComponent(jobId);
  const encodedId = encodeURIComponent(artifactId);
  const base = `/artifacts/${encodedJobId}/${encodedId}`;
  return {
    open: base,
    download: `${base}/download`,
    api: `/jobs/${encodedJobId}/artifacts/${encodedId}/content`,
  };
}

function isAbsoluteFilesystemPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && (
      /^[A-Za-z]:[\\/]/.test(value)
      || value.startsWith('\\\\')
      || (
        posix.isAbsolute(value)
        && POSIX_FILESYSTEM_ROOTS.has(value.split('/').filter(Boolean)[0] || '')
      )
    );
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost'
    || host === '::1'
    || host.endsWith('.local')
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    || /^169\.254\./.test(host);
}

function sanitizePublicUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password || isPrivateHostname(parsed.hostname)) return null;
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function basenameFromAnyPath(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (win32.isAbsolute(value)) return win32.basename(value);
  return basename(value);
}

function redactEmbeddedFilesystemPaths(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  return value
    .replace(WINDOWS_PATH_PATTERN, (match) => (
      isAbsoluteFilesystemPath(match) ? basenameFromAnyPath(match) : match
    ))
    .replace(POSIX_PATH_PATTERN, (match) => (
      isAbsoluteFilesystemPath(match) ? basenameFromAnyPath(match) : match
    ));
}

function redactPublicString(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (/^https?:\/\//i.test(value.trim())) {
    return sanitizePublicUrl(value.trim()) || '[redacted-url]';
  }
  return redactEmbeddedFilesystemPaths(value
    .replace(/authorization\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, '[redacted-header]')
    .replace(/\b(?:x-api-key|api-key|api_key|apikey|access_token|token|secret)\s*[:=]\s*[^&\s,;]+/gi, '[redacted-secret]')
    .replace(/gho_[A-Za-z0-9_]+/g, '[redacted-token]')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted-token]')
    .replace(URL_PATTERN, (match) => sanitizePublicUrl(match) || '[redacted-url]')
    .replace(/\b[a-z0-9.-]+\.local\b/gi, '[redacted-host]'));
}

export function redactPublicPathValues(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactPublicPathValues(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactPublicPathValues(entry)])
    );
  }

  if (isAbsoluteFilesystemPath(value)) {
    return basenameFromAnyPath(value);
  }

  return redactPublicString(value);
}

export function toPublicStorage(storage = null) {
  if (!storage?.files || typeof storage.files !== 'object') {
    return {
      files: {},
    };
  }

  return {
    files: Object.fromEntries(
      Object.entries(storage.files).map(([key, entry]) => [
        key,
        {
          exists: Boolean(entry?.exists),
          size_bytes: Number.isInteger(entry?.size_bytes) ? entry.size_bytes : null,
        },
      ])
    ),
  };
}

export function toArtifactResponse(jobId, artifact, { publicPathAllowed = true } = {}) {
  const contentType = inferArtifactContentType(artifact.path);
  return {
    id: artifact.id,
    key: artifact.key,
    type: artifact.type || null,
    scope: artifact.scope || null,
    stability: artifact.stability || null,
    file_name: artifact.file_name,
    extension: artifact.extension,
    content_type: contentType,
    exists: Boolean(artifact.exists),
    size_bytes: Number.isInteger(artifact.size_bytes) ? artifact.size_bytes : null,
    capabilities: buildArtifactCapabilities(artifact, { publicPathAllowed }),
    links: buildArtifactLinks(jobId, artifact.id),
    contract: artifact.metadata?.af_contract
      ? redactPublicPathValues(artifact.metadata.af_contract)
      : null,
  };
}

export function canServeArtifactContent(artifact = {}, { publicPathAllowed = true } = {}) {
  return publicPathAllowed && isBrowserAddressableArtifact(artifact) && isInlinePreviewSafeArtifact(artifact);
}

export function canDownloadArtifactContent(artifact = {}, { publicPathAllowed = true } = {}) {
  return publicPathAllowed && isBrowserAddressableArtifact(artifact) && Boolean(artifact.exists);
}
