import assert from 'node:assert/strict';

import {
  buildDrawingQualitySummary,
  shouldFailDrawingQualityGate,
} from '../src/services/drawing/drawing-quality-summary.js';

function makeBaseArtifacts() {
  return {
    inputConfigPath: '/tmp/ks_bracket.toml',
    drawingSvgPath: '/tmp/ks_bracket_drawing.svg',
    planPath: '/tmp/ks_bracket_plan.toml',
    qaPath: '/tmp/ks_bracket_drawing_qa.json',
    qaReport: {
      score: 94,
      metrics: {
        overflow_count: 0,
      },
      details: {
        overflows: [],
      },
    },
    qaIssuesPath: '/tmp/ks_bracket_drawing_qa_issues.json',
    qaIssues: {
      issues: [],
    },
    traceabilityPath: '/tmp/ks_bracket_traceability.json',
    traceability: {
      summary: {
        feature_count: 3,
        dimension_count: 3,
        linked_dimensions: 3,
        unresolved_dimensions: [],
      },
      links: [
        { dim_id: 'WIDTH', feature_id: 'body_width' },
        { dim_id: 'HEIGHT', feature_id: 'body_height' },
        { dim_id: 'HOLE_DIA', feature_id: 'hole_1' },
      ],
    },
    layoutReportPath: '/tmp/ks_bracket_layout_report.json',
    layoutReport: {
      views: {
        front: {},
        top: {},
        right: {},
      },
      summary: {
        view_count: 3,
        overflow_views: [],
        all_within_limits: true,
      },
    },
    dimensionMapPath: '/tmp/ks_bracket_dimension_map.json',
    dimensionMap: {
      plan_dimensions: [
        { dim_id: 'WIDTH', required: true, rendered: true, status: 'rendered', feature: 'body_width' },
        { dim_id: 'HEIGHT', required: true, rendered: true, status: 'rendered', feature: 'body_height' },
        { dim_id: 'HOLE_DIA', required: true, rendered: true, status: 'rendered', feature: 'hole_1' },
      ],
      auto_dimensions: [],
      summary: {
        auto_count: 0,
        plan_count: 3,
        rendered_plan_count: 3,
        conflict_count: 0,
        skipped_duplicate_count: 0,
        dedupe_conflict_count: 0,
      },
    },
    dimConflictsPath: '/tmp/ks_bracket_dim_conflicts.json',
    dimConflicts: {
      conflicts: [],
      summary: {
        count: 0,
      },
    },
    bomPath: '/tmp/ks_bracket_bom.csv',
    bomEntries: [
      { id: 'body', material: 'AL6061', count: 1 },
      { id: 'fastener', material: 'SCM435', count: 2 },
    ],
    bomRows: [
      { item: '1', id: 'body', material: 'AL6061', qty: '1' },
      { item: '2', id: 'fastener', material: 'SCM435', qty: '2' },
    ],
    generatedViews: ['front', 'top', 'right'],
  };
}

{
  const summary = buildDrawingQualitySummary(makeBaseArtifacts());
  assert.equal(summary.command, 'draw');
  assert.equal(summary.status, 'pass');
  assert.equal(summary.score, 94);
  assert.equal(summary.views.required_count, 3);
  assert.equal(summary.views.generated_count, 3);
  assert.deepEqual(summary.views.missing_views, []);
  assert.equal(summary.views.overlap_count, 0);
  assert.equal(summary.dimensions.coverage_percent, 100);
  assert.equal(summary.dimensions.conflict_count, 0);
  assert.equal(summary.traceability.coverage_percent, 100);
  assert.equal(summary.bom.expected_items, 2);
  assert.equal(summary.bom.actual_items, 2);
  assert.deepEqual(summary.blocking_issues, []);
  assert.deepEqual(summary.recommended_actions, []);
  assert.equal(summary.semantic_quality.decision, 'unknown');
  assert.equal(summary.semantic_quality.enforceable, false);
}

{
  const summary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    bomPath: null,
    bomEntries: [],
    bomRows: [],
  });
  assert.equal(summary.status, 'pass');
  assert.equal(summary.bom.expected_items, 0);
  assert.equal(summary.bom.actual_items, 0);
  assert.equal(summary.bom.balloon_mismatches, 0);
}

{
  const summary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    drawingIntent: {
      optional_dimensions: [
        { id: 'SERVICE_CLEARANCE', feature: 'service_zone' },
      ],
      optional_notes: ['SERVICE ACCESS'],
    },
  });
  assert.equal(summary.status, 'pass');
  assert.equal(summary.semantic_quality.required_blockers.length, 0);
  assert.equal(summary.semantic_quality.optional_missing_information.length, 2);
  assert.deepEqual(summary.blocking_issues, []);
}

{
  const summary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    drawingIntent: {
      required_dimensions: [
        { id: 'WIDTH', feature: 'body_width' },
        { id: 'DEPTH', feature: 'body_depth' },
      ],
      required_notes: ['MACHINED PART'],
      required_views: ['front', 'section'],
    },
    featureCatalog: {
      features: [
        { id: 'body_width', critical: true },
        { id: 'body_depth', critical: true },
      ],
    },
    bomPath: null,
    bomEntries: [],
    bomRows: [],
    svgContent: '<svg><g class="general-notes"><text>MACHINED PART</text></g></svg>',
  });
  assert.equal(summary.status, 'pass');
  assert.equal(summary.semantic_quality.decision, 'advisory');
  assert.equal(summary.semantic_quality.enforceable, false);
  assert.equal(summary.semantic_quality.required_dimensions_total, 2);
  assert.equal(summary.semantic_quality.required_dimensions_present, 1);
  assert.deepEqual(summary.semantic_quality.missing_required_dimensions, ['DEPTH']);
  assert.deepEqual(summary.semantic_quality.required_views_missing, ['section']);
  assert(summary.semantic_quality.missing_critical_information.some((item) => item.includes('DEPTH')));
  assert.equal(summary.semantic_quality.required_blockers.length, 0);
  assert.deepEqual(summary.blocking_issues, []);
}

{
  const summary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    dimensionMap: null,
    traceability: null,
    drawingIntent: {
      required_dimensions: [
        { id: 'WIDTH', feature: 'body_width' },
      ],
    },
  });
  assert.equal(summary.semantic_quality.decision, 'advisory');
  assert.equal(summary.semantic_quality.required_dimensions_present, 0);
  assert.deepEqual(summary.semantic_quality.missing_required_dimensions, ['WIDTH']);
  assert.deepEqual(summary.semantic_quality.traceability.unknown_required_dimensions, ['WIDTH']);
  assert.notEqual(summary.semantic_quality.advisory_decision, 'pass');
}

{
  const summary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    drawingIntent: {
      enforceable: true,
      required_dimensions: [
        { id: 'DEPTH', feature: 'body_depth' },
      ],
    },
  });
  assert.equal(summary.status, 'fail');
  assert.equal(summary.semantic_quality.decision, 'fail');
  assert(summary.semantic_quality.required_blockers.some((item) => item.includes('DEPTH')));
  assert(summary.blocking_issues.some((issue) => issue.code === 'semantic-drawing-intent-coverage'));
}

{
  const summary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    drawingIntent: {
      required_dimensions: [
        { id: 'WIDTH', feature: 'body_width' },
      ],
    },
  });
  assert.equal(summary.semantic_quality.traceability.linked_required_dimensions, 1);
  assert.equal(summary.semantic_quality.traceability.rows[0].status, 'linked');
  assert.equal(summary.semantic_quality.traceability.rows[0].feature_id, 'body_width');
}

{
  const summary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    dimensionMap: {
      plan_dimensions: [
        { dim_id: 'WIDTH', required: true, rendered: true, status: 'rendered', feature: 'body_width' },
        { dim_id: 'HEIGHT', required: true, rendered: false, status: 'missing', feature: 'body_height' },
        { dim_id: 'HOLE_DIA', required: true, rendered: true, status: 'rendered', feature: 'hole_1' },
      ],
      auto_dimensions: [],
      summary: {
        auto_count: 0,
        plan_count: 3,
        rendered_plan_count: 2,
        conflict_count: 0,
        skipped_duplicate_count: 0,
        dedupe_conflict_count: 0,
      },
    },
  });
  assert.equal(summary.status, 'fail');
  assert.equal(summary.dimensions.coverage_percent, 66.67);
  assert.deepEqual(summary.dimensions.missing_required_intents, ['HEIGHT']);
  assert(summary.blocking_issues.some((issue) => issue.code === 'required-dimension-coverage'));
  assert(summary.recommended_actions.some((item) => item.includes('HEIGHT')));
}

{
  const summary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    dimConflicts: {
      conflicts: [
        { dim_id: 'WIDTH', category: 'layout', reason: 'collision' },
      ],
      summary: {
        count: 1,
      },
    },
  });
  assert.equal(summary.status, 'fail');
  assert.equal(summary.dimensions.conflict_count, 1);
  assert(summary.blocking_issues.some((issue) => issue.code === 'dimension-conflicts'));
  assert(summary.recommended_actions.some((item) => item.includes('moving view/dimension')));
}

{
  const summary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    traceability: {
      summary: {
        feature_count: 3,
        dimension_count: 3,
        linked_dimensions: 2,
        unresolved_dimensions: ['HOLE_DIA'],
      },
      links: [
        { dim_id: 'WIDTH', feature_id: 'body_width' },
        { dim_id: 'HEIGHT', feature_id: 'body_height' },
        { dim_id: 'HOLE_DIA', feature_id: null },
      ],
    },
  });
  assert.equal(summary.status, 'fail');
  assert.equal(summary.traceability.coverage_percent, 66.67);
  assert.deepEqual(summary.traceability.unmapped_required_entities, ['HOLE_DIA']);
  assert(summary.blocking_issues.some((issue) => issue.code === 'traceability-coverage'));
  assert(summary.recommended_actions.some((item) => item.includes('mapping entity ids')));
}

{
  const summary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    qaIssues: {
      issues: [
        {
          id: 'ISSUE_001',
          severity: 'high',
          category: 'completeness',
          rule_id: 'required_dim_missing',
        },
      ],
    },
  });
  assert.equal(summary.status, 'fail');
  assert(summary.blocking_issues.some((issue) => issue.code === 'critical-qa-issue'));
}

{
  const summary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    qaIssuesPath: null,
    qaIssues: null,
  });
  assert.equal(summary.status, 'warning');
  assert(summary.warnings.some((item) => item.includes('qa issues')));
  assert.equal(shouldFailDrawingQualityGate(summary, { strictQuality: false }), false);
  assert.equal(shouldFailDrawingQualityGate(summary, { strictQuality: true }), false);
}

{
  const failingSummary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    layoutReport: {
      views: {
        front: {},
        top: {},
        right: {},
      },
      summary: {
        view_count: 3,
        overflow_views: ['top'],
        all_within_limits: false,
      },
    },
  });
  assert.equal(failingSummary.status, 'fail');
  assert.equal(shouldFailDrawingQualityGate(failingSummary, { strictQuality: false }), false);
  assert.equal(shouldFailDrawingQualityGate(failingSummary, { strictQuality: true }), true);
}

{
  const summary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    drawingIntent: {
      required_dimensions: [
        { id: 'WIDTH', feature: 'body_width' },
      ],
      required_notes: ['MATERIAL'],
      required_views: ['front'],
    },
    extractedDrawingSemanticsPath: '/tmp/ks_bracket_extracted_drawing_semantics.json',
    extractedDrawingSemantics: {
      status: 'partial',
      decision: 'advisory',
      sources: [
        { artifact_type: 'svg', path: '/tmp/ks_bracket_drawing.svg', inspected: true, method: 'svg_text_scan' },
      ],
      dimensions: [],
      notes: [],
      views: [
        {
          id: 'front',
          label: 'Front',
          source: '/tmp/ks_bracket_layout_report.json',
          matched_intent_id: 'front',
          confidence: 0.9,
          provenance: {
            artifact_type: 'layout_report',
            path: '/tmp/ks_bracket_layout_report.json',
            method: 'layout_report_views',
          },
        },
      ],
      coverage: {
        required_dimensions_total: 1,
        required_dimensions_extracted: 0,
        required_notes_total: 1,
        required_notes_extracted: 0,
        required_views_total: 1,
        required_views_extracted: 1,
      },
      unknowns: [
        'Required note not reliably extracted: MATERIAL.',
      ],
      limitations: ['Advisory-only foundation.'],
    },
  });
  assert.equal(summary.extracted_drawing_semantics_file, '/tmp/ks_bracket_extracted_drawing_semantics.json');
  assert.equal(summary.semantic_quality.extracted_evidence.status, 'partial');
  assert.equal(summary.semantic_quality.extracted_evidence.advisory_only, true);
  assert.equal(summary.semantic_quality.extracted_evidence.coverage.required_dimensions.missing, 1);
  assert.equal(summary.semantic_quality.extracted_evidence.coverage.required_notes.unknown, 1);
  assert.equal(summary.semantic_quality.extracted_evidence.matched_required_views, 1);
  assert.equal(summary.semantic_quality.extracted_evidence.required_dimensions[0].classification, 'missing');
  assert.equal(summary.semantic_quality.extracted_evidence.required_notes[0].classification, 'unknown');
  assert.equal(summary.semantic_quality.extracted_evidence.required_views[0].classification, 'extracted');
  assert(summary.semantic_quality.suggested_actions.some((item) => item.includes('WIDTH')));
  assert.equal(summary.semantic_quality.suggested_action_details.some((entry) => entry.category === 'dimension' && entry.classification === 'missing'), true);
  assert.equal(summary.semantic_quality.extracted_evidence.suggested_action_details.some((entry) => entry.category === 'note' && entry.classification === 'unknown'), true);
  assert.equal(summary.semantic_quality.suggested_action_details.every((entry) => ['advisory', 'review', 'info'].includes(entry.severity)), true);
  assert.deepEqual(summary.blocking_issues, []);
}

{
  const summary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    drawingIntent: {
      required_dimensions: [
        { id: 'WIDTH', feature: 'body_width' },
      ],
    },
    extractedDrawingSemantics: {
      status: 'partial',
      decision: 'advisory',
      sources: [
        { artifact_type: 'svg', path: '/tmp/ks_bracket_drawing.svg', inspected: true, method: 'svg_text_scan' },
      ],
      views: [],
      dimensions: [
        {
          id: 'svg_text_001',
          raw_text: '40',
          value: 40,
          unit: 'mm',
          matched_intent_id: 'WIDTH',
          matched_feature_id: 'body_width',
          source: '/tmp/ks_bracket_drawing.svg',
          confidence: 0.31,
          provenance: {
            artifact_type: 'svg',
            path: '/tmp/ks_bracket_drawing.svg',
            method: 'svg_dimension_text_scan',
          },
        },
      ],
      notes: [],
      coverage: {
        required_dimensions_total: 1,
        required_dimensions_extracted: 0,
        required_notes_total: 0,
        required_notes_extracted: 0,
        required_views_total: 0,
        required_views_extracted: 0,
      },
      unknowns: [],
      limitations: ['Advisory-only foundation.'],
    },
  });
  assert.equal(summary.status, 'pass');
  assert.equal(summary.semantic_quality.extracted_evidence.required_dimensions[0].classification, 'unknown');
  assert.equal(summary.semantic_quality.extracted_evidence.matched_required_dimensions, 0);
  assert.equal(summary.semantic_quality.extracted_evidence.required_dimensions[0].candidate_matches.length, 1);
  assert.equal(summary.semantic_quality.suggested_action_details[0].classification, 'low_confidence');
  assert.equal(summary.semantic_quality.suggested_action_details[0].severity, 'review');
  assert.deepEqual(summary.blocking_issues, []);
}

console.log('drawing-quality-summary.test.js: ok');
