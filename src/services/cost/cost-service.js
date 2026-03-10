import { resolve } from 'node:path';
import { loadShopProfile } from '../config/profile-service.js';
import { runPythonJsonScript } from '../../../lib/context-loader.js';

export function createCostService({
  loadShopProfileFn = loadShopProfile,
  runPythonJsonScriptFn = runPythonJsonScript,
} = {}) {
  return async function runCost({
    freecadRoot,
    runScript,
    loadConfig,
    configPath,
    config,
    process = 'machining',
    material = 'SS304',
    batchSize = 1,
    dfmResult = null,
    profileName = null,
    standard = 'KS',
  }) {
    const loadedConfig = config ?? await loadConfig(resolve(freecadRoot, configPath));
    const costInput = {
      ...structuredClone(loadedConfig),
      dfm_result: dfmResult,
      material,
      process,
      batch_size: batchSize,
      standard,
    };

    const shopProfile = await loadShopProfileFn(freecadRoot, profileName);
    if (shopProfile) {
      costInput.shop_profile = shopProfile;
    }

    if (freecadRoot) {
      return runPythonJsonScriptFn(freecadRoot, 'scripts/cost_estimator.py', costInput, { timeout: 60_000 });
    }

    return runScript('cost_estimator.py', costInput, { timeout: 60_000 });
  };
}

export const runCost = createCostService();
