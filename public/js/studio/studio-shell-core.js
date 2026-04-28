import { buildStudioArtifactRef, deriveStudioArtifactFamily } from './artifact-actions.js';
import { fetchCanonicalPackages } from './canonical-packages.js';
import {
  findStudioExampleById,
  resolveSelectedStudioExampleId,
  VERIFIED_BRACKET_EXAMPLE_ID,
} from './examples.js';
import {
  buildTrackedReportJobOptions,
  ensureModelTrackedRunState,
} from './model-tracked-runs.js';
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

  async function loadCanonicalPackages() {
    try {
      app.state.data.canonicalPackages = await fetchCanonicalPackages(app.fetchJson);
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
      app.navigateTo('model', {
        pendingFocus: app.state.data.model.configText ? 'config' : null,
      });
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
      app.dom.setJobsDrawer(true);
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
