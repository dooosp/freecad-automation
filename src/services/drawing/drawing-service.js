import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parse, resolve } from 'node:path';
import { convertPathFromRuntime } from '../../../lib/paths.js';
import { runQaScorer } from './qa-runner.js';
import { postprocessSvg } from './svg-postprocess.js';

function buildDrawingContextPaths(svgPath) {
  const parsed = parse(svgPath);
  const stem = parsed.name.replace(/_drawing$/i, '') || parsed.name;
  return {
    configPath: resolve(parsed.dir, `${stem}_effective_config.json`),
    authoredConfigPath: resolve(parsed.dir, `${stem}_authored_config.json`),
    planPath: resolve(parsed.dir, `${stem}_plan.json`),
  };
}

async function directScriptInput(role, path) {
  const record = { role, path: resolve(path), sha256: null, size_bytes: null };
  try {
    // Bind the directly invoked script; imported Python modules are outside this receipt boundary.
    const bytes = await readFile(record.path);
    record.sha256 = createHash('sha256').update(bytes).digest('hex');
    record.size_bytes = bytes.length;
  } catch {
    // Keep missing script evidence visible without changing optional processing behavior.
  }
  return record;
}

export function createDrawingService({
  readFileFn = readFile,
  runQaScorerFn = runQaScorer,
  postprocessSvgFn = postprocessSvg,
  toLocalPathFn = convertPathFromRuntime,
} = {}) {
  return async function generateDrawing({
    freecadRoot,
    runScript,
    loadConfig,
    loadConfigSnapshot = null,
    sourceInputs = [],
    deepMerge,
    configPath,
    config,
    preset,
    weightsPreset,
    standard = 'KS',
    dxfExport = false,
    postprocess = true,
    qa = true,
  }) {
    const sources = structuredClone(sourceInputs);
    let authoredConfig;
    if (config) {
      authoredConfig = structuredClone(config);
    } else if (loadConfigSnapshot) {
      const document = await loadConfigSnapshot(resolve(freecadRoot, configPath));
      authoredConfig = structuredClone(document.config);
      if (document.input_record) sources.push({ role: 'config', ...structuredClone(document.input_record) });
    } else {
      authoredConfig = structuredClone(await loadConfig(resolve(freecadRoot, configPath)));
    }
    let runtimeStandard = standard;

    if (preset) {
      const presetPath = resolve(freecadRoot, 'configs', 'overrides', 'presets', `${preset}.toml`);
      let presetConfig;
      try {
        if (loadConfigSnapshot) {
          const document = await loadConfigSnapshot(presetPath);
          presetConfig = structuredClone(document.config);
          if (document.input_record) sources.push({ role: 'preset', ...structuredClone(document.input_record) });
        } else {
          presetConfig = structuredClone(await loadConfig(presetPath));
        }
      } catch (err) {
        throw new Error(`Invalid preset '${preset}': ${err.message}`);
      }
      authoredConfig = deepMerge(authoredConfig, presetConfig);
      // Preserve the previous order: service standard first, then a preset's own standard.
      if (Object.hasOwn(presetConfig, 'standard')) runtimeStandard = presetConfig.standard;
    }

    const drawConfig = structuredClone(authoredConfig);
    drawConfig.standard = runtimeStandard;
    if (!drawConfig.drawing) drawConfig.drawing = {};

    const hasShapes = Array.isArray(drawConfig.shapes) && drawConfig.shapes.length > 0;
    const hasParts = Array.isArray(drawConfig.parts) && drawConfig.parts.length > 0;
    if (!hasShapes && !hasParts && drawConfig.import?.source_step) {
      throw new Error(
        'Drawing generation is not available for STEP template-only configs. Add [[shapes]] or [[parts]] before generating drawing.'
      );
    }

    if (dxfExport) {
      drawConfig.drawing.dxf = true;
    }

    const runtimeInput = structuredClone(drawConfig);
    const selectedWeightsPreset = weightsPreset || runtimeInput.drawing_plan?.dimensioning?.qa_weight_preset || null;
    const result = await runScript('generate_drawing.py', drawConfig, { timeout: 120_000 });
    result.authored_config = authoredConfig;
    result.effective_config = runtimeInput;
    result.effective_input = {
      schema_version: '1.0',
      authored_config_kind: 'drawing.authored-config-json',
      runtime_config_kind: 'drawing.effective-config-json',
      sources,
      recipe: {
        kind: 'draw-service-v1',
        standard: runtimeInput.standard,
        dxf_export: Boolean(dxfExport),
        preset: preset || null,
        weights_preset: selectedWeightsPreset,
        postprocess: Boolean(postprocess),
        qa: Boolean(qa),
      },
    };
    const svgEntry = result.drawing_paths?.find((path) => path.format === 'svg');
    const svgPath = result.svg_path || result.drawing_path || svgEntry?.path;

    if (svgPath) {
      const localSvgPath = toLocalPathFn(svgPath);
      let contextPaths = {};
      try {
        contextPaths = buildDrawingContextPaths(localSvgPath);
        await writeFile(contextPaths.configPath, JSON.stringify(runtimeInput, null, 2));
        result.effective_config_path = contextPaths.configPath;
        await writeFile(contextPaths.authoredConfigPath, JSON.stringify(authoredConfig, null, 2));
        result.authored_config_path = contextPaths.authoredConfigPath;
        if (runtimeInput.drawing_plan) {
          await writeFile(
            contextPaths.planPath,
            JSON.stringify({ drawing_plan: runtimeInput.drawing_plan }, null, 2)
          );
        } else {
          contextPaths.planPath = undefined;
        }
      } catch {
        contextPaths = {};
      }

      if (postprocess) {
        sources.push(await directScriptInput('postprocess', resolve(freecadRoot, 'scripts/postprocess_svg.py')));
        try {
          await postprocessSvgFn(freecadRoot, localSvgPath, {
            profile: drawConfig.drawing_plan?.style?.stroke_profile || 'ks',
            planPath: contextPaths.planPath,
          });
        } catch {
          // Optional post-processing.
        }
      }

      try {
        result.svgContent = await readFileFn(localSvgPath, 'utf8');
      } catch {
        // Optional SVG read-back.
      }

      if (qa) {
        sources.push(await directScriptInput('qa-scorer', resolve(freecadRoot, 'scripts/qa_scorer.py')));
        try {
          result.qa = await runQaScorerFn(freecadRoot, localSvgPath, {
            planPath: contextPaths.planPath,
            configPath: contextPaths.configPath,
            weightsPreset: selectedWeightsPreset || undefined,
            ...(result.slot_relief_dfm ? { slotReliefDfm: result.slot_relief_dfm } : {}),
          });
        } catch {
          // Optional QA scoring.
        }
      }
    }

    return result;
  };
}

export const generateDrawing = createDrawingService();
