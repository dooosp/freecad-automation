import { dirname, resolve } from 'node:path';

import {
  artifactPathFor,
  deriveArtifactStem,
  readJsonFile,
  writeJsonFile,
} from '../../lib/context-loader.js';
import { resolveModelAnalysisInputs } from '../../lib/model-analysis.js';

function normalizeJsonOutputPath(pathValue) {
  if (!pathValue) return null;
  const absPath = resolve(pathValue);
  return absPath.toLowerCase().endsWith('.json') ? absPath : `${absPath}.json`;
}

function siblingArtifactPath(primaryJsonPath, suffix) {
  const stem = deriveArtifactStem(primaryJsonPath, 'review_context');
  return artifactPathFor(dirname(primaryJsonPath), stem, suffix);
}

function buildOutputPaths({ outputPath, outDir, defaultStem }) {
  const primaryOutputPath = normalizeJsonOutputPath(outputPath)
    || artifactPathFor(resolve(outDir), defaultStem, '_review_pack.json');
  return {
    reviewPackJson: primaryOutputPath,
    reviewPackMarkdown: siblingArtifactPath(primaryOutputPath, '_review_pack.md'),
    reviewPackPdf: siblingArtifactPath(primaryOutputPath, '_review_pack.pdf'),
    context: siblingArtifactPath(primaryOutputPath, '_context.json'),
    ingestLog: siblingArtifactPath(primaryOutputPath, '_ingest_log.json'),
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

export async function runReviewContextPipeline({
  projectRoot,
  contextPath = null,
  modelPath,
  bomPath = null,
  inspectionPath = null,
  qualityPath = null,
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

  context.geometry_source = {
    ...(context?.geometry_source || {}),
    ...(analysisInputs.geometrySourcePatch || {}),
  };
  context.metadata = {
    ...(context?.metadata || {}),
    warnings: [
      ...new Set([
        ...((context?.metadata?.warnings) || []),
        ...analysisInputs.warningMessages,
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

  return {
    context,
    ingestLog,
    geometryIntelligence: analysisResult.geometry_intelligence,
    manufacturingHotspots: analysisResult.manufacturing_hotspots,
    linkage: linkageResult,
    reviewPack: reviewPackResult.summary,
    artifacts: {
      context: paths.context,
      ingestLog: paths.ingestLog,
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
