function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

export function getPartIdentity(config = {}) {
  const product = config.product || {};
  const drawingMeta = config.drawing?.meta || {};

  return {
    name: firstDefined(config.name, drawingMeta.part_name, 'unnamed_part'),
    revision: firstDefined(product.revision, config.part?.revision, drawingMeta.revision, 'A'),
    material: firstDefined(config.manufacturing?.material, config.material, drawingMeta.material, 'SS304'),
    process: firstDefined(config.manufacturing?.process, config.process, config.part?.process, 'machining'),
    product_family: firstDefined(product.family, product.product_family, 'generic_component'),
    module_type: firstDefined(product.module_type, product.module, product.name, config.name, 'generic_component'),
    vehicle_program: firstDefined(product.vehicle_program, product.program, 'unspecified_program'),
    production_sites: ensureArray(config.production?.sites),
  };
}

export function extractFeatureCounts(config = {}) {
  const shapes = ensureArray(config.shapes);
  const operations = ensureArray(config.operations);
  const cutTools = new Set(
    operations
      .filter((operation) => operation?.op === 'cut')
      .map((operation) => operation.tool)
      .filter(Boolean)
  );

  const cylinders = shapes.filter((shape) => shape?.type === 'cylinder');
  const holes = cylinders.filter((shape) => cutTools.has(shape.id));
  const boxes = shapes.filter((shape) => shape?.type === 'box');

  return {
    shapes: shapes.length,
    boxes: boxes.length,
    cylinders: cylinders.length,
    holes: holes.length,
    cut_ops: operations.filter((operation) => operation?.op === 'cut').length,
    fuse_ops: operations.filter((operation) => operation?.op === 'fuse').length,
    fillet_ops: operations.filter((operation) => operation?.op === 'fillet').length,
    chamfer_ops: operations.filter((operation) => operation?.op === 'chamfer').length,
  };
}

export function estimateEnvelopeMm(config = {}) {
  const shapes = ensureArray(config.shapes);
  let maxX = 0;
  let maxY = 0;
  let maxZ = 0;

  for (const shape of shapes) {
    const position = Array.isArray(shape?.position) ? shape.position : [0, 0, 0];
    const x = Number(position[0] || 0);
    const y = Number(position[1] || 0);
    const z = Number(position[2] || 0);

    if (shape?.type === 'box') {
      const length = Number(shape.length || shape.size?.[0] || 0);
      const width = Number(shape.width || shape.depth || shape.size?.[1] || 0);
      const height = Number(shape.height || shape.size?.[2] || 0);
      maxX = Math.max(maxX, x + length);
      maxY = Math.max(maxY, y + width);
      maxZ = Math.max(maxZ, z + height);
    } else if (shape?.type === 'cylinder') {
      const radius = Number(shape.radius || 0);
      const height = Number(shape.height || 0);
      maxX = Math.max(maxX, x + radius * 2);
      maxY = Math.max(maxY, y + radius * 2);
      maxZ = Math.max(maxZ, z + height);
    }
  }

  return {
    length: Number(maxX.toFixed(1)),
    width: Number(maxY.toFixed(1)),
    height: Number(maxZ.toFixed(1)),
  };
}

export function extractThinWallCandidates(config = {}) {
  return ensureArray(config.shapes)
    .filter((shape) => shape?.type === 'box')
    .map((shape) => ({
      id: shape.id || 'box',
      thickness_mm: Math.min(
        Number(shape.length || shape.size?.[0] || 999),
        Number(shape.width || shape.depth || shape.size?.[1] || 999),
        Number(shape.height || shape.size?.[2] || 999)
      ),
    }))
    .filter((entry) => Number.isFinite(entry.thickness_mm));
}

export function extractCriticalDimensions(config = {}) {
  const qualityDims = ensureArray(config.quality?.critical_dimensions).map((item, index) => ({
    id: item.id || `critical-dimension-${index + 1}`,
    name: item.name || item.feature || `critical_dimension_${index + 1}`,
    target_mm: firstDefined(item.target_mm, item.nominal_mm, item.value_mm, null),
    tolerance: firstDefined(item.tolerance, item.tolerance_grade, item.spec, null),
    rationale: firstDefined(item.rationale, item.reason, 'manufacturing_control'),
  }));

  const drawingDims = ensureArray(config.drawing?.feature_tolerances).map((item, index) => ({
    id: item.feature_id || `feature-tolerance-${index + 1}`,
    name: item.feature_id || `feature_tolerance_${index + 1}`,
    target_mm: firstDefined(item.value, item.value_mm, null),
    tolerance: firstDefined(item.tolerance_grade, item.tolerance, null),
    rationale: 'drawing_feature_tolerance',
  }));

  const merged = [...qualityDims, ...drawingDims];
  const seen = new Set();
  return merged.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function extractQualityGates(config = {}) {
  const gates = ensureArray(config.quality?.gates);
  if (gates.length > 0) {
    return gates.map((gate, index) => ({
      gate_id: gate.gate_id || `QG-${index + 1}`,
      name: gate.name || gate.stage || `quality_gate_${index + 1}`,
      objective: gate.objective || gate.check || 'process confirmation',
      evidence: ensureArray(gate.evidence),
    }));
  }

  return [
    {
      gate_id: 'QG-1',
      name: 'Incoming Material Verification',
      objective: 'Confirm supplier lot and revision alignment before launch.',
      evidence: ['material cert', 'lot trace'],
    },
    {
      gate_id: 'QG-2',
      name: 'In-Process Dimensional Check',
      objective: 'Control mounting pattern, wall thickness, and connector keep-out.',
      evidence: ['first article', 'vision or gauge result'],
    },
    {
      gate_id: 'QG-3',
      name: 'Final Release',
      objective: 'Verify cosmetic, fastening, and serialization readiness.',
      evidence: ['final inspection', 'traceability record'],
    },
  ];
}

export function normalizeSeverity(level) {
  if (level === 'error' || level === 'high' || level === 'critical') return 'high';
  if (level === 'warning' || level === 'medium') return 'medium';
  return 'low';
}

export function severityWeight(level) {
  if (level === 'high') return 14;
  if (level === 'medium') return 6;
  return 2;
}

export function toReadinessStatus(score) {
  if (score >= 80) return 'ready_with_standard_controls';
  if (score >= 65) return 'pilot_line_planning_ready';
  if (score >= 50) return 'needs_risk_reduction';
  return 'hold_for_design_or_process_rework';
}

export function buildAssumptionNotes(config = {}) {
  const notes = [];
  if (config.product?.vehicle_program) {
    notes.push(`Program context: ${config.product.vehicle_program}`);
  }
  if (config.production?.sites?.length) {
    notes.push(`Cross-site rollout scope: ${config.production.sites.join(', ')}`);
  }
  if (config.production?.annual_volume) {
    notes.push(`Annual volume assumption: ${config.production.annual_volume}`);
  }
  if (config.production?.target_ct_sec) {
    notes.push(`Target cycle time assumption: ${config.production.target_ct_sec}s`);
  }
  if (config.product?.decision_scope) {
    notes.push(`Decision scope: ${config.product.decision_scope}`);
  }
  return notes;
}

export function buildDefaultAutomationCandidates(config = {}, featureCounts = extractFeatureCounts(config)) {
  const configured = ensureArray(config.production?.automation_candidates);
  if (configured.length > 0) {
    return configured;
  }

  const candidates = [];
  if (featureCounts.holes >= 4) candidates.push('vision-assisted hole pattern verification');
  if (featureCounts.cut_ops >= 3) candidates.push('automated deburr / cleaning transfer');
  if (extractCriticalDimensions(config).length >= 2) candidates.push('inline critical-dimension gauging');
  return candidates;
}

export function summarizeDfmChecks(dfmResult = {}) {
  return ensureArray(dfmResult.checks).map((check, index) => ({
    id: `${check.code || 'DFM'}-${index + 1}`,
    category: 'dfm',
    severity: normalizeSeverity(check.severity),
    title: check.message || check.code || 'DFM finding',
    recommendation: check.recommendation || 'Review feature with manufacturing engineering team.',
    source: check.code || 'dfm_checker',
  }));
}

export function getProductionTargets(config = {}) {
  return {
    batch_size: Number(config.batch_size || config.production?.pilot_lot || 1),
    annual_volume: Number(config.production?.annual_volume || 0),
    target_ct_sec: Number(config.production?.target_ct_sec || 0),
    automation_mode: firstDefined(config.production?.automation_mode, config.line?.automation_mode, 'hybrid'),
    launch_sites: ensureArray(config.production?.sites),
  };
}

export function countItemsBySeverity(items = []) {
  return ensureArray(items).reduce((accumulator, item) => {
    const severity = normalizeSeverity(item?.severity);
    accumulator[severity] = (accumulator[severity] || 0) + 1;
    return accumulator;
  }, { high: 0, medium: 0, low: 0 });
}

export function deriveOverallRiskLevel(items = []) {
  const counts = countItemsBySeverity(items);
  const weighted = counts.high * 3 + counts.medium * 2 + counts.low;
  if (counts.high >= 2 || weighted >= 8) return 'high';
  if (counts.high >= 1 || counts.medium >= 2 || weighted >= 4) return 'medium';
  return 'low';
}

export function topIssueTitles(items = [], limit = 3) {
  return ensureArray(items)
    .slice()
    .sort((left, right) => severityWeight(normalizeSeverity(right?.severity)) - severityWeight(normalizeSeverity(left?.severity)))
    .slice(0, limit)
    .map((item) => item.title || item.name || item.checkpoint || String(item));
}

export function summarizeActions(actions = [], limit = 4) {
  return [...new Set(ensureArray(actions).filter(Boolean))].slice(0, limit);
}

export function extractFunctionalTestPoints(config = {}) {
  return ensureArray(config.quality?.functional_test_points).map((point, index) => ({
    id: point.id || `ftp-${index + 1}`,
    name: point.name || point.check || point.objective || `functional_test_point_${index + 1}`,
    location: firstDefined(point.location, point.location_hint, point.area, 'line_end'),
    rationale: firstDefined(point.rationale, point.reason, 'functional confirmation'),
  }));
}

export function traceabilityLabelArea(config = {}) {
  return firstDefined(
    config.quality?.traceability?.label_area,
    config.product?.traceability_label_area,
    'define label area during detailed line design'
  );
}

export function connectorClearanceMm(config = {}) {
  return Number(
    config.product?.connector_clearance_mm
    || config.product?.connector?.clearance_mm
    || 0
  );
}

export function fasteningStrategy(config = {}) {
  return firstDefined(
    config.product?.fastening_strategy,
    config.assembly?.fastening_strategy,
    'manual fastening review required'
  );
}
