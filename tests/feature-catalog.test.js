import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { loadConfigWithDiagnostics } from '../lib/config-schema.js';
import {
  buildFeatureCatalog,
  validateFeatureCatalog,
  writeFeatureCatalog,
} from '../lib/feature-catalog.js';

const ROOT = resolve(import.meta.dirname, '..');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-feature-catalog-'));

async function buildFixtureCatalog(fixtureName) {
  const configPath = resolve(ROOT, 'configs', 'examples', `${fixtureName}.toml`);
  const { config } = await loadConfigWithDiagnostics(configPath);
  const catalog = buildFeatureCatalog({
    config,
    configPath,
    relatedArtifact: join(TMP_DIR, `${fixtureName}_report.pdf`),
    generatedAt: '2026-04-21T00:00:00.000Z',
  });
  const validation = validateFeatureCatalog(catalog);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  const outputPath = join(TMP_DIR, `${fixtureName}_feature_catalog.json`);
  await writeFeatureCatalog(outputPath, catalog);
  assert.equal(existsSync(outputPath), true);
  return JSON.parse(readFileSync(outputPath, 'utf8'));
}

try {
  const qualityPass = await buildFixtureCatalog('quality_pass_bracket');
  assert.equal(qualityPass.artifact_type, 'feature_catalog');
  assert.equal(qualityPass.recognition_policy, 'conservative_config_evidence_only');
  assert.equal(qualityPass.features.filter((feature) => feature.type === 'hole').length, 2);
  assert.equal(qualityPass.features.some((feature) => feature.type === 'hole_pattern'), false);
  assert.equal(qualityPass.features.some((feature) => feature.type === 'slot'), false);
  assert.equal(qualityPass.features.some((feature) => feature.type === 'chamfer'), true);
  assert.equal(qualityPass.features.find((feature) => feature.feature_id === 'hole_left')?.critical, true);
  assert.equal(qualityPass.features.find((feature) => feature.feature_id === 'hole_left')?.dimensions.diameter_mm, 6);
  assert.equal(qualityPass.summary.unknown_features, 0);

  const ks = await buildFixtureCatalog('ks_bracket');
  assert.equal(ks.features.filter((feature) => feature.type === 'hole').length, 4);
  const pattern = ks.features.find((feature) => feature.type === 'hole_pattern');
  assert.ok(pattern, 'expected conservative same-radius hole pattern');
  assert.equal(pattern.dimensions.count, 4);
  assert.equal(pattern.dimensions.diameter_mm, 9);
  assert.equal(pattern.dimensions.spacing_x_mm, 60);
  assert.equal(pattern.dimensions.spacing_y_mm, 40);
  assert.equal(ks.features.some((feature) => feature.type === 'fillet'), true);
  assert.equal(ks.features.some((feature) => feature.type === 'slot'), false);
  assert.ok(
    ks.features.some((feature) => feature.type === 'unknown_cut_feature' && feature.feature_id === 'v_groove'),
    'v_groove should stay unclassified instead of being speculated as a slot'
  );
  assert.ok(ks.summary.unknown_features >= 1);
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}

console.log('feature-catalog.test.js: ok');
