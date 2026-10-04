import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'smol-toml';
import { createLocalApiServer } from '../src/server/local-api-server.js';
import { validateLocalApiResponse } from '../src/server/local-api-schemas.js';

const ROOT = resolve(import.meta.dirname, '..');
const bracket = await readFile(join(ROOT, 'configs/examples/quality_pass_bracket.toml'), 'utf8');
const hinge = await readFile(join(ROOT, 'configs/examples/hinge_block.toml'), 'utf8');
const sha = (source) => createHash('sha256').update(source).digest('hex');

async function environment(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'fcad-model-parameters-'));
  const { server } = createLocalApiServer({ projectRoot: ROOT, jobsDir: join(temporary, 'jobs') });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise((done) => server.close(done)); await rm(temporary, { recursive: true, force: true }); });
  return async (body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/studio/model-parameters`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, payload: text.startsWith('{') ? JSON.parse(text) : text };
  };
}

function applyBody(source, changes) {
  return { mode: 'apply', config_toml: source, source_sha256: sha(source), changes };
}

test('inspect recognizes only the two bounded template profiles and returns exact-source binding', async (t) => {
  const post = await environment(t);
  for (const [source, profile, values] of [
    [bracket, 'bracket', { plate_length_mm: 160, plate_width_mm: 100, plate_thickness_mm: 8, left_hole_diameter_mm: 6, right_hole_diameter_mm: 10 }],
    [hinge, 'hinge_block', { hinge_pin_diameter_mm: 8, mounting_hole_diameter_mm: 6 }],
  ]) {
    const { status, payload } = await post({ mode: 'inspect', config_toml: source });
    assert.equal(status, 200, JSON.stringify(payload));
    assert.equal(validateLocalApiResponse('studio_model_parameters', payload).ok, true);
    assert.equal(payload.supported, true);
    assert.equal(payload.profile_id, profile);
    assert.equal(payload.source_sha256, sha(source));
    assert.deepEqual(Object.fromEntries(payload.fields.map((field) => [field.id, field.value_mm])), values);
    assert.ok(payload.fields.every((field) => field.unit === 'mm' && field.min_exclusive >= 0));
  }
});

test('bracket changes synchronize geometry, cutter heights, both declarations and only mapped numeric values', async (t) => {
  const post = await environment(t);
  const source = ('# Keep this exact header and CRLF.\n' + bracket).replaceAll('\n', '\r\n');
  const changes = { plate_length_mm: 180, plate_width_mm: 110, plate_thickness_mm: 10, left_hole_diameter_mm: 8, right_hole_diameter_mm: 12 };
  const { status, payload } = await post(applyBody(source, changes));
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.changed, true);
  assert.equal(payload.source_sha256, sha(source));
  assert.equal(payload.candidate_sha256, sha(payload.config_toml));
  assert.match(payload.config_toml, /^# Keep this exact header and CRLF\.\r\n/);
  assert.equal(payload.config_toml.replaceAll('\r\n', '').includes('\n'), false);
  const expected = parse(source);
  const plate = expected.shapes.find((shape) => shape.id === 'plate');
  Object.assign(plate, { length: 180, width: 110, height: 10 });
  for (const [id, radius] of [['hole_left', 4], ['hole_right', 6]]) Object.assign(expected.shapes.find((shape) => shape.id === id), { radius, height: 14 });
  for (const rows of [expected.drawing_intent.required_dimensions, expected.drawing_plan.dim_intents]) {
    rows.find((row) => row.id === 'HOLE_LEFT_DIA').value_mm = 8;
    rows.find((row) => row.id === 'HOLE_RIGHT_DIA').value_mm = 12;
  }
  assert.deepEqual(parse(payload.config_toml), expected);
  assert.equal((await post({ mode: 'inspect', config_toml: payload.config_toml })).payload.supported, true);
  const noOp = await post(applyBody(payload.config_toml, changes));
  assert.equal(noOp.payload.changed, false);
  assert.equal(noOp.payload.config_toml, payload.config_toml);
  assert.equal(noOp.payload.source_sha256, noOp.payload.candidate_sha256);
});

test('hinge edits update paired holes and critical-dimension targets while keeping base and ears fixed', async (t) => {
  const post = await environment(t);
  const { status, payload } = await post(applyBody(hinge, { hinge_pin_diameter_mm: 10, mounting_hole_diameter_mm: 8 }));
  assert.equal(status, 200, JSON.stringify(payload));
  const expected = parse(hinge);
  for (const id of ['hinge_pin_left', 'hinge_pin_right']) expected.shapes.find((shape) => shape.id === id).radius = 5;
  for (const id of ['mount_hole_left', 'mount_hole_right']) expected.shapes.find((shape) => shape.id === id).radius = 4;
  for (const rows of [expected.drawing_intent.required_dimensions, expected.drawing_plan.dim_intents]) {
    rows.find((row) => row.id === 'HINGE_PIN_DIA').value_mm = 10;
    rows.find((row) => row.id === 'MOUNTING_HOLE_DIA').value_mm = 8;
  }
  expected.quality.critical_dimensions.find((row) => row.id === 'cd-01').target_mm = 10;
  expected.quality.critical_dimensions.find((row) => row.id === 'cd-02').target_mm = 8;
  assert.deepEqual(parse(payload.config_toml), expected);
  assert.ok(payload.config_toml.includes('"Use the hinge-pin hole diameter as a drawing QA reference only until real inspection evidence is supplied.",'));
});

test('unsupported topology, transforms, names and inconsistent declarations retain TOML fallback', async (t) => {
  const post = await environment(t);
  for (const [source, mutate] of [
    [bracket, (config) => { config.name = 'renamed_bracket'; }],
    [bracket, (config) => { config.shapes.push({ id: 'extra', type: 'box', length: 1, width: 1, height: 1 }); }],
    [bracket, (config) => { config.shapes[1].id = 'renamed_hole'; }],
    [bracket, (config) => { config.shapes[1].rotation = [0, 90, 0]; }],
    [bracket, (config) => { config.shapes[1].height = 13; }],
    [bracket, (config) => { config.operations.push({ op: 'chamfer', target: 'final', size: 0.5, result: 'another' }); }],
    [bracket, (config) => { config.operations[2].size = 2; }],
    [bracket, (config) => { config.final = 'plate'; }],
    [bracket, (config) => { config.parts = [{ id: 'other', shapes: config.shapes }]; }],
    [bracket, (config) => { config.drawing_plan.dim_intents[0].value_mm = 8; }],
    [bracket, (config) => { config.drawing_intent.required_dimensions.push({ ...config.drawing_intent.required_dimensions[0], id: 'EXTRA' }); }],
    [hinge, (config) => { config.shapes.find((shape) => shape.id === 'right_ear').position[0] = 59; }],
    [hinge, (config) => { config.shapes.find((shape) => shape.id === 'hinge_pin_right').radius = 5; }],
    [hinge, (config) => { config.quality.critical_dimensions[0].target_mm = 10; }],
  ]) {
    const config = parse(source); mutate(config); const changed = stringify(config);
    const inspected = await post({ mode: 'inspect', config_toml: changed });
    assert.equal(inspected.status, 200, JSON.stringify(inspected.payload));
    assert.equal(inspected.payload.supported, false, changed);
    assert.equal(inspected.payload.profile_id, null);
    assert.deepEqual(inspected.payload.fields, []);
    assert.equal((await post(applyBody(changed, {}))).status, 400);
  }
});

test('alternate or unmapped dimension declarations cannot remain stale after a model edit', async (t) => {
  const post = await environment(t);
  const cases = [
    ...['nominal_mm', 'nominal_value', 'value', 'target_mm', 'expected_value_mm'].map((key) => [bracket, (config) => { config.drawing_intent.required_dimensions[0][key] = 6; }]),
    ...['nominal_mm', 'nominal_value', 'value', 'target_mm'].map((key) => [bracket, (config) => { config.drawing_plan.dim_intents[0][key] = 6; }]),
    ...['nominal_mm', 'nominal_value', 'value_mm', 'value'].map((key) => [hinge, (config) => { config.quality.critical_dimensions[0][key] = 8; }]),
    ...['dimensions', 'dimension_requirements', 'dim_intents', 'optional_dimensions', 'reference_dimensions'].map((key) => [bracket, (config) => { config.drawing_intent[key] = [{ id: 'other', value_mm: 6 }]; }]),
    [bracket, (config) => { config.drawing.feature_tolerances = [{ feature_id: 'hole_left', value: 6 }]; }],
    [bracket, (config) => { config.drawing.key_dims = [{ id: 'HOLE_LEFT_DIA', value: 6 }]; }],
    ...['threads', 'thread_specs'].map((key) => [bracket, (config) => { config.drawing[key] = [{ hole_id: 'hole_left', diameter: 6, pitch: 1 }]; }]),
  ];
  for (const [source, mutate] of cases) {
    const config = parse(source); mutate(config); const input = stringify(config);
    const result = await post({ mode: 'inspect', config_toml: input });
    assert.equal(result.status, 200);
    assert.equal(result.payload.supported, false, input);
    const changes = config.name === 'hinge_block' ? { hinge_pin_diameter_mm: 10 } : { left_hole_diameter_mm: 8 };
    const applied = await post(applyBody(input, changes));
    assert.equal(applied.status, 400);
    assert.equal(applied.payload.config_toml, undefined, 'unsupported declarations must not produce a partial candidate');
  }
});

test('geometric bounds, stale source and caller-controlled paths or nonnumeric values are non-mutating errors', async (t) => {
  const post = await environment(t);
  for (const changes of [
    { plate_thickness_mm: 2 }, { plate_length_mm: 130 }, { plate_width_mm: 76 },
    { left_hole_diameter_mm: 58 }, { right_hole_diameter_mm: -1 },
    { plate_length_mm: '180' }, { plate_length_mm: null }, { plate_length_mm: [] },
    { plate_length_mm: Infinity }, { 'shapes.0.length': 180 }, { unknown: 1 },
  ]) assert.equal((await post(applyBody(bracket, changes))).status, 400, JSON.stringify(changes));
  for (const changes of [{ hinge_pin_diameter_mm: 22 }, { mounting_hole_diameter_mm: 28 }, { hinge_pin_diameter_mm: 0 }]) {
    assert.equal((await post(applyBody(hinge, changes))).status, 400, JSON.stringify(changes));
  }
  assert.equal((await post({ ...applyBody(bracket, { plate_length_mm: 180 }), source_sha256: sha(bracket + '\n') })).status, 400);
  for (const extra of [{ profile_id: 'hinge_block' }, { config_path: '/tmp/private.toml' }, { effects: [] }]) {
    assert.equal((await post({ ...applyBody(bracket, {}), ...extra })).status, 400);
  }
  assert.equal((await post({ mode: 'inspect', config_toml: bracket, changes: {} })).status, 400);
  const noOp = await post(applyBody(bracket, {}));
  assert.equal(noOp.status, 200);
  assert.equal(noOp.payload.changed, false);
  assert.equal(noOp.payload.config_toml, bracket);
});

test('numeric edits ignore fake TOML headers in comments and strings while retaining unsupported source forms safely', async (t) => {
  const post = await environment(t);
  const fake = '# [[shapes]]\n# radius = 123\nreleased_at = 2026-10-04T12:00:00Z\nnotes = """\n[[shapes]]\nradius = 456\n"""\n';
  const source = fake + bracket;
  const result = await post(applyBody(source, { left_hole_diameter_mm: 8 }));
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.ok(result.payload.config_toml.startsWith(fake));
  assert.equal(parse(result.payload.config_toml).shapes.find((shape) => shape.id === 'hole_left').radius, 4);
  const inline = bracket.replace('[[shapes]]\nid = "plate"\ntype = "box"\nlength = 160\nwidth = 100\nheight = 8', '[[shapes]]\nid = "plate"\ntype = "box"\nlength = "160"\nwidth = 100\nheight = 8');
  assert.equal((await post({ mode: 'inspect', config_toml: inline })).payload.supported, false);
  const inlineShapes = bracket.replace(/\[\[shapes\]\][\s\S]*?(?=\[\[shapes\]\]|\[\[operations\]\])/g, '').replace('[manufacturing]',
    'shapes = [{id="plate",type="box",length=160,width=100,height=8}, {id="hole_left",type="cylinder",radius=3,height=12,position=[30,30,-2]}, {id="hole_right",type="cylinder",radius=5,height=12,position=[125,70,-2]}]\n\n[manufacturing]');
  assert.deepEqual(parse(inlineShapes), parse(bracket));
  const unsupported = await post({ mode: 'inspect', config_toml: inlineShapes });
  assert.equal(unsupported.payload.supported, false);
  assert.equal(unsupported.payload.reason, 'unsupported_source');
  assert.equal((await post(applyBody(inlineShapes, { left_hole_diameter_mm: 8 }))).status, 400);
});
