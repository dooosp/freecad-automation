import { resolve } from 'node:path';

function camelToSnake(str) {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function convertKeysToSnake(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(convertKeysToSnake);

  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    out[camelToSnake(key)] = convertKeysToSnake(value);
  }
  return out;
}

export async function runFem({
  freecadRoot,
  runScript,
  loadConfig,
  configPath,
  config,
  fem,
}) {
  const loadedConfig = config ?? await loadConfig(resolve(freecadRoot, configPath));
  const femConfig = structuredClone(loadedConfig);
  femConfig.fem = convertKeysToSnake(fem);
  return runScript('fem_analysis.py', femConfig, { timeout: 300_000 });
}
