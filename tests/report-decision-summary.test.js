import assert from 'node:assert/strict';

import {
  buildDecisionReportSummary,
  createReportSummaryPath,
  validateDecisionReportSummary,
} from '../src/services/report/decision-report-summary.js';

function makeBaseInput(overrides = {}) {
  return {
    configPath: '/tmp/ks_bracket.toml',
    config: {
      name: 'ks_bracket',
      tolerance: {
        review_threshold_pct: 95,
      },
    },
    reportPdfPath: '/tmp/output/ks_bracket_report.pdf',
    reportGeneratedAt: '2026-04-20T01:02:03.000Z',
    repoContext: {
      branch: 'feat/decision-report-upgrade',
      headSha: 'abc123def456',
    },
    runtimeInfo: {
      mode: 'macos-bundle',
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
      score: 96,
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
      score: 92,
      issues: [],
      summary: {
        errors: 0,
        warnings: 0,
        severity_counts: {
          critical: 0,
          major: 0,
          minor: 0,
          info: 0,
        },
        top_fixes: [],
      },
    },
    fem: {
      fem: {
        mesh: {
          convergence_checked: true,
        },
        results: {
          safety_factor: 2.1,
        },
      },
    },
    tolerance: {
      stack_up: {
        success_rate_pct: 99.4,
      },
    },
    ...overrides,
  };
}

{
  const summary = buildDecisionReportSummary(makeBaseInput());
  const validation = validateDecisionReportSummary(summary);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(summary.overall_status, 'pass');
  assert.equal(summary.ready_for_manufacturing_review, true);
  assert.equal(summary.overall_score >= 95, true);
  assert.deepEqual(summary.blocking_issues, []);
  assert.equal(summary.missing_optional_artifacts.includes('fem'), false);
  assert.equal(summary.missing_optional_artifacts.includes('tolerance'), false);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'create_quality')?.required, true);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'drawing_quality')?.required, true);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'dfm')?.required, true);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'fem')?.required, false);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'tolerance')?.required, false);
}

{
  const summary = buildDecisionReportSummary(makeBaseInput({
    createQuality: {
      status: 'fail',
      geometry: {
        valid_shape: false,
      },
      blocking_issues: ['Generated model shape is invalid.'],
      warnings: [],
    },
  }));
  assert.equal(summary.overall_status, 'fail');
  assert.equal(summary.ready_for_manufacturing_review, false);
  assert(summary.blocking_issues.some((issue) => issue.includes('Generated model shape is invalid')));
  assert(summary.top_risks.some((risk) => risk.includes('invalid')));
}

{
  const summary = buildDecisionReportSummary(makeBaseInput({
    fem: null,
    tolerance: null,
  }));
  assert.equal(summary.overall_status, 'pass');
  assert.equal(summary.ready_for_manufacturing_review, true);
  assert.equal(
    summary.artifacts_referenced.find((artifact) => artifact.key === 'fem')?.status,
    'not_run'
  );
  assert.equal(
    summary.artifacts_referenced.find((artifact) => artifact.key === 'fem')?.required,
    false
  );
  assert.equal(
    summary.artifacts_referenced.find((artifact) => artifact.key === 'tolerance')?.status,
    'not_available'
  );
  assert.equal(
    summary.artifacts_referenced.find((artifact) => artifact.key === 'tolerance')?.required,
    false
  );
  assert.equal(
    summary.artifacts_referenced.find((artifact) => artifact.key === 'report_manifest')?.status,
    'generated'
  );
  assert.deepEqual(summary.blocking_issues, []);
  assert.equal(summary.ready_for_manufacturing_review, true);
  assert.equal(summary.missing_optional_artifacts.includes('report_manifest'), false);
}

assert.equal(
  createReportSummaryPath({
    primaryOutputPath: '/tmp/output/ks_bracket_report.pdf',
  }),
  '/tmp/output/ks_bracket_report_summary.json'
);

console.log('report-decision-summary.test.js: ok');
