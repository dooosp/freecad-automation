import { basename, isAbsolute, relative, resolve } from 'node:path';

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
const PORTABLE_PREFIX = /^(?:run|repo|input|runtime)\//;

function portableSeparators(value) {
  return String(value).replaceAll('\\', '/');
}

function isWithin(rootPath, targetPath) {
  const rel = portableSeparators(relative(resolve(rootPath), resolve(targetPath)));
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel));
}

function safeLeaf(value, fallback = 'redacted') {
  const leaf = portableSeparators(value).split('/').filter(Boolean).pop();
  return leaf && leaf !== '.' && leaf !== '..' ? leaf : fallback;
}

export function isAbsoluteManifestPath(value) {
  return typeof value === 'string'
    && (isAbsolute(value) || WINDOWS_ABSOLUTE_PATH.test(value));
}

export function toPortableManifestLocator(value, {
  projectRoot,
  portablePathRoot = null,
  category = 'input',
  preferRepo = false,
} = {}) {
  if (typeof value !== 'string' || !value.trim()) return value;
  const raw = value.trim();
  const normalized = portableSeparators(raw);
  if (PORTABLE_PREFIX.test(normalized)) return normalized;

  if (!isAbsoluteManifestPath(raw)) {
    const segments = normalized.split('/');
    if (
      !normalized.includes('\0')
      && !normalized.startsWith('~/')
      && !segments.includes('..')
    ) {
      return normalized;
    }
    return `${category}/${safeLeaf(normalized)}`;
  }

  // A Windows absolute path cannot be resolved reliably on a POSIX host. It is
  // intentionally reduced to a stable public locator instead of being exposed.
  if (WINDOWS_ABSOLUTE_PATH.test(raw) && process.platform !== 'win32') {
    return `${category}/${safeLeaf(normalized)}`;
  }

  const absolute = resolve(raw);
  if (portablePathRoot && isWithin(portablePathRoot, absolute)) {
    const rel = portableSeparators(relative(resolve(portablePathRoot), absolute));
    return rel ? `run/${rel}` : 'run/root';
  }
  if (preferRepo && projectRoot && isWithin(projectRoot, absolute)) {
    const rel = portableSeparators(relative(resolve(projectRoot), absolute));
    return rel ? `repo/${rel}` : 'repo/root';
  }
  if (!portablePathRoot && projectRoot && isWithin(projectRoot, absolute)) {
    const rel = portableSeparators(relative(resolve(projectRoot), absolute));
    return rel ? `repo/${rel}` : 'repo/root';
  }
  return `${category}/${safeLeaf(normalized)}`;
}

function looksLikePathField(key) {
  return key === 'path'
    || key === 'root'
    || key === 'executable'
    || key.endsWith('_path')
    || key.endsWith('_root')
    || key.endsWith('_executable');
}

export function portableizeManifestValue(value, options = {}, key = '') {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    if (key === 'checked_candidates') return [];
    return value.map((entry) => portableizeManifestValue(entry, options, key));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      portableizeManifestValue(childValue, options, childKey),
    ]));
  }
  if (typeof value !== 'string') return value;
  if (!looksLikePathField(key) && !isAbsoluteManifestPath(value)) return value;
  return toPortableManifestLocator(value, {
    ...options,
    category: key.includes('config') ? 'repo' : 'input',
    preferRepo: key.includes('config'),
  });
}

export function portableRuntimePath(value, label) {
  if (value === null || value === undefined || value === '') return value;
  return `runtime/${safeLeaf(label, basename(String(value)))}`;
}
