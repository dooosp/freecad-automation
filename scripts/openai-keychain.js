#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const KEYCHAIN_ACCOUNT = 'Codex';
const KEYCHAIN_SERVICE = 'freecad-automation.openai-api';
const SECURITY_BIN = '/usr/bin/security';
const REVIEWER_PATH = resolve(import.meta.dirname, 'design-reviewer.js');

function requireMacOS() {
  if (process.platform !== 'darwin') {
    throw new Error('macOS Keychain is required for this command.');
  }
}

function keychainResult(args, options = {}) {
  requireMacOS();
  const result = spawnSync(SECURITY_BIN, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    ...options,
  });
  if (result.error) throw new Error('Unable to access macOS Keychain.');
  return result;
}

function keychainHasCredential() {
  const result = keychainResult(
    ['find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE],
    { stdio: 'ignore' },
  );
  return result.status === 0;
}

function parseApiKeyLine(line) {
  const match = line.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*?)\s*$/);
  if (!match) return null;

  let value = match[1];
  if (
    value.length >= 2
    && ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  if (!value) throw new Error('OPENAI_API_KEY is empty in the selected env file.');
  return value;
}

function migrateEnvFile(envPathArgument) {
  if (!envPathArgument) throw new Error('migrate requires an explicit env-file path.');

  const envPath = resolve(envPathArgument);
  const stats = lstatSync(envPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('The selected env path must be a regular file, not a symlink.');
  }

  const contents = readFileSync(envPath, 'utf8');
  const lineEnding = contents.includes('\r\n') ? '\r\n' : '\n';
  const lines = contents.split(/\r?\n/);
  const apiKeyLines = lines
    .map((line, index) => ({ index, apiKey: parseApiKeyLine(line) }))
    .filter(({ apiKey }) => apiKey !== null);

  if (apiKeyLines.length !== 1) {
    throw new Error('The env file must contain exactly one OPENAI_API_KEY entry.');
  }

  const addResult = keychainResult(
    [
      'add-generic-password',
      '-U',
      '-a', KEYCHAIN_ACCOUNT,
      '-s', KEYCHAIN_SERVICE,
      '-w',
    ],
    { input: `${apiKeyLines[0].apiKey}\n` },
  );
  if (addResult.status !== 0) {
    throw new Error('macOS Keychain rejected the credential migration.');
  }

  const nextContents = lines
    .filter((_line, index) => index !== apiKeyLines[0].index)
    .join(lineEnding);
  const temporaryPath = `${envPath}.codex-key-migration-${process.pid}`;
  try {
    writeFileSync(temporaryPath, nextContents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, envPath);
  } catch (error) {
    try { unlinkSync(temporaryPath); } catch { /* temporary file may not exist */ }
    throw error;
  }

  console.log('OpenAI credential migrated to macOS Keychain; plaintext env entry removed.');
}

function readApiKey() {
  const result = keychainResult([
    'find-generic-password',
    '-a', KEYCHAIN_ACCOUNT,
    '-s', KEYCHAIN_SERVICE,
    '-w',
  ]);
  if (result.status !== 0) throw new Error('OpenAI credential was not found in macOS Keychain.');

  const apiKey = result.stdout.replace(/[\r\n]+$/, '');
  if (!apiKey) throw new Error('OpenAI credential in macOS Keychain is empty.');
  return apiKey;
}

function runOnce(args) {
  if (args[0] !== '--authorize-one-request') {
    throw new Error('run requires --authorize-one-request as the first argument.');
  }

  const reviewerArgs = args.slice(1);
  if (reviewerArgs[0] === '--') reviewerArgs.shift();
  if (!['--review', '--design'].includes(reviewerArgs[0])) {
    throw new Error('The one-request wrapper only accepts --review or --design.');
  }

  const apiKey = readApiKey();
  const result = spawnSync(process.execPath, [REVIEWER_PATH, ...reviewerArgs], {
    env: {
      ...process.env,
      OPENAI_API_KEY: apiKey,
      OPENAI_ALLOW_LIVE_REQUEST: '1',
      OPENAI_REQUEST_LIMIT: '1',
      OPENAI_ALLOW_REPAIR_RETRY: '0',
    },
    stdio: 'inherit',
  });
  if (result.error) throw new Error('Unable to start the one-request design reviewer.');
  return result.status ?? 2;
}

function printUsage() {
  console.error('Usage:');
  console.error('  node scripts/openai-keychain.js status');
  console.error('  node scripts/openai-keychain.js migrate <env-file>');
  console.error('  node scripts/openai-keychain.js run --authorize-one-request --review <file> [--json]');
  console.error('  node scripts/openai-keychain.js run --authorize-one-request --design <text> [--json]');
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'status') {
    console.log(keychainHasCredential() ? 'OpenAI credential: stored in macOS Keychain.' : 'OpenAI credential: not found.');
  } else if (command === 'migrate') {
    migrateEnvFile(args[0]);
  } else if (command === 'run') {
    process.exitCode = runOnce(args);
  } else {
    printUsage();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 2;
}
