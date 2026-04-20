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

function toStatusTone(status = '') {
  const normalized = normalizeString(status);
  if (normalized === 'pass' || normalized === 'ready') return 'ok';
  if (normalized === 'warning' || normalized === 'available') return 'warn';
  if (normalized === 'fail') return 'bad';
  return 'info';
}

function normalizeSurfaceStatus(status = '') {
  const normalized = normalizeString(status);
  if (['pass', 'warning', 'fail', 'available'].includes(normalized)) return normalized;
  if (normalized === 'ready') return 'pass';
  if (normalized === 'not_run' || normalized === 'not_available' || normalized === 'missing') return 'not_available';
  return normalized || 'not_available';
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

function buildArtifactLinks(artifacts = []) {
  const linkDefinitions = [
    {
      id: 'report_summary_json',
      label: 'Report summary JSON',
      match: isReportSummaryArtifact,
    },
    {
      id: 'manifest_json',
      label: 'Manifest JSON',
      match: isManifestArtifact,
    },
    {
      id: 'create_quality_json',
      label: 'Create quality JSON',
      match: isCreateQualityArtifact,
    },
    {
      id: 'drawing_quality_json',
      label: 'Drawing quality JSON',
      match: isDrawingQualityArtifact,
    },
    {
      id: 'report_pdf',
      label: 'PDF report',
      match: buildArtifactMatcher(['report.pdf', '_report.pdf']),
    },
    {
      id: 'drawing_svg',
      label: 'SVG drawing',
      match: buildArtifactMatcher(['drawing.svg', '_drawing.svg', '.svg']),
    },
    {
      id: 'model_step',
      label: 'STEP',
      match: buildArtifactMatcher(['model.step', '.step', '.stp']),
    },
    {
      id: 'model_stl',
      label: 'STL',
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
        fileName: artifact.file_name || artifact.key || artifact.id || definition.label,
        href: artifact.links?.open || null,
        downloadHref: artifact.links?.download || null,
        artifactId: artifact.id || null,
      };
    })
    .filter(Boolean);
}

function buildReportSummaryModel({ artifacts = [], reportSummary = {} } = {}) {
  const surfaces = safeObject(reportSummary.surfaces);
  const createSurface = safeObject(surfaces.create_quality);
  const drawingSurface = safeObject(surfaces.drawing_quality);
  const dfmSurface = safeObject(surfaces.dfm);
  const reportArtifactPresent = buildArtifactLinks(artifacts).some((entry) => entry.id === 'report_pdf');

  return {
    source: 'report_summary',
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
    ]).slice(0, 5),
    recommendedActions: uniqueStrings(safeList(reportSummary.recommended_actions)).slice(0, 5),
    artifactLinks: buildArtifactLinks(artifacts),
  };
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

  return {
    source: 'quality_artifact_fallback',
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
    ]).slice(0, 5),
    recommendedActions: uniqueStrings([
      createSurface.invalidShape ? 'Repair the generated model geometry before proceeding.' : null,
      ...drawingSurface.recommendedActions,
      'Run report generation with DFM attached to restore the decision summary.',
    ]).slice(0, 5),
    artifactLinks: buildArtifactLinks(artifacts),
  };
}

export function buildQualityDashboardModel({
  artifacts = [],
  artifactPayloads = {},
} = {}) {
  const selectedArtifacts = collectQualityDashboardArtifacts(artifacts);
  const reportSummary = safeObject(selectedArtifacts.reportSummary ? artifactPayloads[selectedArtifacts.reportSummary.id] : null);
  if (Object.keys(reportSummary).length > 0 && reportSummary.overall_status) {
    return buildReportSummaryModel({ artifacts, reportSummary });
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
