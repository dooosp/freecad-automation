const STUDIO_ROUTES = new Set(['start', 'model', 'drawing', 'review', 'artifacts']);

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

export function deriveStudioChromeState(data = {}) {
  const landing = data.landing || null;
  const health = data.health || {};
  const examples = data.examples || {};
  const recentJobs = data.recentJobs || {};
  const activeJob = data.activeJob || {};
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
  const jobBadgeText = latestJob
    ? `Recent ${shortJobLabel(latestJob)}`
    : (recentJobs.status === 'loading' ? 'Recent jobs loading' : 'No recent job');

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
    jobLabel: latestJob ? shortJobLabel(latestJob) : 'Idle',
  };
}
