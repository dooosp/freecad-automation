import { resolve } from 'node:path';

export async function runTolerance({
  freecadRoot,
  runScript,
  loadConfig,
  configPath,
  config,
  monteCarlo = true,
  mcSamples,
  standard = 'KS',
}) {
  const loadedConfig = config ?? await loadConfig(resolve(freecadRoot, configPath));
  const tolConfig = structuredClone(loadedConfig);
  tolConfig.standard = standard;

  const hasAssembly = Boolean(tolConfig.assembly);
  const hasParts = Array.isArray(tolConfig.parts) && tolConfig.parts.length > 0;
  if (!hasAssembly || !hasParts) {
    throw new Error('Tolerance analysis requires an assembly config with [assembly] and [[parts]] sections.');
  }

  tolConfig.tolerance = { ...(tolConfig.tolerance || {}) };
  if (typeof monteCarlo === 'boolean') {
    tolConfig.tolerance.monte_carlo = monteCarlo;
  }

  const parsedSamples = Number(mcSamples);
  if (Number.isFinite(parsedSamples) && parsedSamples > 0) {
    tolConfig.tolerance.mc_samples = Math.floor(parsedSamples);
  }

  return runScript('tolerance_analysis.py', tolConfig, { timeout: 60_000 });
}
