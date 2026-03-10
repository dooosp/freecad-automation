import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runQaScorer } from './qa-runner.js';
import { postprocessSvg } from './svg-postprocess.js';

async function toWSLPath(freecadRoot, path) {
  const { toWSL } = await import(`${freecadRoot}/lib/paths.js`);
  return toWSL(path);
}

export function createDrawingService({
  readFileFn = readFile,
  runQaScorerFn = runQaScorer,
  postprocessSvgFn = postprocessSvg,
  toWSLPathFn = toWSLPath,
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
      if (postprocess) {
        try {
          await postprocessSvgFn(freecadRoot, svgPath, {
            profile: drawConfig.drawing_plan?.style?.stroke_profile || 'ks',
          });
        } catch {
          // Optional post-processing.
        }
      }

      try {
        const svgWSLPath = await toWSLPathFn(freecadRoot, svgPath);
        result.svgContent = await readFileFn(svgWSLPath, 'utf8');
      } catch {
        // Optional SVG read-back.
      }

      if (qa) {
        try {
          result.qa = await runQaScorerFn(freecadRoot, svgPath, { weightsPreset });
        } catch {
          // Optional QA scoring.
        }
      }
    }

    return result;
  };
}

export const generateDrawing = createDrawingService();
