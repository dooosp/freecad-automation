const ACTIVE_JOB_STATUSES = new Set(['queued', 'running']);

async function parseError(response) {
  try {
    const payload = await response.json();
    return payload?.error?.messages?.join(' ') || payload?.message || `${response.status}`;
  } catch {
    return `${response.status}`;
  }
}

async function fetchJobJson(url, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      ...headers,
    },
    ...rest,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json();
}

export async function submitStudioTrackedJob({
  type,
  configToml,
  drawingSettings,
  reportOptions,
  options,
}) {
  const payload = await fetchJobJson('/api/studio/jobs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type,
      config_toml: configToml,
      ...(drawingSettings ? { drawing_settings: drawingSettings } : {}),
      ...(reportOptions ? { report_options: reportOptions } : {}),
      ...(options ? { options } : {}),
    }),
  });

  return payload.job || null;
}

export async function pollStudioJob(jobId) {
  const payload = await fetchJobJson(`/jobs/${encodeURIComponent(jobId)}`);
  return payload.job || null;
}

export async function refreshStudioJobs(limit = 6) {
  const payload = await fetchJobJson(`/jobs?limit=${encodeURIComponent(limit)}`);
  return Array.isArray(payload?.jobs) ? payload.jobs : [];
}

export function isActiveStudioJobStatus(status) {
  return ACTIVE_JOB_STATUSES.has(String(status || '').toLowerCase());
}

export function findResumableStudioJob(jobs = []) {
  return jobs.find((job) => isActiveStudioJobStatus(job?.status)) || null;
}

export function studioJobTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'succeeded') return 'ok';
  if (normalized === 'failed') return 'bad';
  if (normalized === 'running') return 'warn';
  if (normalized === 'queued') return 'info';
  return 'info';
}
