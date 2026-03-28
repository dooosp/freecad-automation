import { isActiveStudioJobStatus, studioJobTone } from './jobs-client.js';
import { isReviewSourceArtifact } from './artifact-actions.js';

function jobTimestamp(job = {}) {
  return Date.parse(job.updated_at || job.created_at || job.lastPollTime || 0);
}

export function sortStudioJobsByUpdatedAt(jobs = []) {
  return [...jobs].sort((left, right) => jobTimestamp(right) - jobTimestamp(left));
}

export function mergeTrackedJobIntoRecentJobs(job, jobs = [], limit = 6) {
  if (!job?.id) return sortStudioJobsByUpdatedAt(jobs).slice(0, limit);

  return sortStudioJobsByUpdatedAt([
    job,
    ...jobs.filter((entry) => entry.id !== job.id),
  ]).slice(0, limit);
}

function normalizeMonitorEntry(entry = {}) {
  const status = String(entry.status || 'unknown').toLowerCase();
  return {
    ...structuredClone(entry),
    id: entry.id || '',
    type: entry.type || 'job',
    status,
    lastPollTime: entry.lastPollTime || null,
    enabled: entry.enabled === false ? false : isActiveStudioJobStatus(status),
    completionAction: entry.completionAction || null,
  };
}

export function ensureStudioJobMonitorState(jobMonitor = {}) {
  const items = Array.isArray(jobMonitor.items)
    ? sortStudioJobsByUpdatedAt(
        jobMonitor.items
          .filter((entry) => entry?.id)
          .map((entry) => normalizeMonitorEntry(entry))
      )
    : [];

  return {
    items,
    lastPollTime: jobMonitor.lastPollTime || null,
  };
}

export function findStudioMonitoredJob(jobMonitor = {}, jobId = '') {
  if (!jobId) return null;
  return ensureStudioJobMonitorState(jobMonitor).items.find((entry) => entry.id === jobId) || null;
}

export function upsertStudioMonitoredJob(jobMonitor = {}, job = {}, {
  completionAction,
  lastPollTime = null,
} = {}) {
  if (!job?.id) return ensureStudioJobMonitorState(jobMonitor);

  const current = ensureStudioJobMonitorState(jobMonitor);
  const previous = findStudioMonitoredJob(current, job.id);
  const nextEntry = normalizeMonitorEntry({
    ...previous,
    ...job,
    completionAction: completionAction === undefined
      ? previous?.completionAction || null
      : completionAction,
    lastPollTime: lastPollTime || previous?.lastPollTime || null,
  });

  return {
    items: sortStudioJobsByUpdatedAt([
      nextEntry,
      ...current.items.filter((entry) => entry.id !== nextEntry.id),
    ]),
    lastPollTime: lastPollTime || current.lastPollTime || null,
  };
}

export function syncActiveJobsIntoMonitor(jobMonitor = {}, jobs = []) {
  return jobs
    .filter((job) => isActiveStudioJobStatus(job?.status))
    .reduce((monitor, job) => upsertStudioMonitoredJob(monitor, job), ensureStudioJobMonitorState(jobMonitor));
}

export function listActiveStudioMonitoredJobs(jobMonitor = {}) {
  return ensureStudioJobMonitorState(jobMonitor).items.filter((entry) => isActiveStudioJobStatus(entry.status));
}

export function countActiveStudioMonitoredJobs(jobMonitor = {}) {
  return listActiveStudioMonitoredJobs(jobMonitor).length;
}

export function describeJobMonitorTransition(job = {}, previousStatus = '', nextStatus = '', origin = 'monitor') {
  const shortId = job.id?.slice(0, 8) || 'unknown';
  return {
    tone: studioJobTone(nextStatus),
    message: previousStatus && previousStatus !== nextStatus
      ? `${job.type} ${shortId} moved from ${previousStatus} to ${nextStatus}.`
      : `${origin === 'resume' ? 'Resumed' : 'Started'} monitoring ${job.type} ${shortId} in ${nextStatus}.`,
  };
}

function normalizeCompletionAction(completionAction = null) {
  if (!completionAction || typeof completionAction !== 'object') return {};
  if (completionAction.type === 'open-artifacts-on-success') {
    return {
      preferredRoute: completionAction.route || 'artifacts',
      sourceArtifactFamily: completionAction.sourceArtifactFamily || '',
    };
  }
  return completionAction;
}

function hasReviewOutputs(artifacts = []) {
  return artifacts.some((artifact) => artifact?.exists !== false && isReviewSourceArtifact(artifact));
}

export function resolveMonitoredJobCompletionTarget(job = {}, {
  artifacts = [],
  completionAction = null,
} = {}) {
  if (job?.status !== 'succeeded') {
    return {
      route: '',
      secondaryRoute: '',
      hasReviewOutputs: false,
    };
  }

  const normalizedType = String(job?.type || '').toLowerCase();
  const action = normalizeCompletionAction(completionAction);
  const reviewOutputsPresent = hasReviewOutputs(artifacts);
  const sourceArtifactFamily = String(action.sourceArtifactFamily || '').trim().toLowerCase();
  let route = '';

  if (normalizedType === 'create' || normalizedType === 'draw') {
    route = 'artifacts';
  } else if (normalizedType === 'report') {
    route = reviewOutputsPresent ? 'review' : 'artifacts';
  } else if (normalizedType === 'inspect') {
    route = reviewOutputsPresent || sourceArtifactFamily === 'review' ? 'review' : 'artifacts';
  } else if (reviewOutputsPresent) {
    route = 'review';
  } else {
    route = action.preferredRoute || 'artifacts';
  }

  return {
    route,
    secondaryRoute: route === 'review' ? 'artifacts' : '',
    hasReviewOutputs: reviewOutputsPresent,
  };
}

export function resolveMonitoredJobCompletionRoute(job = {}, completionAction = null, artifacts = []) {
  return resolveMonitoredJobCompletionTarget(job, {
    artifacts,
    completionAction,
  }).route;
}
