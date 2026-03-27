import { basename, extname, join, resolve } from 'node:path';
import { readFile, copyFile, mkdir } from 'node:fs/promises';
import { convertPathFromRuntime } from '../../lib/paths.js';
import { AnalysisCache } from './analysis-cache.js';
import { loadShopProfile } from '../services/config/profile-service.js';
import { generateDrawing } from '../services/drawing/drawing-service.js';
import { createDfmService } from '../services/analysis/dfm-service.js';
import { runTolerance } from '../services/analysis/tolerance-service.js';
import { createCostService } from '../services/cost/cost-service.js';

export function createAnalyzePipeline({
  readFileFn = readFile,
  copyFileFn = copyFile,
  mkdirFn = mkdir,
  AnalysisCacheClass = AnalysisCache,
  loadShopProfileFn = loadShopProfile,
  generateDrawingFn = generateDrawing,
  runDfmFn,
  runToleranceFn = runTolerance,
  runCostFn,
  toLocalPathFn = convertPathFromRuntime,
} = {}) {
  const executeDfm = runDfmFn || createDfmService({ loadShopProfileFn });
  const executeCost = runCostFn || createCostService({ loadShopProfileFn });

  return async function runAnalyzePipeline({
    freecadRoot,
    runScript,
    loadConfig,
    deepMerge,
    configPath,
    options = {},
    profileName = null,
    onEvent = () => {},
  }) {
    const fullPath = resolve(freecadRoot, configPath);
    const results = { stages: [], errors: [] };
    const cache = new AnalysisCacheClass(freecadRoot);

    const emit = (event, data) => onEvent(event, data);
    const config = await loadConfig(fullPath);
    config.standard = options.standard || 'KS';
    const hasShapes = Array.isArray(config.shapes) && config.shapes.length > 0;
    const hasAssemblyParts = Array.isArray(config.parts) && config.parts.length > 0;
    const hasAssembly = Boolean(config.assembly);
    const canCreateModel = hasShapes || hasAssemblyParts;
    const shopProfile = await loadShopProfileFn(freecadRoot, profileName);
    const isStepDirect = !canCreateModel && Boolean(config.import?.source_step);

    emit('stage', { stage: 'create', status: 'start' });
    try {
      if (isStepDirect) {
        const srcStep = config.import.source_step;
        const inspectResult = await runScript('inspect_model.py', { file: srcStep }, { timeout: 60_000 });
        const model = inspectResult?.model || inspectResult || {};
        const name = config.import?.name || basename(srcStep, extname(srcStep));
        const outputDir = join(freecadRoot, 'output');
        await mkdirFn(outputDir, { recursive: true });

        let resolvedSrc = srcStep;
        if (srcStep.includes('\\') || /^[A-Z]:/i.test(srcStep)) {
          resolvedSrc = toLocalPathFn(srcStep);
        }

        const destStep = join(outputDir, `${name}.step`);
        await copyFileFn(resolvedSrc, destStep).catch(() => {});

        results.model = {
          success: true,
          model: { ...model, name },
          exports: [{ format: 'step', path: `output/${name}.step` }],
          stepDirect: true,
        };
      } else if (!canCreateModel) {
        throw new Error('Config has no shapes/parts. Define geometry before Analyze.');
      } else {
        const createKey = cache.getCacheKey('create', config, options);
        const createCached = await cache.checkCache(createKey);
        if (createCached.hit) {
          results.model = createCached.entry.result;
        } else {
          const createResult = await runScript('create_model.py', config, { timeout: 120_000 });
          results.model = createResult;
          await cache.storeCache(createKey, createResult, 'create');
        }
      }

      results.stages.push('create');
      emit('stage', { stage: 'create', status: 'done', stepDirect: isStepDirect });
    } catch (err) {
      results.errors.push({ stage: 'create', error: err.message });
      emit('stage', { stage: 'create', status: 'error', error: err.message });
      return results;
    }

    if (options.drawing !== false) {
      emit('stage', { stage: 'drawing', status: 'start' });
      try {
        const drawKey = cache.getCacheKey('drawing', config, options);
        const drawCached = await cache.checkCache(drawKey);
        if (drawCached.hit) {
          const drawData = drawCached.entry.result;
          results.drawing = drawData.drawing || drawData;
          if (drawData.drawingSvg) results.drawingSvg = drawData.drawingSvg;
          if (drawData.qa) results.qa = drawData.qa;
        } else {
          const drawResult = await generateDrawingFn({
            freecadRoot,
            runScript,
            loadConfig,
            deepMerge,
            config,
            standard: options.standard || 'KS',
            dxfExport: options.dxfExport,
            weightsPreset: options.weightsPreset,
          });
          results.drawing = drawResult;
          if (drawResult.svgContent) results.drawingSvg = drawResult.svgContent;
          if (drawResult.qa) results.qa = drawResult.qa;

          const drawComposite = { drawing: drawResult };
          if (results.drawingSvg) drawComposite.drawingSvg = results.drawingSvg;
          if (results.qa) drawComposite.qa = results.qa;
          await cache.storeCache(drawKey, drawComposite, 'drawing');
        }

        results.stages.push('drawing');
        emit('stage', { stage: 'drawing', status: 'done', cached: drawCached.hit });
      } catch (err) {
        results.errors.push({ stage: 'drawing', error: err.message });
        emit('stage', { stage: 'drawing', status: 'error', error: err.message });
      }
    }

    if (options.dfm !== false) {
      emit('stage', { stage: 'dfm', status: 'start' });
      try {
        const dfmCacheOpts = { ...options, shopProfile: shopProfile || undefined };
        const dfmKey = cache.getCacheKey('dfm', config, dfmCacheOpts);
        const dfmCached = await cache.checkCache(dfmKey);
        if (dfmCached.hit) {
          results.dfm = dfmCached.entry.result;
        } else {
          const dfmResult = await executeDfm({
            freecadRoot,
            runScript,
            loadConfig,
            config,
            process: options.process || config.manufacturing?.process || 'machining',
            profileName,
            standard: options.standard || 'KS',
          });
          results.dfm = dfmResult;
          await cache.storeCache(dfmKey, dfmResult, 'dfm');
        }

        results.stages.push('dfm');
        emit('stage', { stage: 'dfm', status: 'done', cached: dfmCached.hit });
      } catch (err) {
        results.errors.push({ stage: 'dfm', error: err.message });
        emit('stage', { stage: 'dfm', status: 'error', error: err.message });
      }
    }

    if (options.tolerance !== false && hasAssembly && hasAssemblyParts) {
      emit('stage', { stage: 'tolerance', status: 'start' });
      try {
        const tolKey = cache.getCacheKey('tolerance', config, options);
        const tolCached = await cache.checkCache(tolKey);
        if (tolCached.hit) {
          results.tolerance = tolCached.entry.result;
        } else {
          const tolResult = await runToleranceFn({
            freecadRoot,
            runScript,
            loadConfig,
            config,
            standard: options.standard || 'KS',
            monteCarlo: options.monteCarlo,
            mcSamples: options.mcSamples,
          });
          results.tolerance = tolResult;
          await cache.storeCache(tolKey, tolResult, 'tolerance');
        }

        results.stages.push('tolerance');
        emit('stage', { stage: 'tolerance', status: 'done', cached: tolCached.hit });
      } catch (err) {
        results.errors.push({ stage: 'tolerance', error: err.message });
        emit('stage', { stage: 'tolerance', status: 'error', error: err.message });
      }
    }

    if (options.cost !== false) {
      emit('stage', { stage: 'cost', status: 'start' });
      try {
        const costCacheOpts = {
          ...options,
          shopProfile: shopProfile || undefined,
          dfm_score: results.dfm?.score ?? null,
        };
        const costKey = cache.getCacheKey('cost', config, costCacheOpts);
        const costCached = await cache.checkCache(costKey);
        if (costCached.hit) {
          results.cost = costCached.entry.result;
        } else {
          const costResult = await executeCost({
            freecadRoot,
            runScript,
            loadConfig,
            config,
            process: options.process || config.manufacturing?.process || 'machining',
            material: options.material || config.manufacturing?.material || 'SS304',
            batchSize: options.batch || 1,
            dfmResult: results.dfm || null,
            profileName,
            standard: options.standard || 'KS',
          });
          results.cost = costResult;
          await cache.storeCache(costKey, costResult, 'cost');
        }

        results.stages.push('cost');
        emit('stage', { stage: 'cost', status: 'done', cached: costCached.hit });
      } catch (err) {
        results.errors.push({ stage: 'cost', error: err.message });
        emit('stage', { stage: 'cost', status: 'error', error: err.message });
      }
    }

    return results;
  };
}

export const runAnalyzePipeline = createAnalyzePipeline();
