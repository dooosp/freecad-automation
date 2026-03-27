import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { loadConfigWithDiagnostics } from '../lib/config-schema.js';
import { validateArtifactManifest } from '../lib/artifact-manifest.js';
import { runSweep } from '../src/services/sweep/sweep-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-sweep-manifest-'));

try {
  const configPath = join(ROOT, 'configs', 'examples', 'ks_bracket.toml');
  const matrixPath = join(TMP_DIR, 'cost-only-sweep.toml');
  const outputDir = join(TMP_DIR, 'sweep-output');

  writeFileSync(matrixPath, `
name = "cost_only_contract"
jobs = ["cost"]

[execution]
profile = "site_korea_ulsan"
material = "SS304"
process = "machining"
batch_size = 10

[parameters]
"shapes[0].height" = { values = [6, 8] }
`, 'utf8');

  const result = await runSweep({
    projectRoot: ROOT,
    configPath,
    matrixPath,
    outputDir,
    loadConfig: async (filepath) => (await loadConfigWithDiagnostics(filepath)).config,
  });

  const aggregateManifest = JSON.parse(readFileSync(result.manifest_path, 'utf8'));
  const aggregateValidation = validateArtifactManifest(aggregateManifest);
  assert.equal(aggregateValidation.ok, true, aggregateValidation.errors.join('\n'));
  assert.equal(aggregateManifest.manifest_version, '1.0');
  assert.equal(aggregateManifest.status, 'succeeded');
  assert.equal(
    aggregateManifest.artifacts.some((artifact) => artifact.type === 'sweep.summary.json'),
    true
  );

  assert.equal(result.variants.length, 2);
  for (const variant of result.variants) {
    assert.equal(typeof variant.manifest_path, 'string');
    const variantManifest = JSON.parse(readFileSync(variant.manifest_path, 'utf8'));
    const variantValidation = validateArtifactManifest(variantManifest);
    assert.equal(variantValidation.ok, true, variantValidation.errors.join('\n'));
    assert.equal(variantManifest.manifest_version, '1.0');
    assert.equal(variantManifest.job_type, 'sweep_variant');
    assert.equal(
      variantManifest.artifacts.some((artifact) => artifact.type === 'sweep.variant.result'),
      true
    );
  }

  console.log('sweep-manifest.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}
