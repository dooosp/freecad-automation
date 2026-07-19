import assert from 'node:assert/strict';

import {
  aiDraftRequiresReview,
  ensureAiDraftState,
  markAiDraftForReview,
  markAiDraftValidated,
} from '../public/js/studio/ai-guided-flow.js';

const model = {};
assert.deepEqual(ensureAiDraftState(model), {
  busy: false,
  error: '',
  report: null,
  phase: 'prompt',
  validatedConfigText: '',
});
assert.equal(aiDraftRequiresReview(model), false);

markAiDraftForReview(model, {
  toml: 'name = "ai-draft"\n',
  report: { mechanism_type: 'fixture' },
});
assert.equal(model.sourceType, 'assistant draft');
assert.equal(model.sourceName, 'Prompt-generated TOML');
assert.equal(model.configText, 'name = "ai-draft"\n');
assert.equal(model.assistant.phase, 'review');
assert.equal(model.assistant.validatedConfigText, '');
assert.equal(aiDraftRequiresReview(model), true);

markAiDraftValidated(model);
assert.equal(model.assistant.phase, 'validated');
assert.equal(model.assistant.validatedConfigText, model.configText);
assert.equal(aiDraftRequiresReview(model), false);

model.configText += '# human edit\n';
assert.equal(
  aiDraftRequiresReview(model),
  true,
  'editing an AI draft after validation must require another explicit review and validation',
);

console.log('ai-guided-flow.test.js: ok');
