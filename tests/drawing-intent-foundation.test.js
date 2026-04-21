import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import Ajv2020 from 'ajv/dist/2020.js';

import { getDrawingIntent } from '../lib/drawing-intent.js';
import { readRawConfigFile, validateConfigDocument } from '../lib/config-schema.js';
import { buildOutputManifest, validateOutputManifest } from '../lib/output-manifest.js';
import {
  buildDecisionReportSummary,
  validateDecisionReportSummary,
} from '../src/services/report/decision-report-summary.js';

const ROOT = resolve(import.meta.dirname, '..');
const DRAWING_INTENT_SCHEMA = JSON.parse(
  readFileSync(join(ROOT, 'schemas', 'drawing-intent.schema.json'), 'utf8')
);
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-drawing-intent-'));

function makePassingReportInput(config) {
  return {
    configPath: '/tmp/intent_probe.toml',
    config,
    reportPdfPath: '/tmp/output/intent_probe_report.pdf',
    reportGeneratedAt: '2026-04-21T00:00:00.000Z',
    repoContext: {
      branch: 'feat/drawing-intent-foundation',
      headSha: 'abc123',
    },
    runtimeInfo: {
      mode: 'test',
      available: true,
    },
    createQuality: {
      status: 'pass',
      geometry: {
        valid_shape: true,
      },
      blocking_issues: [],
      warnings: [],
    },
    drawingQuality: {
      status: 'pass',
      score: 98,
      views: {
        overlap_count: 0,
      },
      dimensions: {
        missing_required_intents: [],
        conflict_count: 0,
      },
      traceability: {
        coverage_percent: 100,
      },
      blocking_issues: [],
      warnings: [],
      recommended_actions: [],
    },
    dfm: {
      score: 95,
      issues: [],
      summary: {
        severity_counts: {
          critical: 0,
          major: 0,
          minor: 0,
          info: 0,
        },
        top_fixes: [],
      },
    },
  };
}

try {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validateDrawingIntent = ajv.compile(DRAWING_INTENT_SCHEMA);

  for (const relativePath of [
    'configs/examples/quality_pass_bracket.toml',
    'configs/examples/ks_bracket.toml',
  ]) {
    const absolutePath = resolve(ROOT, relativePath);
    const { parsed } = await readRawConfigFile(absolutePath);
    const validation = validateConfigDocument(parsed, { filepath: absolutePath });
    assert.equal(validation.valid, true, `${relativePath} should validate with drawing_intent`);
    assert.deepEqual(validation.summary.errors, []);
    assert.deepEqual(validation.summary.warnings, []);

    const drawingIntent = getDrawingIntent(validation.config);
    assert.ok(drawingIntent, `${relativePath} should expose drawing_intent`);
    assert.equal(drawingIntent.missing_semantics_policy, 'advisory');
    assert.equal(validateDrawingIntent(drawingIntent), true, (validateDrawingIntent.errors || [])
      .map((error) => `${error.instancePath} ${error.message}`)
      .join('\n'));
    assert.equal(Array.isArray(drawingIntent.critical_features), true);
    assert.equal(Array.isArray(drawingIntent.required_dimensions), true);
    assert.equal(Array.isArray(drawingIntent.required_views), true);
  }

  const missingIntentPath = join(TMP_DIR, 'missing-intent.toml');
  writeFileSync(missingIntentPath, `
config_version = 1
name = "missing_intent_probe"

[[shapes]]
id = "plate"
type = "box"
length = 10
width = 10
height = 2

[export]
formats = ["step"]
directory = "output"
`, 'utf8');
  const { parsed: missingIntentConfig } = await readRawConfigFile(missingIntentPath);
  const missingIntentValidation = validateConfigDocument(missingIntentConfig, { filepath: missingIntentPath });
  assert.equal(missingIntentValidation.valid, true);
  assert.equal(getDrawingIntent(missingIntentValidation.config), null);

  const noIntentSummary = buildDecisionReportSummary(makePassingReportInput({
    name: 'intent_probe',
  }));
  assert.equal(validateDecisionReportSummary(noIntentSummary).ok, true);
  assert.equal(noIntentSummary.overall_status, 'pass');
  assert.equal(noIntentSummary.ready_for_manufacturing_review, true);
  assert.equal(Object.hasOwn(noIntentSummary, 'drawing_intent'), false);
  assert.equal(
    noIntentSummary.artifacts_referenced.some((artifact) => artifact.key === 'drawing_intent'),
    false
  );

  const enforcedIntentSummary = buildDecisionReportSummary(makePassingReportInput({
    name: 'intent_probe',
    drawing_intent: {
      part_type: 'test_part',
      manufacturing_process: 'machining',
      material: 'AL6061',
      required_views: ['top'],
      required_dimensions: [
        {
          id: 'WIDTH',
          feature: 'plate',
          dimension_type: 'linear',
          required: true,
        },
      ],
      tolerance_policy: {
        general: 'Use authored metadata only.',
      },
      missing_semantics_policy: 'enforced',
    },
  }));
  const enforcedValidation = validateDecisionReportSummary(enforcedIntentSummary);
  assert.equal(enforcedValidation.ok, true, enforcedValidation.errors.join('\n'));
  assert.equal(enforcedIntentSummary.overall_status, 'pass');
  assert.equal(enforcedIntentSummary.ready_for_manufacturing_review, true);
  assert.equal(enforcedIntentSummary.drawing_intent.missing_semantics_policy, 'enforced');
  assert.equal(
    enforcedIntentSummary.artifacts_referenced.find((artifact) => artifact.key === 'drawing_intent')?.required,
    false
  );

  const intentJsonPath = join(TMP_DIR, 'intent_probe_drawing_intent.json');
  const summaryJsonPath = join(TMP_DIR, 'intent_probe_report_summary.json');
  writeFileSync(intentJsonPath, JSON.stringify(enforcedIntentSummary.drawing_intent, null, 2), 'utf8');
  writeFileSync(summaryJsonPath, JSON.stringify(enforcedIntentSummary, null, 2), 'utf8');

  const manifest = await buildOutputManifest({
    projectRoot: ROOT,
    repoContext: {
      root: ROOT,
      branch: 'feat/drawing-intent-foundation',
      headSha: 'abc123',
      dirtyAtStart: false,
    },
    command: 'report',
    commandArgs: ['configs/examples/intent_probe.toml'],
    linkedArtifacts: {
      report_summary_json: summaryJsonPath,
      drawing_intent_json: intentJsonPath,
    },
    timings: {
      startedAt: '2026-04-21T00:00:00.000Z',
      finishedAt: '2026-04-21T00:00:01.000Z',
    },
  });
  const manifestValidation = validateOutputManifest(manifest);
  assert.equal(manifestValidation.ok, true, manifestValidation.errors.join('\n'));
  assert.equal(manifest.linked_artifacts.report_summary_json, summaryJsonPath);
  assert.equal(manifest.linked_artifacts.drawing_intent_json, intentJsonPath);

  console.log('drawing-intent-foundation.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}
