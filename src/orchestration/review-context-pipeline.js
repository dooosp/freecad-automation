import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';

import {
  artifactPathFor,
  deriveArtifactStem,
  readJsonFile,
  writeJsonFile,
} from '../../lib/context-loader.js';
import { resolveModelAnalysisInputs } from '../../lib/model-analysis.js';
import { generateConfigFromAnalysis } from '../api/model.js';

function normalizeJsonOutputPath(pathValue) {
  if (!pathValue) return null;
  const absPath = resolve(pathValue);
  return absPath.toLowerCase().endsWith('.json') ? absPath : `${absPath}.json`;
}

function siblingArtifactPath(primaryJsonPath, suffix) {
  const stem = deriveArtifactStem(primaryJsonPath, 'review_context');
  return artifactPathFor(dirname(primaryJsonPath), stem, suffix);
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

const PACKAGE_EVIDENCE_SPECS = Object.freeze([
  Object.freeze({
    key: 'createQualityPath',
    artifactType: 'create_quality_report',
    evidenceType: 'create_quality_report',
    label: 'Create quality report',
    classifications: ['quality_evidence'],
  }),
  Object.freeze({
    key: 'drawingQualityPath',
    artifactType: 'drawing_quality_report',
    evidenceType: 'drawing_quality_report',
    label: 'Drawing quality report',
    classifications: ['quality_evidence', 'drawing_evidence'],
  }),
  Object.freeze({
    key: 'drawingQaPath',
    artifactType: 'drawing_qa_report',
    evidenceType: 'drawing_qa_report',
    label: 'Drawing QA report',
    classifications: ['quality_evidence', 'drawing_evidence'],
  }),
  Object.freeze({
    key: 'drawingIntentPath',
    artifactType: 'drawing_intent',
    evidenceType: 'drawing_intent',
    label: 'Drawing intent',
    classifications: ['design_traceability_evidence', 'advisory_context'],
  }),
  Object.freeze({
    key: 'featureCatalogPath',
    artifactType: 'feature_catalog',
    evidenceType: 'feature_catalog',
    label: 'Feature catalog',
    classifications: ['design_traceability_evidence', 'advisory_context'],
  }),
  Object.freeze({
    key: 'dfmReportPath',
    artifactType: 'dfm_report',
    evidenceType: 'dfm_report',
    label: 'DFM report',
    classifications: ['quality_evidence'],
  }),
]);

function portableRepoPath(projectRoot, inputPath) {
  const resolvedRoot = resolve(projectRoot);
  const resolvedPath = resolve(inputPath);
  const relPath = relative(resolvedRoot, resolvedPath).replace(/\\/g, '/');
  if (!relPath || relPath.startsWith('..') || relPath.startsWith('/')) {
    return {
      ok: false,
      sourceRef: basename(resolvedPath),
      warning: `Package evidence input ${basename(resolvedPath)} is outside the repository and was not linked as canonical evidence.`,
    };
  }
  if (relPath === 'output' || relPath.startsWith('output/')) {
    return {
      ok: false,
      sourceRef: relPath,
      warning: 'Package evidence input under ignored output/ was not linked as canonical evidence.',
    };
  }
  if (relPath === 'tmp/codex' || relPath.startsWith('tmp/codex/')) {
    return {
      ok: false,
      sourceRef: relPath,
      warning: 'Package evidence input under the task-status scratch area was not linked as canonical evidence.',
    };
  }
  return {
    ok: true,
    sourceRef: relPath,
    warning: null,
  };
}

async function buildPackageEvidenceRecords(projectRoot, sideInputPaths = {}) {
  const records = [];
  const warnings = [];

  for (const spec of PACKAGE_EVIDENCE_SPECS) {
    const inputPath = sideInputPaths[spec.key];
    if (!inputPath) continue;

    const portable = portableRepoPath(projectRoot, inputPath);
    if (!portable.ok) {
      warnings.push(portable.warning);
      continue;
    }

    const fileBuffer = await readFile(inputPath);
    const fileStat = await stat(inputPath);
    records.push({
      evidence_id: `package:${spec.evidenceType}:${portable.sourceRef}`,
      type: spec.evidenceType,
      artifact_type: spec.artifactType,
      category: spec.classifications[0],
      classifications: spec.classifications,
      source_ref: portable.sourceRef,
      file_name: basename(portable.sourceRef),
      size_bytes: fileStat.size,
      sha256: createHash('sha256').update(fileBuffer).digest('hex'),
      label: spec.label,
      inspection_evidence: false,
      rationale: `${spec.label} supplied as explicit review-context package side input.`,
    });
  }

  if (records.length > 0) {
    warnings.push('Package quality/drawing side inputs are review evidence, but they do not satisfy inspection_evidence without a genuine inspection input.');
  }

  return { records, warnings: uniqueWarnings(warnings) };
}

function normalizeBootstrapConfidenceMap(value) {
  const confidenceMap = safeObject(value);
  if (Object.keys(confidenceMap).length === 0) {
    return {};
  }

  if (
    Object.hasOwn(confidenceMap, 'import_bootstrap')
    || Object.hasOwn(confidenceMap, 'geometry_intelligence')
    || Object.hasOwn(confidenceMap, 'manufacturing_hotspots')
    || Object.hasOwn(confidenceMap, 'review_pack')
  ) {
    return {
      artifact_type: confidenceMap.artifact_type || 'confidence_map',
      generated_at: confidenceMap.generated_at || null,
      import_bootstrap: safeObject(confidenceMap.import_bootstrap),
      geometry_intelligence: confidenceMap.geometry_intelligence || null,
      manufacturing_hotspots: confidenceMap.manufacturing_hotspots || null,
      review_pack: confidenceMap.review_pack || null,
    };
  }

  return {
    artifact_type: 'confidence_map',
    generated_at: null,
    import_bootstrap: (
      Object.hasOwn(confidenceMap, 'overall')
      || Object.hasOwn(confidenceMap, 'part_vs_assembly')
      || Object.hasOwn(confidenceMap, 'unit_assumption')
      || Object.hasOwn(confidenceMap, 'feature_extraction')
    )
      ? confidenceMap
      : { overall: confidenceMap },
    geometry_intelligence: null,
    manufacturing_hotspots: null,
    review_pack: null,
  };
}

function normalizeBootstrapDiagnostics(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
  }
  const objectValue = safeObject(value);
  return Object.keys(objectValue).length > 0 ? [objectValue] : [];
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

function featureCollectionCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function shouldRequireBootstrapCorrection({ importDiagnostics = {}, usedMetadataOnlyFallback = false } = {}) {
  const diagnostics = safeObject(importDiagnostics);
  const conditions = safeObject(diagnostics.conditions);
  const unitAssumption = safeObject(diagnostics.unit_assumption);
  return Boolean(
    diagnostics.partial_import === true
    || conditions.partial_import === true
    || unitAssumption.assumed !== false
    || usedMetadataOnlyFallback
    || diagnostics.fallback_used === true
  );
}

function buildImportBootstrapConfidenceMap({
  bootstrapConfidenceSeed = {},
  analysisInputs,
  importDiagnostics = {},
}) {
  if (Object.keys(bootstrapConfidenceSeed).length > 0) {
    return bootstrapConfidenceSeed.import_bootstrap;
  }

  if (analysisInputs.stepFeatureResult?.confidence_map) {
    return analysisInputs.stepFeatureResult.confidence_map;
  }

  const diagnostics = safeObject(importDiagnostics);
  const unitAssumption = safeObject(diagnostics.unit_assumption);
  const inferredOverall = {
    level: analysisInputs.usedMetadataOnlyFallback ? 'low' : 'heuristic',
    score: analysisInputs.usedMetadataOnlyFallback ? 0.3 : 0.64,
    rationale: analysisInputs.usedMetadataOnlyFallback
      ? 'Bootstrap relied on metadata-only fallback because runtime-backed geometry inspection could not produce stronger shape evidence.'
      : 'Bootstrap confidence is derived from import diagnostics plus runtime-backed or STEP-derived geometry support when available.',
  };

  return {
    overall: inferredOverall,
    part_vs_assembly: {
      level: analysisInputs.usedMetadataOnlyFallback ? 'low' : 'medium',
      score: analysisInputs.usedMetadataOnlyFallback ? 0.34 : 0.64,
      rationale: diagnostics.import_kind
        ? `Classified import as ${diagnostics.import_kind} using the available import diagnostics.`
        : 'Part-versus-assembly classification is bounded by the available import diagnostics.',
    },
    unit_assumption: {
      level: unitAssumption.assumed === false ? 'high' : analysisInputs.usedMetadataOnlyFallback ? 'low' : 'medium',
      score: unitAssumption.assumed === false ? 0.92 : analysisInputs.usedMetadataOnlyFallback ? 0.35 : 0.6,
      rationale: unitAssumption.rationale
        || 'Unit handling remains bounded by the available import diagnostics.',
    },
    feature_extraction: analysisInputs.usedMetadataOnlyFallback
      ? {
        level: 'low',
        score: 0.2,
        rationale: 'Feature extraction relied on metadata-only fallback rather than shape-derived STEP evidence.',
      }
      : {
        level: 'heuristic',
        score: 0.64,
        rationale: 'Feature extraction confidence is inferred from the available bootstrap diagnostics.',
      },
  };
}

function buildOutputPaths({ outputPath, outDir, defaultStem }) {
  const primaryOutputPath = normalizeJsonOutputPath(outputPath)
    || artifactPathFor(resolve(outDir), defaultStem, '_review_pack.json');
  return {
    reviewPackJson: primaryOutputPath,
    reviewPackMarkdown: siblingArtifactPath(primaryOutputPath, '_review_pack.md'),
    reviewPackPdf: siblingArtifactPath(primaryOutputPath, '_review_pack.pdf'),
    context: siblingArtifactPath(primaryOutputPath, '_context.json'),
    engineeringContext: siblingArtifactPath(primaryOutputPath, '_engineering_context.json'),
    ingestLog: siblingArtifactPath(primaryOutputPath, '_ingest_log.json'),
    importDiagnostics: siblingArtifactPath(primaryOutputPath, '_import_diagnostics.json'),
    bootstrapSummary: siblingArtifactPath(primaryOutputPath, '_bootstrap_summary.json'),
    bootstrapWarnings: siblingArtifactPath(primaryOutputPath, '_bootstrap_warnings.json'),
    confidenceMap: siblingArtifactPath(primaryOutputPath, '_confidence_map.json'),
    draftConfig: artifactPathFor(dirname(primaryOutputPath), deriveArtifactStem(primaryOutputPath, defaultStem), '_draft_config.toml'),
    geometry: siblingArtifactPath(primaryOutputPath, '_geometry_intelligence.json'),
    hotspots: siblingArtifactPath(primaryOutputPath, '_manufacturing_hotspots.json'),
    inspectionLinkage: siblingArtifactPath(primaryOutputPath, '_inspection_linkage.json'),
    inspectionOutliers: siblingArtifactPath(primaryOutputPath, '_inspection_outliers.json'),
    qualityLinkage: siblingArtifactPath(primaryOutputPath, '_quality_linkage.json'),
    qualityHotspots: siblingArtifactPath(primaryOutputPath, '_quality_hotspots.json'),
    reviewPriorities: siblingArtifactPath(primaryOutputPath, '_review_priorities.json'),
    revisionComparison: siblingArtifactPath(primaryOutputPath, '_revision_comparison.json'),
  };
}

function uniqueWarnings(...lists) {
  return [...new Set(
    lists
      .flat()
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function compactRuntimeDiagnostics(runtimeDiagnostics = []) {
  return runtimeDiagnostics.map((diagnostic) => ({
    stage: diagnostic?.stage || null,
    message: diagnostic?.message || null,
    actionable_hint: diagnostic?.actionable_hint || diagnostic?.actionableHint || null,
    fallback_mode: diagnostic?.fallback_mode || diagnostic?.fallbackMode || null,
  }));
}

function buildImportDiagnostics({ context, resolvedModelPath, analysisInputs }) {
  const geometrySource = context?.geometry_source || {};
  const featureResult = analysisInputs.stepFeatureResult || {};
  const geometryImportDiagnostics = safeObject(geometrySource.import_diagnostics);
  const featureImportDiagnostics = safeObject(featureResult.import_diagnostics);
  const importDiagnostics = Object.keys(geometryImportDiagnostics).length > 0
    ? geometryImportDiagnostics
    : featureImportDiagnostics;
  return {
    artifact_type: 'import_diagnostics',
    generated_at: context?.metadata?.created_at || new Date().toISOString(),
    source_model: resolvedModelPath || geometrySource.path || null,
    file_type: geometrySource.file_type || null,
    part_type: featureResult.part_type || importDiagnostics.part_type || null,
    import_kind: importDiagnostics.import_kind || null,
    assembly_detected: importDiagnostics.assembly_detected ?? null,
    body_count: importDiagnostics.body_count ?? null,
    bounding_box: importDiagnostics.bounding_box || featureResult.bounding_box || null,
    unit_system: importDiagnostics.unit_system || featureResult.unit_system || null,
    unit_assumption: importDiagnostics.unit_assumption || featureResult.unit_assumption || null,
    empty_import: importDiagnostics.empty_import === true,
    partial_import: importDiagnostics.partial_import === true,
    unsupported_import: importDiagnostics.unsupported_import === true,
    fail_closed: importDiagnostics.fail_closed === true,
    warnings: uniqueWarnings(
      geometrySource.import_warnings,
      featureResult.bootstrap_warnings,
      analysisInputs.warningMessages
    ),
    runtime_diagnostics: compactRuntimeDiagnostics(analysisInputs.runtimeDiagnostics),
  };
}

function buildBootstrapWarnings({ context, analysisInputs, analysisResult }) {
  const geometrySource = context?.geometry_source || {};
  return {
    artifact_type: 'bootstrap_warnings',
    generated_at: context?.metadata?.created_at || new Date().toISOString(),
    warnings: uniqueWarnings(
      context?.metadata?.warnings,
      geometrySource.import_warnings,
      analysisInputs.warningMessages,
      analysisResult?.geometry_intelligence?.warnings,
      analysisResult?.manufacturing_hotspots?.warnings
    ),
    runtime_diagnostics: compactRuntimeDiagnostics(analysisInputs.runtimeDiagnostics),
  };
}

function buildConfidenceMap({ analysisInputs, analysisResult, reviewPackResult }) {
  return {
    artifact_type: 'confidence_map',
    generated_at: analysisResult?.geometry_intelligence?.generated_at || new Date().toISOString(),
    import_bootstrap: analysisInputs.stepFeatureResult?.confidence_map || null,
    geometry_intelligence: analysisResult?.geometry_intelligence?.confidence || null,
    manufacturing_hotspots: analysisResult?.manufacturing_hotspots?.confidence || null,
    review_pack: reviewPackResult?.summary?.confidence || null,
  };
}

function buildBootstrapSummary({
  context,
  analysisInputs,
  analysisResult,
  linkageResult,
  reviewPackResult,
}) {
  const geometrySource = context?.geometry_source || {};
  const featureResult = analysisInputs.stepFeatureResult || {};
  const geometryImportDiagnostics = safeObject(geometrySource.import_diagnostics);
  const featureImportDiagnostics = safeObject(featureResult.import_diagnostics);
  const importDiagnostics = Object.keys(geometryImportDiagnostics).length > 0
    ? geometryImportDiagnostics
    : featureImportDiagnostics;
  const features = analysisResult?.geometry_intelligence?.features || {};
  return {
    artifact_type: 'bootstrap_summary',
    generated_at: analysisResult?.geometry_intelligence?.generated_at || new Date().toISOString(),
    part: context?.part || {},
    source_model: geometrySource.path || null,
    file_type: geometrySource.file_type || null,
    analysis_mode: geometrySource.analysis_mode || null,
    part_type: featureResult.part_type || importDiagnostics.part_type || null,
    import_kind: importDiagnostics.import_kind || null,
    unit_assumption: importDiagnostics.unit_assumption || featureResult.unit_assumption || null,
    bounding_box: featureResult.bounding_box || importDiagnostics.bounding_box || null,
    detected_features: {
      hole_like_feature_count: features.hole_like_feature_count ?? null,
      hole_pattern_count: features.hole_pattern_count ?? null,
      repeated_feature_count: features.repeated_feature_count ?? null,
      complexity_score: features.complexity_score ?? null,
      review_priority_count: Array.isArray(linkageResult?.review_priorities) ? linkageResult.review_priorities.length : null,
    },
    confidence_map: buildConfidenceMap({ analysisInputs, analysisResult, reviewPackResult }),
    warnings: uniqueWarnings(
      context?.metadata?.warnings,
      geometrySource.import_warnings,
      analysisInputs.warningMessages,
      reviewPackResult?.summary?.warnings
    ),
    review_gate: {
      ready_for_review_context: true,
      correction_required: Boolean(
        importDiagnostics.partial_import
        || importDiagnostics.unit_assumption
        || analysisInputs.usedMetadataOnlyFallback
      ),
      optional_context_inputs: ['bom', 'inspection', 'quality', 'create_quality', 'drawing_quality', 'drawing_qa', 'drawing_intent', 'feature_catalog', 'dfm_report'],
    },
  };
}

export async function runReviewContextPipeline({
  projectRoot,
  contextPath = null,
  modelPath,
  bomPath = null,
  inspectionPath = null,
  qualityPath = null,
  createQualityPath = null,
  drawingQualityPath = null,
  drawingQaPath = null,
  drawingIntentPath = null,
  featureCatalogPath = null,
  dfmReportPath = null,
  compareToPath = null,
  outputPath = null,
  outDir = null,
  partName = null,
  partId = null,
  revision = null,
  material = null,
  manufacturingProcess = null,
  facility = null,
  supplier = null,
  manufacturingNotes = null,
  bootstrap = null,
  runPythonJsonScript,
  inspectModelIfAvailable,
  detectStepFeaturesIfAvailable,
}) {
  const defaultStem = deriveArtifactStem(outputPath || modelPath || bomPath || inspectionPath || qualityPath, partName || 'engineering_part');
  const outputDir = resolve(outDir || dirname(outputPath || artifactPathFor(resolve(projectRoot, 'output'), defaultStem, '_review_pack.json')));
  const paths = buildOutputPaths({
    outputPath,
    outDir: outputDir,
    defaultStem,
  });

  let context;
  let ingestLog;

  if (contextPath) {
    context = await readJsonFile(contextPath);
    ingestLog = {
      created_at: context?.metadata?.created_at || new Date().toISOString(),
      sources: [],
      warnings: context?.metadata?.warnings || [],
      summary: {
        bom_entries: context?.bom?.length || 0,
        inspection_results: context?.inspection_results?.length || 0,
        quality_issues: context?.quality_issues?.length || 0,
      },
      mode: 'prebuilt_context',
    };
  } else {
    const ingestResult = await runPythonJsonScript(projectRoot, 'scripts/ingest_context.py', {
      model: modelPath,
      bom: bomPath,
      inspection: inspectionPath,
      quality: qualityPath,
      part_name: partName,
      part_id: partId,
      revision,
      material,
      process: manufacturingProcess,
      facility,
      supplier,
      manufacturing_notes: manufacturingNotes,
    }, {
      onStderr: (text) => process.stderr.write(text),
    });
    context = ingestResult.context;
    ingestLog = ingestResult.ingest_log;
  }

  const resolvedModelPath = modelPath || context?.geometry_source?.path || null;
  const analysisInputs = await resolveModelAnalysisInputs({
    modelPath: resolvedModelPath,
    modelMetadata: context?.geometry_source?.model_metadata || null,
    featureHints: context?.geometry_source?.feature_hints || null,
    inspectModelIfAvailable,
    detectStepFeaturesIfAvailable,
  });

  const bootstrapState = safeObject(bootstrap);
  const bootstrapWarnings = uniqueStrings([
    ...safeList(bootstrapState.warnings),
    ...safeList(bootstrapState.warning_messages),
  ]);
  const bootstrapDiagnostics = normalizeBootstrapDiagnostics(bootstrapState.import_diagnostics);
  const primaryBootstrapDiagnostics = bootstrapDiagnostics[0] || {};
  const bootstrapSummarySeed = safeObject(bootstrapState.bootstrap_summary);
  const bootstrapConfidenceSeed = normalizeBootstrapConfidenceMap(
    bootstrapState.confidence_map || bootstrapState.confidence
  );
  const draftConfigToml = typeof bootstrapState.draft_config_toml === 'string' && bootstrapState.draft_config_toml.trim()
    ? bootstrapState.draft_config_toml
    : null;

  context.geometry_source = {
    ...(context?.geometry_source || {}),
    ...(analysisInputs.geometrySourcePatch || {}),
    ...(bootstrapSummarySeed.model_kind ? { model_kind: bootstrapSummarySeed.model_kind } : {}),
    ...(bootstrapSummarySeed.part_count !== undefined ? { part_count: bootstrapSummarySeed.part_count } : {}),
    ...(bootstrapSummarySeed.body_count !== undefined ? { body_count: bootstrapSummarySeed.body_count } : {}),
    ...(bootstrapSummarySeed.unit_system ? { unit_system: bootstrapSummarySeed.unit_system } : {}),
    ...(Object.keys(primaryBootstrapDiagnostics).length > 0 ? { import_diagnostics: primaryBootstrapDiagnostics } : {}),
    ...(draftConfigToml ? {
      bootstrap: {
        ...safeObject(context?.geometry_source?.bootstrap),
        draft_config_available: true,
      },
    } : {}),
  };
  context.metadata = {
    ...(context?.metadata || {}),
    warnings: [
      ...new Set([
        ...((context?.metadata?.warnings) || []),
        ...analysisInputs.warningMessages,
        ...bootstrapWarnings,
      ]),
    ],
    runtime_diagnostics: analysisInputs.runtimeDiagnostics,
  };
  ingestLog = {
    ...(ingestLog || {}),
    warnings: [
      ...new Set([
        ...((ingestLog?.warnings) || []),
        ...analysisInputs.warningMessages,
      ]),
    ],
    diagnostics: [
      ...((ingestLog?.diagnostics) || []),
      ...analysisInputs.runtimeDiagnostics.map((diagnostic) => ({
        stage: diagnostic.stage,
        message: diagnostic.message,
        actionable_hint: diagnostic.actionable_hint,
        fallback_mode: diagnostic.fallback_mode,
      })),
    ],
    summary: {
      ...((ingestLog?.summary) || {}),
      diagnostics: (((ingestLog?.diagnostics) || []).length + analysisInputs.runtimeDiagnostics.length),
    },
  };

  await writeJsonFile(paths.context, context);
  await writeJsonFile(paths.engineeringContext, context);
  await writeJsonFile(paths.ingestLog, ingestLog);

  const analysisResult = await runPythonJsonScript(projectRoot, 'scripts/analyze_part.py', {
    context,
    model_metadata: analysisInputs.modelMetadata,
    feature_hints: analysisInputs.featureHints,
    geometry_source: context?.geometry_source || (resolvedModelPath ? { path: resolvedModelPath } : {}),
    part: context?.part || { name: defaultStem },
    warnings: analysisInputs.warningMessages,
    runtime_diagnostics: analysisInputs.runtimeDiagnostics,
    allow_metadata_only_fallback: true,
    used_metadata_only_fallback: analysisInputs.usedMetadataOnlyFallback,
  }, {
    onStderr: (text) => process.stderr.write(text),
  });

  await writeJsonFile(paths.geometry, analysisResult.geometry_intelligence);
  await writeJsonFile(paths.hotspots, analysisResult.manufacturing_hotspots);

  const linkageResult = await runPythonJsonScript(projectRoot, 'scripts/quality_link.py', {
    context,
    geometry_intelligence: analysisResult.geometry_intelligence,
    manufacturing_hotspots: analysisResult.manufacturing_hotspots,
  }, {
    onStderr: (text) => process.stderr.write(text),
  });

  await writeJsonFile(paths.inspectionLinkage, linkageResult.inspection_linkage);
  await writeJsonFile(paths.inspectionOutliers, linkageResult.inspection_outliers);
  await writeJsonFile(paths.qualityLinkage, linkageResult.quality_linkage);
  await writeJsonFile(paths.qualityHotspots, linkageResult.quality_hotspots);
  await writeJsonFile(paths.reviewPriorities, linkageResult.review_priorities);

  const packageEvidence = await buildPackageEvidenceRecords(projectRoot, {
    createQualityPath,
    drawingQualityPath,
    drawingQaPath,
    drawingIntentPath,
    featureCatalogPath,
    dfmReportPath,
  });
  const packageEvidenceSourceRefs = packageEvidence.records.map((record) => ({
    artifact_type: record.artifact_type,
    path: record.source_ref,
    role: 'evidence',
    label: record.label,
  }));
  if (packageEvidence.warnings.length > 0) {
    context.metadata = {
      ...(context.metadata || {}),
      warnings: uniqueWarnings(context.metadata?.warnings, packageEvidence.warnings),
    };
  }

  const reviewPackResult = await runPythonJsonScript(projectRoot, 'scripts/reporting/review_pack.py', {
    context,
    geometry_intelligence: analysisResult.geometry_intelligence,
    manufacturing_hotspots: analysisResult.manufacturing_hotspots,
    inspection_linkage: linkageResult.inspection_linkage,
    inspection_outliers: linkageResult.inspection_outliers,
    quality_linkage: linkageResult.quality_linkage,
    quality_hotspots: linkageResult.quality_hotspots,
    review_priorities: linkageResult.review_priorities,
    workflow: {
      steps: contextPath
        ? ['context-input', 'analyze-part', 'quality-link', 'review-pack']
        : ['ingest', 'analyze-part', 'quality-link', 'review-pack'],
    },
    package_evidence: packageEvidence.records,
    source_artifact_refs: packageEvidenceSourceRefs,
    output_dir: outputDir,
    output_stem: deriveArtifactStem(paths.reviewPackJson, defaultStem),
    output_json_path: paths.reviewPackJson,
    output_markdown_path: paths.reviewPackMarkdown,
    output_pdf_path: paths.reviewPackPdf,
  }, {
    timeout: 180_000,
    onStderr: (text) => process.stderr.write(text),
  });

  let revisionComparison = null;
  if (compareToPath) {
    const baselineReviewPack = await readJsonFile(compareToPath);
    const candidateReviewPack = await readJsonFile(reviewPackResult.artifacts.json);
    const comparisonResult = await runPythonJsonScript(projectRoot, 'scripts/reporting/revision_diff.py', {
      baseline: baselineReviewPack,
      candidate: candidateReviewPack,
      baseline_path: compareToPath,
      candidate_path: reviewPackResult.artifacts.json,
    }, {
      onStderr: (text) => process.stderr.write(text),
    });
    revisionComparison = comparisonResult.comparison;
    await writeJsonFile(paths.revisionComparison, revisionComparison);
  }

  const rawImportDiagnostics = safeObject(context?.geometry_source?.import_diagnostics);
  const importDiagnostics = {
    artifact_type: 'import_diagnostics',
    generated_at: context?.metadata?.created_at || new Date().toISOString(),
    source_model_path: resolvedModelPath,
    file_type: context?.geometry_source?.file_type || null,
    analysis_mode: context?.geometry_source?.analysis_mode || null,
    model_kind: context?.geometry_source?.model_kind || rawImportDiagnostics.import_kind || bootstrapSummarySeed.model_kind || null,
    unit_system: context?.geometry_source?.unit_system || rawImportDiagnostics.unit_assumption?.unit || bootstrapSummarySeed.unit_system || null,
    unit_assumption: rawImportDiagnostics.unit_assumption || null,
    body_count: context?.geometry_source?.body_count ?? rawImportDiagnostics.body_count ?? bootstrapSummarySeed.body_count ?? null,
    part_count: context?.geometry_source?.part_count ?? bootstrapSummarySeed.part_count ?? null,
    diagnostics: [
      ...bootstrapDiagnostics,
      ...analysisInputs.runtimeDiagnostics,
    ],
    warnings: uniqueStrings([
      ...safeList(context?.metadata?.warnings),
      ...bootstrapWarnings,
    ]),
  };
  await writeJsonFile(paths.importDiagnostics, importDiagnostics);

  const bootstrapWarningsDocument = {
    artifact_type: 'bootstrap_warnings',
    generated_at: importDiagnostics.generated_at,
    warning_count: importDiagnostics.warnings.length,
    warnings: importDiagnostics.warnings,
  };
  await writeJsonFile(paths.bootstrapWarnings, bootstrapWarningsDocument);

  const confidenceMap = {
    artifact_type: 'confidence_map',
    generated_at: importDiagnostics.generated_at,
    import_bootstrap: buildImportBootstrapConfidenceMap({
      bootstrapConfidenceSeed,
      analysisInputs,
      importDiagnostics: rawImportDiagnostics,
    }),
    geometry_intelligence: analysisResult.geometry_intelligence.confidence || null,
    manufacturing_hotspots: analysisResult.manufacturing_hotspots.confidence || null,
    review_pack: reviewPackResult.summary?.confidence || null,
  };
  await writeJsonFile(paths.confidenceMap, confidenceMap);

  const geometryMetrics = analysisResult.geometry_intelligence.metrics?.bounding_box_mm || {};
  const featureHints = safeObject(context?.geometry_source?.feature_hints);
  const bootstrapSummary = {
    artifact_type: 'bootstrap_summary',
    generated_at: importDiagnostics.generated_at,
    part: context?.part || { name: defaultStem },
    source: {
      model_path: resolvedModelPath,
      file_type: context?.geometry_source?.file_type || null,
      analysis_mode: context?.geometry_source?.analysis_mode || null,
      model_kind: importDiagnostics.model_kind,
    },
    dimensions_mm: {
      x: geometryMetrics.x ?? null,
      y: geometryMetrics.y ?? null,
      z: geometryMetrics.z ?? null,
    },
    feature_summary: {
      cylinder_count: featureCollectionCount(featureHints.cylinders),
      bolt_circle_count: featureCollectionCount(featureHints.bolt_circles),
      fillet_count: featureCollectionCount(featureHints.fillets),
      chamfer_count: featureCollectionCount(featureHints.chamfers),
      derived_feature_count: featureCollectionCount(analysisResult.geometry_intelligence.derived_features),
      hotspot_count: featureCollectionCount(analysisResult.manufacturing_hotspots.hotspots),
    },
    warning_count: bootstrapWarningsDocument.warning_count,
    diagnostics_count: importDiagnostics.diagnostics.length,
    review_gate: {
      ready_for_review_context: true,
      correction_required: shouldRequireBootstrapCorrection({
        importDiagnostics: rawImportDiagnostics,
        usedMetadataOnlyFallback: analysisInputs.usedMetadataOnlyFallback,
      }),
      optional_context_inputs: ['bom', 'inspection', 'quality', 'create_quality', 'drawing_quality', 'drawing_qa', 'drawing_intent', 'feature_catalog', 'dfm_report'],
    },
    review_ready: Boolean(resolvedModelPath || contextPath),
  };
  await writeJsonFile(paths.bootstrapSummary, bootstrapSummary);

  const generatedDraftConfigToml = draftConfigToml
    || (analysisInputs.stepFeatureResult?.suggested_config
      ? `${generateConfigFromAnalysis(analysisInputs.stepFeatureResult).trimEnd()}\n`
      : null);

  if (generatedDraftConfigToml) {
    await writeFile(paths.draftConfig, generatedDraftConfigToml, 'utf8');
  }

  return {
    context,
    ingestLog,
    geometryIntelligence: analysisResult.geometry_intelligence,
    manufacturingHotspots: analysisResult.manufacturing_hotspots,
    linkage: linkageResult,
    reviewPack: reviewPackResult.summary,
    artifacts: {
      context: paths.context,
      engineeringContext: paths.engineeringContext,
      ingestLog: paths.ingestLog,
      importDiagnostics: paths.importDiagnostics,
      bootstrapSummary: paths.bootstrapSummary,
      bootstrapWarnings: paths.bootstrapWarnings,
      confidenceMap: paths.confidenceMap,
      draftConfig: generatedDraftConfigToml ? paths.draftConfig : null,
      geometry: paths.geometry,
      hotspots: paths.hotspots,
      inspectionLinkage: paths.inspectionLinkage,
      inspectionOutliers: paths.inspectionOutliers,
      qualityLinkage: paths.qualityLinkage,
      qualityHotspots: paths.qualityHotspots,
      reviewPriorities: paths.reviewPriorities,
      reviewPackJson: reviewPackResult.artifacts.json,
      reviewPackMarkdown: reviewPackResult.artifacts.markdown,
      reviewPackPdf: reviewPackResult.artifacts.pdf,
      revisionComparison: revisionComparison ? paths.revisionComparison : null,
    },
    revisionComparison,
  };
}
