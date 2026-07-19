const MODEL_GUIDED_STEP_IDS = Object.freeze([
  'select_input',
  'preflight',
  'running',
  'result',
]);

const MODEL_GUIDED_INPUT_METHODS = new Set(['example', 'file', 'ai']);

function normalizeStep(step = '') {
  return MODEL_GUIDED_STEP_IDS.includes(step) ? step : 'select_input';
}

function normalizeInputMethod(method = '', sourceType = '') {
  if (MODEL_GUIDED_INPUT_METHODS.has(method)) return method;
  return String(sourceType).toLowerCase() === 'local file' ? 'file' : 'example';
}

export function ensureModelGuidedFlowState(model = {}) {
  const hasCurrent = model.guidedFlow && typeof model.guidedFlow === 'object';
  const current = hasCurrent ? model.guidedFlow : {};
  const initialStep = model.buildState === 'success' && model.preview
    ? 'result'
    : 'select_input';
  current.step = normalizeStep(hasCurrent ? current.step : initialStep);
  current.inputMethod = normalizeInputMethod(current.inputMethod, model.sourceType);
  current.resultExpanded = current.resultExpanded === true;
  current.error = typeof current.error === 'string' ? current.error : '';
  model.guidedFlow = current;
  return current;
}

export function resolveModelGuidedStep(model = {}) {
  const flow = ensureModelGuidedFlowState(model);
  if (model.assistant?.phase === 'validating' && flow.step === 'select_input') {
    return 'select_input';
  }
  if (model.buildState === 'validating' || model.buildState === 'building') return 'running';
  if (model.buildState === 'success' && model.preview && flow.step !== 'select_input') return 'result';
  if (!String(model.configText || '').trim() && flow.step !== 'select_input') return 'select_input';
  return flow.step;
}

export function setModelGuidedStep(model = {}, step = 'select_input', options = {}) {
  const flow = ensureModelGuidedFlowState(model);
  flow.step = normalizeStep(step);
  if (options.clearError !== false) flow.error = '';
  if (flow.step !== 'result') flow.resultExpanded = false;
  return flow;
}

export function resetModelGuidedFlow(model = {}) {
  const flow = ensureModelGuidedFlowState(model);
  flow.step = 'select_input';
  flow.resultExpanded = false;
  flow.error = '';
  return flow;
}

export function createModelGuidedStepStates(model = {}) {
  const current = resolveModelGuidedStep(model);
  const currentIndex = MODEL_GUIDED_STEP_IDS.indexOf(current);
  return MODEL_GUIDED_STEP_IDS.map((id, index) => ({
    id,
    state: index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming',
  }));
}

export const MODEL_GUIDED_STEPS = MODEL_GUIDED_STEP_IDS;
