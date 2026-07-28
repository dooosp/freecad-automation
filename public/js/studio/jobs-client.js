const ACTIVE_JOB_STATUSES = new Set(['queued', 'running']);
const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

export const MANUFACTURING_ROBOTICS_JOB_TYPE = 'manufacturing-action-dataset';
export const MANUFACTURING_ROBOTICS_DEMO_PROFILE = 'hinge-block-synthetic-inspection-v1';
export const MANUFACTURING_ROBOTICS_TRUST_DEMO = 'revision-mismatch';
export const MANUFACTURING_ROBOTICS_MISMATCH_REASON_CODE = 'REVISION_LINEAGE_IDENTITY_MISMATCH';

function manufacturingRoboticsDiagnosticCandidates(job = {}) {
  return [
    job?.diagnostics?.manufacturing_action_demo,
    job?.diagnostics?.manufacturing_robotics_demo,
    job?.result?.diagnostics?.manufacturing_action_demo,
    job?.result?.diagnostics?.manufacturing_robotics_demo,
    job?.result?.manufacturing_action_demo,
    job?.result?.manufacturing_robotics_demo,
    job?.metadata?.manufacturing_action_demo,
    job?.metadata?.manufacturing_robotics_demo,
    job?.error?.details?.manufacturing_action_demo,
    job?.error?.details?.manufacturing_robotics_demo,
    job?.diagnostics,
    job?.result?.diagnostics,
    job?.result,
    job?.error?.details,
  ].filter((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate));
}

export function getManufacturingRoboticsReasonCode(job = {}) {
  const diagnostic = manufacturingRoboticsDiagnosticCandidates(job)
    .find((candidate) => typeof candidate.reason_code === 'string');
  return diagnostic?.reason_code || '';
}

export function isManufacturingRoboticsMismatchFailure(job = {}) {
  return String(job?.type || '').toLowerCase() === MANUFACTURING_ROBOTICS_JOB_TYPE
    && String(job?.status || '').toLowerCase() === 'failed'
    && getManufacturingRoboticsReasonCode(job) === MANUFACTURING_ROBOTICS_MISMATCH_REASON_CODE;
}

function hasRequestValue(value) {
  return value !== undefined && value !== null && value !== '';
}

export function buildStudioTrackedJobRequest({
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
  createQualityPath,
  drawingQualityPath,
  drawingQaPath,
  drawingIntentPath,
  featureCatalogPath,
  dfmReportPath,
  compareToPath,
  intakeReportPath,
  drawingSettings,
  drawingPreviewId,
  reportOptions,
  options,
  demoProfile,
  trustDemo,
} = {}) {
  if (type === MANUFACTURING_ROBOTICS_JOB_TYPE) {
    if (demoProfile !== MANUFACTURING_ROBOTICS_DEMO_PROFILE) {
      throw new Error('Manufacturing Robotics Data requires the approved server-owned demo profile.');
    }
    if (hasRequestValue(trustDemo) && trustDemo !== MANUFACTURING_ROBOTICS_TRUST_DEMO) {
      throw new Error('Manufacturing Robotics Data received an unsupported trust demo.');
    }

    const forbiddenValues = [
      configToml,
      artifactRef,
      baselineArtifactRef,
      candidateArtifactRef,
      contextPath,
      modelPath,
      bomPath,
      inspectionPath,
      qualityPath,
      createQualityPath,
      drawingQualityPath,
      drawingQaPath,
      drawingIntentPath,
      featureCatalogPath,
      dfmReportPath,
      compareToPath,
      intakeReportPath,
      drawingSettings,
      drawingPreviewId,
      reportOptions,
      options,
    ];
    if (forbiddenValues.some(hasRequestValue)) {
      throw new Error('Manufacturing Robotics Data does not accept browser paths or arbitrary options.');
    }

    return {
      type,
      demo_profile: demoProfile,
      ...(trustDemo ? { trust_demo: trustDemo } : {}),
    };
  }

  return {
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
    ...(createQualityPath ? { create_quality_path: createQualityPath } : {}),
    ...(drawingQualityPath ? { drawing_quality_path: drawingQualityPath } : {}),
    ...(drawingQaPath ? { drawing_qa_path: drawingQaPath } : {}),
    ...(drawingIntentPath ? { drawing_intent_path: drawingIntentPath } : {}),
    ...(featureCatalogPath ? { feature_catalog_path: featureCatalogPath } : {}),
    ...(dfmReportPath ? { dfm_report_path: dfmReportPath } : {}),
    ...(compareToPath ? { compare_to_path: compareToPath } : {}),
    ...(intakeReportPath ? { intake_report_path: intakeReportPath } : {}),
    ...(drawingSettings ? { drawing_settings: drawingSettings } : {}),
    ...(drawingPreviewId ? { drawing_preview_id: drawingPreviewId } : {}),
    ...(reportOptions ? { report_options: reportOptions } : {}),
    ...(options ? { options } : {}),
  };
}

async function parseError(response) {
  try {
    const payload = await response.json();
    const messages = payload?.error?.messages;
    if (Array.isArray(messages)) {
      const text = messages.map((entry) => String(entry || '').trim()).filter(Boolean).join(' ');
      if (text) return text;
    }
    if (typeof messages === 'string' && messages.trim()) {
      return messages.trim();
    }
    if (typeof payload?.error?.message === 'string' && payload.error.message.trim()) {
      return payload.error.message.trim();
    }
    if (typeof payload?.message === 'string' && payload.message.trim()) {
      return payload.message.trim();
    }
    return `${response.status}`;
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
  createQualityPath,
  drawingQualityPath,
  drawingQaPath,
  drawingIntentPath,
  featureCatalogPath,
  dfmReportPath,
  compareToPath,
  intakeReportPath,
  drawingSettings,
  drawingPreviewId,
  reportOptions,
  options,
  demoProfile,
  trustDemo,
}) {
  const payload = await fetchJobJson('/api/studio/jobs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(buildStudioTrackedJobRequest({
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
      createQualityPath,
      drawingQualityPath,
      drawingQaPath,
      drawingIntentPath,
      featureCatalogPath,
      dfmReportPath,
      compareToPath,
      intakeReportPath,
      drawingSettings,
      drawingPreviewId,
      reportOptions,
      options,
      demoProfile,
      trustDemo,
    })),
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

export async function fetchStudioJobArtifacts(jobId) {
  const payload = await fetchJobJson(`/jobs/${encodeURIComponent(jobId)}/artifacts`);
  return Array.isArray(payload?.artifacts) ? payload.artifacts : [];
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
  const status = String(job?.status || '').toLowerCase();
  if (type === MANUFACTURING_ROBOTICS_JOB_TYPE) {
    return status === 'succeeded' || isManufacturingRoboticsMismatchFailure(job);
  }
  return (
    type === 'inspect'
    || type === 'report'
    || type === 'review-context'
    || type === 'readiness-pack'
    || type === 'generate-standard-docs'
    || type === 'pack'
    || type === 'inspection-evidence-intake'
    || type === 'inspection-evidence-promotion-dry-run'
    || type === 'stage5b-evidence-audit'
  )
    && status === 'succeeded';
}

export function studioJobTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'succeeded') return 'ok';
  if (normalized === 'failed' || normalized === 'cancelled') return 'bad';
  if (normalized === 'running') return 'warn';
  if (normalized === 'queued') return 'info';
  return 'info';
}
