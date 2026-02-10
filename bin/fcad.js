#!/usr/bin/env node

import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../lib/config-loader.js';
import { runScript } from '../lib/runner.js';

const USAGE = `
fcad - FreeCAD automation CLI

Usage:
  fcad create <config.toml|json>  Create model from config
  fcad design "description"       AI-generate TOML from natural language, then build
  fcad draw <config.toml|json>    Generate engineering drawing (4-view SVG + BOM)
  fcad fem <config.toml|json>     Run FEM structural analysis
  fcad inspect <model.step|fcstd> Inspect model metadata
  fcad serve [port]               Start 3D viewer server (default: 3000)
  fcad help                       Show this help

Options:
  --bom                           Export BOM as separate CSV file (with draw)

Examples:
  fcad create configs/examples/bracket.toml
  fcad draw configs/examples/robot_arm_drawing.toml
  fcad draw configs/examples/bracket.toml --bom
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
  } else if (command === 'design') {
    await cmdDesign(args.join(' '));
  } else if (command === 'draw') {
    const flags = args.filter(a => a.startsWith('--'));
    const configArg = args.find(a => !a.startsWith('--'));
    await cmdDraw(configArg, flags);
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

async function cmdDesign(description) {
  if (!description || !description.trim()) {
    console.error('Error: description string required');
    console.error('  fcad design "shaft with two bearings"');
    process.exit(1);
  }

  console.log(`Generating design from: "${description}"`);
  const { designFromText } = await import('../scripts/design-reviewer.js');
  const result = await designFromText(description.trim());

  if (!result.toml) {
    console.error('Error: Failed to generate valid TOML');
    process.exit(1);
  }

  // Derive filename from mechanism_type or description
  const rawName = result.report?.mechanism_type || description;
  const fileName = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);

  // Save to configs/generated/
  const generatedDir = resolve(import.meta.dirname, '..', 'configs', 'generated');
  mkdirSync(generatedDir, { recursive: true });
  const tomlPath = join(generatedDir, `${fileName}.toml`);
  writeFileSync(tomlPath, result.toml, 'utf8');
  console.log(`TOML saved: ${tomlPath}`);

  if (result.report) {
    console.log(`\nDesign: ${result.report.mechanism_type || 'unknown'}`);
    console.log(`  DOF: ${result.report.dof || '?'}`);
    if (result.report.motion_chain) {
      console.log(`  Chain: ${result.report.motion_chain.join(' → ')}`);
    }
  }

  // Build the generated TOML
  console.log('\nBuilding model...');
  await cmdCreate(tomlPath);
  console.log(`\nView: fcad serve → http://localhost:3000 → select ${fileName}`);
}

async function cmdDraw(configPath, flags = []) {
  if (!configPath) {
    console.error('Error: config file path required');
    console.error('  fcad draw configs/examples/bracket.toml');
    process.exit(1);
  }

  const absPath = resolve(configPath);
  console.log(`Loading config: ${absPath}`);

  const config = await loadConfig(absPath);

  // Inject --bom flag into drawing config
  if (flags.includes('--bom')) {
    config.drawing = config.drawing || {};
    config.drawing.bom_csv = true;
  }

  // Ensure drawing section exists with defaults
  config.drawing = config.drawing || {};
  if (!config.drawing.views) {
    config.drawing.views = ['front', 'top', 'right', 'iso'];
  }

  const modelName = config.name || 'unnamed';
  console.log(`Generating drawing: ${modelName}`);
  console.log(`  Views: ${config.drawing.views.join(', ')}`);

  const result = await runScript('generate_drawing.py', config, {
    timeout: 180_000,
    onStderr: (text) => process.stderr.write(text),
  });

  if (result.success) {
    console.log(`\nDrawing generated!`);
    console.log(`  Scale: ${result.scale}`);
    console.log(`  Views: ${result.views.join(', ')}`);
    for (const dp of result.drawing_paths) {
      console.log(`  ${dp.format.toUpperCase()}: ${dp.path} (${dp.size_bytes} bytes)`);
    }
    if (result.bom?.length > 0) {
      console.log(`\n  BOM (${result.bom.length} items):`);
      for (const item of result.bom) {
        const joint = item.joint ? ` [${item.joint.type}: ${item.joint.id}]` : '';
        console.log(`    ${item.id}: ${item.material} ${item.dimensions}${joint}`);
      }
    }
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }

  return result;
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
