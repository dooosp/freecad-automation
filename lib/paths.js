import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export const SCRIPTS_DIR = resolve(import.meta.dirname, '..', 'scripts');

function commandPath(cmd) {
  try {
    return execFileSync('which', [cmd], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function isWSL() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

function runWslPath(args) {
  try {
    return execFileSync('wslpath', args, { encoding: 'utf8' }).trim();
  } catch (error) {
    // Node 24 on some WSL setups reports EPERM even when wslpath returned stdout.
    if (error?.code === 'EPERM' && typeof error.stdout === 'string' && error.stdout.trim().length > 0) {
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

export function normalizeLocalPath(value) {
  if (typeof value !== 'string' || !value.trim()) return value;
  const expanded = expandHomePath(value.trim());
  return isAbsolute(expanded) ? resolve(expanded) : expanded;
}

export function toWindows(wslPath) {
  const abs = resolve(normalizeLocalPath(wslPath));
  return runWslPath(['-w', abs]);
}

export function toWSL(winPath) {
  return runWslPath(['-u', winPath]);
}

function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeLocalPath(candidate);
    if (normalized && existsSync(normalized)) {
      return normalized;
    }
  }
  return '';
}

function detectNativeExecutable() {
  const envPython = normalizeLocalPath(process.env.FREECAD_PYTHON || '');
  if (envPython) {
    return {
      mode: process.platform === 'darwin' ? 'macos-native' : 'native',
      executable: envPython,
      source: 'FREECAD_PYTHON',
      candidates: [envPython],
      pathStyle: 'posix',
    };
  }

  const envCmd = normalizeLocalPath(process.env.FREECAD_CMD || '');
  if (envCmd) {
    return {
      mode: process.platform === 'darwin' ? 'macos-native' : 'native',
      executable: envCmd,
      source: 'FREECAD_CMD',
      candidates: [envCmd],
      pathStyle: 'posix',
    };
  }

  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/FreeCAD.app/Contents/Resources/bin/FreeCADCmd',
      '/Applications/FreeCAD.app/Contents/Resources/bin/python',
      '/Applications/FreeCAD.app/Contents/Resources/bin/python3',
      '/Applications/FreeCAD.app/Contents/MacOS/FreeCAD',
      commandPath('FreeCADCmd'),
      commandPath('freecadcmd'),
      commandPath('FreeCAD'),
      commandPath('freecad'),
    ].filter(Boolean);
    return {
      mode: 'macos-native',
      executable: firstExistingPath(candidates),
      source: 'auto-detect',
      candidates,
      pathStyle: 'posix',
    };
  }

  const candidates = [
    commandPath('FreeCADCmd'),
    commandPath('freecadcmd'),
    commandPath('FreeCAD'),
    commandPath('freecad'),
  ].filter(Boolean);
  return {
    mode: 'native',
    executable: candidates[0] || '',
    source: 'auto-detect',
    candidates,
    pathStyle: 'posix',
  };
}

function detectFreeCADRuntime() {
  const isWslHost = isWSL();
  const wslpathExists = !!commandPath('wslpath');
  const envFreecadDir = typeof process.env.FREECAD_DIR === 'string'
    ? process.env.FREECAD_DIR.trim()
    : '';

  if (isWslHost && wslpathExists) {
    const freecadDir = envFreecadDir || 'C:\\Program Files\\FreeCAD 1.0';
    const pythonExe = `${freecadDir}\\bin\\python.exe`;
    return {
      mode: 'wsl-windows',
      executable: toWSL(pythonExe),
      source: envFreecadDir ? 'FREECAD_DIR' : 'default-windows-dir',
      candidates: [pythonExe],
      pathStyle: 'windows',
      freecadDir,
    };
  }

  return detectNativeExecutable();
}

const runtime = detectFreeCADRuntime();

export function getFreeCADRuntime() {
  return {
    ...runtime,
    available: !!runtime.executable,
  };
}

export function hasFreeCADRuntime() {
  return !!runtime.executable;
}

export function describeFreeCADRuntime() {
  if (runtime.mode === 'wsl-windows') {
    return `WSL -> Windows FreeCAD (${runtime.freecadDir})`;
  }
  if (runtime.executable) {
    return `${runtime.mode} (${runtime.executable})`;
  }
  if (runtime.mode === 'macos-native') {
    return 'macOS native FreeCAD (not found; set FREECAD_PYTHON or FREECAD_CMD)';
  }
  return 'FreeCAD runtime not found';
}

export function getFreeCADInvocation(scriptName) {
  const scriptPath = join(SCRIPTS_DIR, scriptName);

  if (!runtime.executable) {
    const hint = runtime.candidates?.length
      ? ` Tried: ${runtime.candidates.join(', ')}`
      : ' Set FREECAD_PYTHON or FREECAD_CMD to your FreeCAD executable.';
    throw new Error(`FreeCAD runtime not found for ${process.platform}.${hint}`);
  }

  if (runtime.mode === 'wsl-windows') {
    return {
      command: runtime.executable,
      args: [toWindows(scriptPath)],
      pathStyle: 'windows',
      runtime,
    };
  }

  return {
    command: runtime.executable,
    args: [scriptPath],
    pathStyle: 'posix',
    runtime,
  };
}

export function convertPathForRuntime(value) {
  const normalized = normalizeLocalPath(value);
  if (typeof normalized !== 'string') return normalized;
  if (runtime.mode === 'wsl-windows') {
    return toWindows(normalized);
  }
  return normalized;
}
