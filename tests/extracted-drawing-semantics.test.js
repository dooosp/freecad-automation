import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  buildExtractedDrawingSemantics,
  compareDrawingIntentToExtractedSemantics,
  resolveExtractedDrawingSemanticsPath,
  validateExtractedDrawingSemantics,
} from '../src/services/drawing/extracted-drawing-semantics.js';

const ROOT = resolve(import.meta.dirname, '..');

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
