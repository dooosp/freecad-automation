#!/usr/bin/env node

import { describeFreeCADRuntime, getFreeCADRuntime } from '../lib/paths.js';

const runtime = getFreeCADRuntime();

console.log(`Runtime: ${describeFreeCADRuntime()}`);

if (runtime.available) {
  console.log(`Executable: ${runtime.executable}`);
  process.exit(0);
}

if (process.platform === 'darwin') {
  console.log('Suggested setup:');
  console.log('  export FREECAD_PYTHON="/Applications/FreeCAD.app/Contents/Resources/bin/FreeCADCmd"');
  console.log('  npm run check:runtime');
} else if (process.platform === 'linux') {
  console.log('Suggested setup:');
  console.log('  WSL: export FREECAD_DIR="C:\\Program Files\\FreeCAD 1.0"');
  console.log('  Native Linux: export FREECAD_CMD="/path/to/FreeCADCmd"');
} else {
  console.log('Set FREECAD_PYTHON or FREECAD_CMD to a FreeCAD executable.');
}

process.exit(1);
