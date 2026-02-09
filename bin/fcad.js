#!/usr/bin/env node

import { resolve } from 'node:path';
import { loadConfig } from '../lib/config-loader.js';
import { runScript } from '../lib/runner.js';

const USAGE = `
fcad - FreeCAD automation CLI

Usage:
  fcad create <config.toml|json>  Create model from config
  fcad inspect <model.step|fcstd> Inspect model metadata
  fcad help                       Show this help

Examples:
  fcad create configs/examples/bracket.toml
  fcad inspect output/bracket_v1.step
`.trim();

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    process.exit(0);
  }

  if (command === 'create') {
    await cmdCreate(args[0]);
  } else if (command === 'inspect') {
    await cmdInspect(args[0]);
  } else {
    console.error(`Unknown command: ${command}`);
    console.log(USAGE);
    process.exit(1);
  }
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
