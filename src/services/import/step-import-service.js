import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';

const STEP_IMPORT_EXTENSIONS = new Set(['.step', '.stp']);
export const SUPPORTED_IMPORT_EXTENSIONS = new Set(['.step', '.stp', '.fcstd']);

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

function normalizeImportExtension(filePath = '') {
  return extname(String(filePath || '')).toLowerCase();
}

function isSupportedImportPath(filePath = '') {
  return SUPPORTED_IMPORT_EXTENSIONS.has(normalizeImportExtension(filePath));
}

function isStepLikeImport(filePath = '') {
  return STEP_IMPORT_EXTENSIONS.has(normalizeImportExtension(filePath));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueWarnings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

function listifyWarnings(...values) {
  const warnings = [];
  values.forEach((value) => {
    if (Array.isArray(value)) {
      warnings.push(...value);
    } else if (typeof value === 'string') {
      warnings.push(value);
    }
  });
  return uniqueWarnings(warnings);
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

function inferUnitAssumption({
  analysis = {},
  filePath = '',
} = {}) {
  const diagnostics = analysis.import_diagnostics || {};
  const hint = diagnostics.unit_assumption || analysis.unit_assumption || {};
  const unit = typeof hint.unit === 'string' && hint.unit.trim() ? hint.unit.trim() : 'mm';
  return {
    unit,
    source: hint.source || (isStepLikeImport(filePath) ? 'step-default' : 'runtime-default'),
    assumed: hint.assumed !== false,
    confidence: Number.isFinite(hint.confidence) ? hint.confidence : (isStepLikeImport(filePath) ? 0.72 : 0.45),
    rationale: hint.rationale || (isStepLikeImport(filePath)
      ? 'STEP import defaults to millimeter assumptions unless stronger unit evidence is available.'
      : 'FCStd bootstrap defaults to millimeter assumptions unless stronger unit evidence is available.'),
  };
}

function baseSuggestedConfig(modelFilePath, titleName = 'Imported Part') {
  const stem = basename(modelFilePath, extname(modelFilePath));
  return {
    name: `imported_${stem}`,
    import: { source_step: modelFilePath, template_only: true },
    export: { step: true, stl: true },
    drawing: { scale: 'auto', title: titleName },
    manufacturing: { process: 'machining' },
  };
}

function buildImportDiagnostics(raw = {}, modelFilePath, {
  fallback = false,
  format = null,
  stage = null,
} = {}) {
  const extension = normalizeImportExtension(modelFilePath);
  const features = raw?.features || {};
  const bbox = raw?.bounding_box || {};
  const warnings = listifyWarnings(raw?.warnings, raw?.warning);
  const conditions = {
    empty_import: raw?.import_diagnostics?.conditions?.empty_import === true
      || (toNumber(raw?.volume) <= 0 && toNumber(features?.face_count) <= 0 && toNumber(features?.edge_count) <= 0),
    partial_import: raw?.import_diagnostics?.conditions?.partial_import === true || fallback,
    unsupported_import: raw?.import_diagnostics?.conditions?.unsupported_import === true || !isSupportedImportPath(modelFilePath),
    unstable_import: raw?.import_diagnostics?.conditions?.unstable_import === true || false,
  };
  const bodyCount = Math.max(
    0,
    Math.trunc(toNumber(raw?.import_diagnostics?.body_count, raw?.body_count ?? raw?.solid_count ?? raw?.component_count))
  );
  const inferredKind = raw?.import_diagnostics?.import_kind
    || raw?.part_kind
    || raw?.part_type
    || (bodyCount > 1 ? 'assembly' : 'part');
  const unitAssumption = inferUnitAssumption({ analysis: raw, filePath: modelFilePath });
  const formatLabel = format || raw?.format || raw?.import_diagnostics?.format || extension.replace(/^\./, '') || 'unknown';
  const confidenceScore = Number.isFinite(raw?.confidence_map?.overall?.score)
    ? raw.confidence_map.overall.score
    : fallback
      ? 0.46
      : isStepLikeImport(modelFilePath)
        ? 0.78
        : 0.58;
  const confidenceLevel = raw?.confidence_map?.overall?.level
    || (confidenceScore >= 0.75 ? 'high' : confidenceScore >= 0.5 ? 'medium' : 'low');

  return {
    source_model: modelFilePath,
    format: formatLabel,
    stage: stage || (fallback ? 'inspect-fallback' : 'import-analysis'),
    supported: isSupportedImportPath(modelFilePath),
    import_kind: inferredKind,
    part_vs_assembly: {
      classification: inferredKind,
      body_count: bodyCount,
      source: raw?.import_diagnostics?.part_vs_assembly?.source || (fallback ? 'inspect-fallback' : 'feature-analysis'),
      confidence: Number.isFinite(raw?.import_diagnostics?.part_vs_assembly?.confidence)
        ? raw.import_diagnostics.part_vs_assembly.confidence
        : (bodyCount > 1 ? 0.66 : 0.61),
    },
    unit_assumption: unitAssumption,
    bounding_box: {
      x: toNumber(bbox.x),
      y: toNumber(bbox.y),
      z: toNumber(bbox.z),
    },
    body_count: bodyCount,
    conditions,
    fail_closed: conditions.unsupported_import || conditions.unstable_import || conditions.empty_import,
    fallback_used: fallback,
    warnings,
    confidence: {
      level: confidenceLevel,
      score: confidenceScore,
      rationale: raw?.confidence_map?.overall?.rationale || (fallback
        ? 'Bootstrap analysis used bounded inspect-model fallback signals.'
        : 'Bootstrap analysis used primary import feature extraction signals.'),
    },
  };
}

function buildConfidenceMap(raw = {}, diagnostics = {}) {
  const overall = diagnostics.confidence || {
    level: 'low',
    score: 0.4,
    rationale: 'Bootstrap confidence is limited.',
  };
  const partVsAssembly = diagnostics.part_vs_assembly || {};
  const unitAssumption = diagnostics.unit_assumption || {};
  return {
    overall,
    part_vs_assembly: {
      level: Number.isFinite(partVsAssembly.confidence) && partVsAssembly.confidence >= 0.75
        ? 'high'
        : Number.isFinite(partVsAssembly.confidence) && partVsAssembly.confidence >= 0.5
          ? 'medium'
          : 'low',
      score: Number.isFinite(partVsAssembly.confidence) ? partVsAssembly.confidence : 0.5,
      rationale: `Classified import as ${partVsAssembly.classification || 'part'} using detected body-count and geometry clues.`,
    },
    unit_assumption: {
      level: Number.isFinite(unitAssumption.confidence) && unitAssumption.confidence >= 0.75
        ? 'high'
        : Number.isFinite(unitAssumption.confidence) && unitAssumption.confidence >= 0.5
          ? 'medium'
          : 'low',
      score: Number.isFinite(unitAssumption.confidence) ? unitAssumption.confidence : 0.45,
      rationale: unitAssumption.rationale || 'Units are inferred from import-side assumptions.',
    },
    feature_extraction: raw?.confidence_map?.feature_extraction || {
      level: raw?.fallback ? 'low' : 'medium',
      score: raw?.fallback ? 0.42 : 0.7,
      rationale: raw?.fallback
        ? 'Feature extraction relied on inspect fallback rather than direct STEP feature detection.'
        : 'Feature extraction used direct STEP feature detection heuristics.',
    },
  };
}

function buildBootstrapSummary(raw = {}, diagnostics = {}, suggestedConfig = null) {
  const features = raw?.features || {};
  const warnings = diagnostics.warnings || [];
  return {
    source_model: diagnostics.source_model || raw?.source_step || null,
    import_kind: diagnostics.import_kind || raw?.part_type || 'part',
    bbox_mm: diagnostics.bounding_box || extractBBox(raw),
    body_count: diagnostics.body_count ?? 0,
    feature_counts: {
      cylinders: Array.isArray(features.cylinders) ? features.cylinders.length : toNumber(raw?.cylinders),
      bolt_circles: Array.isArray(features.bolt_circles) ? features.bolt_circles.length : toNumber(raw?.bolt_circles),
      fillets: Array.isArray(features.fillets) ? features.fillets.length : 0,
      chamfers: Array.isArray(features.chamfers) ? features.chamfers.length : 0,
      faces: toNumber(features.face_count),
      edges: toNumber(features.edge_count),
    },
    review_gate: {
      status: diagnostics.conditions?.unsupported_import || diagnostics.conditions?.empty_import ? 'blocked' : 'review_required',
      reason: diagnostics.conditions?.unsupported_import
        ? 'unsupported_import'
        : diagnostics.conditions?.empty_import
          ? 'empty_import'
          : warnings.length > 0
            ? 'warnings_present'
            : 'human_confirmation_required',
    },
    draft_config_ready: Boolean(suggestedConfig),
    warnings_count: warnings.length,
    confidence: diagnostics.confidence || null,
  };
}

function normalizeAnalysis(raw, modelFilePath, { fallback = false, format = null } = {}) {
  const features = isPlainObject(raw?.features) ? raw.features : {};
  const diagnostics = buildImportDiagnostics(raw, modelFilePath, { fallback, format });
  const confidenceMap = buildConfidenceMap(raw, diagnostics);
  const suggestedConfig = raw?.suggested_config || baseSuggestedConfig(modelFilePath);
  return {
    ...raw,
    success: raw?.success !== false,
    format: format || raw?.format || normalizeImportExtension(modelFilePath).replace(/^\./, '') || null,
    features,
    source_step: raw?.source_step || modelFilePath,
    source_model: raw?.source_model || modelFilePath,
    cylinders: Array.isArray(features.cylinders) ? features.cylinders.length : toNumber(raw?.cylinders),
    bolt_circles: Array.isArray(features.bolt_circles) ? features.bolt_circles.length : toNumber(raw?.bolt_circles),
    bootstrap_warnings: listifyWarnings(raw?.bootstrap_warnings, diagnostics.warnings),
    import_diagnostics: diagnostics,
    confidence_map: confidenceMap,
    bootstrap_summary: buildBootstrapSummary(raw, diagnostics, suggestedConfig),
    suggested_config: suggestedConfig,
  };
}

export async function analyzeStep(freecadRoot, runScript, modelFilePath) {
  const extension = normalizeImportExtension(modelFilePath);
  if (!SUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
    const supported = [...SUPPORTED_IMPORT_EXTENSIONS].join(', ');
    throw new Error(`Unsupported import file format "${extension || 'unknown'}". Supported formats: ${supported}.`);
  }

  if (!isStepLikeImport(modelFilePath)) {
    const inspected = await runScript('inspect_model.py', { file: modelFilePath }, { timeout: 60_000 });
    const model = inspected?.model || {};
    return normalizeAnalysis({
      success: true,
      fallback: true,
      source_step: modelFilePath,
      part_type: 'part',
      bounding_box: extractBBox(model),
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
      bootstrap_warnings: [
        'FCStd bootstrap uses inspect-model metadata rather than STEP-specific feature detection.',
        'Draft configuration remains a review template and may need manual cleanup before runtime-backed create or draw flows.',
      ],
      confidence_map: {
        feature_extraction: {
          level: 'low',
          score: 0.42,
          rationale: 'FCStd bootstrap fell back to inspect-model metadata and does not reconstruct parametric history.',
        },
      },
      suggested_config: baseSuggestedConfig(modelFilePath, basename(modelFilePath)),
    }, modelFilePath, { fallback: true, format: 'fcstd' });
  }

  try {
    const result = await runScript('step_feature_detector.py', { file: modelFilePath }, { timeout: 120_000 });
    return normalizeAnalysis(result, modelFilePath, { format: 'step' });
  } catch (primaryErr) {
    const inspected = await runScript('inspect_model.py', { file: modelFilePath }, { timeout: 60_000 });
    const model = inspected?.model || {};
    const bbox = extractBBox(model);
    return normalizeAnalysis({
      success: true,
      fallback: true,
      warning: `Feature detector failed; using inspect fallback: ${compactErrorMessage(primaryErr.message)}`,
      bootstrap_warnings: [
        `Feature detector failed; using inspect fallback: ${compactErrorMessage(primaryErr.message)}`,
      ],
      source_step: modelFilePath,
      part_type: 'part',
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
      confidence_map: {
        feature_extraction: {
          level: 'low',
          score: 0.4,
          rationale: 'STEP feature extraction failed, so bootstrap relied on inspect-model fallback signals only.',
        },
      },
      suggested_config: baseSuggestedConfig(modelFilePath, basename(modelFilePath)),
    }, modelFilePath, { fallback: true, format: 'step' });
  }
}

export function generateConfigFromAnalysis(analysis, userOverrides = {}) {
  const config = { ...analysis.suggested_config, ...userOverrides };
  const sourceStep = config.import?.source_step || analysis.source_step;
  const sourceExtension = normalizeImportExtension(sourceStep);
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
    if (sourceExtension === '.fcstd') {
      lines.push('# NOTE: The source model was imported from FCStd and this draft does not reconstruct parametric history.');
      lines.push('# Review the import path and export/replace with a canonical STEP when you need stronger downstream reproducibility.');
    }
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
    let modelFilePath;
    let stepName;

    if (uploadPath) {
      const safeOriginalName = basename(originalName || 'uploaded.step');
      if (!isSupportedImportPath(safeOriginalName)) {
        throw new Error(`Unsupported import file format: ${extname(safeOriginalName) || 'unknown'}`);
      }
      stepName = basename(safeOriginalName, extname(safeOriginalName));
      const importsDir = resolve(freecadRoot, 'output', 'imports');
      await mkdirFn(importsDir, { recursive: true });
      modelFilePath = resolve(importsDir, safeOriginalName);
      if (!isPathInside(importsDir, modelFilePath)) {
        throw new Error('Invalid import upload path');
      }
      const uploaded = await readFileFn(uploadPath);
      await writeFileFn(modelFilePath, uploaded);
    } else if (filePath) {
      const safeOriginalName = basename(filePath);
      if (!isSupportedImportPath(safeOriginalName)) {
        throw new Error(`Unsupported import file format: ${extname(safeOriginalName) || 'unknown'}`);
      }
      stepName = basename(safeOriginalName, extname(safeOriginalName));
      const importsDir = resolve(freecadRoot, 'output', 'imports');
      await mkdirFn(importsDir, { recursive: true });
      modelFilePath = resolve(importsDir, safeOriginalName);
      if (!isPathInside(importsDir, modelFilePath)) {
        throw new Error('Invalid import path');
      }
      const sourceBuffer = await readFileFn(resolve(filePath));
      await writeFileFn(modelFilePath, sourceBuffer);
    } else {
      throw new Error('No STEP file provided');
    }

    const analysis = await analyzeStepFn(freecadRoot, runScript, modelFilePath);
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
      stepFile: modelFilePath,
      modelFile: modelFilePath,
      importDiagnostics: analysis.import_diagnostics,
      bootstrapSummary: analysis.bootstrap_summary,
      bootstrapWarnings: analysis.bootstrap_warnings,
      confidenceMap: analysis.confidence_map,
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
