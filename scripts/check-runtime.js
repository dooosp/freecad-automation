#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeFreeCADRuntime, FREECAD_ENV_OVERRIDES, getFreeCADRuntime } from '../lib/paths.js';

const CHECK_TIMEOUT_MS = 5_000;

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
  'validate-config',
  'migrate-config',
  'serve',
];

const CONDITIONAL_COMMANDS = [
  {
    name: 'analyze-part',
    note: 'Runs in plain Python mode when the input context already includes model metadata; uses FreeCAD for live model inspection or STEP feature detection.',
  },
  {
    name: 'design',
    note: 'Generates config content first, then calls `create`, so the overall flow still needs FreeCAD for model creation.',
  },
  {
    name: 'sweep',
    note: 'Follows the matrix-selected service wrappers; cost-only variants can stay plain Python, while create/fem/report variants require FreeCAD.',
  },
];

function looksLikePythonExecutable(executable = '') {
  const lower = basename(executable || '').toLowerCase();
  return lower === 'python' || lower === 'python3' || lower === 'python.exe' || lower === 'pythonw.exe';
}

function formatValue(value, fallback = 'not set') {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string' && !value.trim()) return fallback;
  return String(value);
}

function parseVersionText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || null;
}

function parseJsonLine(text) {
  const candidate = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.startsWith('{') && line.endsWith('}'));
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function runProbe(command, args, options = {}) {
  const runner = options.spawnSyncImpl || spawnSync;
  const completed = runner(command, args, {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? CHECK_TIMEOUT_MS,
  });
  const stdout = completed.stdout || '';
  const stderr = completed.stderr || '';
  const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
  return {
    ok: !completed.error && completed.status === 0,
    stdout,
    stderr,
    combined,
    error: completed.error ? completed.error.message : null,
    status: completed.status,
  };
}

function probePythonAndFreeCAD(pythonExecutable, options = {}) {
  const pythonSnippet = [
    'import json',
    'import platform',
    'import sys',
    '',
    'payload = {',
    "    'python_version': platform.python_version(),",
    "    'python_executable': sys.executable,",
    "    'sys_platform': sys.platform,",
    '}',
    '',
    'try:',
    '    import FreeCAD',
    "    payload['freecad_version'] = '.'.join(str(part) for part in FreeCAD.Version()[:3])",
    "    payload['freecad_module'] = getattr(FreeCAD, '__file__', None)",
    "    payload['freecad_home'] = FreeCAD.getHomePath() if hasattr(FreeCAD, 'getHomePath') else None",
    'except Exception as exc:',
    "    payload['freecad_import_error'] = str(exc)",
    '',
    'print(json.dumps(payload))',
  ].join('\n');

  const probe = runProbe(pythonExecutable, ['-c', pythonSnippet], options);
  const parsed = parseJsonLine(probe.stdout);

  return {
    ok: probe.ok && !!parsed,
    error: probe.ok ? null : (probe.error || parseVersionText(probe.combined) || 'probe failed'),
    parsed,
  };
}

function probeVersionLine(executable, options = {}) {
  const probe = runProbe(executable, ['--version'], options);
  return {
    ok: probe.ok,
    error: probe.ok ? null : (probe.error || parseVersionText(probe.combined) || 'version probe failed'),
    version: parseVersionText(probe.combined),
  };
}

export function detectRuntimeDetails({ runtime = getFreeCADRuntime(), spawnSyncImpl = spawnSync } = {}) {
  const details = {
    python: {
      executable: runtime.pythonExecutable || (looksLikePythonExecutable(runtime.executable) ? runtime.executable : ''),
      version: null,
      platform: null,
      source: null,
      error: null,
    },
    freecad: {
      executable: runtime.runtimeExecutable || (!looksLikePythonExecutable(runtime.executable) ? runtime.executable : ''),
      version: null,
      modulePath: null,
      homePath: runtime.bundleRoot || runtime.installRoot || null,
      source: null,
      error: null,
    },
  };

  if (!runtime.available) {
    return details;
  }

  const probeOptions = { spawnSyncImpl };
  if (details.python.executable) {
    const pythonProbe = probePythonAndFreeCAD(details.python.executable, probeOptions);
    if (pythonProbe.ok && pythonProbe.parsed) {
      details.python.version = pythonProbe.parsed.python_version || null;
      details.python.platform = pythonProbe.parsed.sys_platform || null;
      details.python.source = 'python-import';
      details.freecad.version = pythonProbe.parsed.freecad_version || null;
      details.freecad.modulePath = pythonProbe.parsed.freecad_module || null;
      details.freecad.homePath = pythonProbe.parsed.freecad_home || details.freecad.homePath;
      details.freecad.source = pythonProbe.parsed.freecad_version ? 'python-import' : null;
      if (pythonProbe.parsed.freecad_import_error) {
        details.freecad.error = pythonProbe.parsed.freecad_import_error;
      }
    } else {
      details.python.error = pythonProbe.error;
    }
  }

  if (!details.python.version && details.python.executable) {
    const versionProbe = probeVersionLine(details.python.executable, probeOptions);
    if (versionProbe.ok) {
      details.python.version = versionProbe.version;
      details.python.source = details.python.source || 'python-version';
    } else if (!details.python.error) {
      details.python.error = versionProbe.error;
    }
  }

  if (!details.freecad.version && details.freecad.executable) {
    const versionProbe = probeVersionLine(details.freecad.executable, probeOptions);
    if (versionProbe.ok) {
      details.freecad.version = versionProbe.version;
      details.freecad.source = details.freecad.source || 'runtime-version';
      details.freecad.error = null;
    } else if (!details.freecad.error) {
      details.freecad.error = versionProbe.error;
    }
  }

  return details;
}

function logSection(logger, title) {
  logger('');
  logger(`${title}:`);
}

function logList(logger, entries, { empty = '  - none' } = {}) {
  if (!entries || entries.length === 0) {
    logger(empty);
    return;
  }
  for (const entry of entries) {
    logger(`  - ${entry}`);
  }
}

function logIndentedCommandList(logger, entries) {
  if (!entries || entries.length === 0) {
    logger('    - none');
    return;
  }
  for (const entry of entries) {
    logger(`    - ${entry}`);
  }
}

function renderOverrideEntries(env, runtime) {
  return FREECAD_ENV_OVERRIDES.map((name) => {
    const value = env[name];
    const suffix = runtime.source === name ? ' [selected]' : '';
    return `${name}: ${formatValue(value)}${suffix}`;
  });
}

function renderCandidateEntries(runtime) {
  const selected = new Set([
    runtime.executable,
    runtime.pythonExecutable,
    runtime.runtimeExecutable,
    runtime.guiExecutable,
  ].filter(Boolean));

  return (runtime.checkedCandidates || []).map((candidate) => `${candidate}${selected.has(candidate) ? ' [selected]' : ''}`);
}

function remediationSteps(platform, env, runtime) {
  const hasExplicitOverride = FREECAD_ENV_OVERRIDES.some((name) => typeof env[name] === 'string' && env[name].trim());
  const steps = [];

  if (hasExplicitOverride) {
    steps.push('Review the active FREECAD_* overrides below and fix or remove any stale paths before retrying.');
  }

  if (platform === 'darwin') {
    steps.push('Install FreeCAD 1.1.x for macOS, then point `FREECAD_APP` at the app bundle.');
    steps.push('Example: `export FREECAD_APP=\"/Applications/FreeCAD.app\"`');
    steps.push('If needed, pin the bundle internals directly with `FREECAD_BIN` or `FREECAD_PYTHON`.');
  } else if (platform === 'linux') {
    if (runtime.mode === 'wsl-windows') {
      steps.push('Point `FREECAD_DIR`, `FREECAD_BIN`, or `FREECAD_PYTHON` at the Windows FreeCAD install you want WSL to use.');
      steps.push('Example: `export FREECAD_DIR=\"C:\\\\Program Files\\\\FreeCAD 1.1\"`');
    } else {
      steps.push('Install FreeCAD 1.1 for Linux or expose `FreeCADCmd`/`freecadcmd` on PATH.');
      steps.push('Example: `export FREECAD_BIN=\"/path/to/FreeCADCmd\"`');
    }
  } else {
    steps.push('Install FreeCAD 1.1 for Windows and point `FREECAD_BIN` or `FREECAD_PYTHON` at the installed executables.');
    steps.push('Example: `set FREECAD_BIN=C:\\\\Program Files\\\\FreeCAD 1.1\\\\bin\\\\FreeCADCmd.exe`');
  }

  steps.push('Re-run `fcad check-runtime` until a selected runtime and version details appear.');
  steps.push('If you only need the manufacturing-review layer for now, stay on the plain-Python commands listed below while FreeCAD is being fixed.');
  return steps;
}

function nextSteps(runtime) {
  const steps = [
    'Run a real workflow such as `fcad create <config.toml>` or `fcad draw <config.toml> --bom` to verify the same runtime path end to end.',
  ];
  if (runtime.mode === 'macos-bundle') {
    steps.push('Use `npm run test:runtime-smoke` on a FreeCAD-capable macOS machine when you want the repository-owned smoke path.');
  }
  return steps;
}

export function printRuntimeDiagnostics({
  logger = console.log,
  runtime = getFreeCADRuntime(),
  platform = process.platform,
  env = process.env,
  detectDetails = detectRuntimeDetails,
} = {}) {
  const details = detectDetails({ runtime });

  logger('FreeCAD Automation runtime diagnostics');
  logger(`Status: ${runtime.available ? 'ready' : 'runtime not detected'}`);
  logger(`Platform: ${platform}`);

  logSection(logger, 'Selected runtime');
  logger(`  - Summary: ${describeFreeCADRuntime(runtime)}`);
  logger(`  - Resolution source: ${formatValue(runtime.source, 'auto-detect')}`);
  logger(`  - Runtime mode: ${formatValue(runtime.mode, 'unknown')}`);
  logger(`  - Script executable: ${formatValue(runtime.executable, 'not found')}`);
  if (runtime.bundleRoot) logger(`  - Bundle root: ${runtime.bundleRoot}`);
  if (runtime.installRoot) logger(`  - Install root: ${runtime.installRoot}`);
  if (runtime.runtimeExecutable) logger(`  - FreeCAD runtime executable: ${runtime.runtimeExecutable}`);
  if (runtime.pythonExecutable) logger(`  - FreeCAD Python executable: ${runtime.pythonExecutable}`);
  if (runtime.guiExecutable) logger(`  - FreeCAD GUI launcher: ${runtime.guiExecutable}`);

  logSection(logger, 'Environment overrides');
  logger(`  Resolution order: ${FREECAD_ENV_OVERRIDES.join(' -> ')}`);
  logList(logger, renderOverrideEntries(env, runtime));

  logSection(logger, 'Searched paths');
  logList(logger, renderCandidateEntries(runtime), {
    empty: '  - no candidate paths were generated for this platform',
  });

  logSection(logger, 'Detected runtime details');
  logger(`  - Python executable: ${formatValue(details.python.executable)}`);
  logger(`  - Python version: ${formatValue(details.python.version, 'unavailable')}`);
  if (details.python.platform) logger(`  - Python platform: ${details.python.platform}`);
  if (details.python.error) logger(`  - Python probe note: ${details.python.error}`);
  logger(`  - FreeCAD executable: ${formatValue(details.freecad.executable)}`);
  logger(`  - FreeCAD version: ${formatValue(details.freecad.version, 'unavailable')}`);
  if (details.freecad.homePath) logger(`  - FreeCAD home: ${details.freecad.homePath}`);
  if (details.freecad.modulePath) logger(`  - FreeCAD module: ${details.freecad.modulePath}`);
  if (details.freecad.error) logger(`  - FreeCAD probe note: ${details.freecad.error}`);

  logSection(logger, 'Command coverage');
  logger('  Commands that require FreeCAD:');
  logIndentedCommandList(logger, FREECAD_BACKED_COMMANDS);
  logger('  Commands that can run in plain Python / Node mode:');
  logIndentedCommandList(logger, PLAIN_PYTHON_COMMANDS);
  logger('  Mixed / conditional commands:');
  logIndentedCommandList(logger, CONDITIONAL_COMMANDS.map((entry) => `${entry.name}: ${entry.note}`));

  logSection(logger, 'Verification note');
  logger('  - Repository-owned live runtime verification currently exists for macOS + FreeCAD 1.1.x.');
  logger('  - Windows native, WSL -> Windows FreeCAD, and Linux remain compatibility paths unless you verify them locally or in your own CI.');

  if (runtime.available) {
    logSection(logger, 'Next steps');
    logList(logger, nextSteps(runtime));
    return 0;
  }

  logSection(logger, 'Remediation');
  logList(logger, remediationSteps(platform, env, runtime));
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(printRuntimeDiagnostics());
}
