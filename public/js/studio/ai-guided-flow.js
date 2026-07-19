const AI_DRAFT_PHASES = new Set([
  'prompt',
  'requesting',
  'review',
  'validating',
  'validated',
]);

export function ensureAiDraftState(model = {}) {
  const current = model.assistant && typeof model.assistant === 'object'
    ? model.assistant
    : {};
  current.busy = current.busy === true;
  current.error = typeof current.error === 'string' ? current.error : '';
  current.report = current.report && typeof current.report === 'object'
    ? current.report
    : null;
  current.phase = AI_DRAFT_PHASES.has(current.phase) ? current.phase : 'prompt';
  current.validatedConfigText = typeof current.validatedConfigText === 'string'
    ? current.validatedConfigText
    : '';
  model.assistant = current;
  return current;
}

export function markAiDraftForReview(model = {}, { toml = '', report = null } = {}) {
  const assistant = ensureAiDraftState(model);
  model.sourceType = 'assistant draft';
  model.sourceName = 'Prompt-generated TOML';
  model.sourcePath = 'In-memory draft';
  model.configText = String(toml);
  model.promptMode = true;
  model.editingEnabled = true;
  model.buildState = 'idle';
  model.errorMessage = '';
  model.buildLog = [];
  model.overview = null;
  model.preview = null;
  model.validation = {
    warnings: [],
    changed_fields: [],
    deprecated_fields: [],
  };
  assistant.busy = false;
  assistant.error = '';
  assistant.report = report && typeof report === 'object' ? report : null;
  assistant.phase = 'review';
  assistant.validatedConfigText = '';
  return assistant;
}

export function markAiDraftValidated(model = {}) {
  const assistant = ensureAiDraftState(model);
  assistant.phase = 'validated';
  assistant.validatedConfigText = String(model.configText || '');
  assistant.error = '';
  return assistant;
}

export function invalidateAiDraftValidation(model = {}) {
  const assistant = ensureAiDraftState(model);
  if (model.sourceType !== 'assistant draft') return assistant;
  assistant.phase = 'review';
  assistant.validatedConfigText = '';
  model.overview = null;
  model.validation = {
    warnings: [],
    changed_fields: [],
    deprecated_fields: [],
  };
  return assistant;
}

export function aiDraftRequiresReview(model = {}) {
  if (model.sourceType !== 'assistant draft') return false;
  const assistant = ensureAiDraftState(model);
  return assistant.phase !== 'validated'
    || assistant.validatedConfigText !== String(model.configText || '');
}

export const AI_DRAFT_PHASE_IDS = Object.freeze([...AI_DRAFT_PHASES]);
