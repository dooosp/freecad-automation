import {
  createAnimationController,
  createViewerStore,
  initScene,
  renderModelInfo,
} from '../app/index.js';
import { listStudioConfigProfiles } from './config-client.js';
import {
  buildTrackedReportJobOptions,
  collectValidationNotes,
  deriveModelTrackedRunPresentation,
  ensureModelTrackedRunState,
  resetModelTrackedRunState,
} from './model-tracked-runs.js';

function ensureModelState(model = {}) {
  model.validation = model.validation || {
    warnings: [],
    changed_fields: [],
    deprecated_fields: [],
  };
  model.overview = model.overview || null;
  model.preview = model.preview || null;
  model.buildLog = Array.isArray(model.buildLog) ? model.buildLog : [];
  model.buildState = model.buildState || 'idle';
  model.buildSummary = model.buildSummary || 'Choose input, then build to inspect the preview.';
  model.errorMessage = model.errorMessage || '';
  model.assistant = model.assistant || {
    busy: false,
    error: '',
    report: null,
  };
  ensureModelTrackedRunState(model);
  model.buildSettings = model.buildSettings || {
    include_step: true,
    include_stl: true,
    per_part_stl: true,
  };
  model.controls = model.controls || {
    wireframe: false,
    edges: true,
    opacity: 100,
  };
  return model;
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

function textForState(buildState) {
  switch (buildState) {
    case 'validating':
      return { label: 'Validating', tone: 'info' };
    case 'building':
      return { label: 'Building', tone: 'warn' };
    case 'success':
      return { label: 'Ready', tone: 'ok' };
    case 'error':
      return { label: 'Needs attention', tone: 'bad' };
    default:
      return { label: 'Idle', tone: 'info' };
  }
}

function connectionTone(connectionState) {
  if (connectionState === 'connected') return { label: 'API connected', tone: 'ok' };
  if (connectionState === 'degraded') return { label: 'API degraded', tone: 'warn' };
  if (connectionState === 'legacy') return { label: 'Legacy-only', tone: 'warn' };
  return { label: 'API disconnected', tone: 'bad' };
}

function runtimeTone(health = {}) {
  if (health.status === 'ready' && health.available) {
    return { label: 'Runtime ready', tone: 'ok', copy: health.runtimeSummary || 'FreeCAD runtime detected for preview builds.' };
  }
  if (health.status === 'ready' && !health.available) {
    return { label: 'Runtime unavailable', tone: 'bad', copy: health.runtimeSummary || 'Builds are blocked until the runtime is detected.' };
  }
  return { label: 'Runtime pending', tone: 'warn', copy: health.fallbackMessage || 'Runtime diagnostics are not confirmed on this path.' };
}

function collectConfigOverview(model) {
  const overview = model.overview;
  if (!overview) {
    return [
      ['Config name', model.sourceName || 'Not loaded'],
      ['Mode', 'Pending validation'],
      ['Parts', '\u2014'],
      ['Shapes', '\u2014'],
      ['Operations', '\u2014'],
      ['Exports', '\u2014'],
    ];
  }

  return [
    ['Config name', overview.name || model.sourceName || 'Untitled'],
    ['Mode', overview.mode === 'assembly' ? 'Assembly preview' : 'Single-part preview'],
    ['Parts', String(overview.part_count ?? 0)],
    ['Shapes', String(overview.shape_count ?? 0)],
    ['Operations', String(overview.operation_count ?? 0)],
    ['Exports', (overview.export_formats || []).join(', ') || 'None'],
  ];
}

function renderInfoRows(container, rows) {
  container.replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'studio-mini-row';
    const dt = document.createElement('span');
    dt.className = 'studio-mini-label';
    dt.textContent = label;
    const dd = document.createElement('span');
    dd.className = 'studio-mini-value';
    dd.textContent = value;
    row.append(dt, dd);
    return row;
  }));
}

function renderList(container, items, emptyCopy) {
  if (!items || items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'support-note';
    empty.textContent = emptyCopy;
    container.replaceChildren(empty);
    return;
  }

  container.replaceChildren(...items.map((item) => {
    const row = document.createElement('div');
    row.className = 'support-note';
    row.textContent = item;
    return row;
  }));
}

function renderValidationNotes(container, notes, emptyCopy, summaryCopy = '') {
  if (!container) return;
  if (!notes || notes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'support-note';
    empty.textContent = emptyCopy;
    container.replaceChildren(empty);
    return;
  }

  const children = [];
  if (summaryCopy) {
    const summary = document.createElement('p');
    summary.className = 'support-note';
    summary.textContent = summaryCopy;
    children.push(summary);
  }

  notes.forEach((note) => {
    const row = document.createElement('p');
    row.className = `support-note${note.tone === 'warn' ? ' support-note-warn' : ''}`;
    row.textContent = `${note.category}: ${note.message}`;
    children.push(row);
  });

  container.replaceChildren(...children);
}

function renderBuildLog(container, buildLog = []) {
  if (buildLog.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'build-log-empty';
    empty.textContent = 'Build logs will appear here once validation or preview work runs.';
    container.replaceChildren(empty);
    return;
  }

  container.replaceChildren(...buildLog.map((line) => {
    const entry = document.createElement('div');
    entry.className = 'build-log-entry';
    entry.textContent = line;
    return entry;
  }));
}

function renderAssistantReport(container, assistantState) {
  if (assistantState.error) {
    const block = document.createElement('div');
    block.className = 'support-note support-note-warn';
    block.textContent = assistantState.error;
    container.replaceChildren(block);
    return;
  }

  if (!assistantState.report) {
    const note = document.createElement('p');
    note.className = 'inline-note';
    note.textContent = 'Use the assistant to draft TOML from a prompt without making prompting the center of the workspace.';
    container.replaceChildren(note);
    return;
  }

  const entries = [];
  const report = assistantState.report;
  if (report.mechanism_type) entries.push(`Type: ${report.mechanism_type}`);
  if (report.dof !== undefined) entries.push(`DOF: ${report.dof}`);
  if (report.recommendation) entries.push(`Recommendation: ${report.recommendation}`);
  if (Array.isArray(report.motion_chain) && report.motion_chain.length > 0) {
    entries.push(`Motion chain: ${report.motion_chain.join(' -> ')}`);
  }

  renderList(container, entries, 'The assistant returned TOML, but no review summary was attached.');
}

export function mountModelWorkspace({ root, state, addLog, submitTrackedJob }) {
  const model = ensureModelState(state.data.model);
  const viewerStore = createViewerStore();
  const viewport = root.querySelector('[data-hook="viewport"]');
  const partsListElement = root.querySelector('[data-hook="parts-list"]');
  const modelInfoElement = root.querySelector('[data-hook="model-info"]');
  const buildLogElement = root.querySelector('[data-hook="build-log"]');
  const statusSummaryElement = root.querySelector('[data-hook="build-summary"]');
  const validationSummaryElement = root.querySelector('[data-hook="validation-summary"]');
  const validationWarningsElement = root.querySelector('[data-hook="validation-warnings"]');
  const sourceSummaryElement = root.querySelector('[data-hook="source-summary"]');
  const assistantReportElement = root.querySelector('[data-hook="assistant-report"]');
  const assistantTextarea = root.querySelector('[data-hook="assistant-textarea"]');
  const configTextarea = root.querySelector('[data-hook="config-textarea"]');
  const viewportCaptionElement = root.querySelector('[data-hook="viewport-caption"]');
  const exampleSelect = root.querySelector('[data-hook="example-select"]');
  const exampleButton = root.querySelector('[data-hook="load-example"]');
  const configFileInput = root.querySelector('[data-hook="config-file"]');
  const configFileButton = root.querySelector('[data-hook="open-config"]');
  const validateButton = root.querySelector('[data-hook="validate-button"]');
  const buildButton = root.querySelector('[data-hook="build-button"]');
  const trackedCreateButton = root.querySelector('[data-hook="tracked-create-button"]');
  const trackedReportButton = root.querySelector('[data-hook="tracked-report-button"]');
  const trackedValidationNotesElement = root.querySelector('[data-hook="tracked-validation-notes"]');
  const trackedStatusElement = root.querySelector('[data-hook="tracked-status"]');
  const clearButton = root.querySelector('[data-hook="clear-result"]');
  const designButton = root.querySelector('[data-hook="draft-prompt"]');
  const wireframeInput = root.querySelector('[data-hook="wireframe"]');
  const edgesInput = root.querySelector('[data-hook="edges"]');
  const opacityInput = root.querySelector('[data-hook="opacity"]');
  const screenshotButton = root.querySelector('[data-hook="screenshot"]');
  const includeStepInput = root.querySelector('[data-hook="include-step"]');
  const includeStlInput = root.querySelector('[data-hook="include-stl"]');
  const perPartInput = root.querySelector('[data-hook="per-part-stl"]');
  const reportOptionsDisclosure = root.querySelector('.execution-lane-tracked .disclosure');
  const reportIncludeDrawingInput = root.querySelector('[data-hook="report-include-drawing"]');
  const reportIncludeToleranceInput = root.querySelector('[data-hook="report-include-tolerance"]');
  const reportIncludeDfmInput = root.querySelector('[data-hook="report-include-dfm"]');
  const reportIncludeCostInput = root.querySelector('[data-hook="report-include-cost"]');
  const reportProfileInput = root.querySelector('[data-hook="report-profile-name"]');
  const reportProfileList = root.querySelector('[data-hook="report-profile-list"]');
  const reportProfileHint = root.querySelector('[data-hook="report-profile-hint"]');
  const runtimeSurface = root.querySelector('[data-hook="runtime-surface"]');
  const connectionSurface = root.querySelector('[data-hook="connection-surface"]');
  const buildSurface = root.querySelector('[data-hook="build-surface"]');
  const resultSurface = root.querySelector('[data-hook="result-surface"]');
  const animationControlsElement = root.querySelector('[data-hook="animation-controls"]');
  const playButton = root.querySelector('[data-hook="play"]');
  const pauseButton = root.querySelector('[data-hook="pause"]');
  const resetButton = root.querySelector('[data-hook="reset-motion"]');
  const timelineInput = root.querySelector('[data-hook="timeline"]');
  const timeDisplayElement = root.querySelector('[data-hook="time-display"]');
  const speedButtons = [...root.querySelectorAll('[data-hook="speed-button"]')];

  let loadToken = 0;
  let destroyed = false;
  let profileCatalogRequest = null;

  const sceneController = initScene({
    viewport,
    partsListElement,
    opacityInput,
    state: viewerStore.state,
    onResetScene: () => animationController?.clearMotion(),
    onFrame: () => animationController?.tick(),
  });

  const animationController = createAnimationController({
    state: viewerStore.state,
    getPartMeshes: () => sceneController.getPartMeshes(),
    animationControlsElement,
    playButton,
    pauseButton,
    resetButton,
    timelineInput,
    timeDisplayElement,
    speedButtons,
  });

  function setSurface(surface, label, copy, tone) {
    if (!surface) return;
    surface.dataset.tone = tone;
    const title = surface.querySelector('.model-status-title');
    const body = surface.querySelector('.model-status-copy');
    if (title) title.textContent = label;
    if (body) body.textContent = copy;
  }

  function syncStatusSurfaces() {
    const runtime = runtimeTone(state.data.health);
    const connection = connectionTone(state.connectionState);
    const buildState = textForState(model.buildState);
    const trackedRun = deriveModelTrackedRunPresentation({
      model,
      recentJobs: state.data.recentJobs.items || [],
      jobMonitor: state.data.jobMonitor || {},
    });

    setSurface(runtimeSurface, runtime.label, runtime.copy, runtime.tone);
    setSurface(
      connectionSurface,
      connection.label,
      state.connectionState === 'connected'
        ? 'The workbench can reach the local API endpoints it needs.'
        : 'The workbench cannot reach the future-facing API path right now.',
      connection.tone,
    );
    setSurface(
      buildSurface,
      model.buildState === 'success' ? 'Preview ready' : buildState.label,
      model.buildState === 'building'
        ? 'Preview export is running with FreeCAD-backed model creation.'
        : model.buildState === 'validating'
          ? 'Checking TOML shape, migration state, and readiness before build.'
          : 'Preview stays the fast loop here. Use it for rapid model iteration without creating tracked job history.',
      buildState.tone,
    );
    setSurface(
      resultSurface,
      trackedRun.title,
      trackedRun.copy,
      trackedRun.tone,
    );
  }

  function syncTextFields() {
    if (configTextarea && configTextarea.value !== model.configText) {
      configTextarea.value = model.configText || '';
    }
    if (assistantTextarea && assistantTextarea.value !== model.promptText) {
      assistantTextarea.value = model.promptText || '';
    }
    if (exampleSelect) {
      exampleSelect.value = state.data.examples.selectedName || exampleSelect.value;
    }
    if (wireframeInput) wireframeInput.checked = Boolean(model.controls.wireframe);
    if (edgesInput) edgesInput.checked = model.controls.edges !== false;
    if (opacityInput) opacityInput.value = String(model.controls.opacity || 100);
    if (includeStepInput) includeStepInput.checked = model.buildSettings.include_step !== false;
    if (includeStlInput) includeStlInput.checked = model.buildSettings.include_stl !== false;
    if (perPartInput) perPartInput.checked = model.buildSettings.per_part_stl !== false;
    if (reportIncludeDrawingInput) reportIncludeDrawingInput.checked = model.reportOptions.includeDrawing !== false;
    if (reportIncludeToleranceInput) reportIncludeToleranceInput.checked = model.reportOptions.includeTolerance !== false;
    if (reportIncludeDfmInput) reportIncludeDfmInput.checked = model.reportOptions.includeDfm === true;
    if (reportIncludeCostInput) reportIncludeCostInput.checked = model.reportOptions.includeCost === true;
    if (reportProfileInput && reportProfileInput.value !== model.reportOptions.profileName) {
      reportProfileInput.value = model.reportOptions.profileName || '';
    }
    if (reportOptionsDisclosure) reportOptionsDisclosure.open = model.reportOptions.open === true;
  }

  function syncSourceSummary() {
    renderInfoRows(sourceSummaryElement, [
      ['Source', model.sourceType || 'Not loaded'],
      ['Name', model.sourceName || 'Untitled config'],
      ['Path', model.sourcePath || 'In-memory draft'],
      ['Editing', model.editingEnabled ? 'Enabled' : 'Disabled'],
    ]);
  }

  function syncValidationSummary() {
    renderInfoRows(validationSummaryElement, collectConfigOverview(model));
    renderValidationNotes(
      validationWarningsElement,
      collectValidationNotes(model.validation),
      'Validation notes and migration warnings will show here after the first check.',
    );
  }

  function syncTrackedValidationNotes() {
    const validationNotes = collectValidationNotes(model.validation);
    const summaryCopy = validationNotes.length > 0
      ? `Tracked runs will use the current TOML with ${validationNotes.length} validation note${validationNotes.length === 1 ? '' : 's'} visible before queueing.`
      : '';
    renderValidationNotes(
      trackedValidationNotesElement,
      validationNotes,
      'Tracked create and report will queue the current TOML after validation. Warnings or deprecated fields will be called out here before submission.',
      summaryCopy,
    );
  }

  function syncMetadata() {
    if (!model.preview?.model) {
      modelInfoElement.replaceChildren();
      modelInfoElement.classList.remove('open');
      const empty = document.createElement('p');
      empty.className = 'inline-note';
      empty.textContent = 'Build a model to inspect metadata, bounding box, and derived geometry facts.';
      modelInfoElement.append(empty);
      return;
    }

    renderModelInfo(modelInfoElement, model.preview.model, null);
  }

  function syncBuildLog() {
    renderBuildLog(buildLogElement, model.buildLog);
  }

  function syncAssistant() {
    renderAssistantReport(assistantReportElement, model.assistant);
  }

  function syncSummaryText() {
    statusSummaryElement.textContent = model.buildSummary;
    viewportCaptionElement.textContent = model.preview
      ? 'Inspect the latest preview directly in the viewport. Tracked create and report remain available in parallel for provenance and downstream artifacts.'
      : 'The viewport stays dominant so the workflow reads as choose input, preview, then inspect the result.';
  }

  function syncButtons() {
    const apiReady = state.connectionState === 'connected';
    const runtimeReady = state.data.health.available === true;
    const canBuild = apiReady && runtimeReady && Boolean((model.configText || '').trim()) && model.buildState !== 'building';
    const canTrack = apiReady
      && runtimeReady
      && Boolean((model.configText || '').trim())
      && model.buildState !== 'building'
      && !model.trackedRun.submitting;

    if (validateButton) validateButton.disabled = !apiReady || !Boolean((model.configText || '').trim()) || model.buildState === 'building';
    if (buildButton) buildButton.disabled = !canBuild;
    if (trackedCreateButton) trackedCreateButton.disabled = !canTrack;
    if (trackedReportButton) trackedReportButton.disabled = !canTrack;
    if (designButton) designButton.disabled = !apiReady || model.assistant.busy;
    if (exampleButton) exampleButton.disabled = state.data.examples.items.length === 0;
    if (configFileButton) configFileButton.disabled = false;
    if (clearButton) clearButton.disabled = !model.preview && model.buildLog.length === 0;
    if (perPartInput) perPartInput.disabled = model.overview?.mode !== 'assembly';
  }

  function syncTrackedStatus() {
    if (!trackedStatusElement) return;
    const trackedRun = deriveModelTrackedRunPresentation({
      model,
      recentJobs: state.data.recentJobs.items || [],
      jobMonitor: state.data.jobMonitor || {},
    });

    const header = document.createElement('p');
    header.className = `support-note${trackedRun.tone === 'warn' || trackedRun.tone === 'bad' ? ' support-note-warn' : ''}`;
    header.textContent = trackedRun.copy;

    const nodes = [header];
    if (trackedRun.meta) {
      const meta = document.createElement('p');
      meta.className = 'inline-note';
      meta.textContent = trackedRun.meta;
      nodes.push(meta);
    }

    if (trackedRun.canOpenArtifacts && trackedRun.job?.id) {
      const openButton = document.createElement('button');
      openButton.className = 'action-button action-button-primary';
      openButton.type = 'button';
      openButton.textContent = 'Open artifact trail';
      openButton.dataset.action = 'open-job';
      openButton.dataset.jobId = trackedRun.job.id;
      nodes.push(openButton);
    }

    trackedStatusElement.replaceChildren(...nodes);
  }

  function syncProfileCatalog() {
    if (!reportProfileList || !reportProfileHint) return;

    reportProfileList.replaceChildren(...model.profileCatalog.items.map((profile) => {
      const option = document.createElement('option');
      option.value = profile.name;
      option.label = profile.label || profile.name;
      return option;
    }));

    if (model.profileCatalog.status === 'loading') {
      reportProfileHint.textContent = 'Loading backend-supported profile suggestions from configs/profiles...';
      return;
    }

    if (model.profileCatalog.status === 'ready' && model.profileCatalog.items.length > 0) {
      reportProfileHint.textContent = `Suggested profile names: ${model.profileCatalog.items.map((profile) => profile.name).join(', ')}.`;
      return;
    }

    if (model.profileCatalog.status === 'ready') {
      reportProfileHint.textContent = 'No named profiles were found. Leave blank for default profile handling.';
      return;
    }

    if (model.profileCatalog.status === 'unavailable') {
      reportProfileHint.textContent = model.profileCatalog.message || 'Profile suggestions are unavailable on this serve path. Enter a profile name manually only if you already know it is supported.';
      return;
    }

    reportProfileHint.textContent = 'Existing backend-supported profile names can be supplied here when needed.';
  }

  function syncControls() {
    sceneController.setWireframe(Boolean(model.controls.wireframe));
    sceneController.setEdgesVisible(model.controls.edges !== false);
    sceneController.updateOpacity(Number(model.controls.opacity || 100) / 100);
  }

  function syncUi() {
    if (destroyed) return;
    syncTextFields();
    syncSourceSummary();
    syncValidationSummary();
    syncMetadata();
    syncBuildLog();
    syncAssistant();
    syncSummaryText();
    syncStatusSurfaces();
    syncTrackedValidationNotes();
    syncTrackedStatus();
    syncProfileCatalog();
    syncButtons();
    syncControls();
  }

  async function loadPreviewIntoScene() {
    const currentPreview = model.preview;
    const currentToken = ++loadToken;

    sceneController.clearScene();
    animationController.clearMotion();

    if (!currentPreview) {
      syncUi();
      return;
    }

    try {
      if (currentPreview.assembly?.part_files?.length > 0) {
        const manifest = currentPreview.assembly.part_files.map((item, index) => ({
          id: item.ref || item.id || `part_${index + 1}`,
          label: item.label || item.ref || item.id || `Part ${index + 1}`,
          material: item.material || null,
        }));
        sceneController.prepareAssembly(manifest);

        for (const part of currentPreview.assembly.part_files) {
          const response = await fetch(part.asset_url);
          if (!response.ok) throw new Error(`Part preview fetch failed (${response.status})`);
          const arrayBuffer = await response.arrayBuffer();
          if (destroyed || currentToken !== loadToken) return;
          sceneController.addPartMesh(arrayBuffer);
        }
      } else if (currentPreview.model_asset_url) {
        const response = await fetch(currentPreview.model_asset_url);
        if (!response.ok) throw new Error(`Model preview fetch failed (${response.status})`);
        const arrayBuffer = await response.arrayBuffer();
        if (destroyed || currentToken !== loadToken) return;
        sceneController.loadStl(arrayBuffer);
      }

      if (currentPreview.motion_data) {
        animationController.setMotionData(currentPreview.motion_data);
      } else {
        animationController.clearMotion();
      }
    } catch (error) {
      model.buildState = 'error';
      model.errorMessage = error instanceof Error ? error.message : String(error);
      model.buildSummary = 'Preview assets could not be loaded back into the viewport.';
      model.buildLog = [...model.buildLog, `Asset load error: ${model.errorMessage}`];
      syncUi();
      throw error;
    }
  }

  async function validateConfig() {
    if (!(model.configText || '').trim()) {
      model.buildState = 'error';
      model.errorMessage = 'Config TOML is empty.';
      model.buildSummary = 'Load or draft a config before validation.';
      syncUi();
      return false;
    }

    model.buildState = 'validating';
    model.errorMessage = '';
    model.buildSummary = 'Checking config migration state and preview readiness...';
    syncUi();

    try {
      const payload = await postJson('/api/studio/validate-config', {
        config_toml: model.configText,
      });
      model.validation = payload.validation || model.validation;
      model.overview = payload.overview || model.overview;
      model.buildLog = [];
      model.buildSummary = payload.overview?.mode === 'assembly'
        ? `Validated assembly config with ${payload.overview.part_count} parts.`
        : 'Validated single-part config and preview settings.';
      addLog({
        status: 'Model workspace',
        message: model.buildSummary,
        tone: 'info',
        time: 'model',
      });
      model.buildState = 'idle';
      syncUi();
      return true;
    } catch (error) {
      model.buildState = 'error';
      model.errorMessage = error instanceof Error ? error.message : String(error);
      model.buildSummary = 'Validation failed before build could start.';
      model.buildLog = [`Validation error: ${model.errorMessage}`];
      syncUi();
      addLog({
        status: 'Model workspace',
        message: model.errorMessage,
        tone: 'warn',
        time: 'model',
      });
      return false;
    }
  }

  async function buildPreview() {
    const valid = await validateConfig();
    if (!valid) return;

    model.buildState = 'building';
    model.preview = null;
    model.errorMessage = '';
    model.buildSummary = 'Running preview export and preparing the viewport assets...';
    syncUi();

    try {
      const payload = await postJson('/api/studio/model-preview', {
        config_toml: model.configText,
        build_settings: model.buildSettings,
      });
      model.preview = payload.preview || null;
      model.validation = payload.preview?.validation || model.validation;
      model.overview = payload.preview?.overview || model.overview;
      model.buildLog = payload.preview?.logs || [];
      model.buildState = 'success';
      model.buildSummary = payload.preview?.assembly
        ? `Built assembly preview with ${payload.preview.assembly.part_count} parts.`
        : 'Built model preview and loaded the viewport asset.';
      syncUi();
      await loadPreviewIntoScene();
      addLog({
        status: 'Model workspace',
        message: model.buildSummary,
        tone: 'ok',
        time: 'build',
      });
    } catch (error) {
      model.buildState = 'error';
      model.errorMessage = error instanceof Error ? error.message : String(error);
      model.buildSummary = 'Build failed before a preview could be inspected.';
      if (!model.buildLog.includes(`Build error: ${model.errorMessage}`)) {
        model.buildLog = [...model.buildLog, `Build error: ${model.errorMessage}`];
      }
      syncUi();
      addLog({
        status: 'Model workspace',
        message: model.errorMessage,
        tone: 'bad',
        time: 'build',
      });
    }
  }

  async function runTrackedCreate() {
    const valid = await validateConfig();
    if (!valid) return;

    try {
      model.trackedRun.submitting = true;
      model.trackedRun.type = 'create';
      model.trackedRun.error = '';
      syncUi();
      const job = await submitTrackedJob({
        type: 'create',
        configToml: model.configText,
      });
      model.trackedRun = {
        type: 'create',
        lastJobId: job.id,
        status: job.status,
        submitting: false,
        error: '',
      };
      syncUi();
      addLog({
        status: 'Tracked run',
        message: `Queued tracked create for ${model.sourceName || 'the active config'}.`,
        tone: 'info',
        time: 'job',
      });
    } catch (error) {
      model.trackedRun.submitting = false;
      model.trackedRun.error = error instanceof Error ? error.message : String(error);
      syncUi();
      addLog({
        status: 'Tracked run',
        message: model.trackedRun.error,
        tone: 'warn',
        time: 'job',
      });
    }
  }

  async function runTrackedReport() {
    const valid = await validateConfig();
    if (!valid) return;

    try {
      model.trackedRun.submitting = true;
      model.trackedRun.type = 'report';
      model.trackedRun.error = '';
      syncUi();
      const job = await submitTrackedJob({
        type: 'report',
        configToml: model.configText,
        options: buildTrackedReportJobOptions(model.reportOptions),
      });
      model.trackedRun = {
        type: 'report',
        lastJobId: job.id,
        status: job.status,
        submitting: false,
        error: '',
      };
      syncUi();
      addLog({
        status: 'Tracked run',
        message: `Queued tracked report for ${model.sourceName || 'the active config'} with the current report options.`,
        tone: 'info',
        time: 'job',
      });
    } catch (error) {
      model.trackedRun.submitting = false;
      model.trackedRun.error = error instanceof Error ? error.message : String(error);
      syncUi();
      addLog({
        status: 'Tracked run',
        message: model.trackedRun.error,
        tone: 'warn',
        time: 'job',
      });
    }
  }

  async function loadProfileCatalog() {
    if (destroyed || state.connectionState !== 'connected' || model.profileCatalog.status === 'loading') return;
    profileCatalogRequest = profileCatalogRequest || (async () => {
      model.profileCatalog.status = 'loading';
      model.profileCatalog.message = '';
      syncUi();
      try {
        const items = await listStudioConfigProfiles();
        model.profileCatalog = {
          status: 'ready',
          items,
          message: '',
        };
      } catch (error) {
        model.profileCatalog = {
          status: 'unavailable',
          items: [],
          message: error instanceof Error ? error.message : String(error),
        };
      } finally {
        profileCatalogRequest = null;
        syncUi();
      }
    })();
    await profileCatalogRequest;
  }

  async function draftFromPrompt() {
    const description = String(model.promptText || '').trim();
    if (!description) {
      model.assistant.error = 'Enter a prompt before asking the assistant to draft TOML.';
      syncUi();
      return;
    }

    model.assistant.busy = true;
    model.assistant.error = '';
    syncUi();

    try {
      const payload = await postJson('/api/studio/design', {
        description,
      });
      model.assistant.report = payload.report || null;
      model.assistant.error = '';
      if (payload.toml) {
        model.configText = payload.toml;
        model.promptMode = true;
        model.editingEnabled = true;
        if (!model.sourceType) {
          model.sourceType = 'assistant draft';
          model.sourceName = 'Prompt-generated TOML';
          model.sourcePath = 'In-memory draft';
        }
      }
      if (payload.validation?.overview) {
        model.overview = payload.validation.overview;
      }
      if (payload.validation?.summary) {
        model.validation = payload.validation.summary;
      }
      syncUi();
      addLog({
        status: 'Assistant',
        message: 'Prompt draft generated for the Model workspace.',
        tone: 'info',
        time: 'design',
      });
    } catch (error) {
      model.assistant.error = error instanceof Error ? error.message : String(error);
      syncUi();
      addLog({
        status: 'Assistant',
        message: model.assistant.error,
        tone: 'warn',
        time: 'design',
      });
    } finally {
      model.assistant.busy = false;
      syncUi();
    }
  }

  function loadSelectedExample() {
    const example = state.data.examples.items.find((item) => item.name === state.data.examples.selectedName)
      || state.data.examples.items[0];
    if (!example) return;

    model.sourceType = 'example';
    model.sourceName = example.name;
    model.sourcePath = example.name || state.data.examples.sourceLabel;
    model.configText = example.content || '';
    model.editingEnabled = true;
    model.buildSummary = `Loaded ${example.name}. Validate or build when ready.`;
    model.errorMessage = '';
    model.preview = null;
    model.buildState = 'idle';
    resetModelTrackedRunState(model);
    model.validation = {
      warnings: [],
      changed_fields: [],
      deprecated_fields: [],
    };
    model.overview = null;
    model.buildLog = [];
    sceneController.clearScene();
    animationController.clearMotion();
    syncUi();
  }

  async function openConfigFile(file) {
    if (!file) return;
    model.sourceType = 'local file';
    model.sourceName = file.name;
    model.sourcePath = file.name;
    model.configText = await file.text();
    model.editingEnabled = true;
    model.buildSummary = `Loaded ${file.name}. Validate or build when ready.`;
    model.errorMessage = '';
    model.preview = null;
    model.buildState = 'idle';
    resetModelTrackedRunState(model);
    model.validation = {
      warnings: [],
      changed_fields: [],
      deprecated_fields: [],
    };
    model.overview = null;
    model.buildLog = [];
    sceneController.clearScene();
    animationController.clearMotion();
    syncUi();
  }

  function clearResult() {
    model.preview = null;
    model.buildLog = [];
    model.buildState = 'idle';
    model.errorMessage = '';
    model.buildSummary = 'Result cleared. The input and settings remain ready for the next build.';
    sceneController.clearScene();
    animationController.clearMotion();
    syncUi();
  }

  configTextarea?.addEventListener('input', () => {
    model.configText = configTextarea.value;
    model.editingEnabled = true;
  });

  assistantTextarea?.addEventListener('input', () => {
    model.promptText = assistantTextarea.value;
    model.promptMode = true;
  });

  exampleSelect?.addEventListener('change', () => {
    state.data.examples.selectedName = exampleSelect.value;
  });

  exampleButton?.addEventListener('click', loadSelectedExample);
  configFileButton?.addEventListener('click', () => configFileInput?.click());
  configFileInput?.addEventListener('change', async () => {
    const [file] = [...(configFileInput.files || [])];
    await openConfigFile(file);
    configFileInput.value = '';
  });
  validateButton?.addEventListener('click', () => {
    validateConfig().catch(() => {});
  });
  buildButton?.addEventListener('click', () => {
    buildPreview().catch(() => {});
  });
  trackedCreateButton?.addEventListener('click', () => {
    runTrackedCreate().catch(() => {});
  });
  trackedReportButton?.addEventListener('click', () => {
    runTrackedReport().catch(() => {});
  });
  clearButton?.addEventListener('click', clearResult);
  designButton?.addEventListener('click', () => {
    draftFromPrompt().catch(() => {});
  });
  screenshotButton?.addEventListener('click', () => sceneController.takeScreenshot());

  wireframeInput?.addEventListener('change', () => {
    model.controls.wireframe = wireframeInput.checked;
    sceneController.setWireframe(wireframeInput.checked);
  });
  edgesInput?.addEventListener('change', () => {
    model.controls.edges = edgesInput.checked;
    sceneController.setEdgesVisible(edgesInput.checked);
  });
  opacityInput?.addEventListener('input', () => {
    model.controls.opacity = Number(opacityInput.value);
    sceneController.updateOpacity(model.controls.opacity / 100);
  });

  includeStepInput?.addEventListener('change', () => {
    model.buildSettings.include_step = includeStepInput.checked;
  });
  includeStlInput?.addEventListener('change', () => {
    model.buildSettings.include_stl = includeStlInput.checked;
  });
  perPartInput?.addEventListener('change', () => {
    model.buildSettings.per_part_stl = perPartInput.checked;
  });
  reportOptionsDisclosure?.addEventListener('toggle', () => {
    model.reportOptions.open = reportOptionsDisclosure.open;
    if (reportOptionsDisclosure.open && model.profileCatalog.status === 'idle') {
      loadProfileCatalog().catch(() => {});
    }
  });
  reportIncludeDrawingInput?.addEventListener('change', () => {
    model.reportOptions.includeDrawing = reportIncludeDrawingInput.checked;
  });
  reportIncludeToleranceInput?.addEventListener('change', () => {
    model.reportOptions.includeTolerance = reportIncludeToleranceInput.checked;
  });
  reportIncludeDfmInput?.addEventListener('change', () => {
    model.reportOptions.includeDfm = reportIncludeDfmInput.checked;
  });
  reportIncludeCostInput?.addEventListener('change', () => {
    model.reportOptions.includeCost = reportIncludeCostInput.checked;
  });
  reportProfileInput?.addEventListener('input', () => {
    model.reportOptions.profileName = reportProfileInput.value.trim();
  });

  syncUi();
  loadPreviewIntoScene().catch(() => {});
  if (state.connectionState === 'connected' && model.profileCatalog.status === 'idle') {
    loadProfileCatalog().catch(() => {});
  }

  return {
    syncFromShell() {
      syncUi();
    },
    destroy() {
      destroyed = true;
      loadToken += 1;
      animationController.clearMotion();
      sceneController.destroy?.();
    },
  };
}
