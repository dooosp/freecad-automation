import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = resolve(ROOT, 'bin', 'fcad.js');

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
}

const helpResult = runCli(['serve', '--help']);
assert.equal(helpResult.status, 0, helpResult.stderr);
assert.match(helpResult.stdout, /fcad serve - local API, studio shell, and legacy viewer entrypoint/);
assert.match(helpResult.stdout, /fcad serve \[port\] \[--jobs-dir <dir>\]/);
assert.match(helpResult.stdout, /fcad serve \[port\] --legacy-viewer/);
assert.match(helpResult.stdout, /Browser requests to http:\/\/127\.0\.0\.1:<port>\/ land in the future-facing studio shell/);
assert.match(helpResult.stdout, /Open http:\/\/127\.0\.0\.1:<port>\/api for the local API info page/);
assert.match(helpResult.stdout, /Open http:\/\/127\.0\.0\.1:<port>\/studio/);
assert.doesNotMatch(helpResult.stdout, /listening on http/i);

const positionalHelpResult = runCli(['serve', 'help']);
assert.equal(positionalHelpResult.status, 0, positionalHelpResult.stderr);
assert.match(positionalHelpResult.stdout, /Use fcad serve --legacy-viewer or npm run serve:legacy/);

const invalidPortResult = runCli(['serve', 'not-a-port']);
assert.equal(invalidPortResult.status, 1);
assert.match(invalidPortResult.stderr, /serve port must be a positive integer/);

console.log('serve-cli.test.js: ok');
