import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { validateOutputManifest } from '../lib/output-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-output-manifest-cli-'));

try {
  const sourceConfigPath = join(ROOT, 'configs', 'examples', 'ks_bracket.toml');
  const configPath = join(TMP_DIR, 'ks_bracket.toml');
  const configContent = readFileSync(sourceConfigPath, 'utf8');
  writeFileSync(configPath, configContent, 'utf8');

  const result = spawnSync('node', [
    CLI,
    'dfm',
    configPath,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, null, result.stderr || result.stdout);

  const manifestPath = join(TMP_DIR, 'ks_bracket_manifest.json');
  assert.equal(existsSync(manifestPath), true, `Expected output manifest at ${manifestPath}`);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const validation = validateOutputManifest(manifest);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(manifest.command, 'dfm');
  assert.equal(manifest.input.path, configPath);
  assert.equal(Array.isArray(manifest.outputs), true);
  assert.match(result.stdout, /DFM Analysis:/);

  console.log('output-manifest-cli.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}
