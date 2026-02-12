import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parse as parseTOML } from 'smol-toml';

/**
 * Recursively merge override into base. Override wins for leaf values.
 * Arrays are replaced (not concatenated).
 */
export function deepMerge(base, override) {
  for (const key of Object.keys(override)) {
    if (key in base && typeof base[key] === 'object' && !Array.isArray(base[key])
        && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      deepMerge(base[key], override[key]);
    } else {
      base[key] = override[key];
    }
  }
  return base;
}

/**
 * Load config from TOML or JSON file.
 * @param {string} filepath
 * @returns {Promise<object>}
 */
export async function loadConfig(filepath) {
  const raw = await readFile(filepath, 'utf8');
  const ext = extname(filepath).toLowerCase();

  if (ext === '.toml') {
    return parseTOML(raw);
  } else if (ext === '.json') {
    return JSON.parse(raw);
  } else {
    throw new Error(`Unsupported config format: ${ext} (use .toml or .json)`);
  }
}
