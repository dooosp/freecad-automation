import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { createBootstrapImportService } from '../src/services/import/bootstrap-import-service.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'fcad-bootstrap-import-'));

try {
  const fixtureModelPath = join(tempRoot, 'fixtures', 'simple_bracket.step');
  mkdirSync(join(tempRoot, 'fixtures'), { recursive: true });
  writeFileSync(fixtureModelPath, 'simple bracket STEP fixture\n');

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
}

console.log('bootstrap-import-service.test.js: ok');
