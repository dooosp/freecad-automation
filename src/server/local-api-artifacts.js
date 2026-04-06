import { basename, extname, posix, win32 } from 'node:path';

const INLINE_ARTIFACT_EXTENSIONS = new Set([
  '.csv',
  '.dxf',
  '.html',
  '.json',
  '.log',
  '.md',
  '.markdown',
  '.pdf',
  '.svg',
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

function buildArtifactCapabilities(filePath = '', exists = false) {
  const extension = extname(filePath).toLowerCase();
  const browserSafe = INLINE_ARTIFACT_EXTENSIONS.has(extension);
  return {
    can_open: exists && browserSafe,
    can_download: exists,
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
    && (posix.isAbsolute(value) || win32.isAbsolute(value));
}

function basenameFromAnyPath(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (win32.isAbsolute(value)) return win32.basename(value);
  return basename(value);
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

  return value;
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

export function toArtifactResponse(jobId, artifact) {
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
    capabilities: buildArtifactCapabilities(artifact.path, artifact.exists),
    links: buildArtifactLinks(jobId, artifact.id),
    contract: artifact.metadata?.af_contract
      ? redactPublicPathValues(artifact.metadata.af_contract)
      : null,
  };
}
