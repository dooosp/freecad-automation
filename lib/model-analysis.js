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
      resolvedFeatureHints = stepFeatureResult.features;
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

  return {
    modelMetadata: resolvedModelMetadata,
    featureHints: mergeFeatureHints(resolvedFeatureHints),
    runtimeDiagnostics,
    warningMessages: runtimeDiagnosticsToWarnings(runtimeDiagnostics),
    usedMetadataOnlyFallback,
    geometrySourcePatch: modelPath
      ? {
          path: modelPath,
          file_type: extname(modelPath).replace(/^\./, '').toLowerCase() || null,
          ...(usedMetadataOnlyFallback ? { validated: false } : {}),
          model_metadata: resolvedModelMetadata || null,
          feature_hints: mergeFeatureHints(resolvedFeatureHints),
          runtime_diagnostics: runtimeDiagnostics,
          analysis_mode: usedMetadataOnlyFallback
            ? 'metadata_only_fallback'
            : startedWithModelMetadata
              ? 'prebuilt_model_metadata'
              : 'runtime_backed',
        }
      : null,
  };
}
