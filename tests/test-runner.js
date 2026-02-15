/**
 * Integration tests for FreeCAD automation framework.
 * Tests: create model → inspect output → verify metadata.
 */

import { resolve } from 'node:path';
import { existsSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parse as parseTOML } from 'smol-toml';
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

  const config = await loadConfig(resolve(ROOT, 'configs/examples/ks_bracket.toml'));
  // Override output directory to use absolute path
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Model creation succeeded');
  assert(result.model.name === 'ks_bracket', 'Model name matches');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
  assert(result.model.faces > 0, `Has faces (${result.model.faces})`);
  assert(result.model.edges > 0, `Has edges (${result.model.edges})`);
  assert(result.exports.length === 2, `Exported 2 formats`);

  return result;
}

async function testInspectSTEP() {
  console.log('\n--- Test: Inspect STEP file ---');

  const stepFile = resolve(OUTPUT_DIR, 'ks_bracket.step');
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

  const config = await loadConfig(resolve(ROOT, 'configs/examples/ks_assembly.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'KS assembly creation succeeded');
  assert(result.model.name === 'ks_assembly', 'KS assembly name matches');
  assert(result.assembly !== undefined, 'Assembly metadata present');
  assert(result.assembly.part_count === 4, `Part count is 4 (got ${result.assembly.part_count})`);
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
  assert(result.exports.length === 1, `Exported 1 format`);

  // Check STEP file exists
  const stepFile = resolve(OUTPUT_DIR, 'ks_assembly.step');
  assert(existsSync(stepFile), 'KS assembly STEP file exists');
}

// ---------------------------------------------------------------------------
// Phase 6 Tests: Mate Constraints
// ---------------------------------------------------------------------------

async function testMateCoaxial() {
  console.log('\n--- Test: Mate coaxial (shaft in housing bore) ---');

  const config = {
    name: 'test_mate_coaxial',
    parts: [
      {
        id: 'housing',
        shapes: [{
          id: 'body',
          type: 'cylinder',
          radius: 30,
          height: 40,
        }, {
          id: 'bore',
          type: 'cylinder',
          radius: 15,
          height: 50,
          position: [0, 0, -5],
        }],
        operations: [
          { op: 'cut', base: 'body', tool: 'bore', result: 'housing' },
        ],
        final: 'housing',
      },
      {
        id: 'shaft',
        shapes: [{
          id: 's',
          type: 'cylinder',
          radius: 14,
          height: 60,
        }],
        operations: [],
      },
    ],
    assembly: {
      parts: [
        { ref: 'housing', position: [0, 0, 0] },
        { ref: 'shaft' },
      ],
      mates: [
        {
          type: 'coaxial',
          part1: 'housing',
          face1: 'cyl:z:min',
          part2: 'shaft',
          face2: 'cyl:z',
        },
      ],
    },
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    timeout: 120_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Coaxial mate succeeded');
  assert(result.assembly !== undefined, 'Assembly metadata present');
  assert(result.assembly.part_count === 2, `Part count is 2 (got ${result.assembly.part_count})`);
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
}

async function testMateCoincidentOnly() {
  console.log('\n--- Test: Mate coincident (box stacking) ---');

  const config = {
    name: 'test_mate_coincident',
    parts: [
      {
        id: 'base_box',
        shapes: [{ id: 'b', type: 'box', length: 20, width: 20, height: 10 }],
        operations: [],
      },
      {
        id: 'top_box',
        shapes: [{ id: 'b', type: 'box', length: 20, width: 20, height: 10 }],
        operations: [],
      },
    ],
    assembly: {
      parts: [
        { ref: 'base_box', position: [0, 0, 0] },
        { ref: 'top_box' },
      ],
      mates: [
        {
          type: 'coincident',
          part1: 'base_box',
          face1: 'plane:+z:max',
          part2: 'top_box',
          face2: 'plane:-z:min',
        },
      ],
    },
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    timeout: 120_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Coincident mate succeeded');
  assert(result.assembly.part_count === 2, `Part count is 2 (got ${result.assembly.part_count})`);
  // Two 20x20x10 boxes stacked: total volume = 8000
  assert(Math.abs(result.model.volume - 8000) < 10, `Volume ~8000 (got ${result.model.volume})`);
  // Bounding box height should be ~20 (two 10mm boxes stacked)
  const bb = result.model.bounding_box;
  assert(Math.abs(bb.size[2] - 20) < 1, `BB height ~20 (got ${bb.size[2]})`);
}

async function testMateDistance() {
  console.log('\n--- Test: Mate distance (5mm gap) ---');

  const config = {
    name: 'test_mate_distance',
    parts: [
      {
        id: 'plate_a',
        shapes: [{ id: 'b', type: 'box', length: 30, width: 30, height: 5 }],
        operations: [],
      },
      {
        id: 'plate_b',
        shapes: [{ id: 'b', type: 'box', length: 30, width: 30, height: 5 }],
        operations: [],
      },
    ],
    assembly: {
      parts: [
        { ref: 'plate_a', position: [0, 0, 0] },
        { ref: 'plate_b' },
      ],
      mates: [
        {
          type: 'distance',
          part1: 'plate_a',
          face1: 'plane:+z:max',
          part2: 'plate_b',
          face2: 'plane:-z:min',
          value: 5.0,
        },
      ],
    },
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    timeout: 120_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Distance mate succeeded');
  assert(result.assembly.part_count === 2, `Part count is 2 (got ${result.assembly.part_count})`);
  // BB height should be ~15 (5mm plate + 5mm gap + 5mm plate)
  const bb = result.model.bounding_box;
  assert(Math.abs(bb.size[2] - 15) < 1, `BB height ~15 (got ${bb.size[2]})`);
}

async function testMateMixedPlacement() {
  console.log('\n--- Test: Mate mixed (explicit + mate placement) ---');

  const config = {
    name: 'test_mate_mixed',
    parts: [
      {
        id: 'base',
        shapes: [{ id: 'b', type: 'box', length: 40, width: 40, height: 10 }],
        operations: [],
      },
      {
        id: 'pillar',
        shapes: [{ id: 'c', type: 'cylinder', radius: 5, height: 30 }],
        operations: [],
      },
      {
        id: 'side_box',
        shapes: [{ id: 'b', type: 'box', length: 10, width: 10, height: 10 }],
        operations: [],
      },
    ],
    assembly: {
      parts: [
        { ref: 'base', position: [0, 0, 0] },
        { ref: 'pillar' },
        { ref: 'side_box', position: [50, 0, 0] },
      ],
      mates: [
        {
          type: 'coincident',
          part1: 'base',
          face1: 'plane:+z:max',
          part2: 'pillar',
          face2: 'plane:-z:min',
        },
      ],
    },
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    timeout: 120_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Mixed placement succeeded');
  assert(result.assembly.part_count === 3, `Part count is 3 (got ${result.assembly.part_count})`);
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
}

async function testMateChain() {
  console.log('\n--- Test: Mate chain (A → B → C) ---');

  const config = {
    name: 'test_mate_chain',
    parts: [
      {
        id: 'block_a',
        shapes: [{ id: 'b', type: 'box', length: 10, width: 10, height: 10 }],
        operations: [],
      },
      {
        id: 'block_b',
        shapes: [{ id: 'b', type: 'box', length: 10, width: 10, height: 10 }],
        operations: [],
      },
      {
        id: 'block_c',
        shapes: [{ id: 'b', type: 'box', length: 10, width: 10, height: 10 }],
        operations: [],
      },
    ],
    assembly: {
      parts: [
        { ref: 'block_a', position: [0, 0, 0] },
        { ref: 'block_b' },
        { ref: 'block_c' },
      ],
      mates: [
        {
          type: 'coincident',
          part1: 'block_a',
          face1: 'plane:+z:max',
          part2: 'block_b',
          face2: 'plane:-z:min',
        },
        {
          type: 'coincident',
          part1: 'block_b',
          face1: 'plane:+z:max',
          part2: 'block_c',
          face2: 'plane:-z:min',
        },
      ],
    },
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    timeout: 120_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Chain mate succeeded');
  assert(result.assembly.part_count === 3, `Part count is 3 (got ${result.assembly.part_count})`);
  // Three 10mm blocks stacked: height = 30
  const bb = result.model.bounding_box;
  assert(Math.abs(bb.size[2] - 30) < 1, `BB height ~30 (got ${bb.size[2]})`);
  // Total volume = 3000
  assert(Math.abs(result.model.volume - 3000) < 10, `Volume ~3000 (got ${result.model.volume})`);
}

async function testMateErrorNoAnchor() {
  console.log('\n--- Test: Mate error (no anchor) ---');

  const config = {
    name: 'test_mate_no_anchor',
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
        { ref: 'box_a' },
        { ref: 'box_b' },
      ],
      mates: [
        {
          type: 'coincident',
          part1: 'box_a',
          face1: 'plane:+z:max',
          part2: 'box_b',
          face2: 'plane:-z:min',
        },
      ],
    },
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  try {
    await runScript('create_model.py', config, {
      timeout: 120_000,
      onStderr: (t) => process.stderr.write(`    ${t}`),
    });
    assert(false, 'No-anchor mate should have thrown');
  } catch (err) {
    assert(err.message.includes('anchor'), `Error mentions anchor`);
    assert(true, 'No-anchor mate correctly rejected');
  }
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


// ---------------------------------------------------------------------------
// Phase 7 Tests: Kinematic Motion Simulation
// ---------------------------------------------------------------------------

async function testMotionKeyframes() {
  console.log('\n--- Test: Motion keyframe generation ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/ptu_motion.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'PTU motion build succeeded');
  assert(result.motion_data !== undefined, 'motion_data present in result');
  assert(result.motion_data.duration === 2.0, `Duration is 2.0s (got ${result.motion_data?.duration})`);
  assert(result.motion_data.loop === true, 'Loop is true');
  assert(result.motion_data.parts !== undefined, 'Parts dict present');

  // Shaft should have keyframes
  const shaft = result.motion_data.parts.input_shaft;
  assert(shaft !== undefined, 'input_shaft motion present');
  assert(shaft.type === 'revolute', `Shaft type is revolute (got ${shaft?.type})`);
  assert(shaft.keyframes.length === 61, `Shaft has 61 keyframes (60 steps + 1) (got ${shaft?.keyframes?.length})`);
  assert(shaft.keyframes[0].angle === 0, 'Shaft starts at 0°');
  assert(shaft.keyframes[shaft.keyframes.length - 1].angle === 360, 'Shaft ends at 360°');

  // Gear should have coupled keyframes
  const gear = result.motion_data.parts.drive_gear;
  assert(gear !== undefined, 'drive_gear motion present');
  assert(gear.type === 'revolute', `Gear type is revolute (got ${gear?.type})`);

  return result;
}

async function testGearRatio() {
  console.log('\n--- Test: Gear ratio coupling ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/ptu_motion.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  const shaft = result.motion_data.parts.input_shaft;
  const gear = result.motion_data.parts.drive_gear;

  // At final keyframe: shaft=360, gear should be 360*(-0.8333) ≈ -300
  const lastShaft = shaft.keyframes[shaft.keyframes.length - 1].angle;
  const lastGear = gear.keyframes[gear.keyframes.length - 1].angle;
  const expectedGear = lastShaft * -0.8333;

  assert(Math.abs(lastGear - expectedGear) < 0.1,
    `Gear end angle ~${expectedGear.toFixed(1)} (got ${lastGear})`);
  // Gear rotates opposite direction (negative)
  assert(lastGear < 0, `Gear rotates in negative direction (${lastGear})`);
}

async function testMotionBackwardCompat() {
  console.log('\n--- Test: Motion backward compat (no motion config) ---');

  // Use existing bracket.toml which has no motion
  const config = await loadConfig(resolve(ROOT, 'configs/examples/ks_bracket.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Bracket build still succeeds');
  assert(result.motion_data === undefined, 'No motion_data for non-motion config');
}

async function testMotionMatesAssembly() {
  console.log('\n--- Test: Mates assembly without motion still works ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/ptu_assembly_mates.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'PTU mates assembly still succeeds');
  assert(result.motion_data === undefined, 'No motion_data when no joints/motion defined');
}

// ---------------------------------------------------------------------------
// Phase 8 Tests: Extended Parts Library
// ---------------------------------------------------------------------------

async function testHelicalGear() {
  console.log('\n--- Test: Helical gear (library part) ---');

  const config = {
    name: 'test_helical_gear',
    shapes: [{
      id: 'gear',
      type: 'library/helical_gear',
      module: 3,
      teeth: 16,
      width: 12,
      bore_d: 10,
      helix_angle: 15,
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    timeout: 180_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Helical gear creation succeeded');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
}

async function testDiscCam() {
  console.log('\n--- Test: Disc cam (library part) ---');

  const config = {
    name: 'test_disc_cam',
    shapes: [{
      id: 'cam',
      type: 'library/disc_cam',
      base_radius: 20,
      max_lift: 10,
      width: 15,
      bore_d: 8,
      profile_type: 'harmonic',
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Disc cam creation succeeded');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
}

async function testPulley() {
  console.log('\n--- Test: Pulley (library part) ---');

  const config = {
    name: 'test_pulley',
    shapes: [{
      id: 'pulley',
      type: 'library/pulley',
      pitch_d: 60,
      width: 20,
      groove_angle: 38,
      groove_depth: 5,
      bore_d: 12,
      num_grooves: 2,
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Pulley creation succeeded');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
}

async function testCoilSpring() {
  console.log('\n--- Test: Coil spring (library part) ---');

  const config = {
    name: 'test_coil_spring',
    shapes: [{
      id: 'spring',
      type: 'library/coil_spring',
      wire_d: 2,
      coil_d: 20,
      pitch: 8,
      num_coils: 5,
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    timeout: 120_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Coil spring creation succeeded');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
}

// ---------------------------------------------------------------------------
// Phase 8 Tests: Extended Kinematics
// ---------------------------------------------------------------------------

async function testBeltDrive() {
  console.log('\n--- Test: Belt drive assembly ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/belt_drive.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Belt drive build succeeded');
  assert(result.motion_data !== undefined, 'motion_data present');
  assert(result.motion_data.parts.motor_pulley !== undefined, 'Motor pulley in motion');
  assert(result.motion_data.parts.driven_pulley !== undefined, 'Driven pulley in motion');

  // Belt ratio: motor 720° → driven 360° (ratio 0.5)
  const motor = result.motion_data.parts.motor_pulley;
  const driven = result.motion_data.parts.driven_pulley;
  const lastMotor = motor.keyframes[motor.keyframes.length - 1].angle;
  const lastDriven = driven.keyframes[driven.keyframes.length - 1].angle;
  assert(Math.abs(lastDriven - lastMotor * 0.5) < 0.1,
    `Belt ratio correct: motor ${lastMotor}° → driven ${lastDriven}°`);

  // ── Physics: constant ratio at every keyframe ──
  let maxRatioErr = 0;
  for (let i = 1; i < motor.keyframes.length; i++) {
    const r = driven.keyframes[i].angle / motor.keyframes[i].angle;
    maxRatioErr = Math.max(maxRatioErr, Math.abs(r - 0.5));
  }
  assert(maxRatioErr < 0.001, `Belt ratio constant all frames (max err ${maxRatioErr.toFixed(6)})`);

  // ── Physics: same direction (positive belt, not gear reversal) ──
  assert(lastMotor > 0 && lastDriven > 0, 'Belt: same rotation direction');
}

async function testCamFollower() {
  console.log('\n--- Test: Cam-follower mechanism ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/cam_follower.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Cam follower build succeeded');
  assert(result.motion_data !== undefined, 'motion_data present');

  const cam = result.motion_data.parts.cam;
  assert(cam !== undefined, 'Cam part in motion');
  assert(cam.type === 'revolute', 'Cam is revolute');

  const follower = result.motion_data.parts.follower;
  assert(follower !== undefined, 'Follower part in motion');
  assert(follower.type === 'prismatic', `Follower is prismatic (got ${follower?.type})`);

  // At half rotation (180°), harmonic cam should be at max lift (10mm)
  const midIdx = Math.floor(follower.keyframes.length / 2);
  const midDisp = follower.keyframes[midIdx].displacement;
  assert(Math.abs(midDisp - 10) < 0.5, `Follower at 180° near max lift 10mm (got ${midDisp})`);

  // At 0° and 360°, displacement should be near 0
  assert(Math.abs(follower.keyframes[0].displacement) < 0.1, 'Follower at 0° near zero');

  // ── Physics: harmonic profile d(θ) = (max_lift/2)(1-cos(πφ)) ──
  const maxLift = 10;
  const nKf = follower.keyframes.length;
  const step90 = Math.round(90 / 360 * (nKf - 1));
  const step270 = Math.round(270 / 360 * (nKf - 1));
  const d90 = follower.keyframes[step90].displacement;
  const d270 = follower.keyframes[step270].displacement;
  const d360 = follower.keyframes[nKf - 1].displacement;
  assert(Math.abs(d90 - 5) < 0.2, `Harmonic at 90° ≈ 5mm (got ${d90.toFixed(3)})`);
  assert(Math.abs(d270 - 5) < 0.2, `Harmonic at 270° ≈ 5mm (got ${d270.toFixed(3)})`);
  assert(Math.abs(d360) < 0.2, `Follower at 360° returns to ~0 (got ${d360.toFixed(3)})`);
  assert(Math.abs(d90 - d270) < 0.1, `Harmonic symmetry d(90°) ≈ d(270°)`);

  // ── Physics: monotonic rise 0→180° then fall 180→360° ──
  let monotonicRise = true;
  for (let i = 1; i <= midIdx; i++) {
    if (follower.keyframes[i].displacement < follower.keyframes[i - 1].displacement - 0.01) {
      monotonicRise = false; break;
    }
  }
  assert(monotonicRise, 'Monotonic rise 0°→180°');

  let monotonicFall = true;
  for (let i = midIdx + 1; i < nKf; i++) {
    if (follower.keyframes[i].displacement > follower.keyframes[i - 1].displacement + 0.01) {
      monotonicFall = false; break;
    }
  }
  assert(monotonicFall, 'Monotonic fall 180°→360°');
}

async function testFourBarLinkage() {
  console.log('\n--- Test: Four-bar linkage ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/four_bar_linkage.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Four-bar linkage build succeeded');
  assert(result.motion_data !== undefined, 'motion_data present');
  assert(result.motion_data.parts.coupler !== undefined, 'Coupler part in motion');
  assert(result.motion_data.parts.rocker !== undefined, 'Rocker part in motion');

  // Coupler is floating (per-keyframe anchor), rocker is revolute
  assert(result.motion_data.parts.coupler.type === 'floating', 'Coupler is floating link');
  assert(result.motion_data.parts.rocker.type === 'revolute', 'Rocker is revolute');

  // Coupler keyframes should have per-keyframe anchor arrays
  const coupler = result.motion_data.parts.coupler;
  assert(Array.isArray(coupler.keyframes[0].anchor), 'Coupler has per-keyframe anchor');

  // Rocker uses delta angles — should start near 0 and oscillate
  const rocker = result.motion_data.parts.rocker;
  assert(Math.abs(rocker.keyframes[0].angle) < 0.1, `Rocker starts near 0° delta (got ${rocker.keyframes[0].angle})`);
  const angles = rocker.keyframes.map(kf => kf.angle);
  const minA = Math.min(...angles);
  const maxA = Math.max(...angles);
  assert(maxA - minA < 180, `Rocker oscillates within <180° range (${minA.toFixed(1)} to ${maxA.toFixed(1)})`);

  // ── Physics: loop closure |BC|=50 at every keyframe ──
  const initRockerDeg = 108.2; // solved initial rocker angle
  let maxClosureErr = 0;
  for (let i = 0; i < coupler.keyframes.length; i++) {
    const B = coupler.keyframes[i].anchor;
    const delta = rocker.keyframes[i].angle;
    const ra = (initRockerDeg + delta) * Math.PI / 180;
    const Cx = 60 + 45 * Math.cos(ra);
    const Cy = 45 * Math.sin(ra);
    const BC = Math.sqrt((Cx - B[0]) ** 2 + (Cy - B[1]) ** 2);
    maxClosureErr = Math.max(maxClosureErr, Math.abs(BC - 50));
  }
  assert(maxClosureErr < 0.5, `Loop closure |BC|=50 all frames (max err ${maxClosureErr.toFixed(4)}mm)`);

  // ── Physics: periodicity — returns to start after 360° ──
  const couplerEnd = coupler.keyframes[coupler.keyframes.length - 1].angle;
  const rockerEnd = rocker.keyframes[rocker.keyframes.length - 1].angle;
  assert(Math.abs(couplerEnd) < 1.0, `Coupler returns to ~0° at 360° (got ${couplerEnd.toFixed(2)}°)`);
  assert(Math.abs(rockerEnd) < 1.0, `Rocker returns to ~0° at 360° (got ${rockerEnd.toFixed(2)}°)`);
}

async function testPistonEngine() {
  console.log('\n--- Test: Piston engine (crank-slider) ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/piston_engine.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Piston engine build succeeded');
  assert(result.motion_data !== undefined, 'motion_data present');

  const piston = result.motion_data.parts.piston;
  assert(piston !== undefined, 'Piston part in motion');
  assert(piston.type === 'prismatic', 'Piston is prismatic');

  // At 0° (TDC), displacement = 0
  assert(Math.abs(piston.keyframes[0].displacement) < 0.01,
    `Piston at TDC near 0mm (got ${piston.keyframes[0].displacement})`);

  // At 180° (BDC), displacement = -30mm (piston moves toward crank)
  // Find keyframe near 180°
  const crank = result.motion_data.parts.crank_arm;
  const idx180 = crank.keyframes.findIndex(kf => Math.abs(kf.angle - 180) < 4);
  if (idx180 >= 0) {
    const bdc = piston.keyframes[idx180].displacement;
    assert(Math.abs(bdc - (-30)) < 1, `Piston at BDC near -30mm (got ${bdc})`);
  }

  // Connecting rod is floating link (per-keyframe anchor follows crank pin)
  const rod = result.motion_data.parts.con_rod;
  assert(rod !== undefined, 'Connecting rod in motion');
  assert(rod.type === 'floating', 'Con rod is floating link');
  assert(Array.isArray(rod.keyframes[0].anchor), 'Con rod has per-keyframe anchor');

  // ── Physics: pin→piston distance = rod_length at key angles ──
  const crank_r = 15, rod_l = 50;
  const pistonInitX = 85; // TDC position from TOML
  const pistonY = 30;     // piston Y from TOML
  for (const step of [0, idx180, Math.round(90 / 720 * (crank.keyframes.length - 1))]) {
    if (step < 0) continue;
    const pinA = rod.keyframes[step].anchor;
    const px = pistonInitX + piston.keyframes[step].displacement;
    const dist = Math.sqrt((px - pinA[0]) ** 2 + (pistonY - pinA[1]) ** 2);
    const angle = crank.keyframes[step].angle;
    assert(Math.abs(dist - rod_l) < 0.5, `|pin→piston| = ${rod_l}mm at θ=${angle}° (got ${dist.toFixed(2)})`);
  }

  // ── Physics: stroke = 2×crank_r ──
  const allDisp = piston.keyframes.map(kf => kf.displacement);
  const stroke = Math.max(...allDisp) - Math.min(...allDisp);
  assert(Math.abs(stroke - 2 * crank_r) < 1, `Stroke = ${2 * crank_r}mm (got ${stroke.toFixed(2)})`);

  // ── Physics: periodicity — displacement returns to 0 after 360° ──
  const step360 = Math.round(360 / 720 * (crank.keyframes.length - 1));
  const d360 = piston.keyframes[step360].displacement;
  assert(Math.abs(d360) < 0.5, `Piston returns to ~0mm at 360° (got ${d360.toFixed(2)})`);
}

// ---------------------------------------------------------------------------
// Seatbelt Retractor Demo Tests
// ---------------------------------------------------------------------------

async function testRetractorBuild() {
  console.log('\n--- Test: Seatbelt retractor build (7 parts) ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/seatbelt_retractor.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Retractor build succeeded');
  assert(result.model.name === 'seatbelt_retractor', 'Model name matches');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);

  // Verify all 7 parts built
  const stepFile = resolve(OUTPUT_DIR, 'seatbelt_retractor.step');
  assert(existsSync(stepFile), 'STEP file exists');

  return result;
}

async function testRetractorMotionData() {
  console.log('\n--- Test: Retractor motion data structure ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/seatbelt_retractor.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.motion_data !== undefined, 'motion_data present');
  assert(result.motion_data.duration === 4.0, 'Duration is 4s');
  assert(result.motion_data.loop === true, 'Loop is true');

  // Spool (driver) should have revolute keyframes
  const spool = result.motion_data.parts.spool;
  assert(spool !== undefined, 'Spool part in motion');
  assert(spool.type === 'revolute', 'Spool is revolute');
  assert(spool.keyframes.length === 121, `Spool has 121 keyframes (got ${spool.keyframes.length})`);

  // Lock cam (gear coupled)
  const cam = result.motion_data.parts.lock_cam;
  assert(cam !== undefined, 'Lock cam part in motion');
  assert(cam.type === 'revolute', 'Lock cam is revolute');

  // Pawl (cam_follower coupled)
  const pawl = result.motion_data.parts.pawl;
  assert(pawl !== undefined, 'Pawl part in motion');
  assert(pawl.type === 'prismatic', `Pawl is prismatic (got ${pawl?.type})`);

  return result;
}

async function testRetractorCamLock() {
  console.log('\n--- Test: Retractor cam lock (dwell zone) ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/seatbelt_retractor.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  const pawl = result.motion_data.parts.pawl;
  const spool = result.motion_data.parts.spool;
  const nKf = pawl.keyframes.length;

  // Dwell profile: phase = angle/180 for 0→180°, symmetrically back for 180→360°
  // Dwell zone is phase 0.25–0.75, i.e., 45°–135° and 225°–315°
  // At 90° (phase=0.5): max_lift=6mm (center of dwell)
  // At 180° (phase=1.0): returns to 0mm
  const step45 = Math.round(45 / 720 * (nKf - 1));
  const step90 = Math.round(90 / 720 * (nKf - 1));
  const step135 = Math.round(135 / 720 * (nKf - 1));

  const d45 = pawl.keyframes[step45].displacement;
  const d90 = pawl.keyframes[step90].displacement;
  const d135 = pawl.keyframes[step135].displacement;

  assert(d90 > 5.5, `Pawl at 90° at max lift (got ${d90.toFixed(3)}mm)`);
  assert(d45 > 5.5, `Pawl at 45° in dwell zone (got ${d45.toFixed(3)}mm)`);
  assert(d135 > 5.5, `Pawl at 135° in dwell zone (got ${d135.toFixed(3)}mm)`);
}

async function testRetractorSpoolCamSync() {
  console.log('\n--- Test: Retractor spool-cam sync (1:1 gear) ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/seatbelt_retractor.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  const spool = result.motion_data.parts.spool;
  const cam = result.motion_data.parts.lock_cam;

  // 1:1 gear ratio: cam angle should equal spool angle at every keyframe
  let maxSyncErr = 0;
  for (let i = 0; i < spool.keyframes.length; i++) {
    const err = Math.abs(cam.keyframes[i].angle - spool.keyframes[i].angle);
    maxSyncErr = Math.max(maxSyncErr, err);
  }
  assert(maxSyncErr < 0.01, `Spool-cam 1:1 sync (max err ${maxSyncErr.toFixed(4)}°)`);

  // Final angles should both be 720°
  const spoolEnd = spool.keyframes[spool.keyframes.length - 1].angle;
  const camEnd = cam.keyframes[cam.keyframes.length - 1].angle;
  assert(Math.abs(spoolEnd - 720) < 0.01, `Spool ends at 720° (got ${spoolEnd})`);
  assert(Math.abs(camEnd - 720) < 0.01, `Cam ends at 720° (got ${camEnd})`);
}

async function testRetractorPawlProfile() {
  console.log('\n--- Test: Retractor pawl dwell profile shape ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/seatbelt_retractor.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  const pawl = result.motion_data.parts.pawl;
  const nKf = pawl.keyframes.length;

  // At 0° and 360°, pawl displacement should be near 0
  const d0 = pawl.keyframes[0].displacement;
  const step360 = Math.round(360 / 720 * (nKf - 1));
  const d360 = pawl.keyframes[step360].displacement;
  assert(Math.abs(d0) < 0.1, `Pawl at 0° near zero (got ${d0.toFixed(4)})`);
  assert(Math.abs(d360) < 0.1, `Pawl at 360° near zero (got ${d360.toFixed(4)})`);

  // Dwell zone should be flat: between 45° and 135° (phase 0.25–0.75) displacement is max_lift
  const step45 = Math.round(45 / 720 * (nKf - 1));
  const step135 = Math.round(135 / 720 * (nKf - 1));
  let minDwell = Infinity, maxDwell = -Infinity;
  for (let i = step45; i <= step135; i++) {
    const d = pawl.keyframes[i].displacement;
    minDwell = Math.min(minDwell, d);
    maxDwell = Math.max(maxDwell, d);
  }
  const dwellRange = maxDwell - minDwell;
  assert(dwellRange < 0.5, `Dwell zone is flat (range ${dwellRange.toFixed(4)}mm)`);
}

async function testMjcfConversion() {
  console.log('\n--- Test: TOML to MJCF conversion ---');

  const inputToml = resolve(ROOT, 'configs/examples/seatbelt_retractor.toml');
  const outputXml = resolve(OUTPUT_DIR, 'seatbelt_retractor.xml');

  // Run conversion
  const cmd = `node ${resolve(ROOT, 'scripts/toml-to-mjcf.js')} ${inputToml} ${outputXml}`;
  const stdout = execSync(cmd, { encoding: 'utf8', timeout: 30_000 });
  const result = JSON.parse(stdout);

  assert(result.success === true, 'MJCF conversion succeeded');
  assert(result.bodies === 7, `7 assembly parts (got ${result.bodies})`);
  assert(result.joints === 3, `3 joints (got ${result.joints})`);
  assert(result.couplings === 2, `2 couplings (got ${result.couplings})`);

  // Verify XML file exists and is valid XML
  assert(existsSync(outputXml), 'MJCF XML file exists');
  const xml = readFileSync(outputXml, 'utf8');
  assert(xml.includes('<mujoco model="seatbelt_retractor"'), 'XML has correct model name');
  assert(xml.includes('joint name="spool_rev"'), 'XML has spool_rev joint');
  assert(xml.includes('joint name="cam_rev"'), 'XML has cam_rev joint');
  assert(xml.includes('joint name="pawl_prism"'), 'XML has pawl_prism joint');
  assert(xml.includes('<actuator>'), 'XML has actuator section');
  assert(xml.includes('<equality>'), 'XML has equality constraints');
  assert(xml.includes('cam_follower'), 'XML references cam_follower coupling');
}

async function testMjcfValidation() {
  console.log('\n--- Test: MuJoCo MJCF validation ---');

  const outputXml = resolve(OUTPUT_DIR, 'seatbelt_retractor.xml');

  // Ensure XML exists (testMjcfConversion should run first)
  if (!existsSync(outputXml)) {
    // Run conversion first
    const inputToml = resolve(ROOT, 'configs/examples/seatbelt_retractor.toml');
    execSync(`node ${resolve(ROOT, 'scripts/toml-to-mjcf.js')} ${inputToml} ${outputXml}`, { timeout: 30_000 });
  }

  // Run MuJoCo validation
  const cmd = `python3 ${resolve(ROOT, 'scripts/validate-mjcf.py')} ${outputXml}`;
  let stdout;
  try {
    stdout = execSync(cmd, { encoding: 'utf8', timeout: 30_000 });
  } catch (e) {
    // validate-mjcf.py exits 1 on validation failure but still outputs JSON
    stdout = e.stdout || '';
  }

  const result = JSON.parse(stdout);

  assert(result.checks.xml_load === true, 'MuJoCo XML loads successfully');
  assert(result.checks.has_bodies === true, 'Has bodies');
  assert(result.checks.has_joints === true, 'Has joints');
  assert(result.checks.positive_mass === true, 'Positive total mass');
  assert(result.total_mass_kg > 0, `Total mass ${result.total_mass_kg} kg`);
  assert(result.counts.bodies === 7, `7 bodies (got ${result.counts.bodies})`);
  assert(result.counts.joints === 3, `3 joints (got ${result.counts.joints})`);
  assert(result.stability.stable === true, `Stable after 100 steps (drift ${result.stability.max_position_drift})`);
}

// ---------------------------------------------------------------------------
// Design Reviewer Tests (require GEMINI_API_KEY)
// ---------------------------------------------------------------------------

async function testDesignReview() {
  console.log('\n--- Test: Design review (Gemini) ---');

  if (!process.env.GEMINI_API_KEY) {
    console.log('  SKIP: GEMINI_API_KEY not set');
    return;
  }

  const inputToml = resolve(ROOT, 'configs/examples/seatbelt_retractor.toml');
  const cmd = `node ${resolve(ROOT, 'scripts/design-reviewer.js')} --review ${inputToml} --json`;

  let stdout;
  try {
    stdout = execSync(cmd, { encoding: 'utf8', timeout: 60_000 });
  } catch (e) {
    // Exit code 1 = critical issues found (expected), still has stdout
    stdout = e.stdout || '';
    if (!stdout) {
      failed++;
      console.error(`  FAIL: Design review crashed: ${e.message}`);
      return;
    }
  }

  const result = JSON.parse(stdout);

  assert(result.mode === 'review', 'Mode is review');
  assert(Array.isArray(result.issues), 'Issues is an array');
  assert(result.issues.length >= 3, `Found 3+ issues (got ${result.issues.length})`);
  assert(result.report !== undefined, 'Report object present');

  // Corrected TOML should parse
  if (result.correctedToml) {
    let parsed = false;
    try {
      parseTOML(result.correctedToml);
      parsed = true;
    } catch { /* parse failed */ }
    assert(parsed, 'Corrected TOML parses successfully');
  }
}

async function testDesignGenerate() {
  console.log('\n--- Test: Design generate (Gemini) ---');

  if (!process.env.GEMINI_API_KEY) {
    console.log('  SKIP: GEMINI_API_KEY not set');
    return;
  }

  const cmd = `node ${resolve(ROOT, 'scripts/design-reviewer.js')} --design "simple cam-follower" --json`;

  let stdout;
  try {
    stdout = execSync(cmd, { encoding: 'utf8', timeout: 60_000 });
  } catch (e) {
    stdout = e.stdout || '';
    if (!stdout) {
      failed++;
      console.error(`  FAIL: Design generate crashed: ${e.message}`);
      return;
    }
  }

  const result = JSON.parse(stdout);

  assert(result.mode === 'design', 'Mode is design');
  assert(result.toml !== null && result.toml !== undefined, 'Generated TOML present');

  // TOML should parse
  if (result.toml) {
    let parsed = false;
    let config;
    try {
      config = parseTOML(result.toml);
      parsed = true;
    } catch { /* parse failed */ }
    assert(parsed, 'Generated TOML parses successfully');
    if (config) {
      const parts = config.parts || [];
      assert(parts.length >= 2, `Has 2+ parts (got ${parts.length})`);
      assert(config.assembly !== undefined, 'Has assembly section');
    }
  }
}

// --- Phase 13: Tolerance Analysis Tests ---

async function testToleranceDB() {
  console.log('\n--- Test: ISO 286 Tolerance Database ---');

  // Pure Python test: verify DB accuracy without FreeCAD
  const result = await runScript('tolerance_db_test.py', {}, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Tolerance DB test succeeded');

  // Ø20 H7 = +0.021/0
  const h7 = result.tests.h7_20;
  assert(h7.upper === 0.021, `Ø20 H7 upper = +0.021 (got ${h7.upper})`);
  assert(h7.lower === 0.0, `Ø20 H7 lower = 0.000 (got ${h7.lower})`);

  // Ø20 g6 = -0.007/-0.020
  const g6 = result.tests.g6_20;
  assert(g6.upper === -0.007, `Ø20 g6 upper = -0.007 (got ${g6.upper})`);
  assert(g6.lower === -0.02, `Ø20 g6 lower = -0.020 (got ${g6.lower})`);

  // H7/g6 fit = clearance
  const fit = result.tests.fit_h7g6_20;
  assert(fit.fit_type === 'clearance', `H7/g6 is clearance fit (got ${fit.fit_type})`);
  assert(fit.clearance_min === 0.007, `Min clearance = 0.007 (got ${fit.clearance_min})`);
  assert(fit.clearance_max === 0.041, `Max clearance = 0.041 (got ${fit.clearance_max})`);

  // H7/p6 fit = interference
  const fit2 = result.tests.fit_h7p6_20;
  assert(fit2.fit_type === 'interference', `H7/p6 is interference fit (got ${fit2.fit_type})`);

  // Fuzzy match
  assert(result.tests.fuzzy_20 === 20, `fuzzy 19.998 → 20 (got ${result.tests.fuzzy_20})`);
}

async function testTolerancePairDetection() {
  console.log('\n--- Test: Tolerance pair detection from assembly ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/ptu_assembly_mates.toml'));
  config.export = config.export || {};
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('tolerance_analysis.py', config, {
    timeout: 120_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Tolerance analysis succeeded');
  assert(Array.isArray(result.pairs), 'Has pairs array');

  // Should find at least one coaxial pair from mates
  const coaxialPairs = result.pairs.filter(p => p.nominal_d > 0);
  assert(coaxialPairs.length > 0, `Found ${coaxialPairs.length} tolerance pair(s)`);

  // Each pair should have required fields
  if (coaxialPairs.length > 0) {
    const p = coaxialPairs[0];
    assert(p.bore_part !== undefined, 'Pair has bore_part');
    assert(p.shaft_part !== undefined, 'Pair has shaft_part');
    assert(p.fit_type !== undefined, `Pair has fit_type (${p.fit_type})`);
    assert(p.clearance_min !== undefined, 'Pair has clearance_min');
    assert(p.spec !== undefined, `Pair has spec (${p.spec})`);
  }
}

async function testToleranceFitAnalysis() {
  console.log('\n--- Test: Fit analysis accuracy ---');

  // Use a simple assembly with known geometry
  const config = await loadConfig(resolve(ROOT, 'configs/examples/ptu_assembly_mates.toml'));
  config.export = config.export || {};
  config.export.directory = resolve(OUTPUT_DIR);

  // Override: force a specific spec for all pairs
  config.tolerance = { specs: {}, recommend: true };

  const result = await runScript('tolerance_analysis.py', config, {
    timeout: 120_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Fit analysis succeeded');

  for (const pr of result.pairs || []) {
    // Verify fit type consistency
    if (pr.clearance_min > 0) {
      assert(pr.fit_type === 'clearance', `Positive min clearance → clearance fit (${pr.spec})`);
    } else if (pr.clearance_max < 0) {
      assert(pr.fit_type === 'interference', `Negative max clearance → interference fit (${pr.spec})`);
    } else {
      assert(pr.fit_type === 'transition', `Mixed clearance → transition fit (${pr.spec})`);
    }
  }
}

async function testToleranceStackUp() {
  console.log('\n--- Test: Tolerance stack-up calculation ---');

  // Pure Python stack-up test with known values
  const result = await runScript('tolerance_stackup_test.py', {}, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Stack-up test succeeded');
  const s = result.stack_up;
  assert(s.chain_length === 3, `Chain length = 3 (got ${s.chain_length})`);
  assert(s.worst_case_mm > 0, `Worst case > 0 (${s.worst_case_mm})`);
  assert(s.rss_3sigma_mm > 0, `RSS > 0 (${s.rss_3sigma_mm})`);
  assert(s.rss_3sigma_mm <= s.worst_case_mm, 'RSS <= worst case');
  assert(s.success_rate_pct > 95, `Success rate > 95% (${s.success_rate_pct})`);
}

async function testGDTSymbols() {
  console.log('\n--- Test: GD&T symbols in drawing ---');

  // Use ptu_assembly_mates.toml which has coaxial mates
  const config = await loadConfig(resolve(ROOT, 'configs/examples/ptu_assembly_mates.toml'));
  config.export = config.export || {};
  config.export.directory = OUTPUT_DIR;

  const result = await runScript('generate_drawing.py', config, {
    timeout: 120_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Drawing generated');
  let svgPath = result.drawing_paths[0].path;
  // Convert Windows/UNC path to WSL path
  if (svgPath.includes('wsl.localhost') || svgPath.includes('wsl$')) {
    svgPath = svgPath.replace(/\\/g, '/').replace(/^\/\/wsl\.localhost\/Ubuntu/, '').replace(/^\/\/wsl\$\/Ubuntu/, '');
  } else if (svgPath.includes('\\')) {
    svgPath = svgPath.replace(/\\/g, '/');
    if (svgPath.match(/^[A-Z]:\//)) {
      svgPath = '/mnt/' + svgPath[0].toLowerCase() + svgPath.slice(2);
    }
  }

  // Read SVG and check for GD&T elements
  const svgContent = readFileSync(svgPath, 'utf8');
  const hasGDT = svgContent.includes('gdt-symbol');
  assert(hasGDT, 'SVG contains GD&T symbols (class="gdt-symbol")');

  const hasConcentricity = svgContent.includes('data-type="concentricity"');
  assert(hasConcentricity, 'SVG contains concentricity symbol for coaxial mates');
}

async function testEngineeringReport() {
  console.log('\n--- Test: Engineering PDF report ---');

  const result = await runScript('report_test.py', {}, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Report test succeeded');
  assert(result.size_bytes > 10000, `PDF size > 10KB (got ${result.size_bytes} bytes)`);
  assert(result.pdf_path.endsWith('_report.pdf'), `PDF path ends with _report.pdf`);
}

async function testToleranceMonteCarlo() {
  console.log('\n--- Test: Monte Carlo tolerance simulation ---');

  const result = await runScript('tolerance_mc_test.py', {}, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'MC test succeeded');
  const mc = result.mc_result;
  assert(mc.chain_length === 3, `Chain length = 3 (got ${mc.chain_length})`);
  assert(mc.num_samples === 10000, `Samples = 10000 (got ${mc.num_samples})`);
  assert(mc.mean_mm > 0, `Mean gap > 0 (${mc.mean_mm})`);
  assert(mc.fail_rate_pct < 5, `Fail rate < 5% (${mc.fail_rate_pct})`);
  assert(mc.cpk >= 0.5, `Cpk >= 0.5 (${mc.cpk})`);
  assert(mc.histogram.counts.length === 20, `Histogram 20 bins (got ${mc.histogram.counts.length})`);
  assert(mc.histogram.edges.length === 21, `Histogram 21 edges (got ${mc.histogram.edges.length})`);

  const p = mc.percentiles;
  assert(p.p0_1 <= p.p1, 'P0.1 <= P1');
  assert(p.p1 <= p.p50, 'P1 <= P50');
  assert(p.p50 <= p.p99, 'P50 <= P99');
  assert(p.p99 <= p.p99_9, 'P99 <= P99.9');

  const total = mc.histogram.counts.reduce((a, b) => a + b, 0);
  assert(total === 10000, `Histogram sum = 10000 (got ${total})`);
}

function parseProfileArg() {
  const raw = process.argv.find((arg) => arg.startsWith('--profile='));
  const profile = raw ? raw.split('=')[1] : (process.env.FCAD_TEST_PROFILE || 'core');
  if (profile === 'core' || profile === 'full') return profile;
  console.warn(`Unknown profile '${profile}', falling back to 'core'`);
  return 'core';
}

async function runCase(name, fn) {
  try {
    await fn();
  } catch (err) {
    failed++;
    console.error(`\nFATAL [${name}]: ${err.message}`);
    if (err.stack) console.error(err.stack);
  }
}

function coreCases() {
  return [
    ['Simple box', testSimpleBox],
    ['Create bracket model', testCreateModel],
    ['Inspect STEP', testInspectSTEP],
    ['FEM analysis', testFemAnalysis],
    ['Revolution simple', testRevolutionSimple],
    ['Revolution partial', testRevolutionPartial],
    ['Revolution with arc', testRevolutionWithArc],
    ['Extrusion simple', testExtrusionSimple],
    ['Extrusion with position', testExtrusionWithPosition],
    ['Circular pattern', testCircularPattern],
    ['Revolution+boolean combo', testRevolutionBooleanCombo],
    ['PTU full integration', testPTU],
    ['Library: ball bearing', testBallBearing],
    ['Library: spur gear', testSpurGear],
    ['Library: stepped shaft', testSteppedShaft],
    ['Library: position offset', testLibraryPartWithPosition],
    ['Assembly: simple', testSimpleAssembly],
    ['Assembly: boolean', testAssemblyWithBoolean],
    ['Assembly: library', testAssemblyWithLibraryParts],
    ['Assembly: PTU', testPTUAssembly],
    ['Assembly: legacy compatibility', testAssemblyLegacyCompat],
    ['Mates: coaxial', testMateCoaxial],
    ['Mates: coincident', testMateCoincidentOnly],
    ['Mates: distance', testMateDistance],
    ['Mates: mixed placement', testMateMixedPlacement],
    ['Mates: chain', testMateChain],
    ['Mates: error no anchor', testMateErrorNoAnchor],
    ['Tolerance DB', testToleranceDB],
    ['Tolerance pair detection', testTolerancePairDetection],
    ['Tolerance fit analysis', testToleranceFitAnalysis],
    ['Tolerance stack-up', testToleranceStackUp],
    ['Tolerance Monte Carlo', testToleranceMonteCarlo],
    ['Engineering report', testEngineeringReport],
    ['GD&T symbols', testGDTSymbols],
  ];
}

function fullOnlyCases() {
  return [
    ['Motion keyframes', testMotionKeyframes],
    ['Gear ratio', testGearRatio],
    ['Motion backward compat', testMotionBackwardCompat],
    ['Motion mates assembly', testMotionMatesAssembly],
    ['Library: helical gear', testHelicalGear],
    ['Library: disc cam', testDiscCam],
    ['Library: pulley', testPulley],
    ['Library: coil spring', testCoilSpring],
    ['Kinematics: belt drive', testBeltDrive],
    ['Kinematics: cam follower', testCamFollower],
    ['Kinematics: four-bar linkage', testFourBarLinkage],
    ['Kinematics: piston engine', testPistonEngine],
    ['Retractor build', testRetractorBuild],
    ['Retractor motion data', testRetractorMotionData],
    ['Retractor cam lock', testRetractorCamLock],
    ['Retractor spool-cam sync', testRetractorSpoolCamSync],
    ['Retractor pawl profile', testRetractorPawlProfile],
    ['MJCF conversion', testMjcfConversion],
    ['MJCF validation', testMjcfValidation],
    ['Design review', testDesignReview],
    ['Design generate', testDesignGenerate],
  ];
}

async function main() {
  console.log('FreeCAD Automation - Integration Tests');
  console.log('=' .repeat(40));
  const profile = parseProfileArg();
  console.log(`Profile: ${profile}`);

  // Clean output directory
  if (existsSync(OUTPUT_DIR)) rmSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const cases = profile === 'full'
    ? [...coreCases(), ...fullOnlyCases()]
    : coreCases();

  for (const [name, fn] of cases) {
    await runCase(name, fn);
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
