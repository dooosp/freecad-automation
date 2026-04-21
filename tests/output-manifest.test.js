import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildOutputManifest,
  createOutputManifestPath,
  validateOutputManifest,
  writeOutputManifest,
} from '../lib/output-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-output-manifest-'));

try {
  const inputPath = join(TMP_DIR, 'sample-config.toml');
  const outputPath = join(TMP_DIR, 'sample.step');
  const missingPath = join(TMP_DIR, 'missing.json');
  const runLogPath = join(TMP_DIR, 'sample_run_log.json');
  const plannerPath = join(TMP_DIR, 'sample_drawing_planner.json');
  const featureCatalogPath = join(TMP_DIR, 'sample_feature_catalog.json');
  const extractedSemanticsPath = join(TMP_DIR, 'sample_extracted_drawing_semantics.json');

  writeFileSync(inputPath, 'name = "sample"\n', 'utf8');
  writeFileSync(outputPath, 'STEP', 'utf8');
  writeFileSync(runLogPath, JSON.stringify({ ok: true }, null, 2), 'utf8');
  writeFileSync(plannerPath, JSON.stringify({ status: 'advisory' }, null, 2), 'utf8');
  writeFileSync(featureCatalogPath, JSON.stringify({ artifact_type: 'feature_catalog' }, null, 2), 'utf8');
  writeFileSync(extractedSemanticsPath, JSON.stringify({ artifact_type: 'extracted_drawing_semantics' }, null, 2), 'utf8');

  const manifest = await buildOutputManifest({
    projectRoot: ROOT,
    repoContext: {
      root: ROOT,
      branch: 'feat/output-manifest-foundation',
      headSha: 'abc123',
      dirtyAtStart: false,
    },
    command: 'create',
    commandArgs: ['configs/examples/sample.toml'],
    inputPath,
    outputs: [
      { path: outputPath, kind: 'model.step' },
      { path: missingPath, kind: 'draw.traceability' },
    ],
    linkedArtifacts: {
      run_log_json: runLogPath,
      planner_json: plannerPath,
      feature_catalog_json: featureCatalogPath,
      extracted_drawing_semantics_json: extractedSemanticsPath,
    },
    warnings: ['example warning'],
    status: 'warning',
    timings: {
      startedAt: '2026-04-20T00:00:00.000Z',
      finishedAt: '2026-04-20T00:00:02.000Z',
    },
  });

  const validation = validateOutputManifest(manifest);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(manifest.command, 'create');
  assert.equal(manifest.input.path, inputPath);
  assert.equal(typeof manifest.input.sha256, 'string');
  assert.equal(manifest.outputs[0].exists, true);
  assert.equal(typeof manifest.outputs[0].sha256, 'string');
  assert.equal(manifest.outputs[1].exists, false);
  assert.equal(manifest.outputs[1].sha256, null);
  assert.equal(manifest.linked_artifacts.run_log_json, runLogPath);
  assert.equal(manifest.linked_artifacts.planner_json, plannerPath);
  assert.equal(manifest.linked_artifacts.feature_catalog_json, featureCatalogPath);
  assert.equal(manifest.linked_artifacts.extracted_drawing_semantics_json, extractedSemanticsPath);
  assert.equal(manifest.repo.branch, 'feat/output-manifest-foundation');
  assert.equal(manifest.timings.duration_ms, 2000);

  const derivedPath = createOutputManifestPath({
    primaryOutputPath: outputPath,
  });
  assert.equal(derivedPath, join(TMP_DIR, 'sample_manifest.json'));

  const defaultDerivedPath = createOutputManifestPath({
    inputPath,
  });
  assert.equal(defaultDerivedPath, resolve(ROOT, 'output', 'sample-config_manifest.json'));

  const smokeInputPath = resolve(ROOT, 'output', 'smoke', 'run-123', 'configs', 'sample.toml');
  const smokeDerivedPath = createOutputManifestPath({
    inputPath: smokeInputPath,
  });
  assert.equal(smokeDerivedPath, resolve(ROOT, 'output', 'smoke', 'run-123', 'sample_manifest.json'));

  const manifestPath = join(TMP_DIR, 'sample_manifest.json');
  await writeOutputManifest(manifestPath, manifest);
  const persisted = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(persisted.outputs[0].path, outputPath);

  console.log('output-manifest.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}
