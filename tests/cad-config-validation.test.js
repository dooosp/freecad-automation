import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { validateCadToml } from '../lib/cad-config-validation.js';

const valid = `config_version = 1
name = "external_candidate"
[[shapes]]
id = "plate"
type = "box"
length = 40
width = 20
height = 4
[export]
formats = ["step"]
directory = "output"
`;
assert.equal(validateCadToml(valid).valid, true);
assert.deepEqual(validateCadToml(valid).config, parse(valid));
for (const text of [
  'name = [',
  valid.replace('name = "external_candidate"', 'name = ""'),
  valid.replace('id = "plate"', 'id = ""'),
  valid + '\n[[operations]]\nop = "cut"\nbase = "plate"\ntool = { type = "cylinder", radius = "three", height = 8 }\n',
  valid.replace('length = 40', 'length = "forty"'),
  valid.replace('type = "box"', 'type = "unsupported_magic_shape"'),
  valid + '\n[[operations]]\nop = "cut"\nbase = "plate"\ntool = "missing_hole"\nresult = "final"\n',
  valid + '\n[[operations]]\nop = "cut"\nbase = "plate"\n',
  valid.replace('height = 4', 'height = 4\nrotation = [0, "wrong", 0]'),
  valid + '\n[[shapes]]\nid = "plate"\ntype = "box"\n',
]) assert.equal(validateCadToml(text).valid, false, text);
assert.equal(validateCadToml('name = [').config, null);

const legacy = valid + '\n[[operations]]\ntype = "chamfer"\ntarget = "plate"\nsize = 1\nresult = "final"\n';
assert.equal(validateCadToml(legacy).valid, true);
assert.deepEqual(validateCadToml(legacy).config, parse(legacy), 'facade config preserves parsed input, including legacy expressions');
const assembly = `name = "assembly"
[[parts]]
id = "p"
[[parts.shapes]]
id = "body"
type = "box"
length = 10
width = 10
height = 10
[[assembly.parts]]
ref = "p"
rotation = [0, 0, 1, 90]
`;
assert.equal(validateCadToml(assembly + '\n[assembly.joints]\nid = "bad_table"\n').valid, false);
assert.equal(validateCadToml(assembly + '\n[[assembly.joints]]\nid = "j"\npart = "p"\naxis = [0, "bad", 1]\nanchor = [0, 0, 0]\n').valid, false);
assert.equal(validateCadToml(assembly).valid, true, 'runtime-supported axis-angle placement remains accepted');
assert.equal(validateCadToml(assembly.replace('id = "p"', 'id = "p"\nfinal = ""')).valid, false);
assert.equal(validateCadToml('name = "part"\nfinal = ""\n[[shapes]]\nid = "body"\ntype = "box"\nlength = 10\nwidth = 10\nheight = 10\n').valid, false);
assert.equal(validateCadToml(assembly.replace('ref = "p"', 'ref = "missing"')).valid, false);
for (const file of ['configs/examples/quality_pass_bracket.toml', 'docs/examples/plate-with-holes/config.toml', 'docs/examples/hinge-block/config.toml']) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const result = validateCadToml(text);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.deepEqual(result.config, parse(text), `${file}: original parsed config contract`);
}
console.log('cad-config-validation.test.js: ok');
