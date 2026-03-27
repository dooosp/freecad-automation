import assert from 'node:assert/strict';

import {
  FREECAD_ENV_OVERRIDES,
  SCRIPTS_DIR,
  formatFreeCADInvocation,
  getFreeCADGuiInvocation,
  getFreeCADInvocation,
  resolveFreeCADRuntime,
} from '../lib/paths.js';

const MACOS_APP = '/Applications/FreeCAD.app';
const MACOS_GUI = `${MACOS_APP}/Contents/MacOS/FreeCAD`;
const MACOS_PYTHON = `${MACOS_APP}/Contents/Resources/bin/python`;
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

const macRuntime = resolveFreeCADRuntime({
  platform: 'darwin',
  env: { FREECAD_APP: MACOS_APP },
  existsSync: makeExists([MACOS_PYTHON, MACOS_RUNTIME, MACOS_GUI]),
});

const headlessInvocation = getFreeCADInvocation('create_model.py', macRuntime);
assert.equal(headlessInvocation.command, MACOS_RUNTIME);
assert.equal(headlessInvocation.args[0], `${SCRIPTS_DIR}/create_model.py`);
assert.equal(
  formatFreeCADInvocation(headlessInvocation),
  `${MACOS_RUNTIME} ${SCRIPTS_DIR}/create_model.py`
);

const guiInvocation = getFreeCADGuiInvocation(['--single-instance'], macRuntime);
assert.equal(guiInvocation.command, MACOS_GUI);
assert.deepEqual(guiInvocation.args, ['--single-instance']);

const wslRuntime = resolveFreeCADRuntime({
  platform: 'linux',
  env: {
    WSL_DISTRO_NAME: 'Ubuntu',
    FREECAD_BIN: String.raw`C:\Program Files\FreeCAD 1.1\bin\FreeCADCmd.exe`,
  },
  execFileSync: fakeWslExecFileSync,
  existsSync: makeExists([
    '/mnt/c/Program Files/FreeCAD 1.1/bin/FreeCADCmd.exe',
  ]),
});

const windowsInvocation = getFreeCADInvocation('generate_drawing.py', wslRuntime);
assert.equal(windowsInvocation.command, '/mnt/c/Program Files/FreeCAD 1.1/bin/FreeCADCmd.exe');
assert.equal(windowsInvocation.args.length, 1);
assert.match(windowsInvocation.args[0], /^WIN:/);
assert.match(windowsInvocation.args[0], /generate_drawing\.py$/);

const missingRuntime = resolveFreeCADRuntime({
  platform: 'darwin',
  env: {},
  existsSync: () => false,
});

let missingMessage = '';
try {
  getFreeCADInvocation('create_model.py', missingRuntime);
} catch (error) {
  missingMessage = error.message;
}

assert.match(missingMessage, /FreeCAD runtime not found/);
assert.match(missingMessage, /create_model\.py/);
assert.match(missingMessage, /Checked:/);
for (const envVar of FREECAD_ENV_OVERRIDES) {
  assert.match(missingMessage, new RegExp(envVar));
}
assert.match(missingMessage, /Install FreeCAD 1\.1/);

console.log('freecad-invocation.test.js: ok');
