import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  getQualityFixtureExpectation,
  getQualityFixtureMatrix,
} from './quality-fixture-matrix.js';
import { validateDecisionReportSummary } from '../src/services/report/decision-report-summary.js';

const ROOT = resolve(import.meta.dirname, '..');

function buildSyntheticSummary(expectation) {
  return {
    schema_version: '1.0',
    command: 'report',
    input_config: resolve(ROOT, expectation.configPath),
    report_pdf: resolve(ROOT, 'output', `${expectation.id}_report.pdf`),
    report_summary_json: resolve(ROOT, 'output', `${expectation.id}_report_summary.json`),
    overall_status: expectation.report.overallStatus,
    overall_score: expectation.report.overallStatus === 'pass' ? 100 : 42,
    ready_for_manufacturing_review: expectation.report.readyForManufacturingReview,
    config_name: expectation.id,
    run_id: null,
    git_commit: null,
    git_branch: null,
    generated_at: '2026-04-20T12:00:00.000Z',
    runtime_status: {
      mode: 'synthetic-hosted-contract',
      available: false,
    },
    inputs_consumed: [
      {
        key: 'config',
        label: 'Input config',
        path: resolve(ROOT, expectation.configPath),
        status: 'available',
        note: null,
      },
    ],
    artifacts_referenced: [
      {
        key: 'report_summary_json',
        label: 'Report summary JSON',
        path: resolve(ROOT, 'output', `${expectation.id}_report_summary.json`),
        status: 'generated',
        note: null,
      },
    ],
    blocking_issues: expectation.report.overallStatus === 'pass'
      ? []
      : [`${expectation.id} remains an intentional blocker-rich fixture.`],
    warnings: [],
    recommended_actions: expectation.report.readyForManufacturingReview
      ? []
      : [`Keep ${expectation.id} in expected-fail mode until an intentional fixture change is made.`],
    missing_optional_artifacts: [],
    top_risks: expectation.report.overallStatus === 'pass'
      ? []
      : [`${expectation.id} should not become manufacturing-ready without an explicit fixture change.`],
    surfaces: {
      create_quality: {
        status: expectation.strictCreate.qualityStatus,
        available: true,
        blocking_issues: expectation.strictCreate.expectedExit === 0 ? [] : ['Expected strict create blocker'],
        warnings: [],
      },
      drawing_quality: {
        status: expectation.strictDraw.qualityStatus,
        available: true,
        blocking_issues: expectation.strictDraw.expectedExit === 0 ? [] : ['Expected strict draw blocker'],
        warnings: [],
      },
      dfm: {
        status: expectation.dfm.status,
        available: true,
        blocking_issues: [],
        warnings: [],
      },
    },
  };
}

const matrix = getQualityFixtureMatrix();
assert.equal(matrix.length >= 2, true, 'quality fixture matrix should contain at least two fixtures');

const qualityPass = getQualityFixtureExpectation('quality_pass_bracket');
assert(qualityPass, 'quality_pass_bracket expectation should exist');
assert.equal(qualityPass.strictCreate.expectedExit, 0);
assert.equal(qualityPass.strictDraw.expectedExit, 0);
assert.equal(qualityPass.strictCreate.qualityStatus, 'pass');
assert.equal(qualityPass.strictDraw.qualityStatus, 'pass');
assert.equal(qualityPass.report.readyForManufacturingReview, true);
assert.equal(qualityPass.report.overallStatus, 'pass');

const ksBracket = getQualityFixtureExpectation('ks_bracket');
assert(ksBracket, 'ks_bracket expectation should exist');
assert.equal(ksBracket.strictCreate.expectedExit, 'nonzero');
assert.equal(ksBracket.strictDraw.expectedExit, 'nonzero');
assert.equal(ksBracket.strictCreate.qualityStatus, 'fail');
assert.equal(ksBracket.strictDraw.qualityStatus, 'fail');
assert.equal(ksBracket.report.readyForManufacturingReview, false);
assert.equal(ksBracket.report.overallStatus, 'fail');

for (const expectation of matrix) {
  assert.equal(existsSync(resolve(ROOT, expectation.configPath)), true, `Expected fixture config to exist: ${expectation.configPath}`);
  const validation = validateDecisionReportSummary(buildSyntheticSummary(expectation));
  assert.equal(validation.ok, true, `${expectation.id} synthetic report summary should stay schema-valid: ${validation.errors.join('\n')}`);
}

console.log('quality-fixture-matrix.test.js: ok');
