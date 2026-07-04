import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { parseCliArgs } from './args.js';
import { createCliOptionValidators } from './options.js';

export const CHECK_RUNTIME_USAGE_HINT = 'fcad check-runtime [--json] [--redact-paths] [--fingerprint-out <runtime_fingerprint.json>]';

function isPathInsideRoot(rootPath, candidatePath) {
  const relativePath = relative(rootPath, candidatePath).replace(/\\/g, '/');
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith('/'));
}

function nearestExistingParent(filePath) {
  let current = dirname(filePath);
  while (!existsSync(current)) {
    const next = dirname(current);
    if (next === current) return null;
    current = next;
  }
  return current;
}

function rejectRepoScopedPath(label) {
  console.error(`Error: ${label} must stay inside the repository root`);
  process.exit(1);
}

function rejectPathSafetyCheck(label) {
  console.error(`Error: ${label} failed repository path safety checks`);
  process.exit(1);
}

function requireOutputFileNotSymlink(label, outputPath) {
  try {
    if (lstatSync(outputPath).isSymbolicLink()) {
      rejectRepoScopedPath(label);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    rejectPathSafetyCheck(label);
  }
}

function requireRealParentInsideRepo(label, outputPath, projectRoot) {
  const existingParent = nearestExistingParent(outputPath);
  if (!existingParent) {
    rejectRepoScopedPath(label);
  }

  try {
    const rootRealPath = realpathSync(projectRoot);
    const parentRealPath = realpathSync(existingParent);
    if (!isPathInsideRoot(rootRealPath, parentRealPath)) {
      rejectRepoScopedPath(label);
    }
  } catch {
    rejectPathSafetyCheck(label);
  }
}

export function resolveRuntimeFingerprintOutputPath(
  rawValue,
  { projectRoot = process.cwd(), usageHint = CHECK_RUNTIME_USAGE_HINT } = {}
) {
  const { requireOptionValue, requireRepoScopedPath } = createCliOptionValidators({ projectRoot });
  const value = requireOptionValue('--fingerprint-out', rawValue, usageHint).trim();
  if (/^(true|false)$/i.test(value)) {
    console.error('Error: --fingerprint-out requires a real path value');
    if (usageHint) console.error(`  ${usageHint}`);
    process.exit(1);
  }

  const outputPath = resolve(projectRoot, value);
  requireRepoScopedPath('runtime fingerprint output', outputPath);
  requireOutputFileNotSymlink('runtime fingerprint output', outputPath);
  requireRealParentInsideRepo('runtime fingerprint output', outputPath, projectRoot);
  return outputPath;
}

export function parseCheckRuntimeOptions(args = [], { projectRoot = process.cwd() } = {}) {
  const { positional, options } = parseCliArgs(args);
  const hasFingerprintOut = Object.hasOwn(options, 'fingerprint-out');

  return {
    positional,
    options,
    useJson: Boolean(options.json),
    redactPaths: Boolean(options['redact-paths']),
    fingerprintOut: hasFingerprintOut
      ? resolveRuntimeFingerprintOutputPath(options['fingerprint-out'], { projectRoot })
      : null,
  };
}
