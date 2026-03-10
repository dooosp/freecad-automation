import { resolve } from 'node:path';
import { loadShopProfile } from '../config/profile-service.js';
import { runPythonJsonScript } from '../../../lib/context-loader.js';

export function createDfmService({
  loadShopProfileFn = loadShopProfile,
  runPythonJsonScriptFn = runPythonJsonScript,
} = {}) {
  return async function runDfm({
    freecadRoot,
    runScript,
    loadConfig,
    configPath,
    config,
    process = 'machining',
    profileName = null,
    standard = 'KS',
  }) {
    const loadedConfig = config ?? await loadConfig(resolve(freecadRoot, configPath));
    const dfmConfig = structuredClone(loadedConfig);
    dfmConfig.standard = standard;
    dfmConfig.manufacturing = { ...(dfmConfig.manufacturing || {}), process };

    const shopProfile = await loadShopProfileFn(freecadRoot, profileName);
    if (shopProfile) {
      dfmConfig.shop_profile = shopProfile;
    }

    if (freecadRoot) {
      return runPythonJsonScriptFn(freecadRoot, 'scripts/dfm_checker.py', dfmConfig, { timeout: 60_000 });
    }

    return runScript('dfm_checker.py', dfmConfig, { timeout: 60_000 });
  };
}

export const runDfm = createDfmService();
