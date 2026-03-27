import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig as baseLoadConfig } from '../../lib/config-loader.js';
import { normalizeConfig } from '../../lib/config-normalizer.js';
import { describeFreeCADRuntime, hasFreeCADRuntime } from '../../lib/paths.js';
import { runScript as baseRunScript } from '../../lib/runner.js';

export const ROOT = resolve(import.meta.dirname, '../..');
export const OUTPUT_DIR = resolve(ROOT, 'output');

export async function runScript(scriptName, config, options = {}) {
  return baseRunScript(scriptName, config, {
    onStderr: (text) => process.stderr.write(`    ${text}`),
    ...options,
  });
}

export async function loadConfig(configPath) {
  return baseLoadConfig(configPath);
}

export async function loadExampleConfig(relativePath) {
  const config = await loadConfig(resolve(ROOT, relativePath));
  return withOutputDirectory(config);
}

export function withOutputDirectory(config) {
  config.export = config.export || {};
  config.export.directory = OUTPUT_DIR;
  return config;
}

export function normalizeGeneratedPath(runtimePath) {
  if (runtimePath.includes('wsl.localhost') || runtimePath.includes('wsl$')) {
    return runtimePath
      .replace(/\\/g, '/')
      .replace(/^\/\/wsl\.localhost\/Ubuntu/, '')
      .replace(/^\/\/wsl\$\/Ubuntu/, '');
  }

  if (runtimePath.includes('\\')) {
    const unixPath = runtimePath.replace(/\\/g, '/');
    if (unixPath.match(/^[A-Z]:\//)) {
      return '/mnt/' + unixPath[0].toLowerCase() + unixPath.slice(2);
    }
    return unixPath;
  }

  return runtimePath;
}

export function runJsonCommand(command, { timeout = 60_000, allowStdoutOnFailure = false } = {}) {
  try {
    return JSON.parse(execSync(command, { encoding: 'utf8', timeout }));
  } catch (error) {
    if (allowStdoutOnFailure && error.stdout) {
      return JSON.parse(String(error.stdout));
    }
    throw error;
  }
}

export {
  describeFreeCADRuntime,
  hasFreeCADRuntime,
  normalizeConfig,
};
