import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export function createCliOptionValidators({ projectRoot = process.cwd() } = {}) {
  function ensureNumericOption(optionName, rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') return undefined;
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) {
      console.error(`Error: ${optionName} must be a finite number`);
      process.exit(1);
    }
    return numericValue;
  }

  function requireOptionValue(optionName, value, usageHint = null) {
    if (typeof value === 'string' && value && !value.startsWith('--')) {
      return value;
    }
    console.error(`Error: ${optionName} requires a value`);
    if (usageHint) console.error(`  ${usageHint}`);
    process.exit(1);
  }

  function rejectUnsupportedOptions(command, options = {}, allowed = []) {
    const allowedSet = new Set(allowed);
    const unsupported = Object.keys(options).filter((key) => !allowedSet.has(key));
    if (unsupported.length > 0) {
      console.error(`Error: ${command} does not accept option(s): ${unsupported.map((key) => `--${key}`).join(', ')}`);
      console.error(`  Allowed options: ${allowed.map((key) => `--${key}`).join(', ')}`);
      process.exit(1);
    }
  }

  function requireExistingInputFile(label, filePath) {
    if (!filePath) return;
    if (!existsSync(filePath)) {
      console.error(`Error: ${label} file not found: ${filePath}`);
      process.exit(1);
    }
  }

  function requireRepoScopedPath(label, filePath) {
    const relPath = relative(projectRoot, resolve(filePath)).replace(/\\/g, '/');
    if (!relPath || relPath.startsWith('..') || relPath.startsWith('/')) {
      console.error(`Error: ${label} must stay inside the repository root`);
      process.exit(1);
    }
    if (relPath.split('/').includes('..') || relPath.includes('\\') || relPath.startsWith('~')) {
      console.error(`Error: ${label} failed repository path safety checks`);
      process.exit(1);
    }
  }

  return {
    ensureNumericOption,
    rejectUnsupportedOptions,
    requireExistingInputFile,
    requireOptionValue,
    requireRepoScopedPath,
  };
}
