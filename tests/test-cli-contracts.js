import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

function runCli(args) {
  return spawnSync('node', [resolve(ROOT, 'bin/fcad.js'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

{
  const result = runCli(['--help']);
  assert.equal(result.status, 0, result.stderr || 'fcad --help should exit 0');
  assert.match(result.stdout, /Review-First Core Lane/i);
  assert.match(result.stdout, /Selective verification lane/i);
  assert.match(result.stdout, /Optional downstream manufacturing lane/i);
  assert.match(result.stdout, /Legacy \/ Compatibility Lane/i);
  assert.match(result.stdout, /check-runtime/);
  assert.match(result.stdout, /review <config\.toml\|json>/i);
  assert.match(result.stdout, /inspect <model.step\|fcstd>/i);
  assert.doesNotMatch(result.stdout, /fcad \| mfg-agent/i);
}

{
  const result = runCli(['check-runtime', '--json']);
  assert.notEqual(result.stdout.trim(), '', 'runtime diagnostics should emit JSON');
  const parsed = JSON.parse(result.stdout);
  assert.equal(typeof parsed.available, 'boolean');
  assert.equal(typeof parsed.platform, 'string');
  assert.equal(typeof parsed.selected_runtime, 'object');
  assert.equal(typeof parsed.selected_runtime.summary, 'string');
}

for (const schemaName of [
  'feature_identity.schema.json',
  'bottleneck_candidates.schema.json',
  'fix_options.schema.json',
  'verification_plan.schema.json',
]) {
  const schemaPath = resolve(ROOT, 'schemas', schemaName);
  const parsed = JSON.parse(readFileSync(schemaPath, 'utf8'));
  assert.equal(typeof parsed.title, 'string', `${schemaName} should have a title`);
}

console.log('CLI contract tests passed');
