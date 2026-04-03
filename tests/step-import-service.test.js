import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  analyzeStep,
  createStepImportService,
} from '../src/services/import/step-import-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'imports');
const tempRoot = mkdtempSync(join(tmpdir(), 'fcad-step-import-'));

try {
  const fcstdAnalysis = await analyzeStep(tempRoot, async (scriptName, input) => {
    assert.equal(scriptName, 'inspect_model.py');
    assert.equal(input.file.endsWith('.fcstd'), true);
    return {
      model: {
        volume: 1250,
        area: 420,
        faces: 12,
        edges: 34,
        bounding_box: {
          size: [40, 20, 8],
        },
      },
    };
  }, join(FIXTURES, 'small_assembly.fcstd'));

  assert.equal(fcstdAnalysis.format, 'fcstd');
  assert.equal(fcstdAnalysis.import_diagnostics.format, 'fcstd');
  assert.equal(fcstdAnalysis.import_diagnostics.fail_closed, false);
  assert.equal(fcstdAnalysis.import_diagnostics.part_vs_assembly.body_count, 0);
  assert.equal(fcstdAnalysis.bootstrap_warnings.length >= 2, true);
  assert.equal(fcstdAnalysis.confidence_map.feature_extraction.level, 'low');

  await assert.rejects(
    analyzeStep(tempRoot, async () => ({}), join(FIXTURES, 'unsupported.txt')),
    /Unsupported import file format/
  );

  const importService = createStepImportService({
    analyzeStepFn: async (_freecadRoot, _runScript, modelFilePath) => ({
      success: true,
      source_step: modelFilePath,
      suggested_config: {
        name: 'fixture_import',
        import: { source_step: modelFilePath, template_only: true },
        export: { step: true, stl: true },
        drawing: { scale: 'auto', title: 'Fixture import' },
        manufacturing: { process: 'machining' },
      },
      import_diagnostics: {
        source_model: modelFilePath,
        format: 'step',
        import_kind: 'assembly',
        body_count: 3,
        conditions: {
          empty_import: false,
          partial_import: true,
          unsupported_import: false,
          unstable_import: false,
        },
        fail_closed: false,
        confidence: {
          level: 'medium',
          score: 0.62,
          rationale: 'Fixture contract test.',
        },
      },
      bootstrap_summary: {
        review_gate: {
          status: 'review_required',
          reason: 'warnings_present',
        },
      },
      bootstrap_warnings: ['Assembly import needs human confirmation.'],
      confidence_map: {
        overall: {
          level: 'medium',
          score: 0.62,
          rationale: 'Fixture contract test.',
        },
      },
    }),
  });

  const imported = await importService({
    freecadRoot: tempRoot,
    runScript: async () => ({}),
    filePath: join(FIXTURES, 'small_assembly.step'),
  });

  assert.equal(imported.success, true);
  assert.equal(imported.importDiagnostics.import_kind, 'assembly');
  assert.equal(imported.importDiagnostics.conditions.partial_import, true);
  assert.deepEqual(imported.bootstrapWarnings, ['Assembly import needs human confirmation.']);
  assert.equal(imported.bootstrapSummary.review_gate.status, 'review_required');
  assert.equal(imported.confidenceMap.overall.level, 'medium');
  assert.equal(imported.configPath, 'configs/imports/small_assembly.toml');

  const copiedModel = readFileSync(imported.modelFile, 'utf8');
  assert.match(copiedModel, /small assembly STEP fixture/);
  const configText = readFileSync(join(tempRoot, imported.configPath), 'utf8');
  assert.match(configText, /name = "fixture_import"/);
  assert.match(configText, /\[import\]/);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('step-import-service.test.js: ok');
