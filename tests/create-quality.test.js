import assert from 'node:assert/strict';

import {
  buildCreateQualityReport,
  createCreateQualityPath,
  shouldFailCreateQuality,
  validateCreateQualityReport,
} from '../lib/create-quality.js';

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
    ...overrides,
  };
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

assert.equal(
  createCreateQualityPath({
    primaryOutputPath: '/tmp/sample.step',
  }),
  '/tmp/sample_create_quality.json'
);

console.log('create-quality.test.js: ok');
