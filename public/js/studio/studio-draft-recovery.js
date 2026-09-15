// Per-tab input recovery only. Preview IDs, job state and generated assets are never persisted.
export const STUDIO_DRAFT_KEY = 'freecad.studio.input-draft.v1';

export function studioSessionStorage(windowLike = globalThis.window) {
  try { return windowLike?.sessionStorage; } catch { return null; }
}

function copyKnownFields(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return;
  for (const key of Object.keys(target)) {
    if (typeof source[key] === typeof target[key] && ['string', 'boolean', 'number'].includes(typeof target[key])) {
      if (typeof source[key] !== 'number' || Number.isFinite(source[key])) target[key] = source[key];
    }
  }
}

export function persistStudioDraft(state, storage = studioSessionStorage()) {
  try {
    if (!storage) return false;
    const model = state.data.model;
    if (!model.configText && !model.promptText) { storage.removeItem(STUDIO_DRAFT_KEY); return true; }
    const draft = {
      version: 1,
      configText: model.configText,
      promptText: model.promptText,
      buildSettings: model.buildSettings,
      reportOptions: model.reportOptions,
      controls: model.controls,
      drawingSettings: state.data.drawing.settings,
    };
    storage.setItem(STUDIO_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch { return false; }
}

export function restoreStudioDraft(state, storage = studioSessionStorage()) {
  try {
    const draft = JSON.parse(storage?.getItem(STUDIO_DRAFT_KEY) || 'null');
    if (draft?.version !== 1 || typeof draft.configText !== 'string') return false;
    const model = state.data.model;
    model.configText = draft.configText;
    model.promptText = typeof draft.promptText === 'string' ? draft.promptText : '';
    model.sourceType = 'session draft';
    model.sourceName = 'Recovered tab draft';
    model.sourcePath = '';
    model.recoveredDraft = true;
    model.editingEnabled = true;
    model.buildSummary = 'Restored input for this tab. Regenerate previews; artifacts were not restored.';
    for (const key of ['buildSettings', 'reportOptions', 'controls']) copyKnownFields(model[key], draft[key]);
    copyKnownFields(state.data.drawing.settings, draft.drawingSettings);
    const views = draft.drawingSettings?.views;
    if (Array.isArray(views) && views.length && views.every((view) => ['front', 'top', 'right', 'iso'].includes(view))) {
      state.data.drawing.settings.views = [...new Set(views)];
    }
    return true;
  } catch { return false; }
}
