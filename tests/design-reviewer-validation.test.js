import assert from 'node:assert/strict';

import { validateTomlStructure } from '../scripts/design-reviewer.js';

const validAssemblyToml = `
name = "test_cam"

[export]
formats = ["step"]
directory = "./output"

[[parts]]
id = "cam"
  [[parts.shapes]]
  id = "disc"
  type = "library/disc_cam"
  base_radius = 20
  max_lift = 10
  width = 15
  bore_d = 8
  material = "steel"

[[parts]]
id = "shaft"
  [[parts.shapes]]
  id = "body"
  type = "cylinder"
  radius = 4
  height = 30
  material = "steel"

[assembly]

[[assembly.parts]]
ref = "cam"
position = [0, 0, 0]

[[assembly.parts]]
ref = "shaft"
position = [0, 0, 0]

[[assembly.joints]]
id = "cam_rev"
type = "revolute"
part = "cam"
axis = [0, 0, 1]
anchor = [0, 0, 0]

[[assembly.couplings]]
type = "gear"
driver = "cam_rev"
follower = "cam_rev"
`;

const validSinglePartToml = `
name = "single_block"
final = "body_cut"

[[shapes]]
id = "body"
type = "box"
length = 20
width = 10
height = 5

[[shapes]]
id = "hole"
type = "cylinder"
radius = 2
height = 6

[[operations]]
op = "cut"
base = "body"
tool = "hole"
result = "body_cut"
`;

const validSinglePartShellToml = `
name = "single_shell"
final = "body_shell"

[[shapes]]
id = "body"
type = "box"
length = 20
width = 10
height = 8

[[operations]]
op = "shell"
target = "body"
thickness = 1
result = "body_shell"
`;

const invalidToml = `
name = "bad_design"

[[parts]]
id = "base"
  [[parts.shapes]]
  id = "body"
  type = "library/fake_shape"

[assembly]

[[assembly.parts]]
ref = "missing_part"
position = [0, 0, 0]
`;

const invalidAssemblyShellToml = `
name = "bad_assembly_shell"

[[parts]]
id = "housing"
final = "housing_shell"
  [[parts.shapes]]
  id = "housing_body"
  type = "box"
  length = 20
  width = 10
  height = 8

  [[parts.operations]]
  op = "shell"
  target = "housing_body"
  thickness = 1
  result = "housing_shell"

[assembly]

[[assembly.parts]]
ref = "housing"
position = [0, 0, 0]
`;

assert.equal(validateTomlStructure(validAssemblyToml).valid, true);
assert.equal(validateTomlStructure(validSinglePartToml).valid, true);
assert.equal(validateTomlStructure(validSinglePartShellToml).valid, true);

const invalid = validateTomlStructure(invalidToml);
assert.equal(invalid.valid, false);
assert.equal(invalid.errors.some((e) => e.includes('unsupported type "library/fake_shape"')), true);
assert.equal(invalid.errors.some((e) => e.includes('unknown part "missing_part"')), true);

const invalidAssemblyShell = validateTomlStructure(invalidAssemblyShellToml);
assert.equal(invalidAssemblyShell.valid, false);
assert.equal(invalidAssemblyShell.errors.some((e) => e.includes('Part "housing" operation "shell" is not supported')), true);

console.log('design-reviewer-validation.test.js: ok');
