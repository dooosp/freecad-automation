import {
  createDrawingRenderer,
  createViewerStore,
} from '../app/index.js';
import {
  deriveDrawingTrackedRunPresentation,
  ensureDrawingTrackedRunState,
  updateDrawingTrackedRunFromJob,
} from './drawing-tracked-runs.js';
import {
  buildDrawingCanvasCaption,
  buildDrawingPreviewReadySummary,
  buildDrawingPreviewResultSummary,
  previewReference,
} from './drawing-preview-copy.js';
import {
  buildTrackedReportJobOptions,
  deriveModelTrackedRunPresentation,
  ensureModelTrackedRunState,
} from './model-tracked-runs.js';
import { applyTranslations, t } from '../i18n/index.js';

function ensureDrawingState(drawing = {}) {
  drawing.status = drawing.status || 'idle';
  drawing.summary = drawing.summary || 'Preview Drawing keeps the sheet-first loop fast, or Run Tracked Draw Job to publish the run.';
  drawing.errorMessage = drawing.errorMessage || '';
  drawing.preview = drawing.preview || null;
  drawing.settings = drawing.settings || {
    views: ['front', 'top', 'right', 'iso'],
    scale: 'auto',
    section_assist: false,
    detail_assist: false,
  };
  drawing.history = Array.isArray(drawing.history) ? drawing.history : [];
  drawing.historyIndex = Number.isInteger(drawing.historyIndex) ? drawing.historyIndex : drawing.history.length - 1;
  ensureDrawingTrackedRunState(drawing);
  return drawing;
}

async function parseError(response) {
  try {
    const payload = await response.json();
    return payload?.error?.messages?.join(' ') || payload?.message || `${response.status}`;
  } catch {
    return `${response.status}`;
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json();
}

function setSurface(surface, label, copy, tone) {
  if (!surface) return;
  surface.dataset.tone = tone;
  const title = surface.querySelector('.model-status-title');
  const body = surface.querySelector('.model-status-copy');
  if (title) title.textContent = label;
  if (body) body.textContent = copy;
}

function renderInfoRows(container, rows = []) {
  if (!container) return;
  container.replaceChildren(
    ...rows.map(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'info-row';

      const title = document.createElement('div');
      title.className = 'info-label';
      title.textContent = label;

      const wrap = document.createElement('div');
      wrap.className = 'info-value-wrap';

      const content = document.createElement('div');
      content.className = 'info-value';
      content.textContent = value;

      wrap.append(content);
      row.append(title, wrap);
      return row;
    })
  );
}

function renderNoteList(container, items = [], emptyCopy) {
  if (!container) return;

  if (!items.length) {
    const note = document.createElement('p');
    note.className = 'inline-note';
    note.textContent = emptyCopy;
    container.replaceChildren(note);
    return;
  }

  container.replaceChildren(
    ...items.map((item) => {
      const block = document.createElement('div');
      block.className = 'list-item';

      const body = document.createElement('div');
      const label = document.createElement('p');
      label.className = 'list-label';
      label.textContent = item.label;
      body.append(label);

      if (item.copy) {
        const copy = document.createElement('p');
        copy.className = 'list-copy';
        copy.textContent = item.copy;
        body.append(copy);
      }

      block.append(body);

      if (item.meta) {
        const meta = document.createElement('span');
        meta.className = 'pill';
        meta.textContent = item.meta;
        block.append(meta);
      }

      return block;
    })
  );
}

function formatNumber(value) {
  return Number.isFinite(value) ? `${value}` : 'Unset';
}

function emptyStateFor(status, errorMessage = '') {
  if (status === 'generating') {
    return {
      title: 'Generating preview drawing',
      copy: 'The studio is running the draw pipeline and preparing the sheet, BOM, and QA sidecars.',
    };
  }
  if (status === 'error') {
    return {
      title: 'Drawing failed',
      copy: errorMessage || 'The last drawing request failed before a sheet could be prepared.',
    };
  }
  return {
    title: 'No drawing yet',
    copy: 'Use Preview Drawing for the fast loop or Run Tracked Draw Job to queue the current TOML and sheet settings.',
  };
}

export function mountDrawingWorkspace({
  root,
  state,
  addLog,
  navigateTo,
  openJob,
  loadSelectedExampleIntoSharedModel,
  loadConfigFileIntoSharedModel,
  submitTrackedJob,
}) {
  let drawing = ensureDrawingState(state.data.drawing);
  const viewerStore = createViewerStore();
  viewerStore.state.dimensions.history = structuredClone(drawing.history);
  viewerStore.state.dimensions.index = drawing.historyIndex;

  const runtimeSurface = root.querySelector('[data-hook="drawing-runtime-surface"]');
  const sourceSurface = root.querySelector('[data-hook="drawing-source-surface"]');
  const jobSurface = root.querySelector('[data-hook="drawing-job-surface"]');
  const resultSurface = root.querySelector('[data-hook="drawing-result-surface"]');
  const sourceSummaryElement = root.querySelector('[data-hook="drawing-source-summary"]');
  const summaryElement = root.querySelector('[data-hook="drawing-summary"]');
  const emptyElement = root.querySelector('[data-hook="drawing-empty"]');
  const canvasElement = root.querySelector('[data-hook="drawing-canvas"]');
  const canvasCaptionElement = root.querySelector('[data-hook="drawing-canvas-caption"]');
  const bomElement = root.querySelector('[data-hook="drawing-bom"]');
  const annotationsElement = root.querySelector('[data-hook="drawing-annotations"]');
  const qaElement = root.querySelector('[data-hook="drawing-qa"]');
  const dimensionsElement = root.querySelector('[data-hook="drawing-dimensions"]');
  const historyElement = root.querySelector('[data-hook="drawing-history"]');
  const zoomLabelElement = root.querySelector('[data-hook="drawing-zoom-label"]');
  const viewInputs = [...root.querySelectorAll('[data-hook="drawing-view"]')];
  const scaleSelect = root.querySelector('[data-hook="drawing-scale"]');
  const sectionAssistInput = root.querySelector('[data-hook="drawing-section-assist"]');
  const detailAssistInput = root.querySelector('[data-hook="drawing-detail-assist"]');
  const loadExampleButton = root.querySelector('[data-action="drawing-load-example"]');
  const generateButton = root.querySelector('[data-hook="drawing-generate"]');
  const trackedRunButton = root.querySelector('[data-hook="drawing-tracked-run"]');
  const trackedStatusElement = root.querySelector('[data-hook="drawing-tracked-status"]');
  const reportActionElement = root.querySelector('[data-hook="drawing-report-action"]');
  const reportButton = root.querySelector('[data-hook="drawing-report"]');
  const reportStatusElement = root.querySelector('[data-hook="drawing-report-status"]');
  const configFileInput = root.querySelector('[data-hook="drawing-config-file"]');

  let destroyed = false;
  let renderedSignature = '';
  let drawingRenderer = null;
  let reportSubmitting = false;

  function currentModel() {
    return ensureModelTrackedRunState(state.data.model);
  }

  function syncDrawingReference() {
    const nextDrawing = ensureDrawingState(state.data.drawing);
    if (nextDrawing === drawing) return;
    drawing = nextDrawing;
    viewerStore.state.dimensions.history = structuredClone(drawing.history);
    viewerStore.state.dimensions.index = drawing.historyIndex;
    renderedSignature = '';
  }

  function reportPresentation() {
    const model = currentModel();
    if (model.trackedRun.type !== 'report') {
      return { status: 'idle', job: null };
    }
    return deriveModelTrackedRunPresentation({
      model,
      recentJobs: state.data.recentJobs.items || [],
      jobMonitor: state.data.jobMonitor || {},
    });
  }

  function reportRunIsActive() {
    return ['submitting', 'queued', 'running'].includes(reportPresentation().status);
  }

  function setPrimaryActionState(button, primary) {
    if (!button) return;
    button.classList.toggle('action-button-primary', primary);
    button.classList.toggle('action-button-ghost', !primary);
    button.dataset.actionKind = primary ? 'primary' : 'secondary';
  }

  function syncSettingsFromControls() {
    const views = viewInputs
      .filter((input) => input.checked)
      .map((input) => input.dataset.view)
      .filter(Boolean);
    drawing.settings = {
      views: views.length > 0 ? views : ['front', 'top', 'right', 'iso'],
      scale: scaleSelect?.value || 'auto',
      section_assist: Boolean(sectionAssistInput?.checked),
      detail_assist: Boolean(detailAssistInput?.checked),
    };
  }

  function syncControls() {
    const apiReady = state.connectionState === 'connected';
    const runtimeReady = state.data.health.available === true;
    const hasConfig = Boolean(String(state.data.model.configText || '').trim());
    const canPreview = apiReady && runtimeReady && hasConfig && drawing.status !== 'generating';
    const canRunTracked = canPreview && drawing.trackedRun.submitting !== true;
    const hasPreview = drawing.status === 'ready' && Boolean(drawing.preview?.svg);
    const canRunReport = apiReady
      && runtimeReady
      && hasConfig
      && hasPreview
      && !reportSubmitting
      && !reportRunIsActive();

    const views = new Set(drawing.settings.views || []);
    viewInputs.forEach((input) => {
      input.checked = views.has(input.dataset.view);
    });
    if (scaleSelect) scaleSelect.value = drawing.settings.scale || 'auto';
    if (sectionAssistInput) sectionAssistInput.checked = drawing.settings.section_assist === true;
    if (detailAssistInput) detailAssistInput.checked = drawing.settings.detail_assist === true;
    setPrimaryActionState(loadExampleButton, !hasConfig);
    setPrimaryActionState(generateButton, hasConfig && !hasPreview);
    if (generateButton) generateButton.disabled = !canPreview;
    if (trackedRunButton) trackedRunButton.disabled = !canRunTracked;
    if (reportActionElement) reportActionElement.hidden = !hasPreview;
    if (reportButton) reportButton.disabled = !canRunReport;
  }

  function syncReportStatus() {
    if (!reportStatusElement) return;
    const model = currentModel();
    const presentation = reportPresentation();
    const jobId = presentation.job?.id || model.trackedRun.lastJobId || '';
    const shortJobId = jobId ? jobId.slice(0, 8) : '';

    if (model.trackedRun.type === 'report' && model.trackedRun.error) {
      reportStatusElement.textContent = t('studio.drawing.report.status.failed', {
        message: model.trackedRun.error,
      });
      reportStatusElement.dataset.tone = 'bad';
      return;
    }

    const statusKey = ['submitting', 'queued', 'running', 'succeeded', 'failed'].includes(presentation.status)
      ? presentation.status
      : 'idle';
    reportStatusElement.textContent = statusKey === 'failed'
      ? t('studio.drawing.report.status.job-failed', { job: shortJobId })
      : t(`studio.drawing.report.status.${statusKey}`, { job: shortJobId });
    reportStatusElement.dataset.tone = statusKey === 'failed'
      ? 'bad'
      : statusKey === 'succeeded'
        ? 'ok'
        : ['submitting', 'queued', 'running'].includes(statusKey)
          ? 'warn'
          : 'info';
  }

  function syncSourceSummary() {
    renderInfoRows(sourceSummaryElement, [
      ['Source', state.data.model.sourceType || 'Not loaded'],
      ['Name', state.data.model.sourceName || 'Untitled config'],
      ['Reference', state.data.model.sourcePath || 'In-memory draft'],
      ['Config', state.data.model.configText?.trim() ? 'Ready for drawing' : 'Load or generate a config first'],
    ]);
  }

  function syncStatusSurfaces() {
    const runtimeAvailable = state.data.health.status === 'ready' && state.data.health.available;
    const hasConfig = Boolean(state.data.model.configText?.trim());
    const ready = drawing.status === 'ready' && drawing.preview?.svg;
    const tone = ready ? 'ok' : drawing.status === 'error' ? 'bad' : drawing.status === 'generating' ? 'warn' : 'info';

    setSurface(
      sourceSurface,
      hasConfig ? 'Config ready' : 'Config pending',
      hasConfig
        ? 'This workspace can generate sheets directly from the shared config state.'
        : 'Load an example or config here before generating a drawing.',
      hasConfig ? 'ok' : 'warn',
    );
    setSurface(
      runtimeSurface,
      runtimeAvailable ? 'Runtime ready' : state.connectionState === 'legacy' ? 'Legacy-only path' : 'Runtime check required',
      runtimeAvailable
        ? (state.data.health.runtimeSummary || 'FreeCAD-backed drawing runtime is available.')
        : (state.data.health.fallbackMessage || 'Drawing generation needs a serve path with runtime connected.'),
      runtimeAvailable ? 'ok' : 'warn',
    );
    setSurface(
      jobSurface,
      drawing.status === 'generating' ? 'Generating' : ready ? 'Drawing ready' : drawing.status === 'error' ? 'Drawing failed' : 'No drawing yet',
      drawing.summary || 'Preview Drawing iterates locally, while tracked drawing uses the shell monitor and recent jobs list.',
      tone,
    );
    setSurface(
      resultSurface,
      ready ? 'Sheet ready' : drawing.status === 'error' ? 'Last run failed' : 'Sheet pending',
      ready
        ? buildDrawingPreviewResultSummary(drawing.preview, drawing.settings)
        : (drawing.errorMessage || 'BOM, annotations, QA, and dimension status summarize here after the first render.'),
      tone,
    );
  }

  function syncEmptyState() {
    if (!emptyElement) return;
    const hasPreview = Boolean(drawing.preview?.svg);
    emptyElement.hidden = hasPreview;
    if (hasPreview) return;

    const next = emptyStateFor(drawing.status, drawing.errorMessage);
    const title = emptyElement.querySelector('h3');
    const copy = emptyElement.querySelector('p');
    if (title) title.textContent = next.title;
    if (copy) copy.textContent = next.copy;
  }

  function syncCanvas() {
    const preview = drawing.preview;
    const showPreview = Boolean(preview?.svg);
    const nextSignature = showPreview ? `${preview.id}:${preview.drawn_at}` : '';

    if (!showPreview) {
      renderedSignature = '';
      canvasElement.replaceChildren();
      bomElement.replaceChildren();
      if (canvasCaptionElement) {
        canvasCaptionElement.textContent = drawing.status === 'error'
          ? (drawing.errorMessage || 'The last drawing request failed before the sheet was ready.')
          : 'Drag to pan, use the mouse wheel to zoom, and click dimension text to keep the edit loop on the sheet.';
      }
      return;
    }

    if (canvasCaptionElement) {
      canvasCaptionElement.textContent = buildDrawingCanvasCaption(preview);
    }

    if (drawingRenderer && renderedSignature !== nextSignature) {
      drawingRenderer.showDrawing(preview.svg, preview.bom || [], preview.scale || drawing.settings.scale, previewReference(preview));
      renderedSignature = nextSignature;
    }
  }

  function syncAnnotations() {
    renderNoteList(
      annotationsElement,
      (drawing.preview?.annotations || []).map((note) => ({ label: note })),
      'Drawing notes, plan callouts, and annotation summaries will appear here after a sheet is ready.'
    );
  }

  function syncQa() {
    const qaSummary = drawing.preview?.qa_summary;
    if (!qaSummary) {
      const note = document.createElement('p');
      note.className = 'inline-note';
      note.textContent = 'QA score and dimension status will appear here after drawing generation.';
      qaElement.replaceChildren(note);
      return;
    }

    renderInfoRows(qaElement, [
      ['QA score', qaSummary.score == null ? 'Unavailable' : `${qaSummary.score}/100`],
      ['Weight profile', qaSummary.weight_profile || 'default'],
      ['Planned dimensions', qaSummary.planned_dimension_count == null ? 'Unavailable' : String(qaSummary.planned_dimension_count)],
      ['Rendered dimensions', qaSummary.rendered_dimension_count == null ? 'Unavailable' : String(qaSummary.rendered_dimension_count)],
      ['Conflicts', qaSummary.conflict_count == null ? 'Unavailable' : String(qaSummary.conflict_count)],
    ]);
  }

  async function updateDimension({ dimId, valueMm, historyOp = 'edit' }) {
    const previewId = drawing.preview?.id;
    if (!previewId) return;

    drawing.status = 'generating';
    drawing.errorMessage = '';
    drawing.summary = `Applying ${dimId} and regenerating the sheet...`;
    syncAll();

    try {
      const payload = await postJson(`/api/studio/drawing-previews/${previewId}/dimensions`, {
        dim_id: dimId,
        value_mm: valueMm,
        history_op: historyOp,
      });
      drawingRenderer?.handleDimensionUpdated(payload.update);
      drawing.status = 'ready';
      drawing.errorMessage = '';
      drawing.preview = payload.preview;
      drawing.summary = `Updated ${payload.update.dim_id}. ${buildDrawingPreviewReadySummary(payload.preview, drawing.settings)}`;
      addLog({
        status: 'Drawing',
        message: `${payload.update.history_op === 'edit' ? 'Updated' : payload.update.history_op === 'undo' ? 'Undid' : 'Redid'} ${payload.update.dim_id} in the sheet-first workbench.`,
        tone: 'ok',
        time: 'drawing',
      });
      syncAll();
    } catch (error) {
      drawing.errorMessage = error instanceof Error ? error.message : String(error);
      drawing.summary = drawing.errorMessage;
      drawingRenderer?.clearPendingEdit();
      addLog({
        status: 'Drawing',
        message: drawing.errorMessage,
        tone: 'warn',
        time: 'drawing',
      });
      syncAll();
    }
  }

  function syncDimensions() {
    const dimensions = drawing.preview?.dimensions || [];
    if (!dimensions.length) {
      const note = document.createElement('p');
      note.className = 'inline-note';
      note.textContent = drawing.preview
        ? drawing.preview.editable_plan_available
          ? 'No editable dimension intent was found for this sheet.'
          : 'No editable preview plan is available, so this sheet remains preview-only.'
        : 'Generate a drawing to populate editable dimensions here.';
      dimensionsElement.replaceChildren(note);
      return;
    }

    dimensionsElement.replaceChildren(
      ...dimensions.map((dimension) => {
        const card = document.createElement('div');
        card.className = 'drawing-dimension-row';

        const copy = document.createElement('div');
        copy.className = 'drawing-dimension-copy';

        const label = document.createElement('p');
        label.className = 'list-label';
        label.textContent = dimension.id || 'Unnamed dimension';

        const meta = document.createElement('p');
        meta.className = 'list-copy';
        meta.textContent = `${dimension.feature || 'No feature tag'}${dimension.required ? ' · required' : ''}`;

        copy.append(label, meta);

        const controls = document.createElement('div');
        controls.className = 'drawing-dimension-controls';

        const input = document.createElement('input');
        input.className = 'studio-textarea drawing-dimension-input';
        input.type = 'number';
        input.step = '0.1';
        input.min = '0.01';
        input.value = formatNumber(dimension.value_mm);
        input.dataset.dimId = dimension.id;

        const applyButton = document.createElement('button');
        applyButton.className = 'action-button action-button-ghost';
        applyButton.type = 'button';
        applyButton.textContent = 'Apply';
        applyButton.dataset.action = 'drawing-apply-dimension';
        applyButton.dataset.dimId = dimension.id;

        controls.append(input, applyButton);
        card.append(copy, controls);
        return card;
      })
    );
  }

  function syncHistory() {
    drawing.history = structuredClone(viewerStore.state.dimensions.history);
    drawing.historyIndex = viewerStore.state.dimensions.index;

    if (!drawing.history.length) {
      const note = document.createElement('p');
      note.className = 'inline-note';
      note.textContent = 'Changes made on the sheet or dimension list will be recorded here.';
      historyElement.replaceChildren(note);
      return;
    }

    renderNoteList(
      historyElement,
      drawing.history
        .slice()
        .reverse()
        .map((entry, index) => ({
          label: `${entry.dimId}: ${entry.oldValue} -> ${entry.newValue}`,
          meta: index === 0 ? 'Latest' : `${drawing.history.length - index}`,
        })),
      'Dimension history will appear here after the first change.'
    );
  }

  function syncSummary() {
    summaryElement.textContent = drawing.summary || 'Iterate quickly with Preview Drawing, or publish results with a tracked drawing run.';
  }

  function syncTrackedStatus() {
    if (!trackedStatusElement) return;

    const presentation = deriveDrawingTrackedRunPresentation({
      drawing,
      recentJobs: state.data.recentJobs.items || [],
      jobMonitor: state.data.jobMonitor || {},
    });
    const trackedSettings = drawing.trackedRun.submittedDrawingSettings || drawing.settings;

    const rows = [
      ['Tracked status', presentation.title],
      ['Execution', presentation.copy],
      ['Tracked settings', `${(trackedSettings.views || []).join(', ') || 'front, top, right, iso'} • scale ${trackedSettings.scale || 'auto'} • section ${trackedSettings.section_assist ? 'on' : 'off'} • detail ${trackedSettings.detail_assist ? 'on' : 'off'}`],
      ['Tracked draw handoff', presentation.previewPlanCopy],
    ];

    if (presentation.meta) {
      rows.splice(1, 0, ['Tracked job', presentation.meta]);
    }

    trackedStatusElement.replaceChildren(
      ...rows.map(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'info-row';

        const title = document.createElement('div');
        title.className = 'info-label';
        title.textContent = label;

        const wrap = document.createElement('div');
        wrap.className = 'info-value-wrap';

        const content = document.createElement('div');
        content.className = 'info-value';
        content.textContent = value;

        wrap.append(content);
        row.append(title, wrap);
        return row;
      })
    );

    if (presentation.canOpenArtifacts && presentation.job?.id) {
      const actions = document.createElement('div');
      actions.className = 'model-action-row';

      const button = document.createElement('button');
      button.className = 'action-button action-button-ghost';
      button.type = 'button';
      button.textContent = 'Open artifacts';
      button.dataset.action = 'drawing-open-tracked-artifacts';
      button.dataset.jobId = presentation.job.id;

      actions.append(button);
      trackedStatusElement.append(actions);
    }
  }

  function syncAll() {
    if (destroyed) return;
    syncDrawingReference();
    syncControls();
    syncSourceSummary();
    syncStatusSurfaces();
    syncSummary();
    syncEmptyState();
    syncCanvas();
    syncAnnotations();
    syncQa();
    syncDimensions();
    syncHistory();
    syncTrackedStatus();
    syncReportStatus();
    applyTranslations(root);
  }

  async function generateDrawing() {
    const configToml = String(state.data.model.configText || '').trim();
    if (!configToml) {
      drawing.status = 'error';
      drawing.errorMessage = 'Load an example or open a config before generating a drawing.';
      drawing.summary = drawing.errorMessage;
      syncAll();
      return;
    }

    syncSettingsFromControls();
    drawing.status = 'generating';
    drawing.errorMessage = '';
    drawing.summary = 'Generating drawing, sheet QA, and drawing-sidecar data...';
    syncAll();

    try {
      const payload = await postJson('/api/studio/drawing-preview', {
        config_toml: configToml,
        drawing_settings: drawing.settings,
      });
      drawing.status = 'ready';
      drawing.preview = payload.preview;
      drawing.summary = buildDrawingPreviewReadySummary(payload.preview, drawing.settings);
      addLog({
        status: 'Drawing',
        message: `Generated a sheet for ${payload.preview.overview?.name || state.data.model.sourceName || 'the active config'} inside the dedicated Drawing workspace.`,
        tone: 'ok',
        time: 'drawing',
      });
      syncAll();
      reportButton?.focus();
      requestAnimationFrame(() => reportButton?.focus());
    } catch (error) {
      drawing.status = 'error';
      drawing.errorMessage = error instanceof Error ? error.message : String(error);
      drawing.summary = drawing.errorMessage;
      addLog({
        status: 'Drawing',
        message: drawing.errorMessage,
        tone: 'warn',
        time: 'drawing',
      });
      syncAll();
    }
  }

  async function runTrackedDraw() {
    const configToml = String(state.data.model.configText || '').trim();
    if (!configToml) {
      drawing.errorMessage = 'Load an example or open a config before starting a tracked draw.';
      drawing.summary = drawing.errorMessage;
      syncAll();
      return;
    }

    syncSettingsFromControls();
    drawing.trackedRun.submitting = true;
    drawing.trackedRun.error = '';
    drawing.summary = 'Submitting tracked draw while keeping the preview sheet available.';
    syncAll();

    try {
      const job = await submitTrackedJob({
        type: 'draw',
        configToml,
        drawingSettings: drawing.settings,
        drawingPreviewId: drawing.preview?.id || '',
        completionAction: {
          type: 'open-artifacts-on-success',
          route: 'artifacts',
        },
      });
      updateDrawingTrackedRunFromJob(drawing, job);
      drawing.errorMessage = '';
      drawing.summary = drawing.trackedRun.preservedEditedPreview
        ? 'Tracked draw queued with the edited preview plan preserved. Preview sheet stays available while the job runs.'
        : 'Tracked draw queued with the current TOML and drawing settings. Preview sheet stays available while the job runs.';
      addLog({
        status: 'Drawing',
        message: drawing.trackedRun.preservedEditedPreview
          ? `Queued tracked draw for ${state.data.model.sourceName || 'the active config'} with edited preview intent preserved.`
          : `Queued tracked draw for ${state.data.model.sourceName || 'the active config'} with the current sheet settings.`,
        tone: 'info',
        time: 'job',
      });
      syncAll();
    } catch (error) {
      drawing.trackedRun.submitting = false;
      drawing.trackedRun.error = error instanceof Error ? error.message : String(error);
      drawing.errorMessage = error instanceof Error ? error.message : String(error);
      drawing.summary = `Tracked draw could not be queued: ${drawing.errorMessage}`;
      addLog({
        status: 'Drawing',
        message: drawing.summary,
        tone: 'warn',
        time: 'job',
      });
      syncAll();
    }
  }

  async function runTrackedReport() {
    const model = currentModel();
    const configToml = String(model.configText || '').trim();
    if (
      reportSubmitting
      || reportRunIsActive()
      || !configToml
      || drawing.status !== 'ready'
      || !drawing.preview?.svg
    ) return;

    reportSubmitting = true;
    model.trackedRun = {
      type: 'report',
      lastJobId: '',
      status: 'submitting',
      submitting: true,
      error: '',
    };
    syncAll();

    try {
      const job = await submitTrackedJob({
        type: 'report',
        configToml,
        options: buildTrackedReportJobOptions({
          ...model.reportOptions,
          includeDrawing: true,
        }),
      });
      model.trackedRun = {
        type: 'report',
        lastJobId: job.id,
        status: job.status,
        submitting: false,
        error: '',
      };
      addLog({
        status: 'Drawing',
        message: `Queued a tracked report for ${model.sourceName || 'the active config'} after checking the drawing preview.`,
        tone: 'info',
        time: 'job',
      });
    } catch (error) {
      model.trackedRun = {
        ...model.trackedRun,
        submitting: false,
        error: error instanceof Error ? error.message : String(error),
      };
      addLog({
        status: 'Drawing',
        message: model.trackedRun.error,
        tone: 'warn',
        time: 'job',
      });
    } finally {
      reportSubmitting = false;
      syncAll();
    }
  }

  function handleClick(event) {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!target) return;

    if (target.dataset.action === 'drawing-generate') {
      generateDrawing();
      return;
    }

    if (target.dataset.action === 'drawing-run-tracked') {
      runTrackedDraw();
      return;
    }

    if (target.dataset.action === 'drawing-run-report') {
      runTrackedReport();
      return;
    }

    if (target.dataset.action === 'drawing-open-tracked-artifacts' && target.dataset.jobId) {
      openJob(target.dataset.jobId, { route: 'artifacts' });
      return;
    }

    if (target.dataset.action === 'drawing-load-example') {
      loadSelectedExampleIntoSharedModel();
      syncAll();
      return;
    }

    if (target.dataset.action === 'drawing-open-config') {
      configFileInput?.click();
      return;
    }

    if (target.dataset.action === 'drawing-open-model') {
      navigateTo('model', { pendingFocus: 'config' });
      return;
    }

    if (target.dataset.action === 'drawing-fit') {
      drawingRenderer?.fitDrawing();
      return;
    }

    if (target.dataset.action === 'drawing-apply-dimension') {
      const dimId = target.dataset.dimId;
      const input = dimensionsElement.querySelector(`input[data-dim-id="${CSS.escape(dimId)}"]`);
      const valueMm = Number.parseFloat(input?.value || '');
      if (!dimId || Number.isNaN(valueMm)) {
        drawing.errorMessage = 'Enter a valid positive dimension value before applying.';
        drawing.summary = drawing.errorMessage;
        syncAll();
        return;
      }
      updateDimension({ dimId, valueMm, historyOp: 'edit' });
    }
  }

  async function handleChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target === configFileInput) {
      const [file] = [...(configFileInput.files || [])];
      if (file) {
        await loadConfigFileIntoSharedModel(file);
        syncAll();
        configFileInput.value = '';
      }
      return;
    }

    if (target.matches('[data-hook="drawing-view"], [data-hook="drawing-scale"], [data-hook="drawing-section-assist"], [data-hook="drawing-detail-assist"]')) {
      syncSettingsFromControls();
      syncSummary();
    }
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('change', handleChange);

  drawingRenderer = createDrawingRenderer({
    state: viewerStore.state,
    drawingOverlayElement: root.querySelector('[data-hook="drawing-stage"]'),
    drawingContainerElement: canvasElement,
    drawingBomElement: bomElement,
    drawZoomLabelElement: zoomLabelElement,
    closeButton: null,
    zoomInButton: root.querySelector('[data-hook="drawing-zoom-in"]'),
    zoomOutButton: root.querySelector('[data-hook="drawing-zoom-out"]'),
    fitButton: root.querySelector('[data-hook="drawing-fit"]'),
    onStatus(message, tone = 'info') {
      drawing.summary = message;
      if (tone === 'error') {
        drawing.errorMessage = message;
      }
      syncSummary();
    },
    sendDimensionUpdate(payload) {
      updateDimension({
        dimId: payload.dimId,
        valueMm: payload.valueMm,
        historyOp: payload.historyOp || 'edit',
      });
    },
    getConfigToml() {
      return state.data.model.configText || '';
    },
    onDrawingStateChange({ dimensions }) {
      viewerStore.state.dimensions.history = dimensions.history;
      viewerStore.state.dimensions.index = dimensions.index;
      syncHistory();
    },
  });

  root.dataset.drawingWorkspaceMounted = 'true';
  syncAll();

  return {
    syncFromShell() {
      syncAll();
    },
    destroy() {
      destroyed = true;
      delete root.dataset.drawingWorkspaceMounted;
      drawingRenderer?.destroy?.();
      root.removeEventListener('click', handleClick);
      root.removeEventListener('change', handleChange);
    },
  };
}
