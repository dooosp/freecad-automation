// All geometry in this file is synthetic unit-test input, never runtime evidence.
import assert from 'node:assert/strict';
import { test } from 'node:test';
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

test('STEP checks are name independent and catch STEP-only diameter errors', () => {
const renamed = reportFor({ name: 'external_design_731' });
const stepRows = renamed.engineering_quality.measurements.filter(row => row.validation_kind === 'reimported_step_geometry_check');
assert.ok(stepRows.length > 0, 'supported geometry must be checked independently of config.name');
assert.ok(stepRows.every(row => row.source === 'reimported_step_geometry'));
assert.deepEqual(renamed.engineering_quality, reportFor({ name: 'quality_pass_bracket' }).engineering_quality);
const changedStep = geometry();
changedStep.cylindrical_faces[0] = { ...changedStep.cylindrical_faces[0], radius_mm: 4, diameter_mm: 8 };
const wrongDiameter = reportFor({ reimported: changedStep });
const wrongRow = wrongDiameter.engineering_quality.measurements.find(row => row.validation_kind === 'reimported_step_geometry_check' && row.measurement_type === 'hole_diameter');
assert.equal(wrongRow.status, 'fail');
assert.equal(wrongRow.actual_value_mm, 8);
assert.equal(wrongRow.expected_value_mm, 6);
assert.equal(wrongDiameter.status, 'fail');

});

function requireUnavailable(candidate, label) {
  assert.notEqual(candidate.status, 'pass', label);
  const rows = candidate.engineering_quality.measurements.filter(row => row.validation_kind === 'reimported_step_geometry_check');
  assert.ok(rows.some(row => ['unavailable', 'missing', 'fail'].includes(row.status)), label);
  assert.equal(validateCreateQualityReport(candidate).ok, true, label);
}
for (const [label, face] of [
  ['moved center', { center_mm: [12, 10, 0] }],
  ['wrong axis', { axis: [1, 0, 0] }],
  ['missing axis', { axis: undefined }],
  ['zero axis', { axis: [0, 0, 0] }],
  ['invalid axis', { axis: [0, 0, '1'] }],
  ['missing axis center', { center_mm: undefined }],
  ['invalid center', { center_mm: [10, '10', 0] }],
]) {
  test(label, () => {
  const observed = geometry();
  observed.cylindrical_faces[0] = { ...observed.cylindrical_faces[0], ...face };
  requireUnavailable(reportFor({ reimported: observed }), label);
  });
}
test('missing face', () => requireUnavailable(reportFor({ reimported: geometry({ cylindrical_faces: [] }) }), 'missing face'));
test('ambiguous faces and duplicate consumption', () => {
const ambiguous = geometry();
ambiguous.cylindrical_faces.push({ ...ambiguous.cylindrical_faces[0], face_index: 8 });
requireUnavailable(reportFor({ reimported: ambiguous }), 'ambiguous faces');
const duplicate = config();
duplicate.shapes.push({ ...duplicate.shapes[1], id: 'second_hole' });
duplicate.operations.push({ op: 'cut', base: 'final', tool: 'second_hole', result: 'final_two' });
duplicate.drawing_intent.required_dimensions.push({ ...duplicate.drawing_intent.required_dimensions[0], id: 'SECOND_DIA', feature: 'second_hole' });
const doubleUse = reportFor({ configValue: duplicate });
for (const kind of ['generated_shape_geometry_check', 'reimported_step_geometry_check']) {
  assert.ok(doubleUse.engineering_quality.measurements.filter(row => row.validation_kind === kind && row.measurement_type === 'hole_diameter').every(row => row.status === 'unavailable'), 'one observed face cannot verify two distinct holes');
}
});

for (const value of [-0.1, Infinity, NaN, '0.05']) {
  for (const field of ['tolerance_mm', 'center_tolerance_mm']) {
    test(`invalid ${field}: ${value}`, () => {
    const invalid = config(); invalid.drawing_intent.required_dimensions[0][field] = value;
    requireUnavailable(reportFor({ configValue: invalid }), `invalid ${field}: ${value}`);
    });
  }
}
for (const [index, mutate] of [
  c => { c.shapes[1].direction = [0, 1, 0]; },
  c => { c.shapes[1].rotation = [1, 0, 0, 90]; },
  c => { delete c.shapes[1].position; },
  c => { c.drawing_intent.required_dimensions[0].expected_center_xy_mm = [10, Infinity]; },
  c => { c.final = 'plate'; },
  c => { c.shapes.push({ ...c.shapes[1] }); },
  c => { c.assembly = { parts: [] }; },
].entries()) {
  test(`unsupported authored input ${index}`, () => {
  const unsupported = config(); mutate(unsupported);
  requireUnavailable(reportFor({ configValue: unsupported }), 'unsupported/ambiguous authored input');
  });
}
test('local face index, axis direction and observed wrong authored center', () => {
const reorderedFace = geometry(); reorderedFace.cylindrical_faces[0].face_index = 99;
assert.equal(reportFor({ reimported: reorderedFace }).status, 'pass', 'face index is only local observation provenance');
const negativeZ = geometry(); negativeZ.cylindrical_faces[0].axis = [0, 0, -1];
assert.equal(reportFor({ reimported: negativeZ }).status, 'pass');
const authoredWrongCenter = config(); authoredWrongCenter.shapes[1].position[0] = 12;
const matchingAuthored = geometry(); matchingAuthored.cylindrical_faces[0].center_mm[0] = 12;
const centerError = reportFor({ configValue: authoredWrongCenter, generated: matchingAuthored, reimported: matchingAuthored });
assert.ok(centerError.engineering_quality.measurements.some(row => row.measurement_type === 'hole_center' && row.status === 'fail' && row.actual_center_xy_mm[0] === 12));
});

test('face outside cutter depth is not identified by XY/diameter alone', () => {
  const observed = geometry();
  observed.cylindrical_faces[0].bbox = { min: [7, 7, 100], max: [13, 13, 104], size: [6, 6, 4] };
  requireUnavailable(reportFor({ reimported: observed }), 'face outside cutter depth');
});
test('nonfinite or negative global measurement tolerances are rejected', () => {
  for (const value of [-1, Infinity, NaN, '0.05']) {
    assert.throws(() => reportFor({ thresholds: { max_engineering_dimension_delta_mm: value } }), /threshold/i);
  }
});
test('small differences are compared before presentation rounding', () => {
  const exact = config(); exact.drawing_intent.required_dimensions[0].tolerance_mm = 0;
  const observed = geometry(); observed.cylindrical_faces[0].diameter_mm = 6.000001;
  assert.equal(reportFor({ configValue: exact, reimported: observed }).status, 'fail');
});

test('later fusion cannot prove a hole from an outer boss face', () => {
  const filled = config();
  filled.shapes.push({ id: 'plug', type: 'cylinder', radius: 3, height: 6, position: [10, 10, 0] });
  filled.operations.push({ op: 'fuse', base: 'final', tool: 'plug', result: 'filled' });
  const observed = geometry();
  observed.cylindrical_faces[0].bbox = { min: [7, 7, 4], max: [13, 13, 6], size: [6, 6, 2] };
  requireUnavailable(reportFor({ configValue: filled, generated: observed, reimported: observed }), 'filled hole with exterior boss');
});
test('required diameter intents cannot disappear when feature/requirement links are missing', () => {
  for (const field of ['feature', 'id']) {
    for (const value of [undefined, '', []]) {
      const missing = config(); missing.drawing_intent.required_dimensions[0][field] = value;
      requireUnavailable(reportFor({ configValue: missing }), `missing ${field}`);
    }
  }
});
test('non-cylinder surface evidence is unavailable', () => {
  const observed = geometry(); observed.cylindrical_faces[0].surface_type = 'Plane';
  requireUnavailable(reportFor({ reimported: observed }), 'non-cylinder evidence');
});

test('a cutter overwritten before use is outside primitive-cylinder support', () => {
  const modified = config();
  modified.shapes.push({ id: 'trim', type: 'box', length: 2, width: 10, height: 10 });
  modified.operations.unshift({ op: 'cut', base: 'hole', tool: 'trim', result: 'hole' });
  requireUnavailable(reportFor({ configValue: modified }), 'overwritten cylinder tool');
});

test('decimal diameter tolerance accepts the boundary and rejects values beyond it', () => {
  const c = config(); c.shapes[1].radius = 4; c.drawing_intent.required_dimensions[0].value_mm = 8;
  for (const [actual, expected] of [[8.05, 'pass'], [7.95, 'pass'], [8.050000000000002, 'fail'], [8.050001, 'fail'], [7.949999, 'fail']]) {
    const observed = geometry(); observed.cylindrical_faces[0].diameter_mm = actual;
    const report = reportFor({ configValue: c, generated: observed, reimported: observed });
    assert(report.engineering_quality.measurements.filter(r => r.measurement_type === 'hole_diameter').every(r => r.status === expected), String(actual));
  }
});
test('decimal center tolerance applies to candidate matching and final measurement', () => {
  const c = config(); c.shapes[1].position = [125, 10, -2];
  c.drawing_intent.required_dimensions[0].expected_center_xy_mm = [125, 10];
  for (const [x, expected] of [[125.2, 'pass'], [124.8, 'pass'], [125.200001, 'unavailable']]) {
    const observed = geometry(); observed.cylindrical_faces[0].center_mm = [x, 10, 0];
    const report = reportFor({ configValue: c, generated: observed, reimported: observed });
    assert(report.engineering_quality.measurements.filter(r => r.measurement_type === 'hole_center').every(r => r.status === expected), String(x));
  }
});
test('decimal tolerance preserves exponent notation and two-dimensional distance', () => {
  const c = config();
  c.drawing_intent.required_dimensions[0].tolerance_mm = 1e-7;
  for (const [diameter, expected] of [[6.0000001, 'pass'], [6.000000100000001, 'fail']]) {
    const observed = geometry(); observed.cylindrical_faces[0].diameter_mm = diameter;
    const report = reportFor({ configValue: c, reimported: observed });
    assert.equal(report.engineering_quality.measurements.find(r => r.validation_kind === 'reimported_step_geometry_check' && r.measurement_type === 'hole_diameter').status, expected);
  }
  c.drawing_intent.required_dimensions[0].center_tolerance_mm = 0.5;
  for (const [center, expected] of [[[10.3, 10.4], 'pass'], [[10.300001, 10.4], 'unavailable']]) {
    const observed = geometry(); observed.cylindrical_faces[0].center_mm = [...center, 0];
    const report = reportFor({ configValue: c, reimported: observed });
    assert.equal(report.engineering_quality.measurements.find(r => r.validation_kind === 'reimported_step_geometry_check' && r.measurement_type === 'hole_center').status, expected);
  }
});
