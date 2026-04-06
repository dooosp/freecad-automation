import { fetchArtifactText } from './artifact-insights.js';
import { mountArtifactsWorkspace } from './artifacts-workspace.js';
import { getSelectedStudioExample } from './examples.js';
import { mountReviewWorkspace } from './review-workspace.js';
import { workspaceDefinitions } from './workspaces.js';
import { applyTranslations } from '../i18n/index.js';

export function createStudioWorkspaceController(app) {
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
    app.runtime.activeWorkspaceController?.destroy?.();
    app.runtime.activeWorkspaceController = null;
    app.elements.workspaceRoot.replaceChildren(workspaceDefinitions[app.state.route].render(app.state));

    if (app.state.route === 'review') {
      app.runtime.activeWorkspaceController = mountReviewWorkspace({
        root: app.elements.workspaceRoot,
        state: app.state,
        addLog: app.addLog,
        openJob: app.openJob,
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

    app.dom.applyPendingFocus();
    applyTranslations(app.elements.workspaceRoot);

    if (app.state.route === 'model') {
      mountDeferredWorkspace(renderEpoch, 'model', loadModelWorkspaceModule, ({ mountModelWorkspace }) =>
        mountModelWorkspace({
          root: app.elements.workspaceRoot,
          state: app.state,
          addLog: app.addLog,
          submitTrackedJob: app.submitTrackedStudioRun,
        })
      );
    } else if (app.state.route === 'drawing') {
      mountDeferredWorkspace(renderEpoch, 'drawing', loadDrawingWorkspaceModule, ({ mountDrawingWorkspace }) =>
        mountDrawingWorkspace({
          root: app.elements.workspaceRoot,
          state: app.state,
          addLog: app.addLog,
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
      sourceType,
      sourceName,
      sourcePath,
      configText,
      promptMode: false,
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
    loadSelectedExampleIntoSharedModel,
    loadConfigFileIntoSharedModel,
    openConfigArtifactInModel,
    openConfigFile,
    openExample,
    openPromptFlow,
  };
}
