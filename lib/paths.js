import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, win32 } from 'node:path';

export const SCRIPTS_DIR = resolve(import.meta.dirname, '..', 'scripts');

const MACOS_DEFAULT_APP_CANDIDATES = [
  '/Applications/FreeCAD.app',
  '~/Applications/FreeCAD.app',
];

const MACOS_BUNDLED_PYTHON_RELATIVE_PATHS = [
  ['Contents', 'Resources', 'bin', 'python'],
  ['Contents', 'Resources', 'bin', 'python3'],
];

const MACOS_BUNDLED_RUNTIME_RELATIVE_PATHS = [
  ['Contents', 'Resources', 'bin', 'freecadcmd'],
  ['Contents', 'Resources', 'bin', 'freecad'],
  ['Contents', 'Resources', 'bin', 'FreeCADCmd'],
];

const WINDOWS_PYTHON_EXE_NAMES = ['python.exe', 'pythonw.exe'];
const WINDOWS_RUNTIME_EXE_NAMES = ['FreeCADCmd.exe', 'freecadcmd.exe', 'FreeCAD.exe'];
const GENERIC_RUNTIME_NAMES = ['FreeCADCmd', 'freecadcmd', 'FreeCAD', 'freecad'];
export const FREECAD_ENV_OVERRIDES = Object.freeze([
  'FREECAD_PYTHON',
  'FREECAD_BIN',
  'FREECAD_CMD',
  'FREECAD_APP',
  'FREECAD_DIR',
]);

function commandPath(cmd, options = {}) {
  const runner = options.execFileSync || execFileSync;
  const platform = options.platform || process.platform;
  const locator = platform === 'win32' ? 'where' : 'which';
  try {
    return String(runner(locator, [cmd], { encoding: 'utf8' }))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || '';
  } catch {
    return '';
  }
}

function isWSL(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const reader = options.readFileSync || readFileSync;
  if (platform !== 'linux') return false;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try {
    return /microsoft/i.test(reader('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

function runWslPath(args, options = {}) {
  const runner = options.execFileSync || execFileSync;
  try {
    return String(runner('wslpath', args, { encoding: 'utf8' })).trim();
  } catch (error) {
    if (error?.code === 'EPERM' && typeof error.stdout === 'string' && error.stdout.trim()) {
      return error.stdout.trim();
    }
    throw error;
  }
}

function expandHomePath(value) {
  if (typeof value !== 'string') return value;
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

export function isWindowsAbsolutePath(value) {
  return typeof value === 'string' && /^[A-Za-z]:[\\/]/.test(value.trim());
}

export function toWindows(wslPath, options = {}) {
  const normalized = normalizeLocalPath(wslPath, options);
  const abs = typeof normalized === 'string' && normalized
    ? resolve(normalized)
    : resolve(String(wslPath || ''));
  return runWslPath(['-w', abs], options);
}

export function toWSL(winPath, options = {}) {
  return runWslPath(['-u', winPath], options);
}

export function normalizeLocalPath(value, options = {}) {
  if (typeof value !== 'string' || !value.trim()) return value;

  const trimmed = value.trim();
  if (isWindowsAbsolutePath(trimmed)) {
    if (isWSL(options) && commandPath('wslpath', options)) {
      try {
        return toWSL(trimmed, options);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  const expanded = expandHomePath(trimmed);
  return isAbsolute(expanded) ? resolve(expanded) : expanded;
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function makeEntry(display, resolved = display) {
  if (!display || !resolved) return null;
  return { display, resolved };
}

function uniqEntries(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries.filter(Boolean)) {
    const key = `${entry.display}::${entry.resolved}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function firstExistingEntry(entries, pathExists) {
  for (const entry of entries) {
    if (pathExists(entry.resolved)) {
      return entry;
    }
  }
  return null;
}

function extractMacBundleRoot(rawValue, options = {}) {
  const normalized = normalizeLocalPath(rawValue, options);
  if (typeof normalized !== 'string' || !normalized) return '';
  const posixish = normalized.replace(/\\/g, '/');
  const match = posixish.match(/^(.*?\.app)(?:\/.*)?$/i);
  return match ? match[1] : '';
}

function isMacExecutablePath(rawValue, names, options = {}) {
  const normalized = normalizeLocalPath(rawValue, options);
  if (typeof normalized !== 'string' || !normalized) return false;
  return names.some((name) => normalized.endsWith(`/${name}`));
}

function buildMacBundleEntries(bundleRoot) {
  const normalizedRoot = normalizeLocalPath(bundleRoot);
  const guiEntries = uniqEntries([
    makeEntry(join(normalizedRoot, 'Contents', 'MacOS', 'FreeCAD')),
  ]);
  const pythonEntries = uniqEntries(
    MACOS_BUNDLED_PYTHON_RELATIVE_PATHS.map((parts) => makeEntry(join(normalizedRoot, ...parts)))
  );
  const runtimeEntries = uniqEntries(
    MACOS_BUNDLED_RUNTIME_RELATIVE_PATHS.map((parts) => makeEntry(join(normalizedRoot, ...parts)))
  );
  return {
    bundleRoot: normalizedRoot,
    guiEntries,
    pythonEntries,
    runtimeEntries,
  };
}

function buildGenericExecutableEntries(rawValue, options = {}) {
  const normalized = normalizeLocalPath(rawValue, options);
  if (typeof normalized !== 'string' || !normalized) return [];
  return [makeEntry(normalized)];
}

function deriveWindowsInstallRoot(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) return '';
  const trimmed = rawValue.trim();
  if (/[\\/]+bin$/i.test(trimmed)) {
    return trimmed.replace(/[\\/]+bin$/i, '');
  }
  if (/[\\/]+bin[\\/]+[^\\/]+\.exe$/i.test(trimmed)) {
    return trimmed.replace(/[\\/]+bin[\\/]+[^\\/]+\.exe$/i, '');
  }
  return trimmed;
}

function makeWindowsEntry(display, options = {}) {
  const normalized = typeof display === 'string' ? display.trim() : '';
  if (!normalized) return null;
  if (isWSL(options) && commandPath('wslpath', options)) {
    try {
      return makeEntry(normalized, toWSL(normalized, options));
    } catch {
      return makeEntry(normalized, normalized);
    }
  }
  return makeEntry(normalized, normalized);
}

function buildWindowsEntries(rawValue, kind, options = {}) {
  const trimmed = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!trimmed) return { installRoot: '', pythonEntries: [], runtimeEntries: [], guiEntries: [] };

  const installRoot = deriveWindowsInstallRoot(trimmed);
  const exactEntry = trimmed.endsWith('.exe') ? makeWindowsEntry(trimmed, options) : null;
  const lowerTrimmed = trimmed.toLowerCase();
  const exactLooksLikePython = WINDOWS_PYTHON_EXE_NAMES.some((name) => lowerTrimmed.endsWith(name));
  const exactLooksLikeRuntime = WINDOWS_RUNTIME_EXE_NAMES.some((name) => lowerTrimmed.endsWith(name.toLowerCase()));
  const exactLooksLikeGui = lowerTrimmed.endsWith('freecad.exe');
  const pythonEntries = uniqEntries([
    ...((kind === 'python' || exactLooksLikePython) ? [exactEntry] : []),
    ...WINDOWS_PYTHON_EXE_NAMES.map((name) => makeWindowsEntry(win32.join(installRoot, 'bin', name), options)),
  ]);
  const runtimeEntries = uniqEntries([
    ...((kind === 'bin' || kind === 'cmd' || exactLooksLikeRuntime) ? [exactEntry] : []),
    ...WINDOWS_RUNTIME_EXE_NAMES.map((name) => makeWindowsEntry(win32.join(installRoot, 'bin', name), options)),
  ]);
  const guiEntries = uniqEntries([
    ...((kind === 'app' || exactLooksLikeGui) ? [exactEntry] : []),
    makeWindowsEntry(win32.join(installRoot, 'bin', 'FreeCAD.exe'), options),
  ]);

  return { installRoot, pythonEntries, runtimeEntries, guiEntries };
}

function finalizeRuntime(runtime) {
  const checked = uniq(runtime.checkedCandidates || []);
  return {
    ...runtime,
    checkedCandidates: checked,
    available: !!runtime.executable,
  };
}

function resolveFromEntries({
  mode,
  source,
  pathStyle,
  bundleRoot = '',
  installRoot = '',
  pythonEntries = [],
  runtimeEntries = [],
  guiEntries = [],
  scriptEntries = null,
    toRuntimePath = (value) => normalizeLocalPath(value),
    fromRuntimePath = (value) => normalizeLocalPath(value),
  }) {
  const pathExists = this?.existsSync || existsSync;
  const pythonMatch = firstExistingEntry(pythonEntries, pathExists);
  const runtimeMatch = firstExistingEntry(runtimeEntries, pathExists);
  const guiMatch = firstExistingEntry(guiEntries, pathExists);
  const executableMatch = scriptEntries
    ? firstExistingEntry(scriptEntries, pathExists)
    : (pythonMatch || runtimeMatch || guiMatch || null);

  return finalizeRuntime({
    mode,
    source,
    pathStyle,
    bundleRoot,
    installRoot,
    executable: executableMatch?.resolved || '',
    pythonExecutable: pythonMatch?.resolved || '',
    runtimeExecutable: runtimeMatch?.resolved || '',
    guiExecutable: guiMatch?.resolved || '',
    checkedCandidates: uniq([
      ...pythonEntries.map((entry) => entry.display),
      ...runtimeEntries.map((entry) => entry.display),
      ...guiEntries.map((entry) => entry.display),
    ]),
    toRuntimePath,
    fromRuntimePath,
  });
}

function resolveMacExplicitRuntime(source, rawValue, kind, options = {}) {
  const bundleRoot = extractMacBundleRoot(rawValue, options);
  const bundleEntries = bundleRoot ? buildMacBundleEntries(bundleRoot) : null;
  const exactEntries = buildGenericExecutableEntries(rawValue, options);
  const explicitBundleExecutable = !!bundleRoot && normalizeLocalPath(rawValue, options) !== bundleRoot;
  const exactLooksLikePython = kind === 'python' || isMacExecutablePath(rawValue, ['python', 'python3'], options);
  const exactLooksLikeRuntime = kind === 'bin' || kind === 'cmd'
    || isMacExecutablePath(rawValue, ['freecad', 'freecadcmd', 'FreeCADCmd'], options);
  const exactLooksLikeGui = (explicitBundleExecutable && isMacExecutablePath(rawValue, ['FreeCAD'], options))
    || (!bundleRoot && kind === 'app');
  const pythonEntries = uniqEntries([
    ...(exactLooksLikePython ? exactEntries : []),
    ...(bundleEntries?.pythonEntries || []),
  ]);
  const runtimeEntries = uniqEntries([
    ...(exactLooksLikeRuntime ? exactEntries : []),
    ...(bundleEntries?.runtimeEntries || []),
  ]);
  const guiEntries = uniqEntries([
    ...(exactLooksLikeGui ? exactEntries : []),
    ...(bundleEntries?.guiEntries || []),
  ]);

  return resolveFromEntries.call(options, {
    mode: 'macos-bundle',
    source,
    pathStyle: 'posix',
    bundleRoot: bundleEntries?.bundleRoot || '',
    pythonEntries,
    runtimeEntries,
    guiEntries,
    scriptEntries: kind === 'python'
      ? uniqEntries([...pythonEntries, ...runtimeEntries, ...guiEntries])
      : uniqEntries([...runtimeEntries, ...pythonEntries, ...guiEntries]),
  });
}

function resolveMacAutoRuntime(options = {}) {
  const bundleRoots = uniq([
    ...MACOS_DEFAULT_APP_CANDIDATES.map((value) => normalizeLocalPath(value, options)),
    ...GENERIC_RUNTIME_NAMES
      .map((cmd) => commandPath(cmd, options))
      .map((value) => extractMacBundleRoot(value, options)),
  ]);

  const bundleEntries = bundleRoots.map((bundleRoot) => buildMacBundleEntries(bundleRoot));
  const directRuntimeEntries = uniqEntries(
    GENERIC_RUNTIME_NAMES
      .map((cmd) => commandPath(cmd, options))
      .filter((value) => value && !extractMacBundleRoot(value, options))
      .map((value) => makeEntry(normalizeLocalPath(value, options)))
  );

  return resolveFromEntries.call(options, {
    mode: 'macos-bundle',
    source: 'auto-detect',
    pathStyle: 'posix',
    bundleRoot: bundleEntries.find(({ bundleRoot }) => bundleRoot)?.bundleRoot || '',
    pythonEntries: uniqEntries(bundleEntries.flatMap(({ pythonEntries }) => pythonEntries)),
    runtimeEntries: uniqEntries([
      ...bundleEntries.flatMap(({ runtimeEntries }) => runtimeEntries),
      ...directRuntimeEntries,
    ]),
    guiEntries: uniqEntries(bundleEntries.flatMap(({ guiEntries }) => guiEntries)),
    scriptEntries: uniqEntries([
      ...bundleEntries.flatMap(({ runtimeEntries }) => runtimeEntries),
      ...bundleEntries.flatMap(({ pythonEntries }) => pythonEntries),
      ...directRuntimeEntries,
      ...bundleEntries.flatMap(({ guiEntries }) => guiEntries),
    ]),
  });
}

function resolveWindowsExplicitRuntime(source, rawValue, kind, options = {}) {
  const entries = buildWindowsEntries(rawValue, kind, options);
  return resolveFromEntries.call(options, {
    mode: isWSL(options) ? 'wsl-windows' : 'windows-native',
    source,
    pathStyle: 'windows',
    installRoot: entries.installRoot,
    pythonEntries: entries.pythonEntries,
    runtimeEntries: entries.runtimeEntries,
    guiEntries: entries.guiEntries,
    scriptEntries: kind === 'bin' || kind === 'cmd'
      ? uniqEntries([...entries.runtimeEntries, ...entries.pythonEntries, ...entries.guiEntries])
      : uniqEntries([...entries.pythonEntries, ...entries.runtimeEntries, ...entries.guiEntries]),
    toRuntimePath: (value) => {
      if (isWSL(options) && commandPath('wslpath', options)) {
        return toWindows(value, options);
      }
      return normalizeLocalPath(value, options);
    },
    fromRuntimePath: (value) => {
      const normalized = normalizeLocalPath(value, options);
      if (typeof normalized !== 'string') return normalized;
      if (isWSL(options) && commandPath('wslpath', options) && isWindowsAbsolutePath(normalized)) {
        return toWSL(normalized, options);
      }
      return normalized;
    },
  });
}

function resolveGenericExplicitRuntime(source, rawValue, kind, options = {}) {
  const normalized = normalizeLocalPath(rawValue, options);
  const exactEntries = buildGenericExecutableEntries(rawValue, options);
  const lowerNormalized = typeof normalized === 'string' ? normalized.toLowerCase() : '';
  const exactLooksLikePython = lowerNormalized.endsWith('/python') || lowerNormalized.endsWith('/python3');
  const exactLooksLikeRuntime = GENERIC_RUNTIME_NAMES.some((name) => lowerNormalized.endsWith(`/${name.toLowerCase()}`));
  const pythonEntries = uniqEntries([
    ...((kind === 'python' || exactLooksLikePython) ? exactEntries : []),
    ...((kind === 'dir' || kind === 'app')
      ? [makeEntry(join(normalized, 'bin', 'python'))]
      : []),
  ]);
  const runtimeEntries = uniqEntries([
    ...((kind === 'bin' || kind === 'cmd' || exactLooksLikeRuntime) ? exactEntries : []),
    ...GENERIC_RUNTIME_NAMES.map((name) => makeEntry(join(normalized, 'bin', name))),
  ]);

  return resolveFromEntries.call(options, {
    mode: 'native',
    source,
    pathStyle: 'posix',
    installRoot: kind === 'dir' || kind === 'app' ? normalized : '',
    pythonEntries,
    runtimeEntries,
    scriptEntries: kind === 'bin' || kind === 'cmd'
      ? uniqEntries([...runtimeEntries, ...pythonEntries])
      : uniqEntries([...pythonEntries, ...runtimeEntries]),
    fromRuntimePath: (value) => normalizeLocalPath(value, options),
  });
}

function resolveNativeAutoRuntime(options = {}) {
  const runtimeEntries = uniqEntries(
    GENERIC_RUNTIME_NAMES
      .map((cmd) => commandPath(cmd, options))
      .filter(Boolean)
      .map((value) => makeEntry(normalizeLocalPath(value, options)))
  );

  return resolveFromEntries.call(options, {
    mode: options.platform === 'win32' ? 'windows-native' : 'native',
    source: 'auto-detect',
    pathStyle: options.platform === 'win32' ? 'windows' : 'posix',
    runtimeEntries,
    scriptEntries: runtimeEntries,
    fromRuntimePath: (value) => normalizeLocalPath(value, options),
  });
}

function resolveExplicitRuntime(options = {}) {
  const env = options.env || process.env;
  const overrides = [
    ['FREECAD_PYTHON', 'python', env.FREECAD_PYTHON],
    ['FREECAD_BIN', 'bin', env.FREECAD_BIN],
    ['FREECAD_CMD', 'cmd', env.FREECAD_CMD],
    ['FREECAD_APP', 'app', env.FREECAD_APP],
    ['FREECAD_DIR', 'dir', env.FREECAD_DIR],
  ];

  for (const [source, kind, rawValue] of overrides) {
    if (typeof rawValue !== 'string' || !rawValue.trim()) continue;
    if (source === 'FREECAD_APP'
      || extractMacBundleRoot(rawValue, options)
      || (options.platform === 'darwin' && rawValue.includes('FreeCAD.app'))) {
      return resolveMacExplicitRuntime(source, rawValue, kind, options);
    }
    if (isWindowsAbsolutePath(rawValue) || options.platform === 'win32') {
      return resolveWindowsExplicitRuntime(source, rawValue, kind, options);
    }
    return resolveGenericExplicitRuntime(source, rawValue, kind, options);
  }

  return null;
}

export function resolveFreeCADRuntime(options = {}) {
  const platform = options.platform || process.platform;
  const mergedOptions = { ...options, platform };
  const explicitRuntime = resolveExplicitRuntime(mergedOptions);
  if (explicitRuntime) return explicitRuntime;
  if (platform === 'darwin') return resolveMacAutoRuntime(mergedOptions);
  return resolveNativeAutoRuntime(mergedOptions);
}

const runtime = resolveFreeCADRuntime();

export function getFreeCADRuntime() {
  return { ...runtime };
}

export function hasFreeCADRuntime() {
  return runtime.available;
}

export function describeFreeCADRuntime(runtimeOverride = runtime) {
  if (runtimeOverride.executable) {
    const prefix = runtimeOverride.mode === 'macos-bundle'
      ? 'macOS FreeCAD runtime'
      : runtimeOverride.mode === 'wsl-windows'
        ? 'WSL -> Windows FreeCAD runtime'
        : 'FreeCAD runtime';
    return `${prefix} (${runtimeOverride.executable})`;
  }

  const prefix = runtimeOverride.mode === 'macos-bundle'
    ? 'macOS FreeCAD 1.1.x runtime not found.'
    : 'FreeCAD runtime not found.';
  const source = runtimeOverride.source && runtimeOverride.source !== 'auto-detect'
    ? ` Source: ${runtimeOverride.source}.`
    : '';
  const checked = runtimeOverride.checkedCandidates?.length
    ? ` Checked: ${runtimeOverride.checkedCandidates.join(', ')}.`
    : '';
  return `${prefix}${source}${checked}`.trim();
}

function platformInstallHint(platform, runtimeOverride) {
  if (runtimeOverride.mode === 'macos-bundle' || platform === 'darwin') {
    return 'Install FreeCAD 1.1.x for macOS and point FREECAD_APP at /Applications/FreeCAD.app, or set FREECAD_BIN/FREECAD_PYTHON to bundle executables.';
  }
  if (runtimeOverride.mode === 'wsl-windows') {
    return 'Set FREECAD_DIR, FREECAD_BIN, or FREECAD_PYTHON to the Windows FreeCAD 1.1 install path so WSL can bridge to it explicitly.';
  }
  if (platform === 'win32') {
    return 'Install FreeCAD 1.1 for Windows and set FREECAD_BIN or FREECAD_PYTHON if it is not on PATH.';
  }
  return 'Install FreeCAD 1.1 and set FREECAD_BIN or FREECAD_PYTHON if the executable is not on PATH.';
}

function describeMissingRuntime(scriptName, runtimeOverride) {
  const platform = process.platform;
  const checked = runtimeOverride.checkedCandidates?.length
    ? ` Checked: ${runtimeOverride.checkedCandidates.join(', ')}.`
    : '';
  const overrides = ` Overrides: ${FREECAD_ENV_OVERRIDES.join(', ')}.`;
  const installHint = ` ${platformInstallHint(platform, runtimeOverride)}`;
  return `FreeCAD runtime not found for ${platform} while preparing ${scriptName}.${checked}${overrides}${installHint}`.trim();
}

export function getFreeCADInvocation(scriptName, runtimeOverride = runtime) {
  const scriptPath = join(SCRIPTS_DIR, scriptName);

  if (!runtimeOverride.executable) {
    throw new Error(describeMissingRuntime(scriptName, runtimeOverride));
  }

  return {
    command: runtimeOverride.executable,
    args: [convertPathForRuntime(scriptPath, runtimeOverride)],
    pathStyle: runtimeOverride.pathStyle,
    runtime: runtimeOverride,
  };
}

export function getFreeCADGuiInvocation(extraArgs = [], runtimeOverride = runtime) {
  if (!runtimeOverride.guiExecutable) {
    throw new Error(
      `FreeCAD GUI executable not found.${runtimeOverride.checkedCandidates?.length
        ? ` Checked: ${runtimeOverride.checkedCandidates.join(', ')}.`
        : ''}`
    );
  }

  return {
    command: runtimeOverride.guiExecutable,
    args: [...extraArgs],
    pathStyle: runtimeOverride.pathStyle,
    runtime: runtimeOverride,
  };
}

export function formatFreeCADInvocation(invocation) {
  return [invocation.command, ...invocation.args].join(' ');
}

export function convertPathForRuntime(value, runtimeOverride = runtime) {
  const normalized = normalizeLocalPath(value);
  if (typeof normalized !== 'string') return normalized;
  if (typeof runtimeOverride.toRuntimePath === 'function') {
    return runtimeOverride.toRuntimePath(normalized);
  }
  return normalized;
}

export function convertPathFromRuntime(value, runtimeOverride = runtime) {
  if (typeof value !== 'string' || !value.trim()) return value;
  if (typeof runtimeOverride.fromRuntimePath === 'function') {
    return runtimeOverride.fromRuntimePath(value.trim());
  }
  return normalizeLocalPath(value);
}
