import assert from 'node:assert/strict';

import { resolveModelAnalysisInputs } from '../lib/model-analysis.js';

const modelPath = '/tmp/weak-shape.step';

const result = await resolveModelAnalysisInputs({
  modelPath,
  inspectModelIfAvailable: async () => ({
    success: false,
    diagnostic: {
      stage: 'model-inspection',
      model_path: modelPath,
      message: 'Runtime-backed model inspection failed: shape is invalid',
      actionable_hint: 'Inspect or repair the CAD model, or provide prebuilt context model_metadata when you need shape-derived metrics.',
      fallback_mode: 'metadata-only',
    },
  }),
  detectStepFeaturesIfAvailable: async () => ({
    success: false,
    diagnostic: {
      stage: 'step-feature-detection',
      model_path: modelPath,
      message: 'STEP feature detection failed: invalid shape',
      actionable_hint: 'Repair the STEP/shape if you need STEP-derived feature hints.',
      fallback_mode: 'no-step-features',
    },
  }),
});

assert.equal(result.usedMetadataOnlyFallback, true);
assert.equal(result.modelMetadata.bounding_box.size[0], 0);
assert.equal(result.geometrySourcePatch.analysis_mode, 'metadata_only_fallback');
assert.equal(result.geometrySourcePatch.validated, false);
assert.equal(result.runtimeDiagnostics.length, 3);
assert.equal(result.featureHints.bolt_circles, undefined);
assert.equal(result.warningMessages.some((warning) => warning.includes('metadata-only fallback')), true);
assert.equal(result.warningMessages.some((warning) => warning.includes('STEP-derived feature hints')), true);

console.log('model-analysis-runtime.test.js: ok');
