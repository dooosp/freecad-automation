// Synthetic observations only. Actual CAD runs belong to the runtime lane.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCreateQualityReport, validateCreateQualityReport } from '../lib/create-quality.js';
import { validateRevisionImpactSemanticArtifact, collectRevisionImpactSemanticRecords } from '../src/services/revision-impact/revision-impact-semantic-adapters.js';
import { buildQualityDashboardModel } from '../public/js/studio/quality-dashboard.js';

function config() {
  return { name: 'arbitrary_y_hole', shapes: [
    { id: 'body', type: 'box', length: 90, width: 50, height: 38 },
    { id: 'pin', type: 'cylinder', radius: 4, height: 24, position: [21, 28, 27], direction: [0, 1, 0] },
  ], operations: [{ op: 'cut', base: 'body', tool: 'pin', result: 'final' }],
  drawing_intent: { required_dimensions: [{ id: 'PIN_DIA', feature: 'pin', dimension_type: 'diameter', value_mm: 8, expected_center_xz_mm: [21, 27], tolerance_mm: 0.05, center_tolerance_mm: 0.2, required: true }] } };
}
function geometry() {
  return { valid_shape: true, solid_count: 1, volume: 10000, area: 5000, face_count: 7, edge_count: 15,
    bbox: { min: [0, 0, 0], max: [90, 50, 38], size: [90, 50, 38] }, cylindrical_faces: [
      { face_index: 7, surface_type: 'Cylinder', radius_mm: 4, diameter_mm: 8, center_mm: [21, 28, 27], axis: [0, 1, 0],
        bbox: { min: [17, 32, 23], max: [25, 46, 31], size: [8, 14, 8] }, area_mm2: 351.8584 },
    ] };
}
function report({ c = config(), generated = geometry(), step = geometry() } = {}) {
  return JSON.parse(JSON.stringify(buildCreateQualityReport({ config: c, createResult: { model: generated, exports: [{ format: 'step', path: 'synthetic/y.step', size_bytes: 1000 }] }, inspections: { step: { success: true, model: step } }, runtimeAvailable: true })));
}
const rows = r => r.engineering_quality.measurements;
const stepRow = (r, type) => rows(r).find(m => m.validation_kind === 'reimported_step_geometry_check' && m.measurement_type === type);
function dashboard(r) {
  const artifact = { id: 'quality', key: 'create_quality', type: 'model.quality-summary', file_name: 'create_quality.json', extension: '.json', exists: true };
  return buildQualityDashboardModel({ artifacts: [artifact], artifactPayloads: { quality: r } });
}

test('Y cylinders are measured in XZ independently for generated and STEP geometry', () => {
  const r = report(); assert.equal(r.status, 'pass'); assert.equal(rows(r).length, 4);
  for (const row of rows(r)) {
    assert.equal(row.hole_axis, 'y'); assert.equal(row.center_plane, 'xz');
    assert.equal(row.expected_center_xy_mm, null); assert.equal(row.actual_center_xy_mm, null);
    assert.deepEqual(row.expected_center_xz_mm, [21, 27]); assert.deepEqual(row.actual_center_xz_mm, [21, 27]);
    assert.equal(row.status, 'pass');
  }
  assert.equal(stepRow(r, 'hole_diameter').actual_value_mm, 8);
  assert.equal(stepRow(r, 'hole_center').source, 'reimported_step_geometry');
  assert.equal(validateCreateQualityReport(r).ok, true);
  for (const id of ['pin_center', 'pin_step_center']) {
    const p = r.engineering_quality.measurement_provenance.find(p => p.measurement_id === id);
    assert.deepEqual(p.value, [21, 27]); assert(p.report_field.endsWith('.actual_center_xz_mm'));
  }
});
test('axial center translation and reversed observed axis preserve cylinder identity', () => {
  const g = geometry(); g.cylindrical_faces[0].center_mm[1] = -500; g.cylindrical_faces[0].axis = [0, -1, 0]; g.cylindrical_faces[0].face_index = 90;
  const r = report({ step: g }); assert.equal(r.status, 'pass');
  assert.deepEqual(stepRow(r, 'hole_center').actual_center_xz_mm, [21, 27]);
  assert.equal(stepRow(r, 'hole_center').source_center_delta_mm, 0);
});
test('negative authored Y direction uses the correct depth interval', () => {
  const c = config(); c.shapes[1].position[1] = 52; c.shapes[1].direction = [0, -2, 0];
  assert.equal(report({ c }).status, 'pass');
});
test('STEP-only diameter error keeps actual separate from expected', () => {
  const g = geometry(); g.cylindrical_faces[0].diameter_mm = 10;
  const r = report({ step: g }); assert.equal(r.status, 'fail');
  const row = stepRow(r, 'hole_diameter'); assert.equal(row.status, 'fail'); assert.equal(row.actual_value_mm, 10); assert.equal(row.expected_value_mm, 8);
});
for (const [axis, coordinate] of [['X', 0], ['Z', 2]]) {
  test(`${axis} observation displacement cannot pass`, () => {
    const g = geometry(); g.cylindrical_faces[0].center_mm[coordinate] += 1;
    assert.notEqual(report({ step: g }).status, 'pass');
  });
  test(`${axis} authored displacement is compared with independent expected center`, () => {
    const c = config(), g = geometry(); c.shapes[1].position[coordinate] += 1; g.cylindrical_faces[0].center_mm[coordinate] += 1;
    const r = report({ c, generated: g, step: g }); const row = stepRow(r, 'hole_center');
    assert.equal(row.status, 'fail'); assert.deepEqual(row.expected_center_xz_mm, [21, 27]);
    assert.deepEqual(row.actual_center_xz_mm, axis === 'X' ? [22, 27] : [21, 28]);
  });
}
for (const [name, mutate] of [
  ['wrong axis', g => { g.cylindrical_faces[0].axis = [0, 0, 1]; }],
  ['inclined axis', g => { g.cylindrical_faces[0].axis = [0, 1, 0.1]; }],
  ['missing face', g => { g.cylindrical_faces = []; }],
  ['ambiguous face', g => { g.cylindrical_faces.push({ ...g.cylindrical_faces[0], face_index: 8 }); }],
  ['outside Y cutter depth', g => { g.cylindrical_faces[0].bbox.max[1] = 53; }],
  ['missing Z observation', g => { g.cylindrical_faces[0].center_mm[2] = null; }],
]) test(`${name} remains unavailable`, () => {
  const g = geometry(); mutate(g); const r = report({ step: g });
  assert.equal(stepRow(r, 'hole_center').status, 'unavailable'); assert.notEqual(r.status, 'pass');
});
test('Y center intent cannot silently reuse XY or malformed XZ coordinates', () => {
  for (const intent of [{ expected_center_xy_mm: [21, 28] }, { expected_center_xz_mm: [21, '27'] }, { expected_center_xz_mm: [21, 27], expected_center_xy_mm: [21, 28] }]) {
    const c = config(); delete c.drawing_intent.required_dimensions[0].expected_center_xz_mm; Object.assign(c.drawing_intent.required_dimensions[0], intent);
    assert.notEqual(report({ c }).status, 'pass');
  }
  const c = config(); delete c.drawing_intent.required_dimensions[0].expected_center_xz_mm;
  assert.equal(report({ c }).status, 'pass', 'fallback projects the authored 3D position onto XZ');
});

test('Studio displays XZ center values and plane', () => {
  const model = dashboard(report());
  const centers = model.engineeringQuality.sections.flatMap(s => s.rows).filter(r => r.measurementType === 'hole_center');
  assert.equal(centers.length, 2);
  for (const row of centers) { assert(row.label.includes('XZ')); assert.equal(row.expected, '[21, 27] mm'); assert.equal(row.actual, '[21, 27] mm'); assert.equal(row.statusLabel, 'PASS'); }
});
test('malformed projection metadata fails schema, semantic validation and Studio pass display', () => {
  // Forge the new tuple even before the producer supports it, so this tests ingress.
  const r = report();
  for (const row of rows(r)) Object.assign(row, { status: 'pass', source: row.validation_kind === 'reimported_step_geometry_check' ? 'reimported_step_geometry' : 'generated_shape_geometry', hole_axis: 'y', center_plane: 'xz', expected_center_xy_mm: null, actual_center_xy_mm: null, expected_center_xz_mm: [21, 27], actual_center_xz_mm: [21, 27] });
  assert.equal(validateCreateQualityReport(r).ok, true);
  assert.equal(validateRevisionImpactSemanticArtifact('create_quality', r).ok, true);
  for (const mutate of [row => { row.center_plane = 'xy'; }, row => { row.hole_axis = 'z'; }, row => { delete row.center_plane; }, row => { delete row.hole_axis; }, row => { delete row.actual_center_xz_mm; }, row => { row.actual_center_xz_mm = null; }, row => { row.status = 'PASS'; row.actual_center_xz_mm = null; }, row => { row.status = 'ready'; row.actual_center_xz_mm = null; }, row => { row.actual_center_xz_mm = [21, '27']; }, row => { row.actual_center_xz_mm = [21, 27, 0]; }, row => { row.actual_center_xy_mm = [21, 28]; }]) {
    const bad = structuredClone(r); const row = stepRow(bad, 'hole_center'); mutate(row);
    assert.equal(validateCreateQualityReport(bad).ok, false);
    assert.equal(validateRevisionImpactSemanticArtifact('create_quality', bad).ok, false);
    const rendered = dashboard(bad).engineeringQuality.sections.flatMap(s => s.rows).find(s => s.id === row.requirement_id);
    assert.notEqual(rendered.statusLabel, 'PASS');
    assert.notEqual(dashboard(bad).engineeringQuality.statusLabel, 'PASS');
  }
});
test('revision semantic records retain projection meaning while ignoring face indices', () => {
  const r = report(); assert.equal(validateRevisionImpactSemanticArtifact('create_quality', r).ok, true, JSON.stringify(validateRevisionImpactSemanticArtifact('create_quality', r)));
  const changed = structuredClone(r); for (const row of rows(changed)) row.matched_face_index = 900;
  assert.deepEqual(collectRevisionImpactSemanticRecords('create_quality', r), collectRevisionImpactSemanticRecords('create_quality', changed));
  stepRow(changed, 'hole_center').actual_center_xz_mm = [22, 27];
  assert.notDeepEqual(collectRevisionImpactSemanticRecords('create_quality', r), collectRevisionImpactSemanticRecords('create_quality', changed));
});

test('Y generic center intent requires all three coordinates and records its actual source field', () => {
  for (const field of ['expected_center_mm', 'center_mm', 'center_xz_mm']) {
    const c = config(), intent = c.drawing_intent.required_dimensions[0];
    delete intent.expected_center_xz_mm;
    intent[field] = field === 'center_xz_mm' ? [21, 27] : [21, 500, 27];
    const r = report({ c }); assert.equal(r.status, 'pass');
    assert(stepRow(r, 'hole_center').expected_source_field.endsWith(`.${field}`));
    intent[field] = [21, 28];
    if (field !== 'center_xz_mm') assert.notEqual(report({ c }).status, 'pass');
  }
});
test('Y XZ center tolerance accepts the exact limit and rejects values beyond it', () => {
  for (const [z, expected] of [[27.2, 'pass'], [27.200000000001, 'unavailable']]) {
    const g = geometry(); g.cylindrical_faces[0].center_mm[2] = z;
    assert.equal(stepRow(report({ step: g }), 'hole_center').status, expected);
  }
});
test('legacy Z measurements retain only XY fields', () => {
  const c = config(), g = geometry();
  c.shapes[1].direction = [0, 0, 1]; c.shapes[1].position = [21, 28, 0]; c.shapes[1].height = 38;
  const intent = c.drawing_intent.required_dimensions[0]; delete intent.expected_center_xz_mm; intent.expected_center_xy_mm = [21, 28];
  Object.assign(g.cylindrical_faces[0], { axis: [0, 0, 1], center_mm: [21, 28, 0], bbox: { min: [17, 24, 0], max: [25, 32, 38], size: [8, 8, 38] } });
  const r = report({ c, generated: g, step: g }); assert.equal(r.status, 'pass');
  for (const row of rows(r)) {
    assert.deepEqual(row.actual_center_xy_mm, [21, 28]);
    for (const key of ['hole_axis', 'center_plane', 'expected_center_xz_mm', 'actual_center_xz_mm']) assert(!Object.hasOwn(row, key));
  }
  assert.equal(validateCreateQualityReport(r).ok, true);
  assert.equal(validateRevisionImpactSemanticArtifact('create_quality', r).ok, true);
  // Preserve legacy nullish alias precedence for Z inputs.
  for (const xy of [[21, 28], null]) {
    intent.expected_center_xy_mm = xy; intent.expected_center_mm = [21, 28, 0];
    assert.equal(report({ c, generated: g, step: g }).status, 'pass');
  }
});
