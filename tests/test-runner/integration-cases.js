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

export function createIntegrationCases(assert) {
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

async function testAssemblyLabelPreservesPartIdentity() {
  console.log('\n--- Test: Assembly label preserves part identity ---');

  const config = {
    name: 'test_asm_labels',
    parts: [
      {
        id: 'housing',
        shapes: [{ id: 'body', type: 'box', length: 20, width: 20, height: 10, material: 'aluminum' }],
        operations: [],
      },
      {
        id: 'shaft',
        shapes: [{ id: 's', type: 'cylinder', radius: 4, height: 20, material: 'steel' }],
        operations: [],
      },
    ],
    assembly: {
      parts: [
        { ref: 'housing', label: 'Housing-A', position: [0, 0, 0] },
        { ref: 'shaft', label: 'Drive-Shaft', position: [10, 10, 0] },
      ],
    },
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR), per_part_stl: true },
  };

  const result = await runScript('create_model.py', config, {
    timeout: 120_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Labeled assembly succeeded');
  assert(result.assembly.parts.housing !== undefined, 'Assembly metadata keyed by canonical part id');
  assert(result.assembly.parts.shaft !== undefined, 'All parts remain addressable by canonical part id');
  assert(result.assembly.parts.housing.label === 'Housing-A', 'Display label preserved in metadata');
  assert(result.assembly.parts.shaft.label === 'Drive-Shaft', 'Second display label preserved in metadata');
  assert(Array.isArray(result.assembly.part_files), 'Per-part STL metadata present');

  const housingFile = result.assembly.part_files.find((pf) => pf.ref === 'housing');
  const shaftFile = result.assembly.part_files.find((pf) => pf.ref === 'shaft');
  assert(housingFile?.label === 'Housing-A', 'Per-part STL keeps display label');
  assert(shaftFile?.label === 'Drive-Shaft', 'Per-part STL keeps second display label');
  assert(housingFile?.material === 'aluminum', `Housing material preserved (${housingFile?.material})`);
  assert(shaftFile?.material === 'steel', `Shaft material preserved (${shaftFile?.material})`);
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

async function testAssemblyShellBoundary() {
  console.log('\n--- Test: Assembly shell boundary ---');

  const config = {
    name: 'test_assembly_shell_boundary',
    parts: [
      {
        id: 'shell_part',
        shapes: [{ id: 'body', type: 'box', length: 20, width: 20, height: 20 }],
        operations: [{ op: 'shell', target: 'body', thickness: 2, result: 'shell_body' }],
        final: 'shell_body',
      },
    ],
    assembly: {
      parts: [{ ref: 'shell_part', position: [0, 0, 0] }],
    },
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  try {
    await runScript('create_model.py', config, {
      onStderr: (t) => process.stderr.write(`    ${t}`),
    });
    assert(false, 'Assembly shell operation should be rejected');
  } catch (err) {
    assert(err.message.includes('Unknown operation: shell'), 'Assembly shell boundary is explicit');
    assert(true, 'Assembly shell boundary correctly rejected');
  }
}

// ---------------------------------------------------------------------------
// Phase 3 Tests: Revolution, Extrusion, Circular Pattern
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

  return [
    ['Assembly: simple', testSimpleAssembly],
    ['Assembly: boolean', testAssemblyWithBoolean],
    ['Assembly: library', testAssemblyWithLibraryParts],
    ['Assembly: label identity', testAssemblyLabelPreservesPartIdentity],
    ['Assembly: PTU', testPTUAssembly],
    ['Assembly: legacy compatibility', testAssemblyLegacyCompat],
    ['Assembly: shell boundary', testAssemblyShellBoundary],
    ['Mates: coaxial', testMateCoaxial],
    ['Mates: coincident', testMateCoincidentOnly],
    ['Mates: distance', testMateDistance],
    ['Mates: mixed placement', testMateMixedPlacement],
    ['Mates: chain', testMateChain],
    ['Mates: error no anchor', testMateErrorNoAnchor],
  ];
}
