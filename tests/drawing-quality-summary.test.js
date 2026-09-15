import assert from 'node:assert/strict';
import { resolveAutoDimensionCoverage } from '../src/services/drawing/auto-dimension-coverage.js';
import { currentTraceability } from '../src/services/drawing/current-traceability.js';

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

function makeAutoCoveredArtifacts({ feature = 'base_length', view = 'front', value = 120,
  category = 'overall_width', bucket = 'linear_h' } = {}) {
  const autoId = `auto_${view}_001`;
  const artifacts = makeBaseArtifacts();
  artifacts.dimensionMap.plan_dimensions[0] = {
    dim_id: 'WIDTH', feature, view, value_mm: value, style: 'linear', required: true,
    status: 'skipped_duplicate', rendered: false, reason: 'already_in_auto_dims',
    dedupe_match: { auto_dim_id: autoId, auto_category: category, auto_value_mm: value,
      delta_mm: 0, bucket, policy: 'smart', source: 'auto_dimensions' },
  };
  artifacts.dimensionMap.auto_dimensions = [{ dim_id: autoId, source: 'auto', view,
    category, value_mm: value, status: 'rendered', svg_element_id: autoId,
    drawing_object_id: `svg:dimensions-${view}:${autoId}` }];
  artifacts.dimensionMap.summary.skipped_duplicate_count = 1;
  artifacts.svgContent = `<svg><g class="dimensions-${view}"><text id="${autoId}"${
    bucket === 'linear_v' ? ' transform="rotate(-90,10,10)"' : ''}>${value}</text></g></svg>`;
  return artifacts;
}

{
  const trace = { links: [{ dim_id: 'THK', feature_id: 'plate', source: 'freecad_runtime',
    represented_by: 'THK', evidence: { model_value_mm: 3 } }] };
  const map = { plan_dimensions: [{ dim_id: 'THK', view: 'right', style: 'linear', value_mm: 3, rendered: true }] };
  const svg = '<svg><g class="dimensions-right plan-dimensions-right"><text data-dim-id="THK">3</text></g></svg>';
  const linked = (drawing) => currentTraceability(trace, map, drawing, new Map()).links[0].feature_id;
  assert.equal(linked(svg), 'plate');
  assert.equal(linked(svg.replace('<text ', '<text style="opacity:0.5" ')), 'plate');
  for (const invalid of [svg.replace('>3<', '>4<'), svg.replace('>3<', '>Ø3<'),
    svg.replace('<text ', '<text opacity="0" '), svg.replace('<g ', '<g display="none" '),
    svg.replace('data-dim-id="THK"', 'data-dim-id="OTHER"')]) {
    assert.equal(linked(invalid), null, 'the visible label must retain the measured dimension');
  }
}

{
  const artifacts = makeBaseArtifacts();
  artifacts.dimConflicts = { summary: { count: 2 }, conflicts: [
    { category: 'dedupe', reason: 'plan_dim_skipped_due_to_auto_match', severity: 'info' },
    { category: 'overall_width', reason: 'cross_view_redundant', severity: 'info' },
  ] };
  const summary = buildDrawingQualitySummary(artifacts);
  assert.equal(summary.dimensions.conflict_count, 0, 'successful duplicate suppression is not a layout failure');
  assert.equal(summary.dimensions.informational_conflict_count, 2);
  assert.equal(summary.status, 'pass');
  artifacts.dimConflicts.conflicts.push({ category: 'layout', reason: 'cell_bottom_limit', severity: 'warning' });
  artifacts.dimConflicts.summary.count = 3;
  assert.equal(buildDrawingQualitySummary(artifacts).dimensions.conflict_count, 1);
  assert.equal(buildDrawingQualitySummary(artifacts).status, 'fail');
  artifacts.dimConflicts.summary.count = 4;
  assert.equal(buildDrawingQualitySummary(artifacts).dimensions.conflict_count, 2,
    'unexplained summary conflicts must remain blocking');
  artifacts.dimConflicts.summary.count = 0;
  assert.equal(buildDrawingQualitySummary(artifacts).dimensions.conflict_count, 1,
    'a stale summary must not hide a listed warning');
}

{
  const artifacts = makeAutoCoveredArtifacts();
  artifacts.traceability.links[0] = {
    dim_id: 'WIDTH', feature_id: 'plate', source: 'freecad_runtime', represented_by: 'auto_front_001',
    svg_element_id: 'auto_front_001',
    evidence: { source: 'freecad_runtime', model_object_id: 'cut4', model_value_mm: 120 },
  };
  assert.equal(buildDrawingQualitySummary(artifacts).traceability.coverage_percent, 100);
  const stale = structuredClone(artifacts);
  stale.svgContent = stale.svgContent.replace('>120<', '>119<');
  assert.deepEqual(buildDrawingQualitySummary(stale).traceability.unmapped_required_entities, ['WIDTH'],
    'a runtime link must also match the final drawing label');
  const empty = makeBaseArtifacts();
  empty.traceability.links = [];
  assert.equal(buildDrawingQualitySummary(empty).traceability.coverage_percent, 0,
    'an empty unresolved list is not positive traceability evidence');
}

{
  const map = {
    auto_dimensions: [{ dim_id: 'auto_top_004', source: 'auto', view: 'top', category: 'hole_diameter',
      value_mm: 4.5, status: 'rendered', svg_element_id: 'auto_top_004', center_uv: [12, 12],
      drawing_object_id: 'svg:dimensions-top:auto_top_004' }],
    plan_dimensions: [{ dim_id: 'HOLE_DIA', feature: 'mounting_hole_diameter', view: 'top', style: 'diameter',
      required: true, value_mm: 4.5, status: 'skipped_duplicate', reason: 'already_in_auto_dims',
      dedupe_match: { auto_dim_id: 'auto_top_004', auto_category: 'hole_diameter', auto_value_mm: 4.5,
        bucket: 'diameter', policy: 'smart', source: 'auto_dimensions' } }],
  };
  const svg = '<svg><g class="dimensions-top"><text id="auto_top_004" data-center-u="12" data-center-v="12">⌀4.5</text></g></svg>';
  assert.equal(resolveAutoDimensionCoverage(map, svg).size, 1, 'identified diameter label should count as displayed');
  for (const invalid of [
    svg.replace('⌀4.5', '4.5'), svg.replace('⌀4.5', '⌀4.6'),
    svg.replace('data-center-u="12"', 'data-center-u="108"'),
    svg.replace('data-center-v="12"', ''), svg.replace('<g ', '<g display="none" '),
    svg.replace('id="auto_top_004"', 'id="different"'),
  ]) assert.equal(resolveAutoDimensionCoverage(map, invalid).size, 0);
  for (const invalidate of [
    (m) => { m.auto_dimensions[0].center_uv = [108, 12]; },
    (m) => { m.plan_dimensions[0].value_mm = 4.4; },
    (m) => { m.plan_dimensions[0].dedupe_match.policy = 'value_only'; },
    (m) => { m.plan_dimensions[0].feature = 'web_height'; },
  ]) {
    const invalid = structuredClone(map);
    invalidate(invalid);
    assert.equal(resolveAutoDimensionCoverage(invalid, svg).size, 0);
  }
}

// A deduplicated plan row can be covered by an identified extent label in the
// final SVG. It must not acquire a fabricated model-feature traceability link.
for (const variant of [
  {},
  { feature: 'overall_height', value: 3, category: 'overall_height', bucket: 'linear_v' },
  { feature: 'base_width', view: 'top', value: 60, category: 'overall_height', bucket: 'linear_v' },
]) {
  const artifacts = makeAutoCoveredArtifacts(variant);
  artifacts.traceability.links = artifacts.traceability.links.filter((link) => link.dim_id !== 'WIDTH');
  artifacts.traceability.summary.unresolved_dimensions = ['WIDTH'];
  artifacts.traceability.summary.linked_dimensions = 2;
  const original = structuredClone(artifacts);
  const summary = buildDrawingQualitySummary(artifacts);
  assert.equal(summary.dimensions.mapped_count, 3, 'rendered auto extent should cover its plan dimension');
  assert.equal(summary.dimensions.coverage_percent, 100);
  assert.deepEqual(summary.dimensions.missing_required_intents, []);
  assert.equal(summary.dimensions.auto_represented_count, 1);
  assert.deepEqual(summary.dimensions.auto_represented_dimensions, [{
    dim_id: 'WIDTH', auto_dim_id: artifacts.dimensionMap.auto_dimensions[0].dim_id,
    feature: variant.feature || 'base_length', view: variant.view || 'front',
    category: variant.category || 'overall_width', value_mm: variant.value || 120,
    svg_element_id: artifacts.dimensionMap.auto_dimensions[0].svg_element_id,
    evidence: 'current_svg_auto_extent',
  }]);
  assert.equal(summary.dimensions.duplicate_count, 1);
  assert.equal(summary.traceability.coverage_percent, 66.67);
  assert.deepEqual(summary.traceability.unmapped_required_entities, ['WIDTH']);
  assert.equal(shouldFailDrawingQualityGate(summary, { strictQuality: true }), true);
  assert.equal(shouldFailDrawingQualityGate(summary), false);
  assert.deepEqual(artifacts, original, 'coverage must not rewrite canonical renderer or traceability records');
}

const invalidAutoEvidence = {
  'no final SVG': (a) => { a.svgContent = null; },
  'no matching SVG element': (a) => { a.svgContent = '<svg><text>120</text></svg>'; },
  'changed final label': (a) => { a.svgContent = a.svgContent.replace('>120<', '>119<'); },
  'wrong SVG view': (a) => { a.svgContent = a.svgContent.replace('dimensions-front', 'dimensions-top'); },
  'wrong label orientation': (a) => { a.svgContent = a.svgContent.replace('<text ', '<text transform="rotate(-90,10,10)" '); },
  'ambiguous SVG id': (a) => { a.svgContent = a.svgContent.replace('</svg>', '<text id="auto_front_001">120</text></svg>'); },
  'commented SVG label': (a) => { a.svgContent = `<!--${a.svgContent}--><svg/>`; },
  'hidden SVG group': (a) => { a.svgContent = a.svgContent.replace('<g ', '<g display="none" '); },
  'hidden SVG label': (a) => { a.svgContent = a.svgContent.replace('<text ', '<text style="display:none" '); },
  'missing auto entry': (a) => { a.dimensionMap.auto_dimensions = []; },
  'ambiguous auto id': (a) => { a.dimensionMap.auto_dimensions.push({ ...a.dimensionMap.auto_dimensions[0] }); },
  'legacy entry without SVG identity': (a) => { delete a.dimensionMap.auto_dimensions[0].svg_element_id; },
  'auto was not rendered': (a) => { a.dimensionMap.auto_dimensions[0].status = 'skipped_layout'; },
  'different view': (a) => { a.dimensionMap.auto_dimensions[0].view = 'top'; },
  'chain segment is not an extent': (a) => { a.dimensionMap.auto_dimensions[0].category = 'chain_horizontal'; },
  'nearby value is insufficient': (a) => { a.dimensionMap.plan_dimensions[0].value_mm = 119.8; },
  'missing numeric value': (a) => { a.dimensionMap.plan_dimensions[0].value_mm = null; },
  'value-only policy': (a) => { a.dimensionMap.plan_dimensions[0].dedupe_match.policy = 'value_only'; },
  'legacy numeric match': (a) => { a.dimensionMap.plan_dimensions[0].dedupe_match.source = 'legacy_values'; },
  'stale dedupe reference': (a) => { a.dimensionMap.plan_dimensions[0].dedupe_match.auto_dim_id = 'other'; },
  'stale dedupe category': (a) => { a.dimensionMap.plan_dimensions[0].dedupe_match.auto_category = 'chain_horizontal'; },
  'stale dedupe value': (a) => { a.dimensionMap.plan_dimensions[0].dedupe_match.auto_value_mm = 119.8; },
  'wrong dimension style': (a) => { a.dimensionMap.plan_dimensions[0].style = 'diameter'; },
  'not skipped as duplicate': (a) => { a.dimensionMap.plan_dimensions[0].status = 'skipped_no_anchor'; },
};
for (const [name, invalidate] of Object.entries(invalidAutoEvidence)) {
  const artifacts = makeAutoCoveredArtifacts();
  invalidate(artifacts);
  const summary = buildDrawingQualitySummary(artifacts);
  assert.equal(summary.dimensions.mapped_count, 2, name);
  assert.deepEqual(summary.dimensions.missing_required_intents, ['WIDTH'], name);
  assert.equal(summary.dimensions.auto_represented_count, undefined, name);
  assert.equal(summary.dimensions.auto_represented_dimensions, undefined, name);
}

for (const feature of ['web_height', 'mounting_hole_diameter', 'unknown_feature']) {
  const summary = buildDrawingQualitySummary(makeAutoCoveredArtifacts({
    feature, value: 3, category: 'overall_height', bucket: 'linear_v',
  }));
  assert.equal(summary.dimensions.mapped_count, 2, `equal value cannot prove ${feature}`);
}

{
  const artifacts = makeAutoCoveredArtifacts();
  artifacts.traceability = null;
  artifacts.drawingIntent = { required_dimensions: [{ id: 'WIDTH', feature: 'base_length' }] };
  const summary = buildDrawingQualitySummary(artifacts);
  assert.equal(summary.semantic_quality.required_dimensions_present, 1);
  assert.deepEqual(summary.semantic_quality.missing_required_dimensions, []);
  assert.deepEqual(summary.semantic_quality.traceability.unknown_required_dimensions, ['WIDTH']);
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
  assert.equal(summary.layout_readability.status, 'ok');
  assert.equal(summary.layout_readability.evidence_state, 'partial');
  assert.equal(summary.layout_readability.completeness_state, 'partial');
  assert.equal(summary.layout_readability.advisory_only, true);
  assert.equal(summary.layout_readability.score, null);
  assert.equal(summary.layout_readability.warning_count, 0);
  assert.equal(summary.layout_readability.provenance.source_completeness.layout_report.completeness_state, 'complete');
  assert.equal(summary.layout_readability.provenance.source_completeness.qa_metrics.completeness_state, 'partial');
  assert.equal(summary.layout_readability.provenance.source_completeness.svg_view_metadata.completeness_state, 'partial');
}

{
  const summary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    qaReport: {
      score: 94,
      metrics: {
        overflow_count: 0,
        text_overlap_pairs: 1,
        dim_overlap_pairs: 1,
        notes_overflow: true,
      },
      details: {
        overflows: [],
        text_overlaps: [{ text1: '12', text2: 'R6', iou: 0.33, view: 'front' }],
      },
    },
    layoutReport: {
      views: {
        front: { label: 'Front', fit: { overflow: true } },
        top: { label: 'Top', fit: { overflow: false } },
        right: { label: 'Right', fit: { overflow: false } },
      },
      summary: {
        view_count: 3,
        overflow_views: [],
        all_within_limits: true,
      },
    },
  });

  assert.equal(summary.status, 'pass');
  assert.deepEqual(summary.blocking_issues, []);
  assert.equal(summary.layout_readability.status, 'warning');
  assert.equal(summary.layout_readability.advisory_only, true);
  assert.equal(summary.layout_readability.warning_count, 4);
  assert.deepEqual(
    summary.layout_readability.findings.map((entry) => entry.type),
    ['view_crowding', 'text_overlap', 'dimension_overlap', 'title_block_clearance']
  );
  assert.deepEqual(
    [...new Set(summary.layout_readability.findings.map((entry) => entry.source_kind))].sort(),
    ['layout_report', 'qa_metrics']
  );
  assert.equal(summary.layout_readability.findings.every((entry) => entry.advisory_only === true), true);
  assert.equal(summary.layout_readability.findings.every((entry) => entry.provenance?.source_kind), true);
  assert.equal(summary.recommended_actions.some((entry) => entry.includes('Reduce scale or improve spacing for view Front.')), true);
  assert.equal(summary.recommended_actions.some((entry) => entry.includes('title block')), true);
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
  assert(summary.semantic_quality.required_blockers.some((entry) => entry.includes('WIDTH')));
  assert(summary.semantic_quality.required_blockers.some((entry) => entry.includes('MATERIAL')));
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

{
  const summary = buildDrawingQualitySummary(makeBaseArtifacts());
  assert.equal(summary.reviewer_feedback.status, 'none');
  assert.equal(summary.reviewer_feedback.total_count, 0);
  assert.deepEqual(summary.reviewer_feedback.items, []);
}

{
  const summary = buildDrawingQualitySummary({
    ...makeBaseArtifacts(),
    drawingIntent: {
      required_dimensions: [
        { id: 'WIDTH', feature: 'body_width' },
      ],
      required_notes: ['MACHINED PART'],
      required_views: ['front'],
    },
    extractedDrawingSemanticsPath: '/tmp/ks_bracket_extracted_drawing_semantics.json',
    extractedDrawingSemantics: {
      schema_version: '0.1',
      status: 'partial',
      methods: ['svg_dimension_text_scan'],
      sources: [],
      dimensions: [
        {
          id: 'svg_text_001',
          raw_text: '40',
          matched_intent_id: 'WIDTH',
          matched_feature_id: 'body_width',
        },
      ],
      notes: [],
      views: [],
      coverage: {
        required_dimensions_total: 1,
        required_dimensions_extracted: 1,
        required_notes_total: 1,
        required_notes_extracted: 0,
        required_views_total: 1,
        required_views_extracted: 0,
      },
      unknowns: [],
      limitations: [],
    },
    reviewerFeedbackPath: '/tmp/reviewer_feedback.json',
    reviewerFeedback: {
      schema_version: '0.1',
      source: 'manual_review',
      items: [
        {
          id: 'RF-001',
          reviewer_label: 'QA reviewer',
          target_type: 'required_dimension',
          target_id: 'WIDTH',
          category: 'dimension_review',
          status: 'open',
          severity: 'warning',
          comment: 'Confirm the WIDTH callout is still legible after the latest layout change.',
          requested_action: 'Verify the WIDTH dimension text against the linked extracted evidence.',
        },
        {
          id: 'RF-002',
          reviewer_label: 'QA reviewer',
          target_type: 'required_note',
          target_id: 'SURFACE_FINISH',
          category: 'note_review',
          status: 'accepted',
          severity: 'info',
          comment: 'Surface finish feedback was accepted earlier.',
        },
        {
          id: 'RF-003',
          reviewer_label: 'QA reviewer',
          target_type: 'required_view',
          target_id: 'detail_z',
          category: 'view_review',
          status: 'question',
          severity: 'warning',
          comment: 'Check whether the referenced detail view changed or was removed.',
        },
      ],
    },
  });

  assert.equal(summary.status, 'pass');
  assert.equal(summary.reviewer_feedback.status, 'partial');
  assert.equal(summary.reviewer_feedback.total_count, 3);
  assert.equal(summary.reviewer_feedback.unresolved_count, 2);
  assert.equal(summary.reviewer_feedback.linked_count, 1);
  assert.equal(summary.reviewer_feedback.stale_count, 2);
  assert.equal(summary.reviewer_feedback.accepted_count, 1);
  assert.equal(summary.reviewer_feedback.items.find((entry) => entry.id === 'RF-001')?.link_status, 'linked');
  assert.equal(summary.reviewer_feedback.items.find((entry) => entry.id === 'RF-003')?.link_status, 'stale');
  assert.equal(summary.reviewer_feedback.suggested_actions.some((entry) => entry.includes('RF-001')), true);
  assert.equal(summary.recommended_actions.some((entry) => entry.includes('RF-001')), true);
  assert.equal(summary.reviewer_feedback.items.find((entry) => entry.id === 'RF-002')?.resolution_state, 'accepted');
}

console.log('drawing-quality-summary.test.js: ok');
