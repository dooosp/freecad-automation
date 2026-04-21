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
      extracted_drawing_semantics_file: '/tmp/output/ks_bracket_extracted_drawing_semantics.json',
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
      semantic_quality: {
        decision: 'pass',
        advisory_decision: 'pass',
        enforceable: false,
        score: 100,
        critical_features_total: 1,
        critical_features_covered: 1,
        required_dimensions_total: 1,
        required_dimensions_present: 1,
        missing_required_dimensions: [],
        required_notes_missing: [],
        required_views_missing: [],
        traceability: {
          required_dimensions_total: 1,
          linked_required_dimensions: 1,
          missing_required_dimensions: [],
          unknown_required_dimensions: [],
        },
        missing_critical_information: [],
        required_blockers: [],
        optional_missing_information: [],
        suggested_actions: [],
        extracted_evidence: {
          status: 'partial',
          advisory_only: true,
          path: '/tmp/output/ks_bracket_extracted_drawing_semantics.json',
          matched_required_dimensions: 1,
          matched_required_notes: 0,
          matched_required_views: 1,
          unknowns: ['Required note not reliably extracted: MATERIAL.'],
          limitations: ['Advisory-only foundation.'],
        },
      },
    },
    featureCatalog: {
      artifact_type: 'feature_catalog',
      recognition_policy: 'conservative_config_evidence_only',
      summary: {
        total_features: 4,
        recognized_features: 4,
        unknown_features: 0,
      },
    },
    extractedDrawingSemantics: {
      artifact_type: 'extracted_drawing_semantics',
      status: 'partial',
      decision: 'advisory',
      coverage: {
        required_dimensions_total: 1,
        required_dimensions_extracted: 1,
        required_notes_total: 1,
        required_notes_extracted: 0,
        required_views_total: 1,
        required_views_extracted: 1,
      },
      unknowns: ['Required note not reliably extracted: MATERIAL.'],
      limitations: ['Advisory-only foundation.'],
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
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'feature_catalog')?.required, false);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'extracted_drawing_semantics')?.required, false);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'extracted_drawing_semantics')?.status, 'available');
  assert.equal(summary.feature_catalog.total_features, 4);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'fem')?.required, false);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'tolerance')?.required, false);
  assert.equal(summary.surfaces.drawing_quality.semantic_quality.decision, 'pass');
  assert.equal(summary.surfaces.drawing_quality.semantic_quality.required_dimensions_present, 1);
  assert.equal(summary.surfaces.drawing_quality.semantic_quality.extracted_evidence.status, 'partial');
}

{
  const summary = buildDecisionReportSummary(makeBaseInput({
    drawingQuality: {
      ...makeBaseInput().drawingQuality,
      semantic_quality: {
        ...makeBaseInput().drawingQuality.semantic_quality,
        decision: 'advisory',
        advisory_decision: 'needs_attention',
        enforceable: false,
        score: 50,
        required_dimensions_total: 2,
        required_dimensions_present: 1,
        missing_required_dimensions: ['DEPTH'],
        traceability: {
          required_dimensions_total: 2,
          linked_required_dimensions: 1,
          missing_required_dimensions: [],
          unknown_required_dimensions: ['DEPTH'],
        },
        missing_critical_information: [
          'Required dimension is not evidenced on the drawing: DEPTH.',
        ],
        suggested_actions: ['Add or map required dimension(s): DEPTH.'],
      },
    },
  }));
  assert.equal(summary.overall_status, 'pass');
  assert.equal(summary.ready_for_manufacturing_review, true);
  assert.equal(summary.blocking_issues.length, 0);
  assert.equal(summary.warnings.some((warning) => warning.includes('advisory missing required semantic evidence')), false);
  assert(summary.recommended_actions.some((action) => action.includes('DEPTH')));
}

{
  const summary = buildDecisionReportSummary(makeBaseInput({
    drawingQuality: {
      ...makeBaseInput().drawingQuality,
      semantic_quality: {
        ...makeBaseInput().drawingQuality.semantic_quality,
        decision: 'fail',
        advisory_decision: 'needs_attention',
        enforceable: true,
        score: 50,
        required_dimensions_total: 2,
        required_dimensions_present: 1,
        missing_required_dimensions: ['DEPTH'],
        traceability: {
          required_dimensions_total: 2,
          linked_required_dimensions: 1,
          missing_required_dimensions: [],
          unknown_required_dimensions: ['DEPTH'],
        },
        missing_critical_information: [
          'Required dimension is not evidenced on the drawing: DEPTH.',
        ],
        required_blockers: [
          'Required dimension is not evidenced on the drawing: DEPTH.',
        ],
        suggested_actions: ['Add or map required dimension(s): DEPTH.'],
      },
    },
  }));
  assert.equal(summary.overall_status, 'fail');
  assert.equal(summary.ready_for_manufacturing_review, false);
  assert(summary.blocking_issues.some((issue) => issue.includes('DEPTH')));
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
