import assert from 'node:assert/strict';

import {
  buildDrawingPlanner,
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

console.log('drawing-planner.test.js: ok');
