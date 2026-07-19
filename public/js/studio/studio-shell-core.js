import { buildStudioArtifactRef, deriveStudioArtifactFamily } from './artifact-actions.js';
import {
  buildCanonicalArtifactPreviewRoute,
  fetchCanonicalPackages,
} from './canonical-packages.js';
import {
  findStudioExampleById,
  resolveSelectedStudioExampleId,
  VERIFIED_BRACKET_EXAMPLE_ID,
} from './examples.js';
import {
  buildTrackedReportJobOptions,
  ensureModelTrackedRunState,
} from './model-tracked-runs.js';
import { invalidateAiDraftValidation } from './ai-guided-flow.js';
import { buildImportBootstrapOptions } from './import-bootstrap-options.js';
import {
  buildImportBootstrapRequestBody,
  ensureImportGuidedFlowState,
  resetImportGuidedFlow,
  setImportGuidedError,
  setImportGuidedStep,
  validateImportUploadFile,
} from './import-guided-flow.js';
import { deriveStudioChromeState, writeStudioExperienceMode } from './studio-state.js';
import {
  bindStudioShellElements,
  createStudioShellDomController,
  ensureShellContract,
  localizedBootMessage,
  markStudioBooted,
  reportStudioBootFailure,
} from './studio-shell-dom.js';
import { createStudioJobMonitorController } from './studio-shell-job-monitor.js';
import { createStudioShellRouting } from './studio-shell-routing.js';
import { createStudioShellRuntime, createStudioShellState } from './studio-shell-store.js';
import { createStudioWorkspaceController } from './studio-shell-workspace.js';
import {
  applyTranslations,
  bindLocaleControls,
  initializeLocale,
  subscribeLocale,
  t,
  translateText,
} from '../i18n/index.js';

export { localizedBootMessage, reportStudioBootFailure } from './studio-shell-dom.js';

export function createFetchJson(windowRef = window) {
  const fetchImpl = windowRef.fetch.bind(windowRef);
  return async function fetchJson(url, options = {}) {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });
    if (!response.ok) {
      let message = '';
      try {
        const payload = await response.json();
        message = payload?.error?.messages?.join(' ') || payload?.message || '';
      } catch (error) {
        message = '';
      }
      throw new Error(message || `${url} returned ${response.status}`);
    }
    return response.json();
  };
}

function resolveRuntimePath(runtime = {}) {
  return runtime?.selected_runtime?.executable
    || runtime?.selected_runtime?.runtime_executable
    || runtime?.selected_runtime?.python_executable
    || runtime?.runtime_executable
    || runtime?.python_executable
    || '';
}

async function copyTextToClipboard({ documentRef, navigatorRef }, text) {
  const value = typeof text === 'string' ? text : '';
  if (!value) {
    throw new Error('Copy failed');
  }

  if (navigatorRef?.clipboard?.writeText) {
    await navigatorRef.clipboard.writeText(value);
    return;
  }

  if (!documentRef?.body || typeof documentRef.execCommand !== 'function') {
    throw new Error('Clipboard API unavailable');
  }

  const textarea = documentRef.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  documentRef.body.append(textarea);
  textarea.focus();
  textarea.select();

  try {
    if (!documentRef.execCommand('copy')) {
      throw new Error('Clipboard copy command failed');
    }
  } finally {
    textarea.remove();
  }
}

export function bootStudioShell({
  documentRef = document,
  windowRef = window,
  loadModelWorkspaceModule = () => import('./model-workspace.js'),
  loadDrawingWorkspaceModule = () => import('./drawing-workspace.js'),
} = {}) {
  let storage = null;
  try {
    storage = windowRef.localStorage;
  } catch {}

  const app = {
    document: documentRef,
    window: windowRef,
    navigator: windowRef.navigator,
    elements: bindStudioShellElements(documentRef),
    state: createStudioShellState(windowRef.location, storage),
    runtime: createStudioShellRuntime(),
    loaders: {
      loadModelWorkspaceModule,
      loadDrawingWorkspaceModule,
    },
    fetchJson: null,
    addLog: null,
    commitRender: null,
    refreshShellChrome: null,
    navigateTo: null,
    openJob: null,
    syncSelectedJobFromLocation: null,
    submitTrackedStudioRun: null,
    dom: null,
    routing: null,
    workspace: null,
    jobs: null,
  };

  app.fetchJson = createFetchJson(windowRef);
  app.dom = createStudioShellDomController(app);
  app.routing = createStudioShellRouting(app);
  app.workspace = createStudioWorkspaceController(app);
  app.jobs = createStudioJobMonitorController(app);
  app.navigateTo = app.routing.navigateTo;
  app.openJob = app.jobs.openJob;
  app.syncSelectedJobFromLocation = app.routing.syncSelectedJobFromLocation;
  app.submitTrackedStudioRun = app.jobs.submitTrackedStudioRun;

  function syncDerivedState() {
    Object.assign(app.state, deriveStudioChromeState(app.state.data));
  }

  app.addLog = function addLog(entry) {
    app.state.logs.unshift(entry);
    if (app.state.logs.length > 10) app.state.logs.length = 10;
    app.dom.renderLogs();
  };

  app.commitRender = function commitRender() {
    syncDerivedState();
    app.dom.syncChrome();
    app.dom.renderCompletionNotice();
    app.workspace.renderWorkspace();
    app.dom.renderJobsDrawer();
    app.dom.renderLogs();
    bindLocaleControls(documentRef.body);
    applyTranslations(documentRef.body);
  };

  app.refreshShellChrome = function refreshShellChrome({ syncWorkspace = false } = {}) {
    syncDerivedState();
    app.dom.syncChrome();
    app.dom.renderCompletionNotice();
    app.dom.renderJobsDrawer();
    if (syncWorkspace) {
      app.runtime.activeWorkspaceController?.syncFromShell?.();
    }
    bindLocaleControls(documentRef.body);
    applyTranslations(documentRef.body);
  };

  async function loadLandingPayload() {
    try {
      const landing = await app.fetchJson('/');
      if (landing?.mode !== 'local_api') {
        throw new Error('Not on local API landing path');
      }
      app.state.data.landing = landing;
      app.state.data.health.projectRoot = landing.project_root || app.state.data.health.projectRoot;
      app.addLog({
        status: 'Connection',
        message: 'Local API landing payload detected. The review console can use runtime health, tracked jobs, and canonical artifact routing.',
        tone: 'ok',
        time: 'api',
      });
    } catch {
      app.state.data.landing = null;
    } finally {
      app.commitRender();
    }
  }

  async function refreshHealth() {
    try {
      const health = await app.fetchJson('/health');
      app.state.data.health = {
        status: 'ready',
        reachable: true,
        available: Boolean(health?.runtime?.available),
        runtimeSummary: health?.runtime?.description || 'Runtime diagnostics available.',
        runtimePath: resolveRuntimePath(health?.runtime),
        pythonVersion: health?.runtime?.version_details?.python?.version || '',
        freecadVersion: health?.runtime?.version_details?.freecad?.version || '',
        projectRoot: app.state.data.landing?.project_root || app.state.data.health.projectRoot,
        checkedAt: new Date().toISOString(),
        warnings: Array.isArray(health?.runtime?.warnings) ? health.runtime.warnings : [],
        errors: Array.isArray(health?.runtime?.errors) ? health.runtime.errors : [],
        fallbackMessage: '',
      };
      app.addLog({
        status: app.state.data.health.available ? 'Runtime ready' : 'Runtime check',
        message: app.state.data.health.runtimeSummary,
        tone: app.state.data.health.available ? 'ok' : 'warn',
        time: 'health',
      });
    } catch {
      app.state.data.health = {
        ...app.state.data.health,
        status: 'unavailable',
        reachable: false,
        available: false,
        runtimeSummary: '',
        runtimePath: '',
        pythonVersion: '',
        freecadVersion: '',
        checkedAt: new Date().toISOString(),
        warnings: [],
        errors: [],
        fallbackMessage: app.state.connectionState === 'legacy'
          ? 'Legacy shell detected. Example loading can still work, but /health and tracked jobs are not exposed here.'
          : 'No /health endpoint responded. The shell stays usable, but runtime posture cannot be verified from here.',
      };
    } finally {
      app.commitRender();
    }
  }

  async function loadExamples() {
    try {
      const examplesPayload = await app.fetchJson('/api/examples');
      const items = Array.isArray(examplesPayload) ? examplesPayload : (examplesPayload?.examples || []);
      app.state.data.examples.items = items;
      app.state.data.examples.status = items.length > 0 ? 'ready' : 'empty';
      app.state.data.examples.selectedId = resolveSelectedStudioExampleId(
        items,
        app.state.data.examples.selectedId
      );
      app.state.data.examples.message = items.length > 0 ? '' : 'The examples source returned no TOML files.';
      if (items.length > 0 && app.state.data.health.status === 'unavailable') {
        app.state.data.health.fallbackMessage = 'Legacy shell detected. Examples still load, but runtime health and tracked jobs require the local API path from `fcad serve`.';
      }
      app.addLog({
        status: 'Examples',
        message: items.length > 0
          ? `Loaded ${items.length} examples from the checked-in examples source.`
          : 'Examples endpoint responded but returned no example configs.',
        tone: items.length > 0 ? 'ok' : 'warn',
        time: 'examples',
      });
    } catch {
      app.state.data.examples.status = 'unavailable';
      app.state.data.examples.items = [];
      app.state.data.examples.selectedId = '';
      app.state.data.examples.message = 'Examples are not available on this serve path.';
    } finally {
      app.commitRender();
    }
  }

  async function loadCanonicalPackages() {
    try {
      const currentPreview = app.state.data.canonicalPackages.preview || { status: 'idle' };
      app.state.data.canonicalPackages = await fetchCanonicalPackages(app.fetchJson);
      app.state.data.canonicalPackages.preview = currentPreview;
      app.addLog({
        status: 'Canonical packages',
        message: app.state.data.canonicalPackages.items.length > 0
          ? `Loaded ${app.state.data.canonicalPackages.items.length} read-only canonical package cards.`
          : 'Canonical package endpoint responded without package cards.',
        tone: app.state.data.canonicalPackages.items.length > 0 ? 'ok' : 'warn',
        time: 'packages',
      });
    } catch {
      app.state.data.canonicalPackages = {
        status: 'unavailable',
        items: [],
        message: 'Canonical packages are not available on this serve path.',
        preview: { status: 'idle' },
      };
    } finally {
      app.commitRender();
    }
  }

  async function hydrateShell() {
    await loadLandingPayload();
    await Promise.allSettled([
      refreshHealth(),
      loadExamples(),
      loadCanonicalPackages(),
      app.jobs.refreshRecentJobs(),
    ]);
    app.jobs.resumeJobMonitoring();
    await app.syncSelectedJobFromLocation();
  }

  function logActionFailure(status, error, time = 'job') {
    app.addLog({
      status,
      message: error instanceof Error ? error.message : String(error),
      tone: 'warn',
      time,
    });
  }

  async function validateSharedModelConfig() {
    const model = app.state.data.model;
    if (!(model.configText || '').trim()) {
      model.buildState = 'error';
      model.errorMessage = 'Config TOML is empty.';
      model.buildSummary = 'Load the verified bracket before running tracked create or report.';
      app.commitRender();
      return false;
    }

    model.buildState = 'validating';
    model.errorMessage = '';
    model.buildSummary = 'Checking config before tracked submission...';
    app.commitRender();

    try {
      const payload = await app.fetchJson('/api/studio/validate-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config_toml: model.configText }),
      });
      model.validation = payload.validation || model.validation;
      model.overview = payload.overview || model.overview;
      model.buildState = 'idle';
      model.buildSummary = payload.overview?.mode === 'assembly'
        ? `Validated assembly config with ${payload.overview.part_count} parts.`
        : 'Validated single-part config for tracked submission.';
      app.addLog({
        status: 'Tracked path',
        message: model.buildSummary,
        tone: 'info',
        time: 'start',
      });
      app.commitRender();
      return true;
    } catch (error) {
      model.buildState = 'error';
      model.errorMessage = error instanceof Error ? error.message : String(error);
      model.buildSummary = 'Validation failed before the tracked job could start.';
      model.buildLog = [`Validation error: ${model.errorMessage}`];
      app.addLog({
        status: 'Tracked path',
        message: model.errorMessage,
        tone: 'warn',
        time: 'start',
      });
      app.commitRender();
      return false;
    }
  }

  async function runSharedModelTrackedJob(type) {
    const model = ensureModelTrackedRunState(app.state.data.model);
    const valid = await validateSharedModelConfig();
    if (!valid) return;

    try {
      model.trackedRun = {
        type,
        lastJobId: '',
        status: 'submitting',
        submitting: true,
        error: '',
      };
      app.commitRender();

      const job = await app.submitTrackedStudioRun({
        type,
        configToml: model.configText,
        ...(type === 'report'
          ? { options: buildTrackedReportJobOptions(model.reportOptions) }
          : {}),
      });

      model.trackedRun = {
        type,
        lastJobId: job.id,
        status: job.status,
        submitting: false,
        error: '',
      };
      app.addLog({
        status: 'Tracked path',
        message: `Queued tracked ${type} for ${model.sourceName || 'the active config'}.`,
        tone: 'info',
        time: 'job',
      });
      app.commitRender();
    } catch (error) {
      model.trackedRun = {
        ...model.trackedRun,
        type,
        submitting: false,
        error: error instanceof Error ? error.message : String(error),
      };
      app.addLog({
        status: 'Tracked path',
        message: model.trackedRun.error,
        tone: 'warn',
        time: 'job',
      });
      app.commitRender();
    }
  }

  function currentImportBootstrap() {
    const importBootstrap = app.state.data.importBootstrap || {};
    ensureImportGuidedFlowState(importBootstrap);
    app.state.data.importBootstrap = importBootstrap;
    return importBootstrap;
  }

  function clearImportSource(importBootstrap) {
    importBootstrap.modelFile = null;
    importBootstrap.modelFileName = '';
    importBootstrap.modelPath = '';
    importBootstrap.bomPath = '';
    importBootstrap.inspectionPath = '';
    importBootstrap.qualityPath = '';
  }

  let importStepFocusRequestEpoch = 0;

  function focusCurrentImportStep() {
    const selector = '[data-import-guided-step]:not([hidden])';
    const requestEpoch = ++importStepFocusRequestEpoch;
    const focusTarget = app.elements.workspaceRoot.querySelector(selector);
    const requestActiveElement = app.document.activeElement;
    const focusStep = () => {
      const currentFocusTarget = app.elements.workspaceRoot.querySelector(selector);
      const activeElement = app.document.activeElement;
      if (
        requestEpoch !== importStepFocusRequestEpoch
        || app.state.route !== 'console'
        || !(focusTarget instanceof windowRef.HTMLElement)
        || !focusTarget?.isConnected
        || focusTarget.getClientRects().length === 0
        || currentFocusTarget !== focusTarget
        || (
          activeElement !== requestActiveElement
          && activeElement !== focusTarget
          && activeElement !== app.elements.workspaceRoot
          && activeElement !== app.document.body
        )
      ) {
        return;
      }
      focusTarget.focus();
    };
    focusStep();
    windowRef.requestAnimationFrame(() => {
      focusStep();
      windowRef.requestAnimationFrame(focusStep);
    });
  }

  async function fileToBootstrapUpload(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunkSize = 0x8000;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return {
      name: file.name,
      content_base64: windowRef.btoa(binary),
    };
  }

  async function previewImportBootstrap({ file = null, useProjectPath = false } = {}) {
    const importBootstrap = currentImportBootstrap();
    if (file) {
      const sizeValidation = validateImportUploadFile(file);
      if (!sizeValidation.ok) {
        const errorParams = {
          size: sizeValidation.sizeLabel,
          limit: sizeValidation.limitLabel,
        };
        importBootstrap.modelFile = null;
        importBootstrap.modelFileName = file.name;
        importBootstrap.modelPath = '';
        importBootstrap.preview = null;
        importBootstrap.status = 'error';
        importBootstrap.errorMessage = '';
        setImportGuidedStep(importBootstrap, 'select_file');
        setImportGuidedError(importBootstrap, {
          key: 'studio.import.guided.file.too-large',
          params: errorParams,
        });
        app.commitRender();
        focusCurrentImportStep();
        return;
      }
      importBootstrap.modelFile = file;
      importBootstrap.modelFileName = file.name;
      importBootstrap.modelPath = '';
    } else if (useProjectPath) {
      importBootstrap.modelFile = null;
      importBootstrap.modelFileName = '';
    }

    if (!importBootstrap.modelFile && !String(importBootstrap.modelPath || '').trim()) {
      importBootstrap.status = 'error';
      importBootstrap.errorMessage = '';
      setImportGuidedStep(importBootstrap, 'select_file');
      setImportGuidedError(importBootstrap, {
        key: 'studio.import.guided.file.required-error',
      });
      app.commitRender();
      focusCurrentImportStep();
      return;
    }

    importBootstrap.status = 'loading';
    importBootstrap.preview = null;
    importBootstrap.errorMessage = '';
    importBootstrap.lastJobId = '';
    importBootstrap.reviewJob = null;
    importBootstrap.corrections = {};
    setImportGuidedStep(importBootstrap, 'diagnostics');
    app.commitRender();
    focusCurrentImportStep();

    try {
      const modelUpload = importBootstrap.modelFile
        ? await fileToBootstrapUpload(importBootstrap.modelFile)
        : null;
      const payload = await app.fetchJson('/api/studio/import-bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildImportBootstrapRequestBody(importBootstrap, { modelUpload })),
      });
      importBootstrap.preview = payload;
      importBootstrap.status = 'ready';
      setImportGuidedStep(importBootstrap, 'confirm');
      app.addLog({
        status: 'Import check',
        message: `Prepared import diagnostics for ${importBootstrap.modelFileName || importBootstrap.modelPath}.`,
        tone: 'info',
        time: 'import',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      importBootstrap.status = 'error';
      importBootstrap.errorMessage = message;
      setImportGuidedStep(importBootstrap, 'select_file');
      setImportGuidedError(importBootstrap, { message });
      app.addLog({
        status: 'Import check',
        message,
        tone: 'warn',
        time: 'import',
      });
    } finally {
      app.commitRender();
      focusCurrentImportStep();
    }
  }

  async function submitImportReview() {
    const importBootstrap = currentImportBootstrap();
    const preview = importBootstrap.preview;
    const seed = preview?.tracked_review_seed || {};
    if (!seed.context_path || !seed.model_path) return;

    importBootstrap.submitting = true;
    importBootstrap.errorMessage = '';
    setImportGuidedStep(importBootstrap, 'running');
    app.commitRender();
    focusCurrentImportStep();

    try {
      const job = await app.submitTrackedStudioRun({
        type: 'review-context',
        contextPath: seed.context_path,
        modelPath: seed.model_path,
        bomPath: seed.bom_path,
        inspectionPath: seed.inspection_path,
        qualityPath: seed.quality_path,
        options: buildImportBootstrapOptions(preview, importBootstrap.corrections || {}),
        completionAction: { stayOnCurrentRoute: true },
      });
      if (!job?.id) throw new Error('Tracked review did not return a job.');
      importBootstrap.lastJobId = job.id;
      importBootstrap.reviewJob = job;
      importBootstrap.submitting = false;
      setImportGuidedStep(importBootstrap, 'result');
      app.addLog({
        status: 'CAD review',
        message: `Started the structured review for ${importBootstrap.modelFileName || importBootstrap.modelPath}.`,
        tone: 'info',
        time: 'job',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      importBootstrap.submitting = false;
      importBootstrap.errorMessage = message;
      setImportGuidedStep(importBootstrap, 'confirm');
      setImportGuidedError(importBootstrap, { message });
      app.addLog({
        status: 'CAD review',
        message,
        tone: 'warn',
        time: 'job',
      });
    } finally {
      app.commitRender();
      focusCurrentImportStep();
    }
  }

  async function handleShellAction(actionTarget) {
    const { action, jobId } = actionTarget.dataset;

    if (action === 'preview-canonical-artifact') {
      const slug = actionTarget.dataset.canonicalPackageSlug || '';
      const artifactKey = actionTarget.dataset.canonicalArtifactKey || '';
      const label = actionTarget.dataset.canonicalArtifactLabel || artifactKey || 'Preview';

      app.state.data.canonicalPackages.preview = {
        status: 'loading',
        slug,
        artifactKey,
        label,
      };
      app.commitRender();

      try {
        const payload = await app.fetchJson(buildCanonicalArtifactPreviewRoute(slug, artifactKey));
        app.state.data.canonicalPackages.preview = {
          status: 'ready',
          slug,
          artifactKey,
          label,
          payload,
        };
        app.addLog({
          status: 'Preview',
          message: `Loaded canonical artifact preview for ${slug}:${artifactKey}.`,
          tone: 'info',
          time: 'package',
        });
      } catch (error) {
        app.state.data.canonicalPackages.preview = {
          status: 'error',
          slug,
          artifactKey,
          label,
          errorMessage: error instanceof Error ? error.message : String(error),
        };
        app.addLog({
          status: 'Preview failed',
          message: app.state.data.canonicalPackages.preview.errorMessage,
          tone: 'warn',
          time: 'package',
        });
      } finally {
        app.commitRender();
      }
      return;
    }

    if (action === 'close-canonical-artifact-preview') {
      app.state.data.canonicalPackages.preview = { status: 'idle' };
      app.commitRender();
      return;
    }

    if (action === 'copy-canonical-artifact-path') {
      const artifactPath = actionTarget.dataset.canonicalArtifactPath || '';
      const originalLabel = actionTarget.dataset.originalLabel || actionTarget.textContent || 'Copy repo path';
      actionTarget.dataset.originalLabel = originalLabel;

      try {
        await copyTextToClipboard({
          documentRef: app.document,
          navigatorRef: app.navigator,
        }, artifactPath);
        actionTarget.textContent = translateText('Copied');
        app.addLog({
          status: 'Copied',
          message: `Copied canonical package repo path: ${artifactPath}`,
          tone: 'info',
          time: 'package',
        });
      } catch (error) {
        actionTarget.textContent = translateText('Copy failed');
        app.addLog({
          status: 'Copy failed',
          message: error instanceof Error ? error.message : String(error),
          tone: 'warn',
          time: 'package',
        });
      } finally {
        app.window.setTimeout(() => {
          if (actionTarget.isConnected) {
            actionTarget.textContent = translateText(originalLabel);
          }
        }, 1800);
      }
      return;
    }

    if (action === 'refresh-health') {
      await refreshHealth();
      return;
    }

    if (action === 'try-example') {
      app.workspace.openExample();
      return;
    }

    if (action === 'load-verified-bracket') {
      const verifiedExample = findStudioExampleById(
        app.state.data.examples.items,
        VERIFIED_BRACKET_EXAMPLE_ID
      );
      if (!verifiedExample) {
        logActionFailure(
          'Examples',
          new Error('quality_pass_bracket is not available from the checked-in examples source.'),
          'examples'
        );
        return;
      }

      app.state.data.examples.selectedId = VERIFIED_BRACKET_EXAMPLE_ID;
      app.workspace.loadSelectedExampleIntoSharedModel();
      app.commitRender();
      return;
    }

    if (action === 'go-model') {
      if (actionTarget.closest('[data-start-goal="create-model"]')) {
        const currentFlow = app.state.data.model.guidedFlow || {};
        app.state.data.model.guidedFlow = {
          ...currentFlow,
          step: 'select_input',
          resultExpanded: false,
          error: '',
        };
      }
      app.navigateTo('model', {
        pendingFocus: 'guided-model',
      });
      return;
    }

    if (action === 'go-drawing') {
      app.navigateTo('drawing');
      return;
    }

    if (action === 'go-console') {
      if (actionTarget.closest('[data-start-goal="review-cad"]')) {
        const importBootstrap = currentImportBootstrap();
        resetImportGuidedFlow(importBootstrap);
        clearImportSource(importBootstrap);
      }
      app.navigateTo('console', { pendingFocus: 'import' });
      return;
    }

    if (action === 'choose-import-model-file') {
      app.elements.workspaceRoot.querySelector('#guided-import-model-file')?.click();
      return;
    }

    if (action === 'preview-import-bootstrap') {
      await previewImportBootstrap({ useProjectPath: true });
      return;
    }

    if (action === 'submit-import-review') {
      await submitImportReview();
      return;
    }

    if (action === 'import-view-review-result') {
      const { lastJobId } = currentImportBootstrap();
      if (lastJobId) await app.openJob(lastJobId, { route: 'review' });
      return;
    }

    if (action === 'import-open-result-files') {
      const { lastJobId } = currentImportBootstrap();
      if (lastJobId) await app.openJob(lastJobId, { route: 'artifacts' });
      return;
    }

    if (action === 'import-start-another') {
      const importBootstrap = currentImportBootstrap();
      resetImportGuidedFlow(importBootstrap);
      clearImportSource(importBootstrap);
      app.commitRender();
      focusCurrentImportStep();
      return;
    }

    if (action === 'go-runtime-details') {
      app.navigateTo('console');
      return;
    }

    if (action === 'go-history') {
      app.navigateTo('history');
      return;
    }

    if (action === 'start-run-tracked-create') {
      await runSharedModelTrackedJob('create');
      return;
    }

    if (action === 'start-run-tracked-report') {
      await runSharedModelTrackedJob('report');
      return;
    }

    if (action === 'go-artifacts') {
      app.navigateTo('artifacts');
      return;
    }

    if (action === 'open-jobs-center') {
      const overflowTrigger = actionTarget.closest('.overflow-menu')?.querySelector('.overflow-menu-trigger');
      app.dom.setJobsDrawer(true, {
        focusEntry: true,
        returnFocusTarget: overflowTrigger || actionTarget,
      });
      return;
    }

    if (action === 'open-config') {
      app.elements.workspaceRoot.querySelector('#start-config-file')?.click();
      return;
    }

    if (action === 'open-prompt-flow') {
      app.workspace.openPromptFlow();
      return;
    }

    if (action === 'open-recent-job') {
      const firstJob = app.state.data.recentJobs.items[0];
      if (firstJob) await app.openJob(firstJob.id);
      return;
    }

    if (action === 'open-job' && jobId) {
      await app.openJob(jobId, { route: actionTarget.dataset.route || 'artifacts' });
      return;
    }

    if (action === 'open-review' && app.state.data.activeJob.summary) {
      app.navigateTo('review');
      return;
    }

    if (action === 'open-artifacts' && app.state.data.activeJob.summary) {
      app.navigateTo('artifacts');
      return;
    }

    if (action === 'dismiss-completion-notice') {
      if (
        !actionTarget.dataset.jobId
        || app.state.data.completionNotice?.jobId === actionTarget.dataset.jobId
      ) {
        app.jobs.setCompletionNotice(null);
      }
      return;
    }

    if (action === 'cancel-job' && jobId) {
      try {
        await app.jobs.cancelTrackedJobById(jobId);
      } catch (error) {
        logActionFailure('Tracked run', error);
      }
      return;
    }

    if (action === 'retry-job' && jobId) {
      try {
        await app.jobs.retryTrackedJobById(jobId);
      } catch (error) {
        logActionFailure('Tracked run', error);
      }
      return;
    }

    if (action === 'open-config-artifact-in-model' && jobId) {
      const job = app.jobs.findKnownJob(jobId);
      const artifact = app.state.data.activeJob.artifacts.find(
        (entry) => entry.id === actionTarget.dataset.artifactId
      );
      if (!job || !artifact) return;
      try {
        await app.workspace.openConfigArtifactInModel(job, artifact);
      } catch (error) {
        logActionFailure('Artifacts', error, 'artifact');
      }
      return;
    }

    if (
      (
        action === 'run-artifact-inspect'
        || action === 'run-artifact-report'
        || action === 'run-artifact-readiness-pack'
        || action === 'run-artifact-standard-docs'
        || action === 'run-artifact-pack'
      )
      && jobId
    ) {
      try {
        const artifact = app.state.data.activeJob.artifacts.find(
          (entry) => entry.id === actionTarget.dataset.artifactId
        );
        const nextType = action === 'run-artifact-inspect'
          ? 'inspect'
          : action === 'run-artifact-report'
            ? 'report'
            : action === 'run-artifact-readiness-pack'
              ? 'readiness-pack'
              : action === 'run-artifact-standard-docs'
                ? 'generate-standard-docs'
                : 'pack';
        await app.submitTrackedStudioRun({
          type: nextType,
          artifactRef: buildStudioArtifactRef(jobId, actionTarget.dataset.artifactId),
          completionAction: {
            type: 'tracked-run-completion',
            sourceArtifactFamily: deriveStudioArtifactFamily(artifact),
          },
        });
      } catch (error) {
        logActionFailure('Tracked run', error);
      }
      return;
    }

    if (
      (action === 'artifacts-run-compare' || action === 'artifacts-run-stabilization')
      && actionTarget.dataset.baselineJobId
      && actionTarget.dataset.baselineArtifactId
      && actionTarget.dataset.candidateJobId
      && actionTarget.dataset.candidateArtifactId
    ) {
      try {
        await app.submitTrackedStudioRun({
          type: action === 'artifacts-run-compare' ? 'compare-rev' : 'stabilization-review',
          baselineArtifactRef: buildStudioArtifactRef(
            actionTarget.dataset.baselineJobId,
            actionTarget.dataset.baselineArtifactId
          ),
          candidateArtifactRef: buildStudioArtifactRef(
            actionTarget.dataset.candidateJobId,
            actionTarget.dataset.candidateArtifactId
          ),
          completionAction: {
            preferredRoute: 'artifacts',
          },
        });
      } catch (error) {
        logActionFailure('Tracked run', error);
      }
    }
  }

  if (!ensureShellContract(app.elements, {
    windowRef,
    documentRef,
    navigatorRef: windowRef.navigator,
  })) {
    return app;
  }

  app.elements.workspaceRoot.addEventListener('click', async (event) => {
    const actionTarget = app.routing.findActionTarget(event.target);
    if (!actionTarget) return;
    await handleShellAction(actionTarget);
  });

  app.elements.completionNoticeHost?.addEventListener('click', async (event) => {
    const actionTarget = app.routing.findActionTarget(event.target);
    if (!actionTarget) return;
    await handleShellAction(actionTarget);
  });

  app.elements.jobsDrawer.addEventListener('click', async (event) => {
    const actionTarget = app.routing.findActionTarget(event.target);
    if (!actionTarget) return;
    await handleShellAction(actionTarget);
  });

  app.elements.workspaceRoot.addEventListener('change', async (event) => {
    const target = event.target;
    if (!(target instanceof windowRef.HTMLElement)) return;

    if (target.matches('[data-action="select-example"]')) {
      app.state.data.examples.selectedId = target.value;
      app.commitRender();
      return;
    }

    if (target instanceof windowRef.HTMLInputElement && target.id === 'start-config-file') {
      const [file] = [...(target.files || [])];
      await app.workspace.openConfigFile(file);
      target.value = '';
      return;
    }

    if (target instanceof windowRef.HTMLInputElement && target.id === 'guided-import-model-file') {
      const [file] = [...(target.files || [])];
      if (file) await previewImportBootstrap({ file });
    }
  });

  app.elements.workspaceRoot.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof windowRef.HTMLElement)) return;

    if (target.matches('[data-field="prompt-text"]')) {
      app.state.data.model.promptText = target.value;
      app.state.data.model.promptMode = true;
    } else if (target.matches('[data-field="config-text"]')) {
      app.state.data.model.configText = target.value;
      app.state.data.model.editingEnabled = true;
      invalidateAiDraftValidation(app.state.data.model);
    } else if (target.matches('[data-field="import-model-path"]')) {
      currentImportBootstrap().modelPath = target.value;
    } else if (target.matches('[data-field="import-bom-path"]')) {
      currentImportBootstrap().bomPath = target.value;
    } else if (target.matches('[data-field="import-inspection-path"]')) {
      currentImportBootstrap().inspectionPath = target.value;
    } else if (target.matches('[data-field="import-quality-path"]')) {
      currentImportBootstrap().qualityPath = target.value;
    } else if (target.matches('[data-field="import-correction-kind"]')) {
      currentImportBootstrap().corrections.importKind = target.value;
    } else if (target.matches('[data-field="import-correction-unit"]')) {
      currentImportBootstrap().corrections.unit = target.value;
    } else if (target.matches('[data-field="import-correction-body-count"]')) {
      currentImportBootstrap().corrections.bodyCount = target.value;
    } else if (target.matches('[data-field="import-correction-note"]')) {
      currentImportBootstrap().corrections.note = target.value;
    }
  });

  windowRef.addEventListener('hashchange', app.routing.handleHashChange);
  windowRef.addEventListener('resize', () => {
    if (windowRef.innerWidth > 920 && app.elements.sidebar.classList.contains('is-open')) {
      app.dom.setSidebar(false);
    }
  });
  app.elements.workspaceNav.addEventListener('keydown', app.routing.handleNavKeydown);
  app.elements.advancedModeToggle.addEventListener('change', () => {
    app.state.experienceMode = writeStudioExperienceMode(
      storage,
      app.elements.advancedModeToggle.checked ? 'advanced' : 'default'
    );
    app.commitRender();
  });
  app.elements.workspaceNav.addEventListener('click', (event) => {
    if (!(event.target instanceof windowRef.Element)) return;
    const link = event.target.closest('a[href]');
    if (!link) return;
    const sidebarWasOpen = app.elements.sidebar.classList.contains('is-open');
    const sameRoute = link.classList.contains('nav-link')
      && (link.dataset.route || 'start') === app.state.route;
    if (sidebarWasOpen && sameRoute) event.preventDefault();
    app.dom.setSidebar(false, {
      restoreFocus: sidebarWasOpen && sameRoute,
    });
  });
  app.elements.navToggle.addEventListener('click', () => {
    app.dom.setSidebar(!app.elements.sidebar.classList.contains('is-open'));
  });
  app.elements.sidebarScrim.addEventListener('click', () => {
    app.dom.setSidebar(false, { restoreFocus: true });
  });
  app.elements.jobsToggle.addEventListener('click', () => {
    const open = !app.elements.jobsDrawer.classList.contains('is-open');
    const openedFromModalSidebar = open && app.elements.sidebar.classList.contains('is-open');
    if (openedFromModalSidebar) app.dom.setSidebar(false);
    app.dom.setJobsDrawer(open, {
      focusEntry: openedFromModalSidebar,
      returnFocusTarget: openedFromModalSidebar
        ? app.elements.navToggle
        : app.elements.jobsToggle,
    });
  });
  app.elements.jobsClose.addEventListener('click', () => {
    app.dom.setJobsDrawer(false, { restoreFocus: true });
  });
  app.elements.logToggle.addEventListener('click', () => {
    const open = !app.elements.logDrawer.classList.contains('is-open');
    const openedFromModalSidebar = open && app.elements.sidebar.classList.contains('is-open');
    if (openedFromModalSidebar) app.dom.setSidebar(false);
    app.dom.setLogDrawer(open, {
      focusEntry: openedFromModalSidebar,
      returnFocusTarget: openedFromModalSidebar
        ? app.elements.navToggle
        : app.elements.logToggle,
    });
  });
  app.elements.logClose.addEventListener('click', () => {
    app.dom.setLogDrawer(false, { restoreFocus: true });
  });
  windowRef.addEventListener('keydown', (event) => {
    if (app.dom.containSidebarFocus(event)) {
      return;
    }
    if (event.key === 'Escape' && app.elements.sidebar.classList.contains('is-open')) {
      app.dom.setSidebar(false, { restoreFocus: true });
    } else if (event.key === 'Escape' && app.elements.jobsDrawer.classList.contains('is-open')) {
      app.dom.setJobsDrawer(false, { restoreFocus: true });
    } else if (event.key === 'Escape' && app.elements.logDrawer.classList.contains('is-open')) {
      app.dom.setLogDrawer(false, { restoreFocus: true });
    }
  });
  initializeLocale();
  bindLocaleControls(documentRef.body);
  subscribeLocale(() => {
    app.commitRender();
  });

  app.commitRender();
  markStudioBooted({ windowRef });
  hydrateShell().catch((error) => {
    app.addLog({
      status: 'Studio shell',
      message: error instanceof Error ? error.message : String(error),
      tone: 'warn',
      time: 'boot',
    });
    console.error(error);
  });

  return app;
}
