import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { loadConfigWithDiagnostics } from '../lib/config-schema.js';

import {
  buildOutputManifest,
  createOutputManifestPath,
  validateOutputManifest,
  writeOutputManifest,
} from '../lib/output-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-output-manifest-'));
const COMPLETE_RECIPES = [
  { kind: 'create-v1' },
  { kind: 'draw-service-v1', standard: 'KS', dxf_export: false, preset: null, weights_preset: null, postprocess: true, qa: true },
  {
    kind: 'draw-pipeline-v1', bom: true, no_plan: false, plan_status: 'applied', standard: 'KS',
    weights_preset: 'bracket', raw: false, no_score: false, fail_under: null, override: true,
    unsupported_flags: [], working_directory: ROOT,
  },
];

try {
  const inputPath = join(TMP_DIR, 'sample-config.toml');
  const outputPath = join(TMP_DIR, 'sample.step');
  const missingPath = join(TMP_DIR, 'missing.json');
  const runLogPath = join(TMP_DIR, 'sample_run_log.json');
  const plannerPath = join(TMP_DIR, 'sample_drawing_planner.json');
  const featureCatalogPath = join(TMP_DIR, 'sample_feature_catalog.json');
  const extractedSemanticsPath = join(TMP_DIR, 'sample_extracted_drawing_semantics.json');
  const reviewerFeedbackPath = join(TMP_DIR, 'reviewer_feedback.json');

  writeFileSync(inputPath, 'name = "sample"\n', 'utf8');
  writeFileSync(outputPath, 'STEP', 'utf8');
  writeFileSync(runLogPath, JSON.stringify({ ok: true }, null, 2), 'utf8');
  writeFileSync(plannerPath, JSON.stringify({ status: 'advisory' }, null, 2), 'utf8');
  writeFileSync(featureCatalogPath, JSON.stringify({ artifact_type: 'feature_catalog' }, null, 2), 'utf8');
  writeFileSync(extractedSemanticsPath, JSON.stringify({ artifact_type: 'extracted_drawing_semantics' }, null, 2), 'utf8');
  writeFileSync(reviewerFeedbackPath, JSON.stringify({ schema_version: '0.1', items: [] }, null, 2), 'utf8');

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
      reviewer_feedback_json: reviewerFeedbackPath,
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
  assert.equal(manifest.linked_artifacts.reviewer_feedback_json, reviewerFeedbackPath);
  assert.equal(manifest.repo.branch, 'feat/output-manifest-foundation');
  assert.equal(manifest.timings.duration_ms, 2000);
  assert.equal(typeof manifest.runtime.freecad_executable_detected, 'boolean');
  assert.equal(typeof manifest.runtime.freecad_probe_status, 'string');
  assert.equal(typeof manifest.runtime.freecad_status, 'string');
  assert.equal(Object.hasOwn(manifest, 'effective_input'), false, 'legacy manifest shape remains unchanged');

  await test('config receipt binds the same text that was parsed even if the file changes during warnings', async () => {
    const receiptPath = join(TMP_DIR, 'receipt.json');
    const originalText = JSON.stringify({
      name: 'receipt_한글',
      shapes: [{ id: 'plate', type: 'box', length: 20, width: 10, height: 8 }],
    }, null, 2);
    writeFileSync(receiptPath, originalText, 'utf8');
    let changed = false;
    const loaded = await loadConfigWithDiagnostics(relative(ROOT, receiptPath), {
      onWarning: () => {
        changed = true;
        writeFileSync(receiptPath, '{"name":"replacement"}', 'utf8');
      },
    });
    assert.equal(changed, true, 'the test must replace the file after the loader parsed it');
    assert.equal(loaded.config.name, 'receipt_한글');
    assert.deepEqual(loaded.input_record, {
      path: receiptPath,
      sha256: createHash('sha256').update(originalText, 'utf8').digest('hex'),
      size_bytes: Buffer.byteLength(originalText, 'utf8'),
    });
  });

  await test('manifest retains the consumed input receipt after the original file changes', async () => {
    const receipt = structuredClone(manifest.input);
    writeFileSync(inputPath, 'name = "replacement-after-consumption"\n', 'utf8');
    const consumed = await buildOutputManifest({
      projectRoot: ROOT, command: 'create', inputPath, inputRecord: receipt,
      runtimeDiagnostics: { available: false },
    });
    assert.deepEqual(consumed.input, receipt);
    receipt.sha256 = 'caller-mutation';
    assert.equal(consumed.input.sha256, manifest.input.sha256, 'manifest owns its receipt snapshot');
  });

  await test('effective input recipe and source receipts are validated and copied additively', async () => {
    const effectiveInput = {
      schema_version: '1.0',
      authored_config_kind: 'drawing.authored-config-json',
      runtime_config_kind: 'drawing.effective-config-json',
      sources: [{ role: 'config', ...manifest.input }],
      recipe: structuredClone(COMPLETE_RECIPES[2]),
    };
    const bound = await buildOutputManifest({
      projectRoot: ROOT, command: 'draw', inputPath,
      effectiveInput, runtimeDiagnostics: { available: false },
    });
    assert.deepEqual(bound.effective_input, effectiveInput);
    assert.equal(validateOutputManifest(bound).ok, true);
    effectiveInput.recipe.bom = false;
    effectiveInput.sources[0].sha256 = 'caller-mutation';
    assert.equal(bound.effective_input.recipe.bom, true);
    assert.equal(bound.effective_input.sources[0].sha256, manifest.input.sha256);
    assert.equal(validateOutputManifest({ ...bound, effective_input: { ...bound.effective_input, extra: true } }).ok, false);
    assert.equal(validateOutputManifest({ ...bound, effective_input: { ...bound.effective_input, sources: [{ role: 'config' }] } }).ok, false);
    assert.equal(validateOutputManifest({ ...bound, effective_input: { ...bound.effective_input, recipe: {} } }).ok, false);
    assert.equal(validateOutputManifest({ ...bound, effective_input: { ...bound.effective_input, runtime_config_kind: undefined } }).ok, false);
    await assert.rejects(buildOutputManifest({
      projectRoot: ROOT, command: 'create', inputRecord: { path: inputPath },
      runtimeDiagnostics: { available: false },
    }), /inputRecord\.sha256 is required/);

    const proof = await buildOutputManifest({
      projectRoot: ROOT, command: 'draw', inputPath,
      inputRecord: manifest.input,
      effectiveInput: {
        ...bound.effective_input,
        recipe: { ...bound.effective_input.recipe, working_directory: TMP_DIR },
      },
      effectivePolicy: { proof_lineage: true }, portablePathRoot: TMP_DIR,
      runtimeDiagnostics: { available: false },
    });
    assert.equal(proof.effective_input.sources[0].path, proof.input.path);
    assert.equal(proof.effective_input.sources[0].sha256, manifest.input.sha256);
    assert.equal(proof.effective_input.recipe.working_directory, 'run/root');
    assert.ok(!JSON.stringify(proof).includes(TMP_DIR));
    assert.ok(!JSON.stringify(proof).includes(ROOT));
  });

  await test('effective recipe kinds require complete typed producer metadata', async (t) => {
    const withRecipe = (recipe) => ({
      ...manifest,
      effective_input: {
        schema_version: '1.0', authored_config_kind: 'drawing.authored-config-json',
        runtime_config_kind: 'drawing.effective-config-json', sources: [{ role: 'config', ...manifest.input }], recipe,
      },
    });
    for (const recipe of COMPLETE_RECIPES) {
      await t.test(`${recipe.kind} accepts its complete emitted shape`, () => {
        const validation = validateOutputManifest(withRecipe(recipe));
        assert.equal(validation.ok, true, validation.errors.join('\n'));
      });
      for (const key of Object.keys(recipe)) {
        await t.test(`${recipe.kind} rejects missing ${key}`, () => {
          const incomplete = structuredClone(recipe); delete incomplete[key];
          assert.equal(validateOutputManifest(withRecipe(incomplete)).ok, false);
        });
      }
      for (const key of Object.keys(recipe).filter((key) => typeof recipe[key] === 'boolean')) {
        for (const wrongValue of ['false', 0, null]) {
          await t.test(`${recipe.kind} rejects ${key}=${JSON.stringify(wrongValue)}`, () => {
            assert.equal(validateOutputManifest(withRecipe({ ...recipe, [key]: wrongValue })).ok, false);
          });
        }
      }
      await t.test(`${recipe.kind} rejects undeclared options`, () => {
        assert.equal(validateOutputManifest(withRecipe({ ...recipe, unrecorded_option: true })).ok, false);
      });
    }
    for (const [key, wrongValue] of [
      ['standard', ''], ['standard', null], ['working_directory', ''], ['working_directory', {}],
      ['plan_status', 'unknown'], ['weights_preset', ''], ['weights_preset', false],
      ['unsupported_flags', '--raw'], ['unsupported_flags', [false]], ['fail_under', false],
    ]) {
      await t.test(`pipeline recipe rejects ${key}=${JSON.stringify(wrongValue)}`, () => {
        assert.equal(validateOutputManifest(withRecipe({ ...COMPLETE_RECIPES[2], [key]: wrongValue })).ok, false);
      });
    }
    for (const wrongValue of ['', false, 0]) {
      await t.test(`service recipe rejects preset=${JSON.stringify(wrongValue)}`, () => {
        assert.equal(validateOutputManifest(withRecipe({ ...COMPLETE_RECIPES[1], preset: wrongValue })).ok, false);
      });
    }
    for (const failUnder of [null, '90', 90]) {
      await t.test(`pipeline recipe accepts existing fail_under=${JSON.stringify(failUnder)}`, () => {
        assert.equal(validateOutputManifest(withRecipe({ ...COMPLETE_RECIPES[2], fail_under: failUnder })).ok, true);
      });
    }
    await t.test('manifest without effective_input keeps the legacy contract', () => {
      assert.equal(validateOutputManifest(manifest).ok, true);
      assert.equal(Object.hasOwn(manifest, 'effective_input'), false);
    });
  });

  const probeFailedManifest = await buildOutputManifest({
    projectRoot: ROOT,
    repoContext: {
      root: ROOT,
      branch: 'feat/output-manifest-foundation',
      headSha: 'abc123',
      dirtyAtStart: false,
    },
    command: 'inspect',
    inputPath,
    outputs: [{ path: outputPath, kind: 'model.step' }],
    status: 'warning',
    runtimeDiagnostics: {
      status: 'runtime_probe_failed',
      available: false,
      executable_detected: true,
      probe_status: 'failed',
      version_details: {
        freecad: {
          version: '1.1.1',
        },
      },
    },
  });
  assert.equal(probeFailedManifest.runtime.freecad_available, false);
  assert.equal(probeFailedManifest.runtime.freecad_executable_detected, true);
  assert.equal(probeFailedManifest.runtime.freecad_probe_status, 'failed');
  assert.equal(probeFailedManifest.runtime.freecad_status, 'runtime_probe_failed');
  assert.equal(probeFailedManifest.runtime.freecad_version, '1.1.1');

  const detachedInputBytes = Buffer.from('detached-input\n');
  const detachedOutputBytes = Buffer.from('detached-output\n');
  const detachedInputPath = join(TMP_DIR, 'not-published-input.json');
  const detachedOutputPath = join(TMP_DIR, 'not-yet-published-output.json');
  const detachedInputRecord = {
    path: detachedInputPath,
    sha256: createHash('sha256').update(detachedInputBytes).digest('hex'),
    size_bytes: detachedInputBytes.length,
  };
  const detachedOutputRecords = [{
    path: detachedOutputPath,
    kind: 'manufacturing.action-dictionary',
    exists: true,
    size_bytes: detachedOutputBytes.length,
    sha256: createHash('sha256').update(detachedOutputBytes).digest('hex'),
  }];
  const precomputedManifest = await buildOutputManifest({
    projectRoot: ROOT,
    repoContext: {
      root: ROOT,
      branch: 'codex/manufacturing-action-data-contract-v1',
      headSha: 'def456',
      dirtyAtStart: false,
    },
    command: 'manufacturing-action-dataset',
    inputPath: detachedInputPath,
    inputRecord: detachedInputRecord,
    outputs: [{ path: detachedOutputPath, kind: 'manufacturing.action-dictionary' }],
    outputRecords: detachedOutputRecords,
    status: 'pass',
    runtimeDiagnostics: {
      status: 'not_invoked',
      available: false,
      executable_detected: false,
      probe_status: 'not_invoked',
      version_details: { freecad: { version: null } },
    },
  });
  assert.deepEqual(precomputedManifest.input, detachedInputRecord);
  assert.deepEqual(precomputedManifest.outputs, detachedOutputRecords);

  await assert.rejects(
    () => buildOutputManifest({
      projectRoot: ROOT,
      command: 'manufacturing-action-dataset',
      inputRecord: { ...detachedInputRecord, unexpected: true },
      outputRecords: detachedOutputRecords,
    }),
    /inputRecord\.unexpected is not supported/
  );
  await assert.rejects(
    () => buildOutputManifest({
      projectRoot: ROOT,
      command: 'manufacturing-action-dataset',
      inputRecord: detachedInputRecord,
      outputRecords: [{ ...detachedOutputRecords[0], sha256: 'not-a-digest' }],
    }),
    /lowercase SHA-256/
  );
  await assert.rejects(
    () => buildOutputManifest({
      projectRoot: ROOT,
      command: 'manufacturing-action-dataset',
      outputs: [{ path: join(TMP_DIR, 'different.json'), kind: detachedOutputRecords[0].kind }],
      outputRecords: detachedOutputRecords,
    }),
    /must match the declared output path and kind/
  );

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
