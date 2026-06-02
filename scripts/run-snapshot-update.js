#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: npm run test:snapshots:update -- --confirm',
    '',
    'Updates tracked snapshot fixtures only after an explicit confirmation flag',
    'and a clean tracked worktree check.',
    '',
    'Options:',
    '  --confirm    Required unless CONFIRM_UPDATE_SNAPSHOTS=1 is set.',
    '  --dry-run    Check confirmation and cleanliness without updating snapshots.',
    '  --help       Show this help.',
    '',
  ].join('\n'));
}

function resolveNpmInvocation(env = process.env) {
  const npmExecPath = env.npm_execpath;
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

function requireConfirmation(argv, env) {
  return argv.includes('--confirm') || env.CONFIRM_UPDATE_SNAPSHOTS === '1';
}

function getTrackedDirtyStatus() {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git status failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return String(result.stdout || '').trim();
}

function runSnapshotUpdate(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes('--help')) {
    printUsage(process.stdout);
    return 0;
  }

  if (!requireConfirmation(argv, env)) {
    process.stderr.write('Refusing to update tracked snapshots without --confirm or CONFIRM_UPDATE_SNAPSHOTS=1.\n\n');
    printUsage(process.stderr);
    return 2;
  }

  const dirtyStatus = getTrackedDirtyStatus();
  if (dirtyStatus) {
    process.stderr.write([
      'Refusing to update tracked snapshots with a dirty tracked worktree.',
      dirtyStatus,
      '',
    ].join('\n'));
    return 1;
  }

  if (argv.includes('--dry-run')) {
    process.stdout.write('Snapshot update dry run passed: confirmation present and tracked worktree clean.\n');
    return 0;
  }

  const npm = resolveNpmInvocation(env);
  const completed = spawnSync(npm.command, [...npm.args, 'run', 'test:snapshots'], {
    cwd: ROOT,
    env: {
      ...env,
      UPDATE_SNAPSHOTS: '1',
    },
    stdio: 'inherit',
  });
  return completed.status ?? 1;
}

const exitCode = runSnapshotUpdate();
process.exit(exitCode);
