import { deriveModelTrackedRunPresentation } from './model-tracked-runs.js';

export function isModelPreviewStale(model = {}) {
  return Boolean(model.preview)
    && ((typeof model.previewConfigText === 'string' && model.previewConfigText !== model.configText)
      || (Boolean(model.previewBuildSettings) && JSON.stringify(model.previewBuildSettings) !== JSON.stringify(model.buildSettings)));
}

export function modelWorkspaceBadges(state) {
  const model = state.data.model;
  const tracked = deriveModelTrackedRunPresentation({
    model,
    recentJobs: state.data.recentJobs.items || [],
    jobMonitor: state.data.jobMonitor || {},
  });
  const preview = {
    validating: { label: 'Preview validating', tone: 'info' },
    building: { label: 'Preview building', tone: 'warn' },
    success: { label: 'Preview ready', tone: 'ok' },
    error: { label: 'Preview failed', tone: 'bad' },
  }[model.buildState] || (model.preview
    ? { label: 'Preview ready', tone: 'ok' }
    : { label: 'Preview idle', tone: 'info' });
  if (isModelPreviewStale(model) && !['validating', 'building', 'error'].includes(model.buildState)) {
    preview.label = 'Preview needs rebuild';
    preview.tone = 'warn';
  }
  return [
    { label: model.configText?.trim() ? 'Input loaded' : 'Input pending', tone: model.configText?.trim() ? 'ok' : 'warn' },
    preview,
    { label: tracked.badgeLabel, tone: tracked.tone },
  ];
}

export function drawingInputSnapshot(model = {}, settings = {}) {
  return JSON.stringify([model.sourceType || '', model.sourcePath || '', model.sourceName || '', String(model.configText || '').trim(), settings]);
}

export function isDrawingPreviewStale(drawing = {}, model = {}) {
  return Boolean(drawing.preview) && drawing.previewInputSnapshot !== drawingInputSnapshot(model, drawing.settings);
}

export const STALE_DRAWING_COPY = 'Input or sheet settings changed. Regenerate the drawing before reviewing or saving it.';

export function drawingWorkspaceBadges(state) {
  const drawing = state.data.drawing;
  const hasConfig = Boolean(state.data.model.configText?.trim());
  return [
    { label: hasConfig ? 'Config loaded' : 'Config needed', tone: hasConfig ? 'ok' : 'warn' },
    {
      label: isDrawingPreviewStale(drawing, state.data.model) ? 'Drawing needs regeneration' : `Drawing ${drawing.status === 'ready' ? 'ready' : drawing.status === 'error' ? 'error' : drawing.status === 'generating' ? 'generating' : 'pending'}`,
      tone: isDrawingPreviewStale(drawing, state.data.model) ? 'warn' : drawing.status === 'ready' ? 'ok' : drawing.status === 'error' ? 'bad' : drawing.status === 'generating' ? 'warn' : 'info',
    },
  ];
}

export function workingConfigRows(model = {}) {
  return [
    ['Working config', model.configText?.trim() ? (model.overview?.name || 'Pending validation') : 'Not loaded'],
    ['Loaded from', model.sourceName || 'In-memory draft'],
    ...(model.recoveredDraft ? [['Draft recovery', 'Restored input for this tab. Regenerate previews; artifacts were not restored.']] : []),
  ];
}

export function drawingWorkspaceSummary(drawing = {}, model) {
  if (model && isDrawingPreviewStale(drawing, model)) return STALE_DRAWING_COPY;
  if (drawing.errorMessage) return drawing.errorMessage;
  return drawing.status === 'ready' && drawing.preview && !drawing.trackedRun?.submitting
    ? 'Drawing ready. Review dimensions before saving.'
    : drawing.summary || 'Load a config, then preview the drawing.';
}
