import { isActiveStudioJobStatus, studioJobTone } from './jobs-client.js';
import { isReviewSourceArtifact } from './artifact-actions.js';
import { deriveRecentJobQualityStatus } from './recent-job-quality-status.js';

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

function normalizedJobStatus(job = {}) {
  return String(job.status || '').trim().toLowerCase();
}

function formatJobType(type = '') {
  const normalized = String(type || 'job').trim().toLowerCase();
  return normalized || 'job';
}

function qualityCompletionParts(job = {}) {
  const status = deriveRecentJobQualityStatus(job);
  if (!status.hasQualityDecision) return [];
  return [
    `${status.qualityStatus}.`,
    `${status.readyForManufacturingReview}.`,
  ];
}

function buildOpenJobAction({ label, jobId, route, tone = 'primary' }) {
  if (!jobId || !route) return null;
  return {
    label,
    action: 'open-job',
    tone,
    jobId,
    route,
  };
}

export function buildStudioJobCompletionNotice(job = {}, target = {}, remainingActiveCount = 0) {
  if (!job?.id) return null;

  const status = normalizedJobStatus(job);
  const jobType = formatJobType(job.type);
  const qualityParts = qualityCompletionParts(job);
  const stillRunningCopy = Number(remainingActiveCount) > 0
    ? `${remainingActiveCount} other active job${remainingActiveCount === 1 ? '' : 's'} still running.`
    : '';

  if (status === 'succeeded') {
    const primaryRoute = target.route || 'artifacts';
    const secondaryRoute = target.secondaryRoute || '';
    const destinationCopy = primaryRoute === 'review'
      ? 'Open Review for decision context or Artifacts for generated files.'
      : 'Open Artifacts to inspect generated files and quality evidence.';
    const messageParts = ['Job succeeded.', ...qualityParts, destinationCopy, stillRunningCopy].filter(Boolean);
    const actions = [
      buildOpenJobAction({
        label: primaryRoute === 'review' ? 'Open Review' : 'Open Artifacts',
        jobId: job.id,
        route: primaryRoute,
        tone: 'primary',
      }),
      buildOpenJobAction({
        label: secondaryRoute === 'review' ? 'Open Review' : 'Open Artifacts',
        jobId: job.id,
        route: secondaryRoute,
        tone: 'ghost',
      }),
    ].filter(Boolean);

    return {
      jobId: job.id,
      tone: qualityParts.includes('Quality failed.') ? 'warn' : 'ok',
      title: `Tracked ${jobType} completed`,
      message: messageParts.join(' '),
      messageParts,
      primaryRoute,
      primaryLabel: primaryRoute === 'review' ? 'Open Review' : 'Open Artifacts',
      secondaryRoute,
      secondaryLabel: secondaryRoute === 'review' ? 'Open Review' : secondaryRoute === 'artifacts' ? 'Open Artifacts' : '',
      actions,
    };
  }

  if (status === 'failed') {
    const messageParts = [
      'Job failed before Studio could finish the tracked flow. Open Jobs center to inspect status, then retry when the source issue is fixed.',
      stillRunningCopy,
    ].filter(Boolean);
    return {
      jobId: job.id,
      tone: 'bad',
      title: `Tracked ${jobType} failed`,
      message: messageParts.join(' '),
      messageParts,
      primaryRoute: '',
      primaryLabel: 'Open Jobs center',
      secondaryRoute: '',
      secondaryLabel: '',
      actions: [
        {
          label: 'Retry tracked job',
          action: 'retry-job',
          tone: 'primary',
          jobId: job.id,
        },
        {
          label: 'Open Jobs center',
          action: 'open-jobs-center',
          tone: 'ghost',
        },
      ],
    };
  }

  if (status === 'cancelled') {
    const messageParts = [
      'The tracked job was cancelled before outputs were verified. Open Jobs center if you need to retry or inspect the job record.',
      stillRunningCopy,
    ].filter(Boolean);
    return {
      jobId: job.id,
      tone: 'warn',
      title: `Tracked ${jobType} cancelled`,
      message: messageParts.join(' '),
      messageParts,
      primaryRoute: '',
      primaryLabel: 'Open Jobs center',
      secondaryRoute: '',
      secondaryLabel: '',
      actions: [
        {
          label: 'Open Jobs center',
          action: 'open-jobs-center',
          tone: 'primary',
        },
      ],
    };
  }

  const messageParts = [
    'The tracked job is no longer running. Open Jobs center to inspect the latest status.',
    stillRunningCopy,
  ].filter(Boolean);
  return {
    jobId: job.id,
    tone: 'warn',
    title: `Tracked ${jobType} stopped`,
    message: messageParts.join(' '),
    messageParts,
    primaryRoute: '',
    primaryLabel: 'Open Jobs center',
    secondaryRoute: '',
    secondaryLabel: '',
    actions: [
      {
        label: 'Open Jobs center',
        action: 'open-jobs-center',
        tone: 'primary',
      },
    ],
  };
}
