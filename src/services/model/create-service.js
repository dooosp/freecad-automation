import { resolve } from 'node:path';

export async function createModel({
  freecadRoot,
  runScript,
  loadConfig,
  configPath,
  config,
}) {
  const loadedConfig = config ?? await loadConfig(resolve(freecadRoot, configPath));
  return runScript('create_model.py', loadedConfig, {
    timeout: 120_000,
  });
}
