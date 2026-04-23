import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { compareDrawingIntentToExtractedSemantics } from './extracted-drawing-semantics.js';
import { evaluateLayoutReadability, summarizeLayoutReadabilityActions } from './layout-readability.js';
import {
  buildReviewerFeedbackSummary,
  normalizeReviewerFeedbackSummary,
} from './reviewer-feedback.js';

export const DRAWING_QUALITY_SCHEMA_VERSION = '0.1';

export const DEFAULT_DRAWING_QUALITY_THRESHOLDS = Object.freeze({
  required_dimension_coverage_percent: 100,
  max_dimension_conflicts: 0,
  max_view_overlaps: 0,
  min_traceability_coverage_percent: 95,
});

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function toPercent(numerator, denominator) {
  if (!denominator) return 100;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function resolveMaybe(path) {
  return typeof path === 'string' && path.trim() ? resolve(path) : null;
}

function pushIssue(target, code, message, details = undefined) {
  target.push({
    code,
    message,
    ...(details ? { details } : {}),
  });
}

function countBalloonLabels(svgContent = null) {
  if (typeof svgContent !== 'string' || !svgContent.trim()) return null;
  const match = svgContent.match(/<g class="balloons">([\s\S]*?)<\/g>/i);
  if (!match) return 0;
  const labels = match[1].match(/<text\b[\s\S]*?>(\d+)<\/text>/gi);
  return labels ? labels.length : 0;
}

export function parseBomCsv(csvText = '') {
  if (typeof csvText !== 'string' || !csvText.trim()) return [];
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return [];

  const header = lines[0].split(',').map((cell) => cell.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((cell) => cell.trim());
    const row = {};
    header.forEach((key, index) => {
      row[key] = cells[index] ?? '';
    });
    return row;
  });
}

export function resolveDrawingQualityPath(drawingSvgPath) {
  if (!drawingSvgPath) return null;
  return drawingSvgPath.replace(/\.svg$/i, '_quality.json');
}

function isMappedRequiredDimension(entry = {}) {
  return entry.rendered === true || entry.status === 'rendered';
}

function normalizeId(value = null) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeComparable(value = null) {
  return normalizeId(value)?.toLowerCase().replace(/[^a-z0-9]+/g, '') || null;
}

function normalizeRequirementItem(item, defaultRequired = false) {
  if (typeof item === 'string') {
    return {
      id: item,
      label: item,
      required: defaultRequired,
      optional: !defaultRequired,
    };
  }
  if (!item || typeof item !== 'object') return null;
  const id = normalizeId(item.id ?? item.key ?? item.name ?? item.feature ?? item.dim_id ?? item.view);
  const label = normalizeId(item.label ?? item.title ?? item.name ?? item.text ?? id);
  if (!id && !label) return null;
  const optional = item.optional === true || item.required === false;
  const required = item.required === true || item.critical === true || (!optional && defaultRequired);
  return {
    ...item,
    id,
    label: label || id,
    required,
    optional: optional || !required,
  };
}

function normalizeRequirementList(values = [], defaultRequired = false) {
  return asArray(values)
    .map((item) => normalizeRequirementItem(item, defaultRequired))
    .filter(Boolean);
}

function collectFeatureCatalogCriticalFeatures(featureCatalog = null) {
  const catalog = Array.isArray(featureCatalog)
    ? { features: featureCatalog }
    : asObject(featureCatalog);
  const features = asArray(catalog.features ?? catalog.items ?? catalog.feature_catalog);
  return features
    .map((feature) => normalizeRequirementItem(feature, false))
    .filter((feature) => feature?.required === true || feature?.critical === true);
}

function collectDrawingIntentDimensions(drawingIntent = {}) {
  const intentDimensions = normalizeRequirementList(
    drawingIntent.required_dimensions
      ?? drawingIntent.dimensions
      ?? drawingIntent.dimension_requirements,
    true
  );
  const optionalDimensions = normalizeRequirementList(
    drawingIntent.optional_dimensions
      ?? drawingIntent.reference_dimensions,
    false
  );

  return {
    required: uniqueById([
      ...intentDimensions.filter((entry) => entry.required && !entry.optional),
    ]),
    optional: uniqueById([
      ...optionalDimensions,
      ...intentDimensions.filter((entry) => entry.optional),
    ]),
  };
}

function uniqueById(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = normalizeComparable(item?.id ?? item?.label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function collectIntentViews(drawingIntent = {}) {
  const required = normalizeRequirementList(
    drawingIntent.required_views
      ?? drawingIntent.views?.required
      ?? drawingIntent.views,
    true
  );
  const optional = normalizeRequirementList(
    drawingIntent.optional_views
      ?? drawingIntent.views?.optional,
    false
  );
  return {
    required: uniqueById(required),
    optional: uniqueById(optional),
  };
}

function collectIntentNotes(drawingIntent = {}) {
  return {
    required: uniqueById(normalizeRequirementList(
      drawingIntent.required_notes
        ?? drawingIntent.notes?.required
        ?? drawingIntent.notes,
      true
    )),
    optional: uniqueById(normalizeRequirementList(
      drawingIntent.optional_notes
        ?? drawingIntent.notes?.optional,
      false
    )),
  };
}

function collectIntentFeatures(drawingIntent = {}, featureCatalog = null) {
  const required = normalizeRequirementList(
    drawingIntent.critical_features
      ?? drawingIntent.required_features
      ?? drawingIntent.features?.critical
      ?? drawingIntent.features?.required,
    true
  );
  const optional = normalizeRequirementList(
    drawingIntent.optional_features
      ?? drawingIntent.features?.optional,
    false
  );
  return {
    required: uniqueById([...required, ...collectFeatureCatalogCriticalFeatures(featureCatalog)]),
    optional: uniqueById(optional),
  };
}

function extractSvgText(svgContent = null) {
  if (typeof svgContent !== 'string' || !svgContent.trim()) return '';
  return svgContent
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasTextEvidence(requirement = {}, svgText = '') {
  const source = normalizeComparable(svgText);
  if (!source) return false;
  const candidates = uniqueStrings([
    requirement.id,
    requirement.label,
    requirement.text,
    requirement.note,
  ]);
  return candidates.some((candidate) => {
    const normalized = normalizeComparable(candidate);
    return Boolean(normalized && source.includes(normalized));
  });
}

function buildDimensionEvidence(dimensionMap = null, traceability = null) {
  const renderedDimensions = new Map();
  const renderedFeatures = new Set();
  for (const entry of asArray(dimensionMap?.plan_dimensions)) {
    if (!isMappedRequiredDimension(entry)) continue;
    const dimId = normalizeComparable(entry.dim_id ?? entry.id);
    const featureId = normalizeComparable(entry.feature ?? entry.feature_id);
    if (dimId) renderedDimensions.set(dimId, entry);
    if (featureId) renderedFeatures.add(featureId);
  }

  const traceLinks = new Map();
  for (const link of asArray(traceability?.links)) {
    const dimId = normalizeComparable(link?.dim_id ?? link?.dimension_id);
    const featureId = normalizeComparable(link?.feature_id ?? link?.feature);
    if (dimId && featureId) {
      traceLinks.set(dimId, {
        dimension_id: link.dim_id ?? link.dimension_id,
        feature_id: link.feature_id ?? link.feature,
        source: link.source ?? 'traceability',
      });
      renderedFeatures.add(featureId);
    }
  }

  return {
    renderedDimensions,
    renderedFeatures,
    traceLinks,
    hasDimensionEvidence: Boolean(dimensionMap && typeof dimensionMap === 'object'),
    hasTraceabilityEvidence: Boolean(traceability && typeof traceability === 'object'),
  };
}

function itemName(item = {}) {
  return item.label || item.id || 'unnamed requirement';
}

function coverageScore(present, total) {
  if (!total) return null;
  return Number(((present / total) * 100).toFixed(2));
}

function buildSemanticDrawingQualityReport({
  drawingIntent = null,
  featureCatalog = null,
  planner = null,
  dimensionMap = null,
  traceability = null,
  producedViews = [],
  svgContent = null,
  extractedDrawingSemantics = null,
  extractedDrawingSemanticsPath = null,
} = {}) {
  const intent = asObject(drawingIntent);
  const enforceable = intent.enforceable === true || intent.policy === 'enforceable';
  const features = collectIntentFeatures(intent, featureCatalog);
  const dimensions = collectDrawingIntentDimensions(intent);
  const notes = collectIntentNotes(intent);
  const views = collectIntentViews(intent);
  const evidence = buildDimensionEvidence(dimensionMap, traceability);
  const producedViewSet = new Set(producedViews.map(normalizeComparable).filter(Boolean));
  const svgText = extractSvgText(svgContent);

  const coveredFeatures = features.required.filter((feature) => (
    evidence.renderedFeatures.has(normalizeComparable(feature.id))
      || evidence.renderedFeatures.has(normalizeComparable(feature.feature))
      || dimensions.required.some((dimension) => (
        normalizeComparable(dimension.feature) === normalizeComparable(feature.id)
          && evidence.renderedDimensions.has(normalizeComparable(dimension.id))
      ))
  ));
  const presentDimensions = dimensions.required.filter((dimension) => {
    const dimKey = normalizeComparable(dimension.id ?? dimension.dim_id);
    if (dimKey && evidence.renderedDimensions.has(dimKey)) return true;
    const featureKey = normalizeComparable(dimension.feature ?? dimension.feature_id);
    return Boolean(featureKey && evidence.renderedFeatures.has(featureKey));
  });
  const presentNotes = notes.required.filter((note) => hasTextEvidence(note, svgText));
  const presentViews = views.required.filter((view) => producedViewSet.has(normalizeComparable(view.id ?? view.view)));

  const missingCriticalFeatures = features.required.filter((feature) => !coveredFeatures.includes(feature)).map(itemName);
  const missingRequiredDimensions = dimensions.required.filter((dimension) => !presentDimensions.includes(dimension)).map(itemName);
  const missingRequiredNotes = notes.required.filter((note) => !presentNotes.includes(note)).map(itemName);
  const missingRequiredViews = views.required.filter((view) => !presentViews.includes(view)).map(itemName);

  const optionalMissing = [
    ...features.optional.filter((feature) => !evidence.renderedFeatures.has(normalizeComparable(feature.id))).map((feature) => `Optional feature not evidenced: ${itemName(feature)}.`),
    ...dimensions.optional.filter((dimension) => !evidence.renderedDimensions.has(normalizeComparable(dimension.id))).map((dimension) => `Optional dimension not evidenced: ${itemName(dimension)}.`),
    ...notes.optional.filter((note) => !hasTextEvidence(note, svgText)).map((note) => `Optional note not evidenced: ${itemName(note)}.`),
    ...views.optional.filter((view) => !producedViewSet.has(normalizeComparable(view.id ?? view.view))).map((view) => `Optional view not evidenced: ${itemName(view)}.`),
  ];

  const traceabilityRows = dimensions.required.map((dimension) => {
    const dimKey = normalizeComparable(dimension.id ?? dimension.dim_id);
    const link = dimKey ? evidence.traceLinks.get(dimKey) : null;
    return {
      dimension_id: dimension.id ?? dimension.dim_id ?? itemName(dimension),
      feature_id: link?.feature_id ?? dimension.feature ?? null,
      status: link ? 'linked' : evidence.hasTraceabilityEvidence ? 'missing' : 'unknown',
      evidence: link || null,
    };
  });
  const traceLinked = traceabilityRows.filter((row) => row.status === 'linked').length;
  const traceMissing = traceabilityRows.filter((row) => row.status === 'missing').map((row) => row.dimension_id);
  const traceUnknown = traceabilityRows.filter((row) => row.status === 'unknown').map((row) => row.dimension_id);

  const missingCriticalInformation = uniqueStrings([
    ...missingCriticalFeatures.map((name) => `Critical feature is not evidenced on the drawing: ${name}.`),
    ...missingRequiredDimensions.map((name) => `Required dimension is not evidenced on the drawing: ${name}.`),
    ...missingRequiredNotes.map((name) => `Required note is not evidenced on the drawing: ${name}.`),
    ...missingRequiredViews.map((name) => `Required view is not present in generated drawing evidence: ${name}.`),
    ...traceMissing.map((name) => `Required dimension lacks traceability evidence: ${name}.`),
    ...traceUnknown.map((name) => `Required dimension traceability is unknown because traceability evidence is unavailable: ${name}.`),
  ]);

  const requiredMissingCount = missingCriticalFeatures.length
    + missingRequiredDimensions.length
    + missingRequiredNotes.length
    + missingRequiredViews.length
    + traceMissing.length
    + traceUnknown.length;
  const requiredBlockers = enforceable ? missingCriticalInformation : [];
  const metricScores = [
    coverageScore(coveredFeatures.length, features.required.length),
    coverageScore(presentDimensions.length, dimensions.required.length),
    coverageScore(presentNotes.length, notes.required.length),
    coverageScore(presentViews.length, views.required.length),
    coverageScore(traceLinked, traceabilityRows.length),
  ].filter((score) => score !== null);
  const score = metricScores.length
    ? Number((metricScores.reduce((sum, value) => sum + value, 0) / metricScores.length).toFixed(2))
    : null;
  const extractedEvidence = compareDrawingIntentToExtractedSemantics(
    drawingIntent,
    extractedDrawingSemantics,
    featureCatalog,
    planner,
    extractedDrawingSemanticsPath
  );
  const extractedCoverageComplete = Number(extractedEvidence.coverage?.total_required || 0) > 0
    && Number(extractedEvidence.coverage?.total_missing || 0) === 0
    && Number(extractedEvidence.coverage?.total_unknown || 0) === 0
    && Number(extractedEvidence.coverage?.total_unsupported || 0) === 0;
  const extractedActionCategories = new Set(
    asArray(extractedEvidence.suggested_action_details)
      .map((entry) => entry?.category)
      .filter((value) => typeof value === 'string' && value.trim())
  );
  const effectiveCoveredFeatures = extractedCoverageComplete ? features.required : coveredFeatures;
  const effectiveMissingCriticalFeatures = extractedCoverageComplete ? [] : missingCriticalFeatures;
  const effectiveMissingCriticalInformation = uniqueStrings([
    ...effectiveMissingCriticalFeatures.map((name) => `Critical feature is not evidenced on the drawing: ${name}.`),
    ...missingRequiredDimensions.map((name) => `Required dimension is not evidenced on the drawing: ${name}.`),
    ...missingRequiredNotes.map((name) => `Required note is not evidenced on the drawing: ${name}.`),
    ...missingRequiredViews.map((name) => `Required view is not present in generated drawing evidence: ${name}.`),
    ...traceMissing.map((name) => `Required dimension lacks traceability evidence: ${name}.`),
    ...traceUnknown.map((name) => `Required dimension traceability is unknown because traceability evidence is unavailable: ${name}.`),
  ]);
  const effectiveRequiredMissingCount = effectiveMissingCriticalFeatures.length
    + missingRequiredDimensions.length
    + missingRequiredNotes.length
    + missingRequiredViews.length
    + traceMissing.length
    + traceUnknown.length;
  const effectiveRequiredBlockers = enforceable ? effectiveMissingCriticalInformation : [];
  const effectiveMetricScores = [
    coverageScore(effectiveCoveredFeatures.length, features.required.length),
    coverageScore(presentDimensions.length, dimensions.required.length),
    coverageScore(presentNotes.length, notes.required.length),
    coverageScore(presentViews.length, views.required.length),
    coverageScore(traceLinked, traceabilityRows.length),
  ].filter((score) => score !== null);
  const effectiveScore = effectiveMetricScores.length
    ? Number((effectiveMetricScores.reduce((sum, value) => sum + value, 0) / effectiveMetricScores.length).toFixed(2))
    : null;
  const suggestedActions = uniqueStrings([
    effectiveMissingCriticalFeatures.length ? `Add drawing evidence for critical feature(s): ${effectiveMissingCriticalFeatures.join(', ')}.` : null,
    missingRequiredDimensions.length && !extractedActionCategories.has('dimension')
      ? `Add or map required dimension(s): ${missingRequiredDimensions.join(', ')}.`
      : null,
    missingRequiredNotes.length && !extractedActionCategories.has('note')
      ? `Add required drawing note(s): ${missingRequiredNotes.join(', ')}.`
      : null,
    missingRequiredViews.length && !extractedActionCategories.has('view')
      ? `Generate required view(s): ${missingRequiredViews.join(', ')}.`
      : null,
    (traceMissing.length || traceUnknown.length) ? 'Attach or regenerate traceability evidence for required dimensions.' : null,
  ]);
  const advisoryDecision = effectiveRequiredMissingCount > 0
    ? 'needs_attention'
    : effectiveMetricScores.length > 0
      ? 'pass'
      : 'unknown';
  const semanticSuggestedActions = uniqueStrings([
    ...suggestedActions,
    ...asArray(extractedEvidence.suggested_actions),
  ]);
  const semanticSuggestedActionDetails = asArray(extractedEvidence.suggested_action_details)
    .filter((entry) => entry && typeof entry === 'object');

  return {
    decision: enforceable && effectiveRequiredBlockers.length > 0
      ? 'fail'
      : advisoryDecision === 'pass'
        ? 'pass'
        : advisoryDecision === 'unknown'
          ? 'unknown'
          : 'advisory',
    advisory_decision: advisoryDecision,
    enforceable,
    score: effectiveScore,
    score_basis: {
      critical_feature_coverage_percent: coverageScore(effectiveCoveredFeatures.length, features.required.length),
      required_dimension_coverage_percent: coverageScore(presentDimensions.length, dimensions.required.length),
      required_note_coverage_percent: coverageScore(presentNotes.length, notes.required.length),
      required_view_coverage_percent: coverageScore(presentViews.length, views.required.length),
      dimension_traceability_percent: coverageScore(traceLinked, traceabilityRows.length),
    },
    critical_features_total: features.required.length,
    critical_features_covered: effectiveCoveredFeatures.length,
    missing_critical_features: effectiveMissingCriticalFeatures,
    required_dimensions_total: dimensions.required.length,
    required_dimensions_present: presentDimensions.length,
    missing_required_dimensions: missingRequiredDimensions,
    required_notes_total: notes.required.length,
    required_notes_present: presentNotes.length,
    required_notes_missing: missingRequiredNotes,
    required_views_total: views.required.length,
    required_views_present: presentViews.length,
    required_views_missing: missingRequiredViews,
    traceability: {
      required_dimensions_total: traceabilityRows.length,
      linked_required_dimensions: traceLinked,
      missing_required_dimensions: traceMissing,
      unknown_required_dimensions: traceUnknown,
      rows: traceabilityRows,
    },
    missing_critical_information: effectiveMissingCriticalInformation,
    required_blockers: effectiveRequiredBlockers,
    optional_missing_information: uniqueStrings(optionalMissing),
    suggested_actions: semanticSuggestedActions,
    suggested_action_details: semanticSuggestedActionDetails,
    extracted_evidence: extractedEvidence,
  };
}

function inferDuplicateCount(dimensionMap = {}, dimConflicts = {}) {
  const fromSummary = Number(dimensionMap?.summary?.skipped_duplicate_count);
  if (Number.isFinite(fromSummary)) return fromSummary;

  const skipped = asArray(dimensionMap?.plan_dimensions).filter((entry) => entry?.status === 'skipped_duplicate').length;
  const dedupeConflicts = asArray(dimConflicts?.conflicts).filter((entry) => (
    entry?.category === 'dedupe'
      || entry?.reason === 'cross_view_redundant'
      || entry?.reason === 'plan_dim_skipped_due_to_auto_match'
  )).length;
  return Math.max(skipped, dedupeConflicts);
}

function collectTraceabilityGaps(requiredDimensions = [], traceability = null) {
  const requiredIds = uniqueStrings(requiredDimensions.map((entry) => entry?.dim_id));
  if (requiredIds.length === 0) {
    return [];
  }
  if (!traceability || typeof traceability !== 'object') {
    return requiredIds;
  }

  const unresolved = new Set(uniqueStrings(traceability?.summary?.unresolved_dimensions || []));
  for (const link of asArray(traceability?.links)) {
    const dimId = typeof link?.dim_id === 'string' ? link.dim_id : null;
    if (!dimId) continue;
    if (!link?.feature_id) unresolved.add(dimId);
  }

  return requiredIds.filter((id) => unresolved.has(id));
}

export function applyReviewerFeedbackToDrawingQualitySummary(summary, reviewerFeedbackSummary = null) {
  const normalizedReviewerFeedback = normalizeReviewerFeedbackSummary(reviewerFeedbackSummary);
  return {
    ...summary,
    reviewer_feedback: normalizedReviewerFeedback,
    recommended_actions: uniqueStrings([
      ...asArray(summary?.recommended_actions),
      ...asArray(normalizedReviewerFeedback.suggested_actions),
    ]),
    suggested_actions: uniqueStrings([
      ...asArray(summary?.suggested_actions),
      ...asArray(normalizedReviewerFeedback.suggested_actions),
    ]),
  };
}

export function buildDrawingQualitySummary({
  inputConfigPath = null,
  drawingSvgPath = null,
  planPath = null,
  plan = null,
  qaPath = null,
  qaReport = null,
  qaIssuesPath = null,
  qaIssues = null,
  traceabilityPath = null,
  traceability = null,
  layoutReportPath = null,
  layoutReport = null,
  plannerPath = null,
  planner = null,
  dimensionMapPath = null,
  dimensionMap = null,
  dimConflictsPath = null,
  dimConflicts = null,
  drawingIntent = null,
  featureCatalog = null,
  bomPath = null,
  bomEntries = [],
  bomRows = [],
  generatedViews = [],
  svgContent = null,
  extractedDrawingSemanticsPath = null,
  extractedDrawingSemantics = null,
  reviewerFeedbackPath = null,
  reviewerFeedback = null,
  reviewerFeedbackInputStatus = null,
  reviewerFeedbackInputErrors = [],
  reviewerFeedbackSummary = null,
  thresholds = DEFAULT_DRAWING_QUALITY_THRESHOLDS,
} = {}) {
  const effectiveThresholds = {
    ...DEFAULT_DRAWING_QUALITY_THRESHOLDS,
    ...(thresholds || {}),
  };

  const warnings = [];
  const blockingIssues = [];
  const recommendedActions = [];

  if (!drawingSvgPath) {
    warnings.push('Drawing SVG artifact is missing; drawing quality evaluation was skipped.');
    const semanticQuality = buildSemanticDrawingQualityReport({
      drawingIntent,
      featureCatalog,
      extractedDrawingSemantics,
      extractedDrawingSemanticsPath,
    });
    const layoutReadability = evaluateLayoutReadability({
      drawingSvgPath,
      svgContent,
      qaPath,
      qaReport,
      layoutReportPath,
      layoutReport,
    });
    const computedReviewerFeedback = reviewerFeedbackSummary || buildReviewerFeedbackSummary({
      reviewerFeedback,
      reviewerFeedbackPath,
      inputStatus: reviewerFeedbackInputStatus,
      inputErrors: reviewerFeedbackInputErrors,
      semanticQuality,
      extractedDrawingSemantics,
      layoutReadability,
      planner,
      artifactPaths: {
        drawing_svg: drawingSvgPath,
        plan_file: planPath,
        qa_file: qaPath,
        qa_issues_file: qaIssuesPath,
        traceability_file: traceabilityPath,
        layout_report_file: layoutReportPath,
        planner_file: plannerPath,
        dimension_map_file: dimensionMapPath,
        dim_conflicts_file: dimConflictsPath,
        extracted_drawing_semantics_file: extractedDrawingSemanticsPath,
        bom_file: bomPath,
      },
    });
    const summary = {
      schema_version: DRAWING_QUALITY_SCHEMA_VERSION,
      command: 'draw',
      input_config: resolveMaybe(inputConfigPath),
      drawing_svg: null,
      plan_file: resolveMaybe(planPath),
      qa_file: resolveMaybe(qaPath),
      qa_issues_file: resolveMaybe(qaIssuesPath),
      traceability_file: resolveMaybe(traceabilityPath),
      layout_report_file: resolveMaybe(layoutReportPath),
      planner_file: resolveMaybe(plannerPath),
      dimension_map_file: resolveMaybe(dimensionMapPath),
      dim_conflicts_file: resolveMaybe(dimConflictsPath),
      extracted_drawing_semantics_file: resolveMaybe(extractedDrawingSemanticsPath),
      bom_file: resolveMaybe(bomPath),
      score: qaReport?.score ?? null,
      status: 'skipped',
      views: {
        required_count: 0,
        generated_count: 0,
        missing_views: [],
        overlap_count: 0,
      },
      dimensions: {
        required_count: 0,
        mapped_count: 0,
        coverage_percent: 0,
        missing_required_intents: [],
        conflict_count: 0,
        duplicate_count: 0,
      },
      bom: {
        expected_items: 0,
        actual_items: 0,
        missing_material_count: 0,
        balloon_mismatches: 0,
      },
      traceability: {
        coverage_percent: 0,
        unmapped_required_entities: [],
      },
      semantic_quality: semanticQuality,
      layout_readability: layoutReadability,
      thresholds: effectiveThresholds,
      blocking_issues: blockingIssues,
      warnings,
      recommended_actions: uniqueStrings([
        ...recommendedActions,
        ...summarizeLayoutReadabilityActions(layoutReadability),
      ]),
      suggested_actions: uniqueStrings([
        ...recommendedActions,
        ...summarizeLayoutReadabilityActions(layoutReadability),
      ]),
      drawing_planner: planner || null,
    };
    return applyReviewerFeedbackToDrawingQualitySummary(summary, computedReviewerFeedback);
  }

  if (!qaReport) {
    pushIssue(blockingIssues, 'missing-qa-report', 'Drawing QA report artifact is missing.');
  }
  if (!layoutReport) {
    pushIssue(blockingIssues, 'missing-layout-report', 'Layout report artifact is missing.');
  }
  if (!dimensionMap) {
    pushIssue(blockingIssues, 'missing-dimension-map', 'Dimension map artifact is missing.');
  }
  if (!dimConflicts) {
    pushIssue(blockingIssues, 'missing-dimension-conflicts', 'Dimension conflict artifact is missing.');
  }
  if (!traceability) {
    pushIssue(blockingIssues, 'missing-traceability', 'Traceability artifact is missing.');
  }
  if (!qaIssues) {
    warnings.push('Drawing qa issues artifact is missing; critical issue escalation may be incomplete.');
  }

  const rawRequiredViews = Array.isArray(plan?.views?.enabled) && plan.views.enabled.length > 0
    ? plan.views.enabled
    : asArray(generatedViews).length > 0
      ? generatedViews
      : Object.keys(layoutReport?.views || {});
  const requiredViews = uniqueStrings(rawRequiredViews.filter((view) => view !== 'notes'));
  const producedViews = uniqueStrings(generatedViews.length > 0 ? generatedViews : Object.keys(layoutReport?.views || {}));
  const missingViews = requiredViews.filter((view) => !producedViews.includes(view));
  const overlapViews = uniqueStrings(layoutReport?.summary?.overflow_views || []);
  const overlapCount = overlapViews.length > 0
    ? overlapViews.length
    : Number.isFinite(Number(qaReport?.metrics?.overflow_count))
      ? Number(qaReport.metrics.overflow_count)
      : 0;

  const planDimensions = asArray(dimensionMap?.plan_dimensions);
  const requiredDimensions = planDimensions.filter((entry) => entry?.required === true);
  const mappedRequiredDimensions = requiredDimensions.filter(isMappedRequiredDimension);
  const missingRequiredIntents = uniqueStrings(
    requiredDimensions
      .filter((entry) => !isMappedRequiredDimension(entry))
      .map((entry) => entry?.dim_id)
  );
  const conflictCount = Number(dimConflicts?.summary?.count);
  const normalizedConflictCount = Number.isFinite(conflictCount)
    ? conflictCount
    : asArray(dimConflicts?.conflicts).length;
  const duplicateCount = inferDuplicateCount(dimensionMap, dimConflicts);

  const expectedItems = asArray(bomEntries).length;
  const actualItems = asArray(bomRows).length;
  const bomGenerated = Boolean(bomPath || expectedItems > 0 || actualItems > 0);
  const missingMaterialCount = Math.max(
    asArray(bomEntries).filter((entry) => !entry?.material).length,
    asArray(bomRows).filter((row) => !row?.material).length
  );
  const balloonCount = countBalloonLabels(svgContent);
  const balloonMismatches = bomGenerated && Number.isInteger(balloonCount)
    ? Math.abs(balloonCount - actualItems)
    : 0;

  const traceabilityGaps = collectTraceabilityGaps(requiredDimensions, traceability);
  const dimensionCoveragePercent = toPercent(mappedRequiredDimensions.length, requiredDimensions.length);
  const traceabilityCoveragePercent = toPercent(
    requiredDimensions.length - traceabilityGaps.length,
    requiredDimensions.length
  );
  const semanticQuality = buildSemanticDrawingQualityReport({
    drawingIntent,
    featureCatalog,
    planner,
    dimensionMap,
    traceability,
    producedViews,
    svgContent,
    extractedDrawingSemantics,
    extractedDrawingSemanticsPath,
  });
  const layoutReadability = evaluateLayoutReadability({
    drawingSvgPath,
    svgContent,
    qaPath,
    qaReport,
    layoutReportPath,
    layoutReport,
  });
  const layoutReadabilityActions = summarizeLayoutReadabilityActions(layoutReadability);
  const computedReviewerFeedback = reviewerFeedbackSummary || buildReviewerFeedbackSummary({
    reviewerFeedback,
    reviewerFeedbackPath,
    inputStatus: reviewerFeedbackInputStatus,
    inputErrors: reviewerFeedbackInputErrors,
    semanticQuality,
    extractedDrawingSemantics,
    layoutReadability,
    planner,
    artifactPaths: {
      drawing_svg: drawingSvgPath,
      plan_file: planPath,
      qa_file: qaPath,
      qa_issues_file: qaIssuesPath,
      traceability_file: traceabilityPath,
      layout_report_file: layoutReportPath,
      planner_file: plannerPath,
      dimension_map_file: dimensionMapPath,
      dim_conflicts_file: dimConflictsPath,
      extracted_drawing_semantics_file: extractedDrawingSemanticsPath,
      bom_file: bomPath,
    },
  });

  const highSeverityIssues = asArray(qaIssues?.issues).filter((issue) => (
    issue?.severity === 'high' || issue?.severity === 'critical'
  ));
  const plannerSuggestedActions = uniqueStrings(planner?.suggested_actions || []);

  if (missingViews.length > 0) {
    pushIssue(
      blockingIssues,
      'missing-views',
      `Required drawing views are missing: ${missingViews.join(', ')}.`,
      { missing_views: missingViews }
    );
  }
  if (overlapCount > effectiveThresholds.max_view_overlaps) {
    pushIssue(
      blockingIssues,
      'view-overlaps',
      `View/layout overlap count ${overlapCount} exceeds the allowed maximum ${effectiveThresholds.max_view_overlaps}.`,
      { overlap_count: overlapCount }
    );
    recommendedActions.push('Reduce view/layout overlaps by moving views or adjusting scale/layout.');
  }
  if (dimensionCoveragePercent < effectiveThresholds.required_dimension_coverage_percent) {
    pushIssue(
      blockingIssues,
      'required-dimension-coverage',
      `Required dimension coverage is ${dimensionCoveragePercent}% and must be ${effectiveThresholds.required_dimension_coverage_percent}%.`,
      { missing_required_intents: missingRequiredIntents }
    );
    if (missingRequiredIntents.length > 0) {
      recommendedActions.push(`Add or map the missing required dimension intent(s): ${missingRequiredIntents.join(', ')}.`);
    }
  }
  if (normalizedConflictCount > effectiveThresholds.max_dimension_conflicts) {
    pushIssue(
      blockingIssues,
      'dimension-conflicts',
      `Dimension conflict count ${normalizedConflictCount} exceeds the allowed maximum ${effectiveThresholds.max_dimension_conflicts}.`,
      { conflict_count: normalizedConflictCount }
    );
    recommendedActions.push('Resolve dimension conflicts by moving view/dimension or adjusting layout.');
  }
  if (bomGenerated && (
    expectedItems !== actualItems
    || missingMaterialCount > 0
    || balloonMismatches > 0
  )) {
    pushIssue(
      blockingIssues,
      'bom-mismatch',
      'BOM consistency checks failed for the generated drawing package.',
      {
        expected_items: expectedItems,
        actual_items: actualItems,
        missing_material_count: missingMaterialCount,
        balloon_mismatches: balloonMismatches,
      }
    );
    recommendedActions.push('Check part ids, quantities, balloons, and BOM material fields.');
  }
  if (traceabilityCoveragePercent < effectiveThresholds.min_traceability_coverage_percent) {
    pushIssue(
      blockingIssues,
      'traceability-coverage',
      `Traceability coverage is ${traceabilityCoveragePercent}% and must be at least ${effectiveThresholds.min_traceability_coverage_percent}%.`,
      { unmapped_required_entities: traceabilityGaps }
    );
    if (traceabilityGaps.length > 0) {
      recommendedActions.push(`Close traceability gaps by mapping entity ids back to drawing_plan for: ${traceabilityGaps.join(', ')}.`);
    }
  }
  if (highSeverityIssues.length > 0) {
    pushIssue(
      blockingIssues,
      'critical-qa-issue',
      `Critical QA issue count ${highSeverityIssues.length} forces a failed drawing-quality gate.`,
      { issue_ids: highSeverityIssues.map((issue) => issue?.id).filter(Boolean) }
    );
  }
  if (semanticQuality.enforceable && semanticQuality.required_blockers.length > 0) {
    pushIssue(
      blockingIssues,
      'semantic-drawing-intent-coverage',
      'Enforceable drawing intent has missing required semantic evidence.',
      { missing_critical_information: semanticQuality.missing_critical_information }
    );
  }
  const summary = {
    schema_version: DRAWING_QUALITY_SCHEMA_VERSION,
    command: 'draw',
    input_config: resolveMaybe(inputConfigPath),
    drawing_svg: resolveMaybe(drawingSvgPath),
    plan_file: resolveMaybe(planPath),
    qa_file: resolveMaybe(qaPath),
    qa_issues_file: resolveMaybe(qaIssuesPath),
    traceability_file: resolveMaybe(traceabilityPath),
    layout_report_file: resolveMaybe(layoutReportPath),
    planner_file: resolveMaybe(plannerPath),
    dimension_map_file: resolveMaybe(dimensionMapPath),
    dim_conflicts_file: resolveMaybe(dimConflictsPath),
    extracted_drawing_semantics_file: resolveMaybe(extractedDrawingSemanticsPath),
    bom_file: resolveMaybe(bomPath),
    score: qaReport?.score ?? null,
    status: blockingIssues.length > 0 ? 'fail' : warnings.length > 0 ? 'warning' : 'pass',
    views: {
      required_count: requiredViews.length,
      generated_count: producedViews.length,
      missing_views: missingViews,
      overlap_count: overlapCount,
    },
    dimensions: {
      required_count: requiredDimensions.length,
      mapped_count: mappedRequiredDimensions.length,
      coverage_percent: dimensionCoveragePercent,
      missing_required_intents: missingRequiredIntents,
      conflict_count: normalizedConflictCount,
      duplicate_count: duplicateCount,
    },
    bom: {
      expected_items: expectedItems,
      actual_items: actualItems,
      missing_material_count: missingMaterialCount,
      balloon_mismatches: balloonMismatches,
    },
    traceability: {
      coverage_percent: traceabilityCoveragePercent,
      unmapped_required_entities: traceabilityGaps,
    },
    semantic_quality: semanticQuality,
    layout_readability: layoutReadability,
    thresholds: effectiveThresholds,
    blocking_issues: blockingIssues,
    warnings: uniqueStrings(warnings),
    recommended_actions: uniqueStrings([
      ...recommendedActions,
      ...layoutReadabilityActions,
      ...plannerSuggestedActions,
      ...semanticQuality.suggested_actions,
    ]),
    suggested_actions: uniqueStrings([
      ...recommendedActions,
      ...layoutReadabilityActions,
      ...plannerSuggestedActions,
      ...semanticQuality.suggested_actions,
    ]),
    drawing_planner: planner || null,
  };

  return applyReviewerFeedbackToDrawingQualitySummary(summary, computedReviewerFeedback);
}

export function shouldFailDrawingQualityGate(summary, { strictQuality = false } = {}) {
  return Boolean(strictQuality && summary?.status === 'fail');
}

export async function writeDrawingQualitySummary(summaryPath, summary) {
  const resolvedPath = resolve(summaryPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return resolvedPath;
}
