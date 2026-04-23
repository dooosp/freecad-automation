import assert from 'node:assert/strict';

import {
  buildDrawingPlanner,
  buildPlannerActionsFromExtractedCoverage,
  buildPlannerActionsFromLayoutReadability,
  buildPlannerActionsFromReviewerFeedback,
  refineDrawingPlannerWithExtractedCoverage,
  refineDrawingPlannerWithLayoutReadability,
  refineDrawingPlannerWithReviewerFeedback,
} from '../src/services/drawing/drawing-planner.js';

function makePlateConfig() {
  return {
    name: 'planner_plate',
    manufacturing: {
      material: 'AL6061',
    },
    shapes: [
      { id: 'plate', type: 'box', length: 160, width: 100, height: 8 },
      { id: 'hole_left', type: 'cylinder', radius: 3, height: 12, position: [30, 30, -2] },
      { id: 'hole_right', type: 'cylinder', radius: 5, height: 12, position: [125, 70, -2] },
    ],
    operations: [
      { op: 'cut', base: 'plate', tool: 'hole_left', result: 'body' },
      { op: 'cut', base: 'body', tool: 'hole_right', result: 'body' },
    ],
    drawing: {
      views: ['top', 'iso'],
      meta: {
        material: 'AL6061',
      },
      style: {
        show_centerlines: true,
      },
    },
    drawing_plan: {
      part_type: 'generic',
      views: { enabled: ['top', 'iso'] },
      dim_intents: [
        { id: 'HOLE_LEFT_DIA', feature: 'hole_left', view: 'top', style: 'diameter', required: true },
      ],
    },
  };
}

{
  const config = makePlateConfig();
  const first = buildDrawingPlanner({ config });
  const second = buildDrawingPlanner({ config });

  assert.deepEqual(first, second, 'planner output should be deterministic for the same evidence');
  assert.equal(first.status, 'advisory');
  assert.equal(first.recommended_views.find((entry) => entry.view === 'top')?.status, 'already_requested');
  assert.equal(first.recommended_views.find((entry) => entry.view === 'front')?.status, 'recommended');
  assert.equal(
    first.required_dimensions_by_feature.some((entry) => entry.feature_id === 'hole_left' && entry.dimension_type === 'diameter' && entry.status === 'planned'),
    true
  );
  assert.equal(
    first.missing_dimensions.some((entry) => entry.feature_id === 'hole_right' && entry.dimension_type === 'diameter'),
    true
  );
  assert.equal(
    first.suggested_actions.some((entry) => /hole_right/.test(entry)),
    true
  );
  assert.equal(
    first.recommended_annotations.some((entry) => /GD&T|geometric tolerance/i.test(entry.message)),
    false,
    'planner should not invent GD&T callouts'
  );
}

{
  const config = {
    name: 'body_only',
    shapes: [
      { id: 'body', type: 'box', length: 40, width: 20, height: 6 },
    ],
    operations: [],
    drawing: {
      views: ['top'],
    },
    drawing_plan: {
      views: { enabled: ['top'] },
      dim_intents: [],
    },
  };
  const plan = buildDrawingPlanner({ config });
  assert.equal(plan.required_dimensions_by_feature.some((entry) => entry.feature_type === 'through_hole'), false);
  assert.deepEqual(plan.section_view_recommendations, []);
  assert.deepEqual(plan.detail_view_recommendations, []);
  assert.equal(plan.recommended_annotations.some((entry) => /tolerance/i.test(entry.message)), false);
}

{
  const config = {
    name: 'slot_plate',
    shapes: [
      { id: 'plate', type: 'box', length: 100, width: 50, height: 8 },
      { id: 'slot', type: 'box', length: 30, width: 8, height: 12, position: [20, 10, -2] },
    ],
    operations: [
      { op: 'cut', base: 'plate', tool: 'slot', result: 'body' },
    ],
    drawing: {
      views: ['top'],
    },
    drawing_plan: {
      views: { enabled: ['top'] },
      dim_intents: [],
    },
  };
  const plan = buildDrawingPlanner({ config });
  assert.equal(
    plan.required_dimensions_by_feature.some((entry) => entry.feature_type === 'slot'),
    false,
    'planner should not promote named rectangular cuts into slot requirements without canonical feature-catalog evidence'
  );
  assert.equal(plan.section_view_recommendations.some((entry) => entry.feature_id === 'slot'), false);
}

{
  const basePlanner = {
    status: 'advisory',
    suggested_actions: ['Carry forward existing planner suggestion.'],
    section_view_recommendations: [
      {
        feature_id: 'slot_001',
        feature_type: 'slot',
      },
    ],
  };
  const extractedEvidence = {
    status: 'partial',
    required_dimensions: [
      {
        requirement_id: 'SLOT_DEPTH',
        requirement_label: 'Slot depth',
        classification: 'unknown',
        candidate_matches: [],
      },
      {
        requirement_id: 'SLOT_DEPTH',
        requirement_label: 'Slot depth',
        classification: 'unknown',
        candidate_matches: [],
      },
    ],
    required_notes: [],
    required_views: [],
    unmatched_dimensions: [],
    unmatched_notes: [],
  };
  const details = buildPlannerActionsFromExtractedCoverage({
    drawingIntent: {
      required_dimensions: [
        { id: 'SLOT_DEPTH', label: 'Slot depth', feature: 'slot_001', dimension_type: 'depth', required: true },
      ],
    },
    featureCatalog: {
      features: [
        { feature_id: 'slot_001', type: 'slot' },
      ],
    },
    planner: basePlanner,
    extractedEvidence,
  });
  assert.equal(details.length, 1);
  assert.equal(details[0].classification, 'unknown');
  assert.equal(details[0].category, 'dimension');
  assert.equal(details[0].recommended_fix.includes('section view through slot_001'), true);

  const refinedPlanner = refineDrawingPlannerWithExtractedCoverage({
    planner: basePlanner,
    drawingIntent: {
      required_dimensions: [
        { id: 'SLOT_DEPTH', label: 'Slot depth', feature: 'slot_001', dimension_type: 'depth', required: true },
      ],
    },
    featureCatalog: {
      features: [
        { feature_id: 'slot_001', type: 'slot' },
      ],
    },
    extractedEvidence,
  });
  assert.equal(refinedPlanner.suggested_action_details.length, 1);
  assert.equal(refinedPlanner.suggested_actions.some((entry) => entry.includes('SLOT_DEPTH') || entry.includes('Slot depth')), true);
  assert.equal(refinedPlanner.suggested_actions.some((entry) => entry.includes('section view through slot_001')), true);
}

{
  const details = buildPlannerActionsFromExtractedCoverage({
    drawingIntent: {
      required_dimensions: [
        { id: 'BASE_PLATE_ENVELOPE', label: 'Base plate length and width', feature: 'base_plate', dimension_type: 'linear', required: true },
      ],
    },
    featureCatalog: {
      features: [
        { feature_id: 'base_plate', type: 'plate' },
      ],
    },
    planner: {
      status: 'advisory',
      suggested_actions: [],
      section_view_recommendations: [],
    },
    extractedEvidence: {
      status: 'partial',
      required_dimensions: [
        {
          requirement_id: 'BASE_PLATE_ENVELOPE',
          requirement_label: 'Base plate length and width',
          classification: 'unknown',
          candidate_matches: [],
        },
      ],
      required_notes: [],
      required_views: [],
      unmatched_dimensions: ['120', '80'],
      unmatched_notes: [],
      coverage: {
        total_missing: 0,
        total_unknown: 1,
        total_unsupported: 0,
      },
    },
  });

  assert.equal(details.length >= 1, true);
  assert.equal(details[0].classification, 'unknown');
  assert.equal(details[0].recommended_fix.includes('overall length and width callouts for base_plate'), true);
  assert.equal(details[0].recommended_fix.includes('without inferring a combined envelope'), true);
}

{
  const plan = buildDrawingPlanner({
    config: makePlateConfig(),
    drawingIntent: {
      recommended_views: [
        {
          id: 'section_a_a',
          label: 'Section A-A',
          view_kind: 'section',
          feature: 'hole_left',
          reason: 'Optional section view for crowded callouts.',
        },
        {
          id: 'detail_b',
          label: 'Detail B',
          view_kind: 'detail',
          feature: 'hole_left',
          source_view: 'top',
          reason: 'Optional detail view for small hole readability.',
        },
      ],
    },
  });

  assert.equal(plan.recommended_views.some((entry) => entry.view === 'section_a_a' && entry.status === 'recommended'), true);
  assert.equal(plan.recommended_views.some((entry) => entry.view === 'detail_b' && entry.status === 'recommended'), true);
  assert.equal(plan.suggested_actions.some((entry) => entry.includes('distinct labeled view region')), true);
}

{
  const layoutActions = buildPlannerActionsFromLayoutReadability({
    status: 'warning',
    findings: [
      {
        type: 'text_overlap',
        severity: 'warning',
        message: 'Structured QA evidence shows overlapping drawing text.',
        recommendation: 'Separate overlapping note or dimension text and reroute leaders if needed.',
        view_ids: ['front'],
        source_kind: 'qa_metrics',
        evidence_state: 'available',
        completeness_state: 'complete',
        raw_source: {
          path: '/tmp/layout_warning_qa.json',
          method: 'qa_vector_text_overlap',
        },
      },
    ],
  });
  assert.equal(layoutActions.length, 1);
  assert.equal(layoutActions[0].category, 'layout');
  assert.equal(layoutActions[0].classification, 'text_overlap');
  assert.equal(
    layoutActions[0].evidence.some((entry) => entry.path === 'findings.0.source_kind' && entry.value === 'qa_metrics'),
    true
  );
  assert.equal(
    layoutActions[0].evidence.some((entry) => entry.path === 'findings.0.completeness_state' && entry.value === 'complete'),
    true
  );

  const refinedPlanner = refineDrawingPlannerWithLayoutReadability({
    planner: {
      status: 'advisory',
      suggested_actions: ['Carry forward existing planner suggestion.'],
      suggested_action_details: [],
    },
    layoutReadability: {
      status: 'warning',
      findings: [
        {
          type: 'text_overlap',
          severity: 'warning',
          message: 'Structured QA evidence shows overlapping drawing text.',
          recommendation: 'Separate overlapping note or dimension text and reroute leaders if needed.',
          view_ids: ['front'],
          source_kind: 'qa_metrics',
          evidence_state: 'available',
          completeness_state: 'complete',
          raw_source: {
            path: '/tmp/layout_warning_qa.json',
            method: 'qa_vector_text_overlap',
          },
        },
      ],
    },
  });
  assert.equal(refinedPlanner.suggested_action_details.length, 1);
  assert.equal(refinedPlanner.suggested_actions.some((entry) => entry.includes('overlapping drawing text')), true);
  assert.equal(refinedPlanner.suggested_actions.some((entry) => entry.includes('Separate overlapping note or dimension text')), true);
}

{
  const reviewerFeedback = {
    status: 'partial',
    items: [
      {
        id: 'RF-001',
        status: 'open',
        resolution_state: 'unresolved',
        severity: 'warning',
        link_status: 'linked',
        target_type: 'required_dimension',
        target_id: 'WIDTH',
        comment: 'Confirm the WIDTH dimension still matches the linked evidence.',
        requested_action: 'Verify WIDTH before closing the feedback item.',
      },
      {
        id: 'RF-002',
        status: 'question',
        resolution_state: 'unresolved',
        severity: 'warning',
        link_status: 'stale',
        target_type: 'planner_action',
        target_id: 'layout:text-overlap',
        comment: 'Check whether the underlying planner action changed after the layout update.',
      },
      {
        id: 'RF-003',
        status: 'accepted',
        resolution_state: 'accepted',
        severity: 'info',
        link_status: 'linked',
        target_type: 'required_note',
        target_id: 'MATERIAL',
        comment: 'Already accepted.',
      },
    ],
  };

  const details = buildPlannerActionsFromReviewerFeedback(reviewerFeedback);
  assert.equal(details.length, 2);
  assert.equal(details.some((entry) => entry.id.includes('reviewer-feedback:rf001')), true);
  assert.equal(details.some((entry) => entry.classification === 'stale'), true);
  assert.equal(details.every((entry) => entry.category === 'reviewer_feedback'), true);

  const refinedPlanner = refineDrawingPlannerWithReviewerFeedback({
    planner: {
      status: 'advisory',
      suggested_actions: ['Carry forward existing planner suggestion.'],
      suggested_action_details: [],
    },
    reviewerFeedback,
  });
  assert.equal(refinedPlanner.suggested_action_details.length, 2);
  assert.equal(refinedPlanner.suggested_actions.some((entry) => entry.includes('RF-001')), true);
  assert.equal(refinedPlanner.suggested_actions.some((entry) => entry.includes('WIDTH')), true);
  assert.equal(refinedPlanner.suggested_actions.some((entry) => entry.includes('RF-003')), false);
}

console.log('drawing-planner.test.js: ok');
