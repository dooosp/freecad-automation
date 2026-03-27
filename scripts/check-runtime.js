#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeFreeCADRuntime, FREECAD_ENV_OVERRIDES, getFreeCADRuntime } from '../lib/paths.js';

const FREECAD_BACKED_COMMANDS = [
  'create',
  'draw',
  'inspect',
  'fem',
  'tolerance',
  'report',
];

const PLAIN_PYTHON_COMMANDS = [
  'dfm',
  'review',
  'process-plan',
  'line-plan',
  'quality-risk',
  'investment-review',
  'readiness-report',
  'stabilization-review',
  'generate-standard-docs',
  'ingest',
  'quality-link',
  'review-pack',
  'compare-rev',
  'validate',
  'serve',
];

const CONDITIONAL_COMMANDS = [
  'analyze-part (uses FreeCAD only when it needs to inspect a model file)',
  'design (generates TOML, then calls create)',
];

export function printRuntimeDiagnostics({
  logger = console.log,
  runtime = getFreeCADRuntime(),
  platform = process.platform,
} = {}) {
  logger(`Runtime: ${describeFreeCADRuntime(runtime)}`);
  logger(`Source: ${runtime.source}`);
  if (runtime.bundleRoot) logger(`Bundle root: ${runtime.bundleRoot}`);
  if (runtime.pythonExecutable) logger(`Bundled Python: ${runtime.pythonExecutable}`);
  if (runtime.runtimeExecutable) logger(`Bundled runtime: ${runtime.runtimeExecutable}`);
  if (runtime.guiExecutable) logger(`GUI launcher: ${runtime.guiExecutable}`);
  if (runtime.available) logger(`Script executable: ${runtime.executable}`);

  if (runtime.checkedCandidates?.length) {
    logger('Checked candidates:');
    for (const candidate of runtime.checkedCandidates) {
      logger(`  - ${candidate}`);
    }
  }

  logger('Resolution order: explicit FREECAD_* overrides, then platform auto-detect.');
  logger(`Override env vars (highest precedence first): ${FREECAD_ENV_OVERRIDES.join(', ')}`);
  if (platform === 'darwin') {
    logger('Auto-detect behavior: prefer FreeCAD.app bundle discovery, then PATH-visible bundle/runtime executables.');
  } else if (platform === 'linux') {
    logger('Auto-detect behavior: look for PATH-visible FreeCAD executables; WSL bridge usage is explicit only.');
  } else {
    logger('Auto-detect behavior: look for PATH-visible FreeCAD executables.');
  }
  logger(`FreeCAD-backed commands: ${FREECAD_BACKED_COMMANDS.join(', ')}`);
  logger(`Plain-Python / non-FreeCAD commands: ${PLAIN_PYTHON_COMMANDS.join(', ')}`);
  logger(`Mixed / conditional commands: ${CONDITIONAL_COMMANDS.join(', ')}`);

  if (runtime.available) {
    return 0;
  }

  logger('Suggested setup:');
  if (platform === 'darwin') {
    logger('  export FREECAD_APP="/Applications/FreeCAD.app"');
    logger('  fcad check-runtime');
    logger('  # Optional explicit override: export FREECAD_PYTHON="/Applications/FreeCAD.app/Contents/Resources/bin/python"');
  } else if (platform === 'linux') {
    logger('  export FREECAD_BIN="/path/to/FreeCADCmd"');
    logger('  fcad check-runtime');
    logger('  # WSL compatibility remains supported when you explicitly point at a Windows install, for example:');
    logger('  # export FREECAD_DIR="C:\\Program Files\\FreeCAD 1.1"');
  } else {
    logger('  set FREECAD_BIN=C:\\path\\to\\FreeCADCmd.exe');
    logger('  fcad check-runtime');
    logger('  REM Backward-compatible install-root override: set FREECAD_DIR=C:\\Program Files\\FreeCAD 1.1');
  }

  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(printRuntimeDiagnostics());
}
