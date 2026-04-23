import { resolve } from 'node:path';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function cleanText(value, fallback = null) {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim();
    return text || fallback;
  }
  return fallback;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function resolveMaybe(path) {
  return typeof path === 'string' && path.trim() ? resolve(path) : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundNumber(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function extractSvgAttributes(attributeText = '') {
  const attrs = {};
  const pattern = /([:\w-]+)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = pattern.exec(attributeText)) !== null) {
    attrs[match[1]] = match[2] || '';
  }
  return attrs;
}

function collectSvgViewMetadata(svgContent = null, drawingSvgPath = null) {
  if (typeof svgContent !== 'string' || !svgContent.trim()) return [];
  const views = [];
  const pattern = /<g\b([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(svgContent)) !== null) {
    const attrs = extractSvgAttributes(match[1] || '');
    const className = cleanText(attrs.class, '') || '';
    if (!/\bdrawing-view\b/.test(className)) continue;
    const id = cleanText(attrs['data-view-id'] ?? attrs.id?.replace(/^drawing-view-/, ''));
    if (!id) continue;
    views.push({
      id,
      label: cleanText(attrs['data-view-label'], id),
      view_kind: cleanText(attrs['data-view-kind']),
      identity: cleanText(attrs['data-view-identity']),
      source_view: cleanText(attrs['data-source-view']),
      region_ref: cleanText(attrs['data-region-ref']),
      provenance: {
        artifact_type: 'svg',
        path: resolveMaybe(drawingSvgPath),
        method: 'svg_view_group_metadata',
        svg_group_id: cleanText(attrs.id),
        svg_region_ref: cleanText(attrs['data-region-ref']),
      },
    });
  }
  return views;
}

function viewMetadataMap(layoutReport = {}, svgViews = []) {
  const map = new Map();
  const layoutViews = asObject(layoutReport.views);
  for (const [viewId, raw] of Object.entries(layoutViews)) {
    map.set(viewId, {
      id: viewId,
      label: cleanText(raw?.label, viewId),
      region_ref: cleanText(raw?.region_ref ?? raw?.view_group_id ?? raw?.group_id),
    });
  }
  for (const view of svgViews) {
    if (!map.has(view.id)) {
      map.set(view.id, {
        id: view.id,
        label: view.label || view.id,
        region_ref: view.region_ref,
      });
    }
  }
  return map;
}

function createSource(artifactType, path, method, extra = {}) {
  return {
    artifact_type: artifactType,
    path: resolveMaybe(path),
    method,
    ...extra,
  };
}

function buildFinding({
  type,
  severity = 'warning',
  message,
  recommendation,
  viewIds = [],
  elementIds = [],
  labels = [],
  boundingBoxes = [],
  rawSource = {},
}) {
  return {
    type,
    severity,
    message,
    recommendation,
    view_ids: uniqueStrings(viewIds),
    element_ids: uniqueStrings(elementIds),
    labels: uniqueStrings(labels),
    bounding_boxes: asArray(boundingBoxes)
      .filter((bbox) => bbox && typeof bbox === 'object')
      .map((bbox) => ({ ...bbox })),
    raw_source: rawSource,
  };
}

export function summarizeLayoutReadabilityActions(layoutReadability = null) {
  const block = layoutReadability && typeof layoutReadability === 'object' ? layoutReadability : {};
  return uniqueStrings([
    ...asArray(block.recommended_actions),
    ...asArray(block.findings)
      .map((finding) => cleanText(finding?.recommendation))
      .filter(Boolean),
  ]);
}

export function evaluateLayoutReadability({
  drawingSvgPath = null,
  svgContent = null,
  qaPath = null,
  qaReport = null,
  layoutReportPath = null,
  layoutReport = null,
} = {}) {
  const safeQa = asObject(qaReport);
  const safeLayout = asObject(layoutReport);
  const layoutViews = asObject(safeLayout.views);
  const layoutSummary = asObject(safeLayout.summary);
  const qaMetrics = asObject(safeQa.metrics);
  const qaDetails = asObject(safeQa.details);
  const svgViews = collectSvgViewMetadata(svgContent, drawingSvgPath);
  const metadataByView = viewMetadataMap(safeLayout, svgViews);

  const hasLayoutViewData = Object.keys(layoutViews).length > 0;
  const hasOverflowEvidence = Array.isArray(layoutSummary.overflow_views)
    || Number.isFinite(Number(qaMetrics.overflow_count))
    || Array.isArray(qaDetails.overflows);
  const hasTextOverlapEvidence = Array.isArray(qaDetails.text_overlaps)
    || Number.isFinite(Number(qaMetrics.text_overlap_pairs));
  const hasDimensionOverlapEvidence = Number.isFinite(Number(qaMetrics.dim_overlap_pairs));
  const hasNotesOverflowEvidence = typeof qaMetrics.notes_overflow === 'boolean';
  const hasSvgViewMetadata = svgViews.length > 0;

  const sources = uniqueSources([
    hasLayoutViewData || Object.keys(layoutSummary).length > 0
      ? createSource('layout_report', layoutReportPath, 'layout_report_views', {
          view_count: Object.keys(layoutViews).length,
        })
      : null,
    Object.keys(qaMetrics).length > 0 || Object.keys(qaDetails).length > 0
      ? createSource('qa_report', qaPath, 'qa_vector_metrics', {
          metric_keys: Object.keys(qaMetrics),
          detail_keys: Object.keys(qaDetails),
        })
      : null,
    hasSvgViewMetadata
      ? createSource('svg', drawingSvgPath, 'svg_view_group_metadata', {
          view_ids: svgViews.map((entry) => entry.id),
        })
      : null,
  ]);

  const findings = [];
  const overflowViews = uniqueStrings([
    ...asArray(layoutSummary.overflow_views),
    ...Object.entries(layoutViews)
      .filter(([, value]) => value?.fit?.overflow === true)
      .map(([viewId]) => viewId),
    ...asArray(qaDetails.overflows).map((entry) => cleanText(entry?.view)).filter(Boolean),
  ]);

  for (const viewId of overflowViews) {
    const meta = metadataByView.get(viewId) || { id: viewId, label: viewId };
    findings.push(buildFinding({
      type: 'view_crowding',
      severity: 'warning',
      message: `Structured layout evidence shows view "${meta.label}" is crowded or overflowed.`,
      recommendation: `Reduce scale or improve spacing for view ${meta.label}.`,
      viewIds: [viewId],
      labels: [meta.label],
      rawSource: {
        artifact_type: 'layout_report',
        path: resolveMaybe(layoutReportPath),
        method: 'layout_report_views',
        layout_view_key: viewId,
        layout_region_ref: meta.region_ref || `views.${viewId}`,
      },
    }));
  }

  const textOverlaps = asArray(qaDetails.text_overlaps)
    .filter((entry) => entry && typeof entry === 'object');
  if (textOverlaps.length > 0) {
    textOverlaps.forEach((entry, index) => {
      findings.push(buildFinding({
        type: 'text_overlap',
        severity: 'warning',
        message: 'Structured QA evidence shows overlapping drawing text.',
        recommendation: 'Separate overlapping note or dimension text and reroute leaders if needed.',
        viewIds: [cleanText(entry.view, 'page')],
        labels: [cleanText(entry.text1), cleanText(entry.text2)],
        rawSource: {
          artifact_type: 'qa_report',
          path: resolveMaybe(qaPath),
          method: 'qa_vector_text_overlap',
          pair_index: index,
          iou: finiteNumber(entry.iou),
        },
      }));
    });
  } else {
    const textOverlapPairs = finiteNumber(qaMetrics.text_overlap_pairs) || 0;
    if (textOverlapPairs > 0) {
      findings.push(buildFinding({
        type: 'text_overlap',
        severity: 'warning',
        message: `Structured QA evidence found ${textOverlapPairs} overlapping text pair(s).`,
        recommendation: 'Separate overlapping note or dimension text and reroute leaders if needed.',
        rawSource: {
          artifact_type: 'qa_report',
          path: resolveMaybe(qaPath),
          method: 'qa_vector_text_overlap_metric',
          metric: 'text_overlap_pairs',
          count: textOverlapPairs,
        },
      }));
    }
  }

  const dimensionOverlapPairs = finiteNumber(qaMetrics.dim_overlap_pairs) || 0;
  if (dimensionOverlapPairs > 0) {
    findings.push(buildFinding({
      type: 'dimension_overlap',
      severity: 'warning',
      message: `Structured QA evidence found ${dimensionOverlapPairs} dimension overlap pair(s).`,
      recommendation: 'Reposition conflicting dimensions or adjust the view layout so dimensions stay legible.',
      rawSource: {
        artifact_type: 'qa_report',
        path: resolveMaybe(qaPath),
        method: 'qa_vector_dimension_overlap_metric',
        metric: 'dim_overlap_pairs',
        count: dimensionOverlapPairs,
      },
    }));
  }

  if (qaMetrics.notes_overflow === true) {
    findings.push(buildFinding({
      type: 'title_block_clearance',
      severity: 'warning',
      message: 'Structured QA evidence shows general notes encroaching into the title-block area.',
      recommendation: 'Move note text clear of the title block and preserve the title-block clearance band.',
      viewIds: ['notes', 'title_block'],
      labels: ['general-notes', 'title-block'],
      rawSource: {
        artifact_type: 'qa_report',
        path: resolveMaybe(qaPath),
        method: 'qa_notes_overflow_metric',
        metric: 'notes_overflow',
        value: true,
      },
    }));
  }

  const coreEvidenceAvailable = hasLayoutViewData
    || hasOverflowEvidence
    || hasTextOverlapEvidence
    || hasDimensionOverlapEvidence
    || hasNotesOverflowEvidence
    || hasSvgViewMetadata;

  if (!coreEvidenceAvailable) {
    findings.push(buildFinding({
      type: 'missing_layout_metadata',
      severity: 'info',
      message: 'Structured layout/readability metadata is missing, so advisory scoring was not evaluated.',
      recommendation: 'Generate a layout report or structured QA evidence before relying on layout/readability scoring.',
      rawSource: {
        artifact_type: 'drawing_quality',
        path: null,
        method: 'layout_readability_preflight',
      },
    }));
  }

  const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
  const infoCount = findings.filter((finding) => finding.severity === 'info').length;
  const evidenceState = !coreEvidenceAvailable
    ? 'missing'
    : hasLayoutViewData && hasOverflowEvidence && hasTextOverlapEvidence && hasDimensionOverlapEvidence && hasNotesOverflowEvidence
      ? 'available'
      : 'partial';
  const canScore = evidenceState === 'available';
  const score = canScore
    ? clamp(roundNumber(
      100
        - Math.min(35, overflowViews.length * 18)
        - Math.min(30, Math.max(textOverlaps.length, finiteNumber(qaMetrics.text_overlap_pairs) || 0) * 12)
        - Math.min(20, dimensionOverlapPairs * 10)
        - (qaMetrics.notes_overflow === true ? 10 : 0),
      1
    ), 0, 100)
    : null;

  const status = warningCount > 0
    ? 'warning'
    : !coreEvidenceAvailable
      ? 'not_evaluated'
      : 'ok';
  const confidence = canScore
    ? 'high'
    : coreEvidenceAvailable
      ? 'medium'
      : null;
  const evaluatedViews = uniqueStrings([
    ...Object.keys(layoutViews),
    ...svgViews.map((entry) => entry.id),
    ...overflowViews,
    ...textOverlaps.map((entry) => cleanText(entry.view)).filter(Boolean),
  ]);

  const recommendedActions = summarizeLayoutReadabilityActions({
    findings,
    recommended_actions: [],
  });

  return {
    status,
    score,
    confidence,
    evidence_state: evidenceState,
    summary: status === 'warning'
      ? `${warningCount} advisory layout/readability finding(s) confirmed from structured metadata.`
      : status === 'ok'
        ? evidenceState === 'available'
          ? 'No advisory layout/readability findings were confirmed from structured metadata.'
          : 'No advisory layout/readability findings were confirmed from the available structured metadata.'
        : 'Layout/readability scoring was not evaluated because structured metadata is missing.',
    finding_count: findings.length,
    warning_count: warningCount,
    info_count: infoCount,
    findings,
    recommended_actions: recommendedActions,
    provenance: {
      sources,
      evaluated_view_ids: evaluatedViews,
      metrics_available: {
        layout_views: hasLayoutViewData,
        overflow: hasOverflowEvidence,
        text_overlap: hasTextOverlapEvidence,
        dimension_overlap: hasDimensionOverlapEvidence,
        notes_overflow: hasNotesOverflowEvidence,
        svg_view_metadata: hasSvgViewMetadata,
      },
    },
  };
}

function uniqueSources(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
