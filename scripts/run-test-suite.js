#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { getTestSuite } from '../tests/lane-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');

function printUsage() {
  console.error('Usage: node scripts/run-test-suite.js <hosted|node-lite|default-node>');
}

function resolveNpmInvocation() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && npmExecPath.endsWith('.js')) {
    return {
      command: process.execPath,
      args: [npmExecPath],
    };
  }
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: [],
  };
}

function runPackageScript(scriptName) {
  console.log(`\n== npm run ${scriptName} ==`);
  const npm = resolveNpmInvocation();
  const completed = spawnSync(npm.command, [...npm.args, 'run', scriptName], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });

  if (completed.status !== 0) {
    process.exit(completed.status ?? 1);
  }
}

const suiteId = process.argv[2];
const suite = suiteId ? getTestSuite(suiteId) : null;

if (!suite) {
  printUsage();
  process.exit(1);
}

console.log(`Running test suite: ${suiteId}`);
for (const scriptName of suite.members) {
  runPackageScript(scriptName);
}

console.log(`\nTest suite '${suiteId}' passed.`);
