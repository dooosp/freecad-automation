import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { validateInspectionEvidence } from '../lib/inspection-evidence.js';

const ROOT = resolve(import.meta.dirname, '..');
const VALID_FIXTURE_PATH = join(
  ROOT,
  'tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json'
);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const VALID_INSPECTION_FIXTURE = readJson(VALID_FIXTURE_PATH);

function validInspectionEvidence(overrides = {}) {
  return {
    ...JSON.parse(JSON.stringify(VALID_INSPECTION_FIXTURE)),
    overall_result: 'pass',
    ...overrides,
  };
}

function assertPasses(name, document) {
  const validation = validateInspectionEvidence(document);
  assert.equal(validation.ok, true, `${name} should pass:\n${validation.errors.join('\n')}`);
}

function assertFails(name, document, pattern = /inspection|measured|source|artifact/i) {
  const validation = validateInspectionEvidence(document);
  assert.equal(validation.ok, false, `${name} should fail`);
  assert.match(validation.errors.join('\n'), pattern, `${name} should explain the boundary`);
}

function assertSafeFixturePath(name, pathValue) {
  assert.equal(typeof pathValue, 'string', `${name} should be a string`);
  assert.ok(pathValue.length > 0, `${name} should not be empty`);
  assert.equal(pathValue.startsWith('/'), false, `${name} should be repo-relative`);
  assert.equal(/^[A-Za-z]:/.test(pathValue), false, `${name} should not be a drive path`);
  assert.equal(pathValue.includes('\\'), false, `${name} should use forward slashes`);
  assert.equal(pathValue.split('/').includes('..'), false, `${name} should not traverse upward`);
  assert.equal(pathValue === 'output' || pathValue.startsWith('output/'), false, `${name} should not point at output/`);
  assert.equal(pathValue === 'tmp/codex' || pathValue.startsWith('tmp/codex/'), false, `${name} should not point at tmp/codex/`);
  assert.equal(pathValue.startsWith('docs/examples/'), false, `${name} should not point at canonical examples`);
}

assertPasses('valid inspection evidence fixture file', VALID_INSPECTION_FIXTURE);
assertSafeFixturePath('valid fixture source_file', VALID_INSPECTION_FIXTURE.source_file);

const generatedArtifacts = [
  [
    'CAD create-quality report',
    readJson(join(ROOT, 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_create_quality.json')),
    /create_quality_report|evidence_type|source_type|measured_features/i,
  ],
  [
    'drawing quality report',
    readJson(join(ROOT, 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_quality.json')),
    /drawing_quality_report|evidence_type|source_type|measured_features/i,
  ],
  [
    'drawing QA report',
    readJson(join(ROOT, 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_qa.json')),
    /drawing_qa_report|evidence_type|source_type|measured_features/i,
  ],
  [
    'drawing intent file',
    readJson(join(ROOT, 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_drawing_intent.json')),
    /drawing_intent|evidence_type|source_type|measured_features/i,
  ],
  [
    'feature catalog',
    readJson(join(ROOT, 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_feature_catalog.json')),
    /feature_catalog|evidence_type|source_type|measured_features/i,
  ],
  [
    'DFM report',
    { artifact_type: 'dfm_report', schema_version: '1.0', checks: [], summary: {}, score: 92 },
    /dfm_report|evidence_type|source_type|measured_features/i,
  ],
  [
    'readiness report',
    readJson(join(ROOT, 'docs/examples/motor-mount/readiness/readiness_report.json')),
    /readiness_report|evidence_type|source_type|measured_features/i,
  ],
  [
    'review pack',
    readJson(join(ROOT, 'docs/examples/motor-mount/review/review_pack.json')),
    /review_pack|evidence_type|source_type|measured_features/i,
  ],
];

for (const [name, document, pattern] of generatedArtifacts) {
  assertFails(name, document, pattern);
}

assertFails(
  'inspection evidence missing measured_features',
  validInspectionEvidence({ measured_features: undefined }),
  /measured_features/i
);

assertFails(
  'inspection evidence with no measurement values',
  validInspectionEvidence({
    measured_features: [
      {
        feature_id: 'mount_hole_1',
        drawing_ref: 'D-102',
        requirement_ref: 'MOUNTING_HOLE_DIA',
        nominal_value: 10,
        tolerance_upper: 0.05,
        tolerance_lower: -0.05,
        units: 'mm',
        result: 'not_measured',
        measurement_method: 'manual_caliper_check',
      },
    ],
    overall_result: 'unknown',
  }),
  /measured_value|contains/i
);

assertPasses(
  'unknown overall result with explicit feature result semantics',
  validInspectionEvidence({
    overall_result: 'unknown',
    measured_features: [
      {
        feature_id: 'mount_hole_1',
        drawing_ref: 'D-102',
        requirement_ref: 'MOUNTING_HOLE_DIA',
        nominal_value: 10,
        measured_value: 9.98,
        tolerance_upper: 0.05,
        tolerance_lower: -0.05,
        units: 'mm',
        result: 'pass',
        measurement_method: 'cmm_report',
      },
      {
        feature_id: 'slot_width_1',
        drawing_ref: 'D-204',
        requirement_ref: 'SLOT_WIDTH',
        nominal_value: 4.5,
        units: 'mm',
        result: 'not_measured',
        measurement_method: 'not_scheduled_for_first_article',
      },
    ],
  })
);

assertFails(
  'unsafe source ref',
  validInspectionEvidence({ source_ref: '../supplier/inspection.json' }),
  /source_ref|safe repo-relative/i
);

assertFails(
  'ignored scratch source file',
  validInspectionEvidence({ source_ref: undefined, source_file: 'tmp/codex/inspection.json' }),
  /source_file|safe repo-relative/i
);

console.log('inspection-evidence-contract.test.js: ok');
