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
  assert.equal(first.advisory_only, true);
  assert.equal(first.completeness_state, 'complete');
  assert.equal(first.warning_count, 0);
  assert.deepEqual(first.findings, []);
  assert.deepEqual(first.provenance.evaluated_view_ids.sort(), ['front', 'top']);
  assert.equal(first.provenance.source_completeness.layout_report.completeness_state, 'complete');
  assert.equal(first.provenance.source_completeness.qa_metrics.completeness_state, 'complete');
  assert.equal(first.provenance.source_completeness.svg_view_metadata.completeness_state, 'complete');
  assert.deepEqual(
    first.provenance.sources.map((entry) => entry.source_kind).sort(),
    ['layout_report', 'qa_metrics', 'svg_view_metadata']
  );
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
  assert.equal(result.findings[0].source_kind, 'layout_report');
  assert.equal(result.findings[0].source_ref, 'views.front');
  assert.equal(result.findings[0].source_artifact, 'layout_report');
  assert.equal(result.findings[0].evidence_state, 'available');
  assert.equal(result.findings[0].completeness_state, 'complete');
  assert.equal(result.findings[0].provenance.method, 'layout_report_views');
  assert.equal(result.findings[1].source_kind, 'qa_metrics');
  assert.equal(result.findings[1].source_ref, 'details.text_overlaps.0');
  assert.equal(result.findings[1].provenance.method, 'qa_vector_text_overlap');
  assert.equal(result.findings[2].source_kind, 'qa_metrics');
  assert.equal(result.findings[2].source_ref, 'metrics.dim_overlap_pairs');
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
  assert.equal(result.completeness_state, 'partial');
  assert.equal(result.score, null);
  assert.equal(result.warning_count, 0);
  assert.equal(result.provenance.source_completeness.layout_report.completeness_state, 'complete');
  assert.equal(result.provenance.source_completeness.qa_metrics.completeness_state, 'missing');
  assert.equal(result.provenance.source_completeness.svg_view_metadata.completeness_state, 'unsupported');
  assert.equal(
    result.provenance.source_completeness.svg_view_metadata.missing_reasons.includes('drawing-view group metadata not found'),
    true
  );
}

{
  const result = evaluateLayoutReadability();

  assert.equal(result.status, 'not_evaluated');
  assert.equal(result.evidence_state, 'missing');
  assert.equal(result.completeness_state, 'missing');
  assert.equal(result.score, null);
  assert.equal(result.findings[0].type, 'missing_layout_metadata');
  assert.equal(result.findings[0].source_kind, 'metadata_preflight');
  assert.equal(result.findings[0].evidence_state, 'missing');
  assert.equal(result.findings[0].completeness_state, 'missing');
  assert.equal(result.provenance.source_completeness.layout_report.completeness_state, 'missing');
  assert.equal(result.provenance.source_completeness.qa_metrics.completeness_state, 'missing');
  assert.equal(result.provenance.source_completeness.svg_view_metadata.completeness_state, 'missing');
  assert.equal(result.recommended_actions[0].includes('layout report'), true);
}

function annotationEvidence(overrides = {}) {
  return {
    drawingSvgPath: '/tmp/final.svg',
    layoutReport: { views: { front: { fit: { overflow: false } } }, summary: { overflow_views: [] } },
    qaPath: '/tmp/final_qa.json',
    qaReport: {
      metrics: { overflow_count: 0, text_overlap_pairs: 0, dim_overlap_pairs: 0, notes_overflow: false },
      details: { annotation_layout: {
        status: 'complete', advisory_only: true, method: 'final_svg_bounded_annotations',
        text_bounds: 'font_width_estimate', checked_text_count: 1, unsupported_elements: [], findings: [],
        ...overrides,
      } },
    },
  };
}

{
  const result = evaluateLayoutReadability(annotationEvidence({ findings: [{
    type: 'text_line_overlap', view: 'front', element_ids: ['label', 'leader'], labels: ['Ø8'],
    bounding_boxes: [{ x: 40, y: 46, w: 2.2, h: 4.8 }, { x: 35, y: 48, w: 20, h: 0 }],
  }] }));
  assert.equal(result.status, 'warning');
  assert.equal(result.advisory_only, true);
  assert.equal(result.warning_count, 1);
  assert.equal(result.findings[0].type, 'text_line_overlap');
  assert.deepEqual(result.findings[0].element_ids, ['label', 'leader']);
  assert.equal(result.findings[0].source_ref, 'details.annotation_layout.findings.0');
  assert.equal(result.findings[0].bounding_boxes[0].x, 40);
}

{
  const result = evaluateLayoutReadability(annotationEvidence({
    status: 'partial', unsupported_elements: [{ element_id: 'unknown', tag: 'text', reason: 'unsupported transform: skewX' }],
  }));
  assert.equal(result.evidence_state, 'partial');
  assert.equal(result.completeness_state, 'partial');
  assert.equal(result.score, null);
  assert(result.findings.some(f => f.type === 'unsupported_annotation_layout'));
  assert.equal(result.provenance.source_completeness.qa_annotation_layout.completeness_state, 'partial');
}

{
  const result = evaluateLayoutReadability(annotationEvidence({ status: 'complete', findings: null }));
  assert.equal(result.score, null);
  assert.equal(result.evidence_state, 'partial');
  assert(result.findings.some(f => f.type === 'unsupported_annotation_layout'));
  const input = annotationEvidence();
  delete input.qaReport.details.annotation_layout;
  input.qaReport.metrics.text_overlap_pairs = null;
  input.qaReport.metrics.dim_overlap_pairs = null;
  assert.equal(evaluateLayoutReadability(input).score, null, 'null metrics are not observed zero counts');
}

{
  const result = evaluateLayoutReadability(annotationEvidence({ findings: [{
    type: 'annotation_cell_overflow', view: 'top', element_ids: ['retained-dimension'], labels: ['R5'],
    bounding_boxes: [{ x: 40, y: 38, w: 2.2, h: 2.4 }],
  }] }));
  assert.equal(result.status, 'warning');
  assert.equal(result.advisory_only, true);
  assert.equal(result.warning_count, 1);
  assert.equal(result.findings[0].type, 'annotation_cell_overflow');
  assert.equal(result.findings[0].advisory_only, true);
  assert.deepEqual(result.findings[0].element_ids, ['retained-dimension']);
  assert.equal(result.findings[0].source_ref, 'details.annotation_layout.findings.0');
  assert.equal(result.completeness_state, 'complete');
}
