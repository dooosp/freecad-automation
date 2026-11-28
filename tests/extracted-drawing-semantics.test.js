import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { standoffRuntimeInput, invalidStandoffCases, STANDOFF_GROUP } from './helpers/standoff-runtime-evidence.js';
import { pcbRuntimeInput } from './helpers/pcb-runtime-evidence.js';

import {
  buildExtractedDrawingSemantics,
  compareDrawingIntentToExtractedSemantics,
  resolveExtractedDrawingSemanticsPath,
  validateExtractedDrawingSemantics,
} from '../src/services/drawing/extracted-drawing-semantics.js';

const ROOT = resolve(import.meta.dirname, '..');

{
  const input = pcbRuntimeInput();
  const result = buildExtractedDrawingSemantics(input);
  for (const id of ['PLATE_LENGTH', 'PLATE_WIDTH', 'MOUNTING_HOLE_DIA', 'MOUNTING_HOLE_PATTERN_X',
    'MOUNTING_HOLE_PATTERN_Y', 'CONNECTOR_SLOT_SIZE', 'CONNECTOR_SLOT_POSITION']) {
    const matches = result.dimensions.filter((dimension) => dimension.matched_intent_id === id);
    assert.equal(matches.length, 1, `${id} must resolve only through its measured current annotation`);
    assert.equal(matches[0].provenance.method, 'svg_runtime_pcb_dimension');
  }
  assert.deepEqual(result.dimensions.find((dimension) => dimension.matched_intent_id === 'CONNECTOR_SLOT_SIZE')
    .provenance.supporting_dimension_ids, ['CONNECTOR_SLOT_WIDTH']);
}

for (const [id, invalidate] of [
  ['CONNECTOR_SLOT_SIZE', (input) => { input.dimensionMap.plan_dimensions.find((d) => d.dim_id === 'CONNECTOR_SLOT_WIDTH').rendered = false; }],
  ['CONNECTOR_SLOT_POSITION', (input) => { delete input.dimensionMap.plan_dimensions.find((d) => d.dim_id === 'CONNECTOR_SLOT_POSITION').runtime_binding.explicit_reference; }],
  ['MOUNTING_HOLE_DIA', (input) => { input.dimensionMap.plan_dimensions.find((d) => d.dim_id === 'MOUNTING_HOLE_DIA').runtime_binding.members.pop(); }],
  ['MOUNTING_HOLE_DIA', (input) => { input.svgContent = input.svgContent.replace('x1="88.25"', 'x1="138.75"'); }],
  ['MOUNTING_HOLE_PATTERN_X', (input) => { input.dimensionMap.plan_dimensions.find((d) => d.dim_id === 'MOUNTING_HOLE_PATTERN_X').runtime_binding.verification_pairs_3d_mm.pop(); }],
  ['PLATE_WIDTH', (input) => { input.svgContent = input.svgContent.replace('<text data-dim-id="PLATE_WIDTH"', '<text data-dim-id="OTHER"'); }],
  ['MOUNTING_HOLE_DIA', (input) => { input.svgContent = input.svgContent.replace('<circle cx="87.25" cy="86.5" r="1"/>', ''); }],
  ['PLATE_LENGTH', (input) => {
    input.svgContent = input.svgContent.replace(/<line data-dimension-line="linear" data-dim-id="PLATE_LENGTH"[^>]*>/,
      (line) => line.replace(/x([12])="([^"]+)"/g, (_, end, value) => `x${end}="${Number(value) + 10}"`));
  }],
  ['PLATE_WIDTH', (input) => { input.svgContent = input.svgContent.replace('<text data-dim-id="PLATE_WIDTH">98', '<text data-dim-id="PLATE_WIDTH">99'); }],
  ['PLATE_LENGTH', (input) => {
    delete input.dimensionMap.plan_dimensions.find((d) => d.dim_id === 'PLATE_LENGTH').runtime_binding;
    input.traceability.links.find((d) => d.dim_id === 'PLATE_LENGTH').source = 'legacy';
  }],
  ['CONNECTOR_SLOT_POSITION', (input) => {
    for (const item of [input.dimensionMap.plan_dimensions.find((d) => d.dim_id === 'CONNECTOR_SLOT_POSITION').runtime_binding,
      input.traceability.links.find((d) => d.dim_id === 'CONNECTOR_SLOT_POSITION').evidence]) {
      item.explicit_reference.to.boundary = 'center';
    }
  }],
  ['MOUNTING_HOLE_PATTERN_Y', (input) => {
    for (const item of [input.dimensionMap.plan_dimensions.find((d) => d.dim_id === 'MOUNTING_HOLE_PATTERN_Y').runtime_binding,
      input.traceability.links.find((d) => d.dim_id === 'MOUNTING_HOLE_PATTERN_Y').evidence]) {
      item.verification_pairs_3d_mm[1][1][1] = 75;
    }
  }],
]) {
  const input = pcbRuntimeInput();
  invalidate(input);
  const result = buildExtractedDrawingSemantics(input);
  assert.equal(result.dimensions.some((dimension) => dimension.matched_intent_id === id), false,
    `invalid ${id} references must not be rescued by numeric or legacy matching`);
}

for (const height of [8, 10]) {
  const result = buildExtractedDrawingSemantics(standoffRuntimeInput(height));
  const matches = result.dimensions.filter((entry) => entry.matched_intent_id === 'STANDOFF_HEIGHT');
  assert.equal(matches.length, 1, 'only the verified four-member annotation may cover standoff height');
  assert.equal(matches[0].provenance.method, 'svg_runtime_standoff_height');
  assert.deepEqual(matches[0].provenance.member_feature_ids, STANDOFF_GROUP.split(','));
  assert.equal(matches[0].value, height);
}

for (const [name, invalidate] of Object.entries(invalidStandoffCases)) {
  const input = standoffRuntimeInput();
  invalidate(input);
  const result = buildExtractedDrawingSemantics(input);
  assert.equal(result.dimensions.some((entry) => entry.matched_intent_id === 'STANDOFF_HEIGHT'), false,
    `${name} cannot be rescued by another identical numeric label`);
}

{
  const input = standoffRuntimeInput(10);
  input.svgContent = input.svgContent.replace('<text data-dim-id="STANDOFF_HEIGHT"', '<text');
  assert.equal(buildExtractedDrawingSemantics(input).dimensions.some((entry) => entry.matched_intent_id === 'STANDOFF_HEIGHT'), false);
  const reversed = standoffRuntimeInput();
  reversed.dimensionMap.plan_dimensions[0].feature = 'standoff4,standoff3,standoff2,standoff1';
  reversed.drawingIntent.required_dimensions[0].feature = 'standoff2,standoff1,standoff4,standoff3';
  assert.equal(buildExtractedDrawingSemantics(reversed).dimensions.filter((entry) => entry.matched_intent_id === 'STANDOFF_HEIGHT').length, 1);
}

for (const modifyRequirement of [
  (requirement) => { requirement.feature = 'standoff1,standoff2,standoff3'; },
  (requirement) => { requirement.view = 'top'; },
  (requirement) => { requirement.dimension_type = 'diameter'; },
]) {
  const input = standoffRuntimeInput();
  modifyRequirement(input.drawingIntent.required_dimensions[0]);
  assert.equal(buildExtractedDrawingSemantics(input).dimensions.some((entry) => entry.matched_intent_id === 'STANDOFF_HEIGHT'), false,
    'an incompatible requirement must not borrow a measured height label');
}

function finalEdgeThicknessInput(value = 4) {
  const binding = { status: 'resolved', source: 'freecad_runtime', feature_id: 'plate',
    model_object_id: 'final', measurement: 'final_edge', edge_ref: 'final:Edge6', measured_mm: value,
    endpoints_3d_mm: [[145, 0, 0], [145, 0, value]], endpoints_uv_mm: [[145, 0], [145, value]],
    bounds: [145, 0, 145, value] };
  return {
    drawingSvgPath: '/tmp/pcb_drawing.svg',
    svgContent: `<svg><g class="dimensions-front plan-dimensions-front"><text data-dim-id="THK">${value}</text></g><g class="dimensions-top"><text>Ø4</text></g></svg>`,
    dimensionMap: { plan_dimensions: [{ dim_id: 'THK', feature: 'plate', view: 'front', style: 'linear',
      value_mm: value, rendered: true, status: 'rendered', runtime_binding: binding }] },
    traceability: { links: [{ dim_id: 'THK', feature_id: 'plate', feature_key: 'plate',
      source: 'freecad_runtime', status: 'rendered', rendered: true, represented_by: 'THK',
      evidence: { ...binding, model_value_mm: value } }] },
    drawingIntent: { required_dimensions: [
      { id: 'PLATE_THICKNESS', feature: 'plate', view: 'front', dimension_type: 'linear', value_mm: value, required: true },
      { id: 'MOUNTING_HOLE_DIA', feature: 'hole1', view: 'top', dimension_type: 'diameter', value_mm: 4, required: true },
    ] },
  };
}

for (const identity of ['', 'data-dim-id="RENAMED"']) {
  const input = finalEdgeThicknessInput(5);
  input.svgContent = input.svgContent.replace('data-dim-id="THK"', identity)
    .replace('</svg>', '<g class="dimensions-top"><text>5</text></g></svg>');
  const semantics = buildExtractedDrawingSemantics(input);
  assert.equal(semantics.dimensions.some((entry) => entry.matched_intent_id === 'PLATE_THICKNESS'), false,
    'a unique automatic 5 cannot replace the missing current THK identity');
}

{
  const input = finalEdgeThicknessInput();
  input.dimensionMap.plan_dimensions[0].value_mm = 6;
  input.dimensionMap.plan_dimensions[0].rendered = false;
  input.dimensionMap.plan_dimensions[0].status = 'unresolved';
  input.svgContent = '<svg><g class="dimensions-front"><text>4</text></g></svg>';
  input.drawingIntent.required_dimensions.pop();
  assert.equal(buildExtractedDrawingSemantics(input).dimensions[0].matched_intent_id, null,
    'an automatic 4 must not rescue the deliberately wrong, unrendered THK 6');
}

{
  const semantics = buildExtractedDrawingSemantics(finalEdgeThicknessInput());
  const thickness = semantics.dimensions.find((entry) => entry.raw_text === '4');
  assert.equal(thickness.matched_intent_id, 'PLATE_THICKNESS', 'the measured THK link disambiguates the Ø4 collision');
  assert.equal(thickness.matched_feature_id, 'plate');
  assert.equal(thickness.provenance.method, 'svg_runtime_final_edge');
  assert.equal(thickness.provenance.model_edge_ref, 'final:Edge6');
  assert.equal(semantics.dimensions.find((entry) => entry.raw_text === 'Ø4').matched_intent_id, null);
}

for (const invalidate of [
  (input) => { input.dimensionMap.plan_dimensions[0].rendered = false; },
  (input) => { input.dimensionMap.plan_dimensions[0].runtime_binding.status = 'unresolved'; },
  (input) => { delete input.dimensionMap.plan_dimensions[0].runtime_binding; },
  (input) => { input.traceability.links[0].evidence = {}; },
  (input) => { input.dimensionMap.plan_dimensions[0].feature = 'slot'; },
  (input) => { input.dimensionMap.plan_dimensions[0].view = 'top'; },
  (input) => { input.dimensionMap.plan_dimensions[0].value_mm = 6; },
  (input) => { input.traceability.links[0].evidence.endpoints_3d_mm = [[145, 0, 0], [145, 0, 6]]; },
  (input) => { input.svgContent = input.svgContent.replace('>4<', '>6<'); },
  (input) => { input.svgContent = input.svgContent.replace('<text data-dim-id="THK"', '<text display="none" data-dim-id="THK"'); },
]) {
  const input = finalEdgeThicknessInput();
  // Even a unique number cannot rescue a missing or invalid measured binding.
  input.drawingIntent.required_dimensions.pop();
  invalidate(input);
  const semantics = buildExtractedDrawingSemantics(input);
  assert.equal(semantics.dimensions.some((entry) => entry.provenance.method === 'svg_runtime_final_edge'), false);
  assert.equal(semantics.dimensions.find((entry) => !entry.raw_text.startsWith('Ø')).matched_intent_id, null);
}

{
  const svgPath = join(ROOT, 'tests', 'fixtures', 'svg', 'techdraw_assembly.svg');
  const svgContent = readFileSync(svgPath, 'utf8');
  const input = {
    drawingSvgPath: svgPath,
    svgContent,
    layoutReportPath: '/tmp/assembly_layout_report.json',
    layoutReport: {
      views: {
        top: { label: 'Top View' },
        iso: { label: 'Isometric' },
      },
    },
    traceabilityPath: '/tmp/assembly_traceability.json',
    traceability: {
      links: [
        { dim_id: 'HOLE_PATTERN_DIA', feature_id: 'hole_pattern_1' },
      ],
    },
    drawingIntent: {
      required_views: ['top'],
      required_dimensions: [
        { id: 'HOLE_PATTERN_DIA', value_mm: 16, feature: 'hole_pattern_1', required: true },
      ],
      required_notes: [
        { id: 'MATERIAL', text: 'Material: AL6061', required: true },
      ],
    },
  };

  const first = buildExtractedDrawingSemantics(input);
  const second = buildExtractedDrawingSemantics(input);
  assert.deepEqual(first, second);

  const validation = validateExtractedDrawingSemantics(first);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(first.status, 'partial');
  assert(first.methods.includes('svg_text_scan'));
  assert(first.methods.includes('layout_report_views'));
  assert.equal(first.coverage.required_dimensions_extracted, 1);
  assert.equal(first.coverage.required_views_extracted, 1);
  assert.equal(first.coverage.required_notes_extracted, 0);
  assert.equal(first.dimensions.some((entry) => entry.raw_text === '2X Ø16' && entry.matched_intent_id === 'HOLE_PATTERN_DIA'), true);
  assert.equal(first.views.some((entry) => entry.id === 'top' && entry.matched_intent_id === 'top'), true);
  assert.equal(first.notes.some((entry) => entry.raw_text === '2X Ø16'), false);
  assert.equal(first.dimensions.some((entry) => entry.raw_text === '2026'), false);
  assert(first.unknowns.some((entry) => entry.includes('MATERIAL')));

  const comparison = compareDrawingIntentToExtractedSemantics(
    input.drawingIntent,
    first,
    null,
    null,
    '/tmp/assembly_extracted_drawing_semantics.json'
  );
  assert.equal(comparison.status, 'partial');
  assert.equal(comparison.file, '/tmp/assembly_extracted_drawing_semantics.json');
  assert.equal(comparison.coverage.required_dimensions.extracted, 1);
  assert.equal(comparison.coverage.required_notes.unknown, 1);
  assert.equal(comparison.coverage.required_views.extracted, 1);
  assert.equal(comparison.required_dimensions[0].classification, 'extracted');
  assert.equal(comparison.required_dimensions[0].matched_extracted_id, 'svg_text_001');
  assert.equal(comparison.required_notes[0].classification, 'unknown');
  assert.equal(comparison.required_views[0].classification, 'extracted');
  assert(comparison.unknowns.some((entry) => entry.includes('MATERIAL')));
  assert.equal(comparison.suggested_action_details.length, 1);
  assert.equal(comparison.suggested_action_details[0].category, 'note');
  assert.equal(comparison.suggested_action_details[0].classification, 'unknown');
  assert.equal(comparison.suggested_actions[0].includes('Material: AL6061'), true);
}

{
  const svgPath = '/tmp/title_block_probe_drawing.svg';
  const semantics = buildExtractedDrawingSemantics({
    drawingSvgPath: svgPath,
    svgContent: [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '  <text x="10" y="10">TOP VIEW</text>',
      '  <text x="10" y="20">Material: AL6061</text>',
      '  <text x="10" y="30">Tolerance: ±0.2</text>',
      '  <text x="10" y="40">Drawing No: BR-001</text>',
      '  <text x="10" y="50">THK 8</text>',
      '</svg>',
    ].join('\n'),
    drawingIntent: {
      required_views: ['top'],
      required_dimensions: [
        { id: 'THICKNESS', value_mm: 8, required: true },
      ],
      required_notes: [
        { id: 'MATERIAL', text: 'Material: AL6061', required: true },
      ],
    },
  });

  assert.equal(semantics.status, 'partial');
  assert.equal(semantics.coverage.required_dimensions_extracted, 1);
  assert.equal(semantics.coverage.required_notes_extracted, 1);
  assert.equal(semantics.coverage.required_views_extracted, 1);
  assert.equal(semantics.title_block.material?.raw_text, 'Material: AL6061');
  assert.equal(semantics.title_block.tolerance?.raw_text, 'Tolerance: ±0.2');
  assert.equal(semantics.title_block.drawing_number?.raw_text, 'Drawing No: BR-001');
}

{
  const semantics = buildExtractedDrawingSemantics({
    drawingSvgPath: '/tmp/unicode-hole-callout_probe.svg',
    svgContent: [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '  <text x="10" y="10">⌀9 H8</text>',
      '  <text x="10" y="20">2X ⌀16 H7</text>',
      '  <text x="10" y="30">Tolerance: KS B 0401 m</text>',
      '</svg>',
    ].join('\n'),
    drawingIntent: {
      required_dimensions: [
        { id: 'MOUNTING_HOLE_DIA', value_mm: 9, feature: 'hole_pattern_1', required: true },
        { id: 'HOLE_PATTERN_DIA', value_mm: 16, feature: 'hole_pattern_1', required: true },
      ],
    },
  });

  assert.equal(semantics.coverage.required_dimensions_extracted, 2);
  assert.equal(
    semantics.dimensions.some((entry) => entry.raw_text === '⌀9 H8' && entry.matched_intent_id === 'MOUNTING_HOLE_DIA'),
    true
  );
  assert.equal(
    semantics.dimensions.some((entry) => entry.raw_text === '2X ⌀16 H7' && entry.matched_intent_id === 'HOLE_PATTERN_DIA'),
    true
  );
  assert.equal(semantics.notes.some((entry) => entry.raw_text === '⌀9 H8'), false);
  assert.equal(semantics.notes.some((entry) => entry.raw_text === '2X ⌀16 H7'), false);
  assert.equal(semantics.title_block.tolerance?.raw_text, 'Tolerance: KS B 0401 m');
}

{
  const semantics = buildExtractedDrawingSemantics({
    drawingSvgPath: '/tmp/title-block-material-pair.svg',
    svgContent: [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '  <text x="120" y="180">MATERIAL</text>',
      '  <text x="120" y="187">AL6061</text>',
      '</svg>',
    ].join('\n'),
    drawingIntent: {
      required_notes: [
        { id: 'MATERIAL', text: 'Material: AL6061', required: true },
      ],
    },
  });

  assert.equal(semantics.methods.includes('svg_title_block_material_pair'), true);
  assert.equal(semantics.coverage.required_notes_extracted, 1);
  assert.equal(semantics.title_block.material?.raw_text, 'Material: AL6061');
  assert.equal(
    semantics.notes.some((entry) => (
      entry.raw_text === 'Material: AL6061'
        && entry.matched_intent_id === 'MATERIAL'
        && entry.provenance.method === 'svg_title_block_material_pair'
        && entry.provenance.label_svg_text_id === 'svg_text_001'
        && entry.provenance.value_svg_text_id === 'svg_text_002'
    )),
    true
  );
}

{
  const semantics = buildExtractedDrawingSemantics({
    drawingSvgPath: '/tmp/title-block-material-code-pair.svg',
    svgContent: [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '  <text x="120" y="180">MATERIAL</text>',
      '  <text x="120" y="187">SS304</text>',
      '</svg>',
    ].join('\n'),
    drawingIntent: {
      required_notes: [
        { id: 'MATERIAL', text: 'SS304 (KS D 3698)', required: true },
      ],
    },
  });

  assert.equal(semantics.methods.includes('svg_title_block_material_pair'), true);
  assert.equal(semantics.coverage.required_notes_extracted, 1);
  assert.equal(semantics.title_block.material?.raw_text, 'Material: SS304');
  assert.equal(
    semantics.notes.some((entry) => (
      entry.raw_text === 'Material: SS304'
        && entry.matched_intent_id === 'MATERIAL'
        && entry.provenance.method === 'svg_title_block_material_pair'
    )),
    true
  );
}

{
  const labelOnly = buildExtractedDrawingSemantics({
    drawingSvgPath: '/tmp/title-block-material-label-only.svg',
    svgContent: [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '  <text x="120" y="180">MATERIAL</text>',
      '</svg>',
    ].join('\n'),
    drawingIntent: {
      required_notes: [
        { id: 'MATERIAL', text: 'Material: AL6061', required: true },
      ],
    },
  });

  assert.equal(labelOnly.methods.includes('svg_title_block_material_pair'), false);
  assert.equal(labelOnly.coverage.required_notes_extracted, 0);
  assert.equal(labelOnly.title_block.material, null);
  assert(labelOnly.unknowns.some((entry) => entry.includes('MATERIAL')));

  const mismatchedValue = buildExtractedDrawingSemantics({
    drawingSvgPath: '/tmp/title-block-material-mismatch.svg',
    svgContent: [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '  <text x="120" y="180">MATERIAL</text>',
      '  <text x="120" y="187">AL6061</text>',
      '</svg>',
    ].join('\n'),
    drawingIntent: {
      required_notes: [
        { id: 'MATERIAL', text: 'Material: SS304', required: true },
      ],
    },
  });

  assert.equal(mismatchedValue.methods.includes('svg_title_block_material_pair'), true);
  assert.equal(mismatchedValue.coverage.required_notes_extracted, 0);
  assert.equal(mismatchedValue.title_block.material?.raw_text, 'Material: AL6061');
  assert(mismatchedValue.unknowns.some((entry) => entry.includes('MATERIAL')));
}

{
  const unsupported = buildExtractedDrawingSemantics();
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.decision, 'advisory');
  assert.equal(unsupported.coverage.required_dimensions_extracted, 0);

  const unknown = buildExtractedDrawingSemantics({
    drawingSvgPath: '/tmp/unknown_probe_drawing.svg',
    svgContent: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" /></svg>',
    drawingIntent: {
      required_dimensions: [{ id: 'WIDTH', value_mm: 10, required: true }],
    },
  });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.dimensions.length, 0);
  assert(unknown.unknowns.some((entry) => entry.includes('WIDTH')));
}

{
  const comparison = compareDrawingIntentToExtractedSemantics(
    {
      required_dimensions: [{ id: 'WIDTH', label: 'Overall width', required: true }],
      required_notes: [{ id: 'MATERIAL', text: 'Material: AL6061', required: true }],
      required_views: ['top'],
    },
    {
      status: 'available',
      decision: 'advisory',
      sources: [
        { artifact_type: 'svg', path: '/tmp/all-good.svg', inspected: true, method: 'svg_text_scan' },
        { artifact_type: 'layout_report', path: '/tmp/all-good-layout.json', inspected: true, method: 'layout_report_views' },
      ],
      dimensions: [
        {
          id: 'svg_dim_001',
          raw_text: '40',
          matched_intent_id: 'WIDTH',
          matched_feature_id: 'body',
          confidence: 0.9,
          provenance: {
            artifact_type: 'svg',
            path: '/tmp/all-good.svg',
            method: 'svg_dimension_text_scan',
          },
        },
      ],
      notes: [
        {
          id: 'svg_note_001',
          raw_text: 'Material: AL6061',
          matched_intent_id: 'MATERIAL',
          confidence: 0.95,
          provenance: {
            artifact_type: 'svg',
            path: '/tmp/all-good.svg',
            method: 'svg_note_text_scan',
          },
        },
      ],
      views: [
        {
          id: 'top',
          label: 'Top',
          matched_intent_id: 'top',
          confidence: 0.92,
          provenance: {
            artifact_type: 'layout_report',
            path: '/tmp/all-good-layout.json',
            method: 'layout_report_views',
          },
        },
      ],
      unknowns: [],
      limitations: [],
    },
    null,
    null,
    '/tmp/all-good_extracted_drawing_semantics.json'
  );
  assert.deepEqual(comparison.suggested_action_details, []);
  assert.deepEqual(comparison.suggested_actions, []);
}

{
  const comparison = compareDrawingIntentToExtractedSemantics(
    {
      required_dimensions: [{ id: 'WIDTH', label: 'Overall width', required: true }],
    },
    {
      status: 'partial',
      decision: 'advisory',
      sources: [
        { artifact_type: 'svg', path: '/tmp/missing-dim.svg', inspected: true, method: 'svg_text_scan' },
      ],
      dimensions: [],
      notes: [],
      views: [],
      unknowns: [],
      limitations: ['Advisory-only foundation.'],
    },
    null,
    null,
    '/tmp/missing-dim_extracted_drawing_semantics.json'
  );
  assert.equal(comparison.required_dimensions[0].classification, 'missing');
  assert.equal(comparison.suggested_action_details[0].category, 'dimension');
  assert.equal(comparison.suggested_action_details[0].classification, 'missing');
  assert.equal(comparison.suggested_action_details[0].recommended_fix.includes('Add the required dimension for Overall width'), true);
}

{
  const comparison = compareDrawingIntentToExtractedSemantics(
    {
      required_dimensions: [{ id: 'WIDTH', value_mm: 40, required: true }],
    },
    {
      status: 'partial',
      decision: 'advisory',
      sources: [
        { artifact_type: 'svg', path: '/tmp/low-confidence.svg', inspected: true, method: 'svg_text_scan' },
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
          source: '/tmp/low-confidence.svg',
          confidence: 0.42,
          provenance: {
            artifact_type: 'svg',
            path: '/tmp/low-confidence.svg',
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
    null,
    null,
    '/tmp/low-confidence_extracted_drawing_semantics.json'
  );

  assert.equal(comparison.coverage.required_dimensions.extracted, 0);
  assert.equal(comparison.coverage.required_dimensions.unknown, 1);
  assert.equal(comparison.required_dimensions[0].classification, 'unknown');
  assert.equal(comparison.required_dimensions[0].candidate_matches.length, 1);
  assert.equal(comparison.required_dimensions[0].candidate_matches[0].matched_extracted_id, 'svg_text_001');
  assert.equal(comparison.suggested_action_details[0].classification, 'low_confidence');
  assert.equal(comparison.suggested_action_details[0].recommended_fix.includes('low-confidence extracted candidate'), true);
}

{
  const comparison = compareDrawingIntentToExtractedSemantics(
    {
      required_views: ['front'],
    },
    {
      status: 'partial',
      decision: 'advisory',
      sources: [],
      dimensions: [],
      notes: [],
      views: [],
      unknowns: [],
      limitations: ['View extraction unavailable.'],
    },
    null,
    null,
    '/tmp/unknown-view_extracted_drawing_semantics.json'
  );
  assert.equal(comparison.required_views[0].classification, 'unknown');
  assert.equal(comparison.suggested_action_details[0].category, 'view');
  assert.equal(comparison.suggested_action_details[0].recommended_fix.includes('view label'), true);
}

{
  const semantics = buildExtractedDrawingSemantics({
    drawingSvgPath: '/tmp/structured-section-detail.svg',
    svgContent: [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '  <g class="drawing-view drawing-view-section-a-a" id="drawing-view-section-a-a" data-view-id="section_a_a" data-view-kind="section" data-view-label="SECTION A-A" data-view-identity="A-A" data-region-ref="drawing-view:section_a_a"></g>',
      '  <g class="drawing-view drawing-view-detail-b" id="drawing-view-detail-b" data-view-id="detail_b" data-view-kind="detail" data-view-label="DETAIL B" data-view-identity="B" data-source-view="top" data-region-ref="drawing-view:detail_b"></g>',
      '</svg>',
    ].join('\n'),
    drawingIntent: {
      required_views: [
        { id: 'section_a_a', label: 'Section A-A', view_kind: 'section', required: true },
        { id: 'detail_b', label: 'Detail B', view_kind: 'detail', source_view: 'top', required: true },
      ],
    },
  });

  assert.equal(semantics.methods.includes('svg_view_group_metadata'), true);
  assert.equal(semantics.coverage.required_views_extracted, 2);
  assert.equal(semantics.views.some((entry) => entry.id === 'section_a_a' && entry.view_kind === 'section'), true);
  assert.equal(semantics.views.some((entry) => entry.id === 'detail_b' && entry.view_kind === 'detail'), true);
}

{
  const semantics = buildExtractedDrawingSemantics({
    drawingSvgPath: '/tmp/label-only-section-detail.svg',
    svgContent: [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '  <text x="10" y="10">SECTION A-A</text>',
      '  <text x="10" y="20">DETAIL B</text>',
      '</svg>',
    ].join('\n'),
    drawingIntent: {
      required_views: [
        { id: 'section_a_a', label: 'Section A-A', view_kind: 'section', required: true },
        { id: 'detail_b', label: 'Detail B', view_kind: 'detail', source_view: 'top', required: true },
      ],
    },
  });

  assert.equal(semantics.methods.includes('svg_view_group_metadata'), false);
  assert.equal(semantics.views.length, 0);
  assert(semantics.unknowns.some((entry) => entry.includes('distinct traceable view group or region: section_a_a')));
  assert(semantics.unknowns.some((entry) => entry.includes('distinct traceable view group or region: detail_b')));

  const comparison = compareDrawingIntentToExtractedSemantics(
    {
      required_views: [
        { id: 'section_a_a', label: 'Section A-A', view_kind: 'section', required: true },
        { id: 'detail_b', label: 'Detail B', view_kind: 'detail', source_view: 'top', required: true },
      ],
    },
    semantics,
    null,
    null,
    '/tmp/label-only-section-detail_extracted_drawing_semantics.json'
  );

  assert.equal(comparison.required_views[0].classification, 'unknown');
  assert.equal(comparison.required_views[1].classification, 'unknown');
}

{
  const comparison = compareDrawingIntentToExtractedSemantics(
    {
      required_dimensions: [],
      required_notes: [{ id: 'MATERIAL', text: 'Material: AL6061', required: true }],
    },
    {
      status: 'partial',
      decision: 'advisory',
      sources: [
        { artifact_type: 'svg', path: '/tmp/unmatched.svg', inspected: true, method: 'svg_text_scan' },
      ],
      dimensions: [
        {
          id: 'svg_dim_099',
          raw_text: 'R12',
          confidence: 0.84,
          provenance: {
            artifact_type: 'svg',
            path: '/tmp/unmatched.svg',
            method: 'svg_dimension_text_scan',
          },
        },
      ],
      notes: [
        {
          id: 'svg_note_099',
          raw_text: 'Paint after machining',
          confidence: 0.81,
          provenance: {
            artifact_type: 'svg',
            path: '/tmp/unmatched.svg',
            method: 'svg_note_text_scan',
          },
        },
      ],
      views: [],
      unknowns: [],
      limitations: [],
    },
    null,
    null,
    '/tmp/unmatched_extracted_drawing_semantics.json'
  );
  assert.equal(comparison.suggested_action_details.some((entry) => entry.category === 'mapping'), true);
  assert.equal(comparison.suggested_action_details.some((entry) => entry.category === 'note' && entry.classification === 'missing'), true);
  assert.equal(comparison.suggested_actions.some((entry) => entry.includes('drawing_intent alias')), true);
}

{
  const semanticsPath = resolveExtractedDrawingSemanticsPath('/tmp/quality_pass_bracket_drawing.svg');
  assert.equal(semanticsPath, '/tmp/quality_pass_bracket_extracted_drawing_semantics.json');
}

console.log('extracted-drawing-semantics.test.js: ok');
