function normalizeString(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function artifactSearchText(artifact = {}) {
  return [
    artifact.type,
    artifact.key,
    artifact.file_name,
    artifact.id,
    artifact.extension,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function includesAny(value, needles = []) {
  return needles.some((needle) => value.includes(needle));
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

const OPTIONAL_ARTIFACT_KEYS = new Set([
  'fem',
  'tolerance',
  'create_manifest',
  'drawing_manifest',
  'report_manifest',
  'traceability_json',
]);

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

function deriveConfigName({ reportSummary = {}, artifacts = [] } = {}) {
  if (typeof reportSummary.config_name === 'string' && reportSummary.config_name.trim()) {
    return reportSummary.config_name.trim();
  }

  const artifactName = artifacts
    .map((artifact) => stripKnownConfigSuffix(basename(artifact.file_name || artifact.path || artifact.key || artifact.id)))
    .find((value) => value && value !== 'report');
  return artifactName || 'Unknown config';
}

function toStatusTone(status = '') {
  const normalized = normalizeString(status);
  if (normalized === 'pass' || normalized === 'ready' || normalized === 'generated' || normalized === 'in_memory') return 'ok';
  if (normalized === 'warning' || normalized === 'available') return 'warn';
  if (normalized === 'fail' || normalized === 'missing') return 'bad';
  return 'info';
}

function normalizeSurfaceStatus(status = '') {
  const normalized = normalizeString(status);
  if (['pass', 'warning', 'fail', 'available', 'generated', 'in_memory', 'not_run', 'not_available', 'missing'].includes(normalized)) return normalized;
  if (normalized === 'ready') return 'pass';
  return normalized || 'not_available';
}

export function formatQualityStatusLabel(status = '', required = false) {
  const normalized = normalizeSurfaceStatus(status);
  if (normalized === 'generated') return 'Generated';
  if (normalized === 'available') return 'Available';
  if (normalized === 'in_memory') return 'Computed in report';
  if (normalized === 'not_run') return required ? 'Required missing' : 'Optional not run';
  if (normalized === 'not_available' || normalized === 'missing') {
    return required ? 'Required missing' : 'Optional missing';
  }
  if (normalized === 'pass') return 'Passed';
  if (normalized === 'fail') return 'Failed';
  if (normalized === 'warning') return 'Warning';
  if (normalized === 'incomplete') return 'Incomplete';
  return normalized
    ? normalized.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
    : 'Unknown';
}

function buildArtifactMatcher(needleList) {
  return function matchArtifact(artifact = {}) {
    return includesAny(artifactSearchText(artifact), needleList);
  };
}

export const isReportSummaryArtifact = buildArtifactMatcher([
  'report_summary_json',
  'report summary json',
  '_report_summary.json',
  'report.summary',
]);

export const isCreateQualityArtifact = buildArtifactMatcher([
  'create_quality',
  '_create_quality.json',
  'model.quality-summary',
]);

export const isDrawingQualityArtifact = buildArtifactMatcher([
  'drawing_quality',
  '_drawing_quality.json',
  'drawing.quality-summary',
]);

export const isManifestArtifact = buildArtifactMatcher([
  '_manifest.json',
  'output.manifest.json',
  'create_manifest',
]);

function findFirstArtifact(artifacts = [], predicate) {
  return artifacts.find((artifact) => artifact?.exists !== false && predicate(artifact)) || null;
}

export function collectQualityDashboardArtifacts(artifacts = []) {
  const reportSummary = findFirstArtifact(artifacts, isReportSummaryArtifact);
  const createQuality = findFirstArtifact(artifacts, isCreateQualityArtifact);
  const drawingQuality = findFirstArtifact(artifacts, isDrawingQualityArtifact);
  const manifest = findFirstArtifact(artifacts, isManifestArtifact);

  return {
    reportSummary,
    createQuality,
    drawingQuality,
    manifest,
    payloadArtifacts: [reportSummary, createQuality, drawingQuality, manifest].filter(Boolean),
  };
}

function buildSurface({
  id,
  title,
  status,
  summary,
  score = null,
  meta = [],
}) {
  return {
    id,
    title,
    status: normalizeSurfaceStatus(status),
    tone: toStatusTone(status),
    summary,
    score,
    meta: meta.filter(Boolean),
  };
}

function summaryFromIssues(issues = [], fallback) {
  return uniqueStrings(issues)[0] || fallback;
}

function buildCheck(label, status, detail = '', {
  id = null,
  surface = label,
  required = false,
  decision = false,
  sourceArtifactId = null,
  gate = null,
} = {}) {
  const normalizedStatus = normalizeSurfaceStatus(status);
  return {
    id: id || `${String(surface || label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    label,
    surface,
    required,
    decision,
    status: normalizedStatus,
    displayStatus: formatQualityStatusLabel(normalizedStatus, required),
    tone: toStatusTone(status),
    detail,
    sourceArtifactId,
    gate,
  };
}

function statusCheckBucket(status = '') {
  const normalized = normalizeSurfaceStatus(status);
  if (['pass', 'available', 'generated', 'in_memory'].includes(normalized)) return 'passed';
  if (normalized === 'fail') return 'failed';
  return 'unavailable';
}

function appendStatusCheck(groups, label, status, detail = '', options = {}) {
  const check = buildCheck(label, status, detail, options);
  groups[statusCheckBucket(status)].push(check);
  return groups;
}

function buildSurfaceDetail(surface = {}) {
  const details = [];
  if (surface.score !== null && surface.score !== undefined && Number.isFinite(Number(surface.score))) {
    details.push(`score ${Number(surface.score)}`);
  }
  if (surface.invalid_shape === true) details.push('invalid shape');
  if (Array.isArray(surface.missing_required_dimensions) && surface.missing_required_dimensions.length > 0) {
    details.push(`missing dimensions ${surface.missing_required_dimensions.join(', ')}`);
  }
  if (Number(surface.conflict_count || 0) > 0) details.push(`${surface.conflict_count} dimension conflicts`);
  if (Number(surface.overlap_count || 0) > 0) details.push(`${surface.overlap_count} overlaps`);
  if (Number.isFinite(Number(surface.traceability_coverage_percent))) {
    details.push(`traceability ${Number(surface.traceability_coverage_percent)}%`);
  }
  if (surface.severity_counts?.critical) details.push(`${surface.severity_counts.critical} critical findings`);
  if (surface.severity_counts?.major) details.push(`${surface.severity_counts.major} major findings`);
  return details.join(' - ');
}

function formatArtifactReferenceLabel(artifact = {}) {
  if (typeof artifact.label === 'string' && artifact.label.trim()) return artifact.label.trim();
  const raw = artifact.label || artifact.key || artifact.type || 'Artifact';
  return String(raw)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatArtifactReferenceStatus(status = '', required = false) {
  const normalized = normalizeString(status);
  if (normalized === 'generated' || normalized === 'available' || normalized === 'in_memory') {
    return {
      status: normalized,
      detail: formatQualityStatusLabel(normalized, required),
    };
  }
  if (normalized === 'missing' || normalized === 'not_available' || normalized === 'not_run') {
    return {
      status: normalized,
      detail: formatQualityStatusLabel(normalized, required),
    };
  }
  return {
    status: normalized || 'not_available',
    detail: formatQualityStatusLabel(normalized || 'not_available', required),
  };
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function formatPercent(...values) {
  const numberValue = firstFiniteNumber(...values);
  if (numberValue === null) return null;
  return Number.isInteger(numberValue) ? `${numberValue}%` : `${numberValue.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

function issueText(issue) {
  if (typeof issue === 'string') return issue;
  if (issue && typeof issue === 'object') return issue.message || issue.summary || issue.code || '';
  return '';
}

function stringListFrom(...values) {
  return uniqueStrings(values.flatMap((value) => safeList(value).map(issueText)));
}

function drawingStatusLabel(status = '', available = true) {
  if (!available) return 'Unknown';
  const normalized = normalizeSurfaceStatus(status);
  if (normalized === 'pass') return 'Pass';
  if (normalized === 'fail') return 'Fail';
  if (normalized === 'warning') return 'Advisory';
  if (normalized === 'not_available' || normalized === 'not_run' || normalized === 'missing' || normalized === 'incomplete') {
    return 'Unknown';
  }
  return formatQualityStatusLabel(normalized);
}

function drawingStatusTone(status = '', available = true) {
  if (!available) return 'info';
  const normalized = normalizeSurfaceStatus(status);
  if (normalized === 'pass') return 'ok';
  if (normalized === 'fail') return 'bad';
  if (normalized === 'warning') return 'warn';
  return 'info';
}

function collectDrawingMissingNotesViews(surface = {}, raw = {}) {
  const missingViews = stringListFrom(
    surface.missing_views,
    surface.missing_required_views,
    raw.views?.missing_views,
    raw.views?.missing_required_views,
    raw.views?.missing_required
  ).map((entry) => `View: ${entry}`);
  const missingNotes = stringListFrom(
    surface.missing_notes,
    surface.missing_required_notes,
    raw.notes?.missing_notes,
    raw.notes?.missing_required_notes,
    raw.notes?.missing_required,
    raw.annotations?.missing_required_notes
  ).map((entry) => `Note: ${entry}`);
  const expectedViews = firstFiniteNumber(raw.views?.required_count, raw.views?.expected_count);
  const generatedViews = firstFiniteNumber(raw.views?.generated_count, raw.views?.actual_count);

  return uniqueStrings([
    ...missingViews,
    ...missingNotes,
    expectedViews !== null && generatedViews !== null && generatedViews < expectedViews
      ? `Views generated ${generatedViews}/${expectedViews}`
      : '',
  ]);
}

function buildDrawingCoverageLabel(surface = {}, raw = {}, missingRequiredDimensions = []) {
  const coverage = formatPercent(
    surface.traceability_coverage_percent,
    raw.traceability?.coverage_percent,
    raw.dimensions?.coverage_percent
  );
  const linkedDimensions = firstFiniteNumber(raw.traceability?.linked_dimensions, raw.traceability?.summary?.linked_dimensions);
  const dimensionCount = firstFiniteNumber(raw.traceability?.dimension_count, raw.traceability?.summary?.dimension_count);

  if (coverage) return `${coverage} traceability coverage`;
  if (linkedDimensions !== null && dimensionCount !== null) return `${linkedDimensions}/${dimensionCount} dimension links covered`;
  if (missingRequiredDimensions.length === 0 && normalizeSurfaceStatus(surface.status) === 'pass') return 'Covered';
  return 'Unknown';
}

function buildDrawingQualityPanel({ artifacts = [], reportSummary = {}, drawingSurface = {}, drawingQuality = {} } = {}) {
  const raw = safeObject(drawingQuality);
  const surface = safeObject(drawingSurface);
  const artifactLinks = buildArtifactLinks(artifacts);
  const drawingArtifact = artifactLinks.find((artifact) => artifact.id === 'drawing_quality_json') || null;
  const reportArtifact = artifactLinks.find((artifact) => artifact.id === 'report_summary_json') || null;
  const hasSurfaceEvidence = Object.keys(surface).length > 0;
  const hasRawEvidence = Object.keys(raw).length > 0;
  const hasArtifactEvidence = Boolean(drawingArtifact || reportArtifact);
  if (!hasSurfaceEvidence && !hasRawEvidence && !hasArtifactEvidence) return null;

  const available = surface.available === true || hasRawEvidence;
  const status = available
    ? normalizeSurfaceStatus(surface.status || raw.status || 'warning')
    : 'not_available';
  const missingRequiredDimensions = uniqueStrings([
    ...safeList(surface.missing_required_dimensions),
    ...safeList(raw.dimensions?.missing_required_intents),
    ...safeList(raw.dimensions?.missing_required_dimensions),
  ]);
  const conflictCount = firstFiniteNumber(surface.conflict_count, raw.dimensions?.conflict_count) || 0;
  const overlapCount = firstFiniteNumber(surface.overlap_count, raw.views?.overlap_count) || 0;
  const missingNotesViews = collectDrawingMissingNotesViews(surface, raw);
  const blockers = uniqueStrings([
    ...stringListFrom(surface.blocking_issues, raw.blocking_issues),
    ...missingRequiredDimensions.map((entry) => `Missing required dimension: ${entry}`),
    conflictCount > 0 ? `${conflictCount} dimension conflicts` : '',
    overlapCount > 0 ? `${overlapCount} drawing layout overlaps` : '',
  ]);
  const advisoryItems = uniqueStrings([
    ...stringListFrom(surface.warnings, raw.warnings),
    ...safeList(raw.dimensions?.missing_optional_intents).map((entry) => `Optional dimension: ${entry}`),
    ...safeList(raw.notes?.missing_optional_notes).map((entry) => `Optional note: ${entry}`),
  ]);
  const blocksReview = available && (
    status === 'fail'
    || blockers.length > 0
    || missingRequiredDimensions.length > 0
    || missingNotesViews.length > 0
    || conflictCount > 0
    || overlapCount > 0
  );
  const advisoryOnly = available && !blocksReview && (status === 'warning' || advisoryItems.length > 0);
  const suggestedActions = uniqueStrings([
    ...safeList(surface.recommended_actions),
    ...safeList(raw.recommended_actions),
    !available ? 'Run drawing semantic QA to produce drawing_quality evidence.' : '',
    blocksReview && missingRequiredDimensions.length > 0 ? 'Add or map the missing required drawing dimensions before review.' : '',
    blocksReview && missingNotesViews.length > 0 ? 'Add the missing required drawing notes or views before review.' : '',
    blocksReview && conflictCount > 0 ? 'Resolve drawing dimension conflicts before manufacturing review.' : '',
    blocksReview && overlapCount > 0 ? 'Repair drawing view or annotation overlaps before manufacturing review.' : '',
    !blocksReview && !advisoryOnly && available ? 'No drawing action required.' : '',
  ]);

  return {
    available,
    status,
    statusLabel: drawingStatusLabel(status, available),
    tone: drawingStatusTone(status, available),
    score: firstFiniteNumber(surface.score, raw.score),
    criticalCoverageLabel: buildDrawingCoverageLabel(surface, raw, missingRequiredDimensions),
    missingRequiredDimensions,
    missingNotesViews,
    blockers,
    advisoryItems,
    suggestedActions,
    decisionImpact: !available
      ? 'Unknown - drawing semantic QA not available for this job'
      : blocksReview
        ? 'Blocks manufacturing review'
        : advisoryOnly
          ? 'Advisory only'
          : 'Does not block manufacturing review',
    evidenceArtifact: drawingArtifact || reportArtifact || null,
    evidenceSource: drawingArtifact
      ? 'drawing_quality evidence'
      : reportArtifact
        ? 'report_summary drawing surface'
        : 'drawing quality payload',
    reportReady: typeof reportSummary.ready_for_manufacturing_review === 'boolean'
      ? reportSummary.ready_for_manufacturing_review
      : null,
  };
}

function buildReportSummaryChecks({ reportSummary = {}, reportArtifactPresent = false } = {}) {
  const groups = {
    passed: [],
    failed: [],
    unavailable: [],
  };

  appendStatusCheck(
    groups,
    'Overall status',
    reportSummary.overall_status,
    reportSummary.ready_for_manufacturing_review === true
      ? 'ready for manufacturing review'
      : reportSummary.ready_for_manufacturing_review === false
        ? 'not ready for manufacturing review'
        : '',
    { decision: true, surface: 'Decision' }
  );
  appendStatusCheck(
    groups,
    'Ready for manufacturing review',
    reportSummary.ready_for_manufacturing_review === true ? 'pass' : 'fail',
    reportSummary.ready_for_manufacturing_review === true ? 'Yes' : 'No',
    { decision: true, surface: 'Decision' }
  );

  const surfaces = safeObject(reportSummary.surfaces);
  [
    ['Geometry', surfaces.create_quality, true],
    ['Drawing', surfaces.drawing_quality, true],
    ['DFM', surfaces.dfm, true],
    ['Report', { status: 'pass' }, true],
    ['FEM', surfaces.fem, false],
    ['Tolerance', surfaces.tolerance, false],
  ].forEach(([label, surface, required]) => {
    const safeSurface = safeObject(surface);
    appendStatusCheck(groups, label, safeSurface.status || 'not_available', buildSurfaceDetail(safeSurface), {
      surface: label,
      required,
      gate: label,
      sourceArtifactId: `${label.toLowerCase()}_surface`,
    });
  });

  appendStatusCheck(
    groups,
    'Report PDF',
    reportArtifactPresent ? 'pass' : 'not_available',
    reportArtifactPresent ? 'openable artifact link present' : 'PDF artifact link missing',
    { surface: 'Artifacts', required: true, sourceArtifactId: 'report_pdf' }
  );

  safeList(reportSummary.artifacts_referenced).forEach((artifact) => {
    const required = typeof artifact?.required === 'boolean'
      ? artifact.required
      : !OPTIONAL_ARTIFACT_KEYS.has(artifact?.key);
    const artifactStatus = formatArtifactReferenceStatus(artifact?.status, required);
    appendStatusCheck(
      groups,
      formatArtifactReferenceLabel(artifact),
      artifactStatus.status,
      artifactStatus.detail,
      {
        id: `artifact-${artifact?.key || artifact?.label || artifact?.type || 'unknown'}`,
        surface: 'Artifacts',
        required,
        sourceArtifactId: artifact?.key || artifact?.id || null,
      }
    );
  });

  return groups;
}

function buildFallbackChecks({ createSurface = {}, drawingSurface = {}, reportStatus = 'not_available' } = {}) {
  const groups = {
    passed: [],
    failed: [],
    unavailable: [],
  };
  appendStatusCheck(groups, 'Geometry', createSurface.status, createSurface.invalidShape ? 'invalid shape' : '', {
    surface: 'Geometry',
    required: true,
    gate: 'Geometry',
  });
  appendStatusCheck(
    groups,
    'Drawing',
    drawingSurface.status,
    [
      drawingSurface.score !== null && drawingSurface.score !== undefined && Number.isFinite(Number(drawingSurface.score))
        ? `score ${drawingSurface.score}`
        : '',
      drawingSurface.missingRequiredDimensions?.length
        ? `missing dimensions ${drawingSurface.missingRequiredDimensions.join(', ')}`
        : '',
      drawingSurface.conflictCount > 0 ? `${drawingSurface.conflictCount} dimension conflicts` : '',
      drawingSurface.overlapCount > 0 ? `${drawingSurface.overlapCount} overlaps` : '',
    ].filter(Boolean).join(' - '),
    { surface: 'Drawing', required: true, gate: 'Drawing' }
  );
  appendStatusCheck(groups, 'DFM', 'not_available', 'DFM summary is not available for this artifact set.', {
    surface: 'DFM',
    required: true,
    gate: 'DFM',
  });
  appendStatusCheck(groups, 'Report', reportStatus, reportStatus === 'available' ? 'partial report evidence found' : '', {
    surface: 'Report',
    required: true,
    gate: 'Report',
  });
  return groups;
}

function flattenChecks(checks = {}) {
  return [
    ...safeList(checks.passed),
    ...safeList(checks.failed),
    ...safeList(checks.unavailable),
  ];
}

function requiredGateChecks(checks = {}) {
  return flattenChecks(checks).filter((check) => check.required && check.gate);
}

function failedRequiredGateChecks(checks = {}) {
  return requiredGateChecks(checks).filter((check) => (
    check.status === 'fail'
    || check.status === 'not_available'
    || check.status === 'missing'
    || check.status === 'not_run'
  ));
}

function passedRequiredGateChecks(checks = {}) {
  return requiredGateChecks(checks).filter((check) => (
    check.status === 'pass'
    || check.status === 'available'
    || check.status === 'generated'
    || check.status === 'in_memory'
  ));
}

function gateNames(checks = []) {
  return uniqueStrings(checks.map((check) => check.surface || check.label));
}

function buildDecisionCopies({ overallStatus, readyForManufacturingReview, checks = {} } = {}) {
  const failedGates = failedRequiredGateChecks(checks);
  const failedNames = gateNames(failedGates);
  const failedLabel = failedNames.length > 0 ? failedNames.join(', ') : 'required quality gates';

  if (overallStatus === 'pass' && readyForManufacturingReview === true) {
    return {
      blockedCopy: 'No manufacturing blockers',
      readyCopy: 'Ready for manufacturing review: Yes',
      gateCopy: 'All required quality gates passed',
    };
  }

  if (overallStatus === 'fail' || readyForManufacturingReview === false) {
    return {
      blockedCopy: `Manufacturing review blocked by ${failedGates.length} quality checks`,
      readyCopy: `Ready for manufacturing review: No because ${failedLabel} failed`,
      gateCopy: failedLabel,
    };
  }

  return {
    blockedCopy: 'Manufacturing review readiness is incomplete',
    readyCopy: 'Ready for manufacturing review: Unknown',
    gateCopy: 'Required quality gates are incomplete',
  };
}

function withDecisionFields(model = {}) {
  const failedGates = failedRequiredGateChecks(model.checks);
  const passedGates = passedRequiredGateChecks(model.checks);
  const decisionCopies = buildDecisionCopies({
    overallStatus: model.overallStatus,
    readyForManufacturingReview: model.readyForManufacturingReview,
    checks: model.checks,
  });

  return {
    ...model,
    layout: model.overallStatus === 'pass' && model.readyForManufacturingReview === true
      ? 'passed'
      : model.overallStatus === 'fail' || model.readyForManufacturingReview === false
        ? 'failed'
        : 'incomplete',
    failedGateChecks: failedGates,
    failedGateNames: gateNames(failedGates),
    passedRequiredGateChecks: passedGates,
    optionalImprovements: uniqueStrings(model.recommendedActions),
    decisionCopies,
  };
}

function buildArtifactLinks(artifacts = []) {
  const linkDefinitions = [
    {
      id: 'report_summary_json',
      label: 'Report summary JSON',
      required: true,
      match: isReportSummaryArtifact,
    },
    {
      id: 'manifest_json',
      label: 'Manifest JSON',
      required: false,
      match: isManifestArtifact,
    },
    {
      id: 'create_quality_json',
      label: 'Create quality JSON',
      required: true,
      match: isCreateQualityArtifact,
    },
    {
      id: 'drawing_quality_json',
      label: 'Drawing quality JSON',
      required: true,
      match: isDrawingQualityArtifact,
    },
    {
      id: 'report_pdf',
      label: 'PDF report',
      required: true,
      match: buildArtifactMatcher(['report.pdf', '_report.pdf']),
    },
    {
      id: 'drawing_svg',
      label: 'SVG drawing',
      required: true,
      match: buildArtifactMatcher(['drawing.svg', '_drawing.svg', '.svg']),
    },
    {
      id: 'model_step',
      label: 'STEP',
      required: true,
      match: buildArtifactMatcher(['model.step', '.step', '.stp']),
    },
    {
      id: 'model_stl',
      label: 'STL',
      required: true,
      match: buildArtifactMatcher(['model.stl', '.stl']),
    },
  ];

  return linkDefinitions
    .map((definition) => {
      const artifact = artifacts.find((entry) => entry?.exists !== false && definition.match(entry)) || null;
      if (!artifact) return null;
      return {
        id: definition.id,
        label: definition.label,
        kind: definition.id,
        required: definition.required !== false,
        status: 'available',
        statusLabel: formatQualityStatusLabel('available', definition.required !== false),
        fileName: artifact.file_name || artifact.key || artifact.id || definition.label,
        href: artifact.links?.open || null,
        downloadHref: artifact.links?.download || null,
        artifactId: artifact.id || null,
        sourceArtifactId: artifact.id || artifact.key || null,
      };
    })
    .filter(Boolean);
}

function buildReportSummaryModel({ artifacts = [], reportSummary = {}, drawingQuality = {} } = {}) {
  const surfaces = safeObject(reportSummary.surfaces);
  const createSurface = safeObject(surfaces.create_quality);
  const drawingSurface = safeObject(surfaces.drawing_quality);
  const dfmSurface = safeObject(surfaces.dfm);
  const reportArtifactPresent = buildArtifactLinks(artifacts).some((entry) => entry.id === 'report_pdf');
  const checks = buildReportSummaryChecks({ reportSummary, reportArtifactPresent });

  return withDecisionFields({
    source: 'report_summary',
    configName: deriveConfigName({ reportSummary, artifacts }),
    overallStatus: normalizeSurfaceStatus(reportSummary.overall_status || 'not_available'),
    overallTone: toStatusTone(reportSummary.overall_status),
    readyForManufacturingReview: typeof reportSummary.ready_for_manufacturing_review === 'boolean'
      ? reportSummary.ready_for_manufacturing_review
      : null,
    readyLabel: reportSummary.ready_for_manufacturing_review === true
      ? 'Yes'
      : reportSummary.ready_for_manufacturing_review === false
        ? 'No'
        : 'Unknown',
    surfaces: [
      buildSurface({
        id: 'geometry',
        title: 'Geometry',
        status: createSurface.status,
        summary: createSurface.invalid_shape
          ? 'Generated model shape is invalid.'
          : summaryFromIssues(createSurface.warnings, 'Create quality passed.'),
      }),
      buildSurface({
        id: 'drawing',
        title: 'Drawing',
        status: drawingSurface.status,
        score: drawingSurface.score ?? null,
        summary: drawingSurface.missing_required_dimensions?.length
          ? `Missing required dimensions: ${drawingSurface.missing_required_dimensions.join(', ')}.`
          : drawingSurface.conflict_count > 0
            ? `Dimension conflicts detected: ${drawingSurface.conflict_count}.`
            : summaryFromIssues(drawingSurface.warnings, 'Drawing quality passed.'),
      }),
      buildSurface({
        id: 'dfm',
        title: 'DFM',
        status: dfmSurface.status,
        score: dfmSurface.score ?? null,
        summary: (dfmSurface.severity_counts?.critical || 0) > 0
          ? `Critical DFM findings: ${dfmSurface.severity_counts.critical}.`
          : summaryFromIssues(
              [...safeList(dfmSurface.top_fixes), ...safeList(dfmSurface.warnings)],
              'DFM review passed.'
            ),
      }),
      buildSurface({
        id: 'report',
        title: 'Report',
        status: reportArtifactPresent ? 'pass' : 'available',
        summary: reportArtifactPresent
          ? 'Report summary and PDF are available for review.'
          : 'Report summary is available for review.',
      }),
    ],
    blockers: uniqueStrings([
      ...safeList(reportSummary.blocking_issues),
      ...safeList(reportSummary.top_risks),
    ]),
    warnings: uniqueStrings(safeList(reportSummary.warnings)),
    recommendedActions: uniqueStrings(safeList(reportSummary.recommended_actions)),
    artifactLinks: buildArtifactLinks(artifacts),
    drawingQuality: buildDrawingQualityPanel({
      artifacts,
      reportSummary,
      drawingSurface,
      drawingQuality,
    }),
    checks,
  });
}

function summarizeCreateFallback(createQuality = {}) {
  const blockingIssues = uniqueStrings(safeList(createQuality.blocking_issues));
  const invalidShape = createQuality.geometry?.valid_shape === false
    || blockingIssues.some((issue) => /invalid/i.test(issue));
  return {
    status: normalizeSurfaceStatus(createQuality.status || (invalidShape ? 'fail' : 'pass')),
    invalidShape,
    blockers: blockingIssues,
    warnings: uniqueStrings(safeList(createQuality.warnings)),
  };
}

function summarizeDrawingFallback(drawingQuality = {}) {
  const missingRequiredDimensions = uniqueStrings(safeList(drawingQuality.dimensions?.missing_required_intents));
  const blockingIssues = uniqueStrings(
    safeList(drawingQuality.blocking_issues).map((issue) => (
      typeof issue === 'string' ? issue : issue?.message
    ))
  );
  return {
    status: normalizeSurfaceStatus(drawingQuality.status || (
      missingRequiredDimensions.length > 0
      || Number(drawingQuality.dimensions?.conflict_count || 0) > 0
      || Number(drawingQuality.views?.overlap_count || 0) > 0
        ? 'fail'
        : 'pass'
    )),
    score: Number.isFinite(Number(drawingQuality.score)) ? Number(drawingQuality.score) : null,
    missingRequiredDimensions,
    conflictCount: Number.isFinite(Number(drawingQuality.dimensions?.conflict_count))
      ? Number(drawingQuality.dimensions.conflict_count)
      : 0,
    overlapCount: Number.isFinite(Number(drawingQuality.views?.overlap_count))
      ? Number(drawingQuality.views.overlap_count)
      : 0,
    blockingIssues,
    warnings: uniqueStrings(safeList(drawingQuality.warnings)),
    recommendedActions: uniqueStrings(safeList(drawingQuality.recommended_actions)),
  };
}

function buildFallbackModel({
  artifacts = [],
  createQuality = {},
  drawingQuality = {},
  manifest = {},
} = {}) {
  const createSurface = summarizeCreateFallback(createQuality);
  const drawingSurface = summarizeDrawingFallback(drawingQuality);
  const reportPdfArtifact = buildArtifactLinks(artifacts).find((entry) => entry.id === 'report_pdf') || null;
  const reportStatus = normalizeString(manifest.command) === 'report' || reportPdfArtifact ? 'available' : 'not_available';

  let overallStatus = 'pass';
  let readyForManufacturingReview = true;

  if (createSurface.status === 'fail' || drawingSurface.status === 'fail') {
    overallStatus = 'fail';
    readyForManufacturingReview = false;
  }

  const dfmMissingMessage = 'DFM summary is not available for this artifact set.';
  if (overallStatus !== 'fail') {
    overallStatus = 'incomplete';
    readyForManufacturingReview = null;
  }

  return withDecisionFields({
    source: 'quality_artifact_fallback',
    configName: deriveConfigName({ artifacts }),
    overallStatus,
    overallTone: toStatusTone(overallStatus),
    readyForManufacturingReview,
    readyLabel: readyForManufacturingReview === true ? 'Yes' : readyForManufacturingReview === false ? 'No' : 'Unknown',
    surfaces: [
      buildSurface({
        id: 'geometry',
        title: 'Geometry',
        status: createSurface.status,
        summary: createSurface.invalidShape
          ? 'Generated model shape is invalid.'
          : summaryFromIssues(createSurface.warnings, 'Create quality artifact is available.'),
      }),
      buildSurface({
        id: 'drawing',
        title: 'Drawing',
        status: drawingSurface.status,
        score: drawingSurface.score,
        summary: drawingSurface.missingRequiredDimensions.length > 0
          ? `Missing required dimensions: ${drawingSurface.missingRequiredDimensions.join(', ')}.`
          : drawingSurface.conflictCount > 0
            ? `Dimension conflicts detected: ${drawingSurface.conflictCount}.`
            : summaryFromIssues(drawingSurface.warnings, 'Drawing quality artifact is available.'),
      }),
      buildSurface({
        id: 'dfm',
        title: 'DFM',
        status: 'not_available',
        summary: dfmMissingMessage,
      }),
      buildSurface({
        id: 'report',
        title: 'Report',
        status: reportStatus,
        summary: reportStatus === 'available'
          ? 'Report artifacts are partially available without report_summary.json.'
          : 'No report artifact is attached to this job.',
      }),
    ],
    blockers: uniqueStrings([
      ...createSurface.blockers,
      ...drawingSurface.blockingIssues,
      dfmMissingMessage,
    ]),
    warnings: uniqueStrings([
      ...createSurface.warnings,
      ...drawingSurface.warnings,
    ]),
    recommendedActions: uniqueStrings([
      createSurface.invalidShape ? 'Repair the generated model geometry before proceeding.' : null,
      ...drawingSurface.recommendedActions,
      'Run report generation with DFM attached to restore the decision summary.',
    ]),
    artifactLinks: buildArtifactLinks(artifacts),
    drawingQuality: buildDrawingQualityPanel({
      artifacts,
      drawingSurface: {
        available: Object.keys(drawingQuality).length > 0,
        status: drawingSurface.status,
        score: drawingSurface.score,
        missing_required_dimensions: drawingSurface.missingRequiredDimensions,
        conflict_count: drawingSurface.conflictCount,
        overlap_count: drawingSurface.overlapCount,
        recommended_actions: drawingSurface.recommendedActions,
        blocking_issues: drawingSurface.blockingIssues,
        warnings: drawingSurface.warnings,
      },
      drawingQuality,
    }),
    checks: buildFallbackChecks({ createSurface, drawingSurface, reportStatus }),
  });
}

export function buildQualityDashboardModel({
  artifacts = [],
  artifactPayloads = {},
} = {}) {
  const selectedArtifacts = collectQualityDashboardArtifacts(artifacts);
  const reportSummary = safeObject(selectedArtifacts.reportSummary ? artifactPayloads[selectedArtifacts.reportSummary.id] : null);
  if (Object.keys(reportSummary).length > 0 && reportSummary.overall_status) {
    const drawingQuality = safeObject(selectedArtifacts.drawingQuality ? artifactPayloads[selectedArtifacts.drawingQuality.id] : null);
    return buildReportSummaryModel({ artifacts, reportSummary, drawingQuality });
  }

  const createQuality = safeObject(selectedArtifacts.createQuality ? artifactPayloads[selectedArtifacts.createQuality.id] : null);
  const drawingQuality = safeObject(selectedArtifacts.drawingQuality ? artifactPayloads[selectedArtifacts.drawingQuality.id] : null);
  const manifest = safeObject(selectedArtifacts.manifest ? artifactPayloads[selectedArtifacts.manifest.id] : null);

  const hasFallbackInputs = Object.keys(createQuality).length > 0
    || Object.keys(drawingQuality).length > 0
    || Object.keys(manifest).length > 0;
  if (!hasFallbackInputs && buildArtifactLinks(artifacts).length === 0) {
    return null;
  }

  return buildFallbackModel({
    artifacts,
    createQuality,
    drawingQuality,
    manifest,
  });
}
