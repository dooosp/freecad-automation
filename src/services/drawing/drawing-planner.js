import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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

function buildViewRecommendations(config, features) {
  const existingViews = uniqueStrings([
    ...asArray(config?.drawing_plan?.views?.enabled),
    ...asArray(config?.drawing?.views),
  ]);
  const hasBody = features.some((feature) => feature.type === 'plate' || feature.type === 'body');
  const hasHoles = features.some((feature) => feature.type === 'through_hole' || feature.type === 'hole');
  const hasBracket = config?.drawing_plan?.part_type === 'bracket'
    || asArray(config.operations).some((operation) => operation?.op === 'fuse');
  const views = [];
  const addView = (view, reason, refs, score = 0.78) => {
    views.push(recommendation({
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
  const recommendedViews = buildViewRecommendations(config, catalog.features);
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
