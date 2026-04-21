const UNKNOWN = 'Unknown';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function basename(value = '') {
  return String(value || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
}

function stripKnownConfigSuffix(value = '') {
  return String(value || '')
    .replace(/_report_summary\.json$/i, '')
    .replace(/_report\.pdf$/i, '')
    .replace(/_drawing_quality\.json$/i, '')
    .replace(/_create_quality\.json$/i, '')
    .replace(/_drawing_manifest\.json$/i, '')
    .replace(/_manifest\.json$/i, '')
    .replace(/_drawing\.svg$/i, '')
    .replace(/\.(toml|json|step|stl|fcstd)$/i, '')
    .trim();
}

function artifactCandidatesFromObject(value, candidates = []) {
  if (typeof value === 'string') {
    candidates.push(value);
    return candidates;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => artifactCandidatesFromObject(entry, candidates));
    return candidates;
  }
  if (!value || typeof value !== 'object') return candidates;
  if (typeof value.path === 'string' || typeof value.file_name === 'string') {
    candidates.push(value.path || value.file_name);
    return candidates;
  }
  Object.values(value).forEach((entry) => artifactCandidatesFromObject(entry, candidates));
  return candidates;
}

function reportSummaryFromJob(job = {}) {
  const result = asObject(job.result);
  return asObject(
    result.report_summary
      || result.decision_summary
      || result._decision_summary
      || result.summary
  );
}

function deriveConfigName(job = {}, reportSummary = {}) {
  const request = asObject(job.request);
  const requestConfig = asObject(request.config);
  const result = asObject(job.result);
  const direct = firstString(
    reportSummary.config_name,
    result.config_name,
    result.model_name,
    requestConfig.name
  );
  if (direct && direct !== 'report') return direct;

  const artifactNames = [
    ...artifactCandidatesFromObject(job.artifacts),
    ...artifactCandidatesFromObject(asObject(job.manifest).artifacts),
  ]
    .map((entry) => stripKnownConfigSuffix(basename(entry?.path || entry?.file_name || entry)))
    .filter((entry) => entry && entry !== 'report');

  return artifactNames[0] || UNKNOWN;
}

export function formatJobExecutionStatus(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'succeeded') return 'Job succeeded';
  if (normalized === 'failed') return 'Job failed';
  if (normalized === 'cancelled') return 'Job cancelled';
  if (normalized === 'running') return 'Job running';
  if (normalized === 'queued') return 'Job queued';
  return 'Job Unknown';
}

export function formatQualityStatus(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'pass' || normalized === 'passed') return 'Quality passed';
  if (normalized === 'fail' || normalized === 'failed') return 'Quality failed';
  if (normalized === 'warning' || normalized === 'warn') return 'Quality warning';
  return 'Quality Unknown';
}

export function formatReadyForManufacturingReview(value) {
  if (value === true) return 'Ready Yes';
  if (value === false) return 'Ready No';
  return 'Ready Unknown';
}

export function deriveRecentJobQualityStatus(job = {}) {
  const reportSummary = reportSummaryFromJob(job);
  const qualityStatus = formatQualityStatus(reportSummary.overall_status);
  const readyForManufacturingReview = formatReadyForManufacturingReview(reportSummary.ready_for_manufacturing_review);

  return {
    configName: deriveConfigName(job, reportSummary),
    jobExecutionStatus: formatJobExecutionStatus(job.status),
    qualityStatus,
    readyForManufacturingReview,
    hasQualityDecision: qualityStatus !== 'Quality Unknown' || readyForManufacturingReview !== 'Ready Unknown',
  };
}

export function formatRecentJobQualityLine(job = {}, shortId = '') {
  const status = deriveRecentJobQualityStatus(job);
  return [
    `${job.type || 'job'} ${shortId || job.id || UNKNOWN}`,
    status.configName,
    status.jobExecutionStatus,
    status.qualityStatus,
    status.readyForManufacturingReview,
  ].join(' · ');
}
