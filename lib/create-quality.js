import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

const CREATE_QUALITY_SCHEMA = JSON.parse(
  readFileSync(new URL('../schemas/create-quality.schema.json', import.meta.url), 'utf8')
);

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
const validateQualityReport = ajv.compile(CREATE_QUALITY_SCHEMA);

export const CREATE_QUALITY_SCHEMA_VERSION = '1.0';
export const DEFAULT_CREATE_QUALITY_THRESHOLDS = Object.freeze({
  max_step_volume_delta_percent: 0.5,
  max_bbox_delta_mm: 0.2,
  max_engineering_dimension_delta_mm: 0.05,
  max_engineering_center_delta_mm: 0.2,
});

const MEASUREMENT_SOURCES = Object.freeze({
  GENERATED_SHAPE_GEOMETRY: 'generated_shape_geometry',
  REIMPORTED_STEP_GEOMETRY: 'reimported_step_geometry',
  STL_MESH_GEOMETRY: 'stl_mesh_geometry',
  CONFIG_PARAMETER: 'config_parameter',
  UNAVAILABLE: 'unavailable',
});

const GENERATED_SHAPE_GEOMETRY_CHECK = 'generated_shape_geometry_check';
const REIMPORTED_STEP_GEOMETRY_CHECK = 'reimported_step_geometry_check';
function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function formatSchemaErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || '/'} ${error.message}`);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

// Measurement evidence and intent must be actual finite numbers, not coerced text.
function measurementNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function measurementVector(value, lengths = [3]) {
  return Array.isArray(value) && lengths.includes(value.length)
    && value.every(entry => measurementNumber(entry) !== null) ? [...value] : null;
}

function isZAxis(value) {
  const axis = measurementVector(value);
  if (!axis) return false;
  const length = Math.hypot(...axis);
  return length > 0 && Number.isFinite(length)
    && Math.hypot(axis[0], axis[1]) / length <= 1e-7;
}

function finiteInteger(value) {
  const numericValue = finiteNumber(value);
  return Number.isInteger(numericValue) ? numericValue : null;
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function safeFilenameComponent(value, defaultValue = 'create') {
  const text = String(value || '').trim().replaceAll('\\', '/').replaceAll('\0', '');
  const leaf = text.split('/').pop();
  if (!leaf || leaf === '.' || leaf === '..') return defaultValue;
  return leaf;
}

function roundNumber(value, decimals = 4) {
  if (!Number.isFinite(value)) return null;
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function normalizeVector3(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const normalized = value.map((entry) => finiteNumber(entry));
  return normalized.every((entry) => entry !== null) ? normalized : null;
}

function normalizeVector2(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const normalized = value.slice(0, 2).map((entry) => finiteNumber(entry));
  return normalized.every((entry) => entry !== null) ? normalized : null;
}

function vector2Distance(left = null, right = null) {
  const a = normalizeVector2(left);
  const b = normalizeVector2(right);
  if (!a || !b) return null;
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function normalizeFeatureRefs(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => normalizeFeatureRefs(entry))
      .filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function collectCutToolIds(config = {}) {
  // Follow the same named result/default-final order as create_model.py.
  // A cut on a discarded branch does not establish a hole in the exported part.
  const history = new Map((Array.isArray(config.shapes) ? config.shapes : []).map(shape => [shape?.id, new Set()]));
  const primitiveIds = new Set(history.keys());
  for (const operation of Array.isArray(config.operations) ? config.operations : []) {
    const op = operation.op || operation.type;
    const baseId = operation.base ?? operation.target;
    const prior = history.get(baseId);
    if (!prior) return new Set();
    // Later solid combination can erase a cavity while leaving an exterior
    // cylinder. Without observed cavity polarity, those earlier cuts are unproven.
    const cuts = new Set(op === 'fuse' || op === 'common' ? [] : prior);
    if (op === 'cut' && primitiveIds.has(operation.tool)) cuts.add(operation.tool);
    const resultId = operation.result ?? baseId;
    history.set(resultId, cuts);
    primitiveIds.delete(resultId);
  }
  return history.get(config.final || [...history.keys()].at(-1)) || new Set();
}

function holeConfigScopeReason(config) {
  if (config.assembly || config.parts?.length) return 'Assembly transforms are unsupported for hole correspondence.';
  const shapes = Array.isArray(config.shapes) ? config.shapes : [];
  if (new Set(shapes.map(shape => shape?.id)).size !== shapes.length) return 'Duplicate authored feature IDs make hole correspondence ambiguous.';
  if ((Array.isArray(config.operations) ? config.operations : []).some(operation => !['cut', 'fuse', 'common', 'fillet', 'chamfer'].includes(operation.op || operation.type))) {
    return 'Pattern, shell or unsupported operations are outside the bounded hole check.';
  }
  return null;
}

function collectShapesById(config = {}) {
  const shapes = new Map();
  for (const shape of Array.isArray(config.shapes) ? config.shapes : []) {
    if (typeof shape?.id === 'string' && shape.id.trim()) shapes.set(shape.id.trim(), shape);
  }
  return shapes;
}

function configShapeField(featureId, fieldName) {
  return `config.shapes[id=${featureId}].${fieldName}`;
}

function configRequiredDimensionField(requirementId, fieldName) {
  return `config.drawing_intent.required_dimensions[id=${requirementId}].${fieldName}`;
}

function isRequired(value) {
  return value !== false;
}

function normalizeDimensionType(value) {
  return String(value || '').trim().toLowerCase().replaceAll('-', '_');
}

function collectExpectedHoleDiameterRequirements(config = {}) {
  const dimensions = Array.isArray(config?.drawing_intent?.required_dimensions)
    ? config.drawing_intent.required_dimensions
    : [];
  const requirements = [];

  for (const dimension of dimensions) {
    const dimensionType = normalizeDimensionType(dimension?.dimension_type || dimension?.type || dimension?.style);
    if (dimensionType !== 'diameter' && dimensionType !== 'hole_diameter') continue;

    const featureRefs = normalizeFeatureRefs(dimension.feature);
    const hasRequirementId = typeof dimension.id === 'string' && dimension.id.trim();
    for (const featureId of featureRefs.length ? featureRefs : ['unknown']) {
      const rawCenter = dimension.expected_center_xy_mm ?? dimension.expected_center_mm
        ?? dimension.center_xy_mm ?? dimension.center_mm;
      const expectedCenter = measurementVector(rawCenter, [2, 3])?.slice(0, 2) || null;
      const rawTolerance = dimension.tolerance_mm ?? dimension.tolerance;
      const rawCenterTolerance = dimension.center_tolerance_mm ?? dimension.position_tolerance_mm;
      const invalidTolerance = value => value !== undefined
        && (measurementNumber(value) === null || value < 0);
      requirements.push({
        requirement_id: hasRequirementId ? dimension.id.trim() : 'unknown',
        missing_linkage: !featureRefs.length || !hasRequirementId,
        feature_id: featureId,
        measurement_type: 'hole_diameter',
        expected_value_mm: measurementNumber(dimension.value_mm ?? dimension.value),
        invalid_intent: invalidTolerance(rawTolerance) || invalidTolerance(rawCenterTolerance)
          || (rawCenter !== undefined && !expectedCenter),
        tolerance_mm: measurementNumber(rawTolerance),
        expected_center_xy_mm: expectedCenter,
        expected_center_source_field: expectedCenter
          ? configRequiredDimensionField(dimension.id || `${featureId}_DIA`, 'expected_center_xy_mm')
          : null,
        center_tolerance_mm: measurementNumber(rawCenterTolerance),
        required: isRequired(dimension.required),
      });
    }
  }

  return requirements;
}

function provenanceRecord({
  measurement_id,
  measurement_type,
  source,
  report_field = null,
  source_field = null,
  value = null,
  note = null,
}) {
  return {
    measurement_id,
    measurement_type,
    source,
    report_field,
    source_field,
    value,
    note,
  };
}

function normalizeCylindricalFaces(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      const diameter = measurementNumber(entry?.diameter_mm) ?? (
        measurementNumber(entry?.radius_mm) !== null ? entry.radius_mm * 2 : null
      );
      const center = measurementVector(entry?.center_mm ?? entry?.center);
      const centerXy = center?.slice(0, 2) || null;
      return {
        face_index: finiteInteger(entry?.face_index) ?? index + 1,
        surface_type: typeof entry?.surface_type === 'string' ? entry.surface_type : null,
        radius_mm: measurementNumber(entry?.radius_mm),
        diameter_mm: diameter,
        center_mm: center,
        center_xy_mm: centerXy,
        center_of_mass_mm: normalizeVector3(entry?.center_of_mass_mm),
        axis: measurementVector(entry?.axis),
        bbox: ['min', 'max', 'size'].every(key => measurementVector(entry?.bbox?.[key]))
          ? normalizeBbox(entry) : null,
        area_mm2: finiteNumber(entry?.area_mm2),
      };
    })
    .filter((entry) => entry.diameter_mm !== null && entry.diameter_mm > 0 && entry.center_xy_mm);
}

function expectedCenterXyForFeature(shape = null) {
  return measurementVector(shape?.position)?.slice(0, 2) || null;
}

function expectedCenterXyForRequirement(requirement, shape = null) {
  return normalizeVector2(requirement?.expected_center_xy_mm) || expectedCenterXyForFeature(shape);
}

function holeFeatureIsAuthoredCutTool({ featureId, shape, cutToolIds }) {
  return Boolean(
    shape
    && String(shape.type || '').toLowerCase() === 'cylinder'
    && cutToolIds.has(featureId)
    && measurementVector(shape.position)
    && measurementNumber(shape.height) !== null && shape.height > 0
    && shape.rotation === undefined
    && isZAxis(shape.direction ?? [0, 0, 1])
  );
}

function faceWithinCutterDepth(face, shape) {
  if (!face.bbox || face.bbox.max[2] <= face.bbox.min[2]) return false;
  const start = shape.position[2];
  const end = start + shape.height * ((shape.direction?.[2] ?? 1) < 0 ? -1 : 1);
  return face.bbox.min[2] >= Math.min(start, end) - 1e-7
    && face.bbox.max[2] <= Math.max(start, end) + 1e-7;
}

function findBestCylindricalFaceMatch({ requirement, shape, expectedCenterXy, cylindricalFaces, centerToleranceMm }) {
  const authoredCenter = expectedCenterXyForFeature(shape);
  if (!authoredCenter) return { reason: 'Authored cylinder position is missing or nonfinite' };
  const candidates = cylindricalFaces.filter(face => face.surface_type === 'Cylinder' && isZAxis(face.axis)
    && faceWithinCutterDepth(face, shape)
    && vector2Distance(face.center_xy_mm, authoredCenter) <= centerToleranceMm);
  if (candidates.length !== 1) return {
    reason: candidates.length > 1
      ? 'Multiple cylindrical faces match; split or ambiguous faces are unsupported'
      : 'No Z-axis cylindrical face matches the authored position and cutter depth',
  };
  const face = candidates[0];
  return {
    face,
    center_delta_mm: vector2Distance(face.center_xy_mm, expectedCenterXy),
    diameter_delta_mm: Math.abs(face.diameter_mm - requirement.expected_value_mm),
  };
}

function collectFaceClaims({ requirements, shapesById, cutToolIds, cylindricalFaces, defaultCenterTolerance }) {
  const claims = new Map();
  for (const requirement of requirements) {
    const shape = shapesById.get(requirement.feature_id);
    if (requirement.missing_linkage || requirement.invalid_intent || !holeFeatureIsAuthoredCutTool({ featureId: requirement.feature_id, shape, cutToolIds })) continue;
    const match = findBestCylindricalFaceMatch({
      requirement, shape, cylindricalFaces,
      expectedCenterXy: expectedCenterXyForRequirement(requirement, shape),
      centerToleranceMm: requirement.center_tolerance_mm ?? defaultCenterTolerance,
    });
    if (!match.face) continue;
    const features = claims.get(match.face.face_index) || new Set();
    features.add(requirement.feature_id);
    claims.set(match.face.face_index, features);
  }
  return claims;
}

function baseEngineeringMeasurement({
  requirement,
  measurementType,
  toleranceMm,
  centerToleranceMm,
  validationKind = GENERATED_SHAPE_GEOMETRY_CHECK,
  requirementSuffix = '',
}) {
  return {
    requirement_id: measurementType === 'hole_center'
      ? `${requirement.feature_id}_CENTER${requirementSuffix}`
      : `${requirement.requirement_id}${requirementSuffix}`,
    source_requirement_id: requirement.requirement_id,
    feature_id: requirement.feature_id,
    measurement_type: measurementType,
    expected_value_mm: measurementType === 'hole_diameter' ? requirement.expected_value_mm : null,
    actual_value_mm: null,
    source_value_mm: null,
    expected_center_xy_mm: null,
    actual_center_xy_mm: null,
    tolerance_mm: measurementType === 'hole_diameter' ? toleranceMm : centerToleranceMm,
    delta_mm: null,
    center_delta_mm: null,
    source_delta_mm: null,
    source_center_delta_mm: null,
    status: 'unavailable',
    required: requirement.required,
    source: MEASUREMENT_SOURCES.UNAVAILABLE,
    source_field: null,
    expected_source: MEASUREMENT_SOURCES.CONFIG_PARAMETER,
    expected_source_field: measurementType === 'hole_diameter'
      ? configRequiredDimensionField(requirement.requirement_id, 'value_mm')
      : requirement.expected_center_source_field || configShapeField(requirement.feature_id, 'position'),
    validation_kind: validationKind,
    matched_face_index: null,
    message: null,
  };
}

function classifyHoleRequirement({
  requirement,
  shape,
  cutToolIds,
  cylindricalFaces,
  toleranceMm,
  centerToleranceMm,
  actualSource = MEASUREMENT_SOURCES.GENERATED_SHAPE_GEOMETRY,
  validationKind = GENERATED_SHAPE_GEOMETRY_CHECK,
  requirementSuffix = '',
  geometryLabel = 'Generated geometry',
  sourceFieldPrefix = 'geometry.cylindrical_faces',
  generatedMeasurementByType = new Map(),
  faceClaims = new Map(),
  scopeReason = null,
}) {
  const diameterBase = baseEngineeringMeasurement({
    requirement,
    measurementType: 'hole_diameter',
    toleranceMm,
    centerToleranceMm,
    validationKind,
    requirementSuffix,
  });
  const centerBase = baseEngineeringMeasurement({
    requirement,
    measurementType: 'hole_center',
    toleranceMm,
    centerToleranceMm,
    validationKind,
    requirementSuffix,
  });
  const expectedCenterXy = expectedCenterXyForRequirement(requirement, shape);
  const centerMeasurement = {
    ...centerBase,
    expected_center_xy_mm: expectedCenterXy,
  };

  if (requirement.missing_linkage) {
    return [diameterBase, centerMeasurement].map(row => ({
      ...row, status: 'missing',
      message: 'Hole diameter intent must declare an explicit requirement ID and feature reference; unknown denotes missing linkage.',
    }));
  }

  if (scopeReason || requirement.invalid_intent) {
    return [diameterBase, centerMeasurement].map(row => ({
      ...row, status: 'unavailable',
      message: scopeReason || 'Expected center and tolerances must be finite numeric values; tolerances must be nonnegative.',
    }));
  }

  if (requirement.expected_value_mm === null || requirement.expected_value_mm <= 0) {
    return [
      {
        ...diameterBase,
        status: 'missing',
        message: `Required expected hole diameter is missing for ${requirement.feature_id}.`,
      },
      {
        ...centerMeasurement,
        status: 'missing',
        message: `Required expected hole center is unavailable because ${requirement.feature_id} has no expected diameter intent.`,
      },
    ];
  }

  if (!shape) {
    return [
      {
        ...diameterBase,
        status: 'missing',
        message: `Expected hole feature ${requirement.feature_id} is missing from authored intent.`,
      },
      {
        ...centerMeasurement,
        status: 'missing',
        message: `Expected hole center for ${requirement.feature_id} is missing from authored intent.`,
      },
    ];
  }

  if (!holeFeatureIsAuthoredCutTool({ featureId: requirement.feature_id, shape, cutToolIds })) {
    return [
      {
        ...diameterBase,
        status: 'unavailable',
        message: `Expected hole feature ${requirement.feature_id} is not a supported Z-axis cylindrical cut tool in the final shape.`,
      },
      {
        ...centerMeasurement,
        status: 'unavailable',
        message: `Expected hole center for ${requirement.feature_id} is unavailable because the authored feature is not a supported Z-axis cylindrical cut tool in the final shape.`,
      },
    ];
  }

  if (!expectedCenterXy) {
    return [
      {
        ...diameterBase,
        status: 'unavailable',
        message: `Expected hole feature ${requirement.feature_id} has no authored center intent for geometry matching.`,
      },
      {
        ...centerMeasurement,
        status: 'unavailable',
        message: `Expected hole center for ${requirement.feature_id} is unavailable from authored intent.`,
      },
    ];
  }

  const match = findBestCylindricalFaceMatch({
    requirement,
    shape,
    expectedCenterXy,
    cylindricalFaces,
    toleranceMm,
    centerToleranceMm,
  });

  if (!match.face || faceClaims.get(match.face.face_index)?.size > 1) {
    const reason = match.face
      ? 'The same observed face is claimed by distinct authored hole features'
      : match.reason;
    return [diameterBase, centerMeasurement].map(row => ({
      ...row,
      expected_center_xy_mm: expectedCenterXy,
      status: 'unavailable',
      message: `${geometryLabel}: ${reason} for ${requirement.feature_id}.`,
    }));
  }

  const { face, diameter_delta_mm: diameterDelta, center_delta_mm: centerDelta } = match;
  const diameterStatus = diameterDelta > toleranceMm ? 'fail' : 'pass';
  const centerStatus = centerDelta > centerToleranceMm ? 'fail' : 'pass';
  const sourceField = `${sourceFieldPrefix}[face_index=${face.face_index}]`;
  const generatedDiameter = generatedMeasurementByType.get('hole_diameter');
  const generatedCenter = generatedMeasurementByType.get('hole_center');
  const sourceDelta = generatedDiameter?.actual_value_mm !== null && generatedDiameter?.actual_value_mm !== undefined
    ? roundNumber(Math.abs(face.diameter_mm - generatedDiameter.actual_value_mm), 4)
    : null;
  const sourceCenterDelta = generatedCenter?.actual_center_xy_mm
    ? vector2Distance(face.center_xy_mm, generatedCenter.actual_center_xy_mm)
    : null;

  return [
    {
      ...diameterBase,
      actual_value_mm: face.diameter_mm,
      source_value_mm: face.diameter_mm,
      expected_center_xy_mm: expectedCenterXy,
      actual_center_xy_mm: face.center_xy_mm,
      delta_mm: diameterDelta,
      center_delta_mm: centerDelta,
      source_delta_mm: sourceDelta,
      source_center_delta_mm: sourceCenterDelta,
      status: diameterStatus,
      source: actualSource,
      source_field: `${sourceField}.diameter_mm`,
      matched_face_index: face.face_index,
      message: diameterStatus === 'pass'
        ? null
        : `Hole ${requirement.feature_id} ${actualSource} diameter ${face.diameter_mm} mm differs from expected ${requirement.expected_value_mm} mm by ${diameterDelta} mm.`,
    },
    {
      ...centerMeasurement,
      actual_center_xy_mm: face.center_xy_mm,
      center_delta_mm: centerDelta,
      delta_mm: centerDelta,
      source_delta_mm: null,
      source_center_delta_mm: sourceCenterDelta,
      status: centerStatus,
      source: actualSource,
      source_field: `${sourceField}.center_mm`,
      matched_face_index: face.face_index,
      message: centerStatus === 'pass'
        ? null
        : `Hole ${requirement.feature_id} ${actualSource} center differs from expected center by ${centerDelta} mm.`,
    },
  ];
}

function buildEngineeringMeasurementProvenance({ config = {}, geometry = {} } = {}) {
  const records = [];

  records.push(provenanceRecord({
    measurement_id: 'bbox',
    measurement_type: 'bbox',
    source: geometry.bbox ? MEASUREMENT_SOURCES.GENERATED_SHAPE_GEOMETRY : MEASUREMENT_SOURCES.UNAVAILABLE,
    report_field: geometry.bbox ? 'geometry.bbox' : null,
    value: geometry.bbox,
    note: geometry.bbox
      ? 'Generated FreeCAD shape metadata from scripts/_shapes.py get_metadata(final_shape).'
      : 'Generated bounding-box metadata is unavailable.',
  }));

  const thicknessValue = geometry.bbox?.size?.[2] ?? null;
  records.push(provenanceRecord({
    measurement_id: 'thickness',
    measurement_type: 'thickness',
    source: thicknessValue !== null ? MEASUREMENT_SOURCES.GENERATED_SHAPE_GEOMETRY : MEASUREMENT_SOURCES.UNAVAILABLE,
    report_field: thicknessValue !== null ? 'geometry.bbox.size[2]' : null,
    value: thicknessValue,
    note: thicknessValue !== null
      ? 'Overall Z extent from generated FreeCAD shape metadata; this is not a local wall-thickness feature check.'
      : 'No thickness value is currently evaluated by engineering_quality.',
  }));

  records.push(provenanceRecord({
    measurement_id: 'volume',
    measurement_type: 'volume',
    source: geometry.volume !== null ? MEASUREMENT_SOURCES.GENERATED_SHAPE_GEOMETRY : MEASUREMENT_SOURCES.UNAVAILABLE,
    report_field: geometry.volume !== null ? 'geometry.volume' : null,
    value: geometry.volume,
    note: geometry.volume !== null
      ? 'Generated FreeCAD shape metadata from scripts/_shapes.py get_metadata(final_shape).'
      : 'Generated volume metadata is unavailable.',
  }));

  const measurementsByKey = new Map(
    (geometry.engineering_measurements || [])
      .map((entry) => [`${entry.feature_id}:${entry.measurement_type}`, entry])
  );
  const stepMeasurementsByKey = new Map(
    (geometry.engineering_measurements || [])
      .filter((entry) => entry.validation_kind === REIMPORTED_STEP_GEOMETRY_CHECK)
      .map((entry) => [`${entry.feature_id}:${entry.measurement_type}`, entry])
  );
  for (const requirement of collectExpectedHoleDiameterRequirements(config)) {
    const generatedMeasurements = (geometry.engineering_measurements || [])
      .filter((entry) => entry.source === MEASUREMENT_SOURCES.GENERATED_SHAPE_GEOMETRY);
    const generatedMeasurementsByKey = new Map(
      generatedMeasurements.map((entry) => [`${entry.feature_id}:${entry.measurement_type}`, entry])
    );
    const diameterMeasurement = generatedMeasurementsByKey.get(`${requirement.feature_id}:hole_diameter`)
      || measurementsByKey.get(`${requirement.feature_id}:hole_diameter`);
    const centerMeasurement = generatedMeasurementsByKey.get(`${requirement.feature_id}:hole_center`)
      || measurementsByKey.get(`${requirement.feature_id}:hole_center`);
    records.push(provenanceRecord({
      measurement_id: `${requirement.feature_id}_diameter`,
      measurement_type: 'hole_diameter',
      source: diameterMeasurement?.source || MEASUREMENT_SOURCES.UNAVAILABLE,
      report_field: diameterMeasurement?.actual_value_mm !== null && diameterMeasurement?.actual_value_mm !== undefined
        ? `engineering_quality.measurements[requirement_id=${requirement.requirement_id}].source_value_mm`
        : null,
      source_field: diameterMeasurement?.source_field || null,
      value: diameterMeasurement?.actual_value_mm ?? null,
      note: diameterMeasurement?.source === MEASUREMENT_SOURCES.GENERATED_SHAPE_GEOMETRY
        ? 'Actual hole diameter measured from cylindrical face metadata on the generated FreeCAD shape.'
        : 'Generated hole diameter measurement is unavailable; config values are not used as actual geometry.',
    }));

    records.push(provenanceRecord({
      measurement_id: `${requirement.feature_id}_center`,
      measurement_type: 'hole_center',
      source: centerMeasurement?.source || MEASUREMENT_SOURCES.UNAVAILABLE,
      report_field: centerMeasurement?.actual_center_xy_mm
        ? `engineering_quality.measurements[requirement_id=${centerMeasurement.requirement_id}].actual_center_xy_mm`
        : null,
      source_field: centerMeasurement?.source_field || null,
      value: centerMeasurement?.actual_center_xy_mm ?? null,
      note: centerMeasurement?.source === MEASUREMENT_SOURCES.GENERATED_SHAPE_GEOMETRY
        ? 'Actual hole center measured from cylindrical face metadata on the generated FreeCAD shape.'
        : 'Generated hole center measurement is unavailable; config values are not used as actual geometry.',
    }));

    const stepDiameterMeasurement = stepMeasurementsByKey.get(`${requirement.feature_id}:hole_diameter`);
    const stepCenterMeasurement = stepMeasurementsByKey.get(`${requirement.feature_id}:hole_center`);
    if (stepDiameterMeasurement || stepCenterMeasurement) {
      records.push(provenanceRecord({
        measurement_id: `${requirement.feature_id}_step_diameter`,
        measurement_type: 'hole_diameter',
        source: stepDiameterMeasurement?.source || MEASUREMENT_SOURCES.UNAVAILABLE,
        report_field: stepDiameterMeasurement?.actual_value_mm !== null && stepDiameterMeasurement?.actual_value_mm !== undefined
          ? `engineering_quality.measurements[requirement_id=${stepDiameterMeasurement.requirement_id}].source_value_mm`
          : null,
        source_field: stepDiameterMeasurement?.source_field || null,
        value: stepDiameterMeasurement?.actual_value_mm ?? null,
        note: stepDiameterMeasurement?.source === MEASUREMENT_SOURCES.REIMPORTED_STEP_GEOMETRY
          ? 'Actual hole diameter measured from cylindrical face metadata after STEP export/re-import.'
          : 'STEP re-imported hole diameter measurement is unavailable; config values are not used as actual geometry.',
      }));

      records.push(provenanceRecord({
        measurement_id: `${requirement.feature_id}_step_center`,
        measurement_type: 'hole_center',
        source: stepCenterMeasurement?.source || MEASUREMENT_SOURCES.UNAVAILABLE,
        report_field: stepCenterMeasurement?.actual_center_xy_mm
          ? `engineering_quality.measurements[requirement_id=${stepCenterMeasurement.requirement_id}].actual_center_xy_mm`
          : null,
        source_field: stepCenterMeasurement?.source_field || null,
        value: stepCenterMeasurement?.actual_center_xy_mm ?? null,
        note: stepCenterMeasurement?.source === MEASUREMENT_SOURCES.REIMPORTED_STEP_GEOMETRY
          ? 'Actual hole center measured from cylindrical face metadata after STEP export/re-import.'
          : 'STEP re-imported hole center measurement is unavailable; config values are not used as actual geometry.',
      }));
    }
  }

  return records;
}

function evaluateEngineeringQuality({
  config = {},
  geometry = {},
  stepRoundtripGeometry = null,
  stepRoundtripAttempted = false,
  thresholds = DEFAULT_CREATE_QUALITY_THRESHOLDS,
} = {}) {
  const requirements = collectExpectedHoleDiameterRequirements(config);
  const measurements = [];
  const blockingIssues = [];
  const warnings = [];
  const shapesById = collectShapesById(config);
  const cutToolIds = collectCutToolIds(config);
  const cylindricalFaces = normalizeCylindricalFaces(geometry.cylindrical_faces);
  const defaultTolerance = finiteNumber(thresholds.max_engineering_dimension_delta_mm)
    ?? DEFAULT_CREATE_QUALITY_THRESHOLDS.max_engineering_dimension_delta_mm;
  const defaultCenterTolerance = finiteNumber(thresholds.max_engineering_center_delta_mm)
    ?? DEFAULT_CREATE_QUALITY_THRESHOLDS.max_engineering_center_delta_mm;

  const scopeReason = holeConfigScopeReason(config);
  const stepFaces = normalizeCylindricalFaces(stepRoundtripGeometry?.cylindrical_faces);
  const generatedClaims = collectFaceClaims({ requirements, shapesById, cutToolIds, cylindricalFaces, defaultCenterTolerance });
  const stepClaims = collectFaceClaims({ requirements, shapesById, cutToolIds, cylindricalFaces: stepFaces, defaultCenterTolerance });

  for (const requirement of requirements) {
    const toleranceMm = requirement.tolerance_mm !== null && requirement.tolerance_mm >= 0 ? requirement.tolerance_mm : defaultTolerance;
    const centerToleranceMm = requirement.center_tolerance_mm !== null && requirement.center_tolerance_mm >= 0 ? requirement.center_tolerance_mm : defaultCenterTolerance;
    const requirementMeasurements = classifyHoleRequirement({
      requirement,
      scopeReason: scopeReason || (geometry.solid_count !== 1 ? 'Observed single-solid geometry is required for hole correspondence.' : null),
      faceClaims: generatedClaims,
      shape: shapesById.get(requirement.feature_id),
      cutToolIds,
      cylindricalFaces,
      toleranceMm,
      centerToleranceMm,
    });
    measurements.push(...requirementMeasurements);

    if (stepRoundtripAttempted) {
      const generatedMeasurementByType = new Map(
        requirementMeasurements
          .filter((measurement) => measurement.source === MEASUREMENT_SOURCES.GENERATED_SHAPE_GEOMETRY)
          .map((measurement) => [measurement.measurement_type, measurement])
      );
      const stepMeasurements = classifyHoleRequirement({
        requirement,
        scopeReason: scopeReason || (stepRoundtripGeometry?.solid_count !== 1 ? 'Observed single-solid STEP geometry is required for hole correspondence.' : null),
        faceClaims: stepClaims,
        shape: shapesById.get(requirement.feature_id),
        cutToolIds,
        cylindricalFaces: stepFaces,
        toleranceMm,
        centerToleranceMm,
        actualSource: MEASUREMENT_SOURCES.REIMPORTED_STEP_GEOMETRY,
        validationKind: REIMPORTED_STEP_GEOMETRY_CHECK,
        requirementSuffix: '_STEP_REIMPORT',
        geometryLabel: 'STEP re-imported geometry',
        sourceFieldPrefix: 'step_roundtrip.reimported_geometry.cylindrical_faces',
        generatedMeasurementByType,
      }).map((measurement) => {
        if (stepRoundtripGeometry) return measurement;
        return {
          ...measurement,
          message: `STEP re-import did not produce geometry for hole validation of ${requirement.feature_id}.`,
        };
      });
      measurements.push(...stepMeasurements);
    }

    for (const measurement of measurements.filter((entry) => entry.source_requirement_id === requirement.requirement_id)) {
      if (measurement.status !== 'pass') {
        const message = measurement.message || `Engineering measurement ${measurement.requirement_id} did not pass.`;
        if (measurement.required) blockingIssues.push(message);
        else warnings.push(message);
      }
    }
  }

  const status = (() => {
    if (blockingIssues.length > 0) return 'fail';
    if (warnings.length > 0) return 'warning';
    if (measurements.length > 0) return 'pass';
    return 'skipped';
  })();

  return {
    status,
    source: measurements.some((measurement) => measurement.source === MEASUREMENT_SOURCES.GENERATED_SHAPE_GEOMETRY)
      ? MEASUREMENT_SOURCES.GENERATED_SHAPE_GEOMETRY
      : MEASUREMENT_SOURCES.UNAVAILABLE,
    validation_kind: GENERATED_SHAPE_GEOMETRY_CHECK,
    measurements,
    measurement_provenance: buildEngineeringMeasurementProvenance({
      config,
      geometry: {
        ...geometry,
        engineering_measurements: measurements,
      },
    }),
    blocking_issues: uniqueStrings(blockingIssues),
    warnings: uniqueStrings(warnings),
  };
}

function normalizeBbox(source = null) {
  const bbox = source?.bbox || source?.bounding_box || source?.boundingBox || null;
  if (!bbox) return null;

  const min = normalizeVector3(bbox.min);
  const max = normalizeVector3(bbox.max);
  const size = normalizeVector3(bbox.size);
  if (!min || !max || !size) return null;

  return { min, max, size };
}

function coerceGeometry(source = null) {
  if (!source || typeof source !== 'object') {
    return {
      valid_shape: null,
      volume: null,
      area: null,
      bbox: null,
      cylindrical_faces: [],
      solid_count: null,
      face_count: null,
      edge_count: null,
    };
  }

  const bbox = normalizeBbox(source);
  const volume = finiteNumber(source.volume);
  const faceCount = finiteInteger(source.face_count ?? source.faces);
  const edgeCount = finiteInteger(source.edge_count ?? source.edges);

  return {
    valid_shape: booleanOrNull(source.valid_shape ?? source.validShape),
    volume,
    area: finiteNumber(source.area),
    bbox,
    cylindrical_faces: normalizeCylindricalFaces(source.cylindrical_faces),
    solid_count: finiteInteger(source.solid_count ?? source.solidCount),
    face_count: faceCount,
    edge_count: edgeCount,
  };
}

function coerceMeshMetrics(source = null) {
  if (!source || typeof source !== 'object') {
    return {
      triangle_count: null,
      watertight_or_closed: null,
      non_manifold_count: null,
      has_non_manifolds: null,
      bbox: null,
      corrupted_facets: null,
      invalid_points: null,
      invalid_neighbourhood: null,
    };
  }

  return {
    triangle_count: finiteInteger(source.triangle_count ?? source.facets),
    watertight_or_closed: booleanOrNull(source.watertight_or_closed),
    non_manifold_count: finiteInteger(source.non_manifold_count),
    has_non_manifolds: booleanOrNull(source.has_non_manifolds),
    bbox: normalizeBbox(source),
    corrupted_facets: booleanOrNull(source.corrupted_facets),
    invalid_points: booleanOrNull(source.invalid_points),
    invalid_neighbourhood: booleanOrNull(source.invalid_neighbourhood),
  };
}

function computeBboxDelta(sourceBbox = null, targetBbox = null) {
  if (!sourceBbox || !targetBbox) return null;

  const buildDelta = (left, right) => left.map((value, index) => roundNumber(Math.abs(value - right[index]), 4));
  const min = buildDelta(sourceBbox.min, targetBbox.min);
  const max = buildDelta(sourceBbox.max, targetBbox.max);
  const size = buildDelta(sourceBbox.size, targetBbox.size);
  const maxAbsMm = Math.max(...min, ...max, ...size);

  return {
    min,
    max,
    size,
    max_abs_mm: roundNumber(maxAbsMm, 4),
  };
}

function computeVolumeDeltaPercent(sourceVolume = null, targetVolume = null) {
  if (sourceVolume === null || targetVolume === null || sourceVolume <= 0) return null;
  return roundNumber(Math.abs(targetVolume - sourceVolume) / sourceVolume * 100, 4);
}

function collectPrimaryOutputs(createResult = {}) {
  const exports = Array.isArray(createResult.exports) ? createResult.exports : [];
  const findByFormat = (...formats) => {
    const expected = new Set(formats.map((value) => String(value).toLowerCase()));
    return exports.find((entry) => entry?.path && expected.has(String(entry.format).toLowerCase()))?.path || null;
  };

  return {
    step: findByFormat('step', 'stp'),
    stl: findByFormat('stl'),
    brep: findByFormat('brep', 'brp'),
    fcstd: findByFormat('fcstd'),
    per_part_stl: (createResult?.assembly?.part_files || [])
      .map((entry) => entry?.path)
      .filter((entry) => typeof entry === 'string' && entry.trim()),
  };
}

function collectGeometryIssues(geometry, blockingIssues, warnings, runtimeAvailable) {
  if (geometry.valid_shape === false) {
    blockingIssues.push('Generated model shape is invalid.');
  } else if (geometry.valid_shape === null) {
    (runtimeAvailable ? blockingIssues : warnings).push('Generated model validity observation is missing from create metadata.');
  }

  if (geometry.volume !== null && geometry.volume <= 0) {
    blockingIssues.push('Generated model volume is empty or non-positive.');
  }
  if (geometry.face_count !== null && geometry.face_count <= 0) {
    blockingIssues.push('Generated model face count is empty.');
  }
  if (geometry.edge_count !== null && geometry.edge_count <= 0) {
    blockingIssues.push('Generated model edge count is empty.');
  }
  if (geometry.bbox && geometry.bbox.size.every((value) => value <= 0)) {
    blockingIssues.push('Generated model bounding box is empty.');
  }
}

function evaluateRoundtrip({
  label,
  exportPath,
  inspection = null,
  geometry,
  thresholds,
  runtimeAvailable,
}) {
  const warnings = [];
  const blockingIssues = [];
  const report = {
    exported: Boolean(exportPath),
    reimport_attempted: Boolean(exportPath && runtimeAvailable),
    reimport_valid: null,
    volume_delta_percent: null,
    bbox_delta: null,
    reimported_geometry: null,
    warnings,
  };

  if (!exportPath) return { report, blockingIssues };

  if (!runtimeAvailable) {
    warnings.push(`${label.toUpperCase()} round-trip skipped because FreeCAD runtime is unavailable.`);
    return { report, blockingIssues };
  }

  if (!inspection) {
    blockingIssues.push(`${label.toUpperCase()} round-trip inspection result is missing.`);
    return { report, blockingIssues };
  }

  if (inspection.success === false) {
    blockingIssues.push(`${label.toUpperCase()} round-trip failed: ${inspection.error || inspection.message || 'unknown error'}`);
    return { report, blockingIssues };
  }

  const importedGeometry = coerceGeometry(inspection.model);
  report.reimported_geometry = importedGeometry;
  report.reimport_valid = importedGeometry.valid_shape;
  report.volume_delta_percent = computeVolumeDeltaPercent(geometry.volume, importedGeometry.volume);
  report.bbox_delta = computeBboxDelta(geometry.bbox, importedGeometry.bbox);

  if (importedGeometry.valid_shape === false) {
    blockingIssues.push(`${label.toUpperCase()} re-imported shape is invalid.`);
  } else if (importedGeometry.valid_shape === null) {
    blockingIssues.push(`${label.toUpperCase()} re-import validity observation is missing.`);
  }

  if (importedGeometry.volume !== null && importedGeometry.volume <= 0) {
    blockingIssues.push(`${label.toUpperCase()} re-import volume is empty or non-positive.`);
  }

  if (
    report.volume_delta_percent !== null
    && report.volume_delta_percent > thresholds.max_step_volume_delta_percent
  ) {
    blockingIssues.push(
      `${label.toUpperCase()} volume delta ${report.volume_delta_percent}% exceeds `
      + `${thresholds.max_step_volume_delta_percent}%.`
    );
  }

  if (
    report.bbox_delta?.max_abs_mm !== null
    && report.bbox_delta.max_abs_mm > thresholds.max_bbox_delta_mm
  ) {
    blockingIssues.push(
      `${label.toUpperCase()} bounding-box delta ${report.bbox_delta.max_abs_mm} mm exceeds `
      + `${thresholds.max_bbox_delta_mm} mm.`
    );
  }

  return { report, blockingIssues };
}

function evaluateStlQuality({
  exportPath,
  inspection = null,
  geometry,
  thresholds,
  runtimeAvailable,
}) {
  const warnings = [];
  const blockingIssues = [];
  const report = {
    exported: Boolean(exportPath),
    mesh_load_attempted: Boolean(exportPath && runtimeAvailable),
    triangle_count: null,
    watertight_or_closed: null,
    non_manifold_count: null,
    warnings,
  };

  if (!exportPath) return { report, blockingIssues };

  if (!runtimeAvailable) {
    warnings.push('STL mesh quality skipped because FreeCAD runtime is unavailable.');
    return { report, blockingIssues };
  }

  if (!inspection) {
    blockingIssues.push('STL mesh inspection result is missing.');
    return { report, blockingIssues };
  }

  if (inspection.success === false) {
    blockingIssues.push(`STL mesh inspection failed: ${inspection.error || inspection.message || 'unknown error'}`);
    return { report, blockingIssues };
  }

  const mesh = coerceMeshMetrics(inspection.model);
  report.triangle_count = mesh.triangle_count;
  report.watertight_or_closed = mesh.watertight_or_closed;
  report.non_manifold_count = mesh.non_manifold_count;

  if (mesh.triangle_count !== null && mesh.triangle_count <= 0) {
    blockingIssues.push('STL mesh triangle count is empty.');
  } else if (mesh.triangle_count === null) {
    warnings.push('STL mesh triangle count could not be determined.');
  }

  if (mesh.watertight_or_closed === false) {
    blockingIssues.push('STL mesh is not watertight or closed.');
  } else if (mesh.watertight_or_closed === null) {
    warnings.push('STL mesh closure status could not be determined.');
  }

  if (mesh.non_manifold_count !== null && mesh.non_manifold_count > 0) {
    blockingIssues.push(`STL mesh has ${mesh.non_manifold_count} non-manifold elements.`);
  } else if (mesh.has_non_manifolds === true) {
    blockingIssues.push('STL mesh has non-manifold topology.');
  }

  if (mesh.corrupted_facets === true) blockingIssues.push('STL mesh has corrupted facets.');
  if (mesh.invalid_points === true) blockingIssues.push('STL mesh has invalid points.');
  if (mesh.invalid_neighbourhood === true) blockingIssues.push('STL mesh has invalid facet neighbourhoods.');

  const bboxDelta = computeBboxDelta(geometry.bbox, mesh.bbox);
  if (bboxDelta?.max_abs_mm !== null && bboxDelta.max_abs_mm > thresholds.max_bbox_delta_mm) {
    const message = `STL bounding-box delta ${bboxDelta.max_abs_mm} mm exceeds ${thresholds.max_bbox_delta_mm} mm.`;
    warnings.push(message);
    blockingIssues.push(message);
  }

  return { report, blockingIssues };
}

export function createCreateQualityPath({
  primaryOutputPath = null,
  outputDir = null,
  inputPath = null,
  baseName = null,
} = {}) {
  if (primaryOutputPath) {
    const resolvedPath = resolve(primaryOutputPath);
    const parsed = parse(resolvedPath);
    return join(parsed.dir, `${parsed.name}_create_quality.json`);
  }

  const derivedBase = safeFilenameComponent(
    baseName || (inputPath ? parse(resolve(inputPath)).name : 'create'),
    'create'
  );

  if (outputDir) return join(resolve(outputDir), `${derivedBase}_create_quality.json`);
  if (inputPath) {
    const resolvedInput = resolve(inputPath);
    const parsed = parse(resolvedInput);
    return join(parsed.dir, `${parsed.name}_create_quality.json`);
  }
  return resolve(`${derivedBase}_create_quality.json`);
}

export function buildCreateQualityReport({
  inputConfigPath = null,
  config = {},
  createResult = {},
  inspections = {},
  runtimeAvailable = true,
  thresholds = DEFAULT_CREATE_QUALITY_THRESHOLDS,
}) {
  const mergedThresholds = {
    ...DEFAULT_CREATE_QUALITY_THRESHOLDS,
    ...(thresholds || {}),
  };
  for (const key of Object.keys(DEFAULT_CREATE_QUALITY_THRESHOLDS)) {
    if (measurementNumber(mergedThresholds[key]) === null || mergedThresholds[key] < 0) {
      throw new Error(`Invalid create-quality threshold ${key}: expected a finite nonnegative number.`);
    }
  }
  const geometry = coerceGeometry(createResult.model);
  const primaryOutputs = collectPrimaryOutputs(createResult);
  const blockingIssues = [];
  const warnings = [];

  collectGeometryIssues(geometry, blockingIssues, warnings, runtimeAvailable);

  const stepRoundtrip = evaluateRoundtrip({
    label: 'step',
    exportPath: primaryOutputs.step,
    inspection: inspections.step,
    geometry,
    thresholds: mergedThresholds,
    runtimeAvailable,
  });
  const brepRoundtrip = evaluateRoundtrip({
    label: 'brep',
    exportPath: primaryOutputs.brep,
    inspection: inspections.brep,
    geometry,
    thresholds: mergedThresholds,
    runtimeAvailable,
  });
  const stlQuality = evaluateStlQuality({
    exportPath: primaryOutputs.stl,
    inspection: inspections.stl,
    geometry,
    thresholds: mergedThresholds,
    runtimeAvailable,
  });
  const engineeringQuality = evaluateEngineeringQuality({
    config,
    geometry,
    stepRoundtripGeometry: stepRoundtrip.report.reimported_geometry,
    stepRoundtripAttempted: stepRoundtrip.report.reimport_attempted,
    thresholds: mergedThresholds,
  });

  blockingIssues.push(...stepRoundtrip.blockingIssues);
  blockingIssues.push(...brepRoundtrip.blockingIssues);
  blockingIssues.push(...stlQuality.blockingIssues);
  blockingIssues.push(...engineeringQuality.blocking_issues.map((issue) => `Engineering quality: ${issue}`));
  warnings.push(...stepRoundtrip.report.warnings);
  warnings.push(...brepRoundtrip.report.warnings);
  warnings.push(...stlQuality.report.warnings);
  warnings.push(...engineeringQuality.warnings.map((warning) => `Engineering quality: ${warning}`));

  const hasRuntimeDependentOutputs = Boolean(primaryOutputs.step || primaryOutputs.brep || primaryOutputs.stl);
  if (!runtimeAvailable && hasRuntimeDependentOutputs) {
    warnings.push('FreeCAD runtime unavailable; create export quality checks were skipped.');
  }

  const status = (() => {
    if (blockingIssues.length > 0) return 'fail';
    if (!runtimeAvailable && hasRuntimeDependentOutputs) return 'skipped';
    if (warnings.length > 0) return 'warning';
    return 'pass';
  })();

  const report = {
    schema_version: CREATE_QUALITY_SCHEMA_VERSION,
    command: 'create',
    input_config: inputConfigPath ? resolve(inputConfigPath) : null,
    primary_outputs: primaryOutputs,
    geometry,
    step_roundtrip: stepRoundtrip.report,
    brep_roundtrip: brepRoundtrip.report,
    stl_quality: stlQuality.report,
    engineering_quality: engineeringQuality,
    thresholds: mergedThresholds,
    status,
    blocking_issues: uniqueStrings(blockingIssues),
    warnings: uniqueStrings(warnings),
  };

  const validation = validateCreateQualityReport(report);
  if (!validation.ok) {
    throw new Error(`Invalid create quality report: ${validation.errors.join(' | ')}`);
  }

  return report;
}

export function shouldFailCreateQuality(report, strictQuality = false) {
  return Boolean(strictQuality && report?.status === 'fail');
}

export function validateCreateQualityReport(report) {
  const valid = validateQualityReport(report);
  return {
    ok: Boolean(valid),
    errors: valid ? [] : formatSchemaErrors(validateQualityReport.errors || []),
  };
}

export async function writeCreateQualityReport(reportPath, report) {
  const absPath = resolve(reportPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return absPath;
}
