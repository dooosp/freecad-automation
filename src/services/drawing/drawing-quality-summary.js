import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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
  dimensionMapPath = null,
  dimensionMap = null,
  dimConflictsPath = null,
  dimConflicts = null,
  bomPath = null,
  bomEntries = [],
  bomRows = [],
  generatedViews = [],
  svgContent = null,
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
    return {
      schema_version: DRAWING_QUALITY_SCHEMA_VERSION,
      command: 'draw',
      input_config: resolveMaybe(inputConfigPath),
      drawing_svg: null,
      plan_file: resolveMaybe(planPath),
      qa_file: resolveMaybe(qaPath),
      qa_issues_file: resolveMaybe(qaIssuesPath),
      traceability_file: resolveMaybe(traceabilityPath),
      layout_report_file: resolveMaybe(layoutReportPath),
      dimension_map_file: resolveMaybe(dimensionMapPath),
      dim_conflicts_file: resolveMaybe(dimConflictsPath),
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
      thresholds: effectiveThresholds,
      blocking_issues: blockingIssues,
      warnings,
      recommended_actions: recommendedActions,
    };
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

  const highSeverityIssues = asArray(qaIssues?.issues).filter((issue) => (
    issue?.severity === 'high' || issue?.severity === 'critical'
  ));

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
    dimension_map_file: resolveMaybe(dimensionMapPath),
    dim_conflicts_file: resolveMaybe(dimConflictsPath),
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
    thresholds: effectiveThresholds,
    blocking_issues: blockingIssues,
    warnings: uniqueStrings(warnings),
    recommended_actions: uniqueStrings(recommendedActions),
  };

  return summary;
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
