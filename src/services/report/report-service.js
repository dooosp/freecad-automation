import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  readJsonIfExists,
  runPythonJsonScript,
} from '../../../lib/context-loader.js';
import { convertPathFromRuntime, getFreeCADRuntime } from '../../../lib/paths.js';
import { collectRepoContext } from '../../../lib/output-manifest.js';
import { loadShopProfile } from '../config/profile-service.js';
import {
  loadRuleProfile,
  resolveMaterialProfile,
  summarizeRuleProfile,
} from '../config/rule-profile-service.js';
import {
  buildDecisionReportSummary,
  createReportSummaryPath,
  deriveReportArtifactPaths,
  writeDecisionReportSummary,
} from './decision-report-summary.js';

function toBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

export function mergeTemplateOverrides(template, sections, options) {
  const merged = { ...(template || {}) };

  if (sections && typeof sections === 'object') {
    const sectionMap = {
      model: 'model_summary',
      drawing: 'drawing',
      dfm: 'dfm',
      tolerance: 'tolerance',
      cost: 'cost',
      bom: 'bom',
    };
    merged.sections = { ...(merged.sections || {}) };
    const nextOrder = Object.keys(merged.sections).length + 1;

    for (const [rawKey, enabled] of Object.entries(sections)) {
      if (typeof enabled !== 'boolean') continue;
      const key = sectionMap[rawKey] || rawKey;
      const current = { ...(merged.sections[key] || {}) };
      current.enabled = enabled;
      if (current.order === undefined) current.order = nextOrder;
      merged.sections[key] = current;
    }
  }

  if (options && typeof options === 'object') {
    if (options.language) merged.language = options.language;
    if (typeof options.disclaimer === 'boolean') {
      merged.disclaimer = { ...(merged.disclaimer || {}), enabled: options.disclaimer };
    }
    if (typeof options.signature === 'boolean') {
      merged.signature = { ...(merged.signature || {}), enabled: options.signature };
    }
  }

  return merged;
}

function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\\u[dD][0-9a-fA-F]{4}/g, '')
    .replace(/[\uD800-\uDFFF]/g, '');
}

function safeFilenameComponent(value, defaultValue = 'report') {
  const text = String(value || '').trim().replaceAll('\\', '/').replaceAll('\0', '');
  const leaf = text.split('/').pop();
  if (!leaf || leaf === '.' || leaf === '..') return defaultValue;
  return leaf;
}

export function sanitizeObject(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeObject);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = sanitizeObject(child);
    return out;
  }
  return value;
}

export function normalizeFemResults(femResult = {}) {
  if (!femResult || typeof femResult !== 'object') return {};

  const results = femResult.results && typeof femResult.results === 'object'
    ? femResult.results
    : {};
  const material = femResult.material && typeof femResult.material === 'object'
    ? femResult.material
    : {};

  const normalized = {
    ...femResult,
    ...results,
  };

  if (normalized.yield_strength === undefined && material.yield_strength !== undefined) {
    normalized.yield_strength = material.yield_strength;
  }
  if (normalized.solver === undefined && femResult.analysis_type) {
    normalized.solver = 'CalculiX';
  }

  return normalized;
}

export function createReportService({
  readFileFn = readFile,
  loadShopProfileFn = loadShopProfile,
  loadRuleProfileFn = loadRuleProfile,
  runPythonJsonScriptFn = runPythonJsonScript,
  getFreeCADRuntimeFn = getFreeCADRuntime,
} = {}) {
  return async function generateReport({
    freecadRoot,
    runScript,
    loadConfig,
    configPath,
    config,
    outputDir = null,
    includeDrawing = true,
    includeDfm = true,
    includeTolerance = true,
    includeCost = true,
    analysisResults = null,
    templateName = null,
    metadata = null,
    sections = null,
    options = null,
    profileName = null,
  }) {
    const loadedConfig = config ?? await loadConfig(resolve(freecadRoot, configPath));
    const resolvedOutputDir = outputDir
      ? resolve(freecadRoot, outputDir)
      : resolve(freecadRoot, 'output');
    const normalizedResults = (analysisResults && typeof analysisResults === 'object')
      ? sanitizeObject(analysisResults)
      : {};

    const shopProfile = await loadShopProfileFn(freecadRoot, profileName);
    const ruleProfile = await loadRuleProfileFn(freecadRoot, loadedConfig, { silent: true });
    const ruleProfileSummary = summarizeRuleProfile(ruleProfile);
    const materialProfile = resolveMaterialProfile(
      ruleProfile,
      loadedConfig.manufacturing?.material || loadedConfig.material || ''
    );
    const resolvedStandard = options?.standard || loadedConfig.standard || ruleProfile?.standards?.default_standard || 'KS';

    let reportTemplate = null;
    if (templateName) {
      try {
        const templatePath = join(freecadRoot, 'configs', 'report-templates', `${templateName}.json`);
        const templateContent = await readFileFn(templatePath, 'utf8');
        const template = mergeTemplateOverrides(JSON.parse(templateContent), sections, options);
        reportTemplate = {
          template_path: templatePath,
          template,
          metadata: {
            ...(metadata || {}),
            profile_name: profileName || '',
            template_name: templateName,
            rule_profile: ruleProfileSummary,
          },
        };
      } catch {
        // Continue without template.
      }
    }

    const tolInput = normalizedResults.tolerance ? { ...normalizedResults.tolerance } : null;
    if (tolInput && !Array.isArray(tolInput.fits) && Array.isArray(tolInput.pairs)) {
      tolInput.fits = tolInput.pairs.map((pair) => ({
        bore: pair.bore_part || '',
        shaft: pair.shaft_part || '',
        spec: pair.spec || '',
        fit_type: pair.fit_type || '',
        min_clearance: pair.clearance_min,
        max_clearance: pair.clearance_max,
      }));
    }

    const femInput = normalizeFemResults(normalizedResults.fem);
    const reportStem = safeFilenameComponent(loadedConfig.name, 'report');
    const expectedPdfPath = join(resolvedOutputDir, `${reportStem}_report.pdf`);
    const reportArtifacts = deriveReportArtifactPaths({
      primaryOutputPath: expectedPdfPath,
      configName: loadedConfig.name,
    });
    const [createQuality, drawingQuality, createManifest, drawingManifest] = await Promise.all([
      readJsonIfExists(reportArtifacts.create_quality),
      readJsonIfExists(reportArtifacts.drawing_quality),
      readJsonIfExists(reportArtifacts.create_manifest),
      readJsonIfExists(reportArtifacts.drawing_manifest),
    ]);
    const repoContext = collectRepoContext(freecadRoot);
    const runtimeInfo = getFreeCADRuntimeFn();

    const preliminarySummary = buildDecisionReportSummary({
      configPath: resolve(freecadRoot, configPath || `${reportStem}.toml`),
      config: loadedConfig,
      reportPdfPath: expectedPdfPath,
      reportGeneratedAt: new Date().toISOString(),
      repoContext,
      runtimeInfo,
      artifactPaths: reportArtifacts,
      createQuality,
      drawingQuality,
      createManifest,
      drawingManifest,
      dfm: normalizedResults.dfm || null,
      fem: normalizedResults.fem ? femInput : null,
      tolerance: tolInput || null,
    });

    const reportInput = {
      ...loadedConfig,
      standard: (analysisResults && analysisResults.standard) || resolvedStandard,
      ...(shopProfile ? { shop_profile: shopProfile } : {}),
      ...(ruleProfile ? { rule_profile: ruleProfile } : {}),
      export: { ...loadedConfig.export, directory: resolvedOutputDir },
      _report_options: {
        include_drawing: toBool(sections?.drawing, includeDrawing),
        include_dfm: toBool(sections?.dfm, includeDfm),
        include_tolerance: toBool(sections?.tolerance, includeTolerance),
        include_cost: toBool(sections?.cost, includeCost),
      },
      _analysis_results: normalizedResults,
      model_result: normalizedResults.model || {},
      qa_result: toBool(sections?.drawing, includeDrawing) ? (normalizedResults.qa || {}) : {},
      dfm_results: toBool(sections?.dfm, includeDfm) ? (normalizedResults.dfm || {}) : {},
      tolerance_results: toBool(sections?.tolerance, includeTolerance) ? (tolInput || {}) : {},
      monte_carlo_results: toBool(sections?.tolerance, includeTolerance) ? (tolInput?.monte_carlo || null) : null,
      fem_results: femInput,
      cost_result: toBool(sections?.cost, includeCost) ? (normalizedResults.cost || {}) : {},
      bom: normalizedResults.drawing?.bom || loadedConfig.bom || [],
      material_profile: materialProfile,
      rule_profile_summary: ruleProfileSummary,
      _decision_summary: preliminarySummary,
      _report_artifacts: preliminarySummary.artifacts_referenced,
    };

    if (outputDir) {
      reportInput._report_output_dir = resolvedOutputDir;
    }

    if (reportTemplate) {
      reportInput._report_template = reportTemplate;
    }

    let result;
    try {
      result = await runScript('engineering_report.py', reportInput, { timeout: 180_000 });
    } catch (error) {
      const runtime = getFreeCADRuntimeFn();
      const canFallbackToBundledPython = runtime.mode === 'macos-bundle' && runtime.pythonExecutable;
      const looksLikeFreecadCmdBannerOnly = /No JSON found in stdout of engineering_report\.py/.test(error.message || '');

      if (!canFallbackToBundledPython || !looksLikeFreecadCmdBannerOnly) {
        throw error;
      }

      result = await runPythonJsonScriptFn(
        freecadRoot,
        'scripts/engineering_report.py',
        reportInput,
        {
          timeout: 180_000,
          pythonCommand: runtime.pythonExecutable,
        }
      );
    }

    const pdfRelPath = result.pdf_path || result.path;
    const resolvedPdfPath = pdfRelPath ? convertPathFromRuntime(pdfRelPath) : expectedPdfPath;
    const finalArtifactPaths = deriveReportArtifactPaths({
      primaryOutputPath: resolvedPdfPath,
      configName: loadedConfig.name,
    });
    const [finalCreateQuality, finalDrawingQuality, finalCreateManifest, finalDrawingManifest] = await Promise.all([
      readJsonIfExists(finalArtifactPaths.create_quality),
      readJsonIfExists(finalArtifactPaths.drawing_quality),
      readJsonIfExists(finalArtifactPaths.create_manifest),
      readJsonIfExists(finalArtifactPaths.drawing_manifest),
    ]);

    const reportSummary = buildDecisionReportSummary({
      configPath: resolve(freecadRoot, configPath || `${reportStem}.toml`),
      config: loadedConfig,
      reportPdfPath: resolvedPdfPath,
      reportGeneratedAt: new Date().toISOString(),
      repoContext,
      runtimeInfo,
      artifactPaths: finalArtifactPaths,
      createQuality: finalCreateQuality || createQuality,
      drawingQuality: finalDrawingQuality || drawingQuality,
      createManifest: finalCreateManifest || createManifest,
      drawingManifest: finalDrawingManifest || drawingManifest,
      dfm: normalizedResults.dfm || null,
      fem: normalizedResults.fem ? femInput : null,
      tolerance: tolInput || null,
    });
    const summaryPath = createReportSummaryPath({
      primaryOutputPath: resolvedPdfPath,
      configName: loadedConfig.name,
    });
    await writeDecisionReportSummary(summaryPath, reportSummary);
    result.summary_json = summaryPath;
    result.report_summary = reportSummary;
    result.decision_summary = reportSummary;

    if (pdfRelPath) {
      try {
        const pdfBuffer = await readFileFn(convertPathFromRuntime(pdfRelPath));
        result.pdfBase64 = pdfBuffer.toString('base64');
      } catch {
        // Optional PDF read-back.
      }
    }

    return result;
  };
}

export const generateReport = createReportService();
