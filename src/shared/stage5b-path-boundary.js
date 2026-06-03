import { lstat, realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';

export const LOCAL_STAGE5B_CANDIDATE_EVIDENCE_INBOX = 'local/stage5b-candidate-evidence-inbox';

const UNSAFE_STAGE5B_LOCAL_PREFIXES = Object.freeze([
  `${LOCAL_STAGE5B_CANDIDATE_EVIDENCE_INBOX}/`,
  'output/',
  'tmp/codex/',
]);

export function normalizeRepoRelativePathText(value) {
  return typeof value === 'string'
    ? value.trim().replaceAll('\\', '/').replace(/^\.\//, '')
    : '';
}

export function isLocalStage5bCandidateEvidenceInboxPath(value) {
  const normalized = normalizeRepoRelativePathText(value);
  return normalized === LOCAL_STAGE5B_CANDIDATE_EVIDENCE_INBOX
    || normalized.startsWith(`${LOCAL_STAGE5B_CANDIDATE_EVIDENCE_INBOX}/`);
}

export function isUnsafeStage5bLocalPathText(value) {
  const normalized = normalizeRepoRelativePathText(value);
  return normalized === 'output'
    || normalized === 'tmp/codex'
    || isLocalStage5bCandidateEvidenceInboxPath(normalized)
    || UNSAFE_STAGE5B_LOCAL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
}

function repoRelativePath(rootDir, targetPath) {
  return relative(rootDir, targetPath).replaceAll('\\', '/');
}

function isInsideRoot(rootDir, targetPath) {
  const rel = repoRelativePath(rootDir, targetPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function isUnsafeResolvedStage5bPath(rootDir, targetPath) {
  const rel = repoRelativePath(rootDir, targetPath);
  return rel === 'output'
    || rel === 'tmp/codex'
    || rel === LOCAL_STAGE5B_CANDIDATE_EVIDENCE_INBOX
    || UNSAFE_STAGE5B_LOCAL_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

export function safeStage5bRepoRelativePath(projectRoot, pathValue) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) return null;
  const raw = pathValue.trim();
  if (raw.includes('\0') || raw.includes('\\') || raw.startsWith('~') || isWindowsAbsolutePath(raw)) return null;
  const root = resolve(projectRoot);
  const absolute = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
  const rel = repoRelativePath(root, absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  if (rel.split('/').includes('..') || isUnsafeStage5bLocalPathText(rel)) return null;
  return rel;
}

export class Stage5bPathBoundaryError extends Error {
  constructor(message, { path = null, label = null } = {}) {
    super(message);
    this.name = 'Stage5bPathBoundaryError';
    this.path = path;
    this.label = label;
  }
}

export async function assertSafeStage5bInputFile(projectRoot, pathValue, {
  label = 'Stage 5B input',
} = {}) {
  const safeRelativePath = safeStage5bRepoRelativePath(projectRoot, pathValue);
  if (!safeRelativePath) {
    throw new Stage5bPathBoundaryError(
      `${label} must stay inside the repository root as a safe repo-relative path outside ignored local Stage 5B inbox, output/, and tmp/codex/.`,
      { path: basename(String(pathValue || '')), label }
    );
  }

  const rootRealPath = await realpath(resolve(projectRoot));
  const resolvedPath = resolve(rootRealPath, safeRelativePath);
  const linkInfo = await lstat(resolvedPath);
  if (linkInfo.isSymbolicLink()) {
    throw new Stage5bPathBoundaryError(`${label} must not be a symlink or symbolic link.`, {
      path: safeRelativePath,
      label,
    });
  }

  const fileRealPath = await realpath(resolvedPath);
  if (!isInsideRoot(rootRealPath, fileRealPath) || isUnsafeResolvedStage5bPath(rootRealPath, fileRealPath)) {
    throw new Stage5bPathBoundaryError(
      `${label} real path must remain inside the repository root and outside ignored local Stage 5B inbox, output/, and tmp/codex/.`,
      { path: safeRelativePath, label }
    );
  }

  return {
    absolute: fileRealPath,
    relative: repoRelativePath(rootRealPath, fileRealPath),
  };
}
