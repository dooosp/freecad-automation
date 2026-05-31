const UNKNOWN = 'Unknown';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeList(value) {
  return Array.isArray(value) ? value : [];
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

function firstObjectWithAnyKey(candidates = [], keys = []) {
  return candidates
    .map((candidate) => asObject(candidate))
    .find((candidate) => keys.some((key) => Object.hasOwn(candidate, key))) || {};
}

function readinessSummaryFromJob(job = {}, reportSummary = {}) {
  const result = asObject(job.result);
  const report = asObject(result.report);
  const readiness = asObject(result.readiness);
  return firstObjectWithAnyKey([
    reportSummary.readiness_summary,
    result.readiness_summary,
    report.readiness_summary,
    readiness.readiness_summary,
    readiness,
  ], ['status', 'gate_decision', 'missing_inputs', 'inspection_evidence_missing']);
}

function collectMissingInputs(job = {}, reportSummary = {}, readinessSummary = {}) {
  const result = asObject(job.result);
  const report = asObject(result.report);
  return [
    readinessSummary,
    reportSummary,
    result.summary,
    report.summary,
    result.review_pack?.uncertainty_coverage_report,
    report.review_pack?.uncertainty_coverage_report,
    result.process_plan?.summary,
    report.process_plan?.summary,
    result.quality_risk?.summary,
    report.quality_risk?.summary,
  ].flatMap((entry) => safeList(asObject(entry).missing_inputs));
}

function stringIncludesHeldReadiness(value = '') {
  const normalized = String(value || '').toLowerCase();
  return normalized.includes('needs_more_evidence')
    || normalized.includes('hold_for_evidence_completion')
    || normalized.includes('inspection_evidence');
}

function resultSummaryIndicatesHeldReadiness(job = {}) {
  const result = asObject(job.result);
  const summaries = [
    result.summary,
    result.report?.summary,
  ].map((entry) => asObject(entry));
  return summaries.some((summary) => (
    summary.genuine_inspection_evidence_found === false
    && (
      stringIncludesHeldReadiness(summary.readiness_truth)
      || stringIncludesHeldReadiness(summary.readiness_expectation)
    )
  ));
}

function readinessHoldLabel(job = {}, reportSummary = {}) {
  const readinessSummary = readinessSummaryFromJob(job, reportSummary);
  const missingInputs = collectMissingInputs(job, reportSummary, readinessSummary)
    .map((entry) => String(entry || '').trim().toLowerCase());
  const status = String(readinessSummary.status || '').toLowerCase();
  const gateDecision = String(readinessSummary.gate_decision || '').toLowerCase();
  const inspectionEvidenceMissing = readinessSummary.inspection_evidence_missing === true
    || missingInputs.includes('inspection_evidence')
    || resultSummaryIndicatesHeldReadiness(job);

  if (inspectionEvidenceMissing) return 'Ready held: missing inspection_evidence';
  if (status === 'needs_more_evidence' || gateDecision === 'hold_for_evidence_completion') {
    return 'Ready held';
  }
  return '';
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
  const readyForManufacturingReview = readinessHoldLabel(job, reportSummary)
    || formatReadyForManufacturingReview(reportSummary.ready_for_manufacturing_review);

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
