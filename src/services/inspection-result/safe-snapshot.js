import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export function assertLexicallySafePath(pathValue, label) {
  const text = String(pathValue ?? '');
  if (!text || text.includes('\0') || text.includes('\\') || text.replaceAll('\\', '/').split('/').includes('..')) {
    throw new Error(`${label} contains traversal, NUL, or backslash syntax`);
  }
  return text;
}

export function repoRelative(projectRoot, pathValue, label) {
  const rel = relative(resolve(projectRoot), resolve(pathValue)).replaceAll('\\', '/');
  if (!rel || rel.startsWith('../') || isAbsolute(rel)) throw new Error(`${label} must stay inside the repository`);
  return rel;
}

export async function readSafeSnapshot({ projectRoot, path, label, maxBytes }) {
  assertLexicallySafePath(path, label);
  const absolute = resolve(projectRoot, path);
  const relativePath = repoRelative(projectRoot, absolute, label);
  const parent = dirname(absolute);
  if (await realpath(parent) !== parent) throw new Error(`${label} parent directory must not be a symlink`);
  const pathInfo = await lstat(absolute);
  if (!pathInfo.isFile() || pathInfo.isSymbolicLink() || pathInfo.nlink !== 1) throw new Error(`${label} must be a regular non-symlink, non-hardlinked file`);
  if (pathInfo.size < 1 || pathInfo.size > maxBytes) throw new Error(`${label} exceeds its bounded size contract`);
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let bytes;
  try {
    const before = await handle.stat();
    if (before.dev !== pathInfo.dev || before.ino !== pathInfo.ino) throw new Error(`${label} changed during snapshot preflight`);
    bytes = await handle.readFile();
    const after = await handle.stat();
    const currentPath = await lstat(absolute);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs
        || currentPath.dev !== before.dev || currentPath.ino !== before.ino || currentPath.size !== before.size) {
      throw new Error(`${label} changed while its immutable snapshot was captured`);
    }
  } finally { await handle.close(); }
  return Object.freeze({ path: absolute, relativePath, bytes, size: bytes.length, sha256: sha256(bytes), dev: pathInfo.dev, ino: pathInfo.ino });
}

export async function prepareSafeOutputDirectory({ projectRoot, outputPath, label }) {
  assertLexicallySafePath(outputPath, label);
  const absolute = resolve(projectRoot, outputPath);
  const rel = repoRelative(projectRoot, absolute, label);
  if (!(rel.startsWith('output/') || rel.startsWith('tmp/codex/'))) throw new Error(`${label} must stay under output/ or tmp/codex/`);
  let existingAncestor = dirname(absolute);
  for (;;) {
    try {
      const info = await lstat(existingAncestor);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(existingAncestor) !== existingAncestor) throw new Error(`${label} ancestor directory is unsafe`);
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) throw new Error(`${label} has no safe existing ancestor`);
      existingAncestor = parent;
    }
  }
  await mkdir(dirname(absolute), { recursive: true });
  if (await realpath(dirname(absolute)) !== dirname(absolute)) throw new Error(`${label} directory must not resolve through a symlink`);
  return { absolute, relativePath: rel, directory: dirname(absolute) };
}
