import { fetchArtifactText } from './artifact-insights.js';
import { mountArtifactsWorkspace } from './artifacts-workspace.js';
import { getSelectedStudioExample } from './examples.js';
import { mountReviewWorkspace } from './review-workspace.js';
import { createHomeRecentRuns, createRunHistoryWorkspace, workspaceDefinitions } from './workspaces.js';
import { applyTranslations } from '../i18n/index.js';

export function createStudioWorkspaceController(app) {
  const actionKey = (element) => JSON.stringify([
    element?.dataset?.action, element?.dataset?.jobId, element?.dataset?.route,
  ]);

  function syncStaticJobList(current, next) {
    const active = app.document.activeElement;
    const focusedRow = active?.closest?.('.home-recent-item, .result-card');
    const restoreFocus = active?.closest?.('.home-recent-list, .run-history-list') === current;
    const rowId = (row) => row.dataset.historyJobId || row.querySelector('[data-job-id]')?.dataset.jobId;
    const previous = new Map([...current.children].map((row) => [rowId(row), row]));
    const rows = [...next.children].map((nextRow) => {
      const row = previous.get(rowId(nextRow));
      if (!row) return nextRow;
      // Status/name/time are noninteractive; keep the existing result buttons and menus.
      if (row.children[0].textContent !== nextRow.children[0].textContent) {
        row.children[0].replaceChildren(...nextRow.children[0].children);
      }
      const menu = row.querySelector('.overflow-menu-popover');
      const nextMenu = nextRow.querySelector('.overflow-menu-popover');
      if (menu && nextMenu) {
        const itemsByAction = new Map([...menu.children].map((item) => [actionKey(item), item]));
        const items = [...nextMenu.children].map((item) => itemsByAction.get(actionKey(item)) || item);
        if (items.length !== menu.children.length || items.some((item, index) => menu.children[index] !== item)) {
          menu.replaceChildren(...items);
        }
        row.querySelector('.overflow-menu-trigger').setAttribute('aria-label',
          nextRow.querySelector('.overflow-menu-trigger').getAttribute('aria-label'));
      }
      return row;
    });
    if (rows.length !== current.children.length || rows.some((row, index) => current.children[index] !== row)) {
      current.replaceChildren(...rows);
    }
    if (restoreFocus && app.document.activeElement !== active && active?.isConnected) {
      active.focus({ preventScroll: true });
    } else if (restoreFocus && !active?.isConnected) {
      const fallback = focusedRow?.isConnected
        ? focusedRow.querySelector('.overflow-menu-trigger, [data-action]')
        : app.elements.workspaceRoot;
      fallback?.focus({ preventScroll: true });
    }
  }

  function syncFromShell() {
    if (app.runtime.activeWorkspaceController) {
      app.runtime.activeWorkspaceController.syncFromShell?.();
      return;
    }
    const home = app.state.route === 'start';
    if (!home && app.state.route !== 'history') return;
    const selector = home ? '[data-hook="home-recent-runs"]' : '.run-history-workspace';
    const current = app.elements.workspaceRoot.querySelector(selector);
    if (!current) return;
    const next = home ? createHomeRecentRuns(app.state) : createRunHistoryWorkspace(app.state);
    const listSelector = home ? '.home-recent-list' : '.run-history-list';
    const currentList = current.querySelector(listSelector);
    const nextList = next.querySelector(listSelector);
    if (currentList && nextList) {
      syncStaticJobList(currentList, nextList);
    } else {
      const body = home ? current.querySelector('.card-body') : current;
      const nextBody = home ? next.querySelector('.card-body') : next;
      if (body.textContent === nextBody.textContent) return;
      const active = app.document.activeElement;
      const restoreFocus = active?.closest?.(selector) === current;
      if (home) body.replaceChildren(...nextBody.children);
      else body.replaceChildren(body.children[0], ...[...nextBody.children].slice(1));
      if (restoreFocus && !active?.isConnected) app.elements.workspaceRoot.focus({ preventScroll: true });
    }
  }

  function loadModelWorkspaceModule() {
    if (!app.runtime.modelWorkspaceModulePromise) {
      app.runtime.modelWorkspaceModulePromise = app.loaders.loadModelWorkspaceModule();
    }
    return app.runtime.modelWorkspaceModulePromise;
  }

  function loadDrawingWorkspaceModule() {
    if (!app.runtime.drawingWorkspaceModulePromise) {
      app.runtime.drawingWorkspaceModulePromise = app.loaders.loadDrawingWorkspaceModule();
    }
    return app.runtime.drawingWorkspaceModulePromise;
  }

  function renderWorkspaceMountFailure(route, error) {
    const workspace = workspaceDefinitions[route];
    const message = error instanceof Error ? error.message : String(error);
    const notice = app.document.createElement('div');
    notice.className = 'support-note support-note-warn';
    notice.dataset.hook = 'workspace-load-error';
    notice.textContent = `${workspace.label} workspace could not finish loading. ${message}`;

    const shell = app.elements.workspaceRoot.querySelector('.workspace-shell, .review-layout, .artifacts-layout');
    if (shell instanceof app.window.HTMLElement) shell.prepend(notice);
    else app.elements.workspaceRoot.prepend(notice);

    app.addLog({
      status: `${workspace.label} workspace`,
      message: `${workspace.label} workspace could not finish loading: ${message}`,
      tone: 'warn',
      time: 'ui',
    });
  }

  async function mountDeferredWorkspace(renderEpoch, route, loadModule, mountWorkspace) {
    try {
      const module = await loadModule();
      if (renderEpoch !== app.runtime.workspaceRenderEpoch || app.state.route !== route) return;
      app.runtime.activeWorkspaceController = mountWorkspace(module);
    } catch (error) {
      if (renderEpoch !== app.runtime.workspaceRenderEpoch || app.state.route !== route) return;
      renderWorkspaceMountFailure(route, error);
    } finally {
      if (renderEpoch === app.runtime.workspaceRenderEpoch && app.state.route === route) {
        app.dom.applyPendingFocus();
        applyTranslations(app.elements.workspaceRoot);
      }
    }
  }

  function renderWorkspace() {
    const renderEpoch = ++app.runtime.workspaceRenderEpoch;
    const hasDeferredWorkspaceController = ['model', 'drawing'].includes(app.state.route);
    app.runtime.activeWorkspaceController?.destroy?.();
    app.runtime.activeWorkspaceController = null;
    app.elements.workspaceRoot.replaceChildren(workspaceDefinitions[app.state.route].render(app.state));

    if (app.state.route === 'review') {
      app.runtime.activeWorkspaceController = mountReviewWorkspace({
        root: app.elements.workspaceRoot,
        state: app.state,
        addLog: app.addLog,
        openJob: app.openJob,
        submitTrackedJob: app.submitTrackedStudioRun,
      });
    } else if (app.state.route === 'artifacts') {
      app.runtime.activeWorkspaceController = mountArtifactsWorkspace({
        root: app.elements.workspaceRoot,
        state: app.state,
        addLog: app.addLog,
        openJob: app.openJob,
        fetchJson: app.fetchJson,
      });
    }

    if (!hasDeferredWorkspaceController) app.dom.applyPendingFocus();
    applyTranslations(app.elements.workspaceRoot);

    if (app.state.route === 'model') {
      mountDeferredWorkspace(renderEpoch, 'model', loadModelWorkspaceModule, ({ mountModelWorkspace }) =>
        mountModelWorkspace({
          root: app.elements.workspaceRoot,
          state: app.state,
          addLog: app.addLog,
          onDraftChange: app.persistDraft,
          submitTrackedJob: app.submitTrackedStudioRun,
        })
      );
    } else if (app.state.route === 'drawing') {
      mountDeferredWorkspace(renderEpoch, 'drawing', loadDrawingWorkspaceModule, ({ mountDrawingWorkspace }) =>
        mountDrawingWorkspace({
          root: app.elements.workspaceRoot,
          state: app.state,
          addLog: app.addLog,
          onDraftChange: app.persistDraft,
          navigateTo: app.navigateTo,
          openJob: app.openJob,
          loadSelectedExampleIntoSharedModel,
          loadConfigFileIntoSharedModel,
          submitTrackedJob: app.submitTrackedStudioRun,
        })
      );
    }
  }

  function getSelectedExample() {
    return getSelectedStudioExample(app.state.data.examples);
  }

  function resetDrawingWorkspaceState() {
    app.state.data.drawing = {
      ...app.state.data.drawing,
      status: 'idle',
      summary: 'Generate drawing to open the sheet-first workbench.',
      activeRequest: null,
      previewInputSnapshot: null,
      dimensionDraftOwner: '',
      dimensionDrafts: {},
      dimensionFocus: '',
      historyPlanReference: '',
      errorMessage: '',
      preview: null,
      history: [],
      historyIndex: -1,
      trackedRun: {
        lastJobId: '',
        status: 'idle',
        submitting: false,
        error: '',
        preservedEditedPreview: false,
        previewPlanRequested: false,
        preserveReason: '',
        submittedDrawingSettings: null,
      },
    };
  }

  function applyConfigToSharedModel({
    sourceType,
    sourceName,
    sourcePath,
    configText,
  }) {
    app.state.data.model = {
      ...app.state.data.model,
      recoveredDraft: false,
      sourceType,
      sourceName,
      sourcePath,
      configText,
      promptMode: false,
      assistant: {
        busy: false,
        error: '',
        report: null,
        phase: 'prompt',
        validatedConfigText: '',
      },
      editingEnabled: true,
      buildState: 'idle',
      buildSummary: 'Config source loaded into Model. Validate or preview it, or queue a tracked run.',
      errorMessage: '',
      buildLog: [],
      validation: {
        warnings: [],
        changed_fields: [],
        deprecated_fields: [],
      },
      overview: null,
      preview: null,
      trackedRun: {
        type: '',
        lastJobId: '',
        status: 'idle',
        submitting: false,
        error: '',
      },
    };
    resetDrawingWorkspaceState();
  }

  function applyExampleToSharedModel(example) {
    if (!example) return;

    applyConfigToSharedModel({
      sourceType: 'example',
      sourceName: example.name,
      sourcePath: example.id || example.name || app.state.data.examples.sourceLabel,
      configText: example.content || '',
    });
  }

  function loadSelectedExampleIntoSharedModel() {
    const example = getSelectedExample();
    if (!example) return;

    applyExampleToSharedModel(example);
    app.addLog({
      status: 'Launchpad',
      message: `Loaded example ${example.name} into the shared studio config state.`,
      tone: 'ok',
      time: 'start',
    });
  }

  function openExample() {
    const example = getSelectedExample();
    if (!example) return;

    loadSelectedExampleIntoSharedModel();
    app.navigateTo('model', { pendingFocus: 'config' });
  }

  function openPromptFlow() {
    app.state.data.model.promptMode = true;
    app.state.data.model.guidedFlow = {
      ...app.state.data.model.guidedFlow,
      step: 'select_input',
      inputMethod: 'ai',
      error: '',
    };
    app.addLog({
      status: 'Launchpad',
      message: 'Prompt drafting is ready in the Model workspace.',
      tone: 'info',
      time: 'start',
    });
    app.navigateTo('model', { pendingFocus: 'prompt' });
  }

  async function loadConfigFileIntoSharedModel(file) {
    if (!file) return;
    const text = await file.text();
    applyConfigToSharedModel({
      sourceType: 'local file',
      sourceName: file.name,
      sourcePath: file.name,
      configText: text,
    });
    app.addLog({
      status: 'Launchpad',
      message: `Loaded ${file.name} into the shared studio config state.`,
      tone: 'ok',
      time: 'file',
    });
  }

  async function openConfigArtifactInModel(job, artifact) {
    const configText = await fetchArtifactText(artifact, 250_000);
    if (!configText) {
      throw new Error(`Could not load config text from ${artifact.file_name || artifact.id}.`);
    }

    applyConfigToSharedModel({
      sourceType: 'artifact',
      sourceName: artifact.file_name || artifact.key || 'Config artifact',
      sourcePath: artifact.file_name
        || artifact.id
        || `${job?.type || 'job'} ${job?.id?.slice(0, 8) || 'unknown'}`,
      configText,
    });
    app.addLog({
      status: 'Artifacts',
      message: `Loaded ${artifact.file_name || artifact.key} from ${job?.type || 'job'} ${job?.id?.slice(0, 8) || 'unknown'} into Model.`,
      tone: 'ok',
      time: 'artifact',
    });
    app.navigateTo('model', { pendingFocus: 'config' });
  }

  async function openConfigFile(file) {
    if (!file) return;
    await loadConfigFileIntoSharedModel(file);
    app.navigateTo('model', { pendingFocus: 'config' });
  }

  return {
    renderWorkspace,
    syncFromShell,
    loadSelectedExampleIntoSharedModel,
    loadConfigFileIntoSharedModel,
    openConfigArtifactInModel,
    openConfigFile,
    openExample,
    openPromptFlow,
  };
}
