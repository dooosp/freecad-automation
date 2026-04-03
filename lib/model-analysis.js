import { extname } from 'node:path';

import { hasFreeCADRuntime } from './paths.js';
import {
  buildMetadataOnlyFallbackModelMetadata,
  buildModelRuntimeDiagnostic,
  defaultMetadataFallbackHint,
  hasUsableModelMetadata,
  runtimeDiagnosticsToWarnings,
} from './runtime-diagnostics.js';

function mergeFeatureHints(primary, fallback = {}) {
  if (primary && typeof primary === 'object') return primary;
  return fallback && typeof fallback === 'object' ? fallback : {};
}

function mergeWarnings(...collections) {
  return [...new Set(
    collections
      .flatMap((entry) => Array.isArray(entry) ? entry : [entry])
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
  )];
}

function buildBootstrapArtifacts(stepFeatureResult = null) {
  if (!stepFeatureResult || stepFeatureResult.success !== true) {
    return {
      importDiagnostics: null,
      bootstrapSummary: null,
      bootstrapWarnings: [],
      confidenceMap: null,
      suggestedConfig: null,
    };
  }

  return {
    importDiagnostics: stepFeatureResult.import_diagnostics || null,
    bootstrapSummary: stepFeatureResult.bootstrap_summary || null,
    bootstrapWarnings: Array.isArray(stepFeatureResult.bootstrap_warnings) ? stepFeatureResult.bootstrap_warnings : [],
    confidenceMap: stepFeatureResult.confidence_map || null,
    suggestedConfig: stepFeatureResult.suggested_config || null,
  };
}

export async function resolveModelAnalysisInputs({
  modelPath = null,
  modelMetadata = null,
  featureHints = null,
  inspectModelIfAvailable,
  detectStepFeaturesIfAvailable,
} = {}) {
  const runtimeDiagnostics = [];
  let resolvedModelMetadata = modelMetadata;
  let resolvedFeatureHints = featureHints;
  let inspectionResult = null;
  let stepFeatureResult = null;
  const startedWithModelMetadata = hasUsableModelMetadata(modelMetadata);

  if (modelPath && !hasUsableModelMetadata(resolvedModelMetadata) && !hasFreeCADRuntime()) {
    runtimeDiagnostics.push(buildModelRuntimeDiagnostic({
      stage: 'runtime-unavailable',
      modelPath,
      message: 'FreeCAD runtime is not available for model inspection.',
      actionableHint: defaultMetadataFallbackHint(),
      fallbackMode: 'metadata-only',
    }));
  }

  if (modelPath && typeof inspectModelIfAvailable === 'function') {
    inspectionResult = await inspectModelIfAvailable(modelPath);
    if (inspectionResult?.success && hasUsableModelMetadata(inspectionResult.model)) {
      resolvedModelMetadata = inspectionResult.model;
    } else if (inspectionResult?.diagnostic) {
      runtimeDiagnostics.push(inspectionResult.diagnostic);
    }
  }

  if (modelPath && typeof detectStepFeaturesIfAvailable === 'function') {
    stepFeatureResult = await detectStepFeaturesIfAvailable(modelPath);
    if (stepFeatureResult?.success) {
      resolvedFeatureHints = stepFeatureResult.features || stepFeatureResult.feature_hints;
    } else if (stepFeatureResult?.diagnostic) {
      runtimeDiagnostics.push(stepFeatureResult.diagnostic);
    }
  }

  let usedMetadataOnlyFallback = false;
  if (!hasUsableModelMetadata(resolvedModelMetadata) && modelPath) {
    resolvedModelMetadata = buildMetadataOnlyFallbackModelMetadata({
      stepFeatureResult,
    });
    usedMetadataOnlyFallback = true;
    runtimeDiagnostics.push(buildModelRuntimeDiagnostic({
      stage: 'metadata-only-fallback',
      modelPath,
      message: 'Shape-derived model metadata is unavailable or weak.',
      actionableHint: defaultMetadataFallbackHint(),
      fallbackMode: 'metadata-only',
    }));
  }

  const bootstrapArtifacts = buildBootstrapArtifacts(stepFeatureResult);

  return {
    modelMetadata: resolvedModelMetadata,
    featureHints: mergeFeatureHints(resolvedFeatureHints),
    stepFeatureResult,
    bootstrapArtifacts,
    runtimeDiagnostics,
    warningMessages: mergeWarnings(
      runtimeDiagnosticsToWarnings(runtimeDiagnostics),
      bootstrapArtifacts.bootstrapWarnings
    ),
    usedMetadataOnlyFallback,
    geometrySourcePatch: modelPath
      ? {
          path: modelPath,
          file_type: extname(modelPath).replace(/^\./, '').toLowerCase() || null,
          ...(usedMetadataOnlyFallback ? { validated: false } : {}),
          model_metadata: resolvedModelMetadata || null,
          feature_hints: mergeFeatureHints(resolvedFeatureHints),
          runtime_diagnostics: runtimeDiagnostics,
          import_diagnostics: bootstrapArtifacts.importDiagnostics,
          bootstrap_summary: bootstrapArtifacts.bootstrapSummary,
          bootstrap_warnings: bootstrapArtifacts.bootstrapWarnings,
          confidence_map: bootstrapArtifacts.confidenceMap,
          suggested_config: bootstrapArtifacts.suggestedConfig,
          analysis_mode: usedMetadataOnlyFallback
            ? 'metadata_only_fallback'
            : startedWithModelMetadata
              ? 'prebuilt_model_metadata'
              : 'runtime_backed',
        }
      : null,
  };
}
