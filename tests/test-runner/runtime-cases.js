import { resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parse as parseTOML } from 'smol-toml';
import {
  ROOT,
  OUTPUT_DIR,
  loadConfig,
  loadExampleConfig,
  normalizeConfig,
  normalizeGeneratedPath,
  runJsonCommand,
  runScript,
  withOutputDirectory,
  describeFreeCADRuntime,
  hasFreeCADRuntime,
} from './shared.js';

export function createRuntimeCases(assert) {
async function testRuntimeDetection() {
  console.log('\n--- Test: Runtime detection ---');
  const description = describeFreeCADRuntime();
  assert(typeof description === 'string' && description.length > 0, 'Runtime description is available');
  assert(typeof hasFreeCADRuntime() === 'boolean', 'Runtime availability is boolean');
}

async function testReviewedExampleGuards() {
  console.log('\n--- Test: Reviewed example schema guards ---');

  const reviewedPath = resolve(ROOT, 'configs/examples/seatbelt_retractor.reviewed.toml');
  const raw = readFileSync(reviewedPath, 'utf8');

  assert(!raw.includes('type = "library/gear"'), 'Reviewed example no longer uses library/gear');
  assert(!raw.includes('[[assembly.parts.children]]'), 'Reviewed example does not rely on assembly.parts.children');
}

async function testOperationSchemaNormalization() {
  console.log('\n--- Test: Operation schema normalization ---');

  const compatPath = resolve(OUTPUT_DIR, 'compat-op-type.toml');
  const compatToml = `
name = "compat-op"

[[shapes]]
id = "body"
type = "box"
length = 10
width = 10
height = 4

[[operations]]
type = "fillet"
target = "body"
radius = 1
`;
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(compatPath, compatToml, 'utf8');

  const loaded = await loadConfig(compatPath);
  assert(loaded.operations[0].op === 'fillet', 'TOML loader normalizes operations.type -> op');
  assert(loaded.operations[0].type === 'fillet', 'Original type field is preserved for compatibility');

  const raw = {
    operations: [{ type: 'cut', base: 'a', tool: 'b' }],
    parts: [{ id: 'p1', operations: [{ type: 'fuse', base: 'a', tool: 'b' }] }],
  };
  const normalized = normalizeConfig(raw);
  assert(raw.operations[0].op === undefined, 'Source config is not mutated during normalization checks');
  assert(normalized.operations[0].op === 'cut', 'JS config normalizer populates top-level op');
  assert(normalized.parts[0].operations[0].op === 'fuse', 'JS config normalizer handles nested part operations');

  const pyOut = execSync('python3 tests/test_config_utils.py', {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert(pyOut.includes('ok'), 'Python config normalization helper test passed');
}

  return [
    ['Runtime detection', testRuntimeDetection],
    ['Reviewed example schema guards', testReviewedExampleGuards],
    ['Operation schema normalization', testOperationSchemaNormalization],
  ];
}
