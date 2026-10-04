import { invalidateAiDraftValidation } from './ai-guided-flow.js';
import { setModelGuidedStep } from './model-guided-flow.js';
import { createStudioShellState } from './studio-shell-store.js';

export function installModelParameterConfig(state, { expectedConfigText, configText } = {}) {
  const model = state?.data?.model;
  if (!model || typeof expectedConfigText !== 'string' || model.configText !== expectedConfigText
    || typeof configText !== 'string' || !configText.trim() || configText === model.configText) {
    return false;
  }

  const defaults = createStudioShellState().data;
  const nextModel = {
    ...model,
    configText,
    editingEnabled: true,
    buildState: defaults.model.buildState,
    buildSummary: defaults.model.buildSummary,
    errorMessage: defaults.model.errorMessage,
    buildLog: defaults.model.buildLog,
    validation: defaults.model.validation,
    overview: null,
    preview: null,
    previewConfigText: '',
    previewBuildSettings: null,
    activePreviewRequest: null,
    activeTrackedSubmission: null,
    trackedRun: defaults.model.trackedRun,
    assistant: defaults.model.assistant,
    guidedFlow: model.guidedFlow ? { ...model.guidedFlow } : undefined,
  };
  setModelGuidedStep(nextModel, 'preflight');
  invalidateAiDraftValidation(nextModel);
  const nextDrawing = {
    ...defaults.drawing,
    settings: structuredClone(state.data.drawing?.settings || defaults.drawing.settings),
  };

  // Keep the mounted Model controller's object while retiring all old request owners.
  Object.assign(model, nextModel);
  state.data.drawing = nextDrawing;
  return true;
}
