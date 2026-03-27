import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';

import { describeFreeCADRuntime, FREECAD_ENV_OVERRIDES, getFreeCADRuntime } from './paths.js';

const CHECK_TIMEOUT_MS = 5_000;

export const RUNTIME_DIAGNOSTICS_VERSION = '1.0';

export const DIAGNOSTIC_COMMANDS = Object.freeze([
  'check-runtime',
]);

export const FREECAD_BACKED_COMMANDS = Object.freeze([
  'create',
  'draw',
  'inspect',
  'fem',
  'tolerance',
  'report',
]);

export const PLAIN_PYTHON_COMMANDS = Object.freeze([
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
]);

export const CONDITIONAL_COMMANDS = Object.freeze([
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
]);

export const SUPPORT_BOUNDARY_NOTE = 'Windows native, WSL -> Windows FreeCAD, and Linux remain compatibility paths unless you verify them locally or in your own CI.';

function looksLikePythonExecutable(executable = '') {
  const lower = basename(executable || '').toLowerCase();
  return lower === 'python' || lower === 'python3' || lower === 'python.exe' || lower === 'pythonw.exe';
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

function buildCapabilityMap() {
  const entries = {};

  for (const name of DIAGNOSTIC_COMMANDS) {
    entries[name] = {
      classification: 'diagnostics',
      requires_freecad_runtime: false,
      note: 'Reports runtime discovery, selected executables, and command coverage without launching FreeCAD workflows.',
    };
  }

  for (const name of FREECAD_BACKED_COMMANDS) {
    entries[name] = {
      classification: 'freecad-backed',
      requires_freecad_runtime: true,
      note: null,
    };
  }

  for (const name of PLAIN_PYTHON_COMMANDS) {
    entries[name] = {
      classification: 'plain-python-node',
      requires_freecad_runtime: false,
      note: null,
    };
  }

  for (const entry of CONDITIONAL_COMMANDS) {
    entries[entry.name] = {
      classification: 'mixed-conditional',
      requires_freecad_runtime: null,
      note: entry.note,
    };
  }

  return entries;
}

function renderOverrideEntries(env, runtime) {
  return FREECAD_ENV_OVERRIDES.map((name) => ({
    name,
    value: typeof env[name] === 'string' && env[name].trim() ? env[name] : null,
    selected: runtime.source === name,
  }));
}

function selectedCandidates(runtime) {
  return [
    runtime.executable,
    runtime.pythonExecutable,
    runtime.runtimeExecutable,
    runtime.guiExecutable,
  ].filter(Boolean);
}

function remediationSteps(platform, env, runtime) {
  const hasExplicitOverride = FREECAD_ENV_OVERRIDES.some((name) => typeof env[name] === 'string' && env[name].trim());
  const steps = [];

  if (hasExplicitOverride) {
    steps.push('Review the active FREECAD_* overrides below and fix or remove any stale paths before retrying.');
  }

  if (platform === 'darwin') {
    steps.push('Install FreeCAD 1.1.x for macOS, then point `FREECAD_APP` at the app bundle.');
    steps.push('Example: `export FREECAD_APP="/Applications/FreeCAD.app"`');
    steps.push('If needed, pin the bundle internals directly with `FREECAD_BIN` or `FREECAD_PYTHON`.');
  } else if (platform === 'linux') {
    if (runtime.mode === 'wsl-windows') {
      steps.push('Point `FREECAD_DIR`, `FREECAD_BIN`, or `FREECAD_PYTHON` at the Windows FreeCAD install you want WSL to use.');
      steps.push('Example: `export FREECAD_DIR="C:\\Program Files\\FreeCAD 1.1"`');
    } else {
      steps.push('Install FreeCAD 1.1 for Linux or expose `FreeCADCmd`/`freecadcmd` on PATH.');
      steps.push('Example: `export FREECAD_BIN="/path/to/FreeCADCmd"`');
    }
  } else {
    steps.push('Install FreeCAD 1.1 for Windows and point `FREECAD_BIN` or `FREECAD_PYTHON` at the installed executables.');
    steps.push('Example: `set FREECAD_BIN=C:\\Program Files\\FreeCAD 1.1\\bin\\FreeCADCmd.exe`');
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

function supportBoundaryNote(platform, runtime) {
  if (runtime.mode === 'macos-bundle' || platform === 'darwin') {
    return null;
  }
  return SUPPORT_BOUNDARY_NOTE;
}

function buildWarnings(runtime, details, supportBoundary) {
  const warnings = [];

  if (details.python.error) warnings.push(`Python probe note: ${details.python.error}`);
  if (details.freecad.error) warnings.push(`FreeCAD probe note: ${details.freecad.error}`);
  if (runtime.available && details.python.executable && !details.python.version && !details.python.error) {
    warnings.push('Python version details were not available from the selected runtime.');
  }
  if (runtime.available && details.freecad.executable && !details.freecad.version && !details.freecad.error) {
    warnings.push('FreeCAD version details were not available from the selected runtime.');
  }
  if (supportBoundary) warnings.push(supportBoundary);

  return warnings;
}

function buildErrors(runtime) {
  const errors = [];
  if (!runtime.available) {
    errors.push('FreeCAD runtime not detected.');
    if (runtime.source && runtime.source !== 'auto-detect') {
      errors.push(`Configured override ${runtime.source} did not resolve to a working executable.`);
    }
  }
  return errors;
}

export function buildRuntimeDiagnostics({
  runtime = getFreeCADRuntime(),
  platform = process.platform,
  env = process.env,
  detectDetails = detectRuntimeDetails,
} = {}) {
  const details = detectDetails({ runtime });
  const supportBoundary = supportBoundaryNote(platform, runtime);
  const warnings = buildWarnings(runtime, details, supportBoundary);
  const errors = buildErrors(runtime);

  return {
    diagnostics_version: RUNTIME_DIAGNOSTICS_VERSION,
    status: runtime.available ? 'ready' : 'runtime_not_detected',
    available: Boolean(runtime.available),
    platform,
    description: describeFreeCADRuntime(runtime),
    source: runtime.source || '',
    mode: runtime.mode || '',
    path_style: runtime.pathStyle || '',
    executable: runtime.executable || '',
    python_executable: runtime.pythonExecutable || '',
    runtime_executable: runtime.runtimeExecutable || '',
    gui_executable: runtime.guiExecutable || '',
    checked_candidates: runtime.checkedCandidates || [],
    selected_runtime: {
      summary: describeFreeCADRuntime(runtime),
      source: runtime.source || '',
      mode: runtime.mode || '',
      path_style: runtime.pathStyle || '',
      executable: runtime.executable || '',
      bundle_root: runtime.bundleRoot || '',
      install_root: runtime.installRoot || '',
      runtime_executable: runtime.runtimeExecutable || '',
      python_executable: runtime.pythonExecutable || '',
      gui_executable: runtime.guiExecutable || '',
    },
    detected_runtime_paths: {
      checked_candidates: runtime.checkedCandidates || [],
      selected_candidates: selectedCandidates(runtime),
    },
    env_overrides: {
      resolution_order: [...FREECAD_ENV_OVERRIDES],
      values: renderOverrideEntries(env, runtime),
    },
    version_details: {
      python: {
        executable: details.python.executable || '',
        version: details.python.version || null,
        platform: details.python.platform || null,
        source: details.python.source || null,
        error: details.python.error || null,
      },
      freecad: {
        executable: details.freecad.executable || '',
        version: details.freecad.version || null,
        home_path: details.freecad.homePath || null,
        module_path: details.freecad.modulePath || null,
        source: details.freecad.source || null,
        error: details.freecad.error || null,
      },
    },
    command_classes: {
      diagnostics: [...DIAGNOSTIC_COMMANDS],
      freecad_backed: [...FREECAD_BACKED_COMMANDS],
      plain_python_or_node: [...PLAIN_PYTHON_COMMANDS],
      mixed_or_conditional: CONDITIONAL_COMMANDS.map((entry) => ({ ...entry })),
    },
    capability_map: buildCapabilityMap(),
    warnings,
    errors,
    support_boundary_note: supportBoundary,
    next_steps: runtime.available ? nextSteps(runtime) : [],
    remediation: runtime.available ? [] : remediationSteps(platform, env, runtime),
  };
}
