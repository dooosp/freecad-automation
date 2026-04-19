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
import { applyTranslations } from '../i18n/index.js';

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
  const drawing = ensureDrawingState(state.data.drawing);
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
  const generateButton = root.querySelector('[data-hook="drawing-generate"]');
  const trackedRunButton = root.querySelector('[data-hook="drawing-tracked-run"]');
  const trackedStatusElement = root.querySelector('[data-hook="drawing-tracked-status"]');
  const configFileInput = root.querySelector('[data-hook="drawing-config-file"]');

  let destroyed = false;
  let renderedSignature = '';
  let drawingRenderer = null;

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

    const views = new Set(drawing.settings.views || []);
    viewInputs.forEach((input) => {
      input.checked = views.has(input.dataset.view);
    });
    if (scaleSelect) scaleSelect.value = drawing.settings.scale || 'auto';
    if (sectionAssistInput) sectionAssistInput.checked = drawing.settings.section_assist === true;
    if (detailAssistInput) detailAssistInput.checked = drawing.settings.detail_assist === true;
    if (generateButton) generateButton.disabled = !canPreview;
    if (trackedRunButton) trackedRunButton.disabled = !canRunTracked;
  }

  function syncSourceSummary() {
    renderInfoRows(sourceSummaryElement, [
      ['소스', state.data.model.sourceType || '로드되지 않음'],
      ['이름', state.data.model.sourceName || '제목 없는 설정'],
      ['참조', state.data.model.sourcePath || '메모리 초안'],
      ['설정', state.data.model.configText?.trim() ? '도면 생성 준비됨' : '먼저 설정을 불러오거나 생성하세요'],
    ]);
  }

  function syncStatusSurfaces() {
    const runtimeAvailable = state.data.health.status === 'ready' && state.data.health.available;
    const hasConfig = Boolean(state.data.model.configText?.trim());
    const ready = drawing.status === 'ready' && drawing.preview?.svg;
    const tone = ready ? 'ok' : drawing.status === 'error' ? 'bad' : drawing.status === 'generating' ? 'warn' : 'info';

    setSurface(
      sourceSurface,
      hasConfig ? '설정 준비됨' : '설정 대기 중',
      hasConfig
        ? '이 작업 영역은 공유된 설정 상태에서 바로 시트를 생성할 수 있습니다.'
        : '도면을 생성하기 전에 여기서 예제나 설정을 불러오세요.',
      hasConfig ? 'ok' : 'warn',
    );
    setSurface(
      runtimeSurface,
      runtimeAvailable ? '런타임 준비됨' : state.connectionState === 'legacy' ? '레거시 전용 경로' : '런타임 확인 필요',
      runtimeAvailable
        ? (state.data.health.runtimeSummary || 'FreeCAD 기반 도면 런타임을 사용할 수 있습니다.')
        : (state.data.health.fallbackMessage || '도면 생성에는 런타임이 연결된 serve 경로가 필요합니다.'),
      runtimeAvailable ? 'ok' : 'warn',
    );
    setSurface(
      jobSurface,
      drawing.status === 'generating' ? '생성 중' : ready ? '도면 준비됨' : drawing.status === 'error' ? '도면 생성 실패' : '아직 도면이 없습니다',
      drawing.summary || 'Preview Drawing은 로컬에서 빠르게 동작하고, 추적 도면은 셸 모니터와 최근 작업 목록을 사용합니다.',
      tone,
    );
    setSurface(
      resultSurface,
      ready ? '시트 준비됨' : drawing.status === 'error' ? '마지막 실행 실패' : '시트 준비 대기',
      ready
        ? buildDrawingPreviewResultSummary(drawing.preview, drawing.settings)
        : (drawing.errorMessage || '첫 렌더링 이후 BOM, 주석, QA, 치수 상태가 여기에 요약됩니다.'),
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
          ? (drawing.errorMessage || '마지막 도면 요청이 시트를 준비하기 전에 실패했습니다.')
          : '드래그로 이동하고, 마우스 휠로 확대/축소하고, 치수 텍스트를 클릭해 편집 루프를 시트에 붙여 두세요.';
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
      note.textContent = '도면 생성 후 QA 점수와 치수 상태가 여기에 표시됩니다.';
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
          ? '이 시트에서는 편집 가능한 치수 의도를 찾지 못했습니다.'
          : '편집 가능한 미리보기 계획이 없어 이 시트는 미리보기 전용으로 유지됩니다.'
        : '도면을 생성하면 편집 가능한 치수 목록이 여기에 채워집니다.';
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
      note.textContent = '시트나 치수 목록에서 변경한 내용이 여기에 기록됩니다.';
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
    summaryElement.textContent = drawing.summary || 'Preview Drawing으로 빠르게 반복하거나, 추적 도면 실행으로 결과를 게시하세요.';
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

  syncAll();

  return {
    syncFromShell() {
      syncAll();
    },
    destroy() {
      destroyed = true;
      drawingRenderer?.destroy?.();
      root.removeEventListener('click', handleClick);
      root.removeEventListener('change', handleChange);
    },
  };
}
