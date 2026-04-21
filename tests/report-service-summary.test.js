import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createReportService } from '../src/services/report/report-service.js';

const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-report-summary-'));

try {
  const createQualityPath = join(TMP_DIR, 'service_probe_create_quality.json');
  const drawingQualityPath = join(TMP_DIR, 'service_probe_drawing_quality.json');
  const pdfPath = join(TMP_DIR, 'service_probe_report.pdf');

  writeFileSync(createQualityPath, `${JSON.stringify({
    status: 'fail',
    geometry: {
      valid_shape: false,
    },
    blocking_issues: ['Generated model shape is invalid.'],
    warnings: [],
  }, null, 2)}\n`, 'utf8');
  writeFileSync(drawingQualityPath, `${JSON.stringify({
    status: 'fail',
    score: 71,
    views: {
      overlap_count: 0,
    },
    dimensions: {
      missing_required_intents: ['HOLE_DIA'],
      conflict_count: 1,
    },
    traceability: {
      coverage_percent: 66.67,
    },
    blocking_issues: [
      { code: 'required-dimension-coverage', message: 'HOLE_DIA missing' },
      { code: 'dimension-conflicts', message: 'Dimension conflict count 1 exceeds the allowed maximum 0.' },
    ],
    warnings: [],
    recommended_actions: ['Add or map the missing required dimension intent(s): HOLE_DIA.'],
  }, null, 2)}\n`, 'utf8');

  let capturedPayload = null;

  const generateReport = createReportService({
    loadShopProfileFn: async () => null,
    loadRuleProfileFn: async () => null,
    getFreeCADRuntimeFn: () => ({
      mode: 'macos-bundle',
      available: true,
    }),
    readFileFn: async (filePath, encoding) => {
      if (encoding === 'utf8') {
        return readFileSync(filePath, 'utf8');
      }
      return Buffer.from('pdf-bytes');
    },
  });

  const result = await generateReport({
    freecadRoot: process.cwd(),
    runScript: async (script, payload) => {
      assert.equal(script, 'engineering_report.py');
      capturedPayload = payload;
      return {
        success: true,
        path: pdfPath,
        size_bytes: 1234,
      };
    },
    loadConfig: async () => ({
      name: 'service_probe',
      drawing_intent: {
        part_type: 'service_probe',
        required_views: ['top'],
        required_dimensions: [
          { id: 'HOLE_DIA', feature: 'hole1', required: true },
        ],
        missing_semantics_policy: 'advisory',
      },
      export: { directory: TMP_DIR },
    }),
    config: {
      name: 'service_probe',
      drawing_intent: {
        part_type: 'service_probe',
        required_views: ['top'],
        required_dimensions: [
          { id: 'HOLE_DIA', feature: 'hole1', required: true },
        ],
        missing_semantics_policy: 'advisory',
      },
      export: { directory: TMP_DIR },
    },
    includeDrawing: false,
    includeDfm: true,
    includeTolerance: false,
    includeCost: false,
    analysisResults: {
      dfm: {
        score: 64,
        issues: [
          {
            severity: 'critical',
            suggested_fix: 'Increase wall thickness around the drilled feature.',
            message: 'Thin wall around hole1 violates the machining minimum.',
          },
        ],
        summary: {
          errors: 1,
          warnings: 0,
          severity_counts: {
            critical: 1,
            major: 0,
            minor: 0,
            info: 0,
          },
          top_fixes: [
            {
              rule_id: 'DFM-01',
              suggested_fix: 'Increase wall thickness around the drilled feature.',
            },
          ],
        },
      },
    },
  });

  assert.ok(capturedPayload?._decision_summary, 'expected report payload to include decision summary');
  assert.ok(capturedPayload?._report_artifacts, 'expected report payload to include report artifact references');
  assert.equal(capturedPayload._decision_summary.overall_status, 'fail');
  assert.equal(capturedPayload._decision_summary.ready_for_manufacturing_review, false);
  assert.equal(result.summary_json.endsWith('_report_summary.json'), true);
  assert.equal(result.drawing_intent_json.endsWith('_drawing_intent.json'), true);
  assert.equal(result.feature_catalog_json.endsWith('_feature_catalog.json'), true);

  const summary = JSON.parse(readFileSync(result.summary_json, 'utf8'));
  assert.equal(summary.overall_status, 'fail');
  assert.equal(summary.artifacts_referenced.some((artifact) => artifact.key === 'create_quality' && artifact.status === 'available'), true);
  assert.equal(summary.artifacts_referenced.some((artifact) => artifact.key === 'drawing_quality' && artifact.status === 'available'), true);
  assert.equal(summary.artifacts_referenced.some((artifact) => artifact.key === 'drawing_intent' && artifact.status === 'available'), true);
  assert.equal(summary.artifacts_referenced.some((artifact) => artifact.key === 'feature_catalog' && artifact.status === 'available'), true);
  const drawingIntent = JSON.parse(readFileSync(result.drawing_intent_json, 'utf8'));
  assert.equal(drawingIntent.part_type, 'service_probe');
  assert.equal(summary.feature_catalog.available, true);
  const featureCatalog = JSON.parse(readFileSync(result.feature_catalog_json, 'utf8'));
  assert.equal(featureCatalog.artifact_type, 'feature_catalog');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}

console.log('report-service-summary.test.js: ok');
