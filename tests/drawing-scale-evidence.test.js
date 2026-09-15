import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDrawingQualitySummary, shouldFailDrawingQualityGate } from '../src/services/drawing/drawing-quality-summary.js';
import { currentTraceability } from '../src/services/drawing/current-traceability.js';

function quality(scale) {
  return buildDrawingQualitySummary({
    drawingSvgPath: '/tmp/scale.svg', qaReport: { score: 100 }, qaIssues: { issues: [] },
    layoutReport: { scale, views: { top: {} }, summary: { overflow_views: [] } },
    dimensionMap: { plan_dimensions: [], auto_dimensions: [] },
    dimConflicts: { conflicts: [], summary: { count: 0 } }, traceability: { links: [] },
  });
}

test('fit adjustment of an explicit scale emits a finding and fails only the strict gate', () => {
  const result = quality({ mode: 'explicit', requested: '1:1', requested_factor: 1,
    effective_factor: 0.75056023, label: '1:1.332338' });
  assert.equal(result.status, 'fail');
  const issue = result.blocking_issues.find((entry) => entry.code === 'explicit-scale-unmet');
  assert.ok(issue, JSON.stringify(result.blocking_issues));
  assert.equal(result.scale.requested_factor, 1);
  assert.equal(result.scale.effective_factor, 0.75056023);
  assert.equal(shouldFailDrawingQualityGate(result), false);
  assert.equal(shouldFailDrawingQualityGate(result, { strictQuality: true }), true);
});

test('automatic fitting and met explicit scales do not report an explicit-scale violation', () => {
  for (const scale of [
    { mode: 'auto', requested_factor: null, effective_factor: 0.5, fit_adjusted: true },
    { mode: 'explicit', requested: '1:2', requested_factor: 0.5, effective_factor: 0.5 },
  ]) {
    assert.equal(quality(scale).status, 'pass');
    assert.equal(shouldFailDrawingQualityGate(quality(scale), { strictQuality: true }), false);
  }
});

test('plan diameter runtime links require the emitted SVG identity and measured center', () => {
  const entry = { dim_id: 'HOLE_DIA', view: 'top', style: 'diameter', value_mm: 5.2,
    rendered: true, svg_element_id: 'plan_top_001', center_uv: [12, 12] };
  const trace = { links: [{ dim_id: 'HOLE_DIA', feature_id: 'hole_1', source: 'freecad_runtime',
    represented_by: 'HOLE_DIA', svg_element_id: 'plan_top_001',
    evidence: { model_value_mm: 5.2, measurement: 'cylindrical_faces', center_uv: [12, 12] } }] };
  const svg = '<svg><g class="dimensions-top plan-dimensions-top"><text id="plan_top_001" data-dim-id="HOLE_DIA" data-center-u="12" data-center-v="12">Ø5.2</text></g></svg>';
  const linked = (drawing, dimension = entry) => currentTraceability(trace,
    { plan_dimensions: [dimension] }, drawing, new Map()).links[0].feature_id;
  assert.equal(linked(svg), 'hole_1');
  for (const altered of [
    svg.replace('data-center-u="12"', 'data-center-u="120"'),
    svg.replace('data-center-v="12"', ''),
    svg.replace('id="plan_top_001"', 'id="unrelated"'),
    svg.replace('>Ø5.2<', '>Ø5.3<'),
  ]) assert.equal(linked(altered), null, altered);
  assert.equal(linked(svg, { ...entry, center_uv: [120, 12] }), null);
});
