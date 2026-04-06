import { buildStudioArtifactRef, deriveStudioArtifactFamily } from './artifact-actions.js';
import { resolveSelectedStudioExampleId } from './examples.js';
import { deriveStudioChromeState } from './studio-state.js';
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
} from '../i18n/index.js';

export { localizedBootMessage, reportStudioBootFailure } from './studio-shell-dom.js';

function createFetchJson(windowRef = window) {
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
      throw new Error(`${url} returned ${response.status}`);
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

export function bootStudioShell({
  documentRef = document,
  windowRef = window,
  loadModelWorkspaceModule = () => import('./model-workspace.js'),
  loadDrawingWorkspaceModule = () => import('./drawing-workspace.js'),
} = {}) {
  const app = {
    document: documentRef,
    window: windowRef,
    navigator: windowRef.navigator,
    elements: bindStudioShellElements(documentRef),
    state: createStudioShellState(windowRef.location),
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
      const examples = await app.fetchJson('/api/examples');
      const items = Array.isArray(examples) ? examples : [];
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

  async function hydrateShell() {
    await loadLandingPayload();
    await Promise.allSettled([
      refreshHealth(),
      loadExamples(),
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

  async function handleShellAction(actionTarget) {
    const { action, jobId } = actionTarget.dataset;

    if (action === 'refresh-health') {
      await refreshHealth();
      return;
    }

    if (action === 'try-example') {
      app.workspace.openExample();
      return;
    }

    if (action === 'go-artifacts') {
      app.navigateTo('artifacts');
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
    }
  });

  windowRef.addEventListener('hashchange', app.routing.handleHashChange);
  app.elements.workspaceNav.addEventListener('keydown', app.routing.handleNavKeydown);
  app.elements.jobsToggle.addEventListener('click', () => {
    app.dom.setJobsDrawer(!app.elements.jobsDrawer.classList.contains('is-open'));
  });
  app.elements.jobsClose.addEventListener('click', () => app.dom.setJobsDrawer(false));
  app.elements.logToggle.addEventListener('click', () => {
    app.dom.setLogDrawer(!app.elements.logDrawer.classList.contains('is-open'));
  });
  app.elements.logClose.addEventListener('click', () => app.dom.setLogDrawer(false));
  windowRef.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && app.elements.jobsDrawer.classList.contains('is-open')) {
      app.dom.setJobsDrawer(false);
      app.elements.jobsToggle.focus();
    } else if (event.key === 'Escape' && app.elements.logDrawer.classList.contains('is-open')) {
      app.dom.setLogDrawer(false);
      app.elements.logToggle.focus();
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
