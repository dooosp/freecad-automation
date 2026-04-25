import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  buildCreateQualityReport,
  createCreateQualityPath,
  shouldFailCreateQuality,
  validateCreateQualityReport,
} from '../lib/create-quality.js';
import { loadConfigWithDiagnostics } from '../lib/config-schema.js';

const ROOT = resolve(import.meta.dirname, '..');

async function loadExampleConfig(name) {
  return (await loadConfigWithDiagnostics(resolve(ROOT, 'configs', 'examples', `${name}.toml`))).config;
}

function makeGeometry(overrides = {}) {
  return {
    valid_shape: true,
    volume: 100,
    area: 180,
    solid_count: 1,
    face_count: 12,
    edge_count: 24,
    bbox: {
      min: [0, 0, 0],
      max: [10, 20, 5],
      size: [10, 20, 5],
    },
    ...overrides,
  };
}

function makeCreateResult(overrides = {}) {
  const modelOverrides = overrides.model || {};
  const rest = { ...overrides };
  delete rest.model;
  return {
    model: {
      valid_shape: true,
      volume: 100,
      area: 180,
      solid_count: 1,
      face_count: 12,
      edge_count: 24,
      bounding_box: {
        min: [0, 0, 0],
        max: [10, 20, 5],
        size: [10, 20, 5],
      },
      ...modelOverrides,
    },
    exports: [
      { format: 'step', path: '/tmp/sample.step', size_bytes: 1000 },
      { format: 'stl', path: '/tmp/sample.stl', size_bytes: 800 },
      { format: 'brep', path: '/tmp/sample.brep', size_bytes: 1200 },
    ],
    assembly: {
      part_files: [
        { path: '/tmp/sample__part_a.stl', size_bytes: 300 },
      ],
    },
    ...rest,
  };
}

function provenanceById(report) {
  return new Map(
    report.engineering_quality.measurement_provenance.map((entry) => [entry.measurement_id, entry])
  );
}

function cylindricalFace(faceIndex, diameterMm, centerMm) {
  return {
    face_index: faceIndex,
    surface_type: 'Cylinder',
    radius_mm: diameterMm / 2,
    diameter_mm: diameterMm,
    center_mm: centerMm,
    center_of_mass_mm: centerMm,
    axis: [0, 0, 1],
    bbox: {
      min: [centerMm[0] - diameterMm / 2, centerMm[1] - diameterMm / 2, 0],
      max: [centerMm[0] + diameterMm / 2, centerMm[1] + diameterMm / 2, 8],
      size: [diameterMm, diameterMm, 8],
    },
    area_mm2: 100,
  };
}

function engineeringMeasurement(report, requirementId) {
  return report.engineering_quality.measurements.find((entry) => entry.requirement_id === requirementId);
}

const passingReport = buildCreateQualityReport({
  inputConfigPath: '/tmp/sample.toml',
  createResult: makeCreateResult(),
  runtimeAvailable: true,
  inspections: {
    step: {
      success: true,
      model: {
        valid_shape: true,
        volume: 100.2,
        area: 180.1,
        solid_count: 1,
        face_count: 12,
        edge_count: 24,
        bounding_box: {
          min: [0, 0, 0],
          max: [10.05, 20.02, 5.01],
          size: [10.05, 20.02, 5.01],
        },
      },
    },
    brep: {
      success: true,
      model: makeGeometry({
        volume: 100.1,
        bbox: {
          min: [0, 0, 0],
          max: [10.03, 20.01, 5.01],
          size: [10.03, 20.01, 5.01],
        },
      }),
    },
    stl: {
      success: true,
      model: {
        triangle_count: 256,
        points: 130,
        watertight_or_closed: true,
        non_manifold_count: null,
        bbox: {
          min: [0, 0, 0],
          max: [10.02, 20.01, 5.01],
          size: [10.02, 20.01, 5.01],
        },
      },
    },
  },
});

const passingValidation = validateCreateQualityReport(passingReport);
assert.equal(passingValidation.ok, true, passingValidation.errors.join('\n'));
const legacyCompatibleReport = { ...passingReport };
delete legacyCompatibleReport.engineering_quality;
const legacyCompatibleValidation = validateCreateQualityReport(legacyCompatibleReport);
assert.equal(legacyCompatibleValidation.ok, true, legacyCompatibleValidation.errors.join('\n'));
assert.equal(passingReport.status, 'pass');
assert.equal(passingReport.primary_outputs.step, '/tmp/sample.step');
assert.deepEqual(passingReport.primary_outputs.per_part_stl, ['/tmp/sample__part_a.stl']);
assert.equal(passingReport.step_roundtrip.reimport_valid, true);
assert.equal(passingReport.stl_quality.triangle_count, 256);
assert.equal(shouldFailCreateQuality(passingReport, false), false);
assert.equal(shouldFailCreateQuality(passingReport, true), false);

const failingReport = buildCreateQualityReport({
  inputConfigPath: '/tmp/sample.toml',
  createResult: makeCreateResult(),
  runtimeAvailable: true,
  inspections: {
    step: {
      success: true,
      model: makeGeometry({
        volume: 103,
        bbox: {
          min: [0, 0, 0],
          max: [10.4, 20.3, 5.2],
          size: [10.4, 20.3, 5.2],
        },
      }),
    },
    stl: {
      success: true,
      model: {
        triangle_count: 0,
        points: 0,
        watertight_or_closed: false,
        non_manifold_count: null,
        bbox: {
          min: [0, 0, 0],
          max: [0, 0, 0],
          size: [0, 0, 0],
        },
      },
    },
    brep: {
      success: false,
      error: 'BREP re-import failed',
    },
  },
});

assert.equal(failingReport.status, 'fail');
assert.equal(failingReport.blocking_issues.length >= 3, true);
assert.equal(shouldFailCreateQuality(failingReport, false), false);
assert.equal(shouldFailCreateQuality(failingReport, true), true);

const skippedReport = buildCreateQualityReport({
  inputConfigPath: '/tmp/sample.toml',
  createResult: makeCreateResult(),
  runtimeAvailable: false,
  inspections: {},
});

assert.equal(skippedReport.status, 'skipped');
assert.match(skippedReport.warnings.join('\n'), /runtime unavailable/i);
assert.equal(skippedReport.step_roundtrip.reimport_attempted, false);
assert.equal(skippedReport.stl_quality.mesh_load_attempted, false);

const qualityPassConfig = await loadExampleConfig('quality_pass_bracket');
const qualityPassEngineeringReport = buildCreateQualityReport({
  inputConfigPath: '/tmp/quality_pass_bracket.toml',
  config: qualityPassConfig,
  createResult: makeCreateResult({
    model: {
      bounding_box: {
        min: [0, 0, 0],
        max: [160, 100, 8],
        size: [160, 100, 8],
      },
      cylindrical_faces: [
        cylindricalFace(7, 6, [30, 30, 4]),
        cylindricalFace(12, 10, [125, 70, 4]),
      ],
    },
    exports: [],
    assembly: { part_files: [] },
  }),
  runtimeAvailable: true,
  inspections: {},
});

assert.equal(qualityPassEngineeringReport.status, 'pass');
assert.equal(qualityPassEngineeringReport.engineering_quality.status, 'pass');
assert.equal(qualityPassEngineeringReport.engineering_quality.source, 'generated_shape_geometry');
assert.equal(qualityPassEngineeringReport.engineering_quality.validation_kind, 'generated_shape_geometry_check');
assert.equal(
  qualityPassEngineeringReport.engineering_quality.measurements.every((entry) => entry.status === 'pass'),
  true
);
assert.equal(
  qualityPassEngineeringReport.engineering_quality.measurements.every((entry) => entry.source === 'generated_shape_geometry'),
  true
);
assert.equal(
  qualityPassEngineeringReport.engineering_quality.measurements.every((entry) => entry.validation_kind === 'generated_shape_geometry_check'),
  true
);
const qualityPassProvenance = provenanceById(qualityPassEngineeringReport);
assert.equal(qualityPassProvenance.get('bbox')?.source, 'generated_shape_geometry');
assert.equal(qualityPassProvenance.get('bbox')?.report_field, 'geometry.bbox');
assert.equal(qualityPassProvenance.get('thickness')?.source, 'generated_shape_geometry');
assert.equal(qualityPassProvenance.get('thickness')?.report_field, 'geometry.bbox.size[2]');
assert.equal(qualityPassProvenance.get('volume')?.source, 'generated_shape_geometry');
assert.equal(qualityPassProvenance.get('volume')?.report_field, 'geometry.volume');
assert.equal(qualityPassProvenance.get('hole_left_diameter')?.source, 'generated_shape_geometry');
assert.equal(qualityPassProvenance.get('hole_left_diameter')?.source_field, 'geometry.cylindrical_faces[face_index=7].diameter_mm');
assert.equal(qualityPassProvenance.get('hole_left_center')?.source, 'generated_shape_geometry');
assert.equal(qualityPassProvenance.get('hole_left_center')?.source_field, 'geometry.cylindrical_faces[face_index=7].center_mm');
assert.equal(qualityPassProvenance.get('hole_right_diameter')?.source, 'generated_shape_geometry');
assert.equal(qualityPassProvenance.get('hole_right_diameter')?.source_field, 'geometry.cylindrical_faces[face_index=12].diameter_mm');
assert.equal(qualityPassProvenance.get('hole_right_center')?.source, 'generated_shape_geometry');
assert.equal(qualityPassProvenance.get('hole_right_center')?.source_field, 'geometry.cylindrical_faces[face_index=12].center_mm');
assert.equal(engineeringMeasurement(qualityPassEngineeringReport, 'HOLE_LEFT_DIA')?.actual_value_mm, 6);
assert.deepEqual(engineeringMeasurement(qualityPassEngineeringReport, 'hole_left_CENTER')?.actual_center_xy_mm, [30, 30]);
assert.equal(engineeringMeasurement(qualityPassEngineeringReport, 'HOLE_RIGHT_DIA')?.actual_value_mm, 10);
assert.deepEqual(engineeringMeasurement(qualityPassEngineeringReport, 'hole_right_CENTER')?.actual_center_xy_mm, [125, 70]);

const wrongHoleDiameterConfig = await loadExampleConfig('quality_fail_wrong_hole_diameter');
const wrongHoleDiameterReport = buildCreateQualityReport({
  inputConfigPath: '/tmp/quality_fail_wrong_hole_diameter.toml',
  config: wrongHoleDiameterConfig,
  createResult: makeCreateResult({
    model: {
      bounding_box: {
        min: [0, 0, 0],
        max: [160, 100, 8],
        size: [160, 100, 8],
      },
      cylindrical_faces: [
        cylindricalFace(7, 8, [30, 30, 4]),
        cylindricalFace(12, 10, [125, 70, 4]),
      ],
    },
    exports: [],
    assembly: { part_files: [] },
  }),
  runtimeAvailable: true,
  inspections: {},
});

assert.equal(wrongHoleDiameterReport.status, 'fail');
assert.equal(wrongHoleDiameterReport.engineering_quality.status, 'fail');
assert.equal(shouldFailCreateQuality(wrongHoleDiameterReport, true), true);
assert.equal(engineeringMeasurement(wrongHoleDiameterReport, 'HOLE_LEFT_DIA')?.status, 'fail');
assert.equal(engineeringMeasurement(wrongHoleDiameterReport, 'HOLE_LEFT_DIA')?.source_value_mm, 8);
assert.equal(engineeringMeasurement(wrongHoleDiameterReport, 'HOLE_LEFT_DIA')?.source, 'generated_shape_geometry');
assert.equal(engineeringMeasurement(wrongHoleDiameterReport, 'HOLE_LEFT_DIA')?.expected_source, 'config_parameter');
assert.equal(engineeringMeasurement(wrongHoleDiameterReport, 'HOLE_LEFT_DIA')?.validation_kind, 'generated_shape_geometry_check');
assert.equal(provenanceById(wrongHoleDiameterReport).get('hole_left_diameter')?.source, 'generated_shape_geometry');

const wrongHoleCenterConfig = await loadExampleConfig('quality_fail_wrong_hole_center');
const wrongHoleCenterReport = buildCreateQualityReport({
  inputConfigPath: '/tmp/quality_fail_wrong_hole_center.toml',
  config: wrongHoleCenterConfig,
  createResult: makeCreateResult({
    model: {
      bounding_box: {
        min: [0, 0, 0],
        max: [160, 100, 8],
        size: [160, 100, 8],
      },
      cylindrical_faces: [
        cylindricalFace(7, 6, [32, 30, 4]),
        cylindricalFace(12, 10, [125, 70, 4]),
      ],
    },
    exports: [],
    assembly: { part_files: [] },
  }),
  runtimeAvailable: true,
  inspections: {},
});

assert.equal(wrongHoleCenterReport.status, 'fail');
assert.equal(wrongHoleCenterReport.engineering_quality.status, 'fail');
assert.equal(shouldFailCreateQuality(wrongHoleCenterReport, true), true);
assert.equal(engineeringMeasurement(wrongHoleCenterReport, 'HOLE_LEFT_DIA')?.status, 'pass');
const wrongHoleCenterMeasurement = engineeringMeasurement(wrongHoleCenterReport, 'hole_left_CENTER');
assert.equal(wrongHoleCenterMeasurement?.status, 'fail');
assert.equal(wrongHoleCenterMeasurement?.source, 'generated_shape_geometry');
assert.equal(wrongHoleCenterMeasurement?.validation_kind, 'generated_shape_geometry_check');
assert.deepEqual(wrongHoleCenterMeasurement?.expected_center_xy_mm, [30, 30]);
assert.deepEqual(wrongHoleCenterMeasurement?.actual_center_xy_mm, [32, 30]);
assert.equal(wrongHoleCenterMeasurement?.tolerance_mm, 0.2);
assert.equal(wrongHoleCenterMeasurement?.center_delta_mm, 2);
assert.equal(wrongHoleCenterMeasurement?.expected_source, 'config_parameter');
assert.equal(
  wrongHoleCenterMeasurement?.expected_source_field,
  'config.drawing_intent.required_dimensions[id=HOLE_LEFT_DIA].expected_center_xy_mm'
);
assert.equal(provenanceById(wrongHoleCenterReport).get('hole_left_center')?.source, 'generated_shape_geometry');
assert.equal(provenanceById(wrongHoleCenterReport).get('hole_left_center')?.value?.[0], 32);

const missingExpectedHoleReport = buildCreateQualityReport({
  inputConfigPath: '/tmp/missing-hole.toml',
  config: {
    shapes: [],
    operations: [],
    drawing_intent: {
      required_dimensions: [
        {
          id: 'MISSING_HOLE_DIA',
          feature: 'missing_hole',
          dimension_type: 'diameter',
          value_mm: 6,
          required: true,
        },
      ],
    },
  },
  createResult: makeCreateResult({
    exports: [],
    assembly: { part_files: [] },
  }),
  runtimeAvailable: true,
  inspections: {},
});

assert.equal(missingExpectedHoleReport.status, 'fail');
assert.equal(missingExpectedHoleReport.engineering_quality.status, 'fail');
assert.equal(missingExpectedHoleReport.engineering_quality.measurements[0].status, 'missing');
assert.equal(missingExpectedHoleReport.engineering_quality.measurements[0].source, 'unavailable');
assert.notEqual(missingExpectedHoleReport.engineering_quality.measurements[0].status, 'pass');

const unavailableHoleMeasurementReport = buildCreateQualityReport({
  inputConfigPath: '/tmp/unavailable-hole.toml',
  config: {
    shapes: [
      { id: 'hole_without_measurement', type: 'cylinder', radius: 3, height: 8, position: [30, 30, -1] },
    ],
    operations: [
      { op: 'cut', base: 'plate', tool: 'hole_without_measurement', result: 'body' },
    ],
    drawing_intent: {
      required_dimensions: [
        {
          id: 'UNAVAILABLE_HOLE_DIA',
          feature: 'hole_without_measurement',
          dimension_type: 'diameter',
          value_mm: 6,
          required: true,
        },
      ],
    },
  },
  createResult: makeCreateResult({
    exports: [],
    assembly: { part_files: [] },
  }),
  runtimeAvailable: true,
  inspections: {},
});

assert.equal(unavailableHoleMeasurementReport.status, 'fail');
assert.equal(unavailableHoleMeasurementReport.engineering_quality.status, 'fail');
assert.equal(unavailableHoleMeasurementReport.engineering_quality.measurements[0].status, 'unavailable');
assert.equal(unavailableHoleMeasurementReport.engineering_quality.measurements[0].source, 'unavailable');
assert.notEqual(unavailableHoleMeasurementReport.engineering_quality.measurements[0].status, 'pass');
assert.equal(unavailableHoleMeasurementReport.engineering_quality.measurements[1].status, 'unavailable');
assert.equal(unavailableHoleMeasurementReport.engineering_quality.measurements[1].source, 'unavailable');
assert.equal(unavailableHoleMeasurementReport.engineering_quality.measurements[1].actual_center_xy_mm, null);
assert.notEqual(unavailableHoleMeasurementReport.engineering_quality.measurements[1].status, 'pass');

assert.equal(
  createCreateQualityPath({
    primaryOutputPath: '/tmp/sample.step',
  }),
  '/tmp/sample_create_quality.json'
);

console.log('create-quality.test.js: ok');
