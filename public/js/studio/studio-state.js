const STUDIO_ROUTES = new Set(['start', 'model', 'drawing', 'review', 'artifacts']);
const ACTIVE_JOB_STATUSES = new Set(['queued', 'running']);

export function normalizeRoute(hashValue) {
  const cleaned = String(hashValue || '')
    .replace(/^#/, '')
    .trim()
    .toLowerCase();
  return STUDIO_ROUTES.has(cleaned) ? cleaned : 'start';
}

export function summarizeProjectPath(rawPath) {
  if (!rawPath) return 'Project root unavailable';
  const segments = String(rawPath).split('/').filter(Boolean);
  if (segments.length <= 2) return rawPath;
  return `Project ${segments.slice(-2).join('/')}`;
}

export function shortJobLabel(job) {
  if (!job) return 'No active job';
  return `${job.type} ${job.status}`;
}

function shortJobId(id = '') {
  if (!id) return 'unknown';
  return id.length > 8 ? id.slice(0, 8) : id;
}

function jobTone(status = '') {
  if (status === 'succeeded') return 'ok';
  if (status === 'failed' || status === 'cancelled') return 'bad';
  if (status === 'running') return 'warn';
  return 'info';
}

function isActiveJobStatus(status = '') {
  return ACTIVE_JOB_STATUSES.has(String(status).toLowerCase());
}

function sortJobsByUpdatedAt(jobs = []) {
  return [...jobs].sort((left, right) => {
    const leftTime = Date.parse(left?.updated_at || left?.created_at || left?.lastPollTime || 0);
    const rightTime = Date.parse(right?.updated_at || right?.created_at || right?.lastPollTime || 0);
    return rightTime - leftTime;
  });
}

function collectActiveJobs(recentJobs = [], activeJob = {}, jobMonitor = {}) {
  const monitorItems = Array.isArray(jobMonitor.items) ? jobMonitor.items : [];
  const merged = sortJobsByUpdatedAt([
    ...recentJobs,
    ...monitorItems.filter((entry) => !recentJobs.some((job) => job.id === entry.id)),
    ...(activeJob?.summary && !recentJobs.some((job) => job.id === activeJob.summary.id) ? [activeJob.summary] : []),
  ]);
  return merged.filter((job) => isActiveJobStatus(job?.status));
}

function formatJobBadgeTime(value) {
  if (!value) return 'not yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function deriveStudioChromeState(data = {}) {
  const landing = data.landing || null;
  const health = data.health || {};
  const examples = data.examples || {};
  const recentJobs = data.recentJobs || {};
  const activeJob = data.activeJob || {};
  const jobMonitor = data.jobMonitor || {};
  const activeJobs = collectActiveJobs(recentJobs.items || [], activeJob, jobMonitor);
  const latestJob = activeJob.summary || recentJobs.items?.[0] || null;

  let connectionState = 'placeholder';
  let connectionLabel = 'shell only';
  if (landing?.mode === 'local_api' || health.reachable) {
    connectionState = health.status === 'unavailable' ? 'degraded' : 'connected';
    connectionLabel = connectionState === 'degraded' ? 'degraded' : 'local api';
  } else if (examples.status === 'ready') {
    connectionState = 'legacy';
    connectionLabel = 'legacy shell';
  }

  let runtimeTone = 'info';
  let runtimeToneLabel = 'checking';
  if (health.status === 'ready') {
    runtimeTone = health.available ? 'ok' : 'warn';
    runtimeToneLabel = health.available ? 'ready' : 'unavailable';
  } else if (connectionState === 'legacy') {
    runtimeTone = 'warn';
    runtimeToneLabel = 'legacy-only';
  }

  const runtimeBadgeText = health.status === 'ready'
    ? (health.available ? 'Runtime ready' : 'Runtime check required')
    : (connectionState === 'legacy' ? 'Runtime unavailable on legacy path' : 'Runtime status pending');
  const projectBadgeTitle = health.projectRoot || landing?.project_root || 'Project root unavailable';
  const projectBadgeText = summarizeProjectPath(projectBadgeTitle);
  const connectionBadgeText = connectionState === 'connected'
    ? 'Local API connected'
    : connectionState === 'degraded'
      ? 'Local API degraded'
      : connectionState === 'legacy'
        ? 'Legacy shell fallback'
        : 'Shell-only mode';
  let jobBadgeText = latestJob
    ? `Recent ${shortJobLabel(latestJob)}`
    : (recentJobs.status === 'loading' ? 'Recent jobs loading' : 'No recent job');
  let jobBadgeTitle = latestJob
    ? `Latest tracked job ${latestJob.type} ${latestJob.status}.`
    : 'No tracked job is selected or monitored.';
  let jobBadgeTone = latestJob ? jobTone(latestJob.status) : 'info';

  if (activeJobs.length > 0) {
    const runningCount = activeJobs.filter((job) => String(job.status).toLowerCase() === 'running').length;
    const queuedCount = activeJobs.filter((job) => String(job.status).toLowerCase() === 'queued').length;
    jobBadgeText = `${activeJobs.length} active job${activeJobs.length === 1 ? '' : 's'}`;
    jobBadgeTitle = [
      runningCount > 0 ? `${runningCount} running` : null,
      queuedCount > 0 ? `${queuedCount} queued` : null,
      `Last poll ${formatJobBadgeTime(jobMonitor.lastPollTime)}.`,
      ...activeJobs.slice(0, 4).map((job) => `${job.type} ${shortJobId(job.id)} is ${job.status}.`),
    ].filter(Boolean).join(' ');
    jobBadgeTone = runningCount > 0 ? 'warn' : 'info';
  }

  return {
    connectionState,
    connectionLabel,
    runtimeTone,
    runtimeToneLabel,
    runtimeBadgeText,
    projectBadgeTitle,
    projectBadgeText,
    connectionBadgeText,
    jobBadgeText,
    jobBadgeTitle,
    jobBadgeTone,
    jobLabel: latestJob ? shortJobLabel(latestJob) : 'Idle',
  };
}
