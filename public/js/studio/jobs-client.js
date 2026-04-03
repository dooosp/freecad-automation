const ACTIVE_JOB_STATUSES = new Set(['queued', 'running']);
const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

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
  artifactRef,
  baselineArtifactRef,
  candidateArtifactRef,
  contextPath,
  modelPath,
  bomPath,
  inspectionPath,
  qualityPath,
  compareToPath,
  drawingSettings,
  drawingPreviewId,
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
      ...(configToml ? { config_toml: configToml } : {}),
      ...(artifactRef ? { artifact_ref: artifactRef } : {}),
      ...(baselineArtifactRef ? { baseline_artifact_ref: baselineArtifactRef } : {}),
      ...(candidateArtifactRef ? { candidate_artifact_ref: candidateArtifactRef } : {}),
      ...(contextPath ? { context_path: contextPath } : {}),
      ...(modelPath ? { model_path: modelPath } : {}),
      ...(bomPath ? { bom_path: bomPath } : {}),
      ...(inspectionPath ? { inspection_path: inspectionPath } : {}),
      ...(qualityPath ? { quality_path: qualityPath } : {}),
      ...(compareToPath ? { compare_to_path: compareToPath } : {}),
      ...(drawingSettings ? { drawing_settings: drawingSettings } : {}),
      ...(drawingPreviewId ? { drawing_preview_id: drawingPreviewId } : {}),
      ...(reportOptions ? { report_options: reportOptions } : {}),
      ...(options ? { options } : {}),
    }),
  });

  return payload.job || null;
}

export async function previewStudioImportBootstrap(payload = {}) {
  return fetchJobJson('/api/studio/import-bootstrap', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function pollStudioJob(jobId) {
  const payload = await fetchJobJson(`/jobs/${encodeURIComponent(jobId)}`);
  return payload.job || null;
}

export async function refreshStudioJobs(limit = 6) {
  const payload = await fetchJobJson(`/jobs?limit=${encodeURIComponent(limit)}`);
  return Array.isArray(payload?.jobs) ? payload.jobs : [];
}

export async function cancelStudioJob(jobId) {
  return fetchJobJson(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  });
}

export async function retryStudioJob(jobId) {
  return fetchJobJson(`/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
  });
}

export function isActiveStudioJobStatus(status) {
  return ACTIVE_JOB_STATUSES.has(String(status || '').toLowerCase());
}

export function isTerminalStudioJobStatus(status) {
  return TERMINAL_JOB_STATUSES.has(String(status || '').toLowerCase());
}

export function findResumableStudioJob(jobs = []) {
  return jobs.find((job) => isActiveStudioJobStatus(job?.status)) || null;
}

export function findResumableStudioJobs(jobs = []) {
  return jobs.filter((job) => isActiveStudioJobStatus(job?.status));
}

export function supportsStudioJobCancellation(job = {}) {
  return job?.capabilities?.cancellation_supported === true;
}

export function supportsStudioJobRetry(job = {}) {
  return job?.capabilities?.retry_supported === true;
}

export function isReviewableStudioJob(job = {}) {
  const type = String(job?.type || '').toLowerCase();
  return (
    type === 'inspect'
    || type === 'report'
    || type === 'review-context'
    || type === 'readiness-pack'
    || type === 'generate-standard-docs'
    || type === 'pack'
  )
    && String(job?.status || '').toLowerCase() === 'succeeded';
}

export function studioJobTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'succeeded') return 'ok';
  if (normalized === 'failed' || normalized === 'cancelled') return 'bad';
  if (normalized === 'running') return 'warn';
  if (normalized === 'queued') return 'info';
  return 'info';
}
