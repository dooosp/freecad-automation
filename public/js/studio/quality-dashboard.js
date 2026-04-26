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
  'extracted_drawing_semantics',
]);

function basename(value = '') {
  return String(value || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
}

function stripKnownConfigSuffix(value = '') {
  return String(value || '')
    .replace(/_report_summary\.json$/i, '')
    .replace(/_report\.pdf$/i, '')
    .replace(/_drawing_quality\.json$/i, '')
    .replace(/_extracted_drawing_semantics\.json$/i, '')
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

export const isExtractedDrawingSemanticsArtifact = buildArtifactMatcher([
  'extracted_drawing_semantics',
  '_extracted_drawing_semantics.json',
  'drawing.extracted-semantics',
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

function joinDisplayParts(parts = [], separator = ' · ') {
  return parts.filter(Boolean).join(separator);
}

function formatConfidenceLabel(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '';
  return `${Math.round(numberValue * 100)}% confidence`;
}

function humanizeToken(value = '') {
  if (!value) return '';
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatUpperStatus(status = '') {
  const normalized = normalizeSurfaceStatus(status);
  if (normalized === 'pass') return 'PASS';
  if (normalized === 'fail') return 'FAIL';
  if (normalized === 'warning') return 'WARNING';
  if (normalized === 'missing') return 'MISSING';
  if (normalized === 'unavailable' || normalized === 'not_available') return 'UNAVAILABLE';
  if (normalized === 'skipped') return 'SKIPPED';
  return normalized ? normalized.replace(/_/g, ' ').toUpperCase() : 'UNKNOWN';
}

function formatMeasurementValue(value, { unit = '', precision = 4 } = {}) {
  if (Array.isArray(value)) {
    const formatted = value.map((entry) => formatMeasurementValue(entry, { precision })).join(', ');
    return `[${formatted}]${unit ? ` ${unit}` : ''}`;
  }

  if (value === null || value === undefined || value === '') return 'Not reported';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Number.isFinite(Number(value))) {
    const rounded = Number(Number(value).toFixed(precision));
    return `${rounded}${unit ? ` ${unit}` : ''}`;
  }
  return String(value);
}

function statusFromBoolean(value) {
  if (value === true) return 'pass';
  if (value === false) return 'fail';
  return 'unavailable';
}

function statusFromDelta(delta, tolerance) {
  if (!Number.isFinite(Number(delta))) return 'unavailable';
  if (!Number.isFinite(Number(tolerance))) return 'unavailable';
  return Number(delta) <= Number(tolerance) ? 'pass' : 'fail';
}

function formatMeasurementSource(value = '') {
  const normalized = normalizeString(value);
  if (normalized === 'generated_shape_geometry') return 'generated_shape_geometry';
  if (normalized === 'reimported_step_geometry') return 'reimported_step_geometry';
  if (normalized === 'config_parameter') return 'config_parameter';
  if (normalized === 'unavailable') return 'unavailable';
  return value || 'Not reported';
}

function engineeringSourceTitle(source = '') {
  const normalized = normalizeString(source);
  if (normalized === 'generated_shape_geometry') return 'Generated geometry';
  if (normalized === 'reimported_step_geometry') return 'STEP reimport';
  return humanizeToken(source) || 'Engineering quality';
}

function formatFeatureLabel(featureId = '', fallback = '') {
  const normalized = normalizeString(featureId);
  if (normalized === 'hole_left' || normalized === 'left_hole') return 'Left hole';
  if (normalized === 'hole_right' || normalized === 'right_hole') return 'Right hole';
  if (normalized === 'hole') return 'Hole';
  return humanizeToken(featureId || fallback);
}

function measurementLabel(measurement = {}) {
  const feature = formatFeatureLabel(measurement.feature_id, measurement.source_requirement_id || measurement.requirement_id);
  const type = normalizeString(measurement.measurement_type);
  if (type === 'hole_diameter') return `${feature || 'Hole'} diameter`;
  if (type === 'hole_center') return `${feature || 'Hole'} center`;
  return humanizeToken(measurement.requirement_id || measurement.measurement_type || 'Engineering check');
}

function measurementExpectedActual(measurement = {}) {
  const type = normalizeString(measurement.measurement_type);
  if (type === 'hole_center') {
    return {
      expected: formatMeasurementValue(measurement.expected_center_xy_mm, { unit: 'mm' }),
      actual: formatMeasurementValue(measurement.actual_center_xy_mm, { unit: 'mm' }),
      delta: formatMeasurementValue(
        measurement.center_delta_mm ?? measurement.delta_mm ?? measurement.source_center_delta_mm,
        { unit: 'mm' }
      ),
    };
  }

  return {
    expected: formatMeasurementValue(measurement.expected_value_mm, { unit: 'mm' }),
    actual: formatMeasurementValue(
      measurement.actual_value_mm ?? measurement.source_value_mm,
      { unit: 'mm' }
    ),
    delta: formatMeasurementValue(
      measurement.delta_mm ?? measurement.source_delta_mm,
      { unit: 'mm' }
    ),
  };
}

function buildEngineeringRow({
  id,
  label,
  status,
  expected = 'Not reported',
  actual = 'Not reported',
  delta = 'Not reported',
  tolerance = 'Not reported',
  source = 'Not reported',
  detail = '',
  failureKind = '',
  measurementType = '',
  featureId = '',
  validationKind = '',
}) {
  const normalizedStatus = normalizeSurfaceStatus(status);
  return {
    id,
    label,
    status: normalizedStatus,
    statusLabel: formatUpperStatus(normalizedStatus),
    tone: toStatusTone(normalizedStatus),
    expected,
    actual,
    delta,
    tolerance,
    source: formatMeasurementSource(source),
    detail,
    failureKind,
    measurementType,
    featureId,
    validationKind,
  };
}

function buildEngineeringMeasurementRow(measurement = {}) {
  const values = measurementExpectedActual(measurement);
  const label = measurementLabel(measurement);
  const detail = measurement.message
    || (normalizeSurfaceStatus(measurement.status) === 'pass'
      ? `${label} is within the reported tolerance.`
      : '');
  return buildEngineeringRow({
    id: measurement.requirement_id || `${measurement.source || 'engineering'}-${label}`,
    label,
    status: measurement.status,
    expected: values.expected,
    actual: values.actual,
    delta: values.delta,
    tolerance: formatMeasurementValue(measurement.tolerance_mm, { unit: 'mm' }),
    source: measurement.source,
    detail,
    failureKind: normalizeString(measurement.measurement_type),
    measurementType: normalizeString(measurement.measurement_type),
    featureId: measurement.feature_id || '',
    validationKind: measurement.validation_kind || '',
  });
}

function buildGeneratedShapeRows(createQuality = {}) {
  const geometry = safeObject(createQuality.geometry);
  const rows = [];
  const validStatus = statusFromBoolean(geometry.valid_shape);
  rows.push(buildEngineeringRow({
    id: 'generated-shape-validity',
    label: 'Shape validity',
    status: validStatus,
    expected: 'Valid shape',
    actual: geometry.valid_shape === true
      ? 'Valid shape'
      : geometry.valid_shape === false
        ? 'Invalid shape'
        : 'Not reported',
    delta: 'Not applicable',
    tolerance: 'Required',
    source: 'generated_shape_geometry',
    detail: validStatus === 'pass'
      ? 'Generated model shape is valid.'
      : validStatus === 'fail'
        ? 'Generated model shape is invalid.'
        : 'Generated shape validity was not reported.',
    failureKind: 'shape_validity',
  }));

  if (geometry.bbox) {
    rows.push(buildEngineeringRow({
      id: 'generated-bbox',
      label: 'Bounding box',
      status: 'pass',
      expected: 'Generated bbox available',
      actual: `size ${formatMeasurementValue(geometry.bbox.size, { unit: 'mm' })}`,
      delta: 'Not applicable',
      tolerance: 'Metadata present',
      source: 'generated_shape_geometry',
      detail: 'Generated bounding-box metadata is available.',
      failureKind: 'bounding_box',
    }));
  }

  if (geometry.volume !== null && geometry.volume !== undefined) {
    const status = Number(geometry.volume) > 0 ? 'pass' : 'fail';
    rows.push(buildEngineeringRow({
      id: 'generated-volume',
      label: 'Volume',
      status,
      expected: '> 0 mm^3',
      actual: formatMeasurementValue(geometry.volume, { unit: 'mm^3' }),
      delta: 'Not applicable',
      tolerance: 'Positive volume',
      source: 'generated_shape_geometry',
      detail: status === 'pass'
        ? 'Generated model volume is positive.'
        : 'Generated model volume is empty or non-positive.',
      failureKind: 'volume',
    }));
  }

  return rows;
}

function buildStepRoundtripRows(createQuality = {}) {
  const step = safeObject(createQuality.step_roundtrip);
  if (Object.keys(step).length === 0) return [];

  const thresholds = safeObject(createQuality.thresholds);
  const rows = [];
  if (step.reimport_attempted || step.reimport_valid !== null && step.reimport_valid !== undefined) {
    const validStatus = statusFromBoolean(step.reimport_valid);
    rows.push(buildEngineeringRow({
      id: 'step-shape-validity',
      label: 'STEP shape validity',
      status: validStatus,
      expected: 'Valid reimported STEP shape',
      actual: step.reimport_valid === true
        ? 'Valid shape'
        : step.reimport_valid === false
          ? 'Invalid shape'
          : 'Not reported',
      delta: 'Not applicable',
      tolerance: 'Required',
      source: 'reimported_step_geometry',
      detail: validStatus === 'pass'
        ? 'STEP reimport produced a valid shape.'
        : validStatus === 'fail'
          ? 'STEP reimported shape is invalid.'
          : 'STEP reimport validity was not reported.',
      failureKind: 'step_reimport_shape',
    }));
  }

  if (step.volume_delta_percent !== null && step.volume_delta_percent !== undefined) {
    const tolerance = thresholds.max_step_volume_delta_percent;
    rows.push(buildEngineeringRow({
      id: 'step-volume-delta',
      label: 'STEP volume delta',
      status: statusFromDelta(step.volume_delta_percent, tolerance),
      expected: 'Match generated volume',
      actual: formatMeasurementValue(step.volume_delta_percent, { unit: '%' }),
      delta: formatMeasurementValue(step.volume_delta_percent, { unit: '%' }),
      tolerance: formatMeasurementValue(tolerance, { unit: '%' }),
      source: 'reimported_step_geometry',
      detail: 'STEP reimport volume delta is compared with the generated model volume.',
      failureKind: 'step_reimport_volume',
    }));
  }

  if (step.bbox_delta?.max_abs_mm !== null && step.bbox_delta?.max_abs_mm !== undefined) {
    const tolerance = thresholds.max_bbox_delta_mm;
    rows.push(buildEngineeringRow({
      id: 'step-bbox-delta',
      label: 'STEP bounding box',
      status: statusFromDelta(step.bbox_delta.max_abs_mm, tolerance),
      expected: 'Match generated bbox',
      actual: `max delta ${formatMeasurementValue(step.bbox_delta.max_abs_mm, { unit: 'mm' })}`,
      delta: formatMeasurementValue(step.bbox_delta.max_abs_mm, { unit: 'mm' }),
      tolerance: formatMeasurementValue(tolerance, { unit: 'mm' }),
      source: 'reimported_step_geometry',
      detail: 'STEP reimport bounding-box delta is compared with the generated model bbox.',
      failureKind: 'step_reimport_bounding_box',
    }));
  }

  return rows;
}

function isMissingEvidenceRow(row = {}) {
  if (['missing', 'unavailable', 'not_available', 'not_run', 'incomplete'].includes(normalizeSurfaceStatus(row.status))) {
    return true;
  }
  return [row.expected, row.actual, row.delta, row.tolerance, row.source].some((value) => (
    normalizeString(value) === 'not reported' || normalizeString(value) === 'unavailable'
  ));
}

function rowFailureKind(row = {}) {
  const explicit = normalizeString(row.failureKind || row.measurementType);
  const label = normalizeString(row.label);
  const source = normalizeString(row.source);

  if (isMissingEvidenceRow(row)) return 'missing_evidence';
  if (explicit === 'hole_center' || label.includes('hole center')) return 'hole_center';
  if (explicit === 'hole_diameter' || label.includes('hole diameter')) return 'hole_diameter';
  if (explicit.includes('bounding_box') || label.includes('bounding box')) return source === 'reimported_step_geometry' ? 'step_reimport_bounding_box' : 'bounding_box';
  if (explicit.includes('volume') || label.includes('volume')) return source === 'reimported_step_geometry' ? 'step_reimport_volume' : 'volume';
  if (explicit.includes('shape') || label.includes('shape validity')) return source === 'reimported_step_geometry' ? 'step_reimport_shape' : 'shape_validity';
  if (source === 'reimported_step_geometry') return 'step_reimport';
  return 'engineering_measurement';
}

function buildFailureGuidanceEntry(row = {}) {
  const kind = rowFailureKind(row);
  const label = row.label || 'Engineering check';
  const isStep = normalizeString(row.source) === 'reimported_step_geometry' || kind.startsWith('step_reimport');
  const suffix = isStep ? ' after STEP reimport' : '';
  const evidenceCopy = isStep
    ? 'Inspect the STEP export, create-quality JSON, and generated-vs-reimported measurements.'
    : 'Inspect the create-quality JSON and compare expected, actual, delta, tolerance, and source.';

  const base = {
    id: row.id || `${kind}-${label}`,
    label,
    statusLabel: row.statusLabel || formatUpperStatus(row.status),
    source: row.source || 'Not reported',
    evidence: evidenceCopy,
    rerun: 'Run tracked create again after the fix, then run tracked report again when report artifacts need to reflect the new result.',
    success: 'Open Artifacts and confirm Engineering Quality becomes PASS.',
  };

  if (kind === 'hole_center') {
    return {
      ...base,
      whatFailed: `${label} is outside tolerance${suffix}.`,
      whyItMatters: 'A hole position that misses the target center can break fit, fastening, or downstream drawing intent.',
      change: 'Check hole center, placement, pitch, bracket width/height, or source geometry that controls this feature.',
    };
  }

  if (kind === 'hole_diameter') {
    return {
      ...base,
      whatFailed: `${label} size is outside tolerance${suffix}.`,
      whyItMatters: 'A hole diameter that misses the target size can make hardware fit too loose, too tight, or impossible to assemble.',
      change: 'Check hole diameter or radius config values and the source feature that creates this cut.',
    };
  }

  if (kind === 'bounding_box' || kind === 'step_reimport_bounding_box') {
    return {
      ...base,
      whatFailed: `${label} does not match the expected part size${suffix}.`,
      whyItMatters: 'A part envelope mismatch means the generated or exported CAD may not match the intended bracket dimensions.',
      change: 'Check bracket dimensions, thickness, flange/base dimensions, or source geometry that controls the outer shape.',
    };
  }

  if (kind === 'volume' || kind === 'step_reimport_volume') {
    return {
      ...base,
      whatFailed: `${label} differs from the expected material volume${suffix}.`,
      whyItMatters: 'A volume mismatch can point to wrong dimensions, missing cutouts, failed holes, or unstable boolean operations.',
      change: 'Check dimensions, cutouts, holes, and boolean operations that add or remove material.',
    };
  }

  if (kind === 'shape_validity') {
    return {
      ...base,
      whatFailed: 'The generated CAD shape is invalid.',
      whyItMatters: 'Invalid geometry can make exported files, drawings, and manufacturing checks unreliable.',
      evidence: 'Inspect the generated files, create-quality JSON, and any geometry warnings attached to the run.',
      change: 'Check geometry operations, boolean cuts, fillets, chamfers, and feature dimensions that may create a broken solid.',
    };
  }

  if (kind === 'step_reimport_shape' || kind === 'step_reimport') {
    return {
      ...base,
      whatFailed: 'The exported STEP geometry did not preserve a valid expected result.',
      whyItMatters: 'If STEP reimport changes or invalidates geometry, the deliverable CAD file may not match the model Studio reviewed.',
      evidence: 'Inspect the STEP artifact, create-quality JSON, and reimported STEP evidence.',
      change: 'Check export settings, generated shape stability, boolean operations, and any source feature behind the failing STEP measurement.',
    };
  }

  if (kind === 'missing_evidence') {
    return {
      ...base,
      whatFailed: `${label} evidence is incomplete or missing.`,
      whyItMatters: 'Studio cannot prove the quality result without the expected measurement or artifact evidence.',
      evidence: 'Inspect generated files, quality evidence JSON, manifest entries, and job logs.',
      change: 'Check whether the tracked job produced the expected artifacts and whether the config/source path still resolves.',
    };
  }

  return {
    ...base,
    whatFailed: `${label} failed its engineering quality check.`,
    whyItMatters: 'The generated evidence does not match the expected engineering target closely enough to clear the quality gate.',
    change: 'Check the config or source feature that controls this measurement.',
  };
}

function buildEngineeringFailureNextActions({ failedRows = [], unavailableRows = [], status = '' } = {}) {
  const normalizedStatus = normalizeSurfaceStatus(status);
  if (normalizedStatus === 'pass') return null;

  const actionableRows = failedRows.length > 0 ? failedRows : unavailableRows;
  if (actionableRows.length === 0) return null;

  const entries = actionableRows.map(buildFailureGuidanceEntry);
  const primaryEntry = entries[0] || null;
  return {
    title: 'What to do next',
    summary: primaryEntry
      ? 'Start with the failed check, inspect the linked evidence, fix the related config or source geometry, then rerun the tracked flow.'
      : 'Inspect the available quality evidence, repair the source issue, then rerun the tracked flow.',
    entries,
    steps: [
      primaryEntry?.evidence || 'Inspect the quality evidence JSON for expected, actual, delta, tolerance, and source.',
      primaryEntry?.change || 'Fix the related config value or source geometry.',
      'Run tracked create again after the fix.',
      'Run tracked report again when report artifacts need to reflect the new result.',
      'Open Artifacts and confirm Engineering Quality becomes PASS.',
    ],
  };
}

function buildEngineeringQualitySummary(createQuality = {}) {
  if (!createQuality || Object.keys(createQuality).length === 0) return null;

  const engineering = safeObject(createQuality.engineering_quality);
  const measurements = safeList(engineering.measurements).map(buildEngineeringMeasurementRow);
  const generatedRows = [
    ...buildGeneratedShapeRows(createQuality),
    ...measurements.filter((row) => row.source === 'generated_shape_geometry'),
  ];
  const stepRows = [
    ...buildStepRoundtripRows(createQuality),
    ...measurements.filter((row) => row.source === 'reimported_step_geometry'),
  ];
  const hasEvidence = generatedRows.length > 0 || stepRows.length > 0;
  if (!hasEvidence) return null;

  const failedRows = [...generatedRows, ...stepRows].filter((row) => row.status === 'fail');
  const unavailableRows = [...generatedRows, ...stepRows].filter((row) => (
    row.status === 'missing' || row.status === 'unavailable' || row.status === 'not_available'
  ));
  const status = normalizeSurfaceStatus(
    engineering.status
    || createQuality.status
    || (failedRows.length > 0 ? 'fail' : unavailableRows.length > 0 ? 'warning' : 'pass')
  );

  return {
    status,
    statusLabel: formatUpperStatus(status),
    tone: toStatusTone(status),
    summary: status === 'pass'
      ? 'Generated geometry and STEP reimport checks are within reported tolerances.'
      : status === 'fail'
        ? `${failedRows.length} engineering quality check${failedRows.length === 1 ? '' : 's'} failed.`
        : 'Engineering quality evidence is incomplete.',
    sections: [
      {
        id: 'generated_shape_geometry',
        title: engineeringSourceTitle('generated_shape_geometry'),
        source: 'generated_shape_geometry',
        rows: generatedRows,
      },
      {
        id: 'reimported_step_geometry',
        title: engineeringSourceTitle('reimported_step_geometry'),
        source: 'reimported_step_geometry',
        rows: stepRows,
      },
    ].filter((section) => section.rows.length > 0),
    failures: failedRows,
    unavailableRows,
    nextActions: buildEngineeringFailureNextActions({ failedRows, unavailableRows, status }),
  };
}

function formatEvidenceSourceLabel(value = '') {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  if (normalized === 'svg') return 'SVG';
  if (normalized === 'layout_report') return 'Layout report';
  if (normalized === 'title_block') return 'Title block';
  return humanizeToken(value);
}

function normalizeExtractedSemanticsStatus(status = '') {
  const normalized = normalizeString(status);
  if (['available', 'partial', 'unknown', 'unsupported'].includes(normalized)) return normalized;
  if (['not_run', 'not_available', 'missing', 'incomplete'].includes(normalized)) return 'unknown';
  return normalized || 'unknown';
}

function formatExtractedSemanticsStatusLabel(status = '') {
  const normalized = normalizeExtractedSemanticsStatus(status);
  if (normalized === 'available') return 'Available';
  if (normalized === 'partial') return 'Partial';
  if (normalized === 'unsupported') return 'Unsupported';
  return 'Unknown';
}

function extractedSemanticsTone(status = '') {
  const normalized = normalizeExtractedSemanticsStatus(status);
  if (normalized === 'available') return 'ok';
  if (normalized === 'partial') return 'warn';
  return 'info';
}

function extractedClassificationLabel(classification = '') {
  const normalized = normalizeString(classification);
  if (normalized === 'extracted') return 'Extracted';
  if (normalized === 'missing') return 'Missing';
  if (normalized === 'unsupported') return 'Unsupported';
  return 'Unknown';
}

function extractedClassificationTone(classification = '') {
  const normalized = normalizeString(classification);
  if (normalized === 'extracted') return 'ok';
  if (normalized === 'missing') return 'warn';
  return 'info';
}

function defaultExtractedCoverageGroup() {
  return {
    total: 0,
    extracted: 0,
    missing: 0,
    unknown: 0,
    unsupported: 0,
    extracted_percent: null,
  };
}

function buildExtractedCoverageValue(coverage = {}) {
  const total = Number(coverage.total || 0);
  const extracted = Number(coverage.extracted || 0);
  const missing = Number(coverage.missing || 0);
  const unknown = Number(coverage.unknown || 0);
  const unsupported = Number(coverage.unsupported || 0);

  if (total > 0 && extracted === total && missing === 0 && unknown === 0 && unsupported === 0) {
    return `${extracted} / ${total} extracted`;
  }

  const segments = [
    extracted > 0 ? `${extracted} extracted` : '',
    unknown > 0 ? `${unknown} unknown` : '',
    missing > 0 ? `${missing} missing` : '',
    unsupported > 0 ? `${unsupported} unsupported` : '',
  ].filter(Boolean);

  if (segments.length > 0) return segments.join(', ');
  if (total > 0) return `0 / ${total} extracted`;
  return 'No required items';
}

function buildExtractedCoverageNote(coverage = {}) {
  return '';
}

const SUGGESTED_ACTION_GROUP_DEFINITIONS = [
  { id: 'dimensions', title: 'Dimensions' },
  { id: 'notes', title: 'Notes' },
  { id: 'views', title: 'Views' },
  { id: 'mapping', title: 'Mapping & labels' },
  { id: 'review', title: 'Review / extraction' },
  { id: 'other', title: 'Layout / other' },
];

function normalizeSuggestedActionSeverity(value = '') {
  const normalized = normalizeString(value);
  if (['advisory', 'review', 'info', 'enforceable'].includes(normalized)) return normalized;
  return normalized || 'advisory';
}

function formatSuggestedActionImpactLabel(value = '') {
  const normalized = normalizeSuggestedActionSeverity(value);
  if (normalized === 'advisory') return 'Advisory';
  if (normalized === 'review') return 'Review';
  if (normalized === 'info') return 'Info';
  if (normalized === 'enforceable') return 'Enforceable';
  return humanizeToken(normalized) || 'Advisory';
}

function suggestedActionImpactTone(value = '') {
  const normalized = normalizeSuggestedActionSeverity(value);
  if (normalized === 'review') return 'warn';
  if (normalized === 'enforceable') return 'bad';
  return 'info';
}

function normalizeSuggestedActionClassification(value = '') {
  const normalized = normalizeString(value);
  if (['missing', 'unknown', 'unsupported', 'unmatched', 'low_confidence'].includes(normalized)) return normalized;
  return normalized || 'unknown';
}

function formatSuggestedActionClassificationLabel(value = '') {
  const normalized = normalizeSuggestedActionClassification(value);
  if (normalized === 'low_confidence') return 'Low confidence';
  return humanizeToken(normalized) || 'Unknown';
}

function suggestedActionClassificationTone(value = '') {
  const normalized = normalizeSuggestedActionClassification(value);
  if (normalized === 'missing' || normalized === 'low_confidence') return 'warn';
  return 'info';
}

function suggestedActionGroupId(action = {}) {
  const category = normalizeString(action.category);
  if (category === 'dimension' || category === 'dimensions') return 'dimensions';
  if (category === 'note' || category === 'notes') return 'notes';
  if (category === 'view' || category === 'views') return 'views';
  if (['mapping', 'alias', 'aliases', 'label', 'labels'].includes(category)) return 'mapping';
  if (category === 'review' || category === 'extraction') return 'review';
  if (category === 'layout' || category === 'other') return 'other';
  if (normalizeSuggestedActionClassification(action.classification) === 'low_confidence') return 'review';
  return 'other';
}

function formatSuggestedActionEvidenceSource(source = '') {
  const normalized = normalizeString(source);
  if (!normalized) return '';
  if (normalized === 'drawing_quality.semantic_quality.extracted_evidence') return 'Extracted drawing semantics';
  if (normalized === 'drawing_quality.semantic_quality') return 'Drawing semantic quality';
  if (normalized === 'drawing_planner' || normalized === 'drawing_quality.semantic_quality.suggested_action_details') {
    return 'Drawing planner';
  }
  if (normalized.includes('extracted_evidence')) return 'Extracted drawing semantics';
  if (normalized.includes('drawing_planner')) return 'Drawing planner';
  return humanizeToken(source.split('.').pop() || source);
}

function summarizeSuggestedActionEvidence(evidence = []) {
  const sources = uniqueStrings(
    safeList(evidence)
      .map((item) => formatSuggestedActionEvidenceSource(item?.source))
      .filter(Boolean)
  );
  const paths = uniqueStrings(
    safeList(evidence)
      .map((item) => (typeof item?.path === 'string' ? item.path.trim() : ''))
      .filter(Boolean)
  );

  return {
    sourceSummary: sources.length > 0 ? `Evidence source: ${sources.join(', ')}` : '',
    pathSummary: paths.length > 0
      ? `Evidence path: ${paths.slice(0, 2).join(' · ')}${paths.length > 2 ? ` +${paths.length - 2} more` : ''}`
      : '',
  };
}

function buildSuggestedActionFallbackEntry(text = '', index = 0) {
  return {
    id: `fallback-${index + 1}`,
    severity: 'advisory',
    category: 'other',
    classification: 'unknown',
    title: text,
    message: '',
    recommended_fix: '',
    target_requirement_id: '',
    target_feature_id: '',
    evidence: [],
  };
}

function suggestedActionIdentity(entry = {}) {
  return uniqueStrings([
    entry.id,
    entry.category,
    entry.target_requirement_id,
    entry.target_feature_id,
    entry.classification,
    entry.severity,
    entry.title,
    entry.message,
    entry.recommended_fix,
    ...safeList(entry.evidence).map((item) => `${item?.source || ''}:${item?.path || ''}:${item?.value || ''}`),
  ])
    .join('|')
    .toLowerCase();
}

function dedupeSuggestedActionDetails(entries = []) {
  const seen = new Set();
  const result = [];

  safeList(entries).forEach((entry) => {
    const safeEntry = safeObject(entry);
    const identity = suggestedActionIdentity(safeEntry);
    if (!identity || seen.has(identity)) return;
    seen.add(identity);
    result.push(safeEntry);
  });

  return result;
}

function buildSuggestedActionDisplayModel({ semanticQuality = {}, extractedEvidence = {} } = {}) {
  const detailEntries = dedupeSuggestedActionDetails([
    ...safeList(semanticQuality.suggested_action_details),
    ...safeList(extractedEvidence.suggested_action_details),
  ]);
  const rawSuggestedActions = uniqueStrings([
    ...safeList(semanticQuality.suggested_actions),
    ...safeList(extractedEvidence.suggested_actions),
  ]);
  const normalizedEntries = detailEntries.length > 0
    ? detailEntries
    : rawSuggestedActions.map((entry, index) => buildSuggestedActionFallbackEntry(entry, index));
  const groups = SUGGESTED_ACTION_GROUP_DEFINITIONS.map((definition) => {
    const items = normalizedEntries
      .filter((entry) => suggestedActionGroupId(entry) === definition.id)
      .map((entry) => {
        const evidenceSummary = summarizeSuggestedActionEvidence(entry.evidence);
        const targetParts = [
          entry.target_requirement_id ? `Requirement: ${entry.target_requirement_id}` : '',
          entry.target_feature_id ? `Feature: ${entry.target_feature_id}` : '',
        ].filter(Boolean);

        return {
          id: entry.id || '',
          title: entry.title || entry.message || 'Suggested drawing action',
          message: entry.message && entry.message !== entry.title ? entry.message : '',
          recommendedFix: entry.recommended_fix || '',
          impactLabel: formatSuggestedActionImpactLabel(entry.severity),
          impactTone: suggestedActionImpactTone(entry.severity),
          classificationLabel: formatSuggestedActionClassificationLabel(entry.classification),
          classificationTone: suggestedActionClassificationTone(entry.classification),
          targetSummary: targetParts.join(' · '),
          evidenceSourceSummary: evidenceSummary.sourceSummary,
          evidencePathSummary: evidenceSummary.pathSummary,
        };
      });

    return {
      id: definition.id,
      title: definition.title,
      items,
    };
  }).filter((group) => group.items.length > 0);

  return {
    totalCount: normalizedEntries.length,
    advisoryCopy: 'These suggestions are advisory unless an explicit enforceable drawing policy applies.',
    emptyCopy: 'No additional drawing actions were suggested from extracted evidence.',
    groups,
  };
}

function summarizeRequiredEvidenceForDisplay(entries = []) {
  return safeList(entries).map((entry) => {
    const safeEntry = safeObject(entry);
    const candidate = safeList(safeEntry.candidate_matches)[0] || null;
    const sourceLabel = formatEvidenceSourceLabel(safeEntry.source_artifact || candidate?.source_artifact);
    const confidenceLabel = formatConfidenceLabel(
      safeEntry.confidence !== null && safeEntry.confidence !== undefined
        ? safeEntry.confidence
        : candidate?.confidence
    );
    const matchedText = safeEntry.matched_raw_text || safeEntry.matched_extracted_id || '';
    const candidateText = candidate?.matched_raw_text || candidate?.matched_extracted_id || '';
    const classification = normalizeString(safeEntry.classification) || 'unknown';
    let detail = safeEntry.reason || 'No extracted evidence detail was reported.';

    if (classification === 'extracted' && matchedText) {
      detail = `Matched extracted evidence: ${matchedText}`;
    } else if (classification === 'unknown' && candidateText) {
      detail = `Low-confidence candidate: ${candidateText}`;
    } else if (classification === 'missing' && matchedText) {
      detail = `Unconfirmed extracted evidence: ${matchedText}`;
    }

    return {
      label: safeEntry.requirement_label || safeEntry.requirement_id || 'Unnamed requirement',
      classificationLabel: extractedClassificationLabel(classification),
      classificationTone: extractedClassificationTone(classification),
      detail,
      note: joinDisplayParts([
        sourceLabel ? `Source: ${sourceLabel}` : '',
        confidenceLabel,
      ]),
    };
  });
}

function summarizeUnmatchedEvidenceForDisplay(entries = [], fallbackLabel = 'Extracted item') {
  return safeList(entries).map((entry) => {
    const safeEntry = safeObject(entry);
    return {
      label: safeEntry.raw_text || safeEntry.extracted_id || fallbackLabel,
      classificationLabel: 'Advisory',
      classificationTone: 'info',
      detail: safeEntry.reason || 'Extracted evidence did not match a required drawing-intent item.',
      note: joinDisplayParts([
        formatEvidenceSourceLabel(safeEntry.source_artifact)
          ? `Source: ${formatEvidenceSourceLabel(safeEntry.source_artifact)}`
          : '',
        formatConfidenceLabel(safeEntry.confidence),
      ]),
    };
  });
}

function buildExtractedSemanticsSummary(status, extractedEvidence = {}, semanticQuality = {}) {
  const normalizedStatus = normalizeExtractedSemanticsStatus(status);
  const coverage = safeObject(extractedEvidence.coverage);
  const totalRequired = Number(coverage.total_required || 0);
  const totalMissing = Number(coverage.total_missing || 0);
  const totalUnknown = Number(coverage.total_unknown || 0);
  const totalUnsupported = Number(coverage.total_unsupported || 0);
  const explicitEvidencePath = extractedEvidence.file || extractedEvidence.path;
  const hasEvidence = Boolean(explicitEvidencePath)
    || safeList(extractedEvidence.required_dimensions).length > 0
    || safeList(extractedEvidence.required_notes).length > 0
    || safeList(extractedEvidence.required_views).length > 0;

  if (!hasEvidence && normalizedStatus === 'unknown') {
    return 'Extracted drawing semantics evidence is not available for this job.';
  }
  if (normalizedStatus === 'unsupported') {
    return 'Extracted drawing semantics evidence is unsupported for this job.';
  }
  if (normalizedStatus === 'partial') {
    return 'Some drawing requirements could not be confirmed from extracted evidence.';
  }
  if (
    normalizedStatus === 'available'
    && totalRequired > 0
    && totalMissing === 0
    && totalUnknown === 0
    && totalUnsupported === 0
  ) {
    return 'Required drawing semantics were confirmed from extracted evidence.';
  }
  if (semanticQuality.enforceable === true) {
    return 'Extracted drawing semantics are shown here, but required gates still drive readiness unless an explicit enforceable policy applies.';
  }
  return 'Extracted drawing semantics evidence is not available for this job.';
}

function buildExtractedReadinessCopy(reportSummary = {}) {
  const ready = reportSummary.ready_for_manufacturing_review;
  const surfaces = safeObject(reportSummary.surfaces);
  const failedNames = [
    ['Geometry', surfaces.create_quality],
    ['Drawing', surfaces.drawing_quality],
    ['DFM', surfaces.dfm],
  ]
    .filter(([, surface]) => {
      const status = normalizeSurfaceStatus(safeObject(surface).status || 'not_available');
      return status === 'fail' || status === 'missing' || status === 'not_available' || status === 'not_run';
    })
    .map(([label]) => label);

  if (ready === false && failedNames.length > 0) {
    return `Still blocked by required ${failedNames.join(' / ')} gates.`;
  }
  if (ready === true) {
    return 'Manufacturing readiness is still determined by required Geometry / Drawing / DFM gates.';
  }
  return 'Manufacturing readiness is still driven by required quality gates unless an explicit enforceable policy applies.';
}

function extractedEvidenceDisplayKey(evidenceArtifact = null) {
  if (!evidenceArtifact) return 'Not linked';
  if (evidenceArtifact.id === 'extracted_drawing_semantics_json') return 'extracted_drawing_semantics_json';
  return evidenceArtifact.artifactKey || evidenceArtifact.label || 'Not linked';
}

function buildExtractedSemanticsPanel({ artifacts = [], reportSummary = {}, drawingSurface = {}, drawingQuality = {} } = {}) {
  const surface = safeObject(drawingSurface);
  const raw = safeObject(drawingQuality);
  const semanticQuality = {
    ...safeObject(raw.semantic_quality),
    ...safeObject(surface.semantic_quality),
  };
  const extractedEvidence = safeObject(semanticQuality.extracted_evidence);
  const artifactLinks = buildArtifactLinks(artifacts);
  const extractedArtifact = artifactLinks.find((artifact) => artifact.id === 'extracted_drawing_semantics_json') || null;
  const normalizedStatus = normalizeExtractedSemanticsStatus(extractedEvidence.status);
  const coverage = safeObject(extractedEvidence.coverage);
  const evidenceArtifact = extractedArtifact || (
    extractedEvidence.file || extractedEvidence.path
      ? {
          label: 'Extracted drawing semantics JSON',
          fileName: basename(extractedEvidence.file || extractedEvidence.path),
          href: null,
        }
      : null
  );
  const suggestedActions = uniqueStrings([
    ...safeList(semanticQuality.suggested_actions),
    ...safeList(extractedEvidence.suggested_actions),
  ]);
  const suggestedActionDisplay = buildSuggestedActionDisplayModel({ semanticQuality, extractedEvidence });

  return {
    status: normalizedStatus,
    statusLabel: formatExtractedSemanticsStatusLabel(normalizedStatus),
    tone: extractedSemanticsTone(normalizedStatus),
    impactLabel: semanticQuality.enforceable === true ? 'Enforceable' : 'Advisory',
    impactTone: semanticQuality.enforceable === true ? 'warn' : 'info',
    impactCopy: semanticQuality.enforceable === true
      ? 'An explicit enforceable policy can promote extracted-semantics gaps into required blockers.'
      : 'Extracted-semantics gaps are advisory by default.',
    summary: buildExtractedSemanticsSummary(normalizedStatus, extractedEvidence, semanticQuality),
    readinessCopy: buildExtractedReadinessCopy(reportSummary),
    evidenceArtifact,
    coverageItems: [
      {
        label: 'Dimensions',
        value: buildExtractedCoverageValue(coverage.required_dimensions || defaultExtractedCoverageGroup()),
        note: buildExtractedCoverageNote(coverage.required_dimensions || defaultExtractedCoverageGroup()),
      },
      {
        label: 'Notes',
        value: buildExtractedCoverageValue(coverage.required_notes || defaultExtractedCoverageGroup()),
        note: buildExtractedCoverageNote(coverage.required_notes || defaultExtractedCoverageGroup()),
      },
      {
        label: 'Views',
        value: buildExtractedCoverageValue(coverage.required_views || defaultExtractedCoverageGroup()),
        note: buildExtractedCoverageNote(coverage.required_views || defaultExtractedCoverageGroup()),
      },
    ],
    evidenceItem: {
      label: 'Evidence',
      value: extractedEvidenceDisplayKey(evidenceArtifact),
      note: evidenceArtifact?.artifactKey
        ? evidenceArtifact.label || evidenceArtifact.fileName || ''
        : evidenceArtifact?.fileName || '',
    },
    requiredGroups: [
      {
        title: 'Required dimensions',
        empty: 'No required dimensions were provided for extracted-semantics comparison.',
        items: summarizeRequiredEvidenceForDisplay(extractedEvidence.required_dimensions),
      },
      {
        title: 'Required notes',
        empty: 'No required notes were provided for extracted-semantics comparison.',
        items: summarizeRequiredEvidenceForDisplay(extractedEvidence.required_notes),
      },
      {
        title: 'Required views',
        empty: 'No required views were provided for extracted-semantics comparison.',
        items: summarizeRequiredEvidenceForDisplay(extractedEvidence.required_views),
      },
    ],
    unmatchedGroups: [
      {
        title: 'Unmatched extracted dimensions',
        empty: 'No unmatched extracted dimensions were reported.',
        items: summarizeUnmatchedEvidenceForDisplay(extractedEvidence.unmatched_dimensions, 'Extracted dimension'),
      },
      {
        title: 'Unmatched extracted notes',
        empty: 'No unmatched extracted notes were reported.',
        items: summarizeUnmatchedEvidenceForDisplay(extractedEvidence.unmatched_notes, 'Extracted note'),
      },
    ],
    unmatchedSummary: (
      safeList(extractedEvidence.unmatched_dimensions).length > 0
      || safeList(extractedEvidence.unmatched_notes).length > 0
    )
      ? 'Some extracted drawing text could not be matched to required intent.'
      : '',
    suggestedActions,
    suggestedActionCount: suggestedActionDisplay.totalCount,
    suggestedActionAdvisoryCopy: suggestedActionDisplay.advisoryCopy,
    suggestedActionEmptyCopy: suggestedActionDisplay.emptyCopy,
    suggestedActionGroups: suggestedActionDisplay.groups,
    limitations: uniqueStrings(safeList(extractedEvidence.limitations)),
    unknowns: uniqueStrings(safeList(extractedEvidence.unknowns)),
  };
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
    extractedSemantics: buildExtractedSemanticsPanel({
      artifacts,
      reportSummary,
      drawingSurface: surface,
      drawingQuality: raw,
    }),
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
      id: 'extracted_drawing_semantics_json',
      label: 'Extracted drawing semantics JSON',
      required: false,
      match: isExtractedDrawingSemanticsArtifact,
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
        artifactKey: artifact.key || null,
        sourceArtifactId: artifact.id || artifact.key || null,
      };
    })
    .filter(Boolean);
}

function buildReportSummaryModel({
  artifacts = [],
  reportSummary = {},
  createQuality = {},
  drawingQuality = {},
} = {}) {
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
    engineeringQuality: buildEngineeringQualitySummary(createQuality),
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
    engineeringQuality: buildEngineeringQualitySummary(createQuality),
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
    const createQuality = safeObject(selectedArtifacts.createQuality ? artifactPayloads[selectedArtifacts.createQuality.id] : null);
    const drawingQuality = safeObject(selectedArtifacts.drawingQuality ? artifactPayloads[selectedArtifacts.drawingQuality.id] : null);
    return buildReportSummaryModel({ artifacts, reportSummary, createQuality, drawingQuality });
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
