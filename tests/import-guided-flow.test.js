import assert from 'node:assert/strict';

import {
  buildImportBootstrapRequestBody,
  createImportGuidedStepStates,
  ensureImportGuidedFlowState,
  formatImportUploadSize,
  resetImportGuidedFlow,
  resolveImportGuidedError,
  resolveImportGuidedStep,
  setImportGuidedError,
  setImportGuidedStep,
  STUDIO_IMPORT_UPLOAD_LIMIT_BYTES,
  STUDIO_IMPORT_UPLOAD_LIMIT_LABEL,
  validateImportUploadFile,
} from '../public/js/studio/import-guided-flow.js';
import { MAX_BOOTSTRAP_UPLOAD_BYTES } from '../src/services/import/bootstrap-import-service.js';

const importBootstrap = {};
assert.deepEqual(ensureImportGuidedFlowState(importBootstrap), {
  step: 'select_file',
  error: '',
});
assert.equal(resolveImportGuidedStep(importBootstrap), 'select_file');

importBootstrap.status = 'loading';
setImportGuidedStep(importBootstrap, 'diagnostics');
assert.equal(resolveImportGuidedStep(importBootstrap), 'diagnostics');

importBootstrap.status = 'ready';
importBootstrap.preview = { tracked_review_seed: { context_path: 'output/context.json' } };
assert.equal(resolveImportGuidedStep(importBootstrap), 'confirm');
assert.deepEqual(createImportGuidedStepStates(importBootstrap).map(({ state }) => state), [
  'complete',
  'complete',
  'current',
  'upcoming',
  'upcoming',
]);

importBootstrap.submitting = true;
assert.equal(resolveImportGuidedStep(importBootstrap), 'running');

importBootstrap.submitting = false;
importBootstrap.lastJobId = 'job-import-1';
setImportGuidedStep(importBootstrap, 'result');
assert.equal(resolveImportGuidedStep(importBootstrap), 'result');

const upload = { name: 'bracket.step', content_base64: 'U1RFUA==' };
assert.deepEqual(buildImportBootstrapRequestBody({
  modelPath: 'tests/fixtures/ignored.step',
  bomPath: ' tests/fixtures/bom.csv ',
  inspectionPath: '',
  qualityPath: 'tests/fixtures/quality.csv',
}, { modelUpload: upload }), {
  model_upload: upload,
  bom_path: 'tests/fixtures/bom.csv',
  quality_path: 'tests/fixtures/quality.csv',
});

assert.deepEqual(buildImportBootstrapRequestBody({
  modelPath: ' tests/fixtures/imports/simple_bracket.step ',
}), {
  model_path: 'tests/fixtures/imports/simple_bracket.step',
});

assert.equal(STUDIO_IMPORT_UPLOAD_LIMIT_BYTES, 32 * 1024 * 1024);
assert.equal(STUDIO_IMPORT_UPLOAD_LIMIT_BYTES, MAX_BOOTSTRAP_UPLOAD_BYTES);
assert.equal(STUDIO_IMPORT_UPLOAD_LIMIT_LABEL, '32 MiB');
assert.equal(formatImportUploadSize(1024 * 1024), '1.0 MiB');
assert.deepEqual(validateImportUploadFile({ size: STUDIO_IMPORT_UPLOAD_LIMIT_BYTES }), {
  ok: true,
  sizeLabel: '32.0 MiB',
  limitLabel: '32 MiB',
});
assert.deepEqual(validateImportUploadFile({ size: STUDIO_IMPORT_UPLOAD_LIMIT_BYTES + 1 }), {
  ok: false,
  sizeLabel: '32.1 MiB',
  limitLabel: '32 MiB',
});

setImportGuidedError(importBootstrap, {
  key: 'studio.import.guided.file.too-large',
  params: { size: '40 MiB', limit: '32 MiB' },
});
assert.equal(importBootstrap.guidedFlow.error, '');
assert.equal(
  resolveImportGuidedError(importBootstrap, (key, params) => `${key}:${params.size}:${params.limit}`),
  'studio.import.guided.file.too-large:40 MiB:32 MiB'
);
setImportGuidedStep(importBootstrap, 'result');
assert.equal(resolveImportGuidedError(importBootstrap), '');
assert.equal('errorKey' in importBootstrap.guidedFlow, false);
assert.equal('errorParams' in importBootstrap.guidedFlow, false);

resetImportGuidedFlow(importBootstrap);
assert.equal(resolveImportGuidedStep(importBootstrap), 'select_file');
assert.equal(importBootstrap.preview, null);
assert.equal(importBootstrap.lastJobId, '');

const existingFlow = { guidedFlow: { step: 'invalid', error: 42 } };
const existingFlowReference = existingFlow.guidedFlow;
assert.deepEqual(ensureImportGuidedFlowState(existingFlow), {
  step: 'select_file',
  error: '',
});
assert.equal(existingFlow.guidedFlow, existingFlowReference);

console.log('import-guided-flow.test.js: ok');
