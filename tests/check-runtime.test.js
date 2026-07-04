import assert from 'node:assert/strict';

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { buildRuntimeDiagnostics } from '../lib/runtime-diagnostics.js';
import { printRuntimeDiagnostics } from '../scripts/check-runtime.js';

const ROOT = resolve(import.meta.dirname, '..');
const CHECK_RUNTIME_SCRIPT = resolve(ROOT, 'scripts', 'check-runtime.js');
const FCAD_CLI = resolve(ROOT, 'bin', 'fcad.js');

function collectOutput(callback) {
  const lines = [];
  const exitCode = callback((line) => lines.push(line));
  return { exitCode, text: lines.join('\n') };
}

function runCheckRuntimeCli(args = []) {
  return spawnSync(process.execPath, [CHECK_RUNTIME_SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function runFcadCheckRuntimeCli(args = []) {
  return spawnSync(process.execPath, [FCAD_CLI, 'check-runtime', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function runModuleSnippet(source) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

const readyRuntime = {
  available: true,
  source: 'FREECAD_APP',
  mode: 'macos-bundle',
  executable: '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
  bundleRoot: '/Applications/FreeCAD.app',
  runtimeExecutable: '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
  pythonExecutable: '/Applications/FreeCAD.app/Contents/Resources/bin/python',
  guiExecutable: '/Applications/FreeCAD.app/Contents/MacOS/FreeCAD',
  checkedCandidates: [
    '/Applications/FreeCAD.app/Contents/Resources/bin/python',
    '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
  ],
};

const readyResult = collectOutput((logger) => printRuntimeDiagnostics({
  logger,
  runtime: readyRuntime,
  platform: 'darwin',
  env: {
    FREECAD_APP: '/Applications/FreeCAD.app',
  },
  detectDetails: () => ({
    python: {
      executable: readyRuntime.pythonExecutable,
      version: '3.11.8',
      platform: 'darwin',
      error: null,
    },
    freecad: {
      executable: readyRuntime.runtimeExecutable,
      version: '1.1.0',
      homePath: '/Applications/FreeCAD.app/Contents/Resources',
      modulePath: '/Applications/FreeCAD.app/Contents/Resources/lib/FreeCAD.so',
      error: null,
    },
  }),
}));

const readyJsonResult = collectOutput((logger) => printRuntimeDiagnostics({
  logger,
  format: 'json',
  runtime: readyRuntime,
  platform: 'darwin',
  env: {
    FREECAD_APP: '/Applications/FreeCAD.app',
  },
  detectDetails: () => ({
    python: {
      executable: readyRuntime.pythonExecutable,
      version: '3.11.8',
      platform: 'darwin',
      error: null,
      source: 'python-import',
    },
    freecad: {
      executable: readyRuntime.runtimeExecutable,
      version: '1.1.0',
      homePath: '/Applications/FreeCAD.app/Contents/Resources',
      modulePath: '/Applications/FreeCAD.app/Contents/Resources/lib/FreeCAD.so',
      error: null,
      source: 'python-import',
    },
  }),
}));

assert.equal(readyResult.exitCode, 0);
assert.match(readyResult.text, /Status: ready/);
assert.match(readyResult.text, /Resolution order: FREECAD_PYTHON -> FREECAD_BIN -> FREECAD_CMD -> FREECAD_APP -> FREECAD_DIR/);
assert.match(readyResult.text, /FREECAD_APP: \/Applications\/FreeCAD\.app \[selected\]/);
assert.match(readyResult.text, /Searched paths:/);
assert.match(readyResult.text, /FreeCAD version: 1\.1\.0/);
assert.match(readyResult.text, /Commands that require FreeCAD:/);
assert.match(readyResult.text, /Commands that can run in plain Python \/ Node mode:/);
assert.match(readyResult.text, /validate-config/);
assert.match(readyResult.text, /migrate-config/);
assert.match(readyResult.text, /Next steps:/);

assert.equal(readyJsonResult.exitCode, 0);
const readyJson = JSON.parse(readyJsonResult.text);
assert.deepEqual(readyJson, buildRuntimeDiagnostics({
  runtime: readyRuntime,
  platform: 'darwin',
  env: {
    FREECAD_APP: '/Applications/FreeCAD.app',
  },
  detectDetails: () => ({
    python: {
      executable: readyRuntime.pythonExecutable,
      version: '3.11.8',
      platform: 'darwin',
      error: null,
      source: 'python-import',
    },
    freecad: {
      executable: readyRuntime.runtimeExecutable,
      version: '1.1.0',
      homePath: '/Applications/FreeCAD.app/Contents/Resources',
      modulePath: '/Applications/FreeCAD.app/Contents/Resources/lib/FreeCAD.so',
      error: null,
      source: 'python-import',
    },
  }),
}));
assert.equal(readyJson.command_classes.freecad_backed.includes('inspect'), true);
assert.equal(readyJson.capability_map['check-runtime'].classification, 'diagnostics');
assert.equal(readyJson.support_boundary_note, null);
assert.equal(readyJson.artifact_class, 'runtime_diagnostics');
assert.equal(readyJson.inspection_evidence_status, 'not_inspection_evidence');

const redactedJsonResult = collectOutput((logger) => printRuntimeDiagnostics({
  logger,
  format: 'json',
  redactPaths: true,
  runtime: readyRuntime,
  platform: 'darwin',
  env: {
    FREECAD_APP: '/Applications/FreeCAD.app',
  },
  detectDetails: () => ({
    python: {
      executable: readyRuntime.pythonExecutable,
      version: '3.11.8',
      platform: 'darwin',
      error: null,
      source: 'python-import',
    },
    freecad: {
      executable: readyRuntime.runtimeExecutable,
      version: '1.1.0',
      homePath: '/Applications/FreeCAD.app/Contents/Resources',
      modulePath: '/Applications/FreeCAD.app/Contents/Resources/lib/FreeCAD.so',
      error: null,
      source: 'python-import',
    },
  }),
}));
assert.equal(redactedJsonResult.exitCode, 0);
const redactedJson = JSON.parse(redactedJsonResult.text);
const redactedJsonText = JSON.stringify(redactedJson);
[
  '/Applications/FreeCAD.app',
  '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
  '/Applications/FreeCAD.app/Contents/Resources/bin/python',
  '/Applications/FreeCAD.app/Contents/MacOS/FreeCAD',
  '/Applications/FreeCAD.app/Contents/Resources/lib/FreeCAD.so',
].forEach((path) => {
  assert.equal(redactedJsonText.includes(path), false, `redacted JSON should not include ${path}`);
});
assert.equal(redactedJson.selected_runtime.executable, '<path>/freecadcmd');
assert.equal(redactedJson.selected_runtime.bundle_root, '<path>/FreeCAD.app');
assert.equal(redactedJson.version_details.freecad.module_path, '<path>/FreeCAD.so');
assert.equal(redactedJson.env_overrides.values[3].value, '<path>/FreeCAD.app');
assert.equal(redactedJson.artifact_class, 'runtime_diagnostics');
assert.equal(redactedJson.inspection_evidence_status, 'not_inspection_evidence');

const missingRuntime = {
  available: false,
  source: 'FREECAD_BIN',
  mode: 'native',
  executable: '',
  bundleRoot: '',
  installRoot: '',
  runtimeExecutable: '',
  pythonExecutable: '',
  guiExecutable: '',
  checkedCandidates: ['/opt/freecad/bin/FreeCADCmd'],
};

const missingResult = collectOutput((logger) => printRuntimeDiagnostics({
  logger,
  runtime: missingRuntime,
  platform: 'linux',
  env: {
    FREECAD_BIN: '/opt/freecad/bin/FreeCADCmd',
  },
  detectDetails: () => ({
    python: { executable: '', version: null, platform: null, error: null },
    freecad: { executable: '', version: null, homePath: null, modulePath: null, error: null },
  }),
}));

const missingJsonResult = collectOutput((logger) => printRuntimeDiagnostics({
  logger,
  format: 'json',
  runtime: missingRuntime,
  platform: 'linux',
  env: {
    FREECAD_BIN: '/opt/freecad/bin/FreeCADCmd',
  },
  detectDetails: () => ({
    python: { executable: '', version: null, platform: null, error: null, source: null },
    freecad: { executable: '', version: null, homePath: null, modulePath: null, error: null, source: null },
  }),
}));

assert.equal(missingResult.exitCode, 1);
assert.match(missingResult.text, /Status: runtime not detected/);
assert.match(missingResult.text, /FREECAD_BIN: \/opt\/freecad\/bin\/FreeCADCmd \[selected\]/);
assert.match(missingResult.text, /Remediation:/);
assert.match(missingResult.text, /Review the active FREECAD_\* overrides below and fix or remove any stale paths before retrying\./);
assert.match(missingResult.text, /export FREECAD_BIN="\/path\/to\/FreeCADCmd"/);
assert.match(missingResult.text, /If you only need the manufacturing-review layer for now, stay on the plain-Python commands listed below while FreeCAD is being fixed\./);

assert.equal(missingJsonResult.exitCode, 1);
const missingJson = JSON.parse(missingJsonResult.text);
assert.equal(missingJson.status, 'runtime_not_detected');
assert.equal(missingJson.executable_detected, false);
assert.equal(missingJson.probe_status, 'not_detected');
assert.equal(missingJson.errors.includes('FreeCAD runtime not detected.'), true);
assert.equal(missingJson.env_overrides.values[1].selected, true);
assert.match(missingJson.support_boundary_note, /compatibility paths/);
assert.equal(missingJson.remediation.length > 0, true);

const probeFailureRuntime = {
  available: true,
  source: 'FREECAD_BIN',
  mode: 'native',
  executable: '/opt/freecad/bin/FreeCADCmd',
  bundleRoot: '',
  installRoot: '',
  runtimeExecutable: '/opt/freecad/bin/FreeCADCmd',
  pythonExecutable: '',
  guiExecutable: '',
  checkedCandidates: ['/opt/freecad/bin/FreeCADCmd'],
};

const probeFailureResult = collectOutput((logger) => printRuntimeDiagnostics({
  logger,
  runtime: probeFailureRuntime,
  platform: 'linux',
  env: {
    FREECAD_BIN: '/opt/freecad/bin/FreeCADCmd',
  },
  detectDetails: () => ({
    python: { executable: '', version: null, platform: null, error: null, source: null },
    freecad: {
      executable: probeFailureRuntime.runtimeExecutable,
      version: null,
      homePath: null,
      modulePath: null,
      error: 'No module named FreeCAD',
      source: null,
    },
  }),
}));

assert.equal(probeFailureResult.exitCode, 1);
assert.match(probeFailureResult.text, /Status: runtime probe failed/);

const probeFailureJsonResult = collectOutput((logger) => printRuntimeDiagnostics({
  logger,
  format: 'json',
  runtime: probeFailureRuntime,
  platform: 'linux',
  env: {
    FREECAD_BIN: '/opt/freecad/bin/FreeCADCmd',
  },
  detectDetails: () => ({
    python: { executable: '', version: null, platform: null, error: null, source: null },
    freecad: {
      executable: probeFailureRuntime.runtimeExecutable,
      version: null,
      homePath: null,
      modulePath: null,
      error: 'No module named FreeCAD',
      source: null,
    },
  }),
}));

assert.equal(probeFailureJsonResult.exitCode, 1);
const probeFailureJson = JSON.parse(probeFailureJsonResult.text);
assert.equal(probeFailureJson.status, 'runtime_probe_failed');
assert.equal(probeFailureJson.available, false);
assert.equal(probeFailureJson.executable_detected, true);
assert.equal(probeFailureJson.probe_status, 'failed');
assert.equal(probeFailureJson.errors.some((entry) => entry.includes('FreeCAD runtime probe failed')), true);

mkdirSync(resolve(ROOT, 'tmp'), { recursive: true });
const fingerprintDir = mkdtempSync(resolve(ROOT, 'tmp', 'fcad-runtime-fingerprint-'));
try {
  const fingerprintPath = join(fingerprintDir, 'runtime_fingerprint.json');
  const originalArgv = process.argv;
  process.argv = [process.execPath, CHECK_RUNTIME_SCRIPT, '--fingerprint-out', fingerprintPath];
  try {
    const ambientArgvResult = collectOutput((logger) => printRuntimeDiagnostics({
      logger,
      runtime: readyRuntime,
      platform: 'darwin',
      env: {
        FREECAD_APP: '/Applications/FreeCAD.app',
      },
      detectDetails: () => ({
        python: {
          executable: readyRuntime.pythonExecutable,
          version: '3.11.8',
          platform: 'darwin',
          error: null,
          source: 'python-import',
        },
        freecad: {
          executable: readyRuntime.runtimeExecutable,
          version: '1.1.0',
          homePath: '/Applications/FreeCAD.app/Contents/Resources',
          modulePath: '/Applications/FreeCAD.app/Contents/Resources/lib/FreeCAD.so',
          error: null,
          source: 'python-import',
        },
      }),
    }));
    assert.equal(ambientArgvResult.exitCode, 0);
    assert.equal(existsSync(fingerprintPath), false, 'printRuntimeDiagnostics should not write from ambient process.argv');
  } finally {
    process.argv = originalArgv;
  }

  const fingerprintResult = collectOutput((logger) => printRuntimeDiagnostics({
    logger,
    runtime: readyRuntime,
    platform: 'darwin',
    env: {
      FREECAD_APP: '/Applications/FreeCAD.app',
    },
    detectDetails: () => ({
      python: {
        executable: readyRuntime.pythonExecutable,
        version: '3.11.8',
        platform: 'darwin',
        error: null,
        source: 'python-import',
      },
      freecad: {
        executable: readyRuntime.runtimeExecutable,
        version: '1.1.0',
        homePath: '/Applications/FreeCAD.app/Contents/Resources',
        modulePath: '/Applications/FreeCAD.app/Contents/Resources/lib/FreeCAD.so',
        error: null,
        source: 'python-import',
      },
    }),
    fingerprintOut: fingerprintPath,
  }));
  const fingerprint = JSON.parse(readFileSync(fingerprintPath, 'utf8'));

  assert.equal(fingerprintResult.exitCode, 0);
  assert.equal(fingerprint.schema_version, '1.0');
  assert.equal(fingerprint.runtime.platform, 'darwin');
  assert.equal(fingerprint.runtime.freecad_status, 'ready');
  assert.equal(fingerprint.runtime.freecad_version, '1.1.0');
  assert.equal(fingerprint.runtime.freecad_executable_detected, true);
  assert.equal(fingerprint.command_coverage.some((entry) => entry.command === 'create' && entry.covered === true), true);
  assert.equal(fingerprint.production_readiness_claim, false);
  assert.match(fingerprint.evidence_boundary, /not physical inspection evidence/);
} finally {
  rmSync(fingerprintDir, { recursive: true, force: true });
}

const missingFingerprintValueRun = runCheckRuntimeCli(['--fingerprint-out']);
assert.equal(missingFingerprintValueRun.status, 1);
assert.match(missingFingerprintValueRun.stderr, /--fingerprint-out requires a value/);

const missingFingerprintValueFcadRun = runFcadCheckRuntimeCli(['--fingerprint-out']);
assert.equal(missingFingerprintValueFcadRun.status, 1);
assert.match(missingFingerprintValueFcadRun.stderr, /--fingerprint-out requires a value/);

for (const booleanish of ['true', 'false']) {
  const booleanishFingerprintPath = resolve(ROOT, booleanish);
  try {
    const booleanishFingerprintValueRun = runCheckRuntimeCli([`--fingerprint-out=${booleanish}`]);
    assert.equal(booleanishFingerprintValueRun.status, 1);
    assert.match(booleanishFingerprintValueRun.stderr, /--fingerprint-out requires a real path value/);
    assert.equal(existsSync(booleanishFingerprintPath), false);
  } finally {
    if (existsSync(booleanishFingerprintPath)) unlinkSync(booleanishFingerprintPath);
  }
}

const outsideFingerprintDir = mkdtempSync(join(tmpdir(), 'fcad-runtime-fingerprint-outside-'));
try {
  const outsideFingerprintPath = join(outsideFingerprintDir, 'runtime_fingerprint.json');
  const outsideFingerprintRun = runCheckRuntimeCli(['--fingerprint-out', outsideFingerprintPath]);
  assert.equal(outsideFingerprintRun.status, 1);
  assert.match(outsideFingerprintRun.stderr, /runtime fingerprint output must stay inside the repository root/);
  assert.equal(existsSync(outsideFingerprintPath), false);
} finally {
  rmSync(outsideFingerprintDir, { recursive: true, force: true });
}

const parentTraversalFingerprintPath = resolve(ROOT, '..', 'runtime_fingerprint.json');
try {
  const parentTraversalFingerprintRun = runCheckRuntimeCli(['--fingerprint-out', '../runtime_fingerprint.json']);
  assert.equal(parentTraversalFingerprintRun.status, 1);
  assert.match(parentTraversalFingerprintRun.stderr, /runtime fingerprint output must stay inside the repository root/);
  assert.equal(existsSync(parentTraversalFingerprintPath), false);
} finally {
  if (existsSync(parentTraversalFingerprintPath)) unlinkSync(parentTraversalFingerprintPath);
}

const outputFingerprintHelperRun = runModuleSnippet(`
  import { resolveRuntimeFingerprintOutputPath } from './src/cli/check-runtime-options.js';
  console.log(resolveRuntimeFingerprintOutputPath('output/runtime_fingerprint.json', { projectRoot: process.cwd() }));
`);
assert.equal(outputFingerprintHelperRun.status, 0);
assert.match(outputFingerprintHelperRun.stdout, /output\/runtime_fingerprint\.json/);

const symlinkFixtureDir = mkdtempSync(resolve(ROOT, 'tmp', 'fcad-runtime-fingerprint-symlink-'));
const symlinkOutsideDir = mkdtempSync(join(tmpdir(), 'fcad-runtime-fingerprint-symlink-outside-'));
try {
  const symlinkPath = join(symlinkFixtureDir, 'tmp-link');
  symlinkSync(symlinkOutsideDir, symlinkPath, 'dir');
  const symlinkFingerprintPath = join(symlinkPath, 'runtime_fingerprint.json');
  const symlinkRelativeFingerprintPath = symlinkFingerprintPath.slice(ROOT.length + 1);
  const symlinkOutsideFingerprintPath = join(symlinkOutsideDir, 'runtime_fingerprint.json');

  const helperSymlinkRun = runModuleSnippet(`
    import { resolveRuntimeFingerprintOutputPath } from './src/cli/check-runtime-options.js';
    resolveRuntimeFingerprintOutputPath(${JSON.stringify(symlinkRelativeFingerprintPath)}, { projectRoot: process.cwd() });
  `);
  assert.equal(helperSymlinkRun.status, 1);
  assert.match(helperSymlinkRun.stderr, /runtime fingerprint output must stay inside the repository root/);
  assert.equal(existsSync(symlinkOutsideFingerprintPath), false);

  const scriptSymlinkRun = runCheckRuntimeCli(['--fingerprint-out', symlinkRelativeFingerprintPath]);
  assert.equal(scriptSymlinkRun.status, 1);
  assert.match(scriptSymlinkRun.stderr, /runtime fingerprint output must stay inside the repository root/);
  assert.equal(existsSync(symlinkOutsideFingerprintPath), false);

  const fcadSymlinkRun = runFcadCheckRuntimeCli(['--fingerprint-out', symlinkRelativeFingerprintPath]);
  assert.equal(fcadSymlinkRun.status, 1);
  assert.match(fcadSymlinkRun.stderr, /runtime fingerprint output must stay inside the repository root/);
  assert.equal(existsSync(symlinkOutsideFingerprintPath), false);
} finally {
  rmSync(symlinkFixtureDir, { recursive: true, force: true });
  rmSync(symlinkOutsideDir, { recursive: true, force: true });
}

const symlinkFileFixtureDir = mkdtempSync(resolve(ROOT, 'tmp', 'fcad-runtime-fingerprint-symlink-file-'));
const symlinkFileOutsideDir = mkdtempSync(join(tmpdir(), 'fcad-runtime-fingerprint-symlink-file-outside-'));
try {
  const helperSymlinkFile = join(symlinkFileFixtureDir, 'helper_runtime_fingerprint.json');
  const helperOutsideTarget = join(symlinkFileOutsideDir, 'helper_runtime_fingerprint.json');
  symlinkSync(helperOutsideTarget, helperSymlinkFile);
  const helperSymlinkRelativePath = helperSymlinkFile.slice(ROOT.length + 1);

  const helperSymlinkFileRun = runModuleSnippet(`
    import { resolveRuntimeFingerprintOutputPath } from './src/cli/check-runtime-options.js';
    resolveRuntimeFingerprintOutputPath(${JSON.stringify(helperSymlinkRelativePath)}, { projectRoot: process.cwd() });
  `);
  assert.equal(helperSymlinkFileRun.status, 1);
  assert.match(helperSymlinkFileRun.stderr, /runtime fingerprint output must stay inside the repository root/);
  assert.equal(existsSync(helperOutsideTarget), false);

  const scriptSymlinkFile = join(symlinkFileFixtureDir, 'script_runtime_fingerprint.json');
  const scriptOutsideTarget = join(symlinkFileOutsideDir, 'script_runtime_fingerprint.json');
  symlinkSync(scriptOutsideTarget, scriptSymlinkFile);
  const scriptSymlinkRelativePath = scriptSymlinkFile.slice(ROOT.length + 1);
  const scriptSymlinkFileRun = runCheckRuntimeCli(['--fingerprint-out', scriptSymlinkRelativePath]);
  assert.equal(scriptSymlinkFileRun.status, 1);
  assert.match(scriptSymlinkFileRun.stderr, /runtime fingerprint output must stay inside the repository root/);
  assert.equal(existsSync(scriptOutsideTarget), false);

  const fcadSymlinkFile = join(symlinkFileFixtureDir, 'fcad_runtime_fingerprint.json');
  const fcadOutsideTarget = join(symlinkFileOutsideDir, 'fcad_runtime_fingerprint.json');
  symlinkSync(fcadOutsideTarget, fcadSymlinkFile);
  const fcadSymlinkRelativePath = fcadSymlinkFile.slice(ROOT.length + 1);
  const fcadSymlinkFileRun = runFcadCheckRuntimeCli(['--fingerprint-out', fcadSymlinkRelativePath]);
  assert.equal(fcadSymlinkFileRun.status, 1);
  assert.match(fcadSymlinkFileRun.stderr, /runtime fingerprint output must stay inside the repository root/);
  assert.equal(existsSync(fcadOutsideTarget), false);
} finally {
  rmSync(symlinkFileFixtureDir, { recursive: true, force: true });
  rmSync(symlinkFileOutsideDir, { recursive: true, force: true });
}

console.log('check-runtime.test.js: ok');
