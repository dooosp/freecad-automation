import assert from 'node:assert/strict';

import {
  convertPathFromRuntime,
  describeFreeCADRuntime,
  isWindowsAbsolutePath,
  normalizeLocalPath,
  resolveFreeCADRuntime,
} from '../lib/paths.js';

const MACOS_APP = '/Applications/FreeCAD.app';
const MACOS_GUI = `${MACOS_APP}/Contents/MacOS/FreeCAD`;
const MACOS_PYTHON = `${MACOS_APP}/Contents/Resources/bin/python`;
const MACOS_PYTHON3 = `${MACOS_APP}/Contents/Resources/bin/python3`;
const MACOS_RUNTIME = `${MACOS_APP}/Contents/Resources/bin/freecadcmd`;

function makeExists(paths) {
  const known = new Set(paths);
  return (value) => known.has(value);
}

function fakeWslExecFileSync(cmd, args) {
  if (cmd === 'which') {
    if (args[0] === 'wslpath') return '/usr/bin/wslpath\n';
    throw new Error(`unexpected lookup for ${args[0]}`);
  }

  if (cmd === 'wslpath') {
    const [mode, target] = args;
    if (mode === '-u') {
      return target.replace(/^C:\\/i, '/mnt/c/').replace(/\\/g, '/');
    }
    if (mode === '-w') {
      return `WIN:${target}`;
    }
  }

  throw new Error(`unexpected command: ${cmd}`);
}

assert.equal(isWindowsAbsolutePath(String.raw`C:\FreeCAD\bin\python.exe`), true);
assert.equal(isWindowsAbsolutePath('/tmp/model.step'), false);

const homeNormalized = normalizeLocalPath('~/tmp/freecad-automation');
assert.equal(typeof homeNormalized, 'string');
assert.notEqual(homeNormalized.startsWith('~/'), true);

const autoDetectedMacRuntime = resolveFreeCADRuntime({
  platform: 'darwin',
  env: {},
  existsSync: makeExists([MACOS_PYTHON, MACOS_RUNTIME, MACOS_GUI]),
});
assert.equal(autoDetectedMacRuntime.mode, 'macos-bundle');
assert.equal(autoDetectedMacRuntime.source, 'auto-detect');
assert.equal(autoDetectedMacRuntime.bundleRoot, MACOS_APP);
assert.equal(autoDetectedMacRuntime.executable, MACOS_RUNTIME);
assert.equal(autoDetectedMacRuntime.pythonExecutable, MACOS_PYTHON);
assert.equal(autoDetectedMacRuntime.runtimeExecutable, MACOS_RUNTIME);
assert.equal(autoDetectedMacRuntime.guiExecutable, MACOS_GUI);
assert.equal(convertPathFromRuntime(MACOS_RUNTIME, autoDetectedMacRuntime), MACOS_RUNTIME);

const overridePrecedenceRuntime = resolveFreeCADRuntime({
  platform: 'darwin',
  env: {
    FREECAD_DIR: `${MACOS_APP}/Contents`,
    FREECAD_APP: `${MACOS_APP}/Contents/Resources`,
    FREECAD_BIN: MACOS_RUNTIME,
    FREECAD_PYTHON: MACOS_PYTHON,
  },
  existsSync: makeExists([MACOS_PYTHON, MACOS_RUNTIME, MACOS_GUI]),
});
assert.equal(overridePrecedenceRuntime.source, 'FREECAD_PYTHON');
assert.equal(overridePrecedenceRuntime.executable, MACOS_PYTHON);

const binOverrideRuntime = resolveFreeCADRuntime({
  platform: 'darwin',
  env: {
    FREECAD_APP: MACOS_APP,
    FREECAD_BIN: MACOS_RUNTIME,
  },
  existsSync: makeExists([MACOS_PYTHON, MACOS_RUNTIME, MACOS_GUI]),
});
assert.equal(binOverrideRuntime.source, 'FREECAD_BIN');
assert.equal(binOverrideRuntime.executable, MACOS_RUNTIME);

for (const freecadDir of [
  MACOS_APP,
  `${MACOS_APP}/Contents`,
  `${MACOS_APP}/Contents/Resources`,
  `${MACOS_APP}/Contents/Resources/bin`,
  MACOS_PYTHON3,
]) {
  const runtime = resolveFreeCADRuntime({
    platform: 'darwin',
    env: { FREECAD_DIR: freecadDir },
    existsSync: makeExists([MACOS_PYTHON, MACOS_RUNTIME, MACOS_GUI]),
  });
  assert.equal(runtime.source, 'FREECAD_DIR');
  assert.equal(runtime.bundleRoot, MACOS_APP);
  assert.equal(runtime.pythonExecutable, MACOS_PYTHON);
  assert.equal(runtime.runtimeExecutable, MACOS_RUNTIME);
  assert.equal(runtime.executable, MACOS_RUNTIME);
}

const missingMacRuntime = resolveFreeCADRuntime({
  platform: 'darwin',
  env: { FREECAD_APP: MACOS_APP },
  existsSync: () => false,
});
assert.equal(missingMacRuntime.available, false);
assert.match(describeFreeCADRuntime(missingMacRuntime), /macOS FreeCAD 1\.1\.x runtime not found\./);
assert.match(describeFreeCADRuntime(missingMacRuntime), /Contents\/Resources\/bin\/python/);
assert.match(describeFreeCADRuntime(missingMacRuntime), /Contents\/MacOS\/FreeCAD/);

const explicitWslRuntime = resolveFreeCADRuntime({
  platform: 'linux',
  env: {
    WSL_DISTRO_NAME: 'Ubuntu',
    FREECAD_DIR: String.raw`C:\Program Files\FreeCAD 1.1`,
  },
  execFileSync: fakeWslExecFileSync,
  existsSync: makeExists([
    '/mnt/c/Program Files/FreeCAD 1.1/bin/python.exe',
  ]),
});
assert.equal(explicitWslRuntime.mode, 'wsl-windows');
assert.equal(explicitWslRuntime.source, 'FREECAD_DIR');
assert.equal(explicitWslRuntime.pathStyle, 'windows');
assert.equal(explicitWslRuntime.executable, '/mnt/c/Program Files/FreeCAD 1.1/bin/python.exe');
assert.match(describeFreeCADRuntime(explicitWslRuntime), /WSL -> Windows FreeCAD runtime/);
assert.equal(
  convertPathFromRuntime(String.raw`C:\Program Files\FreeCAD 1.1\output\part.step`, explicitWslRuntime),
  '/mnt/c/Program Files/FreeCAD 1.1/output/part.step'
);

console.log('paths-runtime.test.js: ok');
