import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';

import { validateArtifactManifest } from '../lib/artifact-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const TMP_BASE = join(ROOT, 'tmp', 'codex');
mkdirSync(TMP_BASE, { recursive: true });
const TMP_DIR = mkdtempSync(join(TMP_BASE, 'fcad-stdout-manifest-cli-'));
const fixtureName = basename(TMP_DIR);
const outputManifestPath = join(ROOT, 'output', `${fixtureName}_manifest.json`);

try {
  const manifestPath = join(TMP_DIR, 'dfm-manifest.json');
  // --manifest-out controls the artifact manifest; DFM also emits a default
  // output manifest, so both the config basename and cleanup must be isolated.
  const configPath = join(TMP_DIR, `${fixtureName}.toml`);
  writeFileSync(configPath, readFileSync(join(ROOT, 'configs', 'examples', 'ks_bracket.toml'), 'utf8'), 'utf8');
  const result = spawnSync(process.execPath, [
    CLI,
    'dfm',
    configPath,
    '--manifest-out',
    manifestPath,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, null, result.stderr || result.stdout);
  assert.equal(existsSync(manifestPath), true, `Expected manifest at ${manifestPath}`);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const validation = validateArtifactManifest(manifest);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(manifest.manifest_version, '1.0');
  assert.equal(manifest.command, 'dfm');
  assert.equal(['succeeded', 'failed'].includes(manifest.status), true);
  assert.equal(
    manifest.artifacts.some((artifact) => artifact.type === 'config.input' && artifact.path === configPath),
    true
  );
  assert.match(result.stdout, /Manifest: /);

  console.log('stdout-manifest-cli.test.js: ok');
} finally {
  rmSync(outputManifestPath, { force: true });
  rmSync(TMP_DIR, { recursive: true, force: true });
}
