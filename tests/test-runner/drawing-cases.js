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

export function createDrawingCases(assert) {
async function testAutoGDTSymbolsDisabled() {
  console.log('\n--- Test: automatic GD&T symbols are disabled ---');

  const config = await loadExampleConfig('configs/examples/ptu_assembly_mates.toml');

  const result = await runScript('generate_drawing.py', config, {
    timeout: 120_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Drawing generated');
  const svgPath = normalizeGeneratedPath(result.drawing_paths[0].path);

  // Read SVG and check that assembly mates do not infer GD&T elements.
  const svgContent = readFileSync(svgPath, 'utf8');
  const hasGDT = svgContent.includes('gdt-symbol');
  assert(!hasGDT, 'SVG does not contain inferred GD&T symbols (class="gdt-symbol")');

  const hasConcentricity = svgContent.includes('data-type="concentricity"');
  assert(!hasConcentricity, 'SVG does not infer concentricity symbol for coaxial mates');
}

  return [
    ['automatic GD&T disabled', testAutoGDTSymbolsDisabled],
  ];
}
