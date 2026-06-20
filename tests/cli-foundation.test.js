import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseCliArgs } from '../src/cli/args.js';
import { dispatchCliCommand } from '../src/cli/dispatch.js';
import {
  createCliPathHelpers,
  createRunWithCliStderr,
  nowIso,
} from '../src/cli/helpers.js';
import { createCliOptionValidators } from '../src/cli/options.js';

const ROOT = resolve(import.meta.dirname, '..');

function runModuleSnippet(source) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

assert.deepEqual(parseCliArgs([
  'config.toml',
  '--out',
  'output/result.json',
  '--strict-quality',
  '--batch=4',
  '--profile',
  'demo',
  '--literal',
  '--next',
]), {
  positional: ['config.toml'],
  options: {
    out: 'output/result.json',
    'strict-quality': true,
    batch: '4',
    profile: 'demo',
    literal: true,
    next: true,
  },
});

const validators = createCliOptionValidators({ projectRoot: ROOT });
assert.equal(validators.ensureNumericOption('--batch', '3'), 3);
assert.equal(validators.ensureNumericOption('--batch', ''), undefined);
assert.equal(validators.requireOptionValue('--out', 'output/result.json'), 'output/result.json');
validators.rejectUnsupportedOptions('demo', { out: 'x' }, ['out']);
validators.requireExistingInputFile('package', resolve(ROOT, 'package.json'));
validators.requireRepoScopedPath('package', resolve(ROOT, 'package.json'));

const tempRoot = mkdtempSync(join(tmpdir(), 'fcad-cli-foundation-'));
try {
  const pathHelpers = createCliPathHelpers({ projectRoot: tempRoot });
  assert.equal(pathHelpers.resolveMaybe('output/result.json'), resolve(ROOT, 'output/result.json'));
  assert.equal(pathHelpers.buildDefaultOutputDir(), join(tempRoot, 'output'));
  assert.equal(pathHelpers.normalizeJsonOutputPath('output/result'), resolve(ROOT, 'output/result.json'));
  assert.equal(pathHelpers.repoRelativePath(join(tempRoot, 'artifact.json')), 'artifact.json');
  assert.equal(pathHelpers.cliRelativePath(join(tempRoot, 'artifact.json')), 'artifact.json');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

assert.match(nowIso(), /^\d{4}-\d{2}-\d{2}T/);

let forwardedStderr = '';
const runWithCliStderr = createRunWithCliStderr(async (script, input, opts = {}) => {
  opts.onStderr('runtime warning\n');
  return { script, input };
}, {
  destroyed: false,
  writable: true,
  write(text, callback) {
    forwardedStderr += text;
    if (callback) callback();
  },
});
const scriptResult = await runWithCliStderr('demo.py', { ok: true });
assert.deepEqual(scriptResult, { script: 'demo.py', input: { ok: true } });
assert.equal(forwardedStderr, 'runtime warning\n');

assert.equal(typeof dispatchCliCommand, 'function');

const knownRun = runModuleSnippet(`
  import { dispatchCliCommand } from './src/cli/dispatch.js';
  await dispatchCliCommand({
    argv: ['known', '--flag', 'value'],
    usage: 'USAGE',
    renderCommandUsage: () => null,
    printRuntimeDiagnostics: () => 0,
    commands: {
      known: async (args) => console.log(JSON.stringify(args)),
    },
  });
`);
assert.equal(knownRun.status, 0, knownRun.stderr || knownRun.stdout);
assert.equal(knownRun.stdout.trim(), '["--flag","value"]');

const helpRun = runModuleSnippet(`
  import { dispatchCliCommand } from './src/cli/dispatch.js';
  await dispatchCliCommand({
    argv: ['known', '--help'],
    usage: 'USAGE',
    renderCommandUsage: (command) => 'HELP ' + command,
    printRuntimeDiagnostics: () => 0,
    commands: {
      known: async () => console.log('handler should not run'),
    },
  });
`);
assert.equal(helpRun.status, 0, helpRun.stderr || helpRun.stdout);
assert.equal(helpRun.stdout.trim(), 'HELP known');

const unknownRun = runModuleSnippet(`
  import { dispatchCliCommand } from './src/cli/dispatch.js';
  await dispatchCliCommand({
    argv: ['missing'],
    usage: 'USAGE',
    renderCommandUsage: () => null,
    printRuntimeDiagnostics: () => 0,
    commands: {},
  });
`);
assert.equal(unknownRun.status, 1);
assert.match(unknownRun.stderr, /Unknown command: missing/);
assert.match(unknownRun.stdout, /USAGE/);

const checkRuntimeRun = runModuleSnippet(`
  import { dispatchCliCommand } from './src/cli/dispatch.js';
  await dispatchCliCommand({
    argv: ['check-runtime', '--json'],
    usage: 'USAGE',
    renderCommandUsage: () => null,
    printRuntimeDiagnostics: ({ format }) => {
      console.log(format);
      return 7;
    },
    commands: {},
  });
`);
assert.equal(checkRuntimeRun.status, 7);
assert.equal(checkRuntimeRun.stdout.trim(), 'json');

const checkRuntimePositionalRun = runModuleSnippet(`
  import { dispatchCliCommand } from './src/cli/dispatch.js';
  await dispatchCliCommand({
    argv: ['check-runtime', 'extra'],
    usage: 'USAGE',
    renderCommandUsage: () => null,
    printRuntimeDiagnostics: () => 0,
    commands: {},
  });
`);
assert.equal(checkRuntimePositionalRun.status, 1);
assert.match(checkRuntimePositionalRun.stderr, /check-runtime does not accept positional arguments/);

assert.equal(existsSync(resolve(ROOT, 'bin', 'fcad.js')), true);

console.log('cli-foundation.test.js: ok');
