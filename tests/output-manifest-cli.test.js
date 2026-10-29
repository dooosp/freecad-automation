import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';

import { validateOutputManifest } from '../lib/output-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const TMP_BASE = join(ROOT, 'tmp', 'codex');
mkdirSync(TMP_BASE, { recursive: true });
const TMP_DIR = mkdtempSync(join(TMP_BASE, 'fcad-output-manifest-cli-'));
const fixtureName = basename(TMP_DIR);
// DFM's additive manifest defaults to output/<config-basename>_manifest.json.
// A unique config basename keeps that default-path check away from user output.
const manifestPath = join(ROOT, 'output', `${fixtureName}_manifest.json`);

try {
  const sourceConfigPath = join(ROOT, 'configs', 'examples', 'ks_bracket.toml');
  const configPath = join(TMP_DIR, `${fixtureName}.toml`);
  const configContent = readFileSync(sourceConfigPath, 'utf8');
  writeFileSync(configPath, configContent, 'utf8');

  const result = spawnSync(process.execPath, [
    CLI,
    'dfm',
    configPath,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, null, result.stderr || result.stdout);

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
  rmSync(manifestPath, { force: true });
  rmSync(TMP_DIR, { recursive: true, force: true });
}
