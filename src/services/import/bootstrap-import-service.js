import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';

import { runPythonJsonScript, writeJsonFile } from '../../../lib/context-loader.js';
import {
  analyzeStep,
  generateConfigFromAnalysis,
  SUPPORTED_IMPORT_EXTENSIONS,
} from './step-import-service.js';

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

function decodeBase64(value = '') {
  try {
    return Buffer.from(String(value), 'base64');
  } catch {
    throw new Error('Uploaded file content must be valid base64.');
  }
}

async function writeUploadedFile(targetDir, file, { required = false, supportedExtensions = null } = {}) {
  if (!file) {
    if (required) throw new Error('A required uploaded file is missing.');
    return null;
  }

  if (typeof file.path === 'string' && file.path.trim()) {
    return {
      absolutePath: resolve(file.path),
      fileName: basename(file.path.trim()),
    };
  }

  const fileName = basename(safeString(file.name, 'uploaded.bin'));
  if (supportedExtensions && !supportedExtensions.has(extname(fileName).toLowerCase())) {
    throw new Error(`Unsupported uploaded file format: ${extname(fileName).toLowerCase() || 'unknown'}`);
  }
  const contentBase64 = safeString(file.content_base64);
  if (!contentBase64) {
    throw new Error(`Uploaded file ${fileName} is missing content_base64.`);
  }

  await mkdir(targetDir, { recursive: true });
  const absolutePath = resolve(targetDir, fileName);
  await writeFile(absolutePath, decodeBase64(contentBase64));
  return {
    absolutePath,
    fileName,
  };
}

function buildImportDiagnosticsDocument(analysis, { modelPath, generatedAt }) {
  const conditions = analysis.import_diagnostics?.conditions || {};
  return {
    artifact_type: 'import_diagnostics',
    generated_at: generatedAt,
    source_model_path: modelPath,
    file_type: extname(modelPath).replace(/^\./, '').toLowerCase() || null,
    import_kind: analysis.import_diagnostics?.import_kind || null,
    model_kind: analysis.model_kind || analysis.import_diagnostics?.model_kind || null,
    part_type: analysis.part_type || analysis.import_diagnostics?.part_type || null,
    assembly_detected: analysis.import_diagnostics?.assembly_detected ?? null,
    body_count: analysis.body_count ?? analysis.import_diagnostics?.body_count ?? null,
    part_count: analysis.part_count ?? analysis.import_diagnostics?.part_count ?? null,
    bounding_box: analysis.bounding_box || analysis.import_diagnostics?.bounding_box || null,
    unit_system: analysis.unit_system || analysis.import_diagnostics?.unit_system || null,
    unit_assumption: analysis.unit_assumption || analysis.import_diagnostics?.unit_assumption || null,
    empty_import: conditions.empty_import === true,
    partial_import: conditions.partial_import === true,
    unsupported_import: conditions.unsupported_import === true,
    unstable_import: conditions.unstable_import === true,
    fail_closed: analysis.import_diagnostics?.fail_closed === true,
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
  };
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
  const bbox = geometryIntelligence?.metrics?.bounding_box_mm || {};
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
      correction_required: Boolean(
        analysis.import_diagnostics?.partial_import
        || analysis.unit_assumption
        || analysis.fallback
      ),
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
    const sessionId = `bootstrap-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const sessionDir = resolve(projectRoot, 'output', 'imports', sessionId);
    const sourceDir = resolve(sessionDir, 'source');
    const artifactsDir = resolve(sessionDir, 'artifacts');

    const modelFile = await writeUploadedFile(sourceDir, model, {
      required: true,
      supportedExtensions: SUPPORTED_IMPORT_EXTENSIONS,
    });
    if (!extensionIsSupported(modelFile.fileName)) {
      throw new Error(`Unsupported import file format: ${extname(modelFile.fileName).toLowerCase() || 'unknown'}`);
    }
    if (!isPathInside(projectRoot, modelFile.absolutePath)) {
      throw new Error('Imported model path must be inside project root.');
    }

    const bomFile = await writeUploadedFile(sourceDir, bom);
    const inspectionFile = await writeUploadedFile(sourceDir, inspection);
    const qualityFile = await writeUploadedFile(sourceDir, quality);
    ensureProjectLocalPath(projectRoot, bomFile, 'BOM');
    ensureProjectLocalPath(projectRoot, inspectionFile, 'Inspection');
    ensureProjectLocalPath(projectRoot, qualityFile, 'Quality');
    const generatedAt = new Date().toISOString();

    const analysis = await analyzeModelFn(projectRoot, runScript, modelFile.absolutePath);
    if (analysis.import_diagnostics?.fail_closed) {
      throw new Error('Imported CAD failed bootstrap intake checks and must be corrected before review can start.');
    }

    const ingestResult = await runPythonJsonScriptFn(projectRoot, 'scripts/ingest_context.py', {
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

    const geometryResult = await runPythonJsonScriptFn(projectRoot, 'scripts/analyze_part.py', {
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

    await mkdir(artifactsDir, { recursive: true });
    const engineeringContextPath = await writeJsonFile(resolve(artifactsDir, 'engineering_context.json'), engineeringContext);
    const geometryIntelligencePath = await writeJsonFile(resolve(artifactsDir, 'geometry_intelligence.json'), geometryResult.geometry_intelligence);
    const importDiagnosticsPath = await writeJsonFile(resolve(artifactsDir, 'import_diagnostics.json'), importDiagnostics);
    const bootstrapWarningsPath = await writeJsonFile(resolve(artifactsDir, 'bootstrap_warnings.json'), bootstrapWarnings);
    const confidenceMapPath = await writeJsonFile(resolve(artifactsDir, 'confidence_map.json'), confidenceMap);
    const bootstrapSummaryPath = await writeJsonFile(resolve(artifactsDir, 'bootstrap_summary.json'), bootstrapSummary);
    const draftConfigPath = resolve(artifactsDir, 'draft_config.toml');
    await writeFile(draftConfigPath, draftConfigToml, 'utf8');

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
        model_path: normalizeRelativePath(projectRoot, modelFile.absolutePath),
        bom_path: bomFile ? normalizeRelativePath(projectRoot, bomFile.absolutePath) : null,
        inspection_path: inspectionFile ? normalizeRelativePath(projectRoot, inspectionFile.absolutePath) : null,
        quality_path: qualityFile ? normalizeRelativePath(projectRoot, qualityFile.absolutePath) : null,
      },
      bootstrap: {
        import_diagnostics: importDiagnostics,
        bootstrap_summary: bootstrapSummary,
        bootstrap_warnings: bootstrapWarnings,
        confidence_map: confidenceMap,
        geometry_intelligence: geometryResult.geometry_intelligence,
      },
      tracked_review_seed: {
        context_path: normalizeRelativePath(projectRoot, engineeringContextPath),
        model_path: normalizeRelativePath(projectRoot, modelFile.absolutePath),
        bom_path: bomFile ? normalizeRelativePath(projectRoot, bomFile.absolutePath) : null,
        inspection_path: inspectionFile ? normalizeRelativePath(projectRoot, inspectionFile.absolutePath) : null,
        quality_path: qualityFile ? normalizeRelativePath(projectRoot, qualityFile.absolutePath) : null,
      },
      artifacts: buildArtifactList(projectRoot, artifactMap),
    };
  };
}
