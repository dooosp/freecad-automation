import assert from 'node:assert/strict';
import { compareMountingCenters, renderMountingComparisonHtml } from '../src/services/drawing/mounting-comparison.js';

const reference = () => ({
  source: { kind: 'manufacturer_reference', product_id: 'Reference hub', evidence_ref: 'vendor-drawing.pdf' },
  units: 'mm', coordinate_frame: 'model_xy', coordinate_basis: 'Plate lower-left origin',
  center_tolerance_mm: 0.1,
  holes: [
    { id: 'H1', target_feature_id: 'hole1', center_mm: [12, 10] },
    { id: 'H2', target_feature_id: 'hole2', center_mm: [42, 10] },
  ],
});
const measurements = () => ({
  source: 'freecad_runtime', status: 'available', units: 'mm', coordinate_frame: 'model_xy', model_object_id: 'final',
  holes: [
    { feature_id: 'hole1', center_mm: [12, 10], diameter_mm: 4, face_ref: 'final:Face3' },
    { feature_id: 'hole2', center_mm: [42, 10], diameter_mm: 4, face_ref: 'final:Face5' },
    { feature_id: 'panel1', center_mm: [60, 20], diameter_mm: 5.5, face_ref: 'final:Face7' },
  ],
});
let count = 0;
function check(name, test) {
  test();
  count += 1;
  console.log(`ok ${count} - ${name}`);
}

check('matches explicitly named centers while ignoring unrelated panel holes', () => {
  const result = compareMountingCenters(reference(), measurements(), { modelName: 'plate', inputConfigPath: 'plate.json' });
  assert.equal(result.status, 'pass');
  assert.equal(result.scope, 'nominal_cad');
  assert.deepEqual(result.rows.map(r => r.distance_mm), [0, 0]);
  assert.deepEqual(result.rows.map(r => r.face_ref), ['final:Face3', 'final:Face5']);
  assert.deepEqual(result.summary, { total: 2, pass: 2, fail: 0, unknown: 0, max_deviation_mm: 0 });
  assert.equal(result.physical_fit_result, 'not_tested');
  assert.equal(result.user_hardware_identity, 'unknown');
  assert.equal(result.manufacturing_release, false);
});
check('reports measured displacement instead of returning expected coordinates', () => {
  const measured = measurements();
  measured.holes[0].center_mm = [12.3, 10.4];
  const result = compareMountingCenters(reference(), measured);
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.rows[0].measured_center_mm, [12.3, 10.4]);
  assert.ok(Math.abs(result.rows[0].delta_mm[0] - 0.3) < 1e-10);
  assert.ok(Math.abs(result.rows[0].distance_mm - 0.5) < 1e-10);
  assert.deepEqual(result.rows[0].reason_codes, ['center_out_of_tolerance']);
});
check('uses Euclidean distance rather than separate axis limits', () => {
  const measured = measurements();
  measured.holes[0].center_mm = [12.08, 10.08];
  assert.equal(compareMountingCenters(reference(), measured).status, 'fail');
});
check('includes the declared tolerance boundary', () => {
  const measured = measurements();
  measured.holes[0].center_mm = [12.1, 10];
  assert.equal(compareMountingCenters(reference(), measured).status, 'pass');
  measured.holes[0].center_mm = [12.10001, 10];
  assert.equal(compareMountingCenters(reference(), measured).status, 'fail');
});
check('does not match an absent ID to another hole at identical coordinates', () => {
  const measured = measurements();
  measured.holes[0].feature_id = 'different_hole';
  const row = compareMountingCenters(reference(), measured).rows[0];
  assert.equal(row.status, 'fail');
  assert.deepEqual(row.reason_codes, ['missing_feature']);
  assert.equal(row.measured_center_mm, null);
  assert.equal(row.distance_mm, null);
});

for (const [name, mutate] of [
  ['missing product identity', r => { delete r.source.product_id; }],
  ['missing source evidence', r => { delete r.source.evidence_ref; }],
  ['user hardware is not a manufacturer reference', r => { r.source.kind = 'user_hardware'; }],
  ['unsupported reference units', r => { r.units = 'inch'; }],
  ['unsupported reference frame', r => { r.coordinate_frame = 'vendor_xyz'; }],
  ['negative tolerance', r => { r.center_tolerance_mm = -1; }],
  ['missing tolerance', r => { delete r.center_tolerance_mm; }],
  ['empty expected set', r => { r.holes = []; }],
]) {
  check(name + ' prevents pass', () => {
    const input = reference(); mutate(input);
    const result = compareMountingCenters(input, measurements());
    assert.equal(result.status, 'unknown');
    assert.ok(result.reason_codes.length);
    assert.ok(result.rows.every(row => row.status === 'unknown' && row.distance_mm === null));
  });
}
for (const [name, mutate] of [
  ['config-only source', m => { m.source = 'config'; }],
  ['unavailable runtime', m => { m.status = 'unavailable'; m.holes = []; }],
  ['unsupported measurement units', m => { m.units = 'inch'; }],
  ['unsupported measurement frame', m => { m.coordinate_frame = 'front'; }],
  ['missing model object', m => { delete m.model_object_id; }],
]) {
  check(name + ' does not fabricate a missing-hole failure', () => {
    const measured = measurements(); mutate(measured);
    const result = compareMountingCenters(reference(), measured);
    assert.equal(result.status, 'unknown');
    assert.ok(result.rows.every(row => row.distance_mm === null));
  });
}
for (const field of ['id', 'target_feature_id', 'center_mm']) {
  check('duplicate reference ' + field + ' remains ambiguous', () => {
    const input = reference(); input.holes[1][field] = input.holes[0][field];
    const result = compareMountingCenters(input, measurements());
    assert.equal(result.status, 'unknown');
    assert.ok(result.rows.every(row => row.status === 'unknown'));
  });
}
for (const field of ['feature_id', 'center_mm', 'face_ref']) {
  check('duplicate measured ' + field + ' is not silently selected', () => {
    const measured = measurements(); measured.holes[1][field] = measured.holes[0][field];
    const result = compareMountingCenters(reference(), measured);
    assert.equal(result.status, 'unknown');
    assert.ok(result.rows.every(row => row.status === 'unknown'));
  });
}
for (const invalid of [null, [NaN, 1], [Infinity, 1], [true, 10], ['12', 10], [12], [12, 10, 0]]) {
  check('rejects invalid measured center ' + JSON.stringify(invalid), () => {
    const measured = measurements(); measured.holes[0].center_mm = invalid;
    const result = compareMountingCenters(reference(), measured);
    assert.equal(result.status, 'unknown');
    assert.equal(result.rows[0].distance_mm, null);
  });
}
check('missing face evidence cannot pass', () => {
  const measured = measurements(); delete measured.holes[0].face_ref;
  assert.equal(compareMountingCenters(reference(), measured).status, 'unknown');
});
check('unknown input does not crash or pass vacuously', () => {
  for (const input of [null, undefined, [], 'wrong']) {
    assert.equal(compareMountingCenters(input, null).status, 'unknown');
  }
});
check('zero tolerance allows only matching centers', () => {
  const input = reference(); input.center_tolerance_mm = 0;
  assert.equal(compareMountingCenters(input, measurements()).status, 'pass');
});
check('HTML escapes source and feature text and displays evidence limits', () => {
  const input = reference(); input.source.product_id = '<script>alert(1)</script>';
  input.holes[0].id = '<img src=x onerror=alert(1)>';
  const html = renderMountingComparisonHtml(compareMountingCenters(input, measurements()));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<script>') && !html.includes('<img src=x'));
  assert.ok(html.includes('실물 장착 미검증'));
  assert.ok(html.includes('0.0000'));
  const unknown = renderMountingComparisonHtml(compareMountingCenters(reference(), null));
  assert.ok(unknown.includes('확인 불가'));
  assert.ok(!unknown.includes('NaN') && !unknown.includes('undefined'));
});
console.log(`mounting-comparison.test.js: ${count} passed`);
