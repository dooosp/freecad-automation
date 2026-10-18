import { resolve } from 'node:path';
import { loadShopProfile } from '../config/profile-service.js';
import { loadRuleProfile } from '../config/rule-profile-service.js';
import { runPythonJsonScript } from '../../../lib/context-loader.js';
import { bindReportAnalysis, reportConfigFingerprint, reportDfmInputFingerprint } from '../report/report-provenance.js';

export function createDfmService({
  loadShopProfileFn = loadShopProfile,
  loadRuleProfileFn = loadRuleProfile,
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
    standard,
  }) {
    const loadedConfig = config ?? await loadConfig(resolve(freecadRoot, configPath));
    const configFingerprint = reportConfigFingerprint(loadedConfig);
    const dfmConfig = structuredClone(loadedConfig);
    const ruleProfile = await loadRuleProfileFn(freecadRoot, loadedConfig, { silent: true });
    const resolvedStandard = loadedConfig.standard || standard || ruleProfile?.standards?.default_standard || 'KS';
    dfmConfig.standard = resolvedStandard;
    dfmConfig.manufacturing = { ...(dfmConfig.manufacturing || {}), process };
    const effectiveInputFingerprint = reportDfmInputFingerprint(dfmConfig);
    if (ruleProfile) {
      dfmConfig.rule_profile = ruleProfile;
    }

    const shopProfile = await loadShopProfileFn(freecadRoot, profileName);
    if (shopProfile) {
      dfmConfig.shop_profile = shopProfile;
    }

    if (freecadRoot) {
      return bindReportAnalysis(await runPythonJsonScriptFn(freecadRoot, 'scripts/dfm_checker.py', dfmConfig, { timeout: 60_000 }), configFingerprint, effectiveInputFingerprint);
    }

    return bindReportAnalysis(await runScript('dfm_checker.py', dfmConfig, { timeout: 60_000 }), configFingerprint, effectiveInputFingerprint);
  };
}

export const runDfm = createDfmService();
