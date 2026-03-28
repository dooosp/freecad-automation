import { studioJobTone } from './jobs-client.js';

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function shortJobId(id = '') {
  if (!id) return 'unknown';
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function normalizeModelReportOptions(options = {}) {
  return {
    includeDrawing: options.includeDrawing !== false,
    includeTolerance: options.includeTolerance !== false,
    includeDfm: options.includeDfm === true,
    includeCost: options.includeCost === true,
    profileName: normalizeString(options.profileName).trim(),
    open: options.open === true,
  };
}

export function ensureModelTrackedRunState(model = {}) {
  model.reportOptions = normalizeModelReportOptions(model.reportOptions || {});
  model.trackedRun = {
    type: normalizeString(model.trackedRun?.type).toLowerCase(),
    lastJobId: normalizeString(model.trackedRun?.lastJobId),
    status: normalizeString(model.trackedRun?.status || 'idle').toLowerCase(),
    submitting: model.trackedRun?.submitting === true,
    error: normalizeString(model.trackedRun?.error),
  };
  model.profileCatalog = model.profileCatalog && typeof model.profileCatalog === 'object'
    ? {
        status: normalizeString(model.profileCatalog.status || 'idle'),
        items: Array.isArray(model.profileCatalog.items) ? model.profileCatalog.items : [],
        message: normalizeString(model.profileCatalog.message),
      }
    : {
        status: 'idle',
        items: [],
        message: '',
      };
  return model;
}

export function resetModelTrackedRunState(model = {}) {
  ensureModelTrackedRunState(model);
  model.trackedRun = {
    type: '',
    lastJobId: '',
    status: 'idle',
    submitting: false,
    error: '',
  };
  return model;
}

export function collectValidationNotes(validation = {}) {
  return [
    ...(Array.isArray(validation.warnings) ? validation.warnings : []).map((message) => ({
      category: 'Warning',
      message,
      tone: 'warn',
    })),
    ...(Array.isArray(validation.changed_fields) ? validation.changed_fields : []).map((message) => ({
      category: 'Migration',
      message,
      tone: 'info',
    })),
    ...(Array.isArray(validation.deprecated_fields) ? validation.deprecated_fields : []).map((message) => ({
      category: 'Deprecated',
      message,
      tone: 'warn',
    })),
  ];
}

export function buildTrackedReportJobOptions(reportOptions = {}) {
  const normalized = normalizeModelReportOptions(reportOptions);
  return {
    include_drawing: normalized.includeDrawing,
    include_tolerance: normalized.includeTolerance,
    include_dfm: normalized.includeDfm,
    include_cost: normalized.includeCost,
    ...(normalized.profileName ? { profile_name: normalized.profileName } : {}),
  };
}

export function resolveTrackedModelJob(model = {}, recentJobs = [], jobMonitor = {}) {
  const trackedRun = ensureModelTrackedRunState(model).trackedRun;
  if (!trackedRun.lastJobId) return null;

  const knownJob = recentJobs.find((job) => job.id === trackedRun.lastJobId);
  if (knownJob) return knownJob;

  if (jobMonitor.activeRunId === trackedRun.lastJobId) {
    return {
      id: trackedRun.lastJobId,
      type: trackedRun.type || 'job',
      status: jobMonitor.activeRunStatus || trackedRun.status || 'queued',
    };
  }

  return {
    id: trackedRun.lastJobId,
    type: trackedRun.type || 'job',
    status: trackedRun.status || 'queued',
  };
}

export function deriveModelTrackedRunPresentation({
  model = {},
  recentJobs = [],
  jobMonitor = {},
} = {}) {
  const trackedRun = ensureModelTrackedRunState(model).trackedRun;

  if (trackedRun.submitting) {
    return {
      status: 'submitting',
      tone: 'info',
      title: 'Tracked submission in progress',
      copy: `Submitting tracked ${trackedRun.type || 'job'} so it enters the timeline with provenance.`,
      badgeLabel: 'Tracked submitting',
      meta: '',
      job: null,
      canOpenArtifacts: false,
    };
  }

  if (trackedRun.error) {
    return {
      status: 'failed',
      tone: 'bad',
      title: 'Tracked submission needs attention',
      copy: trackedRun.error,
      badgeLabel: 'Tracked failed',
      meta: '',
      job: null,
      canOpenArtifacts: false,
    };
  }

  const job = resolveTrackedModelJob(model, recentJobs, jobMonitor);
  if (!job) {
    return {
      status: 'idle',
      tone: 'info',
      title: 'Tracked run idle',
      copy: 'Run tracked create or tracked report to capture this TOML in the job timeline and artifact trail.',
      badgeLabel: 'Tracked idle',
      meta: '',
      job: null,
      canOpenArtifacts: false,
    };
  }

  const type = normalizeString(job.type || trackedRun.type || 'job').toLowerCase();
  const status = normalizeString(job.status || trackedRun.status || 'queued').toLowerCase();
  const shortId = shortJobId(job.id);
  const tone = studioJobTone(status);

  if (status === 'succeeded') {
    return {
      status,
      tone,
      title: `Tracked ${type} succeeded`,
      copy: `Job ${shortId} finished successfully. The artifact trail is ready for re-entry from this workspace.`,
      badgeLabel: `Tracked ${type} ready`,
      meta: `Job ${shortId}`,
      job,
      canOpenArtifacts: true,
    };
  }

  if (status === 'failed') {
    return {
      status,
      tone,
      title: `Tracked ${type} failed`,
      copy: `Job ${shortId} finished with an error. Preview remains available while you inspect the tracked run outcome.`,
      badgeLabel: `Tracked ${type} failed`,
      meta: `Job ${shortId}`,
      job,
      canOpenArtifacts: false,
    };
  }

  if (status === 'running') {
    return {
      status,
      tone,
      title: `Tracked ${type} running`,
      copy: `Job ${shortId} is running now. Keep using preview for iteration while the tracked pipeline produces downstream artifacts.`,
      badgeLabel: `Tracked ${type} running`,
      meta: `Job ${shortId}`,
      job,
      canOpenArtifacts: false,
    };
  }

  return {
    status,
    tone,
    title: `Tracked ${type} queued`,
    copy: `Job ${shortId} is queued. Preview stays fast and local while the tracked run waits for execution.`,
    badgeLabel: `Tracked ${type} queued`,
    meta: `Job ${shortId}`,
    job,
    canOpenArtifacts: false,
  };
}
