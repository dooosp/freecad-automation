import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  buildExtractedDrawingSemantics,
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
  const semanticsPath = resolveExtractedDrawingSemanticsPath('/tmp/quality_pass_bracket_drawing.svg');
  assert.equal(semanticsPath, '/tmp/quality_pass_bracket_extracted_drawing_semantics.json');
}

console.log('extracted-drawing-semantics.test.js: ok');
