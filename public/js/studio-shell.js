import { createLogEntry } from './studio/renderers.js';
import { fetchArtifactText } from './studio/artifact-insights.js';
import { buildStudioArtifactRef, deriveStudioArtifactFamily } from './studio/artifact-actions.js';
import { mountArtifactsWorkspace } from './studio/artifacts-workspace.js';
import { mountDrawingWorkspace } from './studio/drawing-workspace.js';
import {
  describeJobMonitorTransition,
  ensureStudioJobMonitorState,
  findStudioMonitoredJob,
  listActiveStudioMonitoredJobs,
  mergeTrackedJobIntoRecentJobs,
  resolveMonitoredJobCompletionTarget,
  syncActiveJobsIntoMonitor,
  upsertStudioMonitoredJob,
} from './studio/job-monitor.js';
import {
  cancelStudioJob,
  findResumableStudioJobs,
  isActiveStudioJobStatus,
  pollStudioJob,
  refreshStudioJobs,
  retryStudioJob,
  submitStudioTrackedJob,
} from './studio/jobs-client.js';
import { renderJobsCenter, shortJobId } from './studio/jobs-center.js';
import { mountModelWorkspace } from './studio/model-workspace.js';
import { mountReviewWorkspace } from './studio/review-workspace.js';
import {
  deriveStudioChromeState,
  deriveStudioWorkspaceSelection,
  parseStudioLocationState,
  routeSupportsSelectedJob,
  serializeStudioLocationState,
} from './studio/studio-state.js';
import { workspaceDefinitions } from './studio/workspaces.js';

const workspaceRoot = document.getElementById('workspace-root');
const completionNoticeHost = document.getElementById('completion-notice-host');
const workspaceSummary = document.getElementById('workspace-summary');
const runtimeBadge = document.getElementById('runtime-badge');
const projectBadge = document.getElementById('project-badge');
const connectionBadge = document.getElementById('connection-badge');
const jobBadge = document.getElementById('job-badge');
const jobsToggle = document.getElementById('jobs-toggle');
const jobsClose = document.getElementById('jobs-close');
const jobsDrawer = document.getElementById('jobs-drawer');
const jobsCenterContent = document.getElementById('jobs-center-content');
const logToggle = document.getElementById('log-toggle');
const logClose = document.getElementById('log-close');
const logDrawer = document.getElementById('log-drawer');
const logFeed = document.getElementById('log-feed');
const navLinks = [...document.querySelectorAll('.nav-link')];
const RECENT_JOBS_LIMIT = 12;
const JOB_MONITOR_POLL_MS = 2000;
let activeWorkspaceController = null;
let jobMonitorTimer = null;
const jobMonitorErrors = new Map();
const initialLocationState = parseStudioLocationState(window.location);

const state = {
  route: initialLocationState.route,
  selectedJobId: initialLocationState.selectedJobId,
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
      items: [],
      lastPollTime: null,
    },
    completionNotice: null,
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
      reportOptions: {
        includeDrawing: true,
        includeTolerance: true,
        includeDfm: false,
        includeCost: false,
        profileName: '',
        open: false,
      },
      trackedRun: {
        type: '',
        lastJobId: '',
        status: 'idle',
        submitting: false,
        error: '',
      },
      profileCatalog: {
        status: 'idle',
        items: [],
        message: '',
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
    const linkRoute = link.dataset.route || 'start';
    link.setAttribute(
      'href',
      serializeStudioLocationState({
        route: linkRoute,
        selectedJobId: routeSupportsSelectedJob(linkRoute) ? state.selectedJobId : '',
      })
    );
    const isActive = link.dataset.route === state.route;
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function renderCompletionNotice() {
  const notice = state.data.completionNotice;
  if (!completionNoticeHost) return;

  if (!notice) {
    completionNoticeHost.hidden = true;
    completionNoticeHost.replaceChildren();
    return;
  }

  completionNoticeHost.hidden = false;
  completionNoticeHost.replaceChildren(
    document.createElement('div')
  );
  const container = completionNoticeHost.firstElementChild;
  container.className = 'completion-notice';
  container.dataset.tone = notice.tone || 'info';

  const copy = document.createElement('div');
  copy.className = 'completion-notice-copy';

  const title = document.createElement('p');
  title.className = 'completion-notice-title';
  title.textContent = notice.title;
  copy.append(title);

  const message = document.createElement('p');
  message.className = 'completion-notice-message';
  message.textContent = notice.message;
  copy.append(message);

  const actions = document.createElement('div');
  actions.className = 'completion-notice-actions';

  const primaryButton = document.createElement('button');
  primaryButton.className = 'action-button action-button-primary';
  primaryButton.type = 'button';
  primaryButton.dataset.action = 'open-job';
  primaryButton.dataset.jobId = notice.jobId;
  primaryButton.dataset.route = notice.primaryRoute;
  primaryButton.textContent = notice.primaryLabel;
  actions.append(primaryButton);

  if (notice.secondaryRoute) {
    const secondaryButton = document.createElement('button');
    secondaryButton.className = 'action-button action-button-ghost';
    secondaryButton.type = 'button';
    secondaryButton.dataset.action = 'open-job';
    secondaryButton.dataset.jobId = notice.jobId;
    secondaryButton.dataset.route = notice.secondaryRoute;
    secondaryButton.textContent = notice.secondaryLabel;
    actions.append(secondaryButton);
  }

  const dismissButton = document.createElement('button');
  dismissButton.className = 'action-button action-button-ghost';
  dismissButton.type = 'button';
  dismissButton.dataset.action = 'dismiss-completion-notice';
  dismissButton.dataset.jobId = notice.jobId;
  dismissButton.textContent = 'Dismiss';
  actions.append(dismissButton);

  container.append(copy, actions);
}

function renderJobsDrawer() {
  jobsCenterContent.replaceChildren(
    renderJobsCenter({
      recentJobs: state.data.recentJobs.items || [],
      jobMonitor: state.data.jobMonitor || {},
      activeJobId: state.data.activeJob.summary?.id || '',
      limit: RECENT_JOBS_LIMIT,
    })
  );
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
      openJob,
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
  renderCompletionNotice();
  renderWorkspace();
  renderJobsDrawer();
  renderLogs();
}

function refreshShellChrome({ syncWorkspace = false } = {}) {
  syncDerivedState();
  syncChrome();
  renderCompletionNotice();
  renderJobsDrawer();
  if (syncWorkspace) {
    activeWorkspaceController?.syncFromShell?.();
  }
}

function addLog(entry) {
  state.logs.unshift(entry);
  if (state.logs.length > 10) state.logs.length = 10;
  renderLogs();
}

function setRoute(nextRoute, { focus = false, hash = false, selectedJobId } = {}) {
  const nextLocation = deriveStudioWorkspaceSelection(
    {
      route: state.route,
      selectedJobId: state.selectedJobId,
    },
    {
      route: nextRoute,
      ...(selectedJobId !== undefined ? { selectedJobId } : {}),
    }
  );
  state.route = nextLocation.route;
  state.selectedJobId = nextLocation.selectedJobId;
  if (hash) {
    const nextHash = serializeStudioLocationState(nextLocation);
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
  setRoute(route, {
    focus: true,
    hash: true,
    ...(options.selectedJobId !== undefined ? { selectedJobId: options.selectedJobId } : {}),
  });
}

function setLogDrawer(open) {
  logDrawer.classList.toggle('is-open', open);
  logToggle.setAttribute('aria-expanded', String(open));
}

function setJobsDrawer(open) {
  jobsDrawer.classList.toggle('is-open', open);
  jobsToggle.setAttribute('aria-expanded', String(open));
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

function findKnownJob(jobId) {
  return state.data.recentJobs.items.find((job) => job.id === jobId)
    || (state.data.activeJob.summary?.id === jobId ? state.data.activeJob.summary : null)
    || findStudioMonitoredJob(state.data.jobMonitor, jobId)
    || null;
}

function syncJobIntoState(job) {
  if (!job?.id) return;

  const nextItems = mergeTrackedJobIntoRecentJobs(job, state.data.recentJobs.items, RECENT_JOBS_LIMIT);

  state.data.recentJobs = {
    status: nextItems.length > 0 ? 'ready' : 'empty',
    items: nextItems,
    message: nextItems.length > 0 ? '' : 'No jobs have been tracked yet on this local API instance.',
  };

  if (state.data.activeJob.summary?.id === job.id) {
    state.data.activeJob.summary = job;
  }
}

function setCompletionNotice(notice = null) {
  state.data.completionNotice = notice;
  renderCompletionNotice();
}

function buildCompletionNotice(job, target, remainingActiveCount = 0) {
  const shortId = shortJobId(job.id);
  const primaryRoute = target.route || 'artifacts';
  const primaryLabel = primaryRoute === 'review' ? 'Open Review' : 'Open Artifacts';
  const secondaryRoute = target.secondaryRoute || '';
  const secondaryLabel = secondaryRoute === 'review' ? 'Open Review' : secondaryRoute === 'artifacts' ? 'Open Artifacts' : '';
  const completionCopy = primaryRoute === 'review'
    ? 'Review-ready outputs are available for the completed run.'
    : 'Tracked artifacts are ready for the completed run.';
  const handoffCopy = remainingActiveCount > 0
    ? ` Stayed on the current workspace while ${remainingActiveCount} other active job${remainingActiveCount === 1 ? '' : 's'} remain.`
    : ` Routed ${job.type} ${shortId} into ${primaryRoute}.`;

  return {
    jobId: job.id,
    tone: 'ok',
    title: `${job.type} ${shortId} settled`,
    message: `${completionCopy}${handoffCopy}`,
    primaryRoute,
    primaryLabel,
    secondaryRoute,
    secondaryLabel,
  };
}

function clearJobMonitorTimer() {
  if (jobMonitorTimer) {
    window.clearTimeout(jobMonitorTimer);
    jobMonitorTimer = null;
  }
}

function scheduleJobMonitoring() {
  clearJobMonitorTimer();
  if (listActiveStudioMonitoredJobs(state.data.jobMonitor).length === 0) return;
  jobMonitorTimer = window.setTimeout(() => {
    pollActiveJobs().catch(() => {});
  }, JOB_MONITOR_POLL_MS);
}

function logJobTransition(job, previousStatus, nextStatus, origin = 'monitor') {
  const transition = describeJobMonitorTransition(job, previousStatus, nextStatus, origin);
  addLog({
    status: 'Tracked run',
    message: transition.message,
    tone: transition.tone,
    time: 'job',
  });
}

async function runMonitoredJobCompletionAction(job, completionAction = null) {
  let artifacts = [];
  try {
    const payload = await fetchJson(`/jobs/${encodeURIComponent(job.id)}/artifacts`);
    artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
  } catch {
    artifacts = [];
  }

  const target = resolveMonitoredJobCompletionTarget(job, {
    artifacts,
    completionAction,
  });
  if (!target.route) return;

  const remainingActiveCount = listActiveStudioMonitoredJobs(state.data.jobMonitor)
    .filter((entry) => entry.id !== job.id)
    .length;

  setCompletionNotice(buildCompletionNotice(job, target, remainingActiveCount));

  if (remainingActiveCount > 0) {
    addLog({
      status: 'Tracked run',
      message: `${job.type} ${shortJobId(job.id)} finished. Completion handoff is ready in ${target.route} while other jobs continue.`,
      tone: 'ok',
      time: 'job',
    });
    refreshShellChrome({ syncWorkspace: true });
    return;
  }

  await openJob(job.id, { route: target.route, summaryHint: job });
}

async function refreshRecentJobs({ silent = false, preserveRender = false } = {}) {
  try {
    const items = await refreshStudioJobs(RECENT_JOBS_LIMIT);
    state.data.recentJobs = {
      status: items.length > 0 ? 'ready' : 'empty',
      items,
      message: items.length > 0 ? '' : 'No jobs have been tracked yet on this local API instance.',
    };
    state.data.jobMonitor = syncActiveJobsIntoMonitor(state.data.jobMonitor, items);
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
    if (preserveRender) {
      refreshShellChrome({ syncWorkspace: true });
    } else {
      commitRender();
    }
  }
}

async function pollActiveJobs() {
  const activeJobs = listActiveStudioMonitoredJobs(state.data.jobMonitor);
  if (activeJobs.length === 0) {
    clearJobMonitorTimer();
    refreshShellChrome({ syncWorkspace: true });
    return;
  }

  const polledAt = new Date().toISOString();
  const completedJobs = [];

  await Promise.all(activeJobs.map(async (entry) => {
    try {
      const job = await pollStudioJob(entry.id);
      if (!job) {
        throw new Error(`Tracked job ${entry.id} did not return a status payload.`);
      }

      jobMonitorErrors.delete(entry.id);
      syncJobIntoState(job);
      state.data.jobMonitor = upsertStudioMonitoredJob(state.data.jobMonitor, job, {
        lastPollTime: polledAt,
        completionAction: entry.completionAction,
      });

      if (entry.status !== job.status) {
        logJobTransition(job, entry.status, job.status);
      }

      if (!isActiveStudioJobStatus(job.status)) {
        completedJobs.push({ job, completionAction: entry.completionAction });
        state.data.jobMonitor = upsertStudioMonitoredJob(state.data.jobMonitor, job, {
          lastPollTime: polledAt,
          completionAction: null,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.data.jobMonitor = upsertStudioMonitoredJob(state.data.jobMonitor, entry, {
        lastPollTime: polledAt,
        completionAction: entry.completionAction,
      });
      if (jobMonitorErrors.get(entry.id) !== message) {
        jobMonitorErrors.set(entry.id, message);
        addLog({
          status: 'Tracked run',
          message: `Polling ${shortJobId(entry.id)} hit an error: ${message}`,
          tone: 'warn',
          time: 'job',
        });
      }
    }
  }));

  state.data.jobMonitor = ensureStudioJobMonitorState({
    ...state.data.jobMonitor,
    lastPollTime: polledAt,
  });
  refreshShellChrome({ syncWorkspace: true });

  if (completedJobs.length > 0) {
    await refreshRecentJobs({ silent: true, preserveRender: true });
    for (const entry of completedJobs) {
      await runMonitoredJobCompletionAction(entry.job, entry.completionAction);
    }
  }

  scheduleJobMonitoring();
}

function beginJobMonitoring(job, { origin = 'submit', completionAction = null, announce = true } = {}) {
  if (!job?.id) return;
  syncJobIntoState(job);
  const previous = findStudioMonitoredJob(state.data.jobMonitor, job.id);
  jobMonitorErrors.delete(job.id);
  state.data.jobMonitor = upsertStudioMonitoredJob(state.data.jobMonitor, job, {
    lastPollTime: new Date().toISOString(),
    completionAction,
  });
  if (announce) {
    logJobTransition(job, previous?.status || '', job.status, origin);
  }
  refreshShellChrome({ syncWorkspace: true });

  if (!isActiveStudioJobStatus(job.status)) {
    runMonitoredJobCompletionAction(job, completionAction).catch(() => {});
    state.data.jobMonitor = upsertStudioMonitoredJob(state.data.jobMonitor, job, {
      lastPollTime: new Date().toISOString(),
      completionAction: null,
    });
    refreshShellChrome({ syncWorkspace: true });
    return;
  }

  scheduleJobMonitoring();
}

function resumeJobMonitoring() {
  const knownMonitorIds = new Set(ensureStudioJobMonitorState(state.data.jobMonitor).items.map((job) => job.id));
  const resumableJobs = findResumableStudioJobs(state.data.recentJobs.items);
  if (resumableJobs.length === 0) return;

  state.data.jobMonitor = syncActiveJobsIntoMonitor(state.data.jobMonitor, resumableJobs);
  resumableJobs.forEach((job) => {
    if (!knownMonitorIds.has(job.id)) {
      logJobTransition(job, '', job.status, 'resume');
    }
  });
  refreshShellChrome({ syncWorkspace: true });
  scheduleJobMonitoring();
}

async function submitTrackedStudioRun({
  type,
  configToml,
  artifactRef,
  drawingSettings,
  drawingPreviewId,
  reportOptions,
  options,
  completionAction,
}) {
  const job = await submitStudioTrackedJob({
    type,
    configToml,
    artifactRef,
    drawingSettings,
    drawingPreviewId,
    reportOptions,
    options,
  });
  beginJobMonitoring(job, { origin: 'submit', completionAction });
  return job;
}

async function cancelTrackedJobById(jobId) {
  const payload = await cancelStudioJob(jobId);
  const job = payload?.job || null;
  if (!job?.id) {
    throw new Error(`Cancel for ${jobId} did not return a job payload.`);
  }

  syncJobIntoState(job);
  jobMonitorErrors.delete(job.id);
  state.data.jobMonitor = upsertStudioMonitoredJob(state.data.jobMonitor, job, {
    lastPollTime: new Date().toISOString(),
    completionAction: null,
  });
  addLog({
    status: 'Tracked run',
    message: `Cancelled queued ${job.type} ${shortJobId(job.id)}.`,
    tone: 'warn',
    time: 'job',
  });
  await refreshRecentJobs({ silent: true, preserveRender: true });
  scheduleJobMonitoring();
  return job;
}

async function retryTrackedJobById(jobId) {
  const payload = await retryStudioJob(jobId);
  const job = payload?.job || null;
  if (!job?.id) {
    throw new Error(`Retry for ${jobId} did not return a new job payload.`);
  }

  syncJobIntoState(job);
  addLog({
    status: 'Tracked run',
    message: `Retried ${shortJobId(jobId)} as ${job.type} ${shortJobId(job.id)}.`,
    tone: 'info',
    time: 'job',
  });
  beginJobMonitoring(job, { origin: 'submit', announce: false });
  await refreshRecentJobs({ silent: true, preserveRender: true });
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
  state.data.model = {
    ...state.data.model,
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
    sourcePath: example.path || state.data.examples.sourceLabel,
    configText: example.content || '',
  });
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
  applyConfigToSharedModel({
    sourceType: 'local file',
    sourceName: file.name,
    sourcePath: file.name,
    configText: text,
  });
  addLog({
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
    sourcePath: artifact.path || `${job?.type || 'job'} ${job?.id?.slice(0, 8) || 'unknown'}`,
    configText,
  });
  addLog({
    status: 'Artifacts',
    message: `Loaded ${artifact.file_name || artifact.key} from ${job?.type || 'job'} ${job?.id?.slice(0, 8) || 'unknown'} into Model.`,
    tone: 'ok',
    time: 'artifact',
  });
  navigateTo('model', { pendingFocus: 'config' });
}

async function openConfigFile(file) {
  if (!file) return;
  await loadConfigFileIntoSharedModel(file);
  navigateTo('model', { pendingFocus: 'config' });
}

async function fetchJobSummary(jobId, summaryHint = null) {
  if (!jobId) return null;

  const knownSummary = summaryHint?.id === jobId ? summaryHint : findKnownJob(jobId);
  if (knownSummary) return knownSummary;

  const payload = await fetchJson(`/jobs/${encodeURIComponent(jobId)}`);
  return payload?.job || null;
}

async function openJob(jobId, { route = 'artifacts', summaryHint = null } = {}) {
  const normalizedJobId = String(jobId || '').trim();
  if (!normalizedJobId) return;

  const currentJobId = state.data.activeJob.summary?.id || '';
  const sameJob = currentJobId === normalizedJobId;

  if (sameJob && state.data.activeJob.status === 'ready') {
    navigateTo(route, { selectedJobId: normalizedJobId });
    if (state.data.completionNotice?.jobId === normalizedJobId) {
      setCompletionNotice(null);
    }
    return;
  }

  let summary = null;
  try {
    summary = await fetchJobSummary(normalizedJobId, summaryHint);
  } catch {
    summary = null;
  }

  if (!summary) {
    summary = {
      id: normalizedJobId,
      type: 'job',
      status: 'unknown',
      updated_at: null,
      links: {},
    };
  }

  syncJobIntoState(summary);

  state.data.activeJob = {
    status: 'loading',
    summary,
    artifacts: [],
    manifest: null,
    storage: null,
    errorMessage: '',
  };
  if (!sameJob) {
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
  }
  navigateTo(route, { selectedJobId: normalizedJobId });

  try {
    const payload = await fetchJson(summary.links?.artifacts || `/jobs/${encodeURIComponent(normalizedJobId)}/artifacts`);
    state.data.activeJob = {
      status: 'ready',
      summary,
      artifacts: Array.isArray(payload?.artifacts) ? payload.artifacts : [],
      manifest: payload?.manifest || null,
      storage: payload?.storage || null,
      errorMessage: '',
    };
    if (
      !state.data.artifactsWorkspace.selectedArtifactId
      || !state.data.activeJob.artifacts.some((artifact) => artifact.id === state.data.artifactsWorkspace.selectedArtifactId)
    ) {
      state.data.artifactsWorkspace.selectedArtifactId = state.data.activeJob.artifacts[0]?.id || '';
    }
    addLog({
      status: 'Artifacts',
      message: `Opened tracked artifacts for ${summary.type} ${normalizedJobId.slice(0, 8)}.`,
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
      message: `Could not load artifact details for ${summary.type} ${normalizedJobId.slice(0, 8)}.`,
      tone: 'warn',
      time: 'job',
    });
  } finally {
    if (state.data.completionNotice?.jobId === normalizedJobId) {
      setCompletionNotice(null);
    }
    commitRender();
  }
}

async function syncSelectedJobFromLocation() {
  if (!routeSupportsSelectedJob(state.route) || !state.selectedJobId) return;

  if (state.data.activeJob.summary?.id === state.selectedJobId) {
    return;
  }

  if (state.data.activeJob.status === 'loading' && state.data.activeJob.summary?.id === state.selectedJobId) {
    return;
  }

  await openJob(state.selectedJobId, { route: state.route });
}

async function hydrateShell() {
  await loadLandingPayload();
  await Promise.allSettled([
    refreshHealth(),
    loadExamples(),
    refreshRecentJobs(),
  ]);
  resumeJobMonitoring();
  await syncSelectedJobFromLocation();
}

function handleHashChange() {
  const nextLocation = parseStudioLocationState(window.location);
  state.route = nextLocation.route;
  state.selectedJobId = nextLocation.selectedJobId;
  commitRender();
  syncSelectedJobFromLocation().catch(() => {});
  workspaceRoot.focus();
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

async function handleShellAction(actionTarget) {
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
    await openJob(jobId, { route: actionTarget.dataset.route || 'artifacts' });
  } else if (action === 'open-review' && state.data.activeJob.summary) {
    navigateTo('review');
  } else if (action === 'open-artifacts' && state.data.activeJob.summary) {
    navigateTo('artifacts');
  } else if (action === 'dismiss-completion-notice') {
    if (!actionTarget.dataset.jobId || state.data.completionNotice?.jobId === actionTarget.dataset.jobId) {
      setCompletionNotice(null);
    }
  } else if (action === 'cancel-job' && jobId) {
    try {
      await cancelTrackedJobById(jobId);
    } catch (error) {
      addLog({
        status: 'Tracked run',
        message: error instanceof Error ? error.message : String(error),
        tone: 'warn',
        time: 'job',
      });
    }
  } else if (action === 'retry-job' && jobId) {
    try {
      await retryTrackedJobById(jobId);
    } catch (error) {
      addLog({
        status: 'Tracked run',
        message: error instanceof Error ? error.message : String(error),
        tone: 'warn',
        time: 'job',
      });
    }
  } else if (action === 'open-config-artifact-in-model' && jobId) {
    const job = findKnownJob(jobId);
    const artifact = state.data.activeJob.artifacts.find((entry) => entry.id === actionTarget.dataset.artifactId);
    if (!job || !artifact) return;
    try {
      await openConfigArtifactInModel(job, artifact);
    } catch (error) {
      addLog({
        status: 'Artifacts',
        message: error instanceof Error ? error.message : String(error),
        tone: 'warn',
        time: 'artifact',
      });
    }
  } else if ((action === 'run-artifact-inspect' || action === 'run-artifact-report') && jobId) {
    try {
      const artifact = state.data.activeJob.artifacts.find((entry) => entry.id === actionTarget.dataset.artifactId);
      await submitTrackedStudioRun({
        type: action === 'run-artifact-inspect' ? 'inspect' : 'report',
        artifactRef: buildStudioArtifactRef(jobId, actionTarget.dataset.artifactId),
        completionAction: {
          type: 'tracked-run-completion',
          sourceArtifactFamily: deriveStudioArtifactFamily(artifact),
        },
      });
    } catch (error) {
      addLog({
        status: 'Tracked run',
        message: error instanceof Error ? error.message : String(error),
        tone: 'warn',
        time: 'job',
      });
    }
  }
}

workspaceRoot.addEventListener('click', async (event) => {
  const actionTarget = findActionTarget(event.target);
  if (!actionTarget) return;
  await handleShellAction(actionTarget);
});

jobsDrawer.addEventListener('click', async (event) => {
  const actionTarget = findActionTarget(event.target);
  if (!actionTarget) return;
  await handleShellAction(actionTarget);
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
jobsToggle.addEventListener('click', () => setJobsDrawer(!jobsDrawer.classList.contains('is-open')));
jobsClose.addEventListener('click', () => setJobsDrawer(false));
logToggle.addEventListener('click', () => setLogDrawer(!logDrawer.classList.contains('is-open')));
logClose.addEventListener('click', () => setLogDrawer(false));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && jobsDrawer.classList.contains('is-open')) {
    setJobsDrawer(false);
    jobsToggle.focus();
  } else if (event.key === 'Escape' && logDrawer.classList.contains('is-open')) {
    setLogDrawer(false);
    logToggle.focus();
  }
});

commitRender();
hydrateShell();
