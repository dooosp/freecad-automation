import { createLogEntry } from './studio/renderers.js';
import { mountArtifactsWorkspace } from './studio/artifacts-workspace.js';
import { mountDrawingWorkspace } from './studio/drawing-workspace.js';
import {
  findResumableStudioJob,
  isActiveStudioJobStatus,
  pollStudioJob,
  refreshStudioJobs,
  studioJobTone,
  submitStudioTrackedJob,
} from './studio/jobs-client.js';
import { mountModelWorkspace } from './studio/model-workspace.js';
import { mountReviewWorkspace } from './studio/review-workspace.js';
import { deriveStudioChromeState, normalizeRoute } from './studio/studio-state.js';
import { workspaceDefinitions } from './studio/workspaces.js';

const workspaceRoot = document.getElementById('workspace-root');
const workspaceSummary = document.getElementById('workspace-summary');
const runtimeBadge = document.getElementById('runtime-badge');
const projectBadge = document.getElementById('project-badge');
const connectionBadge = document.getElementById('connection-badge');
const jobBadge = document.getElementById('job-badge');
const logToggle = document.getElementById('log-toggle');
const logClose = document.getElementById('log-close');
const logDrawer = document.getElementById('log-drawer');
const logFeed = document.getElementById('log-feed');
const navLinks = [...document.querySelectorAll('.nav-link')];
const RECENT_JOBS_LIMIT = 6;
const JOB_MONITOR_POLL_MS = 2000;
let activeWorkspaceController = null;
let jobMonitorTimer = null;
let jobMonitorError = '';

const state = {
  route: normalizeRoute(window.location.hash),
  connectionState: 'placeholder',
  connectionLabel: 'checking',
  runtimeTone: 'info',
  runtimeToneLabel: 'checking',
  pendingFocus: null,
  data: {
    landing: null,
    health: {
      status: 'loading',
      reachable: false,
      available: false,
      runtimeSummary: '',
      runtimePath: '',
      pythonVersion: '',
      freecadVersion: '',
      projectRoot: '',
      checkedAt: null,
      warnings: [],
      errors: [],
      fallbackMessage: '',
    },
    examples: {
      status: 'loading',
      items: [],
      selectedName: '',
      sourceLabel: 'configs/examples',
      message: '',
    },
    recentJobs: {
      status: 'loading',
      items: [],
      message: '',
    },
    jobMonitor: {
      activeRunId: '',
      activeRunStatus: 'idle',
      lastPollTime: null,
      enabled: false,
    },
    model: {
      sourceType: '',
      sourceName: '',
      sourcePath: '',
      configText: '',
      promptText: '',
      promptMode: false,
      editingEnabled: false,
      buildState: 'idle',
      buildSummary: '',
      errorMessage: '',
      buildLog: [],
      validation: {
        warnings: [],
        changed_fields: [],
        deprecated_fields: [],
      },
      overview: null,
      preview: null,
      assistant: {
        busy: false,
        error: '',
        report: null,
      },
      buildSettings: {
        include_step: true,
        include_stl: true,
        per_part_stl: true,
      },
      controls: {
        wireframe: false,
        edges: true,
        opacity: 100,
      },
    },
    drawing: {
      status: 'idle',
      summary: 'Generate drawing to open the sheet-first workbench.',
      errorMessage: '',
      preview: null,
      settings: {
        views: ['front', 'top', 'right', 'iso'],
        scale: 'auto',
        section_assist: false,
        detail_assist: false,
      },
      history: [],
      historyIndex: -1,
    },
    activeJob: {
      status: 'idle',
      summary: null,
      artifacts: [],
      manifest: null,
      storage: null,
      errorMessage: '',
    },
    review: {
      status: 'idle',
      jobId: '',
      cards: [],
      selectedCardId: '',
      errorMessage: '',
      cache: {},
    },
    artifactsWorkspace: {
      selectedArtifactId: '',
      previewStatus: 'idle',
      previewText: '',
      previewArtifactId: '',
      previewError: '',
      compare: {
        jobId: '',
        status: 'idle',
        errorMessage: '',
        job: null,
        artifacts: [],
      },
      cache: {},
    },
  },
  logs: [
    {
      status: 'Studio shell',
      message: 'Start is now the default launchpad while legacy viewer behavior remains available in parallel.',
      tone: 'info',
      time: 'boot',
    },
  ],
};

function setBadgeText(element, text, title = text) {
  element.textContent = text;
  element.title = title;
}

function setBadgeTone(element, tone = 'info') {
  element.dataset.tone = tone;
}

function syncDerivedState() {
  Object.assign(state, deriveStudioChromeState(state.data));
}

function syncChrome() {
  const workspace = workspaceDefinitions[state.route];
  document.title = `${workspace.label} | FreeCAD Automation Studio`;
  workspaceSummary.textContent = workspace.summary;
  setBadgeText(runtimeBadge, state.runtimeBadgeText);
  setBadgeText(projectBadge, state.projectBadgeText, state.projectBadgeTitle);
  setBadgeText(connectionBadge, state.connectionBadgeText);
  setBadgeText(jobBadge, state.jobBadgeText, state.jobBadgeTitle || state.jobBadgeText);
  setBadgeTone(jobBadge, state.jobBadgeTone || 'info');

  navLinks.forEach((link) => {
    const isActive = link.dataset.route === state.route;
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function renderWorkspace() {
  activeWorkspaceController?.destroy?.();
  activeWorkspaceController = null;
  workspaceRoot.replaceChildren(workspaceDefinitions[state.route].render(state));
  if (state.route === 'model') {
    activeWorkspaceController = mountModelWorkspace({
      root: workspaceRoot,
      state,
      addLog,
      submitTrackedJob: submitTrackedStudioRun,
    });
  } else if (state.route === 'drawing') {
    activeWorkspaceController = mountDrawingWorkspace({
      root: workspaceRoot,
      state,
      addLog,
      navigateTo,
      loadSelectedExampleIntoSharedModel,
      loadConfigFileIntoSharedModel,
      submitTrackedJob: submitTrackedStudioRun,
    });
  } else if (state.route === 'review') {
    activeWorkspaceController = mountReviewWorkspace({
      root: workspaceRoot,
      state,
      addLog,
      openJob,
    });
  } else if (state.route === 'artifacts') {
    activeWorkspaceController = mountArtifactsWorkspace({
      root: workspaceRoot,
      state,
      addLog,
      openJob,
      fetchJson,
    });
  }
  applyPendingFocus();
}

function renderLogs() {
  logFeed.replaceChildren(...state.logs.map((entry) => createLogEntry(entry)));
}

function commitRender() {
  syncDerivedState();
  syncChrome();
  renderWorkspace();
  renderLogs();
}

function refreshShellChrome() {
  syncDerivedState();
  syncChrome();
}

function addLog(entry) {
  state.logs.unshift(entry);
  if (state.logs.length > 10) state.logs.length = 10;
  renderLogs();
}

function setRoute(nextRoute, { focus = false, hash = false } = {}) {
  state.route = workspaceDefinitions[nextRoute] ? nextRoute : 'start';
  if (hash) {
    const nextHash = `#${state.route}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
      return;
    }
  }
  commitRender();
  if (focus) workspaceRoot.focus();
}

function navigateTo(route, options = {}) {
  state.pendingFocus = options.pendingFocus || null;
  setRoute(route, { focus: true, hash: true });
}

function setLogDrawer(open) {
  logDrawer.classList.toggle('is-open', open);
  logToggle.setAttribute('aria-expanded', String(open));
}

function applyPendingFocus() {
  if (!state.pendingFocus) return;
  requestAnimationFrame(() => {
    const selector = state.pendingFocus === 'prompt'
      ? '[data-field="prompt-text"]'
      : state.pendingFocus === 'config'
        ? '[data-field="config-text"]'
        : null;
    if (selector) {
      const target = workspaceRoot.querySelector(selector);
      if (target instanceof HTMLElement) target.focus();
    }
    state.pendingFocus = null;
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
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
}

function sortJobsByUpdatedAt(jobs = []) {
  return [...jobs].sort((left, right) => {
    const rightTime = Date.parse(right.updated_at || right.created_at || 0);
    const leftTime = Date.parse(left.updated_at || left.created_at || 0);
    return rightTime - leftTime;
  });
}

function findKnownJob(jobId) {
  return state.data.recentJobs.items.find((job) => job.id === jobId)
    || (state.data.activeJob.summary?.id === jobId ? state.data.activeJob.summary : null)
    || null;
}

function syncJobIntoState(job) {
  if (!job?.id) return;

  const nextItems = sortJobsByUpdatedAt([
    job,
    ...state.data.recentJobs.items.filter((entry) => entry.id !== job.id),
  ]).slice(0, RECENT_JOBS_LIMIT);

  state.data.recentJobs = {
    status: nextItems.length > 0 ? 'ready' : 'empty',
    items: nextItems,
    message: nextItems.length > 0 ? '' : 'No jobs have been tracked yet on this local API instance.',
  };

  if (state.data.activeJob.summary?.id === job.id) {
    state.data.activeJob.summary = job;
  }
}

function clearJobMonitorTimer() {
  if (jobMonitorTimer) {
    window.clearTimeout(jobMonitorTimer);
    jobMonitorTimer = null;
  }
}

function setJobMonitorState({ jobId = '', status = 'idle', enabled = false, lastPollTime = null }) {
  state.data.jobMonitor = {
    activeRunId: jobId,
    activeRunStatus: status,
    lastPollTime,
    enabled,
  };
  refreshShellChrome();
}

function logJobTransition(job, previousStatus, nextStatus, origin = 'monitor') {
  const shortId = job.id?.slice(0, 8) || 'unknown';
  const message = previousStatus && previousStatus !== nextStatus
    ? `${job.type} ${shortId} moved from ${previousStatus} to ${nextStatus}.`
    : `${origin === 'resume' ? 'Resumed' : 'Started'} monitoring ${job.type} ${shortId} in ${nextStatus}.`;
  addLog({
    status: 'Tracked run',
    message,
    tone: studioJobTone(nextStatus),
    time: 'job',
  });
}

async function refreshRecentJobs({ silent = false } = {}) {
  try {
    const items = await refreshStudioJobs(RECENT_JOBS_LIMIT);
    state.data.recentJobs = {
      status: items.length > 0 ? 'ready' : 'empty',
      items,
      message: items.length > 0 ? '' : 'No jobs have been tracked yet on this local API instance.',
    };
    if (!silent) {
      addLog({
        status: 'Recent jobs',
        message: items.length > 0
          ? `Loaded ${items.length} tracked jobs for quick re-entry into artifacts.`
          : 'Local API is reachable, but no tracked jobs exist yet.',
        tone: items.length > 0 ? 'ok' : 'info',
        time: 'jobs',
      });
    }
    return items;
  } catch {
    state.data.recentJobs = {
      status: 'unavailable',
      items: [],
      message: 'Recent job history requires the local API path from `fcad serve`.',
    };
    return [];
  } finally {
    commitRender();
  }
}

async function pollActiveRun() {
  const { activeRunId, activeRunStatus, enabled } = state.data.jobMonitor;
  if (!enabled || !activeRunId) return;

  try {
    const job = await pollStudioJob(activeRunId);
    if (!job) {
      throw new Error(`Tracked job ${activeRunId} did not return a status payload.`);
    }

    jobMonitorError = '';
    syncJobIntoState(job);
    setJobMonitorState({
      jobId: job.id,
      status: job.status,
      enabled: isActiveStudioJobStatus(job.status),
      lastPollTime: new Date().toISOString(),
    });

    if (activeRunStatus !== job.status) {
      logJobTransition(job, activeRunStatus, job.status);
    }

    if (!isActiveStudioJobStatus(job.status)) {
      clearJobMonitorTimer();
      await refreshRecentJobs({ silent: true });
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.data.jobMonitor.lastPollTime = new Date().toISOString();
    refreshShellChrome();
    if (jobMonitorError !== message) {
      jobMonitorError = message;
      addLog({
        status: 'Tracked run',
        message: `Polling ${activeRunId.slice(0, 8)} hit an error: ${message}`,
        tone: 'warn',
        time: 'job',
      });
    }
  }

  clearJobMonitorTimer();
  if (state.data.jobMonitor.enabled) {
    jobMonitorTimer = window.setTimeout(() => {
      pollActiveRun().catch(() => {});
    }, JOB_MONITOR_POLL_MS);
  }
}

function beginJobMonitoring(job, { origin = 'submit' } = {}) {
  if (!job?.id) return;
  clearJobMonitorTimer();
  jobMonitorError = '';
  syncJobIntoState(job);
  setJobMonitorState({
    jobId: job.id,
    status: job.status,
    enabled: isActiveStudioJobStatus(job.status),
    lastPollTime: new Date().toISOString(),
  });
  logJobTransition(job, '', job.status, origin);

  if (state.data.jobMonitor.enabled) {
    jobMonitorTimer = window.setTimeout(() => {
      pollActiveRun().catch(() => {});
    }, JOB_MONITOR_POLL_MS);
  }
}

function resumeJobMonitoring() {
  if (state.data.jobMonitor.enabled && state.data.jobMonitor.activeRunId) return;
  const resumableJob = findResumableStudioJob(state.data.recentJobs.items);
  if (!resumableJob) return;
  beginJobMonitoring(resumableJob, { origin: 'resume' });
}

async function submitTrackedStudioRun({
  type,
  configToml,
  drawingSettings,
  reportOptions,
  options,
}) {
  const job = await submitStudioTrackedJob({
    type,
    configToml,
    drawingSettings,
    reportOptions,
    options,
  });
  beginJobMonitoring(job, { origin: 'submit' });
  return job;
}

async function loadLandingPayload() {
  try {
    const landing = await fetchJson('/');
    if (landing?.mode !== 'local_api') {
      throw new Error('Not on local API landing path');
    }
    state.data.landing = landing;
    state.data.health.projectRoot = landing.project_root || state.data.health.projectRoot;
    addLog({
      status: 'Connection',
      message: 'Local API landing payload detected. Start can use runtime health and tracked jobs.',
      tone: 'ok',
      time: 'api',
    });
  } catch {
    state.data.landing = null;
  } finally {
    commitRender();
  }
}

function resolveRuntimePath(runtime = {}) {
  return runtime?.selected_runtime?.executable
    || runtime?.selected_runtime?.runtime_executable
    || runtime?.selected_runtime?.python_executable
    || runtime?.runtime_executable
    || runtime?.python_executable
    || '';
}

async function refreshHealth() {
  try {
    const health = await fetchJson('/health');
    state.data.health = {
      status: 'ready',
      reachable: true,
      available: Boolean(health?.runtime?.available),
      runtimeSummary: health?.runtime?.description || 'Runtime diagnostics available.',
      runtimePath: resolveRuntimePath(health?.runtime),
      pythonVersion: health?.runtime?.version_details?.python?.version || '',
      freecadVersion: health?.runtime?.version_details?.freecad?.version || '',
      projectRoot: state.data.landing?.project_root || state.data.health.projectRoot,
      checkedAt: new Date().toISOString(),
      warnings: Array.isArray(health?.runtime?.warnings) ? health.runtime.warnings : [],
      errors: Array.isArray(health?.runtime?.errors) ? health.runtime.errors : [],
      fallbackMessage: '',
    };
    addLog({
      status: state.data.health.available ? 'Runtime ready' : 'Runtime check',
      message: state.data.health.runtimeSummary,
      tone: state.data.health.available ? 'ok' : 'warn',
      time: 'health',
    });
  } catch {
    state.data.health = {
      ...state.data.health,
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
      fallbackMessage: state.connectionState === 'legacy'
        ? 'Legacy shell detected. Example loading can still work, but /health and tracked jobs are not exposed here.'
        : 'No /health endpoint responded. The shell stays usable, but runtime posture cannot be verified from here.',
    };
  } finally {
    commitRender();
  }
}

async function loadExamples() {
  try {
    const examples = await fetchJson('/api/examples');
    const items = Array.isArray(examples) ? examples : [];
    state.data.examples.items = items;
    state.data.examples.status = items.length > 0 ? 'ready' : 'empty';
    state.data.examples.selectedName = state.data.examples.selectedName || items[0]?.name || '';
    state.data.examples.message = items.length > 0 ? '' : 'The examples source returned no TOML files.';
    if (items.length > 0 && state.data.health.status === 'unavailable') {
      state.data.health.fallbackMessage = 'Legacy shell detected. Examples still load, but runtime health and tracked jobs require the local API path from `fcad serve`.';
    }
    addLog({
      status: 'Examples',
      message: items.length > 0
        ? `Loaded ${items.length} examples from the checked-in examples source.`
        : 'Examples endpoint responded but returned no example configs.',
      tone: items.length > 0 ? 'ok' : 'warn',
      time: 'examples',
    });
  } catch {
    state.data.examples.status = 'unavailable';
    state.data.examples.items = [];
    state.data.examples.selectedName = '';
    state.data.examples.message = 'Examples are not available on this serve path.';
  } finally {
    commitRender();
  }
}

function getSelectedExample() {
  return state.data.examples.items.find((example) => example.name === state.data.examples.selectedName)
    || state.data.examples.items[0]
    || null;
}

function resetDrawingWorkspaceState() {
  state.data.drawing = {
    ...state.data.drawing,
    status: 'idle',
    summary: 'Generate drawing to open the sheet-first workbench.',
    errorMessage: '',
    preview: null,
    history: [],
    historyIndex: -1,
  };
}

function applyExampleToSharedModel(example) {
  if (!example) return;

  state.data.model = {
    ...state.data.model,
    sourceType: 'example',
    sourceName: example.name,
    sourcePath: example.path || state.data.examples.sourceLabel,
    configText: example.content || '',
    promptMode: false,
    editingEnabled: true,
  };
  resetDrawingWorkspaceState();
}

function loadSelectedExampleIntoSharedModel() {
  const example = getSelectedExample();
  if (!example) return;

  applyExampleToSharedModel(example);
  addLog({
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
  navigateTo('model', { pendingFocus: 'config' });
}

function openPromptFlow() {
  state.data.model.promptMode = true;
  addLog({
    status: 'Launchpad',
    message: 'Prompt drafting is ready in the Model workspace.',
    tone: 'info',
    time: 'start',
  });
  navigateTo('model', { pendingFocus: 'prompt' });
}

async function loadConfigFileIntoSharedModel(file) {
  if (!file) return;
  const text = await file.text();
  state.data.model = {
    ...state.data.model,
    sourceType: 'local file',
    sourceName: file.name,
    sourcePath: file.name,
    configText: text,
    promptMode: false,
    editingEnabled: true,
  };
  resetDrawingWorkspaceState();
  addLog({
    status: 'Launchpad',
    message: `Loaded ${file.name} into the shared studio config state.`,
    tone: 'ok',
    time: 'file',
  });
}

async function openConfigFile(file) {
  if (!file) return;
  await loadConfigFileIntoSharedModel(file);
  navigateTo('model', { pendingFocus: 'config' });
}

async function openJob(jobId, { route = 'artifacts' } = {}) {
  const summary = findKnownJob(jobId);
  if (!summary) return;

  state.data.activeJob = {
    status: 'loading',
    summary,
    artifacts: [],
    manifest: null,
    storage: null,
    errorMessage: '',
  };
  state.data.review = {
    ...state.data.review,
    status: 'idle',
    jobId: '',
    cards: [],
    selectedCardId: '',
    errorMessage: '',
  };
  state.data.artifactsWorkspace = {
    ...state.data.artifactsWorkspace,
    selectedArtifactId: '',
    previewStatus: 'idle',
    previewText: '',
    previewArtifactId: '',
    previewError: '',
    compare: {
      jobId: '',
      status: 'idle',
      errorMessage: '',
      job: null,
      artifacts: [],
    },
  };
  navigateTo(route);

  try {
    const payload = await fetchJson(summary.links?.artifacts || `/jobs/${jobId}/artifacts`);
    state.data.activeJob = {
      status: 'ready',
      summary,
      artifacts: Array.isArray(payload?.artifacts) ? payload.artifacts : [],
      manifest: payload?.manifest || null,
      storage: payload?.storage || null,
      errorMessage: '',
    };
    state.data.artifactsWorkspace.selectedArtifactId = state.data.activeJob.artifacts[0]?.id || '';
    addLog({
      status: 'Artifacts',
      message: `Opened tracked artifacts for ${summary.type} ${jobId.slice(0, 8)}.`,
      tone: 'ok',
      time: 'job',
    });
  } catch {
    state.data.activeJob = {
      status: 'unavailable',
      summary,
      artifacts: [],
      manifest: null,
      storage: null,
      errorMessage: 'Artifact details could not be loaded from the local API.',
    };
    addLog({
      status: 'Artifacts',
      message: `Could not load artifact details for ${summary.type} ${jobId.slice(0, 8)}.`,
      tone: 'warn',
      time: 'job',
    });
  } finally {
    commitRender();
  }
}

async function hydrateShell() {
  await loadLandingPayload();
  await Promise.allSettled([
    refreshHealth(),
    loadExamples(),
    refreshRecentJobs(),
  ]);
  resumeJobMonitoring();
}

function handleHashChange() {
  setRoute(normalizeRoute(window.location.hash), { focus: true });
}

function handleNavKeydown(event) {
  const currentIndex = navLinks.findIndex((link) => link === document.activeElement);
  if (currentIndex === -1) return;

  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    event.preventDefault();
    navLinks[(currentIndex + 1) % navLinks.length].focus();
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    event.preventDefault();
    navLinks[(currentIndex - 1 + navLinks.length) % navLinks.length].focus();
  }
}

function findActionTarget(target) {
  return target instanceof Element ? target.closest('[data-action]') : null;
}

workspaceRoot.addEventListener('click', async (event) => {
  const actionTarget = findActionTarget(event.target);
  if (!actionTarget) return;

  const { action, jobId } = actionTarget.dataset;
  if (action === 'refresh-health') {
    await refreshHealth();
  } else if (action === 'try-example') {
    openExample();
  } else if (action === 'open-config') {
    workspaceRoot.querySelector('#start-config-file')?.click();
  } else if (action === 'open-prompt-flow') {
    openPromptFlow();
  } else if (action === 'open-recent-job') {
    const firstJob = state.data.recentJobs.items[0];
    if (firstJob) await openJob(firstJob.id);
  } else if (action === 'open-job' && jobId) {
    await openJob(jobId);
  }
});

workspaceRoot.addEventListener('change', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.matches('[data-action="select-example"]')) {
    state.data.examples.selectedName = target.value;
    commitRender();
    return;
  }

  if (target instanceof HTMLInputElement && target.id === 'start-config-file') {
    const [file] = [...(target.files || [])];
    await openConfigFile(file);
    target.value = '';
  }
});

workspaceRoot.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.matches('[data-field="prompt-text"]')) {
    state.data.model.promptText = target.value;
    state.data.model.promptMode = true;
  } else if (target.matches('[data-field="config-text"]')) {
    state.data.model.configText = target.value;
    state.data.model.editingEnabled = true;
  }
});

window.addEventListener('hashchange', handleHashChange);
document.getElementById('workspace-nav').addEventListener('keydown', handleNavKeydown);
logToggle.addEventListener('click', () => setLogDrawer(!logDrawer.classList.contains('is-open')));
logClose.addEventListener('click', () => setLogDrawer(false));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && logDrawer.classList.contains('is-open')) {
    setLogDrawer(false);
    logToggle.focus();
  }
});

commitRender();
hydrateShell();
