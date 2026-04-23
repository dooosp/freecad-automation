import assert from 'node:assert/strict';

import { evaluateLayoutReadability } from '../src/services/drawing/layout-readability.js';

{
  const input = {
    drawingSvgPath: '/tmp/clean_drawing.svg',
    svgContent: [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '  <g class="drawing-view" id="drawing-view-front" data-view-id="front" data-view-label="Front"></g>',
      '  <g class="drawing-view" id="drawing-view-top" data-view-id="top" data-view-label="Top"></g>',
      '</svg>',
    ].join('\n'),
    qaPath: '/tmp/clean_drawing_qa.json',
    qaReport: {
      metrics: {
        overflow_count: 0,
        text_overlap_pairs: 0,
        dim_overlap_pairs: 0,
        notes_overflow: false,
      },
      details: {
        overflows: [],
        text_overlaps: [],
      },
    },
    layoutReportPath: '/tmp/clean_layout_report.json',
    layoutReport: {
      views: {
        front: { label: 'Front', fit: { overflow: false } },
        top: { label: 'Top', fit: { overflow: false } },
      },
      summary: {
        view_count: 2,
        overflow_views: [],
        all_within_limits: true,
      },
    },
  };

  const first = evaluateLayoutReadability(input);
  const second = evaluateLayoutReadability(input);
  assert.deepEqual(first, second);
  assert.equal(first.status, 'ok');
  assert.equal(first.evidence_state, 'available');
  assert.equal(first.score, 100);
  assert.equal(first.confidence, 'high');
  assert.equal(first.warning_count, 0);
  assert.deepEqual(first.findings, []);
  assert.deepEqual(first.provenance.evaluated_view_ids.sort(), ['front', 'top']);
}

{
  const result = evaluateLayoutReadability({
    drawingSvgPath: '/tmp/crowded_drawing.svg',
    svgContent: [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '  <g class="drawing-view" id="drawing-view-front" data-view-id="front" data-view-label="Front"></g>',
      '</svg>',
    ].join('\n'),
    qaPath: '/tmp/crowded_drawing_qa.json',
    qaReport: {
      metrics: {
        overflow_count: 1,
        text_overlap_pairs: 1,
        dim_overlap_pairs: 2,
        notes_overflow: true,
      },
      details: {
        overflows: [{ view: 'front', overflow_mm: 4.5 }],
        text_overlaps: [{ text1: '12', text2: 'R6', iou: 0.33, view: 'front' }],
      },
    },
    layoutReportPath: '/tmp/crowded_layout_report.json',
    layoutReport: {
      views: {
        front: { label: 'Front', fit: { overflow: true } },
      },
      summary: {
        view_count: 1,
        overflow_views: ['front'],
        all_within_limits: false,
      },
    },
  });

  assert.equal(result.status, 'warning');
  assert.equal(result.evidence_state, 'available');
  assert.equal(result.score, 40);
  assert.equal(result.warning_count, 4);
  assert.deepEqual(
    result.findings.map((entry) => entry.type),
    ['view_crowding', 'text_overlap', 'dimension_overlap', 'title_block_clearance']
  );
  assert.equal(result.findings[0].view_ids[0], 'front');
  assert.equal(result.findings[1].labels.includes('12'), true);
  assert.equal(result.recommended_actions.some((entry) => entry.includes('title block')), true);
}

{
  const result = evaluateLayoutReadability({
    drawingSvgPath: '/tmp/partial_drawing.svg',
    svgContent: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    layoutReportPath: '/tmp/partial_layout_report.json',
    layoutReport: {
      views: {
        front: { label: 'Front', fit: { overflow: false } },
      },
      summary: {
        view_count: 1,
        overflow_views: [],
      },
    },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.evidence_state, 'partial');
  assert.equal(result.score, null);
  assert.equal(result.warning_count, 0);
}

{
  const result = evaluateLayoutReadability();

  assert.equal(result.status, 'not_evaluated');
  assert.equal(result.evidence_state, 'missing');
  assert.equal(result.score, null);
  assert.equal(result.findings[0].type, 'missing_layout_metadata');
  assert.equal(result.recommended_actions[0].includes('layout report'), true);
}
