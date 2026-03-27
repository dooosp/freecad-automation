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
    planPath: resolve(parsed.dir, `${stem}_plan.json`),
  };
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
    let drawConfig = config ? structuredClone(config) : await loadConfig(resolve(freecadRoot, configPath));
    drawConfig.standard = standard;

    if (preset) {
      const presetPath = resolve(freecadRoot, 'configs', 'overrides', 'presets', `${preset}.toml`);
      let presetConfig;
      try {
        presetConfig = await loadConfig(presetPath);
      } catch (err) {
        throw new Error(`Invalid preset '${preset}': ${err.message}`);
      }
      drawConfig = deepMerge(drawConfig, presetConfig);
    }

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

    const result = await runScript('generate_drawing.py', drawConfig, { timeout: 120_000 });
    const svgEntry = result.drawing_paths?.find((path) => path.format === 'svg');
    const svgPath = result.svg_path || result.drawing_path || svgEntry?.path;

    if (svgPath) {
      const localSvgPath = toLocalPathFn(svgPath);
      let contextPaths = {};
      try {
        contextPaths = buildDrawingContextPaths(localSvgPath);
        await writeFile(contextPaths.configPath, JSON.stringify(drawConfig, null, 2));
        if (drawConfig.drawing_plan) {
          await writeFile(
            contextPaths.planPath,
            JSON.stringify({ drawing_plan: drawConfig.drawing_plan }, null, 2)
          );
        } else {
          contextPaths.planPath = undefined;
        }
      } catch {
        contextPaths = {};
      }

      if (postprocess) {
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
        try {
          result.qa = await runQaScorerFn(freecadRoot, localSvgPath, {
            planPath: contextPaths.planPath,
            configPath: contextPaths.configPath,
            weightsPreset: weightsPreset || drawConfig.drawing_plan?.dimensioning?.qa_weight_preset,
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
