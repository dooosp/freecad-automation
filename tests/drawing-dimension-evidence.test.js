import assert from 'node:assert/strict';
import { hasObservedDimension } from '../lib/drawing-dimension-evidence.js';
import { buildExtractedDrawingSemantics, compareDrawingIntentToExtractedSemantics, validateExtractedDrawingSemantics } from '../src/services/drawing/extracted-drawing-semantics.js';
import { buildDrawingQualitySummary } from '../src/services/drawing/drawing-quality-summary.js';

// Unit fixture, not FreeCAD evidence. Literal endpoints describe plate Z=0..4.
export const observation = {
  source: 'freecad_final_topology', status: 'resolved', dim_id: 'THK',
  feature_ids: ['plate'], view: 'front', style: 'linear', value_mm: 4,
  measurement: 'extent:2', requirement_ids: ['PLATE_THICKNESS'],
  members: [{ feature_id: 'plate', value_mm: 4, points_model_mm: [[0,0,0],[0,0,4]],
    points_uv_mm: [[0,0],[0,4]], final_edge_indices: [0] }],
};
const requirement = { id: 'PLATE_THICKNESS', feature: 'plate', value_mm: 4,
  view: 'front', dimension_type: 'linear', required: true };
const drawingIntent = { required_dimensions: [requirement], critical_features: [{ id: 'other', required: true }] };
const escape = value => JSON.stringify(value).replaceAll('&','&amp;').replaceAll('"','&quot;');
const label = (o = observation, raw = '4', id = 'THK') => `<text data-dim-id="${id}" data-observation="${escape(o)}">${raw}</text>`;
const extract = svg => buildExtractedDrawingSemantics({ svgContent: `<svg>${svg}</svg>`, drawingSvgPath: '/tmp/unit.svg', drawingIntent });
const valid = extract(label());
assert.equal(validateExtractedDrawingSemantics(valid).ok, true);
assert.equal(valid.coverage.required_dimensions_extracted, 1);
assert.equal(valid.dimensions[0].emitted_dim_id, 'THK');
assert.equal(valid.dimensions[0].matched_feature_id, 'plate');
assert.deepEqual(valid.dimensions[0].observation, observation);
for (const mutate of [
  o => { o.feature_ids = ['other']; }, o => { o.view = 'top'; },
  o => { o.style = 'diameter'; }, o => { o.source = 'config'; },
  o => { o.status = 'unresolved'; }, o => { o.value_mm = null; },
  o => { o.members[0].points_model_mm[1][2] = 8; },
  o => { o.members[0].points_uv_mm[1][1] = 8; },
  o => { o.members[0].points_model_mm[1][0] = 8; o.members[0].points_uv_mm[1][0] = 8; },
  o => { o.members[0].final_edge_indices = []; },
  o => { o.members = [null]; }, o => { o.feature_ids.push('other'); },
  o => { o.requirement_ids.push('OTHER'); },
  o => { o.requirement_ids = {}; },
  o => { o.feature_ids = ['']; o.members[0].feature_id = ''; },
]) {
  const changed = structuredClone(observation); mutate(changed);
  const result = extract(label(changed));
  assert.equal(result.coverage.required_dimensions_extracted, 0, JSON.stringify(changed));
  assert.equal(result.dimensions[0].matched_intent_id, null);
}
for (const svg of [label(observation,'8'), label(observation,'4','OTHER'),
  label(observation,'4 cm'), label(observation,'4 in'), label(observation,'Ø4'),
  label(observation,'PLATE_THICKNESS 4 in'),
  label() + label(observation,'8'), '<text data-dim-id="THK" data-observation="bad">4</text>']) {
  assert.equal(extract(svg).coverage.required_dimensions_extracted, 0);
}
assert.equal(extract(label()+label()).coverage.required_dimensions_extracted, 1);
assert.equal(extract(label().replace('<text ','<text fill="rgb(0,0,0)" ')).coverage.required_dimensions_extracted,1);
for (const svg of [
  `<defs>${label()}</defs>`, `<!-- ${label()} -->`, `<g display="none">${label()}</g>`,
  `<g style="opacity:0">${label()}</g>`, `<g data-view-id="top">${label()}</g>`,
  `<g data-feature-id="other">${label()}</g>`, `<g data-style="diameter">${label()}</g>`,
  label().replace('<text ', '<text fill="none" stroke="none" '),
  label().replace('<text ', '<text font-size="0" '),
  label().replace('data-dim-id="THK"', 'data-dim-id="OTHER" data-dim-id="THK"'),
  label().replace('data-dim-id="THK"', 'data-dim-id=OTHER data-dim-id="THK"'),
  label().replace('<text ', '<text data-value-mm="8" '),
  `<g style="opacity:0.0!important">${label()}</g>`,
  `<g transform="scale(0)">${label()}</g>`,
  label().replace('<text ', '<text fill="rgba(0,0,0,0)" '),
  label().replace('<text ', '<text style="fill:none!important;stroke:none!important" '),
  label().replace('<text ', '<text style="fill-opacity:0!important;stroke:none" '),
]) assert.equal(extract(svg).coverage.required_dimensions_extracted, 0, svg);
const forgedLegacy = structuredClone(valid);
delete forgedLegacy.dimensions[0].observation;
assert.equal(compareDrawingIntentToExtractedSemantics(drawingIntent, forgedLegacy).coverage.required_dimensions.extracted, 0);

const row = { dim_id: 'THK', feature: 'plate', view: 'front', style: 'linear',
  required: true, rendered: true, status: 'rendered', value_mm: 4, observation };
const quality = (plan, semantics = null) => buildDrawingQualitySummary({ drawingIntent,
  dimensionMap: { plan_dimensions: [plan] }, extractedDrawingSemantics: semantics,
  traceability: { links: [{ dim_id: 'FAKE', feature_id: 'other' }] } });
assert.equal(hasObservedDimension(row, requirement), true);
assert.equal(quality(row, valid).semantic_quality.required_dimensions_present, 1);
assert.equal(quality({ ...row, observation: null }).semantic_quality.required_dimensions_present, 0);
assert.equal(quality(row, valid).semantic_quality.critical_features_covered, 0);
assert.equal(buildDrawingQualitySummary({ drawingIntent, dimensionMap: { plan_dimensions:[row] },
  extractedDrawingSemantics:valid, svgContent:'<svg/>',
}).semantic_quality.required_dimensions_present,0);
const emptySvgQuality = buildDrawingQualitySummary({ drawingSvgPath:'/tmp/unit.svg', drawingIntent,
  dimensionMap:{plan_dimensions:[row]}, extractedDrawingSemantics:valid, svgContent:'<svg/>',
  qaReport:{}, layoutReport:{}, dimConflicts:{}, traceability:{} });
assert.equal(emptySvgQuality.dimensions.mapped_count,0);
assert(emptySvgQuality.blocking_issues.some(i => i.code === 'required-dimension-coverage'));
const conflictingSvgQuality = buildDrawingQualitySummary({ drawingSvgPath:'/tmp/unit.svg', drawingIntent,
  dimensionMap:{plan_dimensions:[row]}, svgContent:`<svg>${label()}${label(observation,'8')}</svg>`,
  qaReport:{}, layoutReport:{}, dimConflicts:{}, traceability:{} });
assert.equal(conflictingSvgQuality.dimensions.mapped_count,0);
for (const field of ['matched_feature_id','feature_id']) {
  assert.equal(hasObservedDimension({ ...valid.dimensions[0], [field]:'other' },requirement),false);
}
console.log('Drawing dimension evidence regressions passed (unit fixtures).');
