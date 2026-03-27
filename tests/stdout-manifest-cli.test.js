import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { validateArtifactManifest } from '../lib/artifact-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-stdout-manifest-cli-'));

try {
  const manifestPath = join(TMP_DIR, 'dfm-manifest.json');
  const result = spawnSync('node', [
    CLI,
    'dfm',
    'configs/examples/ks_bracket.toml',
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
    manifest.artifacts.some((artifact) => artifact.type === 'config.input' && artifact.path.endsWith('ks_bracket.toml')),
    true
  );
  assert.match(result.stdout, /Manifest: /);

  console.log('stdout-manifest-cli.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}
