import { resolve } from 'node:path';
import { loadShopProfile } from '../config/profile-service.js';
import { loadRuleProfile } from '../config/rule-profile-service.js';
import { runPythonJsonScript } from '../../../lib/context-loader.js';
import { hasFreeCADRuntime } from '../../../lib/paths.js';
import { runScript as runFreeCADScript } from '../../../lib/runner.js';

export function createDfmService({
  loadShopProfileFn = loadShopProfile,
  loadRuleProfileFn = loadRuleProfile,
  runPythonJsonScriptFn = runPythonJsonScript,
} = {}) {
  return async function runDfm({
    freecadRoot,
    runScript = runFreeCADScript,
    loadConfig,
    configPath,
    config,
    process = 'machining',
    profileName = null,
    standard,
  }) {
    const loadedConfig = config ?? await loadConfig(resolve(freecadRoot, configPath));
    const dfmConfig = structuredClone(loadedConfig);
    const ruleProfile = await loadRuleProfileFn(freecadRoot, loadedConfig, { silent: true });
    const resolvedStandard = loadedConfig.standard || standard || ruleProfile?.standards?.default_standard || 'KS';
    dfmConfig.standard = resolvedStandard;
    dfmConfig.manufacturing = { ...(dfmConfig.manufacturing || {}), process };
    if (ruleProfile) {
      dfmConfig.rule_profile = ruleProfile;
    }

    const shopProfile = await loadShopProfileFn(freecadRoot, profileName);
    if (shopProfile) {
      dfmConfig.shop_profile = shopProfile;
    }

    if (Array.isArray(dfmConfig.shapes) && dfmConfig.shapes.some((shape) => shape && Object.hasOwn(shape, 'side_relief_radius_mm'))
        && hasFreeCADRuntime()) {
      try {
        const model = await runScript('create_model.py', { ...dfmConfig, export: null }, { timeout: 60_000 });
        if (model.dfm?.success) return model.dfm;
      } catch {
        // The metadata path still reports the declared relief as unverified.
      }
    }

    if (freecadRoot) {
      return runPythonJsonScriptFn(freecadRoot, 'scripts/dfm_checker.py', dfmConfig, { timeout: 60_000 });
    }

    return runScript('dfm_checker.py', dfmConfig, { timeout: 60_000 });
  };
}

export const runDfm = createDfmService();
