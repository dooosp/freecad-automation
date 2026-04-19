import { basename, posix, relative, resolve, win32 } from 'node:path';

import { isWindowsAbsolutePath } from '../../lib/paths.js';

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

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  }
  return value;
}

function firstPosixSegment(value = '') {
  return String(value).split('/').filter(Boolean)[0] || '';
}

export function isAbsoluteFilesystemPath(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (isWindowsAbsolutePath(trimmed) || trimmed.startsWith('\\\\')) return true;
  if (!posix.isAbsolute(trimmed)) return false;
  return POSIX_FILESYSTEM_ROOTS.has(firstPosixSegment(trimmed));
}

function normalizeComparablePath(value) {
  if (!isAbsoluteFilesystemPath(value)) return '';
  if (isWindowsAbsolutePath(value) || String(value).trim().startsWith('\\\\')) {
    const normalized = String(value).trim().replaceAll('/', '\\');
    return win32.normalize(normalized).toLowerCase();
  }
  return resolve(String(value).trim());
}

function isPathInside(basePath, candidatePath) {
  const baseComparable = normalizeComparablePath(basePath);
  const candidateComparable = normalizeComparablePath(candidatePath);
  if (!baseComparable || !candidateComparable) return false;
  if (isWindowsAbsolutePath(basePath) || String(basePath).trim().startsWith('\\\\')) {
    return candidateComparable === baseComparable || candidateComparable.startsWith(`${baseComparable}\\`);
  }
  return candidateComparable === baseComparable || candidateComparable.startsWith(`${baseComparable}/`);
}

function relativeDisplay(basePath, candidatePath) {
  if (!isPathInside(basePath, candidatePath)) return '';
  if (isWindowsAbsolutePath(basePath) || String(basePath).trim().startsWith('\\\\')) {
    return win32.relative(String(basePath).trim(), String(candidatePath).trim()).replaceAll('\\', '/');
  }
  return relative(resolve(String(basePath).trim()), resolve(String(candidatePath).trim())).replaceAll('\\', '/');
}

function basenameFromPath(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replaceAll('\\', '/');
  return basename(trimmed);
}

function looksLikeRuntimePath(value, context) {
  if (!value) return false;
  if (context.runtimePaths.has(value)) return true;
  if (context.runtimeRoots.some((root) => isPathInside(root, value))) return true;
  const lower = String(value).toLowerCase();
  const leaf = basenameFromPath(value).toLowerCase();
  return lower.includes('freecad')
    || leaf === 'python'
    || leaf === 'python3'
    || leaf === 'python.exe'
    || leaf === 'pythonw.exe'
    || leaf === 'freecad'
    || leaf === 'freecadcmd'
    || leaf === 'freecadcmd.exe'
    || leaf === 'freecad.exe';
}

export function sanitizePublicPath(value, context = {}) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!isAbsoluteFilesystemPath(trimmed)) return value;

  if (context.jobsDir && isPathInside(context.jobsDir, trimmed)) {
    const suffix = relativeDisplay(context.jobsDir, trimmed);
    return suffix ? `<jobs-dir>/${suffix}` : '<jobs-dir>';
  }

  if (context.projectRoot && isPathInside(context.projectRoot, trimmed)) {
    const suffix = relativeDisplay(context.projectRoot, trimmed);
    return suffix ? `<project-root>/${suffix}` : '<project-root>';
  }

  if (looksLikeRuntimePath(trimmed, context)) {
    const leaf = basenameFromPath(trimmed);
    return leaf ? `<freecad-runtime>/${leaf}` : '<freecad-runtime>';
  }

  const leaf = basenameFromPath(trimmed);
  return leaf ? `<path>/${leaf}` : '<path>';
}

function collectKnownPaths(value, knownPaths = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectKnownPaths(entry, knownPaths));
    return knownPaths;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectKnownPaths(entry, knownPaths));
    return knownPaths;
  }

  if (typeof value === 'string' && isAbsoluteFilesystemPath(value)) {
    knownPaths.add(value.trim());
  }

  return knownPaths;
}

function extractAbsolutePathMatches(text = '') {
  const matches = new Set();
  const value = String(text || '');
  for (const match of value.matchAll(WINDOWS_PATH_PATTERN)) {
    if (match[0]) matches.add(match[0]);
  }
  for (const match of value.matchAll(POSIX_PATH_PATTERN)) {
    if (isAbsoluteFilesystemPath(match[0])) matches.add(match[0]);
  }
  return [...matches];
}

function sanitizePublicString(value, context) {
  let next = String(value);
  const candidates = new Set();

  context.knownPaths.forEach((knownPath) => {
    if (next.includes(knownPath)) {
      candidates.add(knownPath);
    }
  });

  extractAbsolutePathMatches(next).forEach((match) => candidates.add(match));

  [...candidates]
    .sort((left, right) => right.length - left.length)
    .forEach((candidate) => {
      next = next.split(candidate).join(sanitizePublicPath(candidate, context));
    });

  if (isAbsoluteFilesystemPath(next.trim())) {
    return sanitizePublicPath(next.trim(), context);
  }

  return next;
}

export function createPublicPathContext({
  projectRoot = '',
  jobsDir = '',
  runtimeDiagnostics = null,
} = {}) {
  const knownPaths = collectKnownPaths(runtimeDiagnostics);
  if (isAbsoluteFilesystemPath(projectRoot)) knownPaths.add(projectRoot);
  if (isAbsoluteFilesystemPath(jobsDir)) knownPaths.add(jobsDir);

  const runtimePaths = collectKnownPaths(runtimeDiagnostics);
  const runtimeRoots = [...runtimePaths].filter((value) => {
    const leaf = basenameFromPath(value).toLowerCase();
    return leaf === 'freecad.app'
      || leaf === 'resources'
      || leaf === 'bin'
      || leaf === 'freecad'
      || leaf === 'freecadcmd'
      || leaf === 'freecadcmd.exe'
      || leaf === 'freecad.exe'
      || leaf === 'python'
      || leaf === 'python3'
      || leaf === 'python.exe';
  });

  return {
    projectRoot,
    jobsDir,
    knownPaths,
    runtimePaths,
    runtimeRoots,
  };
}

export function sanitizePublicPayload(value, context = {}) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePublicPayload(entry, context));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizePublicPayload(entry, context)])
    );
  }

  if (typeof value === 'string') {
    return sanitizePublicString(value, context);
  }

  return clone(value);
}
