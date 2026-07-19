import assert from 'node:assert/strict';

import {
  createModelGuidedStepStates,
  ensureModelGuidedFlowState,
  resetModelGuidedFlow,
  resolveModelGuidedStep,
  setModelGuidedStep,
} from '../public/js/studio/model-guided-flow.js';

const model = {};
assert.deepEqual(ensureModelGuidedFlowState(model), {
  step: 'select_input',
  inputMethod: 'example',
  resultExpanded: false,
  error: '',
});
assert.equal(resolveModelGuidedStep(model), 'select_input');

model.configText = 'name = "demo"';
setModelGuidedStep(model, 'preflight');
assert.equal(resolveModelGuidedStep(model), 'preflight');
assert.deepEqual(createModelGuidedStepStates(model).map(({ state }) => state), [
  'complete',
  'current',
  'upcoming',
  'upcoming',
]);

model.buildState = 'building';
assert.equal(resolveModelGuidedStep(model), 'running');

model.buildState = 'success';
model.preview = { id: 'preview-1' };
assert.equal(resolveModelGuidedStep(model), 'result');

model.guidedFlow.resultExpanded = true;
resetModelGuidedFlow(model);
assert.equal(resolveModelGuidedStep(model), 'select_input');
assert.equal(model.guidedFlow.resultExpanded, false);

const fileModel = { sourceType: 'local file', guidedFlow: { inputMethod: 'invalid' } };
const fileFlowReference = fileModel.guidedFlow;
assert.equal(ensureModelGuidedFlowState(fileModel).inputMethod, 'file');
assert.equal(fileModel.guidedFlow, fileFlowReference);

const aiModel = { guidedFlow: { inputMethod: 'ai' } };
assert.equal(
  ensureModelGuidedFlowState(aiModel).inputMethod,
  'ai',
  'the advanced AI starting method must remain selected without triggering side effects',
);

console.log('model-guided-flow.test.js: ok');
