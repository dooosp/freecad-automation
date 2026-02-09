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

async function testFemAnalysis() {
  console.log('\n--- Test: FEM static analysis ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/bracket_fem.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('fem_analysis.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'FEM analysis succeeded');
  assert(result.model.name === 'bracket_fem', 'Model name matches');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);

  // FEM-specific assertions
  assert(result.fem !== undefined, 'FEM results present');
  assert(result.fem.analysis_type === 'static', 'Analysis type is static');
  assert(result.fem.mesh.nodes > 0, `Mesh has nodes (${result.fem.mesh.nodes})`);
  assert(result.fem.mesh.elements > 0, `Mesh has elements (${result.fem.mesh.elements})`);
  assert(result.fem.results.displacement.max > 0, `Max displacement > 0 (${result.fem.results.displacement.max})`);
  assert(result.fem.results.von_mises.max > 0, `Max von Mises > 0 (${result.fem.results.von_mises.max})`);
  assert(result.fem.results.safety_factor > 0, `Safety factor > 0 (${result.fem.results.safety_factor})`);

  // Verify .FCStd saved
  const fcstdPath = resolve(OUTPUT_DIR, 'bracket_fem.FCStd');
  assert(existsSync(fcstdPath), 'FCStd file saved with results');

  return result;
}

// ---------------------------------------------------------------------------
// Phase 3 Tests: Revolution, Extrusion, Circular Pattern
// ---------------------------------------------------------------------------

async function testRevolutionSimple() {
  console.log('\n--- Test: Simple revolution (full cylinder-like) ---');

  // A rectangle profile revolved 360° around Z axis → hollow tube shape
  const config = {
    name: 'test_revolution',
    shapes: [{
      id: 'ring',
      type: 'revolution',
      angle: 360,
      axis: [0, 0, 1],
      axis_point: [0, 0, 0],
      plane: 'xz',
      profile_start: [10, 0],
      profile: [
        { type: 'line', to: [20, 0] },
        { type: 'line', to: [20, 10] },
        { type: 'line', to: [10, 10] },
      ],
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Revolution creation succeeded');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
  // Expected: pi * (20^2 - 10^2) * 10 = pi * 300 * 10 = ~9424.78
  const expected = Math.PI * (20*20 - 10*10) * 10;
  assert(Math.abs(result.model.volume - expected) / expected < 0.02,
    `Volume ~${Math.round(expected)} (got ${result.model.volume})`);
  assert(result.model.faces >= 2, `Has faces (${result.model.faces})`);
}

async function testRevolutionPartial() {
  console.log('\n--- Test: Partial revolution (180°) ---');

  const config = {
    name: 'test_rev_partial',
    shapes: [{
      id: 'half',
      type: 'revolution',
      angle: 180,
      axis: [0, 0, 1],
      axis_point: [0, 0, 0],
      plane: 'xz',
      profile_start: [5, 0],
      profile: [
        { type: 'line', to: [15, 0] },
        { type: 'line', to: [15, 10] },
        { type: 'line', to: [5, 10] },
      ],
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Partial revolution succeeded');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
  // Half of full: pi * (15^2 - 5^2) * 10 / 2 = ~3141.59
  const expected = Math.PI * (15*15 - 5*5) * 10 / 2;
  assert(Math.abs(result.model.volume - expected) / expected < 0.02,
    `Volume ~${Math.round(expected)} (got ${result.model.volume})`);
}

async function testRevolutionWithArc() {
  console.log('\n--- Test: Revolution with arc segment ---');

  const config = {
    name: 'test_rev_arc',
    shapes: [{
      id: 'rounded',
      type: 'revolution',
      angle: 360,
      axis: [0, 0, 1],
      axis_point: [0, 0, 0],
      plane: 'xz',
      profile_start: [10, 0],
      profile: [
        { type: 'line', to: [20, 0] },
        { type: 'arc', to: [20, 10], center: [20, 5], clockwise: false },
        { type: 'line', to: [10, 10] },
      ],
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Revolution with arc succeeded');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
  assert(result.model.faces >= 2, `Has faces (${result.model.faces})`);
}

async function testExtrusionSimple() {
  console.log('\n--- Test: Simple extrusion (L-shaped profile) ---');

  const config = {
    name: 'test_extrusion',
    shapes: [{
      id: 'L_shape',
      type: 'extrusion',
      direction: [0, 0, 30],
      plane: 'xy',
      profile_start: [0, 0],
      profile: [
        { type: 'line', to: [20, 0] },
        { type: 'line', to: [20, 5] },
        { type: 'line', to: [5, 5] },
        { type: 'line', to: [5, 15] },
        { type: 'line', to: [0, 15] },
      ],
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Extrusion creation succeeded');
  // L-shape area = 20*5 + 5*10 = 150, volume = 150*30 = 4500
  const expected = 4500;
  assert(Math.abs(result.model.volume - expected) < 1,
    `Volume is ${expected} (got ${result.model.volume})`);
  assert(result.model.faces > 0, `Has faces (${result.model.faces})`);
}

async function testExtrusionWithPosition() {
  console.log('\n--- Test: Extrusion with position offset ---');

  const config = {
    name: 'test_extrusion_pos',
    shapes: [{
      id: 'block',
      type: 'extrusion',
      direction: [0, 0, 10],
      plane: 'xy',
      position: [100, 100, 100],
      profile_start: [0, 0],
      profile: [
        { type: 'line', to: [10, 0] },
        { type: 'line', to: [10, 10] },
        { type: 'line', to: [0, 10] },
      ],
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Extrusion with position succeeded');
  assert(Math.abs(result.model.volume - 1000) < 1, `Volume is 1000 (got ${result.model.volume})`);
  // Check bounding box is offset
  const bb = result.model.bounding_box;
  assert(bb.min[0] >= 99, `BB min X offset (${bb.min[0]})`);
  assert(bb.min[1] >= 99, `BB min Y offset (${bb.min[1]})`);
}

async function testCircularPattern() {
  console.log('\n--- Test: Circular pattern (6 bolt holes) ---');

  const config = {
    name: 'test_circ_pattern',
    shapes: [
      {
        id: 'plate',
        type: 'cylinder',
        radius: 50,
        height: 5,
      },
      {
        id: 'hole',
        type: 'cylinder',
        radius: 3,
        height: 10,
        position: [30, 0, -2],
      },
    ],
    operations: [
      {
        op: 'circular_pattern',
        target: 'hole',
        axis: [0, 0, 1],
        center: [0, 0, 0],
        count: 6,
        angle: 360,
        include_original: true,
        result: 'holes',
      },
      {
        op: 'cut',
        base: 'plate',
        tool: 'holes',
        result: 'plate',
      },
    ],
    final: 'plate',
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Circular pattern succeeded');
  // Volume should be plate minus 6 holes; verify holes were cut
  const plateVol = Math.PI * 50*50 * 5; // ~39270
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
  assert(result.model.volume < plateVol, `Volume < uncut plate (${result.model.volume} < ${Math.round(plateVol)})`);
  // Should have more faces than a plain cylinder (6 holes add faces)
  assert(result.model.faces > 3, `Has many faces from holes (${result.model.faces})`);
}

async function testRevolutionBooleanCombo() {
  console.log('\n--- Test: Revolution + boolean (hollow housing) ---');

  const config = {
    name: 'test_rev_boolean',
    shapes: [
      {
        id: 'outer',
        type: 'revolution',
        angle: 360,
        axis: [0, 0, 1],
        plane: 'xz',
        profile_start: [0, 0],
        profile: [
          { type: 'line', to: [30, 0] },
          { type: 'line', to: [30, 40] },
          { type: 'line', to: [0, 40] },
        ],
      },
      {
        id: 'bore',
        type: 'revolution',
        angle: 360,
        axis: [0, 0, 1],
        plane: 'xz',
        profile_start: [0, 5],
        profile: [
          { type: 'line', to: [25, 5] },
          { type: 'line', to: [25, 35] },
          { type: 'line', to: [0, 35] },
        ],
      },
    ],
    operations: [
      { op: 'cut', base: 'outer', tool: 'bore', result: 'housing' },
    ],
    final: 'housing',
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Revolution + boolean succeeded');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
  // outer = pi*30^2*40, bore = pi*25^2*30 → result > 0
  const outerVol = Math.PI * 30*30 * 40;
  const boreVol = Math.PI * 25*25 * 30;
  const expected = outerVol - boreVol;
  assert(Math.abs(result.model.volume - expected) / expected < 0.02,
    `Volume ~${Math.round(expected)} (got ${result.model.volume})`);
}

async function testPTU() {
  console.log('\n--- Test: PTU housing (full integration) ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/ptu.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 120_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'PTU creation succeeded');
  assert(result.model.name === 'ptu_housing', 'PTU model name matches');
  assert(result.model.volume > 0, `PTU volume is positive (${result.model.volume})`);
  assert(result.model.faces > 10, `PTU has many faces (${result.model.faces})`);
  assert(result.exports.length === 2, `PTU exported 2 formats`);

  // Check STEP file exists
  const stepFile = resolve(OUTPUT_DIR, 'ptu_housing.step');
  assert(existsSync(stepFile), 'PTU STEP file exists');
}

// ---------------------------------------------------------------------------
// Phase 5 Tests: Parts Library, Assembly
// ---------------------------------------------------------------------------

async function testBallBearing() {
  console.log('\n--- Test: Ball bearing (library part) ---');

  const config = {
    name: 'test_bearing',
    shapes: [{
      id: 'brg',
      type: 'library/ball_bearing',
      inner_d: 20,
      outer_d: 42,
      width: 12,
      num_balls: 8,
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Ball bearing creation succeeded');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
  // Compound should have inner race + outer race + 8 balls = 10 sub-shapes
  assert(result.model.faces > 0, `Has faces (${result.model.faces})`);
}

async function testSpurGear() {
  console.log('\n--- Test: Spur gear (library part) ---');

  const config = {
    name: 'test_gear',
    shapes: [{
      id: 'gear',
      type: 'library/spur_gear',
      module: 3,
      teeth: 16,
      width: 10,
      bore_d: 10,
      pressure_angle: 20,
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    timeout: 120_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Spur gear creation succeeded');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
  // Gear should have bore hole
  assert(result.model.faces > 3, `Has many faces from teeth (${result.model.faces})`);
}

async function testSteppedShaft() {
  console.log('\n--- Test: Stepped shaft (library part) ---');

  const config = {
    name: 'test_shaft',
    shapes: [{
      id: 'shaft',
      type: 'library/stepped_shaft',
      bore_d: 5,
      segments: [
        { diameter: 20, length: 15 },
        { diameter: 30, length: 25 },
        { diameter: 20, length: 15 },
      ],
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Stepped shaft creation succeeded');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
  // Approximate volume: pi*(10^2*15 + 15^2*25 + 10^2*15) - pi*2.5^2*55
  const expected = Math.PI * (100*15 + 225*25 + 100*15) - Math.PI * 6.25 * 55;
  assert(Math.abs(result.model.volume - expected) / expected < 0.05,
    `Volume ~${Math.round(expected)} (got ${result.model.volume})`);
  // Check bounding box height = 55
  const bb = result.model.bounding_box;
  assert(Math.abs(bb.size[2] - 55) < 1, `Height is 55mm (got ${bb.size[2]})`);
}

async function testLibraryPartWithPosition() {
  console.log('\n--- Test: Library part with position offset ---');

  const config = {
    name: 'test_lib_pos',
    shapes: [{
      id: 'brg',
      type: 'library/ball_bearing',
      inner_d: 15,
      outer_d: 32,
      width: 9,
      position: [100, 0, 0],
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Library part with position succeeded');
  const bb = result.model.bounding_box;
  assert(bb.min[0] > 50, `BB offset X (min=${bb.min[0]})`);
}

async function testSimpleAssembly() {
  console.log('\n--- Test: Simple assembly (2 boxes) ---');

  const config = {
    name: 'test_assembly',
    parts: [
      {
        id: 'box_a',
        shapes: [{ id: 'b', type: 'box', length: 10, width: 10, height: 10 }],
        operations: [],
      },
      {
        id: 'box_b',
        shapes: [{ id: 'b', type: 'box', length: 10, width: 10, height: 10 }],
        operations: [],
      },
    ],
    assembly: {
      parts: [
        { ref: 'box_a', position: [0, 0, 0] },
        { ref: 'box_b', position: [20, 0, 0] },
      ],
    },
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Simple assembly succeeded');
  assert(result.assembly !== undefined, 'Assembly metadata present');
  assert(result.assembly.part_count === 2, `Part count is 2 (got ${result.assembly.part_count})`);
  // Two 10x10x10 boxes, total volume = 2000
  assert(Math.abs(result.model.volume - 2000) < 1, `Volume is 2000 (got ${result.model.volume})`);
}

async function testAssemblyWithBoolean() {
  console.log('\n--- Test: Assembly with boolean part ---');

  const config = {
    name: 'test_asm_bool',
    parts: [
      {
        id: 'plate_with_hole',
        shapes: [
          { id: 'plate', type: 'box', length: 50, width: 50, height: 5 },
          { id: 'hole', type: 'cylinder', radius: 10, height: 10, position: [25, 25, -2] },
        ],
        operations: [
          { op: 'cut', base: 'plate', tool: 'hole', result: 'drilled' },
        ],
        final: 'drilled',
      },
      {
        id: 'pin',
        shapes: [{ id: 'p', type: 'cylinder', radius: 9, height: 20 }],
        operations: [],
      },
    ],
    assembly: {
      parts: [
        { ref: 'plate_with_hole', position: [0, 0, 0] },
        { ref: 'pin', position: [25, 25, 0] },
      ],
    },
    export: { formats: ['step', 'brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Assembly with boolean succeeded');
  assert(result.assembly.part_count === 2, `Part count is 2 (got ${result.assembly.part_count})`);
  assert(result.exports.length === 2, `Exported 2 formats`);

  // Check STEP file exists
  const stepFile = resolve(OUTPUT_DIR, 'test_asm_bool.step');
  assert(existsSync(stepFile), 'Assembly STEP file exists');
}

async function testAssemblyWithLibraryParts() {
  console.log('\n--- Test: Assembly with library parts ---');

  const config = {
    name: 'test_asm_lib',
    parts: [
      {
        id: 'shaft',
        shapes: [{
          id: 's',
          type: 'library/stepped_shaft',
          segments: [
            { diameter: 20, length: 10 },
            { diameter: 25, length: 30 },
            { diameter: 20, length: 10 },
          ],
        }],
        operations: [],
      },
      {
        id: 'bearing1',
        shapes: [{
          id: 'b',
          type: 'library/ball_bearing',
          inner_d: 20,
          outer_d: 42,
          width: 12,
        }],
        operations: [],
      },
      {
        id: 'bearing2',
        shapes: [{
          id: 'b',
          type: 'library/ball_bearing',
          inner_d: 20,
          outer_d: 42,
          width: 12,
        }],
        operations: [],
      },
    ],
    assembly: {
      parts: [
        { ref: 'shaft', position: [0, 0, 0] },
        { ref: 'bearing1', position: [0, 0, 5] },
        { ref: 'bearing2', position: [0, 0, 40] },
      ],
    },
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Assembly with library parts succeeded');
  assert(result.assembly.part_count === 3, `Part count is 3 (got ${result.assembly.part_count})`);
  assert(Object.keys(result.assembly.parts).length === 3, 'Parts metadata has 3 entries');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
}

async function testPTUAssembly() {
  console.log('\n--- Test: PTU assembly (full integration) ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/ptu_assembly.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'PTU assembly creation succeeded');
  assert(result.model.name === 'ptu_assembly', 'PTU assembly name matches');
  assert(result.assembly !== undefined, 'Assembly metadata present');
  assert(result.assembly.part_count === 7, `Part count is 7 (got ${result.assembly.part_count})`);
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
  assert(result.exports.length === 2, `Exported 2 formats`);

  // Check STEP file exists
  const stepFile = resolve(OUTPUT_DIR, 'ptu_assembly.step');
  assert(existsSync(stepFile), 'PTU assembly STEP file exists');
}

async function testAssemblyLegacyCompat() {
  console.log('\n--- Test: Legacy mode (no assembly key) still works ---');

  const config = {
    name: 'test_legacy',
    shapes: [{ id: 'box', type: 'box', length: 10, width: 10, height: 10 }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Legacy mode succeeded');
  assert(result.assembly === undefined, 'No assembly metadata in legacy mode');
  assert(Math.abs(result.model.volume - 1000) < 1, `Volume is 1000 (got ${result.model.volume})`);
}


async function main() {
  console.log('FreeCAD Automation - Integration Tests');
  console.log('=' .repeat(40));

  // Clean output directory
  if (existsSync(OUTPUT_DIR)) rmSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  try {
    // Phase 1 tests
    await testSimpleBox();
    await testCreateModel();
    await testInspectSTEP();

    // Phase 2 test
    await testFemAnalysis();

    // Phase 3 tests: Revolution
    await testRevolutionSimple();
    await testRevolutionPartial();
    await testRevolutionWithArc();

    // Phase 3 tests: Extrusion
    await testExtrusionSimple();
    await testExtrusionWithPosition();

    // Phase 3 tests: Circular Pattern
    await testCircularPattern();

    // Phase 3 tests: Combined
    await testRevolutionBooleanCombo();

    // Phase 3 tests: PTU full integration
    await testPTU();

    // Phase 5 tests: Parts Library
    await testBallBearing();
    await testSpurGear();
    await testSteppedShaft();
    await testLibraryPartWithPosition();

    // Phase 5 tests: Assembly
    await testSimpleAssembly();
    await testAssemblyWithBoolean();
    await testAssemblyWithLibraryParts();
    await testPTUAssembly();
    await testAssemblyLegacyCompat();
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
