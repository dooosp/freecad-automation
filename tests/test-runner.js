/**
 * Integration tests for FreeCAD automation framework.
 * Tests: create model → inspect output → verify metadata.
 */

import { resolve } from 'node:path';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { runScript } from '../lib/runner.js';
import { loadConfig } from '../lib/config-loader.js';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_DIR = resolve(ROOT, 'output');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

async function testCreateModel() {
  console.log('\n--- Test: Create bracket model ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/bracket.toml'));
  // Override output directory to use absolute path
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Model creation succeeded');
  assert(result.model.name === 'bracket_v1', 'Model name matches');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
  assert(result.model.faces > 0, `Has faces (${result.model.faces})`);
  assert(result.model.edges > 0, `Has edges (${result.model.edges})`);
  assert(result.exports.length === 2, `Exported 2 formats`);

  return result;
}

async function testInspectSTEP() {
  console.log('\n--- Test: Inspect STEP file ---');

  const stepFile = resolve(OUTPUT_DIR, 'bracket_v1.step');
  assert(existsSync(stepFile), 'STEP file exists');

  const result = await runScript('inspect_model.py', { file: stepFile }, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Inspection succeeded');
  assert(result.model.volume > 0, `Volume from STEP (${result.model.volume})`);
  assert(result.format === 'step', 'Format detected as step');

  return result;
}

async function testSimpleBox() {
  console.log('\n--- Test: Simple box creation ---');

  const config = {
    name: 'test_box',
    shapes: [{ id: 'box', type: 'box', length: 10, width: 20, height: 30 }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Box creation succeeded');
  assert(Math.abs(result.model.volume - 6000) < 1, `Volume is 6000 (got ${result.model.volume})`);
  assert(result.model.faces === 6, `Has 6 faces (got ${result.model.faces})`);

  return result;
}

async function main() {
  console.log('FreeCAD Automation - Integration Tests');
  console.log('=' .repeat(40));

  // Clean output directory
  if (existsSync(OUTPUT_DIR)) rmSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  try {
    await testSimpleBox();
    await testCreateModel();
    await testInspectSTEP();
  } catch (err) {
    failed++;
    console.error(`\nFATAL: ${err.message}`);
    if (err.stack) console.error(err.stack);
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
