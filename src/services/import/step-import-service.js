import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';

function isPathInside(baseDir, targetPath) {
  const base = resolve(baseDir);
  const target = resolve(targetPath);
  return target === base || target.startsWith(`${base}${sep}`);
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function compactErrorMessage(message) {
  if (!message) return 'unknown error';
  const firstLine = String(message).split('\n')[0].trim();
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
}

function extractBBox(model = {}) {
  const bb = model.bounding_box || {};
  if (Array.isArray(bb.size) && bb.size.length >= 3) {
    return { x: toNumber(bb.size[0]), y: toNumber(bb.size[1]), z: toNumber(bb.size[2]) };
  }
  if (Array.isArray(bb.min) && Array.isArray(bb.max) && bb.min.length >= 3 && bb.max.length >= 3) {
    return {
      x: Math.abs(toNumber(bb.max[0]) - toNumber(bb.min[0])),
      y: Math.abs(toNumber(bb.max[1]) - toNumber(bb.min[1])),
      z: Math.abs(toNumber(bb.max[2]) - toNumber(bb.min[2])),
    };
  }
  return { x: toNumber(bb.x), y: toNumber(bb.y), z: toNumber(bb.z) };
}

function baseSuggestedConfig(stepFilePath, titleName = 'Imported Part') {
  const stem = basename(stepFilePath, extname(stepFilePath));
  return {
    name: `imported_${stem}`,
    import: { source_step: stepFilePath, template_only: true },
    export: { step: true, stl: true },
    drawing: { scale: 'auto', title: titleName },
    manufacturing: { process: 'machining' },
  };
}

function normalizeAnalysis(raw, stepFilePath) {
  const features = raw?.features || {};
  return {
    ...raw,
    success: raw?.success !== false,
    features,
    source_step: raw?.source_step || stepFilePath,
    cylinders: Array.isArray(features.cylinders) ? features.cylinders.length : toNumber(raw?.cylinders),
    bolt_circles: Array.isArray(features.bolt_circles) ? features.bolt_circles.length : toNumber(raw?.bolt_circles),
    suggested_config: raw?.suggested_config || baseSuggestedConfig(stepFilePath),
  };
}

export async function analyzeStep(freecadRoot, runScript, stepFilePath) {
  try {
    const result = await runScript('step_feature_detector.py', { file: stepFilePath }, { timeout: 120_000 });
    return normalizeAnalysis(result, stepFilePath);
  } catch (primaryErr) {
    const inspected = await runScript('inspect_model.py', { file: stepFilePath }, { timeout: 60_000 });
    const model = inspected?.model || {};
    const bbox = extractBBox(model);
    return normalizeAnalysis({
      success: true,
      fallback: true,
      warning: `Feature detector failed; using inspect fallback: ${compactErrorMessage(primaryErr.message)}`,
      source_step: stepFilePath,
      part_type: 'block',
      bounding_box: bbox,
      volume: toNumber(model.volume),
      area: toNumber(model.area),
      features: {
        cylinders: [],
        bolt_circles: [],
        central_bore: null,
        fillets: [],
        chamfers: [],
        face_count: toNumber(model.faces),
        edge_count: toNumber(model.edges),
      },
      suggested_config: baseSuggestedConfig(stepFilePath, basename(stepFilePath)),
    }, stepFilePath);
  }
}

export function generateConfigFromAnalysis(analysis, userOverrides = {}) {
  const config = { ...analysis.suggested_config, ...userOverrides };
  const sourceStep = config.import?.source_step || analysis.source_step;
  const lines = [];
  const safeName = (config.name || 'imported_part').replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  lines.push(`name = "${safeName}"`);
  lines.push('');

  if (sourceStep) {
    lines.push('[import]');
    const escapedStep = sourceStep.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    lines.push(`source_step = "${escapedStep}"`);
    lines.push(`template_only = ${config.import?.template_only === false ? 'false' : 'true'}`);
    lines.push('');
    lines.push('# NOTE: This imported config is a template.');
    lines.push('# Add [[shapes]] / [[operations]] or [[parts]] before running Analyze.');
    lines.push('');
  }

  if (config.export) {
    lines.push('[export]');
    if (config.export.step) lines.push('step = true');
    if (config.export.stl) lines.push('stl = true');
    lines.push('');
  }

  if (config.drawing) {
    lines.push('[drawing]');
    lines.push(`scale = "${config.drawing.scale || 'auto'}"`);
    lines.push(`title = "${config.drawing.title || config.name || 'Part'}"`);
    lines.push('');
  }

  if (config.manufacturing) {
    lines.push('[manufacturing]');
    lines.push(`process = "${config.manufacturing.process || 'machining'}"`);
    if (config.manufacturing.material) {
      lines.push(`material = "${config.manufacturing.material}"`);
    }
    lines.push('');
  }

  if (config.tolerance?.pairs?.length > 0) {
    lines.push('[tolerance]');
    for (const pair of config.tolerance.pairs) {
      lines.push('[[tolerance.pairs]]');
      lines.push(`bore = ${pair.bore}`);
      lines.push(`shaft = ${pair.shaft}`);
      lines.push(`spec = "${pair.spec || 'H7/g6'}"`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function createStepImportService({
  analyzeStepFn = analyzeStep,
  generateConfigFromAnalysisFn = generateConfigFromAnalysis,
  readFileFn = readFile,
  writeFileFn = writeFile,
  mkdirFn = mkdir,
} = {}) {
  return async function importStep({
    freecadRoot,
    runScript,
    filePath,
    uploadPath,
    originalName,
  }) {
    let stepFilePath;
    let stepName;

    if (uploadPath) {
      const safeOriginalName = basename(originalName || 'uploaded.step');
      stepName = basename(safeOriginalName, extname(safeOriginalName));
      const importsDir = resolve(freecadRoot, 'output', 'imports');
      await mkdirFn(importsDir, { recursive: true });
      stepFilePath = resolve(importsDir, safeOriginalName);
      if (!isPathInside(importsDir, stepFilePath)) {
        throw new Error('Invalid STEP upload path');
      }
      const uploaded = await readFileFn(uploadPath);
      await writeFileFn(stepFilePath, uploaded);
    } else if (filePath) {
      stepFilePath = resolve(filePath);
      if (!isPathInside(freecadRoot, stepFilePath)) {
        throw new Error('File path must be inside project root');
      }
      stepName = basename(stepFilePath, extname(stepFilePath));
    } else {
      throw new Error('No STEP file provided');
    }

    const analysis = await analyzeStepFn(freecadRoot, runScript, stepFilePath);
    const tomlString = generateConfigFromAnalysisFn(analysis);

    const configsDir = resolve(freecadRoot, 'configs', 'imports');
    await mkdirFn(configsDir, { recursive: true });
    const configPath = resolve(configsDir, `${stepName}.toml`);
    await writeFileFn(configPath, tomlString, 'utf-8');

    return {
      success: true,
      analysis,
      tomlString,
      configPath: `configs/imports/${stepName}.toml`,
      stepFile: stepFilePath,
    };
  };
}

export async function saveImportedConfig({
  freecadRoot,
  configPath,
  tomlString,
  writeFileFn = writeFile,
}) {
  const absPath = resolve(freecadRoot, configPath);
  if (!isPathInside(freecadRoot, absPath)) {
    throw new Error('Invalid config path');
  }
  await writeFileFn(absPath, tomlString, 'utf-8');
  return { success: true, configPath };
}

export const importStep = createStepImportService();
