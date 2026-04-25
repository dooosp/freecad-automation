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
  return roundNumber(Math.hypot(a[0] - b[0], a[1] - b[1]), 4);
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
  const cutTools = new Set();
  for (const operation of Array.isArray(config.operations) ? config.operations : []) {
    if (String(operation?.op || '').toLowerCase() !== 'cut') continue;
    if (typeof operation.tool === 'string' && operation.tool.trim()) {
      cutTools.add(operation.tool.trim());
    } else if (operation.tool && typeof operation.tool === 'object' && typeof operation.tool.id === 'string') {
      cutTools.add(operation.tool.id.trim());
    }
  }
  return cutTools;
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

    for (const featureId of normalizeFeatureRefs(dimension.feature)) {
      const expectedCenter = normalizeVector2(
        dimension.expected_center_xy_mm
          || dimension.expected_center_mm
          || dimension.center_xy_mm
          || dimension.center_mm
      );
      requirements.push({
        requirement_id: String(dimension.id || `${featureId}_DIA`).trim(),
        feature_id: featureId,
        measurement_type: 'hole_diameter',
        expected_value_mm: finiteNumber(dimension.value_mm ?? dimension.value),
        tolerance_mm: finiteNumber(dimension.tolerance_mm ?? dimension.tolerance),
        expected_center_xy_mm: expectedCenter,
        expected_center_source_field: expectedCenter
          ? configRequiredDimensionField(dimension.id || `${featureId}_DIA`, 'expected_center_xy_mm')
          : null,
        center_tolerance_mm: finiteNumber(dimension.center_tolerance_mm ?? dimension.position_tolerance_mm),
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
      const diameter = finiteNumber(entry?.diameter_mm) ?? (
        finiteNumber(entry?.radius_mm) !== null ? roundNumber(finiteNumber(entry.radius_mm) * 2, 4) : null
      );
      const center = normalizeVector3(entry?.center_mm)
        || normalizeVector3(entry?.center)
        || normalizeVector3(entry?.center_of_mass_mm);
      const centerXy = normalizeVector2(center);
      return {
        face_index: finiteInteger(entry?.face_index) ?? index + 1,
        surface_type: typeof entry?.surface_type === 'string' ? entry.surface_type : null,
        radius_mm: finiteNumber(entry?.radius_mm),
        diameter_mm: diameter,
        center_mm: center,
        center_xy_mm: centerXy,
        center_of_mass_mm: normalizeVector3(entry?.center_of_mass_mm),
        axis: normalizeVector3(entry?.axis),
        bbox: normalizeBbox(entry?.bbox),
        area_mm2: finiteNumber(entry?.area_mm2),
      };
    })
    .filter((entry) => entry.diameter_mm !== null && entry.center_xy_mm);
}

function expectedCenterXyForFeature(shape = null) {
  return normalizeVector2(shape?.position);
}

function expectedCenterXyForRequirement(requirement, shape = null) {
  return normalizeVector2(requirement?.expected_center_xy_mm) || expectedCenterXyForFeature(shape);
}

function holeFeatureIsAuthoredCutTool({ featureId, shape, cutToolIds }) {
  return Boolean(
    shape
    && String(shape.type || '').toLowerCase() === 'cylinder'
    && cutToolIds.has(featureId)
  );
}

function findBestCylindricalFaceMatch({
  requirement,
  expectedCenterXy,
  cylindricalFaces,
  toleranceMm,
  centerToleranceMm,
}) {
  const candidates = cylindricalFaces
    .map((face) => {
      const centerDelta = vector2Distance(face.center_xy_mm, expectedCenterXy);
      const diameterDelta = requirement.expected_value_mm !== null
        ? roundNumber(Math.abs(face.diameter_mm - requirement.expected_value_mm), 4)
        : null;
      return {
        face,
        center_delta_mm: centerDelta,
        diameter_delta_mm: diameterDelta,
      };
    })
    .filter((candidate) => candidate.center_delta_mm !== null);

  const byCenterThenDiameter = (left, right) => {
    const centerOrder = left.center_delta_mm - right.center_delta_mm;
    if (centerOrder !== 0) return centerOrder;
    return (left.diameter_delta_mm ?? Number.POSITIVE_INFINITY)
      - (right.diameter_delta_mm ?? Number.POSITIVE_INFINITY);
  };
  const byDiameterThenCenter = (left, right) => {
    const diameterOrder = (left.diameter_delta_mm ?? Number.POSITIVE_INFINITY)
      - (right.diameter_delta_mm ?? Number.POSITIVE_INFINITY);
    if (diameterOrder !== 0) return diameterOrder;
    return left.center_delta_mm - right.center_delta_mm;
  };

  const centerMatches = candidates
    .filter((candidate) => candidate.center_delta_mm <= centerToleranceMm)
    .sort(byCenterThenDiameter);
  if (centerMatches[0]) return centerMatches[0];

  const diameterMatches = candidates
    .filter((candidate) => (
      candidate.diameter_delta_mm !== null
      && candidate.diameter_delta_mm <= toleranceMm
    ))
    .sort(byDiameterThenCenter);
  if (diameterMatches[0]) return diameterMatches[0];

  return null;
}

function baseEngineeringMeasurement({
  requirement,
  measurementType,
  toleranceMm,
  centerToleranceMm,
}) {
  return {
    requirement_id: measurementType === 'hole_center'
      ? `${requirement.feature_id}_CENTER`
      : requirement.requirement_id,
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
    status: 'unavailable',
    required: requirement.required,
    source: MEASUREMENT_SOURCES.UNAVAILABLE,
    source_field: null,
    expected_source: MEASUREMENT_SOURCES.CONFIG_PARAMETER,
    expected_source_field: measurementType === 'hole_diameter'
      ? configRequiredDimensionField(requirement.requirement_id, 'value_mm')
      : requirement.expected_center_source_field || configShapeField(requirement.feature_id, 'position'),
    validation_kind: GENERATED_SHAPE_GEOMETRY_CHECK,
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
}) {
  const diameterBase = baseEngineeringMeasurement({
    requirement,
    measurementType: 'hole_diameter',
    toleranceMm,
    centerToleranceMm,
  });
  const centerBase = baseEngineeringMeasurement({
    requirement,
    measurementType: 'hole_center',
    toleranceMm,
    centerToleranceMm,
  });
  const expectedCenterXy = expectedCenterXyForRequirement(requirement, shape);
  const centerMeasurement = {
    ...centerBase,
    expected_center_xy_mm: expectedCenterXy,
  };

  if (requirement.expected_value_mm === null) {
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
        message: `Expected hole feature ${requirement.feature_id} is not an authored cylindrical cut tool.`,
      },
      {
        ...centerMeasurement,
        status: 'unavailable',
        message: `Expected hole center for ${requirement.feature_id} is unavailable because the authored feature is not a cylindrical cut tool.`,
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
    expectedCenterXy,
    cylindricalFaces,
    toleranceMm,
    centerToleranceMm,
  });

  if (!match) {
    return [
      {
        ...diameterBase,
        expected_center_xy_mm: expectedCenterXy,
        status: 'unavailable',
        message: `Generated geometry has no cylindrical hole face matching ${requirement.feature_id} within ${centerToleranceMm} mm center tolerance.`,
      },
      {
        ...centerMeasurement,
        status: 'unavailable',
        message: `Generated geometry has no cylindrical hole center matching ${requirement.feature_id} within ${centerToleranceMm} mm.`,
      },
    ];
  }

  const { face, diameter_delta_mm: diameterDelta, center_delta_mm: centerDelta } = match;
  const diameterStatus = diameterDelta > toleranceMm ? 'fail' : 'pass';
  const centerStatus = centerDelta > centerToleranceMm ? 'fail' : 'pass';
  const sourceField = `geometry.cylindrical_faces[face_index=${face.face_index}]`;

  return [
    {
      ...diameterBase,
      actual_value_mm: face.diameter_mm,
      source_value_mm: face.diameter_mm,
      expected_center_xy_mm: expectedCenterXy,
      actual_center_xy_mm: face.center_xy_mm,
      delta_mm: diameterDelta,
      center_delta_mm: centerDelta,
      status: diameterStatus,
      source: MEASUREMENT_SOURCES.GENERATED_SHAPE_GEOMETRY,
      source_field: `${sourceField}.diameter_mm`,
      matched_face_index: face.face_index,
      message: diameterStatus === 'pass'
        ? null
        : `Hole ${requirement.feature_id} generated diameter ${face.diameter_mm} mm differs from expected ${requirement.expected_value_mm} mm by ${diameterDelta} mm.`,
    },
    {
      ...centerMeasurement,
      actual_center_xy_mm: face.center_xy_mm,
      center_delta_mm: centerDelta,
      delta_mm: centerDelta,
      status: centerStatus,
      source: MEASUREMENT_SOURCES.GENERATED_SHAPE_GEOMETRY,
      source_field: `${sourceField}.center_mm`,
      matched_face_index: face.face_index,
      message: centerStatus === 'pass'
        ? null
        : `Hole ${requirement.feature_id} generated center differs from expected center by ${centerDelta} mm.`,
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
  for (const requirement of collectExpectedHoleDiameterRequirements(config)) {
    const diameterMeasurement = measurementsByKey.get(`${requirement.feature_id}:hole_diameter`);
    const centerMeasurement = measurementsByKey.get(`${requirement.feature_id}:hole_center`);
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
  }

  return records;
}

function evaluateEngineeringQuality({ config = {}, geometry = {}, thresholds = DEFAULT_CREATE_QUALITY_THRESHOLDS } = {}) {
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

  for (const requirement of requirements) {
    const toleranceMm = requirement.tolerance_mm ?? defaultTolerance;
    const centerToleranceMm = requirement.center_tolerance_mm ?? defaultCenterTolerance;
    const requirementMeasurements = classifyHoleRequirement({
      requirement,
      shape: shapesById.get(requirement.feature_id),
      cutToolIds,
      cylindricalFaces,
      toleranceMm,
      centerToleranceMm,
    });
    measurements.push(...requirementMeasurements);

    for (const measurement of requirementMeasurements) {
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
  const inferredValidShape = volume !== null && volume > 0 && faceCount !== null && faceCount > 0
    ? true
    : null;

  return {
    valid_shape: booleanOrNull(source.valid_shape ?? source.validShape) ?? inferredValidShape,
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

function collectGeometryIssues(geometry, blockingIssues, warnings) {
  if (geometry.valid_shape === false) {
    blockingIssues.push('Generated model shape is invalid.');
  } else if (geometry.valid_shape === null) {
    warnings.push('Generated model validity could not be determined from create metadata.');
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
  report.reimport_valid = importedGeometry.valid_shape;
  report.volume_delta_percent = computeVolumeDeltaPercent(geometry.volume, importedGeometry.volume);
  report.bbox_delta = computeBboxDelta(geometry.bbox, importedGeometry.bbox);

  if (importedGeometry.valid_shape === false) {
    blockingIssues.push(`${label.toUpperCase()} re-imported shape is invalid.`);
  } else if (importedGeometry.valid_shape === null) {
    warnings.push(`${label.toUpperCase()} re-import validity could not be determined.`);
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
  const geometry = coerceGeometry(createResult.model);
  const primaryOutputs = collectPrimaryOutputs(createResult);
  const blockingIssues = [];
  const warnings = [];

  collectGeometryIssues(geometry, blockingIssues, warnings);

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
