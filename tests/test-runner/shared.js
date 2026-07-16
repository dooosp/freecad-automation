import { isAbsolute, relative, resolve } from 'node:path';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadConfig as baseLoadConfig } from '../../lib/config-loader.js';
import { normalizeConfig } from '../../lib/config-normalizer.js';
import { describeFreeCADRuntime, hasFreeCADRuntime } from '../../lib/paths.js';
import { runScript as baseRunScript } from '../../lib/runner.js';

export const ROOT = resolve(import.meta.dirname, '../..');
export const TEST_RUNNER_OUTPUT_ROOT = resolve(ROOT, 'output', 'test-runner');

export function resolveTestRunnerOutputDirectory({
  root = ROOT,
  runId = process.env.FCAD_TEST_RUN_ID || String(process.pid),
} = {}) {
  const normalizedRunId = String(runId).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(normalizedRunId)) {
    throw new Error('FCAD_TEST_RUN_ID must be a safe path component (letters, numbers, dot, underscore, or hyphen)');
  }
  return resolve(root, 'output', 'test-runner', `run-${normalizedRunId}`);
}

export const OUTPUT_DIR = resolveTestRunnerOutputDirectory();

export function prepareTestRunnerOutputDirectory(
  outputDir = OUTPUT_DIR,
  { ownedRoot = TEST_RUNNER_OUTPUT_ROOT } = {},
) {
  const resolvedOutputDir = resolve(outputDir);
  const resolvedOwnedRoot = resolve(ownedRoot);
  const ownedRelativePath = relative(resolvedOwnedRoot, resolvedOutputDir);
  if (!ownedRelativePath || ownedRelativePath.startsWith('..') || isAbsolute(ownedRelativePath)) {
    throw new Error(`Refusing to clean non-owned test output directory: ${resolvedOutputDir}`);
  }
  if (existsSync(resolvedOutputDir)) rmSync(resolvedOutputDir, { recursive: true });
  mkdirSync(resolvedOutputDir, { recursive: true });
  return resolvedOutputDir;
}

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
