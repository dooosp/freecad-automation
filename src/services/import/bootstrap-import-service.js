import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';

import { runPythonJsonScript, writeJsonFile } from '../../../lib/context-loader.js';
import {
  analyzeStep,
  generateConfigFromAnalysis,
  SUPPORTED_IMPORT_EXTENSIONS,
} from './step-import-service.js';

export const MAX_BOOTSTRAP_UPLOAD_BYTES = 32 * 1024 * 1024;

const MAX_BOOTSTRAP_UPLOAD_BASE64_CHARACTERS = Math.ceil(MAX_BOOTSTRAP_UPLOAD_BYTES / 3) * 4;

function isPathInside(baseDir, targetPath) {
  const base = resolve(baseDir);
  const target = resolve(targetPath);
  return target === base || target.startsWith(`${base}${sep}`);
}

function normalizeRelativePath(projectRoot, filePath) {
  return relative(projectRoot, resolve(filePath)).split(sep).join('/');
}

function safeString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function toNullableNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function featureCollectionCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeFeatureHints(analysis = {}) {
  return analysis.features && typeof analysis.features === 'object' ? analysis.features : {};
}

function extensionIsSupported(fileName = '') {
  return SUPPORTED_IMPORT_EXTENSIONS.has(extname(fileName).toLowerCase());
}

function ensureProjectLocalPath(projectRoot, fileInfo, label) {
  if (!fileInfo?.absolutePath) return;
  if (!isPathInside(projectRoot, fileInfo.absolutePath)) {
    throw new Error(`${label} path must stay inside the project root.`);
  }
}

async function canonicalProjectRoot(projectRoot) {
  try {
    return await realpath(resolve(projectRoot));
  } catch {
    throw new Error('Project root is missing or unavailable.');
  }
}

async function canonicalProjectFile(projectRoot, filePath, label, {
  requestProjectRoot = projectRoot,
} = {}) {
  const requestedPath = resolve(requestProjectRoot, filePath);
  if (!isPathInside(requestProjectRoot, requestedPath)) {
    throw new Error(`${label} path must stay inside the project root.`);
  }
  let requestedEntry;
  try {
    requestedEntry = await lstat(requestedPath);
  } catch {
    throw new Error(`${label} path is missing or unavailable.`);
  }
  if (requestedEntry.isSymbolicLink()) {
    throw new Error(`${label} path must not use symbolic links.`);
  }

  let absolutePath;
  try {
    absolutePath = await realpath(requestedPath);
  } catch {
    throw new Error(`${label} path is missing or unavailable.`);
  }
  if (!isPathInside(projectRoot, absolutePath)) {
    throw new Error(`${label} path must stay inside the project root.`);
  }
  let fileStats;
  try {
    fileStats = await stat(absolutePath);
  } catch {
    throw new Error(`${label} path is missing or unavailable.`);
  }
  if (!fileStats.isFile()) {
    throw new Error(`${label} path must reference a regular file.`);
  }
  return absolutePath;
}

async function ensureProjectDirectory(projectRoot, directoryPath, label) {
  const targetPath = resolve(directoryPath);
  if (!isPathInside(projectRoot, targetPath)) {
    throw new Error(`${label} must stay inside the project root.`);
  }

  const segments = relative(projectRoot, targetPath).split(sep).filter(Boolean);
  let currentPath = projectRoot;
  for (const segment of segments) {
    const nextPath = resolve(currentPath, segment);
    let entry;
    try {
      entry = await lstat(nextPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new Error(`${label} is unavailable.`);
      }
      try {
        await mkdir(nextPath);
        entry = await lstat(nextPath);
      } catch {
        throw new Error(`${label} is unavailable.`);
      }
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`${label} must not use symbolic links.`);
    }
    if (!entry.isDirectory()) {
      throw new Error(`${label} must reference a directory.`);
    }
    try {
      currentPath = await realpath(nextPath);
    } catch {
      throw new Error(`${label} is unavailable.`);
    }
    if (!isPathInside(projectRoot, currentPath)) {
      throw new Error(`${label} must stay inside the project root.`);
    }
  }
  return currentPath;
}

function decodeBase64(value = '') {
  const encoded = String(value);
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('Uploaded file content must be valid base64.');
  }
  return Buffer.from(encoded, 'base64');
}

function uploadedFileTooLargeError() {
  const error = new Error('Unsupported uploaded file size: uploads must not exceed 32 MiB.');
  error.statusCode = 413;
  return error;
}

async function writeUploadedFile(targetDir, file, {
  projectRoot,
  requestProjectRoot = projectRoot,
  label = 'Uploaded file',
  required = false,
  supportedExtensions = null,
} = {}) {
  if (!file) {
    if (required) throw new Error('A required uploaded file is missing.');
    return null;
  }

  if (typeof file.path === 'string' && file.path.trim()) {
    const absolutePath = await canonicalProjectFile(projectRoot, file.path.trim(), label, {
      requestProjectRoot,
    });
    return {
      absolutePath,
      fileName: basename(absolutePath),
    };
  }

  const fileName = basename(safeString(file.name, 'uploaded.bin'));
  if (supportedExtensions && !supportedExtensions.has(extname(fileName).toLowerCase())) {
    throw new Error(`Unsupported uploaded file format: ${extname(fileName).toLowerCase() || 'unknown'}`);
  }
  const contentBase64 = typeof file.content_base64 === 'string' ? file.content_base64 : '';
  if (!contentBase64) {
    throw new Error(`Uploaded file ${fileName} is missing content_base64.`);
  }
  if (contentBase64.length > MAX_BOOTSTRAP_UPLOAD_BASE64_CHARACTERS) {
    throw uploadedFileTooLargeError();
  }

  const content = decodeBase64(contentBase64);
  if (content.length > MAX_BOOTSTRAP_UPLOAD_BYTES) {
    throw uploadedFileTooLargeError();
  }

  const canonicalTargetDir = await ensureProjectDirectory(projectRoot, targetDir, 'Bootstrap source directory');
  const writtenPath = resolve(canonicalTargetDir, fileName);
  try {
    await writeFile(writtenPath, content, { flag: 'wx' });
  } catch {
    throw new Error('Bootstrap storage failed.');
  }
  const absolutePath = await canonicalProjectFile(projectRoot, writtenPath, label);
  return {
    absolutePath,
    fileName,
  };
}

function buildImportDiagnosticsDocument(analysis, { modelPath, generatedAt }) {
  const diagnostics = safeObject(analysis.import_diagnostics);
  const conditions = safeObject(diagnostics.conditions);
  return {
    artifact_type: 'import_diagnostics',
    generated_at: generatedAt,
    source_model_path: modelPath,
    file_type: extname(modelPath).replace(/^\./, '').toLowerCase() || null,
    import_kind: diagnostics.import_kind || null,
    model_kind: analysis.model_kind || diagnostics.model_kind || null,
    part_type: analysis.part_type || diagnostics.part_type || null,
    assembly_detected: diagnostics.assembly_detected ?? null,
    body_count: analysis.body_count ?? diagnostics.body_count ?? null,
    part_count: analysis.part_count ?? diagnostics.part_count ?? null,
    bounding_box: analysis.bounding_box || diagnostics.bounding_box || null,
    unit_system: analysis.unit_system || diagnostics.unit_system || null,
    unit_assumption: analysis.unit_assumption || diagnostics.unit_assumption || null,
    empty_import: conditions.empty_import === true,
    partial_import: conditions.partial_import === true,
    unsupported_import: conditions.unsupported_import === true,
    unstable_import: conditions.unstable_import === true,
    fail_closed: diagnostics.fail_closed === true,
    warnings: uniqueStrings(analysis.bootstrap_warnings || []),
  };
}

function enrichEngineeringContext(context, analysis, {
  modelPath,
  bomPath,
  inspectionPath,
  qualityPath,
  generatedAt,
}) {
  const warnings = uniqueStrings([
    ...(context?.metadata?.warnings || []),
    ...(analysis.bootstrap_warnings || []),
  ]);
  return {
    ...context,
    geometry_source: {
      ...(context?.geometry_source || {}),
      path: modelPath,
      file_type: extname(modelPath).replace(/^\./, '').toLowerCase() || null,
      validated: analysis.import_diagnostics?.fail_closed !== true,
      model_metadata: analysis.model_metadata || context?.geometry_source?.model_metadata || null,
      feature_hints: normalizeFeatureHints(analysis),
      import_diagnostics: analysis.import_diagnostics || null,
      import_warnings: analysis.bootstrap_warnings || [],
      analysis_mode: analysis.fallback ? 'metadata_only_fallback' : 'runtime_backed',
      model_kind: analysis.model_kind || analysis.import_diagnostics?.model_kind || null,
      unit_system: analysis.unit_system || analysis.import_diagnostics?.unit_system || null,
      body_count: analysis.body_count ?? analysis.import_diagnostics?.body_count ?? null,
      part_count: analysis.part_count ?? analysis.import_diagnostics?.part_count ?? null,
    },
    metadata: {
      ...(context?.metadata || {}),
      created_at: context?.metadata?.created_at || generatedAt,
      source_files: [modelPath, bomPath, inspectionPath, qualityPath].filter(Boolean),
      warnings,
    },
  };
}

function buildBootstrapWarningsDocument(warnings, generatedAt) {
  return {
    artifact_type: 'bootstrap_warnings',
    generated_at: generatedAt,
    warning_count: warnings.length,
    warnings,
  };
}

function buildConfidenceMapDocument({
  analysis,
  geometryIntelligence,
  manufacturingHotspots,
  generatedAt,
}) {
  return {
    artifact_type: 'confidence_map',
    generated_at: generatedAt,
    import_bootstrap: analysis.confidence_map || null,
    geometry_intelligence: geometryIntelligence?.confidence || null,
    manufacturing_hotspots: manufacturingHotspots?.confidence || null,
    review_pack: null,
  };
}

function shouldRequireBootstrapCorrection(analysis = {}) {
  const diagnostics = safeObject(analysis.import_diagnostics);
  const conditions = safeObject(diagnostics.conditions);
  const unitAssumption = safeObject(diagnostics.unit_assumption);
  return Boolean(
    conditions.partial_import === true
    || unitAssumption.assumed !== false
    || analysis.fallback === true
    || diagnostics.fallback_used === true
  );
}

function buildBootstrapSummaryDocument({
  context,
  analysis,
  geometryIntelligence,
  manufacturingHotspots,
  generatedAt,
  warningCount,
  diagnosticsCount,
}) {
  const diagnostics = safeObject(analysis.import_diagnostics);
  const geometryBBox = safeObject(geometryIntelligence?.metrics?.bounding_box_mm);
  const analysisBBox = safeObject(analysis.bounding_box);
  const diagnosticsBBox = safeObject(diagnostics.bounding_box);
  const bbox = analysis.fallback === true || diagnostics.fallback_used === true
    ? (Object.keys(analysisBBox).length > 0
        ? analysisBBox
        : Object.keys(diagnosticsBBox).length > 0
          ? diagnosticsBBox
          : geometryBBox)
    : geometryBBox;
  const features = normalizeFeatureHints(analysis);
  return {
    artifact_type: 'bootstrap_summary',
    generated_at: generatedAt,
    part: context?.part || {},
    source: {
      model_path: context?.geometry_source?.path || null,
      file_type: context?.geometry_source?.file_type || null,
      analysis_mode: context?.geometry_source?.analysis_mode || null,
      model_kind: context?.geometry_source?.model_kind || null,
    },
    dimensions_mm: {
      x: toNullableNumber(bbox.x),
      y: toNullableNumber(bbox.y),
      z: toNullableNumber(bbox.z),
    },
    feature_summary: {
      cylinder_count: featureCollectionCount(features.cylinders),
      bolt_circle_count: featureCollectionCount(features.bolt_circles),
      fillet_count: featureCollectionCount(features.fillets),
      chamfer_count: featureCollectionCount(features.chamfers),
      derived_feature_count: featureCollectionCount(geometryIntelligence?.derived_features),
      hotspot_count: featureCollectionCount(manufacturingHotspots?.hotspots),
    },
    warning_count: warningCount,
    diagnostics_count: diagnosticsCount,
    review_gate: {
      ready_for_review_context: true,
      correction_required: shouldRequireBootstrapCorrection(analysis),
      optional_context_inputs: ['bom', 'inspection', 'quality'],
    },
  };
}

function buildArtifactList(projectRoot, artifactMap = {}) {
  return Object.entries(artifactMap)
    .filter(([, filePath]) => typeof filePath === 'string' && filePath.trim())
    .map(([key, filePath]) => ({
      key,
      path: normalizeRelativePath(projectRoot, filePath),
      file_name: basename(filePath),
    }));
}

function attachBootstrapStateToContext(context, {
  projectRoot,
  importDiagnostics,
  bootstrapSummary,
  confidenceMap,
  bootstrapWarnings,
  draftConfigPath,
} = {}) {
  const normalizedDraftConfigPath = draftConfigPath
    ? normalizeRelativePath(projectRoot, draftConfigPath)
    : null;

  return {
    ...context,
    geometry_source: {
      ...(context?.geometry_source || {}),
      import_diagnostics: importDiagnostics || context?.geometry_source?.import_diagnostics || {},
      bootstrap_summary: bootstrapSummary || context?.geometry_source?.bootstrap_summary || {},
      confidence_map: confidenceMap || context?.geometry_source?.confidence_map || {},
      bootstrap_warnings: safeList(bootstrapWarnings).length > 0
        ? bootstrapWarnings
        : (context?.geometry_source?.bootstrap_warnings || []),
      bootstrap: {
        ...safeObject(context?.geometry_source?.bootstrap),
        ...(normalizedDraftConfigPath ? { draft_config_path: normalizedDraftConfigPath } : {}),
      },
    },
    bootstrap: {
      import_diagnostics: importDiagnostics || context?.bootstrap?.import_diagnostics || {},
      bootstrap_summary: bootstrapSummary || context?.bootstrap?.bootstrap_summary || {},
      confidence_map: confidenceMap || context?.bootstrap?.confidence_map || {},
      warnings: safeList(bootstrapWarnings).length > 0
        ? bootstrapWarnings
        : (context?.bootstrap?.warnings || []),
      draft_config_path: normalizedDraftConfigPath,
    },
  };
}

export function createBootstrapImportService({
  analyzeModelFn = analyzeStep,
  runPythonJsonScriptFn = runPythonJsonScript,
} = {}) {
  return async function buildBootstrapImport({
    projectRoot,
    runScript,
    model,
    bom = null,
    inspection = null,
    quality = null,
    metadata = {},
  }) {
    const requestProjectRoot = resolve(projectRoot);
    const realProjectRoot = await canonicalProjectRoot(projectRoot);
    const sessionId = `bootstrap-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const sessionDir = resolve(realProjectRoot, 'output', 'imports', sessionId);
    const sourceDir = resolve(sessionDir, 'source');
    const artifactsDir = resolve(sessionDir, 'artifacts');
    await ensureProjectDirectory(realProjectRoot, resolve(realProjectRoot, 'output', 'imports'), 'Bootstrap import directory');

    const modelFile = await writeUploadedFile(sourceDir, model, {
      projectRoot: realProjectRoot,
      requestProjectRoot,
      label: 'Imported model',
      required: true,
      supportedExtensions: SUPPORTED_IMPORT_EXTENSIONS,
    });
    if (!extensionIsSupported(modelFile.fileName)) {
      throw new Error(`Unsupported import file format: ${extname(modelFile.fileName).toLowerCase() || 'unknown'}`);
    }
    if (!isPathInside(realProjectRoot, modelFile.absolutePath)) {
      throw new Error('Imported model path must be inside project root.');
    }

    const bomFile = await writeUploadedFile(sourceDir, bom, {
      projectRoot: realProjectRoot,
      requestProjectRoot,
      label: 'BOM',
    });
    const inspectionFile = await writeUploadedFile(sourceDir, inspection, {
      projectRoot: realProjectRoot,
      requestProjectRoot,
      label: 'Inspection',
    });
    const qualityFile = await writeUploadedFile(sourceDir, quality, {
      projectRoot: realProjectRoot,
      requestProjectRoot,
      label: 'Quality',
    });
    ensureProjectLocalPath(realProjectRoot, bomFile, 'BOM');
    ensureProjectLocalPath(realProjectRoot, inspectionFile, 'Inspection');
    ensureProjectLocalPath(realProjectRoot, qualityFile, 'Quality');
    const generatedAt = new Date().toISOString();

    const analysis = await analyzeModelFn(realProjectRoot, runScript, modelFile.absolutePath);
    if (analysis.import_diagnostics?.fail_closed) {
      throw new Error('Imported CAD failed bootstrap intake checks and must be corrected before review can start.');
    }

    const ingestResult = await runPythonJsonScriptFn(realProjectRoot, 'scripts/ingest_context.py', {
      model: modelFile.absolutePath,
      bom: bomFile?.absolutePath || null,
      inspection: inspectionFile?.absolutePath || null,
      quality: qualityFile?.absolutePath || null,
      part_name: metadata.part_name || null,
      part_id: metadata.part_id || null,
      revision: metadata.revision || null,
      material: metadata.material || null,
      process: metadata.process || null,
      facility: metadata.facility || null,
      supplier: metadata.supplier || null,
      manufacturing_notes: metadata.manufacturing_notes || null,
      model_metadata: analysis.model_metadata || null,
      feature_hints: normalizeFeatureHints(analysis),
    });

    const engineeringContext = enrichEngineeringContext(ingestResult.context, analysis, {
      modelPath: modelFile.absolutePath,
      bomPath: bomFile?.absolutePath || null,
      inspectionPath: inspectionFile?.absolutePath || null,
      qualityPath: qualityFile?.absolutePath || null,
      generatedAt,
    });

    const geometryResult = await runPythonJsonScriptFn(realProjectRoot, 'scripts/analyze_part.py', {
      context: engineeringContext,
      model_metadata: analysis.model_metadata || engineeringContext.geometry_source?.model_metadata || null,
      feature_hints: normalizeFeatureHints(analysis),
      geometry_source: engineeringContext.geometry_source,
      part: engineeringContext.part,
      warnings: analysis.bootstrap_warnings || [],
      runtime_diagnostics: [],
      allow_metadata_only_fallback: true,
      used_metadata_only_fallback: analysis.fallback === true,
    });

    const importDiagnostics = buildImportDiagnosticsDocument(analysis, {
      modelPath: modelFile.absolutePath,
      generatedAt,
    });
    const bootstrapWarnings = buildBootstrapWarningsDocument(
      uniqueStrings([
        ...safeList(engineeringContext.metadata?.warnings),
        ...(analysis.bootstrap_warnings || []),
        ...(geometryResult.geometry_intelligence?.warnings || []),
      ]),
      generatedAt
    );
    const confidenceMap = buildConfidenceMapDocument({
      analysis,
      geometryIntelligence: geometryResult.geometry_intelligence,
      manufacturingHotspots: geometryResult.manufacturing_hotspots,
      generatedAt,
    });
    const bootstrapSummary = buildBootstrapSummaryDocument({
      context: engineeringContext,
      analysis,
      geometryIntelligence: geometryResult.geometry_intelligence,
      manufacturingHotspots: geometryResult.manufacturing_hotspots,
      generatedAt,
      warningCount: bootstrapWarnings.warning_count,
      diagnosticsCount: 1,
    });
    const draftConfigToml = `${generateConfigFromAnalysis(analysis).trimEnd()}\n`;

    const canonicalArtifactsDir = await ensureProjectDirectory(realProjectRoot, artifactsDir, 'Bootstrap artifacts directory');
    const draftConfigPath = resolve(canonicalArtifactsDir, 'draft_config.toml');
    await writeFile(draftConfigPath, draftConfigToml, 'utf8');
    const finalizedEngineeringContext = attachBootstrapStateToContext(engineeringContext, {
      projectRoot: realProjectRoot,
      importDiagnostics: analysis.import_diagnostics || {},
      bootstrapSummary,
      confidenceMap,
      bootstrapWarnings: bootstrapWarnings.warnings,
      draftConfigPath,
    });
    const engineeringContextPath = await writeJsonFile(resolve(canonicalArtifactsDir, 'engineering_context.json'), finalizedEngineeringContext);
    const geometryIntelligencePath = await writeJsonFile(resolve(canonicalArtifactsDir, 'geometry_intelligence.json'), geometryResult.geometry_intelligence);
    const importDiagnosticsPath = await writeJsonFile(resolve(canonicalArtifactsDir, 'import_diagnostics.json'), importDiagnostics);
    const bootstrapWarningsPath = await writeJsonFile(resolve(canonicalArtifactsDir, 'bootstrap_warnings.json'), bootstrapWarnings);
    const confidenceMapPath = await writeJsonFile(resolve(canonicalArtifactsDir, 'confidence_map.json'), confidenceMap);
    const bootstrapSummaryPath = await writeJsonFile(resolve(canonicalArtifactsDir, 'bootstrap_summary.json'), bootstrapSummary);

    const artifactMap = {
      import_diagnostics: importDiagnosticsPath,
      bootstrap_summary: bootstrapSummaryPath,
      draft_config: draftConfigPath,
      engineering_context: engineeringContextPath,
      geometry_intelligence: geometryIntelligencePath,
      bootstrap_warnings: bootstrapWarningsPath,
      confidence_map: confidenceMapPath,
    };

    return {
      ok: true,
      session_id: sessionId,
      source: {
        model_path: normalizeRelativePath(realProjectRoot, modelFile.absolutePath),
        bom_path: bomFile ? normalizeRelativePath(realProjectRoot, bomFile.absolutePath) : null,
        inspection_path: inspectionFile ? normalizeRelativePath(realProjectRoot, inspectionFile.absolutePath) : null,
        quality_path: qualityFile ? normalizeRelativePath(realProjectRoot, qualityFile.absolutePath) : null,
      },
      bootstrap: {
        import_diagnostics: importDiagnostics,
        bootstrap_summary: bootstrapSummary,
        bootstrap_warnings: bootstrapWarnings,
        confidence_map: confidenceMap,
        draft_config_toml: draftConfigToml,
        geometry_intelligence: geometryResult.geometry_intelligence,
      },
      tracked_review_seed: {
        context_path: normalizeRelativePath(realProjectRoot, engineeringContextPath),
        model_path: normalizeRelativePath(realProjectRoot, modelFile.absolutePath),
        bom_path: bomFile ? normalizeRelativePath(realProjectRoot, bomFile.absolutePath) : null,
        inspection_path: inspectionFile ? normalizeRelativePath(realProjectRoot, inspectionFile.absolutePath) : null,
        quality_path: qualityFile ? normalizeRelativePath(realProjectRoot, qualityFile.absolutePath) : null,
      },
      artifacts: buildArtifactList(realProjectRoot, artifactMap),
    };
  };
}
