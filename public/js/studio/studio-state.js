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
  const latestJob = activeJob.summary || recentJobs.items?.[0] || null;
  const monitorJob = jobMonitor.activeRunId
    ? (
        recentJobs.items?.find((job) => job.id === jobMonitor.activeRunId)
        || (activeJob.summary?.id === jobMonitor.activeRunId ? activeJob.summary : null)
        || {
          id: jobMonitor.activeRunId,
          type: 'job',
          status: jobMonitor.activeRunStatus || 'unknown',
        }
      )
    : null;

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

  if (monitorJob) {
    const prefix = isActiveJobStatus(jobMonitor.activeRunStatus) && jobMonitor.enabled ? 'Tracking' : 'Last run';
    jobBadgeText = `${prefix} ${monitorJob.type} ${monitorJob.status}`;
    jobBadgeTitle = [
      `${monitorJob.type} ${shortJobId(monitorJob.id)} is ${monitorJob.status}.`,
      `Monitor ${jobMonitor.enabled ? 'active' : 'idle'}.`,
      `Last poll ${formatJobBadgeTime(jobMonitor.lastPollTime)}.`,
    ].join(' ');
    jobBadgeTone = jobTone(monitorJob.status);
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
