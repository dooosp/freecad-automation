const SUPPORTED_KINDS = new Set([
  'extracted_drawing_semantics',
  'create_quality',
  'drawing_quality',
  'drawing_qa',
  'dfm',
  'quality_risk',
  'evidence_graph',
]);

const MAX_DEPTH = 32;
const MAX_NODES = 20_000;
const MAX_ARRAY_ITEMS = 4_096;
const MAX_OBJECT_KEYS = 512;
const MAX_STRING_LENGTH = 65_536;
const MAX_ERRORS = 64;

const UNSTABLE_SOURCE_ID = /^source:\d+(?::|$)/;
const UNSTABLE_SOURCE_REFERENCE = /source:\d+(?::|$)/;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function text(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value) {
  return JSON.stringify(value);
}

function compareCanonical(left, right) {
  return compareCodePoints(stableJson(left), stableJson(right));
}

function uniqueCanonical(values) {
  const byJson = new Map();
  for (const value of values) byJson.set(stableJson(value), value);
  return [...byJson.entries()]
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([, value]) => value);
}

function pushError(errors, message) {
  if (errors.length < MAX_ERRORS && !errors.includes(message)) errors.push(message);
}

function validateJsonBounds(document) {
  const errors = [];
  const seen = new WeakSet();
  const stack = [{ value: document, path: '$', depth: 0 }];
  let nodes = 0;

  while (stack.length > 0 && errors.length < MAX_ERRORS) {
    const { value, path, depth } = stack.pop();
    nodes += 1;
    if (nodes > MAX_NODES) {
      pushError(errors, `artifact exceeds the ${MAX_NODES} node limit`);
      break;
    }
    if (depth > MAX_DEPTH) {
      pushError(errors, `${path} exceeds the maximum depth of ${MAX_DEPTH}`);
      continue;
    }
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) pushError(errors, `${path} must be a finite number`);
      continue;
    }
    if (typeof value === 'string') {
      if (value.length > MAX_STRING_LENGTH) {
        pushError(errors, `${path} exceeds the ${MAX_STRING_LENGTH} character limit`);
      }
      continue;
    }
    if (typeof value !== 'object') {
      pushError(errors, `${path} contains a non-JSON value`);
      continue;
    }
    if (seen.has(value)) {
      pushError(errors, `${path} contains a cyclic or shared object reference`);
      continue;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ITEMS) {
        pushError(errors, `${path} exceeds the ${MAX_ARRAY_ITEMS} item array limit`);
        continue;
      }
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], path: `${path}[${index}]`, depth: depth + 1 });
      }
      continue;
    }

    if (!isPlainObject(value)) {
      pushError(errors, `${path} must contain only plain JSON objects`);
      continue;
    }
    const keys = Object.keys(value).sort(compareCodePoints);
    if (keys.length > MAX_OBJECT_KEYS) {
      pushError(errors, `${path} exceeds the ${MAX_OBJECT_KEYS} key object limit`);
      continue;
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      stack.push({ value: value[key], path: `${path}.${key}`, depth: depth + 1 });
    }
  }
  return errors.sort(compareCodePoints);
}

function shouldExcludeKey(key) {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  if (/^(?:generated|created|updated|inspected)_at$/.test(normalized)) return true;
  if (normalized === 'timestamp' || normalized.endsWith('_timestamp')) return true;
  if (normalized === 'file' || normalized === 'path') return true;
  if (normalized.endsWith('_file') || normalized.endsWith('_path')) return true;
  if (normalized === 'source_ref' || normalized === 'source_reference') return true;
  if (normalized.endsWith('_source_field') || normalized === 'source_field') return true;
  if (normalized === 'expected_source_field' || normalized === 'report_field') return true;
  if (normalized === 'raw_text' || normalized === 'matched_raw_text') return true;
  if (normalized === 'source_text' || normalized === 'raw_source_text') return true;
  if (/(?:^|_)face_(?:index|indices)$/.test(normalized)) return true;
  if (normalized === 'matched_face_index' || normalized === 'host_diagnostics') return true;
  if (normalized === 'runtime_path' || normalized === 'output_path' || normalized === 'temporary_path') return true;
  return false;
}

function sanitizeSemanticValue(value, { omit = new Set(), sortArrays = false } = {}) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => sanitizeSemanticValue(entry, { omit, sortArrays }));
    return sortArrays ? normalized.sort(compareCanonical) : normalized;
  }
  if (!isPlainObject(value)) return null;
  const normalized = {};
  for (const key of Object.keys(value).sort(compareCodePoints)) {
    if (omit.has(key) || shouldExcludeKey(key)) continue;
    normalized[key] = sanitizeSemanticValue(value[key], { omit, sortArrays });
  }
  return normalized;
}

function pickSemanticFields(value, fields, { sortArrays = false } = {}) {
  const picked = {};
  if (!isPlainObject(value)) return picked;
  for (const key of fields) {
    if (value[key] !== undefined && !shouldExcludeKey(key)) picked[key] = value[key];
  }
  return sanitizeSemanticValue(picked, { sortArrays });
}

function requireObject(errors, value, path) {
  if (!isPlainObject(value)) pushError(errors, `${path} must be an object`);
}

function requireArray(errors, value, path) {
  if (!Array.isArray(value)) pushError(errors, `${path} must be an array`);
}

function validateOptionalArray(errors, value, path) {
  if (value !== undefined && !Array.isArray(value)) pushError(errors, `${path} must be an array when present`);
}

function validateObjectItems(errors, values, path) {
  if (!Array.isArray(values)) return;
  values.forEach((value, index) => {
    if (!isPlainObject(value)) pushError(errors, `${path}[${index}] must be an object`);
  });
}

function validateOptionalId(errors, item, fields, path) {
  if (!isPlainObject(item)) return;
  for (const field of fields) {
    if (item[field] !== undefined && item[field] !== null && !text(item[field])) {
      pushError(errors, `${path}.${field} must be a non-empty string or null`);
    }
  }
}

function firstId(item, fields) {
  for (const field of fields) {
    const value = text(item?.[field]);
    if (value) return value;
  }
  return null;
}

function validateUniqueIds(errors, values, path, identity) {
  if (!Array.isArray(values)) return;
  const seen = new Set();
  values.forEach((value, index) => {
    if (!isPlainObject(value)) return;
    validateOptionalId(errors, value, identity.fields || [], `${path}[${index}]`);
    const id = identity(value);
    if (!id) return;
    if (seen.has(id)) pushError(errors, `${path} contains duplicate stable ID "${id}"`);
    seen.add(id);
  });
}

function requireStatus(errors, document, path = '$.status') {
  if (!text(document?.status)) pushError(errors, `${path} must be a non-empty string`);
}

function validateExtractedDrawingSemantics(document, errors) {
  requireStatus(errors, document);
  for (const key of ['views', 'dimensions', 'notes']) {
    requireArray(errors, document[key], `$.${key}`);
    validateObjectItems(errors, document[key], `$.${key}`);
    if (Array.isArray(document[key])) {
      document[key].forEach((item, index) => {
        validateOptionalId(errors, item, ['matched_intent_id'], `$.${key}[${index}]`);
        validateOptionalId(errors, item, ['matched_feature_id'], `$.${key}[${index}]`);
      });
    }
  }
}

function validateCreateQuality(document, errors) {
  requireStatus(errors, document);
  const coreKeys = ['geometry', 'step_roundtrip', 'brep_roundtrip', 'stl_quality', 'engineering_quality'];
  if (!coreKeys.some((key) => isPlainObject(document[key]))) {
    pushError(errors, '$ must include create-quality geometry, round-trip, mesh, or engineering-quality data');
  }
  if (document.engineering_quality !== undefined) {
    requireObject(errors, document.engineering_quality, '$.engineering_quality');
    if (isPlainObject(document.engineering_quality)) {
      requireArray(errors, document.engineering_quality.measurements, '$.engineering_quality.measurements');
      validateObjectItems(errors, document.engineering_quality.measurements, '$.engineering_quality.measurements');
      document.engineering_quality.measurements?.forEach((item, index) => {
        validateOptionalId(errors, item, ['requirement_id', 'source_requirement_id', 'feature_id'], `$.engineering_quality.measurements[${index}]`);
      });
    }
  }
}

const DRAWING_REQUIREMENT_ARRAY_PATHS = [
  ['requirements'],
  ['dimensions', 'requirements'],
  ['semantic_quality', 'requirements'],
  ['semantic_quality', 'traceability', 'rows'],
  ['semantic_quality', 'suggested_action_details'],
  ['semantic_quality', 'extracted_evidence', 'required_dimensions'],
  ['semantic_quality', 'extracted_evidence', 'required_notes'],
  ['semantic_quality', 'extracted_evidence', 'required_views'],
  ['semantic_quality', 'extracted_evidence', 'required_dimension_classifications'],
  ['semantic_quality', 'extracted_evidence', 'required_note_classifications'],
  ['semantic_quality', 'extracted_evidence', 'required_view_classifications'],
  ['extracted_evidence', 'required_dimensions'],
  ['extracted_evidence', 'required_notes'],
  ['extracted_evidence', 'required_views'],
  ['extracted_evidence', 'required_dimension_classifications'],
  ['extracted_evidence', 'required_note_classifications'],
  ['extracted_evidence', 'required_view_classifications'],
];

function valueAtPath(document, path) {
  let value = document;
  for (const key of path) value = value?.[key];
  return value;
}

function validateDrawingQuality(document, errors) {
  requireStatus(errors, document);
  requireObject(errors, document.views, '$.views');
  requireObject(errors, document.dimensions, '$.dimensions');
  requireObject(errors, document.traceability, '$.traceability');
  if (!Array.isArray(document.blocking_issues) && !Array.isArray(document.blocking_issue_codes)) {
    pushError(errors, '$ must include blocking_issues or blocking_issue_codes');
  }
  if (document.score !== undefined && document.score !== null && !Number.isFinite(document.score)) {
    pushError(errors, '$.score must be a finite number or null');
  }
  for (const [path, values] of [
    ['$.blocking_issues', document.blocking_issues],
    ['$.issues', document.issues],
    ['$.semantic_quality.issues', document.semantic_quality?.issues],
  ]) {
    validateOptionalArray(errors, values, path);
    validateObjectItems(errors, values, path);
    const identity = (item) => firstId(item, ['issue_id', 'id', 'code']);
    identity.fields = ['issue_id', 'id', 'code'];
    validateUniqueIds(errors, values, path, identity);
  }
  for (const pathParts of DRAWING_REQUIREMENT_ARRAY_PATHS) {
    const values = valueAtPath(document, pathParts);
    const path = `$.${pathParts.join('.')}`;
    validateOptionalArray(errors, values, path);
    validateObjectItems(errors, values, path);
    const identity = (item) => firstId(item, ['requirement_id', 'dimension_id', 'target_requirement_id']);
    identity.fields = ['requirement_id', 'dimension_id', 'target_requirement_id'];
    validateUniqueIds(errors, values, path, identity);
  }
}

function validateDrawingQa(document, errors) {
  if (!Number.isFinite(document.score)) pushError(errors, '$.score must be a finite number');
  requireObject(errors, document.metrics, '$.metrics');
  if (document.deductions !== undefined) requireObject(errors, document.deductions, '$.deductions');
  if (document.details !== undefined) requireObject(errors, document.details, '$.details');
  if (document.status !== undefined && !text(document.status)) {
    pushError(errors, '$.status must be a non-empty string when present');
  }
}

function validateDfm(document, errors) {
  if (!Number.isFinite(document.score)) pushError(errors, '$.score must be a finite number');
  requireObject(errors, document.summary, '$.summary');
  if (!Array.isArray(document.checks) && !Array.isArray(document.issues)) {
    pushError(errors, '$ must include checks or issues');
  }
  for (const [path, values] of [['$.checks', document.checks], ['$.issues', document.issues]]) {
    validateOptionalArray(errors, values, path);
    validateObjectItems(errors, values, path);
    if (!Array.isArray(values)) continue;
    values.forEach((item, index) => {
      validateOptionalId(errors, item, ['rule_id'], `${path}[${index}]`);
      validateOptionalId(errors, item, ['feature_id'], `${path}[${index}]`);
    });
    const identity = (item) => {
      const ruleId = text(item?.rule_id);
      return ruleId ? `${ruleId}|${text(item.feature_id) || 'global'}` : null;
    };
    validateUniqueIds(errors, values, path, identity);
  }
}

const QUALITY_RISK_COLLECTIONS = [
  { key: 'quality_gates', fields: ['gate_id', 'id'] },
  { key: 'quality_risks', fields: ['risk_id', 'id'] },
  { key: 'critical_dimensions', fields: ['critical_id', 'characteristic_id', 'id'] },
  { key: 'inspection_required_points', fields: ['inspection_id', 'checkpoint_id', 'id'] },
];

function validateQualityRisk(document, errors) {
  requireObject(errors, document.summary, '$.summary');
  requireArray(errors, document.quality_gates, '$.quality_gates');
  requireArray(errors, document.quality_risks, '$.quality_risks');
  for (const { key, fields } of QUALITY_RISK_COLLECTIONS) {
    const values = document[key];
    validateOptionalArray(errors, values, `$.${key}`);
    validateObjectItems(errors, values, `$.${key}`);
    if (Array.isArray(values)) {
      values.forEach((item, index) => validateOptionalId(errors, item, fields, `$.${key}[${index}]`));
    }
    const identity = (item) => firstId(item, fields);
    identity.fields = fields;
    validateUniqueIds(errors, values, `$.${key}`, identity);
  }
}

function graphNodeId(node) {
  return text(node?.id);
}

function graphEdgeParts(edge) {
  return {
    source: text(edge?.source) || text(edge?.from),
    target: text(edge?.target) || text(edge?.to),
    relationship: text(edge?.relationship) || text(edge?.kind),
  };
}

function graphEdgeId(edge) {
  const explicit = text(edge?.id);
  if (explicit) return explicit;
  const { source, target, relationship } = graphEdgeParts(edge);
  return source && target && relationship ? `${source}->${target}:${relationship}` : null;
}

function validateEvidenceGraph(document, errors) {
  requireObject(errors, document.summary, '$.summary');
  requireArray(errors, document.nodes, '$.nodes');
  requireArray(errors, document.edges, '$.edges');
  if (!text(document.package_id) && !text(document.package_slug) && !isPlainObject(document.part)) {
    pushError(errors, '$ must include package_id, package_slug, or part identity');
  }
  validateObjectItems(errors, document.nodes, '$.nodes');
  validateObjectItems(errors, document.edges, '$.edges');
  if (Array.isArray(document.nodes)) {
    document.nodes.forEach((node, index) => validateOptionalId(errors, node, ['id'], `$.nodes[${index}]`));
    validateUniqueIds(errors, document.nodes, '$.nodes', graphNodeId);
  }
  if (Array.isArray(document.edges)) {
    document.edges.forEach((edge, index) => {
      validateOptionalId(errors, edge, ['id'], `$.edges[${index}]`);
      const { source, target, relationship } = graphEdgeParts(edge);
      if (!source || !target || !relationship) {
        pushError(errors, `$.edges[${index}] must include stable endpoints and a relationship`);
      }
    });
    validateUniqueIds(errors, document.edges, '$.edges', graphEdgeId);
  }
}

export function validateRevisionImpactSemanticArtifact(kind, document) {
  const errors = [];
  if (!SUPPORTED_KINDS.has(kind)) {
    return { ok: false, errors: [`unsupported semantic artifact kind: ${String(kind)}`] };
  }
  errors.push(...validateJsonBounds(document));
  if (!isPlainObject(document)) {
    pushError(errors, '$ must be an object');
    return { ok: false, errors: errors.sort(compareCodePoints) };
  }

  if (kind === 'extracted_drawing_semantics') validateExtractedDrawingSemantics(document, errors);
  if (kind === 'create_quality') validateCreateQuality(document, errors);
  if (kind === 'drawing_quality') validateDrawingQuality(document, errors);
  if (kind === 'drawing_qa') validateDrawingQa(document, errors);
  if (kind === 'dfm') validateDfm(document, errors);
  if (kind === 'quality_risk') validateQualityRisk(document, errors);
  if (kind === 'evidence_graph') validateEvidenceGraph(document, errors);

  const normalizedErrors = [...new Set(errors)].sort(compareCodePoints);
  return { ok: normalizedErrors.length === 0, errors: normalizedErrors };
}

function assertBoundedDocument(kind, document) {
  if (!SUPPORTED_KINDS.has(kind)) throw new TypeError(`Unsupported semantic artifact kind: ${String(kind)}`);
  const errors = validateJsonBounds(document);
  if (!isPlainObject(document)) errors.push('$ must be an object');
  if (errors.length > 0) throw new TypeError(`Cannot collect unbounded semantic artifact: ${errors.join(' | ')}`);
}

function unmappedRecord(kind, reason, value, extra = {}) {
  return sanitizeSemanticValue({ kind, reason, ...extra, value }, { sortArrays: true });
}

function finalize(records, unmapped) {
  return {
    records: records.sort((left, right) => compareCodePoints(left.id, right.id)),
    unmapped: unmapped.sort(compareCanonical),
  };
}

function finalizeDistinctCandidates(candidates, unmapped) {
  const byId = new Map();
  for (const candidate of candidates) {
    const entries = byId.get(candidate.id) || [];
    entries.push(candidate);
    byId.set(candidate.id, entries);
  }
  const records = [];
  for (const [id, entries] of [...byId.entries()].sort(([left], [right]) => compareCodePoints(left, right))) {
    if (entries.length === 1) {
      records.push(entries[0]);
      continue;
    }
    unmapped.push(unmappedRecord(
      entries[0].kind || 'semantic_record',
      'duplicate_stable_id',
      uniqueCanonical(entries.map((entry) => entry.value)),
      { rejectedId: id }
    ));
  }
  return finalize(records.map(({ kind: _kind, ...record }) => record), unmapped);
}

function finiteOrNull(value) {
  if (!Number.isFinite(value)) return null;
  return Object.is(value, -0) ? 0 : value;
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function arrayCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function allowlistedText(value, allowed) {
  const normalized = text(value);
  return normalized && allowed.has(normalized) ? normalized : null;
}

function finiteVectorOrNull(value, length) {
  if (!Array.isArray(value) || value.length !== length || value.some((entry) => !Number.isFinite(entry))) {
    return null;
  }
  return value.map((entry) => finiteOrNull(entry));
}

function bboxSummary(value, { includeMaxAbs = false } = {}) {
  if (!isPlainObject(value)) return null;
  return {
    min: finiteVectorOrNull(value.min, 3),
    max: finiteVectorOrNull(value.max, 3),
    size: finiteVectorOrNull(value.size, 3),
    ...(includeMaxAbs ? { max_abs_mm: finiteOrNull(value.max_abs_mm) } : {}),
  };
}

function geometryResultSummary(value) {
  const geometry = isPlainObject(value) ? value : {};
  return {
    valid_shape: booleanOrNull(geometry.valid_shape),
    volume: finiteOrNull(geometry.volume),
    area: finiteOrNull(geometry.area),
    bbox: bboxSummary(geometry.bbox),
    solid_count: finiteOrNull(geometry.solid_count),
    face_count: finiteOrNull(geometry.face_count),
    edge_count: finiteOrNull(geometry.edge_count),
  };
}

const CREATE_RESULT_STATUSES = new Set(['pass', 'warning', 'fail', 'skipped']);
const CREATE_MEASUREMENT_STATUSES = new Set(['pass', 'fail', 'missing', 'unavailable']);
const CREATE_MEASUREMENT_SOURCES = new Set([
  'generated_shape_geometry',
  'reimported_step_geometry',
  'stl_mesh_geometry',
  'config_parameter',
  'unavailable',
]);
const CREATE_VALIDATION_KINDS = new Set([
  'config_intent_check',
  'generated_shape_geometry_check',
  'reimported_step_geometry_check',
]);
const DFM_STATUSES = new Set([
  'pass',
  'fail',
  'warning',
  'error',
  'info',
  'missing',
  'unavailable',
  'unknown',
  'not_applicable',
]);

function statusCounts(values, allowed) {
  const counts = Object.fromEntries([...allowed].sort(compareCodePoints).map((status) => [status, 0]));
  let other = 0;
  for (const value of values || []) {
    const status = text(value?.status);
    if (status && allowed.has(status)) counts[status] += 1;
    else other += 1;
  }
  return { ...counts, other };
}

function roundtripResultSummary(value) {
  const roundtrip = isPlainObject(value) ? value : {};
  return {
    exported: booleanOrNull(roundtrip.exported),
    reimport_attempted: booleanOrNull(roundtrip.reimport_attempted),
    reimport_valid: booleanOrNull(roundtrip.reimport_valid),
    volume_delta_percent: finiteOrNull(roundtrip.volume_delta_percent),
    bbox_delta: bboxSummary(roundtrip.bbox_delta, { includeMaxAbs: true }),
    reimported_geometry: isPlainObject(roundtrip.reimported_geometry)
      ? geometryResultSummary(roundtrip.reimported_geometry)
      : null,
    warning_count: arrayCount(roundtrip.warnings),
  };
}

function createQualityOverall(document) {
  const engineering = isPlainObject(document.engineering_quality) ? document.engineering_quality : {};
  const stl = isPlainObject(document.stl_quality) ? document.stl_quality : {};
  return sanitizeSemanticValue({
    status: allowlistedText(document.status, CREATE_RESULT_STATUSES),
    blocking_issue_count: arrayCount(document.blocking_issues),
    warning_count: arrayCount(document.warnings),
    geometry: geometryResultSummary(document.geometry),
    step_roundtrip: roundtripResultSummary(document.step_roundtrip),
    brep_roundtrip: roundtripResultSummary(document.brep_roundtrip),
    stl_quality: {
      exported: booleanOrNull(stl.exported),
      mesh_load_attempted: booleanOrNull(stl.mesh_load_attempted),
      triangle_count: finiteOrNull(stl.triangle_count),
      watertight_or_closed: booleanOrNull(stl.watertight_or_closed),
      non_manifold_count: finiteOrNull(stl.non_manifold_count),
      warning_count: arrayCount(stl.warnings),
    },
    engineering_quality: {
      status: allowlistedText(engineering.status, CREATE_RESULT_STATUSES),
      source: allowlistedText(engineering.source, CREATE_MEASUREMENT_SOURCES),
      validation_kind: allowlistedText(engineering.validation_kind, CREATE_VALIDATION_KINDS),
      measurement_count: arrayCount(engineering.measurements),
      measurement_status_counts: statusCounts(engineering.measurements, CREATE_MEASUREMENT_STATUSES),
      blocking_issue_count: arrayCount(engineering.blocking_issues),
      warning_count: arrayCount(engineering.warnings),
    },
  });
}

function collectExtractedDrawingSemantics(document) {
  const groups = new Map();
  const unmapped = [];
  const sectionFields = {
    view: ['view_kind', 'identity'],
    dimension: ['value', 'unit', 'tolerance', 'status'],
    note: ['category', 'value', 'material', 'tolerance', 'drawing_number', 'status'],
  };

  for (const [section, items] of [
    ['view', document.views || []],
    ['dimension', document.dimensions || []],
    ['note', document.notes || []],
  ]) {
    for (const item of items) {
      if (!isPlainObject(item)) continue;
      const intentId = text(item.matched_intent_id);
      const featureId = text(item.matched_feature_id);
      const observation = pickSemanticFields(item, sectionFields[section]);
      if (!intentId) {
        unmapped.push(unmappedRecord(
          `extracted_drawing_semantics.${section}`,
          'missing_matched_intent_id',
          observation,
          featureId ? { featureId } : {}
        ));
        continue;
      }
      const key = `${section}:${intentId}`;
      const group = groups.get(key) || {
        section,
        intentId,
        featureIds: new Set(),
        observations: [],
      };
      if (featureId) group.featureIds.add(featureId);
      group.observations.push(observation);
      groups.set(key, group);
    }
  }

  const records = [...groups.entries()].map(([id, group]) => {
    const featureIds = [...group.featureIds].sort(compareCodePoints);
    const value = {
      kind: group.section,
      matched_intent_id: group.intentId,
      observations: uniqueCanonical(group.observations),
      ...(featureIds.length > 0 ? { matched_feature_ids: featureIds } : {}),
    };
    return {
      id,
      value: sanitizeSemanticValue(value),
      ...(featureIds.length === 1 ? { featureId: featureIds[0] } : {}),
      characteristicId: group.intentId,
    };
  });
  return finalize(records, unmapped);
}

function collectCreateQuality(document) {
  const groups = new Map();
  const unmapped = [];
  const omit = new Set(['requirement_id', 'feature_id', 'matched_face_index']);
  for (const measurement of document.engineering_quality?.measurements || []) {
    if (!isPlainObject(measurement)) continue;
    const requirementId = text(measurement.requirement_id);
    const featureId = text(measurement.feature_id);
    const characteristicId = text(measurement.source_requirement_id) || requirementId;
    const value = sanitizeSemanticValue(measurement, { omit });
    if (!requirementId) {
      unmapped.push(unmappedRecord(
        'create_quality.measurement',
        'missing_requirement_id',
        value,
        { ...(featureId ? { featureId } : {}), ...(characteristicId ? { characteristicId } : {}) }
      ));
      continue;
    }
    const group = groups.get(requirementId) || {
      observations: [],
      featureIds: new Set(),
      characteristicIds: new Set(),
    };
    group.observations.push(value);
    if (featureId) group.featureIds.add(featureId);
    if (characteristicId) group.characteristicIds.add(characteristicId);
    groups.set(requirementId, group);
  }
  const records = [...groups.entries()].map(([requirementId, group]) => {
    const featureIds = [...group.featureIds].sort(compareCodePoints);
    const characteristicIds = [...group.characteristicIds].sort(compareCodePoints);
    if (characteristicIds.length > 1) {
      unmapped.push(unmappedRecord(
        'create_quality.measurement',
        'conflicting_characteristic_identity',
        { requirement_id: requirementId, characteristic_ids: characteristicIds },
        { rejectedId: `measurement:${requirementId}` }
      ));
      return null;
    }
    return {
      id: `measurement:${requirementId}`,
      value: {
        observations: uniqueCanonical(group.observations),
        ...(featureIds.length > 0 ? { matched_feature_ids: featureIds } : {}),
        ...(characteristicIds.length > 0 ? { characteristic_ids: characteristicIds } : {}),
      },
      ...(featureIds.length === 1 ? { featureId: featureIds[0] } : {}),
      ...(characteristicIds.length === 1 ? { characteristicId: characteristicIds[0] } : {}),
    };
  }).filter(Boolean);
  records.push({ id: 'create_quality:overall', value: createQualityOverall(document) });
  return finalize(records, unmapped);
}

function drawingQualityOverall(document) {
  const semanticQuality = pickSemanticFields(document.semantic_quality, [
    'decision',
    'advisory_decision',
    'enforceable',
    'score',
    'score_basis',
    'critical_features_total',
    'critical_features_covered',
    'missing_critical_features',
    'required_dimensions_total',
    'required_dimensions_present',
    'missing_required_dimensions',
    'required_notes_total',
    'required_notes_present',
    'required_notes_missing',
    'required_views_total',
    'required_views_present',
    'required_views_missing',
  ], { sortArrays: true });
  return sanitizeSemanticValue({
    status: document.status ?? null,
    score: document.score ?? null,
    views: pickSemanticFields(document.views, [
      'required_count', 'generated_count', 'missing_views', 'overlap_count',
    ], { sortArrays: true }),
    dimensions: pickSemanticFields(document.dimensions, [
      'required_count', 'mapped_count', 'coverage_percent', 'missing_required_intents',
      'conflict_count', 'duplicate_count',
    ], { sortArrays: true }),
    traceability: pickSemanticFields(document.traceability, [
      'coverage_percent', 'unmapped_required_entities',
    ], { sortArrays: true }),
    bom: pickSemanticFields(document.bom, [
      'expected_items', 'actual_items', 'missing_material_count', 'balloon_mismatches',
    ]),
    semantic_quality: semanticQuality,
    layout_readability: pickSemanticFields(document.layout_readability, [
      'status', 'evidence_state', 'completeness_state', 'advisory_only', 'score', 'warning_count',
    ]),
    thresholds: sanitizeSemanticValue(document.thresholds || {}, { sortArrays: true }),
  });
}

const REQUIREMENT_VALUE_FIELDS = [
  'classification',
  'status',
  'required',
  'rendered',
  'category',
  'severity',
  'decision',
  'enforceable',
  'confidence',
  'feature_id',
  'matched_feature_id',
  'target_feature_id',
  'advisory_only',
  'coverage_percent',
  'present',
  'linked',
  'value',
  'unit',
];

function addDrawingRequirement(groups, unmapped, item, context) {
  if (!isPlainObject(item)) {
    unmapped.push(unmappedRecord('drawing_quality.requirement', 'missing_requirement_id', { context }));
    return;
  }
  const requirementId = firstId(item, ['requirement_id', 'dimension_id', 'target_requirement_id']);
  const featureId = firstId(item, ['matched_feature_id', 'feature_id', 'target_feature_id']);
  const observation = {
    context,
    ...pickSemanticFields(item, REQUIREMENT_VALUE_FIELDS, { sortArrays: true }),
  };
  if (!requirementId) {
    unmapped.push(unmappedRecord(
      'drawing_quality.requirement',
      'missing_requirement_id',
      observation,
      featureId ? { featureId } : {}
    ));
    return;
  }
  const group = groups.get(requirementId) || { observations: [], featureIds: new Set() };
  group.observations.push(sanitizeSemanticValue(observation, { sortArrays: true }));
  if (featureId) group.featureIds.add(featureId);
  groups.set(requirementId, group);
}

function collectDrawingQuality(document) {
  const candidates = [{ id: 'overall', value: drawingQualityOverall(document), kind: 'drawing_quality.overall' }];
  const unmapped = [];
  const issueOmit = new Set(['issue_id', 'id', 'code']);

  for (const [context, issues] of [
    ['blocking_issues', document.blocking_issues || []],
    ['issues', document.issues || []],
    ['semantic_quality.issues', document.semantic_quality?.issues || []],
  ]) {
    for (const issue of issues) {
      if (!isPlainObject(issue)) continue;
      const issueId = firstId(issue, ['issue_id', 'id', 'code']);
      const value = sanitizeSemanticValue({ context, ...issue }, { omit: issueOmit, sortArrays: true });
      if (!issueId) {
        unmapped.push(unmappedRecord('drawing_quality.issue', 'missing_issue_id', value));
        continue;
      }
      candidates.push({ kind: 'drawing_quality.issue', id: `issue:${issueId}`, value });
    }
  }

  const requirementGroups = new Map();
  for (const path of DRAWING_REQUIREMENT_ARRAY_PATHS) {
    for (const item of valueAtPath(document, path) || []) {
      addDrawingRequirement(requirementGroups, unmapped, item, path.join('.'));
    }
  }

  const missingLists = [
    ['dimensions.missing_required_intents', document.dimensions?.missing_required_intents],
    ['traceability.unmapped_required_entities', document.traceability?.unmapped_required_entities],
    ['semantic_quality.missing_required_dimensions', document.semantic_quality?.missing_required_dimensions],
    ['semantic_quality.required_notes_missing', document.semantic_quality?.required_notes_missing],
    ['semantic_quality.required_views_missing', document.semantic_quality?.required_views_missing],
    ['semantic_quality.traceability.missing_required_dimensions', document.semantic_quality?.traceability?.missing_required_dimensions],
    ['semantic_quality.traceability.unknown_required_dimensions', document.semantic_quality?.traceability?.unknown_required_dimensions],
  ];
  for (const [context, ids] of missingLists) {
    for (const rawId of ids || []) {
      const requirementId = text(rawId);
      if (!requirementId) {
        unmapped.push(unmappedRecord('drawing_quality.requirement', 'missing_requirement_id', { context }));
        continue;
      }
      addDrawingRequirement(requirementGroups, unmapped, {
        requirement_id: requirementId,
        classification: context.includes('unknown') ? 'unknown' : 'missing',
      }, context);
    }
  }

  for (const [requirementId, group] of requirementGroups) {
    const featureIds = [...group.featureIds].sort(compareCodePoints);
    candidates.push({
      kind: 'drawing_quality.requirement',
      id: `requirement:${requirementId}`,
      value: {
        observations: uniqueCanonical(group.observations),
        ...(featureIds.length > 1 ? { matched_feature_ids: featureIds } : {}),
      },
      ...(featureIds.length === 1 ? { featureId: featureIds[0] } : {}),
      characteristicId: requirementId,
    });
  }
  return finalizeDistinctCandidates(candidates, unmapped);
}

function collectDrawingQa(document) {
  return finalize([{
    id: 'overall',
    value: sanitizeSemanticValue({
      status: document.status ?? null,
      score: document.score ?? null,
      weight_profile: document.weight_profile ?? null,
      metrics: document.metrics || {},
      deductions: document.deductions || {},
    }, { sortArrays: true }),
  }], []);
}

function collectDfm(document) {
  const groups = new Map();
  const unmapped = [];
  const omit = new Set(['rule_id', 'feature_id', 'code']);
  for (const [context, items] of [['check', document.checks || []], ['issue', document.issues || []]]) {
    for (const item of items) {
      if (!isPlainObject(item)) continue;
      const ruleId = text(item.rule_id);
      const featureId = text(item.feature_id);
      const observation = sanitizeSemanticValue({ context, ...item }, { omit, sortArrays: true });
      if (!ruleId) {
        unmapped.push(unmappedRecord(
          `dfm.${context}`,
          'missing_rule_id',
          observation,
          featureId ? { featureId } : {}
        ));
        continue;
      }
      const key = `${ruleId}|${featureId || 'global'}`;
      const group = groups.get(key) || { ruleId, featureId, observations: [] };
      group.observations.push(observation);
      groups.set(key, group);
    }
  }
  const records = [...groups.values()].map((group) => ({
    id: `rule:${group.ruleId}:feature:${group.featureId || 'global'}`,
    value: { observations: uniqueCanonical(group.observations) },
    ...(group.featureId ? { featureId: group.featureId } : {}),
  }));
  const summary = isPlainObject(document.summary) ? document.summary : {};
  const severityCounts = isPlainObject(summary.severity_counts) ? summary.severity_counts : {};
  const scoreImpact = isPlainObject(summary.score_impact) ? summary.score_impact : {};
  records.push({
    id: 'dfm:overall',
    value: sanitizeSemanticValue({
      status: allowlistedText(document.status, DFM_STATUSES),
      success: booleanOrNull(document.success),
      score: finiteOrNull(document.score),
      check_count: arrayCount(document.checks),
      issue_count: arrayCount(document.issues),
      check_status_counts: statusCounts(document.checks, DFM_STATUSES),
      issue_status_counts: statusCounts(document.issues, DFM_STATUSES),
      summary: {
        status: allowlistedText(summary.status, DFM_STATUSES),
        errors: finiteOrNull(summary.errors),
        warnings: finiteOrNull(summary.warnings),
        info: finiteOrNull(summary.info),
        total: finiteOrNull(summary.total),
        severity_counts: {
          critical: finiteOrNull(severityCounts.critical),
          major: finiteOrNull(severityCounts.major),
          minor: finiteOrNull(severityCounts.minor),
          info: finiteOrNull(severityCounts.info),
        },
        score_impact: {
          error_penalty: finiteOrNull(scoreImpact.error_penalty),
          warning_penalty: finiteOrNull(scoreImpact.warning_penalty),
          total_penalty: finiteOrNull(scoreImpact.total_penalty),
        },
        top_fix_count: arrayCount(summary.top_fixes),
      },
    }),
  });
  return finalize(records, unmapped);
}

function collectQualityRisk(document) {
  const candidates = [];
  const unmapped = [];
  const configs = [
    { key: 'quality_gates', prefix: 'gate', fields: ['gate_id', 'id'], kind: 'quality_risk.gate' },
    { key: 'quality_risks', prefix: 'risk', fields: ['risk_id', 'id'], kind: 'quality_risk.risk' },
    {
      key: 'critical_dimensions',
      prefix: 'critical',
      fields: ['critical_id', 'characteristic_id', 'id'],
      kind: 'quality_risk.critical',
      characteristic: true,
    },
    {
      key: 'inspection_required_points',
      prefix: 'inspection',
      fields: ['inspection_id', 'checkpoint_id', 'id'],
      kind: 'quality_risk.inspection',
      characteristic: true,
    },
  ];
  for (const config of configs) {
    for (const item of document[config.key] || []) {
      if (!isPlainObject(item)) continue;
      const id = firstId(item, config.fields);
      const featureId = text(item.feature_id);
      const value = sanitizeSemanticValue(item, {
        omit: new Set([...config.fields, 'source']),
        sortArrays: true,
      });
      if (!id) {
        unmapped.push(unmappedRecord(config.kind, 'missing_stable_id', value, featureId ? { featureId } : {}));
        continue;
      }
      candidates.push({
        kind: config.kind,
        id: `${config.prefix}:${id}`,
        value,
        ...(featureId ? { featureId } : {}),
        ...(config.characteristic ? { characteristicId: id } : {}),
      });
    }
  }
  return finalizeDistinctCandidates(candidates, unmapped);
}

function graphNodeValue(node) {
  return pickSemanticFields(node, [
    'kind',
    'package_id',
    'record_id',
    'type',
    'artifact_type',
    'inspection_evidence',
    'generated_artifact',
    'evidence_class',
    'trusted_inspection_evidence',
    'sha256',
    'category',
    'role',
  ], { sortArrays: true });
}

function collectEvidenceGraph(document) {
  const candidates = [];
  const unmapped = [];
  for (const node of document.nodes || []) {
    if (!isPlainObject(node)) continue;
    const id = graphNodeId(node);
    const value = graphNodeValue(node);
    if (!id) {
      unmapped.push(unmappedRecord('evidence_graph.node', 'missing_node_id', value));
      continue;
    }
    if (UNSTABLE_SOURCE_ID.test(id)) {
      unmapped.push(unmappedRecord(
        'evidence_graph.node',
        'unstable_positional_identity',
        value,
        { rejectedId: id }
      ));
      continue;
    }
    candidates.push({ kind: 'evidence_graph.node', id: `node:${id}`, value });
  }

  for (const edge of document.edges || []) {
    if (!isPlainObject(edge)) continue;
    const id = graphEdgeId(edge);
    const parts = graphEdgeParts(edge);
    const value = sanitizeSemanticValue(parts);
    if (!id || !parts.source || !parts.target || !parts.relationship) {
      unmapped.push(unmappedRecord('evidence_graph.edge', 'missing_stable_edge_identity', value));
      continue;
    }
    if ([id, parts.source, parts.target].some((entry) => UNSTABLE_SOURCE_REFERENCE.test(entry))) {
      unmapped.push(unmappedRecord(
        'evidence_graph.edge',
        'unstable_positional_identity',
        value,
        { rejectedId: id }
      ));
      continue;
    }
    candidates.push({ kind: 'evidence_graph.edge', id: `edge:${id}`, value });
  }
  return finalizeDistinctCandidates(candidates, unmapped);
}

export function collectRevisionImpactSemanticRecords(kind, document) {
  assertBoundedDocument(kind, document);
  if (kind === 'extracted_drawing_semantics') return collectExtractedDrawingSemantics(document);
  if (kind === 'create_quality') return collectCreateQuality(document);
  if (kind === 'drawing_quality') return collectDrawingQuality(document);
  if (kind === 'drawing_qa') return collectDrawingQa(document);
  if (kind === 'dfm') return collectDfm(document);
  if (kind === 'quality_risk') return collectQualityRisk(document);
  return collectEvidenceGraph(document);
}
