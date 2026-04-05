import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildImportBootstrapOptions } from '../public/js/studio/import-bootstrap-options.js';
import { runReviewContextPipeline } from '../src/orchestration/review-context-pipeline.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'fcad-review-context-bootstrap-'));

function buildStubRunPythonJsonScript(rootDir) {
  return async (_projectRoot, scriptRelativePath) => {
    if (scriptRelativePath.endsWith('analyze_part.py')) {
      return {
        geometry_intelligence: {
          generated_at: '2026-04-03T00:00:00Z',
          confidence: {
            level: 'medium',
            score: 0.55,
            rationale: 'Stub geometry confidence.',
          },
          derived_features: [],
          metrics: {
            bounding_box_mm: {
              x: 10,
              y: 5,
              z: 2,
            },
          },
          features: {
            hole_like_feature_count: 0,
            hole_pattern_count: 0,
            repeated_feature_count: 0,
            complexity_score: 0.2,
          },
          warnings: [],
        },
        manufacturing_hotspots: {
          confidence: {
            level: 'low',
            score: 0.3,
            rationale: 'Stub hotspot confidence.',
          },
          hotspots: [],
          warnings: [],
        },
      };
    }

    if (scriptRelativePath.endsWith('quality_link.py')) {
      return {
        inspection_linkage: [],
        inspection_outliers: [],
        quality_linkage: [],
        quality_hotspots: [],
        review_priorities: [],
      };
    }

    if (scriptRelativePath.endsWith('scripts/reporting/review_pack.py')) {
      const jsonPath = join(rootDir, 'stub_review_pack.json');
      const markdownPath = join(rootDir, 'stub_review_pack.md');
      const pdfPath = join(rootDir, 'stub_review_pack.pdf');
      writeFileSync(jsonPath, JSON.stringify({ ok: true }, null, 2));
      writeFileSync(markdownPath, '# Stub review pack\n');
      writeFileSync(pdfPath, 'stub pdf');
      return {
        summary: {
          confidence: {
            level: 'heuristic',
            score: 0.7,
            rationale: 'Stub review-pack confidence.',
          },
          warnings: [],
        },
        artifacts: {
          json: jsonPath,
          markdown: markdownPath,
          pdf: pdfPath,
        },
      };
    }

    throw new Error(`Unexpected script stub request: ${scriptRelativePath}`);
  };
}

try {
  const contextPath = join(tempRoot, 'context.json');
  const outputDir = join(tempRoot, 'artifacts');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(contextPath, JSON.stringify({
    metadata: {
      created_at: '2026-04-03T00:00:00Z',
      warnings: [],
    },
    part: {
      name: 'legacy-confidence-part',
    },
    geometry_source: {
      path: 'tests/fixtures/imports/simple_bracket.step',
      file_type: 'step',
      bootstrap: {
        draft_config_path: 'output/imports/bootstrap-session-seed/artifacts/bootstrap_draft_config.toml',
        preview_source: 'import-bootstrap-preview',
      },
      model_metadata: {
        bounding_box: {
          size: [10, 5, 2],
        },
      },
      feature_hints: {
        cylinders: [],
        bolt_circles: [],
      },
      import_diagnostics: {
        import_kind: 'part',
        body_count: 1,
        unit_assumption: {
          unit: 'mm',
          assumed: true,
          rationale: 'Legacy confidence compatibility test.',
        },
      },
    },
  }, null, 2));

  const result = await runReviewContextPipeline({
    projectRoot: tempRoot,
    contextPath,
    outputPath: join(outputDir, 'review_pack.json'),
    bootstrap: {
      confidence: {
        level: 'medium',
        score: 0.6,
        rationale: 'Legacy overall-only confidence payload.',
      },
    },
    runPythonJsonScript: buildStubRunPythonJsonScript(tempRoot),
    inspectModelIfAvailable: async () => null,
    detectStepFeaturesIfAvailable: async () => null,
  });

  const confidenceMap = JSON.parse(readFileSync(result.artifacts.confidenceMap, 'utf8'));
  assert.deepEqual(confidenceMap.import_bootstrap, {
    overall: {
      level: 'medium',
      score: 0.6,
      rationale: 'Legacy overall-only confidence payload.',
    },
  });

  const previewDraftConfigToml = [
    'name = "fixture_import"',
    '',
    '[import]',
    'source_step = "tests/fixtures/imports/simple_bracket.step"',
    'template_only = true',
    '',
  ].join('\n');
  const forwardedBootstrapOptions = buildImportBootstrapOptions({
    session_id: 'bootstrap-session-1',
    bootstrap: {
      import_diagnostics: {
        import_kind: 'part',
        body_count: 1,
        unit_assumption: {
          unit: 'mm',
          assumed: true,
          rationale: 'Weak fixture import requires review confirmation.',
        },
      },
      bootstrap_summary: {
        review_gate: {
          correction_required: true,
        },
      },
      bootstrap_warnings: {
        warnings: ['Fixture warning'],
      },
      confidence_map: {
        import_bootstrap: {
          overall: {
            level: 'low',
            score: 0.34,
            rationale: 'Preview parity fixture confidence.',
          },
        },
      },
      draft_config_toml: previewDraftConfigToml,
    },
  }, {});

  assert.equal(forwardedBootstrapOptions.bootstrap.draft_config_toml, previewDraftConfigToml);

  const parityResult = await runReviewContextPipeline({
    projectRoot: tempRoot,
    contextPath,
    outputPath: join(outputDir, 'review_pack_parity.json'),
    bootstrap: forwardedBootstrapOptions.bootstrap,
    runPythonJsonScript: buildStubRunPythonJsonScript(tempRoot),
    inspectModelIfAvailable: async () => null,
    detectStepFeaturesIfAvailable: async () => null,
  });

  assert.equal(readFileSync(parityResult.artifacts.draftConfig, 'utf8'), previewDraftConfigToml);
  const engineeringContext = JSON.parse(readFileSync(parityResult.artifacts.engineeringContext, 'utf8'));
  assert.deepEqual(engineeringContext.geometry_source.bootstrap, {
    draft_config_path: 'output/imports/bootstrap-session-seed/artifacts/bootstrap_draft_config.toml',
    preview_source: 'import-bootstrap-preview',
    draft_config_available: true,
  });
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('review-context-bootstrap.test.js: ok');
