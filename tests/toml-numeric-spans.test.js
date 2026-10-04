import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'smol-toml';
import { patchTomlNumericValues } from '../src/server/toml-numeric-spans.js';

test('changes only selected numeric tokens while preserving comments, spacing and CRLF', () => {
  const source = '# radius = 99\r\nversion = 1 # keep\r\n\r\n[[shapes]]\r\nid = "left"\r\nradius\t= +3.00  # mm\r\n[[shapes]]\r\nid = "right"\r\nradius = 3\r\n';
  const result = patchTomlNumericValues(source, [
    { path: ['shapes', 1, 'radius'], value: 4.5 },
    { path: ['version'], value: 2 },
  ]);
  assert.equal(result, '# radius = 99\r\nversion = 2 # keep\r\n\r\n[[shapes]]\r\nid = "left"\r\nradius\t= +3.00  # mm\r\n[[shapes]]\r\nid = "right"\r\nradius = 4.5\r\n');
});

test('resolves dotted keys and table headers including quoted literal dots', () => {
  const source = 'model.size.width = 10\n["drawing.meta"]\n"radius.mm" = 3\n[drawing.settings]\nscale.value = 2\n';
  const result = patchTomlNumericValues(source, [
    { path: ['model', 'size', 'width'], value: 12 },
    { path: ['drawing.meta', 'radius.mm'], value: 4 },
    { path: ['drawing', 'settings', 'scale', 'value'], value: 3 },
  ]);
  assert.deepEqual(parse(result), { model: { size: { width: 12 } }, 'drawing.meta': { 'radius.mm': 4 }, drawing: { settings: { scale: { value: 3 } } } });
});

test('nested arrays of tables bind to the correct current parent and child', () => {
  const source = '[[parts]]\nid = "a"\n[[parts.holes]]\nradius = 1\n[[parts.holes]]\nradius = 2\n[parts.holes.location]\nx = 5\n[[parts]]\nid = "b"\n[[parts.holes]]\nradius = 3\n[parts.holes.location]\nx = 6\n';
  const result = patchTomlNumericValues(source, [
    { path: ['parts', 0, 'holes', 1, 'radius'], value: 4 },
    { path: ['parts', 1, 'holes', 0, 'location', 'x'], value: 8 },
  ]);
  assert.equal(result, source.replace('radius = 2', 'radius = 4').replace('x = 6', 'x = 8'));
});

test('ignores fake assignments and headers inside all string forms and composite values', () => {
  const source = [
    '# [[shapes]]',
    'basic = "escaped \\" radius = 42 # [shapes]"',
    "literal = 'radius = 43 # [[shapes]]'",
    'multi = """',
    '[[shapes]]',
    'radius = 44',
    'escaped \\""" is text',
    '"""',
    "multi_literal = '''",
    '[[shapes]]',
    'radius = 45',
    "'''",
    'items = [',
    '  { radius = 46, text = "[[shapes]]" }, # radius = 47',
    '  [48, 49],',
    ']',
    '[[shapes]]',
    'radius = 3 # radius = 50',
    '',
  ].join('\n');
  assert.equal(patchTomlNumericValues(source, [{ path: ['shapes', 0, 'radius'], value: 4 }]), source.replace('radius = 3 #', 'radius = 4 #'));
});

test('replaces a complete numeric token across supported TOML number notations', () => {
  for (const token of ['+3', '1_000', '3.125', '-2.5e+2', '0xAF', '0o17', '0b101']) {
    assert.equal(patchTomlNumericValues(`n = ${token} # keep`, [{ path: ['n'], value: 4.25 }]), 'n = 4.25 # keep');
  }
});

test('preserves unrelated TOML dates and multiline quote terminators', () => {
  const source = 'day = 1979-05-27\ntime = 1979-05-27T07:32:00Z\nnote = """\nn = 999\n"""""\nliteral = \'\'\'ends with quote\'\'\'\'\nn = 3\n';
  assert.equal(patchTomlNumericValues(source, [{ path: ['n'], value: 4 }]), source.replace('n = 3\n', 'n = 4\n'));
});

test('patches supported fixture scalars without serializing or rewriting the source', () => {
  for (const name of ['quality_pass_bracket', 'hinge_block']) {
    const source = readFileSync(new URL(`../configs/examples/${name}.toml`, import.meta.url), 'utf8');
    const before = parse(source);
    const index = before.shapes.findIndex((shape) => typeof shape.radius === 'number');
    assert.ok(index >= 0);
    const originalRadius = before.shapes[index].radius;
    const result = patchTomlNumericValues(source, [{ path: ['shapes', index, 'radius'], value: originalRadius + 1 }]);
    before.shapes[index].radius = originalRadius + 1;
    assert.deepEqual(parse(result), before);
    assert.equal(patchTomlNumericValues(result, [{ path: ['shapes', index, 'radius'], value: originalRadius }]), source);
  }
});

test('refuses missing, composite, string, boolean and date targets without partial output', () => {
  for (const source of ['n = [3]', 'n = { value = 3 }', 'n = "3"', 'n = true', 'n = 1979-05-27', 'n = inf']) {
    assert.throws(() => patchTomlNumericValues(source, [{ path: ['n'], value: 4 }]));
  }
  assert.throws(() => patchTomlNumericValues('n = 3', [{ path: ['missing'], value: 4 }]), /target|span/i);
  assert.throws(() => patchTomlNumericValues('n = { value = 3 }', [{ path: ['n', 'value'], value: 4 }]), /target|span/i);
  assert.throws(() => patchTomlNumericValues('n = [3]', [{ path: ['n', 0], value: 4 }]), /target|span/i);
  assert.throws(() => patchTomlNumericValues('[[shapes]]\nradius=3', [{ path: ['shapes', '0', 'radius'], value: 4 }]), /target|span/i);
});

test('rejects duplicate requested paths and invalid TOML before replacing anything', () => {
  assert.throws(() => patchTomlNumericValues('n = 3', [{ path: ['n'], value: 4 }, { path: ['n'], value: 5 }]), /duplicate/i);
  for (const source of ['n = 3\nn = 4', '[a]\nn=3\n[a]\nn=4', 'n = "unterminated']) {
    assert.throws(() => patchTomlNumericValues(source, [{ path: ['n'], value: 5 }]));
  }
});

test('rejects malformed patches and non-finite replacements', () => {
  for (const patch of [null, {}, { path: [], value: 3 }, { path: ['n'], value: NaN }, { path: ['n'], value: Infinity }, { path: ['n'], value: '4' }, { path: ['n', -1], value: 4 }, { path: ['n', 0.5], value: 4 }]) {
    assert.throws(() => patchTomlNumericValues('n = 3', [patch]));
  }
  assert.throws(() => patchTomlNumericValues('n = 3', null));
  assert.equal(patchTomlNumericValues('n = 3 # unchanged\r\n', []), 'n = 3 # unchanged\r\n');
});
