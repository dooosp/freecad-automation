import { resolve } from 'node:path';
import { loadShopProfile } from '../config/profile-service.js';
import { loadRuleProfile } from '../config/rule-profile-service.js';
import { runPythonJsonScript } from '../../../lib/context-loader.js';

export function createCostService({
  loadShopProfileFn = loadShopProfile,
  loadRuleProfileFn = loadRuleProfile,
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
    standard,
  }) {
    const loadedConfig = config ?? await loadConfig(resolve(freecadRoot, configPath));
    const ruleProfile = await loadRuleProfileFn(freecadRoot, loadedConfig, { silent: true });
    const costInput = {
      ...structuredClone(loadedConfig),
      dfm_result: dfmResult,
      material,
      process,
      batch_size: batchSize,
      standard: loadedConfig.standard || standard || ruleProfile?.standards?.default_standard || 'KS',
    };
    if (ruleProfile) {
      costInput.rule_profile = ruleProfile;
    }

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
