import {
  isReviewableStudioJob,
  studioJobTone,
  supportsStudioJobCancellation,
  supportsStudioJobRetry,
} from './jobs-client.js';
import { ensureStudioJobMonitorState, sortStudioJobsByUpdatedAt } from './job-monitor.js';
import {
  deriveRecentJobQualityStatus,
  formatRecentJobQualityLine,
} from './recent-job-quality-status.js';
import { createButton, createEmptyState, el } from './renderers.js';

export function shortJobId(id = '') {
  if (!id) return 'unknown';
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function formatStudioJobStatus(status = '') {
  return String(status || 'unknown')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatStudioJobTime(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function deriveJobsCenterActionEligibility(job = {}) {
  return {
    canOpenArtifacts: Boolean(job?.id),
    canOpenReview: isReviewableStudioJob(job),
    canCancel: supportsStudioJobCancellation(job),
    canRetry: supportsStudioJobRetry(job),
  };
}

export function collectJobsCenterJobs({
  recentJobs = [],
  jobMonitor = {},
  limit = 12,
} = {}) {
  const monitorItems = ensureStudioJobMonitorState(jobMonitor).items;
  const merged = sortStudioJobsByUpdatedAt([
    ...recentJobs,
    ...monitorItems.filter((entry) => !recentJobs.some((job) => job.id === entry.id)),
  ]);
  return merged.slice(0, limit);
}

function createJobMetaRow(label, value) {
  return el('div', {
    className: 'jobs-center-meta-row',
    children: [
      el('span', { className: 'jobs-center-meta-label', text: label }),
      el('span', { className: 'jobs-center-meta-value', text: value }),
    ],
  });
}

function createJobActions(job) {
  const actions = deriveJobsCenterActionEligibility(job);
  return el('div', {
    className: 'jobs-center-actions',
    children: [
      actions.canOpenArtifacts
        ? createButton({
            label: 'Open Packs',
            action: 'open-job',
            tone: 'ghost',
            dataset: {
              jobId: job.id,
              route: 'artifacts',
            },
          })
        : null,
      actions.canOpenReview
        ? createButton({
            label: 'Open Review',
            action: 'open-job',
            tone: 'ghost',
            dataset: {
              jobId: job.id,
              route: 'review',
            },
          })
        : null,
      actions.canCancel
        ? createButton({
            label: 'Cancel',
            action: 'cancel-job',
            tone: 'ghost',
            dataset: { jobId: job.id },
          })
        : null,
      actions.canRetry
        ? createButton({
            label: 'Retry',
            action: 'retry-job',
            tone: 'ghost',
            dataset: { jobId: job.id },
          })
        : null,
    ].filter(Boolean),
  });
}

function createJobsCenterItem(job, { activeJobId = '' } = {}) {
  const shortId = shortJobId(job.id);
  const tone = studioJobTone(job.status);
  const qualityStatus = deriveRecentJobQualityStatus(job);
  const lineage = job.retried_from_job_id
    ? `Retry of ${shortJobId(job.retried_from_job_id)}`
    : 'Original run';
  const requestSource = job.request?.artifact_ref
    ? `From artifact ${job.request.artifact_ref.artifact_id}`
    : null;

  return el('article', {
    className: 'jobs-center-item',
    attrs: {
      'data-tone': tone,
      ...(job.id === activeJobId ? { 'data-active': 'true' } : {}),
    },
    children: [
      el('div', {
        className: 'jobs-center-item-header',
        children: [
          el('div', {
            className: 'jobs-center-title-stack',
            children: [
              el('p', { className: 'jobs-center-title', text: formatRecentJobQualityLine(job, shortId) }),
              el('p', { className: 'jobs-center-subtitle', text: requestSource || formatStudioJobTime(job.updated_at || job.lastPollTime) }),
            ],
          }),
          el('span', {
            className: 'pill',
            text: tone === 'warn'
              ? 'Active'
              : qualityStatus.hasQualityDecision
                ? qualityStatus.qualityStatus
                : qualityStatus.jobExecutionStatus,
          }),
        ],
      }),
      el('div', {
        className: 'jobs-center-meta',
        children: [
          createJobMetaRow('Job id', job.id || shortId),
          createJobMetaRow('Config', qualityStatus.configName),
          createJobMetaRow('Job', qualityStatus.jobExecutionStatus),
          createJobMetaRow('Quality', qualityStatus.qualityStatus),
          createJobMetaRow('Ready', qualityStatus.readyForManufacturingReview),
          createJobMetaRow('Created', formatStudioJobTime(job.created_at)),
          createJobMetaRow('Updated', formatStudioJobTime(job.updated_at || job.lastPollTime)),
          createJobMetaRow('Lineage', lineage),
        ],
      }),
      createJobActions(job),
    ],
  });
}

export function renderJobsCenter({
  recentJobs = [],
  jobMonitor = {},
  activeJobId = '',
  limit = 12,
} = {}) {
  const jobs = collectJobsCenterJobs({ recentJobs, jobMonitor, limit });
  const activeCount = ensureStudioJobMonitorState(jobMonitor).items.filter((job) => job.enabled).length;

  return el('div', {
    className: 'jobs-center',
    children: [
      el('div', {
        className: 'jobs-center-summary',
        children: [
          el('p', {
            className: 'inline-note',
            text: activeCount > 0
              ? `${activeCount} queued or running review-console job${activeCount === 1 ? '' : 's'} currently monitored from this shell session.`
              : 'No queued or running review-console jobs are being monitored right now.',
          }),
        ],
      }),
      jobs.length > 0
        ? el('div', {
            className: 'jobs-center-list',
            children: jobs.map((job) => createJobsCenterItem(job, { activeJobId })),
          })
        : createEmptyState({
            icon: '::',
            title: 'No tracked jobs yet',
            copy: 'Tracked review, readiness, compare, and pack runs will appear here as soon as the local API records them.',
          }),
    ],
  });
}
