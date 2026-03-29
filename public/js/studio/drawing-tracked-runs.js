import { studioJobTone } from './jobs-client.js';
import { findStudioMonitoredJob } from './job-monitor.js';

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function shortJobId(id = '') {
  if (!id) return 'unknown';
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function ensureDrawingTrackedRunState(drawing = {}) {
  drawing.trackedRun = {
    lastJobId: normalizeString(drawing.trackedRun?.lastJobId),
    status: normalizeString(drawing.trackedRun?.status || 'idle').toLowerCase(),
    submitting: drawing.trackedRun?.submitting === true,
    error: normalizeString(drawing.trackedRun?.error),
    preservedEditedPreview: drawing.trackedRun?.preservedEditedPreview === true,
    previewPlanRequested: drawing.trackedRun?.previewPlanRequested === true,
    preserveReason: normalizeString(drawing.trackedRun?.preserveReason),
    submittedDrawingSettings: drawing.trackedRun?.submittedDrawingSettings && typeof drawing.trackedRun.submittedDrawingSettings === 'object'
      ? structuredClone(drawing.trackedRun.submittedDrawingSettings)
      : null,
  };
  return drawing;
}

export function resetDrawingTrackedRunState(drawing = {}) {
  ensureDrawingTrackedRunState(drawing);
  drawing.trackedRun = {
    lastJobId: '',
    status: 'idle',
    submitting: false,
    error: '',
    preservedEditedPreview: false,
    previewPlanRequested: false,
    preserveReason: '',
    submittedDrawingSettings: null,
  };
  return drawing;
}

function studioMetadataForJob(job = {}) {
  const studio = job?.request?.options?.studio;
  const previewPlan = studio?.preview_plan;
  return {
    previewPlanRequested: previewPlan?.requested === true,
    preservedEditedPreview: previewPlan?.preserved === true,
    preserveReason: normalizeString(previewPlan?.reason),
  };
}

export function updateDrawingTrackedRunFromJob(drawing = {}, job = {}) {
  ensureDrawingTrackedRunState(drawing);
  const metadata = studioMetadataForJob(job);
  drawing.trackedRun = {
    lastJobId: normalizeString(job.id),
    status: normalizeString(job.status || 'queued').toLowerCase(),
    submitting: false,
    error: '',
    preservedEditedPreview: metadata.preservedEditedPreview,
    previewPlanRequested: metadata.previewPlanRequested,
    preserveReason: metadata.preserveReason,
    submittedDrawingSettings: job?.request?.options?.studio?.drawing_settings && typeof job.request.options.studio.drawing_settings === 'object'
      ? structuredClone(job.request.options.studio.drawing_settings)
      : null,
  };
  return drawing.trackedRun;
}

function resolveTrackedDrawJob(drawing = {}, recentJobs = [], jobMonitor = {}) {
  const trackedRun = ensureDrawingTrackedRunState(drawing).trackedRun;
  if (!trackedRun.lastJobId) return null;

  const knownJob = recentJobs.find((job) => job.id === trackedRun.lastJobId);
  if (knownJob) return knownJob;

  const monitoredJob = findStudioMonitoredJob(jobMonitor, trackedRun.lastJobId);
  if (monitoredJob) {
    return {
      ...monitoredJob,
      id: trackedRun.lastJobId,
      type: monitoredJob.type || 'draw',
      status: monitoredJob.status || trackedRun.status || 'queued',
    };
  }

  return {
    id: trackedRun.lastJobId,
    type: 'draw',
    status: trackedRun.status || 'queued',
  };
}

function previewPlanCopy(trackedRun) {
  if (!trackedRun.previewPlanRequested) {
    return 'Tracked draw uses the current TOML and drawing settings.';
  }
  if (trackedRun.preservedEditedPreview) {
    return 'Edited preview dimensions were preserved into the tracked draw plan.';
  }

  if (trackedRun.preserveReason === 'config_changed') {
    return 'Tracked draw fell back to the current TOML because the config changed after the preview was edited.';
  }
  if (trackedRun.preserveReason === 'preview_not_found') {
    return 'Tracked draw fell back to the current TOML because the edited preview was no longer available.';
  }
  if (trackedRun.preserveReason === 'preview_not_editable') {
    return 'Tracked draw fell back to the current TOML because the current preview has no editable plan.';
  }
  return 'Tracked draw fell back to the current TOML and drawing settings.';
}

export function deriveDrawingTrackedRunPresentation({
  drawing = {},
  recentJobs = [],
  jobMonitor = {},
} = {}) {
  const trackedRun = ensureDrawingTrackedRunState(drawing).trackedRun;

  if (trackedRun.submitting) {
    return {
      title: 'Submitting tracked draw',
      tone: 'info',
      copy: 'Sending the current sheet setup into the tracked job timeline while keeping preview work available.',
      meta: '',
      canOpenArtifacts: false,
      job: null,
      previewPlanCopy: previewPlanCopy(trackedRun),
    };
  }

  if (trackedRun.error) {
    return {
      title: 'Tracked draw needs attention',
      tone: 'bad',
      copy: trackedRun.error,
      meta: '',
      canOpenArtifacts: false,
      job: null,
      previewPlanCopy: previewPlanCopy(trackedRun),
    };
  }

  const job = resolveTrackedDrawJob(drawing, recentJobs, jobMonitor);
  if (!job) {
    return {
      title: 'Tracked draw idle',
      tone: 'info',
      copy: 'Run Tracked Draw Job to publish this sheet setup into `/jobs` and the artifact timeline.',
      meta: '',
      canOpenArtifacts: false,
      job: null,
      previewPlanCopy: previewPlanCopy(trackedRun),
    };
  }

  const status = normalizeString(job.status || trackedRun.status || 'queued').toLowerCase();
  const shortId = shortJobId(job.id);
  const tone = studioJobTone(status);

  if (status === 'succeeded') {
    return {
      title: 'Tracked draw succeeded',
      tone,
      copy: `Job ${shortId} finished successfully and is ready to reopen in Artifacts.`,
      meta: `Job ${shortId}`,
      canOpenArtifacts: true,
      job,
      previewPlanCopy: previewPlanCopy(trackedRun),
    };
  }

  if (status === 'failed') {
    return {
      title: 'Tracked draw failed',
      tone,
      copy: `Job ${shortId} finished with an error. Preview and dimension editing remain available in the sheet-first workspace.`,
      meta: `Job ${shortId}`,
      canOpenArtifacts: false,
      job,
      previewPlanCopy: previewPlanCopy(trackedRun),
    };
  }

  if (status === 'running') {
    return {
      title: 'Tracked draw running',
      tone,
      copy: `Job ${shortId} is producing tracked outputs while preview remains available for fast iteration.`,
      meta: `Job ${shortId}`,
      canOpenArtifacts: false,
      job,
      previewPlanCopy: previewPlanCopy(trackedRun),
    };
  }

  return {
    title: 'Tracked draw queued',
    tone,
    copy: `Job ${shortId} is queued in the tracked run timeline.`,
    meta: `Job ${shortId}`,
    canOpenArtifacts: false,
    job,
    previewPlanCopy: previewPlanCopy(trackedRun),
  };
}
