import { dirname, isAbsolute, parse, relative, resolve } from 'node:path';

import { artifactPathFor, deriveArtifactStem } from '../../lib/context-loader.js';
import { isWindowsAbsolutePath, normalizeLocalPath } from '../../lib/paths.js';

export function installCliStreamErrorHandlers(streams = [process.stdout, process.stderr]) {
  for (const stream of streams) {
    stream.on('error', (error) => {
      if (error?.code !== 'EPIPE') {
        throw error;
      }
    });
  }
}

export function createRunWithCliStderr(runScript, stderr = process.stderr) {
  const forwardStderr = (text) => {
    if (!text || !stderr || stderr.destroyed || stderr.writable === false) {
      return;
    }
    stderr.write(text, (error) => {
      if (error && error.code !== 'EPIPE') {
        process.nextTick(() => {
          throw error;
        });
      }
    });
  };

  return (script, input, opts = {}) => runScript(script, input, {
    ...opts,
    onStderr: forwardStderr,
  });
}

export function createCliPathHelpers({ projectRoot = process.cwd() } = {}) {
  function resolveMaybe(value) {
    if (!value) return null;
    const normalized = normalizeLocalPath(value);
    if (typeof normalized !== 'string' || !normalized.trim()) return null;
    if (isAbsolute(normalized) || isWindowsAbsolutePath(normalized)) {
      return normalized;
    }
    return resolve(normalized);
  }

  function buildDefaultOutputDir(preferredPath) {
    if (!preferredPath) return resolve(projectRoot, 'output');
    const resolved = resolveMaybe(preferredPath);
    return resolved.endsWith('.json') ? dirname(resolved) : resolved;
  }

  function repoRelativePath(filePath) {
    if (typeof filePath !== 'string' || !filePath.trim()) return filePath;
    const relPath = relative(projectRoot, resolve(filePath)).replace(/\\/g, '/');
    return relPath && !relPath.startsWith('..') && !relPath.startsWith('/')
      ? relPath
      : filePath;
  }

  function cliRelativePath(pathValue) {
    if (!pathValue || typeof pathValue !== 'string') return null;
    const rel = relative(projectRoot, pathValue).replaceAll('\\', '/');
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : pathValue;
  }

  function normalizeJsonOutputPath(pathValue) {
    if (!pathValue) return null;
    const absPath = resolveMaybe(pathValue);
    return absPath.toLowerCase().endsWith('.json') ? absPath : `${absPath}.json`;
  }

  return {
    buildDefaultOutputDir,
    cliRelativePath,
    normalizeJsonOutputPath,
    repoRelativePath,
    resolveMaybe,
  };
}

export function stemFromContext(context, fallback = 'artifact') {
  return context?.part?.name || context?.part?.part_id || fallback;
}

export function nowIso() {
  return new Date().toISOString();
}

export function createArtifactPaths(basePathOrDir, stem, suffixes) {
  const result = {};
  for (const [key, suffix] of Object.entries(suffixes)) {
    result[key] = artifactPathFor(basePathOrDir, stem, suffix);
  }
  return result;
}

export function siblingArtifactPath(primaryJsonPath, suffix) {
  const parsed = parse(primaryJsonPath);
  const stem = deriveArtifactStem(parsed.name, parsed.name);
  return resolve(parsed.dir, `${stem}${suffix}`);
}
