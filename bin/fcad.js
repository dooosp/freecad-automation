#!/usr/bin/env node

import { resolve } from 'node:path';
import { loadConfig } from '../lib/config-loader.js';
import { runScript } from '../lib/runner.js';

const USAGE = `
fcad - FreeCAD automation CLI

Usage:
  fcad create <config.toml|json>  Create model from config
  fcad fem <config.toml|json>     Run FEM structural analysis
  fcad inspect <model.step|fcstd> Inspect model metadata
  fcad serve [port]               Start 3D viewer server (default: 3000)
  fcad help                       Show this help

Examples:
  fcad create configs/examples/bracket.toml
  fcad fem configs/examples/bracket_fem.toml
  fcad inspect output/bracket_v1.step
  fcad serve 8080
`.trim();

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    process.exit(0);
  }

  if (command === 'create') {
    await cmdCreate(args[0]);
  } else if (command === 'fem') {
    await cmdFem(args[0]);
  } else if (command === 'inspect') {
    await cmdInspect(args[0]);
  } else if (command === 'serve') {
    await cmdServe(args[0]);
  } else {
    console.error(`Unknown command: ${command}`);
    console.log(USAGE);
    process.exit(1);
  }
}

async function cmdServe(portArg) {
  const port = parseInt(portArg) || 3000;
  const { startServer } = await import('../server.js');
  startServer(port);
}

async function cmdCreate(configPath) {
  if (!configPath) {
    console.error('Error: config file path required');
    process.exit(1);
  }

  const absPath = resolve(configPath);
  console.log(`Loading config: ${absPath}`);

  const config = await loadConfig(absPath);
  console.log(`Creating model: ${config.name || 'unnamed'}`);
  console.log(`  Shapes: ${config.shapes?.length || 0}`);
  console.log(`  Operations: ${config.operations?.length || 0}`);

  const result = await runScript('create_model.py', config, {
    onStderr: (text) => process.stderr.write(text),
  });

  if (result.success) {
    console.log('\nModel created successfully!');
    console.log(`  Volume: ${result.model.volume} mm³`);
    console.log(`  Faces: ${result.model.faces}, Edges: ${result.model.edges}`);
    const bb = result.model.bounding_box;
    console.log(`  Bounding box: ${bb.size[0]} × ${bb.size[1]} × ${bb.size[2]} mm`);
    if (result.assembly) {
      console.log(`  Assembly: ${result.assembly.part_count} parts`);
      for (const [name, meta] of Object.entries(result.assembly.parts)) {
        console.log(`    ${name}: vol=${meta.volume} mm³, faces=${meta.faces}`);
      }
    }
    if (result.exports?.length > 0) {
      console.log('  Exports:');
      for (const exp of result.exports) {
        console.log(`    ${exp.format}: ${exp.path} (${exp.size_bytes} bytes)`);
      }
    }
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }

  return result;
}

async function cmdFem(configPath) {
  if (!configPath) {
    console.error('Error: config file path required');
    process.exit(1);
  }

  const absPath = resolve(configPath);
  console.log(`Loading config: ${absPath}`);

  const config = await loadConfig(absPath);
  const analysisType = config.fem?.analysis_type || 'static';
  console.log(`FEM Analysis: ${config.name || 'unnamed'} (${analysisType})`);
  console.log(`  Shapes: ${config.shapes?.length || 0}`);
  console.log(`  Constraints: ${config.fem?.constraints?.length || 0}`);

  const result = await runScript('fem_analysis.py', config, {
    timeout: 300_000,
    onStderr: (text) => process.stderr.write(text),
  });

  if (result.success) {
    const fem = result.fem;
    const mat = fem.material;
    console.log(`\nFEM Analysis: ${result.model.name} (${fem.analysis_type})`);
    console.log(`  Material: ${mat.name} (E=${mat.youngs_modulus} MPa)`);
    console.log(`  Mesh: ${fem.mesh.nodes.toLocaleString()} nodes, ${fem.mesh.elements.toLocaleString()} elements (${fem.mesh.element_type})`);
    console.log('');
    console.log('  Results:');
    console.log(`    Max displacement: ${fem.results.displacement.max.toFixed(4)} mm (Node ${fem.results.displacement.max_node})`);
    console.log(`    Max von Mises stress: ${fem.results.von_mises.max.toFixed(2)} MPa (Node ${fem.results.von_mises.max_node})`);
    console.log(`    Min von Mises stress: ${fem.results.von_mises.min.toFixed(2)} MPa`);
    console.log(`    Safety factor: ${fem.results.safety_factor} (yield=${mat.yield_strength} MPa)`);

    if (result.exports?.length > 0) {
      console.log('  Exports:');
      for (const exp of result.exports) {
        console.log(`    ${exp.format}: ${exp.path} (${exp.size_bytes} bytes)`);
      }
    }
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }

  return result;
}

async function cmdInspect(filePath) {
  if (!filePath) {
    console.error('Error: model file path required');
    process.exit(1);
  }

  const absPath = resolve(filePath);
  console.log(`Inspecting: ${absPath}`);

  const result = await runScript('inspect_model.py', { file: absPath }, {
    onStderr: (text) => process.stderr.write(text),
  });

  if (result.success) {
    console.log('\nModel metadata:');
    const m = result.model;
    console.log(`  Format: ${result.format}`);
    if (m.volume !== undefined) console.log(`  Volume: ${m.volume} mm³`);
    if (m.area !== undefined) console.log(`  Area: ${m.area} mm²`);
    if (m.faces !== undefined) console.log(`  Faces: ${m.faces}, Edges: ${m.edges}, Vertices: ${m.vertices}`);
    if (m.bounding_box) {
      const bb = m.bounding_box;
      console.log(`  Bounding box: ${JSON.stringify(bb.min)} → ${JSON.stringify(bb.max)}`);
    }
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }

  return result;
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
