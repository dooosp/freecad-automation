import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  collectRecommendedDrawingViews,
  isExplicitlyUnsupportedDrawingView,
  normalizeDrawingViewDescriptor,
} from '../../../lib/drawing-intent.js';
import { buildFeatureCatalog } from '../../../lib/feature-catalog.js';

export const DRAWING_PLANNER_SCHEMA_VERSION = '0.1';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function cleanText(value, fallback = null) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeId(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function makeConfidence(score, rationale) {
  const clamped = Math.max(0, Math.min(1, Number(score) || 0));
  return {
    score: Number(clamped.toFixed(2)),
    level: clamped >= 0.8 ? 'high' : clamped >= 0.55 ? 'medium' : 'low',
    rationale,
  };
}

function recommendation({
  id,
  type,
  feature_type = null,
  feature_id = null,
  view = null,
  dimension_type = null,
  message,
  reason,
  evidence_refs = [],
  confidence = makeConfidence(0.6, 'Rule-based planning recommendation.'),
  status = 'recommended',
  suggested_fix = null,
}) {
  return {
    id,
    type,
    ...(feature_type ? { feature_type } : {}),
    ...(feature_id ? { feature_id } : {}),
    ...(view ? { view } : {}),
    ...(dimension_type ? { dimension_type } : {}),
    status,
    message,
    reason,
    evidence_refs: uniqueStrings(evidence_refs),
    confidence,
    ...(suggested_fix ? { suggested_fix } : {}),
  };
}

function evidence(ref, kind, summary, path = null) {
  return {
    ref,
    kind,
    summary,
    ...(path ? { path: resolve(path) } : {}),
  };
}

function addFeature(features, evidenceItems, feature) {
  if (!feature?.feature_id) return;
  const existing = features.get(feature.feature_id);
  if (existing) {
    existing.evidence_refs = uniqueStrings([...(existing.evidence_refs || []), ...(feature.evidence_refs || [])]);
    return;
  }
  features.set(feature.feature_id, feature);
  for (const item of feature.evidence || []) evidenceItems.push(item);
}

function featureFromTraceability(raw = {}) {
  const featureId = cleanText(raw.feature_id || raw.id);
  const type = cleanText(raw.type);
  if (!featureId || !type) return null;
  const evidenceRef = `traceability:feature:${featureId}`;
  return {
    feature_id: featureId,
    type,
    diameter_mm: finiteNumber(raw.diameter),
    size_mm: finiteNumber(raw.size),
    position: Array.isArray(raw.position) ? raw.position : null,
    axis: Array.isArray(raw.axis) ? raw.axis : null,
    source: 'traceability',
    reliable: true,
    evidence_refs: [evidenceRef],
    evidence: [evidence(evidenceRef, 'feature', `${type} feature "${featureId}" from drawing traceability.`)],
  };
}

function catalogEvidenceRef(feature = {}) {
  const evidenceItem = feature.evidence || {};
  if (evidenceItem.tool_shape_id) return `config:shape:${evidenceItem.tool_shape_id}`;
  if (evidenceItem.shape_id) return `config:shape:${evidenceItem.shape_id}`;
  if (feature.feature_id) return `feature_catalog:${feature.feature_id}`;
  return 'feature_catalog:unknown';
}

function catalogFeatureToPlannerFeature(feature = {}) {
  const featureId = cleanText(feature.feature_id || feature.id);
  const type = cleanText(feature.type);
  if (!featureId || !type || type.startsWith('unknown')) return null;
  const dimensions = feature.dimensions || {};
  const evidenceRef = catalogEvidenceRef(feature);
  const plannerType = type === 'primary_body'
    ? (/plate/i.test(featureId) ? 'plate' : 'body')
    : type;
  return {
    feature_id: featureId,
    type: plannerType,
    diameter_mm: finiteNumber(dimensions.diameter_mm),
    length_mm: finiteNumber(dimensions.length_mm),
    width_mm: finiteNumber(dimensions.width_mm),
    thickness_mm: finiteNumber(dimensions.height_mm),
    position: Array.isArray(dimensions.position_mm) ? dimensions.position_mm : null,
    axis: [0, 0, 1],
    source: 'feature_catalog',
    reliable: Number(feature.confidence || 0) >= 0.5,
    evidence_refs: [evidenceRef],
    evidence: [
      evidence(
        evidenceRef,
        'feature_catalog',
        `${plannerType} feature "${featureId}" from conservative feature catalog evidence.`,
        feature.related_config_path
      ),
    ],
  };
}

function normalizeFeatureCatalog({ featureCatalog = null, traceability = null, config = {} } = {}) {
  const features = new Map();
  const evidenceItems = [];

  const catalog = featureCatalog && typeof featureCatalog === 'object' && !Array.isArray(featureCatalog)
    ? featureCatalog
    : buildFeatureCatalog({ config });
  for (const raw of asArray(catalog?.features || featureCatalog)) {
    const feature = catalogFeatureToPlannerFeature(raw);
    if (feature) addFeature(features, evidenceItems, feature);
  }

  const traceabilityFeatures = asArray(traceability?.features);
  for (const raw of traceabilityFeatures) {
    const feature = featureFromTraceability(raw);
    if (feature) addFeature(features, evidenceItems, feature);
  }

  return {
    features: [...features.values()].sort((a, b) => a.feature_id.localeCompare(b.feature_id)),
    evidence: evidenceItems.sort((a, b) => a.ref.localeCompare(b.ref)),
  };
}

function groupHolePatterns(features = []) {
  const holes = features.filter((feature) => feature.type === 'through_hole' || feature.type === 'hole');
  const byDiameter = new Map();
  for (const hole of holes) {
    if (!Array.isArray(hole.position) || finiteNumber(hole.diameter_mm) === null) continue;
    const key = `${Number(hole.diameter_mm).toFixed(3)}:${JSON.stringify(hole.axis || [0, 0, 1])}`;
    byDiameter.set(key, [...(byDiameter.get(key) || []), hole]);
  }
  return [...byDiameter.values()]
    .filter((group) => group.length >= 3)
    .map((group, index) => ({
      feature_id: `hole_pattern_${index + 1}`,
      type: 'hole_pattern',
      count: group.length,
      diameter_mm: group[0].diameter_mm,
      feature_ids: group.map((feature) => feature.feature_id),
      evidence_refs: uniqueStrings(group.flatMap((feature) => feature.evidence_refs)),
    }));
}

function collectIntentDimensions(drawingIntent = {}, dimensionMap = {}) {
  const intentDims = asArray(
    drawingIntent.required_dimensions
      || drawingIntent.dim_intents
      || drawingIntent.dimensions
  );
  const planDims = asArray(dimensionMap.plan_dimensions);
  const autoDims = asArray(dimensionMap.auto_dimensions);
  return [...intentDims, ...planDims, ...autoDims]
    .map((entry) => ({
      id: cleanText(entry.id || entry.dim_id),
      feature: cleanText(entry.feature || entry.feature_id),
      style: cleanText(entry.style || entry.dimension_type || entry.type),
      required: entry.required === true,
      rendered: entry.rendered === true || entry.status === 'rendered',
      status: cleanText(entry.status),
    }))
    .filter((entry) => entry.id || entry.feature || entry.style);
}

function hasMatchingDimension(dimensions, { featureId = null, terms = [], styles = [] } = {}) {
  const normalizedTerms = terms.map(normalizeId).filter(Boolean);
  const normalizedFeature = normalizeId(featureId);
  const normalizedStyles = styles.map(normalizeId).filter(Boolean);

  return dimensions.find((dimension) => {
    const id = normalizeId(dimension.id);
    const feature = normalizeId(dimension.feature);
    const style = normalizeId(dimension.style);
    const idOrStyleMatches = normalizedTerms.length === 0
      || normalizedTerms.some((term) => id.includes(term) || style.includes(term));
    const featureMatches = !normalizedFeature
      || feature === normalizedFeature
      || id.includes(normalizedFeature);
    const styleMatches = normalizedStyles.length === 0
      || normalizedStyles.some((term) => style.includes(term) || id.includes(term));
    return featureMatches && idOrStyleMatches && styleMatches;
  }) || null;
}

function pushDimension(recommendations, missing, dimensions, spec) {
  const match = hasMatchingDimension(dimensions, spec.match);
  const status = match
    ? (match.rendered ? 'rendered_or_mapped' : 'planned')
    : 'missing_intent';
  const rec = recommendation({
    id: spec.id,
    type: 'required_dimension',
    feature_type: spec.feature_type,
    feature_id: spec.feature_id,
    view: spec.view,
    dimension_type: spec.dimension_type,
    status,
    message: spec.message,
    reason: spec.reason,
    evidence_refs: spec.evidence_refs,
    confidence: spec.confidence,
    suggested_fix: match ? null : spec.suggested_fix,
  });
  recommendations.push(rec);
  if (!match) {
    missing.push({
      id: `${spec.id}:missing`,
      dimension_id: spec.id,
      feature_id: spec.feature_id,
      feature_type: spec.feature_type,
      dimension_type: spec.dimension_type,
      explanation: spec.missing_explanation,
      suggested_fix: spec.suggested_fix,
      evidence_refs: uniqueStrings(spec.evidence_refs),
      confidence: spec.confidence,
    });
  }
}

function buildViewRecommendations(config, features, drawingIntent = {}) {
  const existingViews = uniqueStrings([
    ...asArray(config?.drawing_plan?.views?.enabled),
    ...asArray(config?.drawing?.views),
  ]);
  const hasBody = features.some((feature) => feature.type === 'plate' || feature.type === 'body');
  const hasHoles = features.some((feature) => feature.type === 'through_hole' || feature.type === 'hole');
  const hasBracket = config?.drawing_plan?.part_type === 'bracket'
    || asArray(config.operations).some((operation) => operation?.op === 'fuse');
  const views = [];
  const seenViewIds = new Set();
  const pushViewRecommendation = (entry) => {
    const key = cleanText(entry?.view);
    if (!key || seenViewIds.has(key)) return;
    seenViewIds.add(key);
    views.push(entry);
  };
  const addView = (view, reason, refs, score = 0.78) => {
    pushViewRecommendation(recommendation({
      id: `view:${view}`,
      type: 'required_view',
      view,
      status: existingViews.includes(view) ? 'already_requested' : 'recommended',
      message: `Recommend ${view} view.`,
      reason,
      evidence_refs: refs,
      confidence: makeConfidence(score, 'Conservative view rule matched reliable geometry evidence.'),
      suggested_fix: existingViews.includes(view) ? null : `Add "${view}" to drawing.views or drawing_plan.views.enabled.`,
    }));
  };

  if (hasBody || hasHoles) {
    const refs = uniqueStrings(features
      .filter((feature) => feature.type === 'plate' || feature.type === 'body' || feature.type === 'through_hole' || feature.type === 'hole')
      .flatMap((feature) => feature.evidence_refs));
    addView('top', 'Top view is the clearest evidence-backed view for plate footprint and hole locations.', refs, 0.86);
  }
  if (hasBody) {
    const refs = uniqueStrings(features
      .filter((feature) => feature.type === 'plate' || feature.type === 'body')
      .flatMap((feature) => feature.evidence_refs));
    addView('front', 'Front view supports body thickness/height communication without relying on an isometric view.', refs, 0.74);
  }
  if (hasBracket) {
    addView(
      'right',
      'A fused/bracket-like body benefits from a side view to avoid hiding the web or depth relationship.',
      uniqueStrings(asArray(config.operations).map((operation) => `config:operation:${operation?.op || 'unknown'}`)),
      0.68
    );
  }

  for (const explicitView of collectRecommendedDrawingViews(drawingIntent)) {
    const descriptor = normalizeDrawingViewDescriptor(explicitView);
    if (!descriptor.id) continue;
    const label = cleanText(explicitView.label || descriptor.label || descriptor.id, descriptor.id);
    const kindLabel = descriptor.view_kind === 'section'
      ? 'section view'
      : descriptor.view_kind === 'detail'
        ? 'detail view'
        : 'view';
    pushViewRecommendation(recommendation({
      id: `view:${descriptor.id}`,
      type: 'recommended_view',
      view: descriptor.id,
      feature_id: cleanText(explicitView.feature),
      status: existingViews.includes(descriptor.id) ? 'already_requested' : 'recommended',
      message: `Carry recommended ${label}.`,
      reason: cleanText(explicitView.reason || explicitView.purpose, `Drawing intent explicitly recommends this ${kindLabel}.`),
      evidence_refs: uniqueStrings([
        'drawing_intent:recommended_views',
        cleanText(explicitView.feature) ? `drawing_intent:feature:${cleanText(explicitView.feature)}` : null,
      ]),
      confidence: makeConfidence(
        descriptor.view_kind === 'section' || descriptor.view_kind === 'detail' ? 0.72 : 0.68,
        'Drawing intent explicitly marks this view as recommended, but it remains advisory.'
      ),
      suggested_fix: existingViews.includes(descriptor.id)
        ? null
        : descriptor.view_kind === 'section' || descriptor.view_kind === 'detail'
          ? `Add ${label} only if it improves clarity, and keep it as a distinct labeled view region rather than a loose label.`
          : `Add "${descriptor.id}" to drawing.views or drawing_plan.views.enabled only if it improves clarity.`,
    }));
  }
  return views;
}

function buildDimensions(features, dimensions) {
  const required = [];
  const missing = [];
  const bodies = features.filter((feature) => feature.type === 'plate' || feature.type === 'body');
  const holes = features.filter((feature) => feature.type === 'through_hole' || feature.type === 'hole');
  const slots = features.filter((feature) => feature.type === 'slot');
  const patterns = groupHolePatterns(features);

  for (const body of bodies.slice(0, 1)) {
    const refs = body.evidence_refs || [];
    pushDimension(required, missing, dimensions, {
      id: `${body.feature_id}:overall_length`,
      feature_type: body.type,
      feature_id: body.feature_id,
      view: 'top',
      dimension_type: 'overall_length',
      message: `Dimension overall length for ${body.feature_id}.`,
      reason: 'Body/plate footprint should be bounded by an overall length dimension.',
      evidence_refs: refs,
      confidence: makeConfidence(0.82, 'Box body dimensions are explicit in config or feature evidence.'),
      match: { terms: ['length', 'overall_length', 'width'], styles: ['linear'] },
      missing_explanation: 'No explicit drawing intent or dimension-map entry was found for the body overall length.',
      suggested_fix: 'Add a required linear dimension intent for overall length from a declared datum or edge.',
    });
    pushDimension(required, missing, dimensions, {
      id: `${body.feature_id}:overall_width`,
      feature_type: body.type,
      feature_id: body.feature_id,
      view: 'top',
      dimension_type: 'overall_width',
      message: `Dimension overall width for ${body.feature_id}.`,
      reason: 'Body/plate footprint should be bounded by an overall width dimension.',
      evidence_refs: refs,
      confidence: makeConfidence(0.82, 'Box body dimensions are explicit in config or feature evidence.'),
      match: { terms: ['width', 'overall_width'], styles: ['linear'] },
      missing_explanation: 'No explicit drawing intent or dimension-map entry was found for the body overall width.',
      suggested_fix: 'Add a required linear dimension intent for overall width from a declared datum or edge.',
    });
    pushDimension(required, missing, dimensions, {
      id: `${body.feature_id}:thickness`,
      feature_type: body.type,
      feature_id: body.feature_id,
      view: 'front',
      dimension_type: 'thickness',
      message: `Dimension thickness for ${body.feature_id}.`,
      reason: 'A plate/body thickness is required to manufacture the body from orthographic views.',
      evidence_refs: refs,
      confidence: makeConfidence(0.78, 'Box height/thickness evidence is available.'),
      match: { terms: ['thickness', 'height'], styles: ['linear'] },
      missing_explanation: 'No explicit drawing intent or dimension-map entry was found for body thickness.',
      suggested_fix: 'Add a required thickness/height dimension intent on a front or side view.',
    });
  }

  for (const hole of holes) {
    const refs = hole.evidence_refs || [];
    pushDimension(required, missing, dimensions, {
      id: `${hole.feature_id}:diameter`,
      feature_type: hole.type,
      feature_id: hole.feature_id,
      view: 'top',
      dimension_type: 'diameter',
      message: `Dimension diameter for ${hole.feature_id}.`,
      reason: 'Through-hole evidence supports a required diameter callout.',
      evidence_refs: refs,
      confidence: makeConfidence(hole.reliable ? 0.9 : 0.62, hole.reliable ? 'Cylinder cut provides reliable diameter evidence.' : 'Hole evidence exists, but diameter is incomplete.'),
      match: { featureId: hole.feature_id, terms: ['dia', 'diameter'], styles: ['diameter'] },
      missing_explanation: `No explicit diameter intent or mapped dimension was found for hole "${hole.feature_id}".`,
      suggested_fix: `Add a required diameter dimension intent for "${hole.feature_id}".`,
    });
  }

  const patternedHoleIds = new Set(patterns.flatMap((pattern) => pattern.feature_ids));
  for (const hole of holes.filter((feature) => !patternedHoleIds.has(feature.feature_id))) {
    const refs = hole.evidence_refs || [];
    pushDimension(required, missing, dimensions, {
      id: `${hole.feature_id}:center_location`,
      feature_type: hole.type,
      feature_id: hole.feature_id,
      view: 'top',
      dimension_type: 'center_location',
      message: `Locate center of ${hole.feature_id}.`,
      reason: 'A standalone through hole needs a center-location dimension from a datum or edge.',
      evidence_refs: refs,
      confidence: makeConfidence(Array.isArray(hole.position) ? 0.8 : 0.56, Array.isArray(hole.position) ? 'Hole position is available.' : 'Hole position is not explicit; keep this advisory.'),
      match: { featureId: hole.feature_id, terms: ['loc', 'position', 'center', 'x', 'y'], styles: ['ordinate', 'linear'] },
      missing_explanation: `No explicit center-location intent was found for standalone hole "${hole.feature_id}".`,
      suggested_fix: `Add required X/Y or ordinate location intent for "${hole.feature_id}" from declared datums.`,
    });
  }

  for (const pattern of patterns) {
    pushDimension(required, missing, dimensions, {
      id: `${pattern.feature_id}:pattern_callout`,
      feature_type: 'hole_pattern',
      feature_id: pattern.feature_id,
      view: 'top',
      dimension_type: 'hole_pattern',
      message: `Define ${pattern.count}x hole pattern with common diameter ${pattern.diameter_mm} mm.`,
      reason: 'Repeated equal-diameter holes should be communicated as a pattern instead of individually over-dimensioning each edge.',
      evidence_refs: pattern.evidence_refs,
      confidence: makeConfidence(0.78, 'Three or more equal-diameter positioned holes were detected.'),
      match: { terms: ['pattern', 'pcd', 'pitch', 'bolt', 'holecount', 'count', 'dia'], styles: ['diameter', 'ordinate'] },
      missing_explanation: 'No explicit drawing intent or dimension-map entry was found for the repeated hole pattern.',
      suggested_fix: 'Add a required hole-pattern callout or ordinate/baseline scheme covering count, common diameter, and pattern location.',
    });
  }

  for (const slot of slots) {
    const refs = slot.evidence_refs || [];
    for (const dimensionType of ['slot_width', 'slot_length', 'slot_center_location']) {
      pushDimension(required, missing, dimensions, {
        id: `${slot.feature_id}:${dimensionType}`,
        feature_type: 'slot',
        feature_id: slot.feature_id,
        view: 'top',
        dimension_type: dimensionType,
        message: `Dimension ${dimensionType.replaceAll('_', ' ')} for ${slot.feature_id}.`,
        reason: 'Slot evidence is reliable enough to recommend width, length, and center location.',
        evidence_refs: refs,
        confidence: makeConfidence(0.72, 'Slot-like cut evidence is present.'),
        match: { featureId: slot.feature_id, terms: ['slot', dimensionType, dimensionType.replace('slot_', '')], styles: ['linear', 'ordinate'] },
        missing_explanation: `No explicit ${dimensionType.replaceAll('_', ' ')} intent was found for slot "${slot.feature_id}".`,
        suggested_fix: `Add a required ${dimensionType.replaceAll('_', ' ')} dimension intent for "${slot.feature_id}".`,
      });
    }
  }

  return { required, missing };
}

function buildAnnotations(config, features) {
  const annotations = [];
  const holes = features.filter((feature) => feature.type === 'through_hole' || feature.type === 'hole');
  if (holes.length > 0) {
    annotations.push(recommendation({
      id: 'annotation:centerlines-for-holes',
      type: 'annotation',
      message: 'Show center marks or centerlines for hole features.',
      reason: 'Hole features are present; center marks improve inspection readability without adding tolerance claims.',
      evidence_refs: uniqueStrings(holes.flatMap((feature) => feature.evidence_refs)),
      confidence: makeConfidence(0.82, 'Hole features are reliable drawing evidence.'),
      suggested_fix: 'Enable or verify center marks/centerlines for hole views.',
    }));
  }

  const material = cleanText(config?.drawing?.meta?.material || config?.manufacturing?.material);
  if (material) {
    annotations.push(recommendation({
      id: 'annotation:material-note',
      type: 'annotation',
      message: `Carry material note "${material}" on the drawing.`,
      reason: 'Material is explicitly declared in drawing/manufacturing metadata.',
      evidence_refs: ['config:drawing.meta.material', 'config:manufacturing.material'],
      confidence: makeConfidence(0.86, 'Material metadata is explicitly present.'),
      suggested_fix: 'Add or verify the material note in the title block or general notes.',
    }));
  }

  const generalTolerance = cleanText(config?.drawing?.tolerances?.general || config?.drawing?.ks_standard?.general_tolerance);
  if (generalTolerance) {
    annotations.push(recommendation({
      id: 'annotation:declared-general-tolerance',
      type: 'annotation',
      message: `Carry declared general tolerance "${generalTolerance}" as a note.`,
      reason: 'General tolerance is explicitly declared; the planner is not inventing a tolerance.',
      evidence_refs: ['config:drawing.tolerances.general', 'config:drawing.ks_standard.general_tolerance'],
      confidence: makeConfidence(0.84, 'Tolerance metadata is explicitly present.'),
      suggested_fix: 'Add or verify the declared general tolerance note.',
    }));
  }

  return annotations;
}

function buildSectionAndDetailViews(features) {
  const section = [];
  const detail = [];
  const slots = features.filter((feature) => feature.type === 'slot');
  const bores = features.filter((feature) => ['bore', 'counterbore'].includes(feature.type));
  const holes = features.filter((feature) => feature.type === 'through_hole' || feature.type === 'hole');

  for (const feature of [...slots, ...bores].slice(0, 2)) {
    section.push(recommendation({
      id: `section:${feature.feature_id}`,
      type: 'section_view',
      feature_type: feature.type,
      feature_id: feature.feature_id,
      message: `Consider a section view through ${feature.feature_id}.`,
      reason: 'Internal slot/bore evidence can be hard to verify from exterior views alone.',
      evidence_refs: feature.evidence_refs,
      confidence: makeConfidence(0.66, 'Section recommendation is limited to internal feature evidence.'),
      suggested_fix: `Add a section view only if ${feature.feature_id} cannot be clearly dimensioned on an orthographic view.`,
    }));
  }

  const smallHoles = holes.filter((feature) => {
    const diameter = finiteNumber(feature.diameter_mm);
    return diameter !== null && diameter <= 6;
  });
  if (smallHoles.length > 0) {
    detail.push(recommendation({
      id: 'detail:small-hole-callouts',
      type: 'detail_view',
      feature_type: 'through_hole',
      message: 'Consider a detail view for small hole callouts if the sheet scale makes them crowded.',
      reason: 'Small hole diameter evidence is present; this remains conditional on drawing readability.',
      evidence_refs: uniqueStrings(smallHoles.flatMap((feature) => feature.evidence_refs)),
      confidence: makeConfidence(0.56, 'Small feature evidence supports only a conditional detail-view recommendation.'),
      suggested_fix: 'Add a local detail view only if diameter/location callouts collide or become unreadable.',
    }));
  }

  return { section, detail };
}

function normalizeRequirementItem(item, defaultRequired = false) {
  if (typeof item === 'string') {
    return {
      id: item,
      label: item,
      text: item,
      required: defaultRequired,
      optional: !defaultRequired,
    };
  }
  if (!item || typeof item !== 'object') return null;
  const id = cleanText(item.id ?? item.key ?? item.name ?? item.feature ?? item.dim_id ?? item.view);
  const label = cleanText(item.label ?? item.title ?? item.name ?? item.text ?? id);
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

function collectRequiredIntentItems(drawingIntent = {}) {
  const dimensions = normalizeRequirementList(
    drawingIntent.required_dimensions
      ?? drawingIntent.dimensions
      ?? drawingIntent.dimension_requirements,
    true
  ).filter((entry) => entry.required && !entry.optional);
  const notes = normalizeRequirementList(
    drawingIntent.required_notes
      ?? drawingIntent.notes?.required
      ?? drawingIntent.notes,
    true
  ).filter((entry) => entry.required && !entry.optional);
  const views = normalizeRequirementList(
    drawingIntent.required_views
      ?? drawingIntent.views?.required
      ?? drawingIntent.views,
    true
  ).filter((entry) => entry.required && !entry.optional);
  return {
    dimensions,
    notes,
    views,
  };
}

function splitFeatureIds(value) {
  return uniqueStrings(String(value || '')
    .split(',')
    .map((entry) => cleanText(entry))
    .filter(Boolean));
}

function featureCatalogMap(featureCatalog = null) {
  const items = asArray(featureCatalog?.features || featureCatalog);
  return new Map(
    items
      .filter((entry) => entry && typeof entry === 'object' && cleanText(entry.feature_id || entry.id) && cleanText(entry.type))
      .map((entry) => [
        cleanText(entry.feature_id || entry.id),
        {
          feature_id: cleanText(entry.feature_id || entry.id),
          type: cleanText(entry.type),
        },
      ])
  );
}

function serializeEvidenceValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function actionEvidence(source, path, value) {
  return {
    source,
    path,
    value: serializeEvidenceValue(value),
  };
}

function actionIdPart(value, fallback = 'item') {
  const normalized = normalizeId(value);
  return normalized || fallback;
}

function buildPlannerAction({
  id,
  severity,
  category,
  targetRequirementId = null,
  targetFeatureId = null,
  classification,
  title,
  message,
  recommendedFixSteps = [],
  evidence = [],
}) {
  return {
    id,
    severity,
    category,
    target_requirement_id: cleanText(targetRequirementId),
    target_feature_id: cleanText(targetFeatureId),
    classification,
    title,
    message,
    recommended_fix: uniqueStrings(recommendedFixSteps).join(' '),
    evidence: evidence.filter((entry) => entry && typeof entry === 'object' && cleanText(entry.source) && cleanText(entry.path)),
  };
}

export function formatPlannerSuggestedAction(action = {}) {
  return uniqueStrings([
    cleanText(action.title),
    cleanText(action.recommended_fix),
  ]).join(' ');
}

function noteActionLabel(requirement = {}, evidenceEntry = {}) {
  return cleanText(
    evidenceEntry.requirement_id || requirement.id || evidenceEntry.requirement_label || requirement.label,
    'required note'
  );
}

function viewActionLabel(requirement = {}, evidenceEntry = {}) {
  const descriptor = normalizeDrawingViewDescriptor({
    ...requirement,
    id: requirement.view || requirement.id || evidenceEntry.requirement_id || evidenceEntry.requirement_label,
    label: requirement.label || evidenceEntry.requirement_label,
  });
  return cleanText(descriptor.label || descriptor.id, 'required view');
}

function requirementLookup(drawingIntent = {}) {
  const intent = collectRequiredIntentItems(drawingIntent);
  const lookup = new Map();
  for (const entry of intent.dimensions) lookup.set(cleanText(entry.id), entry);
  for (const entry of intent.notes) lookup.set(cleanText(entry.id), entry);
  for (const entry of intent.views) lookup.set(cleanText(entry.id), entry);
  return lookup;
}

function requirementFeatureContext(requirement = {}, evidenceEntry = {}, { featureCatalog = null, planner = null } = {}) {
  const catalogById = featureCatalogMap(featureCatalog);
  const featureIds = uniqueStrings([
    ...splitFeatureIds(requirement.feature),
    cleanText(evidenceEntry.matched_feature_id),
    ...asArray(evidenceEntry.candidate_matches).map((entry) => cleanText(entry?.matched_feature_id)),
  ]);
  const featureTypes = uniqueStrings(featureIds.map((featureId) => cleanText(catalogById.get(featureId)?.type)).filter(Boolean));
  const sectionMatch = asArray(planner?.section_view_recommendations).find((entry) => {
    if (featureIds.some((featureId) => featureId && cleanText(entry?.feature_id) === featureId)) return true;
    return featureTypes.some((type) => type && cleanText(entry?.feature_type) === type);
  }) || null;
  return {
    feature_ids: featureIds,
    feature_types: featureTypes,
    primary_feature_id: featureIds[0] || cleanText(sectionMatch?.feature_id),
    section_feature_id: cleanText(sectionMatch?.feature_id),
    supports_section_view: Boolean(sectionMatch),
    has_hole_feature: featureTypes.some((type) => type === 'hole' || type === 'through_hole' || type === 'hole_pattern'),
  };
}

function isDimensionDepthRequirement(requirement = {}, evidenceEntry = {}) {
  const comparable = [
    requirement.id,
    requirement.label,
    requirement.dimension_type,
    evidenceEntry.requirement_id,
    evidenceEntry.requirement_label,
  ].map((value) => normalizeId(value));
  return comparable.some((value) => value && value.includes('depth'));
}

function isHoleDiameterRequirement(requirement = {}, evidenceEntry = {}, featureContext = {}) {
  const dimensionType = normalizeId(requirement.dimension_type || requirement.style || '');
  const comparable = [
    requirement.id,
    requirement.label,
    evidenceEntry.requirement_id,
    evidenceEntry.requirement_label,
  ].map((value) => normalizeId(value));
  const hasDiameterHint = comparable.some((value) => value && value.includes('dia'))
    || comparable.some((value) => value && value.includes('diameter'))
    || dimensionType === 'diameter';
  return hasDiameterHint && featureContext.has_hole_feature;
}

function isEnvelopeRequirement(requirement = {}, evidenceEntry = {}) {
  const comparable = [
    requirement.id,
    requirement.label,
    evidenceEntry.requirement_id,
    evidenceEntry.requirement_label,
  ].map((value) => normalizeId(value));
  return comparable.some((value) => value && (
    value.includes('envelope')
      || value.includes('footprint')
      || value.includes('lengthandwidth')
      || value.includes('overalllengthandwidth')
  ));
}

function dimensionFixSteps(requirement = {}, evidenceEntry = {}, featureContext = {}, classification = 'unknown') {
  const requirementLabel = cleanText(evidenceEntry.requirement_label || requirement.label || requirement.id, 'required dimension');
  const sectionFeatureId = cleanText(featureContext.section_feature_id || featureContext.primary_feature_id);
  const holeFeatureId = cleanText(featureContext.primary_feature_id);
  const envelopeFeatureId = cleanText(featureContext.primary_feature_id);

  if (classification === 'unsupported') {
    return [
      'Regenerate the drawing semantics artifacts and confirm SVG or layout extraction ran for this drawing.',
      `Re-check ${requirementLabel} after extracted evidence is available.`,
    ];
  }

  if (isDimensionDepthRequirement(requirement, evidenceEntry) && featureContext.supports_section_view && sectionFeatureId) {
    return classification === 'missing'
      ? [
        `Add or label a section view through ${sectionFeatureId}.`,
        `Add a linked depth dimension for ${requirementLabel}.`,
        'Verify SVG text extraction can read the depth label.',
      ]
      : [
        `Add or label a section view through ${sectionFeatureId} if the depth is not readable in the current orthographic views.`,
        `Verify the linked depth dimension for ${requirementLabel} is visible and labeled clearly.`,
        'Check that SVG text extraction can read the depth label.',
      ];
  }

  if (isHoleDiameterRequirement(requirement, evidenceEntry, featureContext) && holeFeatureId) {
    return classification === 'missing'
      ? [
        `Add or verify a diameter callout for ${holeFeatureId}.`,
        `Keep the callout linked or labeled as ${requirementLabel}.`,
        'Verify SVG text extraction can read the diameter text.',
      ]
      : [
        `Verify the diameter callout for ${holeFeatureId} is visible and clearly labeled as ${requirementLabel}.`,
        'Confirm the diameter symbol and label survive SVG text extraction.',
      ];
  }

  if (isEnvelopeRequirement(requirement, evidenceEntry) && envelopeFeatureId) {
    return classification === 'missing'
      ? [
        `Add or verify both overall length and width callouts for ${envelopeFeatureId}.`,
        `Keep the footprint dimensions linked or labeled so extraction can map them back to ${requirementLabel} without guessing a combined envelope value.`,
      ]
      : [
        `Verify the overall length and width callouts for ${envelopeFeatureId} are both visible and readable in the SVG.`,
        `Keep the footprint dimensions separately labeled or linked so extraction can satisfy ${requirementLabel} without inferring a combined envelope.`,
      ];
  }

  if (classification === 'missing') {
    return [
      `Add the required dimension for ${requirementLabel} to the drawing.`,
      `Label or link it so extracted evidence can map it back to ${requirementLabel}.`,
    ];
  }

  if (classification === 'low_confidence') {
    return [
      `Review the low-confidence extracted candidate for ${requirementLabel}.`,
      'Improve the dimension label, leader placement, or alias text so extraction becomes reliable.',
    ];
  }

  return [
    `Verify the dimension label for ${requirementLabel} is visible and readable in the SVG.`,
    `Relink or relabel ${requirementLabel} if it was manually drafted or detached from the source dimension.`,
  ];
}

function noteFixSteps(requirement = {}, evidenceEntry = {}, classification = 'unknown') {
  const requirementLabel = cleanText(evidenceEntry.requirement_label || requirement.label || requirement.id, 'required note');
  const noteText = cleanText(requirement.text);
  const locationHint = requirement.category === 'material'
    ? 'title block or material note area'
    : 'general notes';

  if (classification === 'unsupported') {
    return [
      'Regenerate extracted drawing semantics so SVG note extraction runs for this sheet.',
      `Re-check ${requirementLabel} after note extraction is available.`,
    ];
  }

  if (classification === 'missing') {
    return uniqueStrings([
      noteText ? `Add the required note text "${noteText}" to the ${locationHint}.` : `Add the required note for ${requirementLabel} to the ${locationHint}.`,
      `Keep the note text labeled or readable so extraction can match ${requirementLabel}.`,
    ]);
  }

  if (classification === 'low_confidence') {
    return [
      `Review the low-confidence extracted note candidate for ${requirementLabel}.`,
      'Improve the note wording or label so extraction can match it reliably.',
    ];
  }

  return uniqueStrings([
    noteText ? `Verify the required note text "${noteText}" is present and readable.` : `Verify the note text for ${requirementLabel} is present and readable.`,
    `Confirm extraction can still match the note to ${requirementLabel}.`,
  ]);
}

function viewFixSteps(requirement = {}, evidenceEntry = {}, classification = 'unknown') {
  const descriptor = normalizeDrawingViewDescriptor({
    ...requirement,
    id: requirement.view || requirement.id || evidenceEntry.requirement_id || evidenceEntry.requirement_label,
    label: requirement.label || evidenceEntry.requirement_label,
  });
  const requirementLabel = cleanText(evidenceEntry.requirement_label || descriptor.label || descriptor.id, 'required view');
  const viewName = cleanText(descriptor.label || descriptor.id, requirementLabel);
  const requiresStructuredEvidence = descriptor.view_kind === 'section' || descriptor.view_kind === 'detail';

  if (isExplicitlyUnsupportedDrawingView(requirement)) {
    return [
      `Keep ${viewName} marked unsupported until the generator and extractor can represent that view form safely.`,
      'Do not satisfy this requirement with a loose label or inferred geometry alone.',
    ];
  }

  if (classification === 'unsupported') {
    return [
      'Regenerate the layout report or SVG extraction so required view detection can run.',
      `Re-check the ${viewName} view after extracted evidence is available.`,
    ];
  }

  if (classification === 'missing') {
    return [
      `Add the required ${viewName} view to the drawing.`,
      requiresStructuredEvidence
        ? `Keep ${viewName} as a distinct labeled view region/group; a loose label alone does not satisfy ${requirementLabel}.`
        : `Label the ${viewName} view clearly so extraction can match ${requirementLabel}.`,
    ];
  }

  if (classification === 'low_confidence') {
    return [
      `Review the low-confidence extracted view candidate for ${viewName}.`,
      `Improve the ${viewName} label or layout report naming so extraction is reliable.`,
    ];
  }

  return [
    requiresStructuredEvidence
      ? `Verify ${viewName} has a distinct view region/group plus readable identity; a loose label alone is insufficient.`
      : `Verify the ${viewName} view label is present and readable.`,
    `Confirm extraction can match the ${viewName} view back to ${requirementLabel}.`,
  ];
}

function pushPlannerAction(target, seenKeys, action) {
  if (!action) return;
  const key = [
    cleanText(action.category, 'general'),
    cleanText(action.target_requirement_id, 'none'),
    cleanText(action.target_feature_id, 'none'),
    cleanText(action.classification, 'unknown'),
  ].join(':');
  if (seenKeys.has(key)) return;
  seenKeys.add(key);
  target.push(action);
}

export function buildPlannerActionsFromExtractedCoverage({
  drawingIntent = null,
  featureCatalog = null,
  planner = null,
  extractedEvidence = null,
} = {}) {
  const comparison = extractedEvidence && typeof extractedEvidence === 'object' ? extractedEvidence : {};
  const requirements = requirementLookup(drawingIntent || {});
  const actions = [];
  const seenKeys = new Set();
  const coverageStatus = cleanText(comparison.status, 'not_run');
  const coverage = comparison.coverage && typeof comparison.coverage === 'object'
    ? comparison.coverage
    : {};
  const shouldFlagUnmatchedItems = Number(coverage.total_missing || 0) > 0
    || Number(coverage.total_unknown || 0) > 0
    || Number(coverage.total_unsupported || 0) > 0;

  const requiredGroups = [
    { key: 'required_dimensions', category: 'dimension', itemType: 'dimension', steps: dimensionFixSteps },
    { key: 'required_notes', category: 'note', itemType: 'note', steps: noteFixSteps },
    { key: 'required_views', category: 'view', itemType: 'view', steps: viewFixSteps },
  ];

  for (const group of requiredGroups) {
    const entries = asArray(comparison[group.key]);
    entries.forEach((entry, index) => {
      const requirementId = cleanText(entry?.requirement_id);
      const requirement = requirements.get(requirementId) || {};
      const featureContext = requirementFeatureContext(requirement, entry, { featureCatalog, planner });
      const rawClassification = cleanText(entry?.classification, 'unknown');
      if (rawClassification === 'extracted') return;

      const classification = rawClassification === 'unknown' && asArray(entry?.candidate_matches).length > 0
        ? 'low_confidence'
        : rawClassification;
      const severity = classification === 'missing'
        ? 'advisory'
        : classification === 'unmatched'
          ? 'info'
          : 'review';
      const requirementLabel = cleanText(entry?.requirement_label || requirement.label || requirement.id || requirementId, requirementId || 'requirement');
      const title = group.itemType === 'dimension'
        ? classification === 'unsupported'
          ? `Check required dimension ${requirementLabel} after extracted drawing semantics are available.`
          : classification === 'low_confidence'
            ? `Review required dimension ${requirementLabel} because extracted evidence is low-confidence.`
            : classification === 'missing'
              ? `Add or label required dimension ${requirementLabel} if it should appear in the drawing.`
              : `Verify required dimension ${requirementLabel} because extracted evidence is unknown.`
        : group.itemType === 'note'
          ? classification === 'unsupported'
            ? `Check required note ${noteActionLabel(requirement, entry)} after extracted drawing semantics are available.`
            : `Add or label the required note ${noteActionLabel(requirement, entry)} if it should appear in the drawing.`
          : classification === 'unsupported'
            ? `Check required view ${viewActionLabel(requirement, entry)} after extracted drawing semantics are available.`
            : `Add or label the required view ${viewActionLabel(requirement, entry)} if it should appear in the drawing.`;
      const message = cleanText(entry?.reason, title);
      const recommendedFixSteps = group.steps(requirement, entry, featureContext, classification);
      const evidence = [
        actionEvidence('drawing_quality.semantic_quality.extracted_evidence', 'status', coverageStatus),
        actionEvidence(
          'drawing_quality.semantic_quality.extracted_evidence',
          `${group.key}.${requirementId || index}.classification`,
          rawClassification
        ),
      ];
      const topCandidate = asArray(entry?.candidate_matches)[0];
      if (classification === 'low_confidence' && topCandidate) {
        evidence.push(
          actionEvidence(
            'drawing_quality.semantic_quality.extracted_evidence',
            `${group.key}.${requirementId || index}.candidate_matches[0].confidence`,
            topCandidate.confidence
          )
        );
      }
      pushPlannerAction(actions, seenKeys, buildPlannerAction({
        id: `${group.category}:${actionIdPart(requirementId, group.category)}:${classification}`,
        severity,
        category: group.category,
        targetRequirementId: requirementId,
        targetFeatureId: featureContext.primary_feature_id,
        classification,
        title,
        message,
        recommendedFixSteps,
        evidence,
      }));
    });
  }

  if (shouldFlagUnmatchedItems) {
    const unmatchedDimensions = asArray(comparison.unmatched_dimensions)
      .map((entry) => cleanText(entry?.raw_text))
      .filter(Boolean);
    if (unmatchedDimensions.length > 0) {
      pushPlannerAction(actions, seenKeys, buildPlannerAction({
        id: 'mapping:unmatched-dimensions:unmatched',
        severity: 'info',
        category: 'mapping',
        targetRequirementId: 'unmatched_dimensions',
        targetFeatureId: null,
        classification: 'unmatched',
        title: 'Improve intent aliases or drawing labels for unmatched extracted dimensions.',
        message: 'Some extracted dimensions did not match any required drawing intent.',
        recommendedFixSteps: [
          'Review whether the unmatched dimensions should map to an existing required intent.',
          'If they are required, expand drawing_intent aliases or tighten drawing labels so extraction can match them reliably.',
        ],
        evidence: [
          actionEvidence('drawing_quality.semantic_quality.extracted_evidence', 'status', coverageStatus),
          actionEvidence('drawing_quality.semantic_quality.extracted_evidence', 'unmatched_dimensions.count', unmatchedDimensions.length),
          actionEvidence('drawing_quality.semantic_quality.extracted_evidence', 'unmatched_dimensions.samples', unmatchedDimensions.slice(0, 5)),
        ],
      }));
    }

    const unmatchedNotes = asArray(comparison.unmatched_notes)
      .map((entry) => cleanText(entry?.raw_text))
      .filter(Boolean);
    if (unmatchedNotes.length > 0) {
      pushPlannerAction(actions, seenKeys, buildPlannerAction({
        id: 'mapping:unmatched-notes:unmatched',
        severity: 'info',
        category: 'mapping',
        targetRequirementId: 'unmatched_notes',
        targetFeatureId: null,
        classification: 'unmatched',
        title: 'Improve intent aliases or drawing labels for unmatched extracted notes.',
        message: 'Some extracted notes did not match any required drawing intent.',
        recommendedFixSteps: [
          'Review whether the unmatched notes should satisfy an existing required note.',
          'If they are required, expand drawing_intent aliases or tighten drawing labels so extraction can match them reliably.',
        ],
        evidence: [
          actionEvidence('drawing_quality.semantic_quality.extracted_evidence', 'status', coverageStatus),
          actionEvidence('drawing_quality.semantic_quality.extracted_evidence', 'unmatched_notes.count', unmatchedNotes.length),
          actionEvidence('drawing_quality.semantic_quality.extracted_evidence', 'unmatched_notes.samples', unmatchedNotes.slice(0, 5)),
        ],
      }));
    }
  }

  return actions;
}

export function refineDrawingPlannerWithExtractedCoverage({
  planner = null,
  drawingIntent = null,
  featureCatalog = null,
  extractedEvidence = null,
} = {}) {
  const currentPlanner = planner && typeof planner === 'object' ? planner : {};
  const extractedActions = buildPlannerActionsFromExtractedCoverage({
    drawingIntent,
    featureCatalog,
    planner: currentPlanner,
    extractedEvidence,
  });

  return {
    ...currentPlanner,
    suggested_actions: uniqueStrings([
      ...asArray(currentPlanner.suggested_actions),
      ...extractedActions.map((entry) => formatPlannerSuggestedAction(entry)),
    ]),
    suggested_action_details: extractedActions,
  };
}

export function buildPlannerActionsFromLayoutReadability(layoutReadability = null) {
  const block = layoutReadability && typeof layoutReadability === 'object' ? layoutReadability : {};
  const findings = asArray(block.findings).filter((finding) => finding?.severity === 'warning');
  const actions = [];
  const seenKeys = new Set();

  findings.forEach((finding, index) => {
    const viewIds = asArray(finding.view_ids).map((entry) => cleanText(entry)).filter(Boolean);
    const localizedViewIds = viewIds.filter((entry) => entry !== 'page');
    if (
      ['text_overlap', 'dimension_overlap', 'view_crowding'].includes(cleanText(finding.type, ''))
      && localizedViewIds.length === 0
    ) {
      return;
    }
    const evidence = [
      actionEvidence('drawing_quality.layout_readability', 'status', cleanText(block.status, 'unknown')),
      actionEvidence('drawing_quality.layout_readability', `findings.${index}.type`, cleanText(finding.type, 'unknown')),
      actionEvidence('drawing_quality.layout_readability', `findings.${index}.view_ids`, viewIds),
    ];

    const rawSource = finding.raw_source && typeof finding.raw_source === 'object' ? finding.raw_source : {};
    if (cleanText(finding.source_kind)) {
      evidence.push(actionEvidence('drawing_quality.layout_readability', `findings.${index}.source_kind`, finding.source_kind));
    }
    if (cleanText(finding.evidence_state)) {
      evidence.push(actionEvidence('drawing_quality.layout_readability', `findings.${index}.evidence_state`, finding.evidence_state));
    }
    if (cleanText(finding.completeness_state)) {
      evidence.push(actionEvidence('drawing_quality.layout_readability', `findings.${index}.completeness_state`, finding.completeness_state));
    }
    if (cleanText(rawSource.path)) {
      evidence.push(actionEvidence('drawing_quality.layout_readability', `findings.${index}.raw_source.path`, rawSource.path));
    }
    if (cleanText(rawSource.method)) {
      evidence.push(actionEvidence('drawing_quality.layout_readability', `findings.${index}.raw_source.method`, rawSource.method));
    }

    pushPlannerAction(actions, seenKeys, buildPlannerAction({
      id: `layout:${actionIdPart(finding.type, 'finding')}:${actionIdPart(localizedViewIds[0] || viewIds[0], String(index + 1))}`,
      severity: 'info',
      category: 'layout',
      classification: cleanText(finding.type, 'warning'),
      title: cleanText(finding.message, 'Review advisory layout/readability evidence.'),
      message: cleanText(finding.message, 'Structured layout/readability evidence needs review.'),
      recommendedFixSteps: [
        cleanText(finding.recommendation, 'Review advisory layout/readability evidence and adjust the drawing if the structured finding is valid.'),
      ],
      evidence,
    }));
  });

  return actions;
}

export function refineDrawingPlannerWithLayoutReadability({
  planner = null,
  layoutReadability = null,
} = {}) {
  const currentPlanner = planner && typeof planner === 'object' ? planner : {};
  const layoutActions = buildPlannerActionsFromLayoutReadability(layoutReadability);
  const existingDetails = asArray(currentPlanner.suggested_action_details);

  return {
    ...currentPlanner,
    suggested_actions: uniqueStrings([
      ...asArray(currentPlanner.suggested_actions),
      ...layoutActions.map((entry) => formatPlannerSuggestedAction(entry)),
    ]),
    suggested_action_details: [
      ...existingDetails,
      ...layoutActions.filter((entry) => !existingDetails.some((existing) => existing?.id === entry.id)),
    ],
  };
}

export function buildPlannerActionsFromReviewerFeedback(reviewerFeedback = null) {
  const block = reviewerFeedback && typeof reviewerFeedback === 'object' ? reviewerFeedback : {};
  const actions = [];
  const seenKeys = new Set();

  asArray(block.items).forEach((item, index) => {
    if (item?.resolution_state !== 'unresolved') return;
    if (!['linked', 'unmatched', 'stale', 'orphaned'].includes(cleanText(item?.link_status, ''))) return;

    const feedbackId = cleanText(item?.id, `reviewer_feedback_${index + 1}`);
    const targetId = cleanText(item?.target_id);
    const targetType = cleanText(item?.target_type, 'reviewer feedback target');
    const requestedAction = cleanText(item?.requested_action);
    const evidence = [
      actionEvidence('drawing_quality.reviewer_feedback', `items.${index}.status`, cleanText(item?.status, 'open')),
      actionEvidence('drawing_quality.reviewer_feedback', `items.${index}.link_status`, cleanText(item?.link_status, 'unmatched')),
      actionEvidence('drawing_quality.reviewer_feedback', `items.${index}.target_type`, targetType),
    ];
    if (targetId) {
      evidence.push(actionEvidence('drawing_quality.reviewer_feedback', `items.${index}.target_id`, targetId));
    }

    const linkStatus = cleanText(item?.link_status, 'unmatched');
    const recommendedFixSteps = uniqueStrings([
      requestedAction,
      linkStatus === 'linked'
        ? `Review the linked ${targetType}${targetId ? ` ${targetId}` : ''} evidence and resolve reviewer feedback ${feedbackId} after confirming the current drawing output.`
        : null,
      linkStatus === 'unmatched'
        ? `Confirm whether reviewer feedback ${feedbackId} should map to an existing evidence target before changing the drawing.`
        : null,
      (linkStatus === 'stale' || linkStatus === 'orphaned')
        ? `Verify whether the referenced evidence or artifact changed after reviewer feedback ${feedbackId} was recorded.`
        : null,
    ]);

    pushPlannerAction(actions, seenKeys, buildPlannerAction({
      id: `reviewer-feedback:${actionIdPart(feedbackId, String(index + 1))}:${actionIdPart(linkStatus, 'open')}`,
      severity: item?.severity === 'info' ? 'info' : 'review',
      category: 'reviewer_feedback',
      targetRequirementId: targetType.startsWith('required_') ? targetId : null,
      targetFeatureId: null,
      classification: linkStatus,
      title: targetId
        ? `Follow up reviewer feedback ${feedbackId} for ${targetId}.`
        : `Follow up reviewer feedback ${feedbackId}.`,
      message: cleanText(item?.comment, 'Reviewer feedback remains open and advisory-only.'),
      recommendedFixSteps,
      evidence,
    }));
  });

  return actions;
}

export function refineDrawingPlannerWithReviewerFeedback({
  planner = null,
  reviewerFeedback = null,
} = {}) {
  const currentPlanner = planner && typeof planner === 'object' ? planner : {};
  const feedbackActions = buildPlannerActionsFromReviewerFeedback(reviewerFeedback);
  const existingDetails = asArray(currentPlanner.suggested_action_details);

  return {
    ...currentPlanner,
    suggested_actions: uniqueStrings([
      ...asArray(currentPlanner.suggested_actions),
      ...feedbackActions.map((entry) => formatPlannerSuggestedAction(entry)),
    ]),
    suggested_action_details: [
      ...existingDetails,
      ...feedbackActions.filter((entry) => !existingDetails.some((existing) => existing?.id === entry.id)),
    ],
  };
}

export function buildDrawingPlanner({
  config = {},
  drawingIntent = null,
  featureCatalog = null,
  traceability = null,
  dimensionMap = null,
  artifactRefs = {},
} = {}) {
  const catalog = normalizeFeatureCatalog({
    featureCatalog,
    traceability,
    config,
  });
  const intent = drawingIntent || config?.drawing_plan || {};
  const dimensions = collectIntentDimensions(intent, dimensionMap || {});
  const recommendedViews = buildViewRecommendations(config, catalog.features, drawingIntent || {});
  const dimensionPlan = buildDimensions(catalog.features, dimensions);
  const annotations = buildAnnotations(config, catalog.features);
  const { section, detail } = buildSectionAndDetailViews(catalog.features);

  const suggestedActions = uniqueStrings([
    ...recommendedViews.filter((entry) => entry.status === 'recommended').map((entry) => entry.suggested_fix),
    ...dimensionPlan.missing.map((entry) => entry.suggested_fix),
    ...annotations.map((entry) => entry.suggested_fix),
    ...section.map((entry) => entry.suggested_fix),
    ...detail.map((entry) => entry.suggested_fix),
  ]);
  const scores = [
    ...recommendedViews,
    ...dimensionPlan.required,
    ...dimensionPlan.missing,
    ...annotations,
    ...section,
    ...detail,
  ].map((entry) => entry.confidence?.score).filter(Number.isFinite);
  const averageScore = scores.length
    ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2))
    : 0.5;

  return {
    schema_version: DRAWING_PLANNER_SCHEMA_VERSION,
    planner_type: 'drawing_view_dimension_advisory',
    status: 'advisory',
    generated_from: {
      drawing_intent: Boolean(intent && Object.keys(intent).length > 0),
      feature_catalog: catalog.features.length > 0,
      artifact_refs: Object.fromEntries(
        Object.entries(artifactRefs || {}).filter(([, value]) => typeof value === 'string' && value.trim())
      ),
    },
    recommended_views: recommendedViews,
    required_dimensions_by_feature: dimensionPlan.required,
    missing_dimensions: dimensionPlan.missing,
    recommended_annotations: annotations,
    section_view_recommendations: section,
    detail_view_recommendations: detail,
    suggested_actions: suggestedActions,
    evidence: catalog.evidence,
    confidence: makeConfidence(
      averageScore,
      'Aggregate confidence from deterministic feature and drawing-intent evidence; recommendations remain advisory.'
    ),
    limitations: [
      'Planner recommendations are advisory and do not replace TechDraw generation.',
      'No GD&T or tolerance callout is inferred unless explicitly present in drawing metadata.',
      'Functional requirements are not inferred beyond drawing_intent and reliable feature evidence.',
    ],
  };
}

export async function writeDrawingPlanner(plannerPath, planner) {
  const resolvedPath = resolve(plannerPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(planner, null, 2)}\n`, 'utf8');
  return resolvedPath;
}
