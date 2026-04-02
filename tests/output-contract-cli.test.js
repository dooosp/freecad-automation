import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { validateArtifactManifest } from '../lib/artifact-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-output-contract-cli-'));

function writeAlignedConfig(filePath, {
  templatePath = join(ROOT, 'configs', 'examples', 'controller_housing_eol.toml'),
  name,
  revision,
} = {}) {
  const template = readFileSync(templatePath, 'utf8');
  const next = template
    .replace(/^name = ".*"$/m, `name = "${name}"`)
    .replace(/^revision = ".*"$/m, `revision = "${revision}"`);
  writeFileSync(filePath, next, 'utf8');
}

try {
  const outDir = join(TMP_DIR, 'standard-docs');
  const alignedConfigPath = join(TMP_DIR, 'sample_part_docs.toml');
  writeAlignedConfig(alignedConfigPath, {
    name: 'sample_part',
    revision: 'A',
  });
  const result = spawnSync('node', [
    CLI,
    'generate-standard-docs',
    alignedConfigPath,
    '--review-pack',
    'tests/fixtures/d-artifacts/sample_review_pack.canonical.json',
    '--profile',
    'site_korea_ulsan',
    '--out-dir',
    outDir,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const manifestPath = join(outDir, 'artifact-manifest.json');
  assert.equal(existsSync(manifestPath), true, `Expected manifest at ${manifestPath}`);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const validation = validateArtifactManifest(manifest);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(manifest.manifest_version, '1.0');
  assert.equal(manifest.command, 'generate-standard-docs');
  assert.equal(manifest.selected_profile, 'site_korea_ulsan');
  assert.equal(
    manifest.artifacts.some((artifact) => artifact.type === 'standard-docs.process_flow.md'),
    true
  );
  assert.equal(
    manifest.artifacts.some((artifact) => artifact.path.endsWith('standard_docs_manifest.json')),
    true
  );
  assert.equal(
    manifest.artifacts.some((artifact) => artifact.type === 'input.review-pack'),
    true,
    'manifest should record review-pack provenance for review-pack-backed docs generation'
  );

  console.log('output-contract-cli.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}
