import { studioJobTone } from './jobs-client.js';

function jobTimestamp(job = {}) {
  return Date.parse(job.updated_at || job.created_at || 0);
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

export function describeJobMonitorTransition(job = {}, previousStatus = '', nextStatus = '', origin = 'monitor') {
  const shortId = job.id?.slice(0, 8) || 'unknown';
  return {
    tone: studioJobTone(nextStatus),
    message: previousStatus && previousStatus !== nextStatus
      ? `${job.type} ${shortId} moved from ${previousStatus} to ${nextStatus}.`
      : `${origin === 'resume' ? 'Resumed' : 'Started'} monitoring ${job.type} ${shortId} in ${nextStatus}.`,
  };
}

export function resolveMonitoredJobCompletionRoute(job = {}, completionAction = null) {
  if (!completionAction || completionAction.type !== 'open-artifacts-on-success') return '';
  if (job?.status !== 'succeeded') return '';
  return completionAction.route || 'artifacts';
}
