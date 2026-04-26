import {
  findDefaultArtifactForJob,
} from './artifact-actions.js';
import {
  describeJobMonitorTransition,
  ensureStudioJobMonitorState,
  findStudioMonitoredJob,
  buildStudioJobCompletionNotice,
  listActiveStudioMonitoredJobs,
  mergeTrackedJobIntoRecentJobs,
  resolveMonitoredJobCompletionTarget,
  syncActiveJobsIntoMonitor,
  upsertStudioMonitoredJob,
} from './job-monitor.js';
import {
  cancelStudioJob,
  findResumableStudioJobs,
  isActiveStudioJobStatus,
  pollStudioJob,
  refreshStudioJobs,
  retryStudioJob,
  submitStudioTrackedJob,
} from './jobs-client.js';
import { shortJobId } from './jobs-center.js';
import { RECENT_JOBS_LIMIT, JOB_MONITOR_POLL_MS } from './studio-shell-store.js';

export function createStudioJobMonitorController(app) {
  let openJobRequestSeq = 0;

  function findKnownJob(jobId) {
    return app.state.data.recentJobs.items.find((job) => job.id === jobId)
      || (app.state.data.activeJob.summary?.id === jobId ? app.state.data.activeJob.summary : null)
      || findStudioMonitoredJob(app.state.data.jobMonitor, jobId)
      || null;
  }

  function syncJobIntoState(job) {
    if (!job?.id) return;

    const nextItems = mergeTrackedJobIntoRecentJobs(job, app.state.data.recentJobs.items, RECENT_JOBS_LIMIT);
    app.state.data.recentJobs = {
      status: nextItems.length > 0 ? 'ready' : 'empty',
      items: nextItems,
      message: nextItems.length > 0 ? '' : 'No jobs have been tracked yet on this local API instance.',
    };

    if (app.state.data.activeJob.summary?.id === job.id) {
      app.state.data.activeJob.summary = job;
    }
  }

  function setCompletionNotice(notice = null) {
    app.state.data.completionNotice = notice;
    app.dom.renderCompletionNotice();
  }

  function resetArtifactsWorkspaceForJobSwitch() {
    app.state.data.artifactsWorkspace = {
      ...app.state.data.artifactsWorkspace,
      selectedArtifactId: '',
      previewStatus: 'idle',
      previewText: '',
      previewArtifactId: '',
      previewError: '',
      viewerStatus: 'idle',
      viewerArtifactId: '',
      viewerError: '',
      viewerData: null,
      qualityStatus: 'loading',
      qualityError: '',
      qualityData: null,
      qualityCacheKey: '',
      compare: {
        jobId: '',
        status: 'idle',
        errorMessage: '',
        job: null,
        artifacts: [],
      },
    };
  }

  function clearJobMonitorTimer() {
    if (app.runtime.jobMonitorTimer) {
      app.window.clearTimeout(app.runtime.jobMonitorTimer);
      app.runtime.jobMonitorTimer = null;
    }
  }

  function scheduleJobMonitoring() {
    clearJobMonitorTimer();
    if (listActiveStudioMonitoredJobs(app.state.data.jobMonitor).length === 0) return;
    app.runtime.jobMonitorTimer = app.window.setTimeout(() => {
      pollActiveJobs().catch(() => {});
    }, JOB_MONITOR_POLL_MS);
  }

  function logJobTransition(job, previousStatus, nextStatus, origin = 'monitor') {
    const transition = describeJobMonitorTransition(job, previousStatus, nextStatus, origin);
    app.addLog({
      status: 'Tracked run',
      message: transition.message,
      tone: transition.tone,
      time: 'job',
    });
  }

  async function runMonitoredJobCompletionAction(job, completionAction = null) {
    let artifacts = [];
    try {
      const payload = await app.fetchJson(`/jobs/${encodeURIComponent(job.id)}/artifacts`);
      artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
    } catch {
      artifacts = [];
    }

    const target = resolveMonitoredJobCompletionTarget(job, {
      artifacts,
      completionAction,
    });

    const remainingActiveCount = listActiveStudioMonitoredJobs(app.state.data.jobMonitor)
      .filter((entry) => entry.id !== job.id)
      .length;

    setCompletionNotice(buildStudioJobCompletionNotice(job, target, remainingActiveCount));

    if (!target.route) {
      app.addLog({
        status: 'Tracked run',
        message: `${job.type} ${shortJobId(job.id)} finished with status ${job.status}. Completion notice is ready in the shell.`,
        tone: job.status === 'failed' ? 'bad' : 'warn',
        time: 'job',
      });
      app.refreshShellChrome({ syncWorkspace: true });
      return;
    }

    if (remainingActiveCount > 0) {
      app.addLog({
        status: 'Tracked run',
        message: `${job.type} ${shortJobId(job.id)} finished. Completion handoff is ready in ${target.route} while other jobs continue.`,
        tone: 'ok',
        time: 'job',
      });
      app.refreshShellChrome({ syncWorkspace: true });
      return;
    }

    await openJob(job.id, { route: target.route, summaryHint: job });
  }

  async function refreshRecentJobs({ silent = false, preserveRender = false } = {}) {
    try {
      const items = await refreshStudioJobs(RECENT_JOBS_LIMIT);
      app.state.data.recentJobs = {
        status: items.length > 0 ? 'ready' : 'empty',
        items,
        message: items.length > 0 ? '' : 'No jobs have been tracked yet on this local API instance.',
      };
      app.state.data.jobMonitor = syncActiveJobsIntoMonitor(app.state.data.jobMonitor, items);
      if (!silent) {
        app.addLog({
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
      app.state.data.recentJobs = {
        status: 'unavailable',
        items: [],
        message: 'Recent job history requires the local API path from `fcad serve`.',
      };
      return [];
    } finally {
      if (preserveRender) {
        app.refreshShellChrome({ syncWorkspace: true });
      } else {
        app.commitRender();
      }
    }
  }

  async function pollActiveJobs() {
    const activeJobs = listActiveStudioMonitoredJobs(app.state.data.jobMonitor);
    if (activeJobs.length === 0) {
      clearJobMonitorTimer();
      app.refreshShellChrome({ syncWorkspace: true });
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

        app.runtime.jobMonitorErrors.delete(entry.id);
        syncJobIntoState(job);
        app.state.data.jobMonitor = upsertStudioMonitoredJob(app.state.data.jobMonitor, job, {
          lastPollTime: polledAt,
          completionAction: entry.completionAction,
        });

        if (entry.status !== job.status) {
          logJobTransition(job, entry.status, job.status);
        }

        if (!isActiveStudioJobStatus(job.status)) {
          completedJobs.push({ job, completionAction: entry.completionAction });
          app.state.data.jobMonitor = upsertStudioMonitoredJob(app.state.data.jobMonitor, job, {
            lastPollTime: polledAt,
            completionAction: null,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        app.state.data.jobMonitor = upsertStudioMonitoredJob(app.state.data.jobMonitor, entry, {
          lastPollTime: polledAt,
          completionAction: entry.completionAction,
        });
        if (app.runtime.jobMonitorErrors.get(entry.id) !== message) {
          app.runtime.jobMonitorErrors.set(entry.id, message);
          app.addLog({
            status: 'Tracked run',
            message: `Polling ${shortJobId(entry.id)} hit an error: ${message}`,
            tone: 'warn',
            time: 'job',
          });
        }
      }
    }));

    app.state.data.jobMonitor = ensureStudioJobMonitorState({
      ...app.state.data.jobMonitor,
      lastPollTime: polledAt,
    });
    app.refreshShellChrome({ syncWorkspace: true });

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
    const previous = findStudioMonitoredJob(app.state.data.jobMonitor, job.id);
    app.runtime.jobMonitorErrors.delete(job.id);
    app.state.data.jobMonitor = upsertStudioMonitoredJob(app.state.data.jobMonitor, job, {
      lastPollTime: new Date().toISOString(),
      completionAction,
    });
    if (announce) {
      logJobTransition(job, previous?.status || '', job.status, origin);
    }
    app.refreshShellChrome({ syncWorkspace: true });

    if (!isActiveStudioJobStatus(job.status)) {
      runMonitoredJobCompletionAction(job, completionAction).catch(() => {});
      app.state.data.jobMonitor = upsertStudioMonitoredJob(app.state.data.jobMonitor, job, {
        lastPollTime: new Date().toISOString(),
        completionAction: null,
      });
      app.refreshShellChrome({ syncWorkspace: true });
      return;
    }

    scheduleJobMonitoring();
  }

  function resumeJobMonitoring() {
    const knownMonitorIds = new Set(
      ensureStudioJobMonitorState(app.state.data.jobMonitor).items.map((job) => job.id)
    );
    const resumableJobs = findResumableStudioJobs(app.state.data.recentJobs.items);
    if (resumableJobs.length === 0) return;

    app.state.data.jobMonitor = syncActiveJobsIntoMonitor(app.state.data.jobMonitor, resumableJobs);
    resumableJobs.forEach((job) => {
      if (!knownMonitorIds.has(job.id)) {
        logJobTransition(job, '', job.status, 'resume');
      }
    });
    app.refreshShellChrome({ syncWorkspace: true });
    scheduleJobMonitoring();
  }

  async function submitTrackedStudioRun({
    type,
    configToml,
    artifactRef,
    baselineArtifactRef,
    candidateArtifactRef,
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
      baselineArtifactRef,
      candidateArtifactRef,
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
    app.runtime.jobMonitorErrors.delete(job.id);
    app.state.data.jobMonitor = upsertStudioMonitoredJob(app.state.data.jobMonitor, job, {
      lastPollTime: new Date().toISOString(),
      completionAction: null,
    });
    app.addLog({
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
    app.addLog({
      status: 'Tracked run',
      message: `Retried ${shortJobId(jobId)} as ${job.type} ${shortJobId(job.id)}.`,
      tone: 'info',
      time: 'job',
    });
    beginJobMonitoring(job, { origin: 'submit', announce: false });
    await refreshRecentJobs({ silent: true, preserveRender: true });
    return job;
  }

  async function fetchJobSummary(jobId, summaryHint = null) {
    if (!jobId) return null;

    const knownSummary = summaryHint?.id === jobId ? summaryHint : findKnownJob(jobId);
    if (knownSummary) return knownSummary;

    const payload = await app.fetchJson(`/jobs/${encodeURIComponent(jobId)}`);
    return payload?.job || null;
  }

  async function openJob(jobId, { route = 'artifacts', summaryHint = null } = {}) {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) return;

    const currentJobId = app.state.data.activeJob.summary?.id || '';
    const sameJob = currentJobId === normalizedJobId;

    if (sameJob && app.state.data.activeJob.status === 'ready') {
      app.navigateTo(route, { selectedJobId: normalizedJobId });
      return;
    }

    const requestSeq = ++openJobRequestSeq;
    const loadingSummary = {
      id: normalizedJobId,
      type: 'job',
      status: 'unknown',
      updated_at: null,
      links: {},
    };

    if (!sameJob) {
      app.state.data.review = {
        ...app.state.data.review,
        status: 'idle',
        jobId: '',
        cards: [],
        selectedCardId: '',
        errorMessage: '',
      };
      resetArtifactsWorkspaceForJobSwitch();
      app.state.data.activeJob = {
        status: 'loading',
        summary: loadingSummary,
        artifacts: [],
        manifest: null,
        storage: null,
        errorMessage: '',
      };
      app.navigateTo(route, { selectedJobId: normalizedJobId });
    }

    let summary = null;
    try {
      summary = await fetchJobSummary(normalizedJobId, summaryHint);
    } catch {
      summary = null;
    }
    if (requestSeq !== openJobRequestSeq) return;

    if (!summary) {
      summary = loadingSummary;
    }

    syncJobIntoState(summary);
    app.state.data.activeJob = {
      status: 'loading',
      summary,
      artifacts: [],
      manifest: null,
      storage: null,
      errorMessage: '',
    };

    if (sameJob) {
      app.navigateTo(route, { selectedJobId: normalizedJobId });
    } else {
      app.commitRender();
    }

    try {
      const payload = await app.fetchJson(
        summary.links?.artifacts || `/jobs/${encodeURIComponent(normalizedJobId)}/artifacts`
      );
      if (requestSeq !== openJobRequestSeq) return;
      app.state.data.activeJob = {
        status: 'ready',
        summary,
        artifacts: Array.isArray(payload?.artifacts) ? payload.artifacts : [],
        manifest: payload?.manifest || null,
        storage: payload?.storage || null,
        errorMessage: '',
      };
      if (
        !app.state.data.artifactsWorkspace.selectedArtifactId
        || !app.state.data.activeJob.artifacts.some(
          (artifact) => artifact.id === app.state.data.artifactsWorkspace.selectedArtifactId
        )
      ) {
        app.state.data.artifactsWorkspace.selectedArtifactId = findDefaultArtifactForJob(
          app.state.data.activeJob.artifacts
        )?.id || '';
      }
      app.addLog({
        status: 'Artifacts',
        message: `Opened tracked artifacts for ${summary.type} ${normalizedJobId.slice(0, 8)}.`,
        tone: 'ok',
        time: 'job',
      });
    } catch {
      if (requestSeq !== openJobRequestSeq) return;
      app.state.data.activeJob = {
        status: 'unavailable',
        summary,
        artifacts: [],
        manifest: null,
        storage: null,
        errorMessage: 'Artifact details could not be loaded from the local API.',
      };
      app.addLog({
        status: 'Artifacts',
        message: `Could not load artifact details for ${summary.type} ${normalizedJobId.slice(0, 8)}.`,
        tone: 'warn',
        time: 'job',
      });
    } finally {
      app.commitRender();
    }
  }

  return {
    findKnownJob,
    refreshRecentJobs,
    pollActiveJobs,
    beginJobMonitoring,
    resumeJobMonitoring,
    submitTrackedStudioRun,
    cancelTrackedJobById,
    retryTrackedJobById,
    fetchJobSummary,
    openJob,
    setCompletionNotice,
    syncJobIntoState,
  };
}
