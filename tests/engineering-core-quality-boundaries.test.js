// All geometry in this file is synthetic unit-test input, never runtime evidence.
import assert from 'node:assert/strict';
import {
  buildCreateQualityReport,
  validateCreateQualityReport,
  shouldFailCreateQuality,
} from '../lib/create-quality.js';

function config(name = 'arbitrary_part_name') {
  return {
    config_version: 1,
    name,
    shapes: [
      { id: 'plate', type: 'box', length: 40, width: 20, height: 4 },
      { id: 'hole', type: 'cylinder', radius: 3, height: 8, position: [10, 10, -2] },
    ],
    operations: [{ op: 'cut', base: 'plate', tool: 'hole', result: 'final' }],
    drawing_intent: {
      required_dimensions: [{
        id: 'HOLE_DIA', feature: 'hole', dimension_type: 'diameter',
        value_mm: 6, tolerance_mm: 0.05,
        expected_center_xy_mm: [10, 10], center_tolerance_mm: 0.2,
        required: true,
      }],
    },
  };
}

function geometry(overrides = {}) {
  return {
    valid_shape: true, volume: 3000, area: 1700,
    solid_count: 1, face_count: 7, edge_count: 15,
    bbox: { min: [0, 0, 0], max: [40, 20, 4], size: [40, 20, 4] },
    cylindrical_faces: [{
      face_index: 7, surface_type: 'Cylinder', radius_mm: 3, diameter_mm: 6,
      center_mm: [10, 10, 0], center_of_mass_mm: [10, 10, 2], axis: [0, 0, 1],
      bbox: { min: [7, 7, 0], max: [13, 13, 4], size: [6, 6, 4] },
      area_mm2: 75,
    }],
    ...overrides,
  };
}

function reportFor({ name = 'arbitrary_part_name', generated, reimported, runtimeAvailable = true, configValue = config(name), thresholds } = {}) {
  return buildCreateQualityReport({
    inputConfigPath: '/tmp/engineering-core-unit.toml',
    config: configValue,
    createResult: {
      model: generated ?? geometry(),
      exports: [{ format: 'step', path: '/tmp/engineering-core-unit.step', size_bytes: 1000 }],
    },
    inspections: { step: { success: true, model: reimported ?? geometry() } },
    runtimeAvailable,
    thresholds,
  });
}

const missingValidity = geometry();
delete missingValidity.valid_shape;
const unknown = reportFor({ generated: missingValidity });
assert.equal(unknown.geometry.valid_shape, null);
assert.notEqual(unknown.status, 'pass');
assert.equal(validateCreateQualityReport(unknown).ok, true);

const explicitInvalid = reportFor({ generated: geometry({ valid_shape: false }) });
assert.equal(explicitInvalid.geometry.valid_shape, false);
assert.notEqual(explicitInvalid.status, 'pass');

for (const value of [undefined, null, 'true', 1]) {
  const candidate = reportFor({ generated: geometry({ valid_shape: value }) });
  assert.equal(candidate.geometry.valid_shape, null);
  assert.equal(candidate.status, 'fail', 'unknown runtime observation must block strict quality');
  assert.ok(candidate.blocking_issues.some(message => /validity|observation/.test(message)));
  assert.equal(shouldFailCreateQuality(candidate, false), false);
  assert.equal(shouldFailCreateQuality(candidate, true), true);
}
const missingStep = reportFor({ reimported: geometry({ valid_shape: undefined }) });
assert.equal(missingStep.step_roundtrip.reimport_valid, null);
assert.equal(missingStep.status, 'fail');
assert.ok(missingStep.blocking_issues.some(message => /STEP.*(?:validity|observation)/.test(message)));
const unavailable = reportFor({ generated: missingValidity, runtimeAvailable: false });
assert.equal(unavailable.status, 'skipped');
assert.equal(unavailable.step_roundtrip.reimport_attempted, false);
assert.equal(reportFor().status, 'pass');
assert.equal(reportFor({ generated: geometry({ valid_shape: undefined, validShape: true }) }).geometry.valid_shape, true);
assert.equal(reportFor({ generated: geometry({ valid_shape: false, validShape: true }) }).geometry.valid_shape, false);
console.log('engineering core validity boundaries passed');
