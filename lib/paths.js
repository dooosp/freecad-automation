import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Convert WSL path to Windows path.
 * e.g. /home/taeho/file.txt → \\wsl.localhost\Ubuntu\home\taeho\file.txt
 */
export function toWindows(wslPath) {
  const abs = resolve(wslPath);
  return execFileSync('wslpath', ['-w', abs], { encoding: 'utf8' }).trim();
}

/**
 * Convert Windows path to WSL path.
 * e.g. C:\Users\foo\file.txt → /mnt/c/Users/foo/file.txt
 */
export function toWSL(winPath) {
  return execFileSync('wslpath', ['-u', winPath], { encoding: 'utf8' }).trim();
}

/** FreeCAD install directory (Windows path) */
export const FREECAD_DIR = 'C:\\Program Files\\FreeCAD 1.0';

/** FreeCAD bundled python.exe (Windows path) */
export const PYTHON_EXE = `${FREECAD_DIR}\\bin\\python.exe`;

/** FreeCAD bundled python.exe (WSL-accessible path) */
export const PYTHON_EXE_WSL = toWSL(PYTHON_EXE);

/** Scripts directory (WSL path) */
export const SCRIPTS_DIR = resolve(import.meta.dirname, '..', 'scripts');
