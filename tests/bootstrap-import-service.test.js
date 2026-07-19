import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  createBootstrapImportService,
  MAX_BOOTSTRAP_UPLOAD_BYTES,
} from '../src/services/import/bootstrap-import-service.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'fcad-bootstrap-import-'));
const externalRoot = mkdtempSync(join(tmpdir(), 'fcad-bootstrap-import-external-'));

try {
  const fixtureModelPath = join(tempRoot, 'fixtures', 'simple_bracket.step');
  mkdirSync(join(tempRoot, 'fixtures'), { recursive: true });
  writeFileSync(fixtureModelPath, 'simple bracket STEP fixture\n');
  const externalModelPath = join(externalRoot, 'external.step');
  const externalSideInputPath = join(externalRoot, 'external.csv');
  const escapedModelPath = join(tempRoot, 'fixtures', 'escaped.step');
  const escapedSideInputPath = join(tempRoot, 'fixtures', 'escaped.csv');
  const insideSideInputPath = join(tempRoot, 'fixtures', 'inside.csv');
  const linkedModelPath = join(tempRoot, 'fixtures', 'linked.step');
  const linkedSideInputPath = join(tempRoot, 'fixtures', 'linked.csv');
  const unsafeUploadProjectRoot = join(tempRoot, 'unsafe-upload-project');
  const escapedUploadRoot = join(externalRoot, 'escaped-upload-output');
  writeFileSync(externalModelPath, 'external STEP fixture\n');
  writeFileSync(externalSideInputPath, 'external,fixture\n');
  writeFileSync(insideSideInputPath, 'inside,fixture\n');
  symlinkSync(externalModelPath, escapedModelPath);
  symlinkSync(externalSideInputPath, escapedSideInputPath);
  symlinkSync(fixtureModelPath, linkedModelPath);
  symlinkSync(insideSideInputPath, linkedSideInputPath);
  mkdirSync(unsafeUploadProjectRoot, { recursive: true });
  mkdirSync(escapedUploadRoot, { recursive: true });
  symlinkSync(escapedUploadRoot, join(unsafeUploadProjectRoot, 'output'));

  const service = createBootstrapImportService({
    analyzeModelFn: async () => ({
      success: true,
      fallback: true,
      source_step: fixtureModelPath,
      model_metadata: null,
      features: {
        cylinders: [],
        bolt_circles: [],
        fillets: [],
        chamfers: [],
      },
      import_diagnostics: {
        import_kind: 'part',
        body_count: 0,
        conditions: {
          empty_import: false,
          partial_import: true,
          unsupported_import: false,
          unstable_import: false,
        },
        unit_assumption: {
          unit: 'mm',
          assumed: true,
          rationale: 'Bootstrap fixture assumes millimeters.',
        },
      },
      bootstrap_warnings: [
        'Fixture kept metadata-only fallback visible.',
      ],
      confidence_map: {
        overall: {
          level: 'low',
          score: 0.34,
          rationale: 'Fixture low confidence.',
        },
      },
      suggested_config: {
        name: 'fixture_import',
        import: { source_step: fixtureModelPath, template_only: true },
        export: { step: true, stl: true },
        drawing: { scale: 'auto', title: 'Fixture import' },
        manufacturing: { process: 'machining' },
      },
    }),
    runPythonJsonScriptFn: async (_projectRoot, scriptRelativePath, payload) => {
      if (scriptRelativePath.endsWith('ingest_context.py')) {
        return {
          context: {
            part: {
              part_id: 'fixture_import',
              name: 'fixture_import',
              revision: null,
              material: null,
              process: null,
            },
            geometry_source: {
              path: payload.model,
              file_type: 'step',
              validated: true,
              model_metadata: payload.model_metadata,
              feature_hints: payload.feature_hints,
              import_diagnostics: {},
              bootstrap_summary: {},
              confidence_map: {},
              bootstrap_warnings: [],
            },
            bootstrap: {
              import_diagnostics: {},
              bootstrap_summary: {},
              confidence_map: {},
              warnings: [],
              draft_config_path: null,
            },
            bom: [],
            inspection_results: [],
            quality_issues: [],
            metadata: {
              created_at: '2026-04-03T00:00:00Z',
              warnings: [],
              source_files: [payload.model],
            },
          },
          ingest_log: {
            created_at: '2026-04-03T00:00:00Z',
            warnings: [],
            diagnostics: [],
            summary: {},
          },
        };
      }

      if (scriptRelativePath.endsWith('analyze_part.py')) {
        return {
          geometry_intelligence: {
            confidence: {
              level: 'low',
              score: 0.28,
              rationale: 'Fixture geometry confidence.',
            },
            derived_features: [],
            metrics: {
              bounding_box_mm: {
                x: 0,
                y: 0,
                z: 0,
              },
            },
            warnings: [],
          },
          manufacturing_hotspots: {
            confidence: {
              level: 'low',
              score: 0.24,
              rationale: 'Fixture hotspot confidence.',
            },
            hotspots: [],
            warnings: [],
          },
        };
      }

      throw new Error(`Unexpected script stub request: ${scriptRelativePath}`);
    },
  });

  let guardedAnalyzeModelCalls = 0;
  let guardedRuntimeCalls = 0;
  const guardedService = createBootstrapImportService({
    analyzeModelFn: async () => {
      guardedAnalyzeModelCalls += 1;
      return {};
    },
    runPythonJsonScriptFn: async () => {
      guardedRuntimeCalls += 1;
      throw new Error('Rejected path reached runtime analysis.');
    },
  });
  await assert.rejects(
    guardedService({
      projectRoot: unsafeUploadProjectRoot,
      runScript: async () => ({}),
      model: {
        name: 'escaped-upload.step',
        content_base64: Buffer.from('must not escape\n').toString('base64'),
      },
    }),
    /Bootstrap import directory must not use symbolic links/i
  );
  assert.deepEqual(readdirSync(escapedUploadRoot), []);
  await assert.rejects(
    guardedService({
      projectRoot: tempRoot,
      runScript: async () => ({}),
      model: { path: join(tempRoot, 'fixtures', 'missing.step') },
    }),
    /Imported model path is missing or unavailable/i
  );
  await assert.rejects(
    guardedService({
      projectRoot: tempRoot,
      runScript: async () => ({}),
      model: { path: join(tempRoot, 'fixtures') },
    }),
    /Imported model path must reference a regular file/i
  );
  await assert.rejects(
    guardedService({
      projectRoot: tempRoot,
      runScript: async () => ({}),
      model: { path: externalModelPath },
    }),
    /Imported model path must stay inside the project root/i
  );
  await assert.rejects(
    guardedService({
      projectRoot: tempRoot,
      runScript: async () => ({}),
      model: { path: join(externalRoot, 'missing.step') },
    }),
    /Imported model path must stay inside the project root/i
  );
  await assert.rejects(
    guardedService({
      projectRoot: tempRoot,
      runScript: async () => ({}),
      model: { path: escapedModelPath },
    }),
    /Imported model path must not use symbolic links/i
  );
  await assert.rejects(
    guardedService({
      projectRoot: tempRoot,
      runScript: async () => ({}),
      model: { path: linkedModelPath },
    }),
    /Imported model path must not use symbolic links/i
  );
  for (const fieldName of ['bom', 'inspection', 'quality']) {
    for (const path of [escapedSideInputPath, linkedSideInputPath]) {
      await assert.rejects(
        guardedService({
          projectRoot: tempRoot,
          runScript: async () => ({}),
          model: { path: fixtureModelPath },
          [fieldName]: { path },
        }),
        new RegExp(`${fieldName} path must not use symbolic links`, 'i')
      );
    }
  }
  assert.equal(guardedAnalyzeModelCalls, 0);
  assert.equal(guardedRuntimeCalls, 0);

  let oversizedAnalyzeModelCalls = 0;
  let oversizedRuntimeCalls = 0;
  const oversizedService = createBootstrapImportService({
    analyzeModelFn: async () => {
      oversizedAnalyzeModelCalls += 1;
      return {};
    },
    runPythonJsonScriptFn: async () => {
      oversizedRuntimeCalls += 1;
      throw new Error('Oversized upload reached runtime analysis.');
    },
  });
  const maxEncodedCharacters = Math.ceil(MAX_BOOTSTRAP_UPLOAD_BYTES / 3) * 4;
  let oversizedEncodedContent = Buffer.alloc(MAX_BOOTSTRAP_UPLOAD_BYTES + 2).toString('base64');
  assert.equal(oversizedEncodedContent.length > maxEncodedCharacters, true);
  await assert.rejects(
    oversizedService({
      projectRoot: tempRoot,
      runScript: async () => ({}),
      model: {
        name: 'oversized-encoded.step',
        content_base64: oversizedEncodedContent,
      },
    }),
    /Unsupported uploaded file size.*32 MiB/i
  );
  oversizedEncodedContent = null;

  let oversizedDecodedContent = Buffer.alloc(MAX_BOOTSTRAP_UPLOAD_BYTES + 1).toString('base64');
  assert.equal(oversizedDecodedContent.length, maxEncodedCharacters);
  await assert.rejects(
    oversizedService({
      projectRoot: tempRoot,
      runScript: async () => ({}),
      model: {
        name: 'oversized-decoded.step',
        content_base64: oversizedDecodedContent,
      },
    }),
    /Unsupported uploaded file size.*32 MiB/i
  );
  oversizedDecodedContent = null;

  await assert.rejects(
    oversizedService({
      projectRoot: tempRoot,
      runScript: async () => ({}),
      model: {
        name: 'malformed.step',
        content_base64: 'Zm9v$===',
      },
    }),
    /content must be valid base64/i
  );
  assert.equal(oversizedAnalyzeModelCalls, 0);
  assert.equal(oversizedRuntimeCalls, 0);

  const result = await service({
    projectRoot: tempRoot,
    runScript: async () => ({}),
    model: {
      path: fixtureModelPath,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(typeof result.bootstrap.draft_config_toml, 'string');
  assert.match(result.bootstrap.draft_config_toml, /source_step/);

  const uploadedContent = 'uploaded STEP fixture\n';
  const uploadedResult = await service({
    projectRoot: tempRoot,
    runScript: async () => ({}),
    model: {
      name: 'uploaded.step',
      content_base64: Buffer.from(uploadedContent).toString('base64'),
    },
  });
  assert.equal(uploadedResult.ok, true);
  assert.match(uploadedResult.source.model_path, /^output\/imports\/bootstrap-.*\/source\/uploaded\.step$/);
  assert.equal(readFileSync(resolve(tempRoot, uploadedResult.source.model_path), 'utf8'), uploadedContent);

  const engineeringContextArtifact = result.artifacts.find((artifact) => artifact.key === 'engineering_context');
  assert.ok(engineeringContextArtifact);
  const engineeringContext = JSON.parse(readFileSync(resolve(tempRoot, engineeringContextArtifact.path), 'utf8'));

  assert.equal(engineeringContext.bootstrap.bootstrap_summary.review_gate.correction_required, true);
  assert.equal(engineeringContext.bootstrap.confidence_map.import_bootstrap.overall.level, 'low');
  assert.match(engineeringContext.bootstrap.draft_config_path, /^output\/imports\/bootstrap-/);
  assert.equal(engineeringContext.geometry_source.bootstrap_summary.review_gate.ready_for_review_context, true);
  assert.equal(engineeringContext.geometry_source.confidence_map.import_bootstrap.overall.level, 'low');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
  rmSync(externalRoot, { recursive: true, force: true });
}

console.log('bootstrap-import-service.test.js: ok');
