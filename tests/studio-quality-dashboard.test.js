import assert from 'node:assert/strict';

import {
  buildQualityDashboardModel,
  formatQualityStatusLabel,
} from '../public/js/studio/quality-dashboard.js';

function makeArtifact({
  id,
  key,
  type,
  file_name,
  extension,
  exists = true,
}) {
  return {
    id,
    key,
    type,
    file_name,
    extension,
    exists,
    links: {
      open: `/artifacts/job-1/${id}`,
      download: `/artifacts/job-1/${id}/download`,
    },
  };
}

function makeAvailableExtractedEvidence() {
  return {
    status: 'available',
    advisory_only: true,
    file: '/tmp/output/quality_pass_bracket_extracted_drawing_semantics.json',
    path: '/tmp/output/quality_pass_bracket_extracted_drawing_semantics.json',
    sources: [
      { artifact_type: 'svg', path: '/tmp/output/quality_pass_bracket_drawing.svg', inspected: true, method: 'svg_text_scan' },
    ],
    coverage: {
      required_dimensions: { total: 2, extracted: 2, missing: 0, unknown: 0, unsupported: 0, extracted_percent: 100 },
      required_notes: { total: 1, extracted: 1, missing: 0, unknown: 0, unsupported: 0, extracted_percent: 100 },
      required_views: { total: 2, extracted: 2, missing: 0, unknown: 0, unsupported: 0, extracted_percent: 100 },
      total_required: 5,
      total_extracted: 5,
      total_missing: 0,
      total_unknown: 0,
      total_unsupported: 0,
    },
    required_dimensions: [
      {
        requirement_id: 'HOLE_LEFT_DIA',
        requirement_label: 'Left hole diameter',
        classification: 'extracted',
        matched_extracted_id: 'svg_text_001',
        matched_raw_text: '6',
        matched_feature_id: 'hole_left',
        source_artifact: 'svg',
        confidence: 0.93,
        reason: 'Reliable extracted dimension evidence matched this required dimension.',
        provenance: { artifact_type: 'svg', path: '/tmp/output/quality_pass_bracket_drawing.svg', method: 'svg_dimension_text_scan' },
        candidate_matches: [],
      },
      {
        requirement_id: 'HOLE_RIGHT_DIA',
        requirement_label: 'Right hole diameter',
        classification: 'extracted',
        matched_extracted_id: 'svg_text_002',
        matched_raw_text: '6',
        matched_feature_id: 'hole_right',
        source_artifact: 'svg',
        confidence: 0.92,
        reason: 'Reliable extracted dimension evidence matched this required dimension.',
        provenance: { artifact_type: 'svg', path: '/tmp/output/quality_pass_bracket_drawing.svg', method: 'svg_dimension_text_scan' },
        candidate_matches: [],
      },
    ],
    required_notes: [
      {
        requirement_id: 'MATERIAL',
        requirement_label: 'Material callout',
        classification: 'extracted',
        matched_extracted_id: 'svg_note_001',
        matched_raw_text: 'Material: AL6061',
        matched_feature_id: null,
        source_artifact: 'svg',
        confidence: 0.91,
        reason: 'Reliable extracted note evidence matched this required drawing note.',
        provenance: { artifact_type: 'svg', path: '/tmp/output/quality_pass_bracket_drawing.svg', method: 'svg_text_scan' },
        candidate_matches: [],
      },
    ],
    required_views: [
      {
        requirement_id: 'top',
        requirement_label: 'Top view',
        classification: 'extracted',
        matched_extracted_id: 'top',
        matched_raw_text: 'Top',
        matched_feature_id: null,
        source_artifact: 'layout_report',
        confidence: 0.9,
        reason: 'Reliable extracted view evidence matched this required view.',
        provenance: { artifact_type: 'layout_report', path: '/tmp/output/quality_pass_bracket_layout_report.json', method: 'layout_report_views' },
        candidate_matches: [],
      },
      {
        requirement_id: 'iso',
        requirement_label: 'Isometric view',
        classification: 'extracted',
        matched_extracted_id: 'iso',
        matched_raw_text: 'Iso',
        matched_feature_id: null,
        source_artifact: 'layout_report',
        confidence: 0.89,
        reason: 'Reliable extracted view evidence matched this required view.',
        provenance: { artifact_type: 'layout_report', path: '/tmp/output/quality_pass_bracket_layout_report.json', method: 'layout_report_views' },
        candidate_matches: [],
      },
    ],
    unmatched_dimensions: [],
    unmatched_notes: [],
    matched_required_dimensions: 2,
    matched_required_notes: 1,
    matched_required_views: 2,
    missing_required_items: [],
    unknowns: [],
    limitations: ['Advisory-only foundation.'],
    suggested_actions: [],
    suggested_action_details: [],
  };
}

function makePartialExtractedEvidence() {
  return {
    status: 'partial',
    advisory_only: true,
    file: '/tmp/output/ks_bracket_extracted_drawing_semantics.json',
    path: '/tmp/output/ks_bracket_extracted_drawing_semantics.json',
    sources: [
      { artifact_type: 'svg', path: '/tmp/output/ks_bracket_drawing.svg', inspected: true, method: 'svg_text_scan' },
      { artifact_type: 'layout_report', path: '/tmp/output/ks_bracket_layout_report.json', inspected: true, method: 'layout_report_views' },
    ],
    coverage: {
      required_dimensions: { total: 3, extracted: 1, missing: 0, unknown: 2, unsupported: 0, extracted_percent: 33.33 },
      required_notes: { total: 2, extracted: 1, missing: 0, unknown: 1, unsupported: 0, extracted_percent: 50 },
      required_views: { total: 4, extracted: 4, missing: 0, unknown: 0, unsupported: 0, extracted_percent: 100 },
      total_required: 9,
      total_extracted: 6,
      total_missing: 0,
      total_unknown: 3,
      total_unsupported: 0,
    },
    required_dimensions: [
      {
        requirement_id: 'WEB_HEIGHT',
        requirement_label: 'Web height',
        classification: 'extracted',
        matched_extracted_id: 'svg_text_010',
        matched_raw_text: '68',
        matched_feature_id: 'web',
        source_artifact: 'svg',
        confidence: 0.88,
        reason: 'Reliable extracted dimension evidence matched this required dimension.',
        provenance: { artifact_type: 'svg', path: '/tmp/output/ks_bracket_drawing.svg', method: 'svg_dimension_text_scan' },
        candidate_matches: [],
      },
      {
        requirement_id: 'HOLE_DIA',
        requirement_label: 'Hole diameter',
        classification: 'unknown',
        matched_extracted_id: null,
        matched_raw_text: null,
        matched_feature_id: null,
        source_artifact: null,
        confidence: null,
        reason: 'Only low-confidence extracted dimension candidates were available for this required dimension.',
        provenance: null,
        candidate_matches: [
          {
            matched_extracted_id: 'svg_text_100',
            matched_raw_text: '16',
            matched_feature_id: null,
            source_artifact: 'svg',
            confidence: 0.31,
            reason: 'Matched extracted dimension stayed below the reliable confidence threshold.',
            provenance: { artifact_type: 'svg', path: '/tmp/output/ks_bracket_drawing.svg', method: 'svg_dimension_text_scan' },
          },
        ],
      },
      {
        requirement_id: 'BASE_PLATE_ENVELOPE',
        requirement_label: 'Base plate envelope',
        classification: 'unknown',
        matched_extracted_id: null,
        matched_raw_text: null,
        matched_feature_id: null,
        source_artifact: null,
        confidence: null,
        reason: 'Only low-confidence extracted dimension candidates were available for this required dimension.',
        provenance: null,
        candidate_matches: [],
      },
    ],
    required_notes: [
      {
        requirement_id: 'SURFACE_FINISH',
        requirement_label: 'Surface finish',
        classification: 'extracted',
        matched_extracted_id: 'svg_note_001',
        matched_raw_text: 'Surface finish: powder coat',
        matched_feature_id: null,
        source_artifact: 'svg',
        confidence: 0.82,
        reason: 'Reliable extracted note evidence matched this required drawing note.',
        provenance: { artifact_type: 'svg', path: '/tmp/output/ks_bracket_drawing.svg', method: 'svg_text_scan' },
        candidate_matches: [],
      },
      {
        requirement_id: 'MATERIAL',
        requirement_label: 'Material callout',
        classification: 'unknown',
        matched_extracted_id: null,
        matched_raw_text: null,
        matched_feature_id: null,
        source_artifact: null,
        confidence: null,
        reason: 'Extracted drawing semantics explicitly marked this required note as uncertain.',
        provenance: null,
        candidate_matches: [],
      },
    ],
    required_views: [
      {
        requirement_id: 'front',
        requirement_label: 'Front view',
        classification: 'extracted',
        matched_extracted_id: 'front',
        matched_raw_text: 'Front',
        matched_feature_id: null,
        source_artifact: 'layout_report',
        confidence: 0.92,
        reason: 'Reliable extracted view evidence matched this required view.',
        provenance: { artifact_type: 'layout_report', path: '/tmp/output/ks_bracket_layout_report.json', method: 'layout_report_views' },
        candidate_matches: [],
      },
      {
        requirement_id: 'top',
        requirement_label: 'Top view',
        classification: 'extracted',
        matched_extracted_id: 'top',
        matched_raw_text: 'Top',
        matched_feature_id: null,
        source_artifact: 'layout_report',
        confidence: 0.91,
        reason: 'Reliable extracted view evidence matched this required view.',
        provenance: { artifact_type: 'layout_report', path: '/tmp/output/ks_bracket_layout_report.json', method: 'layout_report_views' },
        candidate_matches: [],
      },
      {
        requirement_id: 'right',
        requirement_label: 'Right view',
        classification: 'extracted',
        matched_extracted_id: 'right',
        matched_raw_text: 'Right',
        matched_feature_id: null,
        source_artifact: 'layout_report',
        confidence: 0.9,
        reason: 'Reliable extracted view evidence matched this required view.',
        provenance: { artifact_type: 'layout_report', path: '/tmp/output/ks_bracket_layout_report.json', method: 'layout_report_views' },
        candidate_matches: [],
      },
      {
        requirement_id: 'section A-A',
        requirement_label: 'Section A-A',
        classification: 'extracted',
        matched_extracted_id: 'section-a-a',
        matched_raw_text: 'Section A-A',
        matched_feature_id: null,
        source_artifact: 'layout_report',
        confidence: 0.9,
        reason: 'Reliable extracted view evidence matched this required view.',
        provenance: { artifact_type: 'layout_report', path: '/tmp/output/ks_bracket_layout_report.json', method: 'layout_report_views' },
        candidate_matches: [],
      },
    ],
    unmatched_dimensions: [
      {
        extracted_id: 'svg_text_888',
        raw_text: '60',
        matched_feature_id: null,
        source_artifact: 'svg',
        confidence: 0.84,
        reason: 'Extracted dimension did not match a required drawing-intent dimension.',
        provenance: { artifact_type: 'svg', path: '/tmp/output/ks_bracket_drawing.svg', method: 'svg_dimension_text_scan' },
      },
    ],
    unmatched_notes: [
      {
        extracted_id: 'svg_note_002',
        raw_text: 'Tolerance: KS B 0401 m',
        category: 'tolerance',
        matched_feature_id: null,
        source_artifact: 'svg',
        confidence: 0.87,
        reason: 'Extracted note did not match a required drawing-intent note.',
        provenance: { artifact_type: 'svg', path: '/tmp/output/ks_bracket_drawing.svg', method: 'svg_text_scan' },
      },
    ],
    matched_required_dimensions: 1,
    matched_required_notes: 1,
    matched_required_views: 4,
    missing_required_items: [],
    unknowns: [
      'Required dimension not reliably extracted: HOLE_DIA.',
      'Required dimension not reliably extracted: BASE_PLATE_ENVELOPE.',
      'Required note not reliably extracted: MATERIAL.',
    ],
    limitations: ['Advisory-only foundation.'],
    suggested_actions: ['Review low-confidence or incomplete extracted dimension evidence for: HOLE_DIA.'],
    suggested_action_details: [
      {
        id: 'dimension:hole-dia:low-confidence',
        severity: 'review',
        category: 'dimension',
        target_requirement_id: 'HOLE_DIA',
        target_feature_id: 'hole_001',
        classification: 'low_confidence',
        title: 'Review required dimension Hole diameter because extracted evidence is low-confidence.',
        message: 'Only a low-confidence extracted candidate was available for HOLE_DIA.',
        recommended_fix: 'Verify the hole diameter callout is visible and update aliases if extraction should map it to HOLE_DIA.',
        evidence: [
          {
            source: 'drawing_quality.semantic_quality.extracted_evidence',
            path: 'required_dimensions.HOLE_DIA.candidate_matches[0].confidence',
            value: '0.31',
          },
        ],
      },
      {
        id: 'note:material:unknown',
        severity: 'review',
        category: 'note',
        target_requirement_id: 'MATERIAL',
        target_feature_id: '',
        classification: 'unknown',
        title: 'Add or verify the required note Material callout.',
        message: 'Extracted drawing semantics explicitly marked the MATERIAL note as uncertain.',
        recommended_fix: 'Verify the required note text is present and readable. Confirm extraction can still match the note to MATERIAL.',
        evidence: [
          {
            source: 'drawing_quality.semantic_quality.extracted_evidence',
            path: 'required_notes.MATERIAL.classification',
            value: 'unknown',
          },
        ],
      },
      {
        id: 'mapping:unmatched-dimensions:unmatched',
        severity: 'info',
        category: 'mapping',
        target_requirement_id: 'unmatched_dimensions',
        target_feature_id: '',
        classification: 'unmatched',
        title: 'Improve intent aliases or drawing labels for unmatched extracted dimensions.',
        message: 'Some extracted dimensions did not match any required drawing intent.',
        recommended_fix: 'Review whether the unmatched dimensions should map to an existing required intent.',
        evidence: [
          {
            source: 'drawing_quality.semantic_quality.extracted_evidence',
            path: 'unmatched_dimensions.count',
            value: '1',
          },
        ],
      },
    ],
  };
}

{
  const artifacts = [
    makeArtifact({
      id: 'report-summary',
      key: 'report_summary_json',
      type: 'report.summary-json',
      file_name: 'quality_pass_bracket_report_summary.json',
      extension: '.json',
    }),
    makeArtifact({
      id: 'report-pdf',
      key: 'report_pdf',
      type: 'report.pdf',
      file_name: 'quality_pass_bracket_report.pdf',
      extension: '.pdf',
    }),
    makeArtifact({
      id: 'drawing-svg',
      key: 'drawing_svg',
      type: 'drawing.svg',
      file_name: 'quality_pass_bracket_drawing.svg',
      extension: '.svg',
    }),
    makeArtifact({
      id: 'model-step',
      key: 'model_step',
      type: 'model.step',
      file_name: 'quality_pass_bracket.step',
      extension: '.step',
    }),
    makeArtifact({
      id: 'model-stl',
      key: 'model_stl',
      type: 'model.stl',
      file_name: 'quality_pass_bracket.stl',
      extension: '.stl',
    }),
    makeArtifact({
      id: 'manifest',
      key: 'create_manifest',
      type: 'output.manifest.json',
      file_name: 'quality_pass_bracket_manifest.json',
      extension: '.json',
    }),
    makeArtifact({
      id: 'create-quality',
      key: 'create_quality',
      type: 'model.quality-summary',
      file_name: 'quality_pass_bracket_create_quality.json',
      extension: '.json',
    }),
    makeArtifact({
      id: 'drawing-quality',
      key: 'drawing_quality',
      type: 'drawing.quality-summary',
      file_name: 'quality_pass_bracket_drawing_quality.json',
      extension: '.json',
    }),
    makeArtifact({
      id: 'extracted-semantics',
      key: 'extracted_drawing_semantics',
      type: 'drawing.extracted-semantics',
      file_name: 'quality_pass_bracket_extracted_drawing_semantics.json',
      extension: '.json',
    }),
  ];

  const model = buildQualityDashboardModel({
    artifacts,
    artifactPayloads: {
      'report-summary': {
        overall_status: 'pass',
        ready_for_manufacturing_review: true,
        blocking_issues: [],
        top_risks: [],
        recommended_actions: ['Archive the approved release bundle.'],
        artifacts_referenced: [
          {
            key: 'create_manifest',
            status: 'in_memory',
          },
        ],
        surfaces: {
          create_quality: {
            available: true,
            status: 'pass',
            invalid_shape: false,
            blocking_issues: [],
            warnings: [],
          },
          drawing_quality: {
            available: true,
            status: 'pass',
            score: 100,
            missing_required_dimensions: [],
            conflict_count: 0,
            overlap_count: 0,
            traceability_coverage_percent: 100,
            recommended_actions: [],
            blocking_issues: [],
            warnings: [],
            semantic_quality: {
              enforceable: false,
              suggested_actions: [],
              extracted_evidence: makeAvailableExtractedEvidence(),
            },
          },
          dfm: {
            available: true,
            status: 'pass',
            score: 100,
            severity_counts: {
              critical: 0,
              major: 0,
              minor: 0,
              info: 1,
            },
            top_fixes: ['Optional: add a fillet on the highest stress corner.'],
            blocking_issues: [],
            warnings: [],
          },
        },
      },
    },
  });

  assert.equal(model.source, 'report_summary');
  assert.equal(model.configName, 'quality_pass_bracket');
  assert.equal(model.layout, 'passed');
  assert.equal(model.overallStatus, 'pass');
  assert.equal(model.readyForManufacturingReview, true);
  assert.equal(model.readyLabel, 'Yes');
  assert.equal(model.decisionCopies.gateCopy, 'All required quality gates passed');
  assert.equal(model.decisionCopies.blockedCopy, 'No manufacturing blockers');
  assert.equal(model.decisionCopies.readyCopy, 'Ready for manufacturing review: Yes');
  assert.equal(model.surfaces.find((surface) => surface.id === 'geometry')?.status, 'pass');
  assert.equal(model.surfaces.find((surface) => surface.id === 'drawing')?.status, 'pass');
  assert.equal(model.surfaces.find((surface) => surface.id === 'dfm')?.status, 'pass');
  assert.equal(model.surfaces.find((surface) => surface.id === 'report')?.status, 'pass');
  assert.equal(model.artifactLinks.some((artifact) => artifact.fileName === 'quality_pass_bracket_report.pdf'), true);
  assert.equal(model.artifactLinks.some((artifact) => artifact.fileName === 'quality_pass_bracket.step'), true);
  assert.equal(model.recommendedActions[0], 'Archive the approved release bundle.');
  assert.equal(model.checks.passed.some((entry) => entry.label === 'Overall status'), true);
  assert.equal(model.checks.passed.some((entry) => entry.label === 'Ready for manufacturing review'), true);
  assert.equal(model.checks.passed.some((entry) => entry.label === 'DFM'), true);
  assert.equal(model.checks.failed.length, 0);
  assert.equal(model.checks.unavailable.length, 2);
  assert.deepEqual(
    model.checks.unavailable.map((entry) => entry.displayStatus),
    ['Optional missing', 'Optional missing']
  );
  assert.deepEqual(model.passedRequiredGateChecks.map((entry) => entry.label), ['Geometry', 'Drawing', 'DFM', 'Report']);
  assert.deepEqual(model.optionalImprovements, ['Archive the approved release bundle.']);
  assert.equal(model.checks.passed.find((entry) => entry.label === 'Create Manifest')?.displayStatus, 'Computed in report');
  assert.equal(model.checks.passed.some((entry) => entry.displayStatus === 'in_memory'), false);
  assert.equal(model.drawingQuality.statusLabel, 'Pass');
  assert.equal(model.drawingQuality.criticalCoverageLabel, '100% traceability coverage');
  assert.equal(model.drawingQuality.decisionImpact, 'Does not block manufacturing review');
  assert.deepEqual(model.drawingQuality.missingRequiredDimensions, []);
  assert.deepEqual(model.drawingQuality.missingNotesViews, []);
  assert.deepEqual(model.drawingQuality.suggestedActions, ['No drawing action required.']);
  assert.equal(model.drawingQuality.evidenceArtifact.label, 'Drawing quality JSON');
  assert.equal(model.drawingQuality.extractedSemantics.statusLabel, 'Available');
  assert.equal(model.drawingQuality.extractedSemantics.impactLabel, 'Advisory');
  assert.equal(model.drawingQuality.extractedSemantics.summary, 'Required drawing semantics were confirmed from extracted evidence.');
  assert.equal(model.drawingQuality.extractedSemantics.coverageItems[0].value, '2 / 2 extracted');
  assert.equal(model.drawingQuality.extractedSemantics.requiredGroups[0].items[0].classificationLabel, 'Extracted');
  assert.equal(model.drawingQuality.extractedSemantics.requiredGroups[1].items[0].detail, 'Matched extracted evidence: Material: AL6061');
  assert.equal(model.drawingQuality.extractedSemantics.evidenceArtifact.label, 'Extracted drawing semantics JSON');
  assert.equal(model.drawingQuality.extractedSemantics.evidenceItem.value, 'extracted_drawing_semantics_json');
  assert.equal(model.drawingQuality.extractedSemantics.readinessCopy, 'Manufacturing readiness is still determined by required Geometry / Drawing / DFM gates.');
  assert.equal(model.drawingQuality.extractedSemantics.suggestedActionCount, 0);
  assert.equal(model.drawingQuality.extractedSemantics.suggestedActionEmptyCopy, 'No additional drawing actions were suggested from extracted evidence.');
}

{
  const artifacts = [
    makeArtifact({
      id: 'report-summary',
      key: 'report_summary_json',
      type: 'report.summary-json',
      file_name: 'ks_bracket_report_summary.json',
      extension: '.json',
    }),
    makeArtifact({
      id: 'report-pdf',
      key: 'report_pdf',
      type: 'report.pdf',
      file_name: 'ks_bracket_report.pdf',
      extension: '.pdf',
    }),
    makeArtifact({
      id: 'drawing-svg',
      key: 'drawing_svg',
      type: 'drawing.svg',
      file_name: 'ks_bracket_drawing.svg',
      extension: '.svg',
    }),
    makeArtifact({
      id: 'extracted-semantics',
      key: 'extracted_drawing_semantics',
      type: 'drawing.extracted-semantics',
      file_name: 'ks_bracket_extracted_drawing_semantics.json',
      extension: '.json',
    }),
  ];

  const model = buildQualityDashboardModel({
    artifacts,
    artifactPayloads: {
      'report-summary': {
        overall_status: 'fail',
        ready_for_manufacturing_review: false,
        blocking_issues: [
          'Generated model shape is invalid.',
          'Dimension conflict count 7 exceeds the allowed maximum 0.',
        ],
        top_risks: [
          'Missing required drawing dimensions: HOLE_DIA.',
          'DFM critical findings: 2.',
        ],
        recommended_actions: [
          'Repair the generated model geometry before proceeding to manufacturing review.',
          'Increase edge distance around hole1 and hole3.',
        ],
        artifacts_referenced: [
          {
            key: 'fem',
            label: 'FEM analysis',
            status: 'not_run',
            required: false,
          },
          {
            key: 'tolerance',
            label: 'Tolerance analysis',
            status: 'not_available',
            required: false,
          },
        ],
        surfaces: {
          create_quality: {
            available: true,
            status: 'fail',
            invalid_shape: true,
            blocking_issues: ['Generated model shape is invalid.'],
            warnings: [],
          },
          drawing_quality: {
            available: true,
            status: 'fail',
            score: 71,
            missing_required_dimensions: ['HOLE_DIA'],
            missing_required_views: ['section A-A'],
            missing_required_notes: ['material callout'],
            conflict_count: 7,
            overlap_count: 0,
            traceability_coverage_percent: 0,
            recommended_actions: ['Add or map the missing required dimension intent(s): HOLE_DIA.'],
            blocking_issues: ['Dimension conflict count 7 exceeds the allowed maximum 0.'],
            warnings: [],
            semantic_quality: {
              enforceable: false,
              suggested_actions: ['Review low-confidence or incomplete extracted dimension evidence for: HOLE_DIA.'],
              extracted_evidence: makePartialExtractedEvidence(),
            },
          },
          dfm: {
            available: true,
            status: 'fail',
            score: 70,
            severity_counts: {
              critical: 2,
              major: 0,
              minor: 0,
              info: 0,
            },
            top_fixes: ['Increase edge distance around hole1 and hole3.'],
            blocking_issues: ['hole1 edge distance 3.5 mm < 9.0 mm'],
            warnings: [],
          },
        },
      },
    },
  });

  assert.equal(model.source, 'report_summary');
  assert.equal(model.configName, 'ks_bracket');
  assert.equal(model.layout, 'failed');
  assert.equal(model.overallStatus, 'fail');
  assert.equal(model.readyForManufacturingReview, false);
  assert.equal(model.readyLabel, 'No');
  assert.equal(model.decisionCopies.blockedCopy, 'Manufacturing review blocked by 3 quality checks');
  assert.equal(model.decisionCopies.readyCopy, 'Ready for manufacturing review: No because Geometry, Drawing, DFM failed');
  assert.equal(model.surfaces.find((surface) => surface.id === 'geometry')?.status, 'fail');
  assert.equal(model.surfaces.find((surface) => surface.id === 'drawing')?.status, 'fail');
  assert.equal(model.surfaces.find((surface) => surface.id === 'dfm')?.status, 'fail');
  assert.equal(model.blockers.some((entry) => entry.includes('Generated model shape is invalid.')), true);
  assert.equal(model.recommendedActions.some((entry) => entry.includes('Increase edge distance')), true);
  assert.equal(model.checks.failed.some((entry) => entry.label === 'Overall status'), true);
  assert.equal(model.checks.failed.some((entry) => entry.label === 'Ready for manufacturing review'), true);
  assert.equal(model.checks.failed.some((entry) => entry.label === 'Geometry'), true);
  assert.equal(model.checks.failed.some((entry) => entry.label === 'Drawing'), true);
  assert.equal(model.checks.failed.some((entry) => entry.label === 'DFM'), true);
  assert.equal(model.checks.passed.some((entry) => entry.label === 'Report PDF'), true);
  assert.deepEqual(model.failedGateNames, ['Geometry', 'Drawing', 'DFM']);
  assert.equal(model.failedGateChecks.some((entry) => entry.label === 'FEM analysis'), false);
  assert.equal(model.failedGateChecks.some((entry) => entry.label === 'Tolerance analysis'), false);
  assert.equal(model.checks.unavailable.find((entry) => entry.label === 'FEM analysis')?.displayStatus, 'Optional not run');
  assert.equal(model.checks.unavailable.find((entry) => entry.label === 'Tolerance analysis')?.displayStatus, 'Optional missing');
  assert.equal(model.blockers.length, 4);
  assert.equal(model.drawingQuality.statusLabel, 'Fail');
  assert.equal(model.drawingQuality.decisionImpact, 'Blocks manufacturing review');
  assert.deepEqual(model.drawingQuality.missingRequiredDimensions, ['HOLE_DIA']);
  assert.deepEqual(model.drawingQuality.missingNotesViews, ['View: section A-A', 'Note: material callout']);
  assert.equal(model.drawingQuality.blockers.some((entry) => entry.includes('Dimension conflict count 7')), true);
  assert.equal(model.drawingQuality.suggestedActions.some((entry) => entry.includes('HOLE_DIA')), true);
  assert.equal(model.drawingQuality.extractedSemantics.statusLabel, 'Partial');
  assert.equal(model.drawingQuality.extractedSemantics.summary, 'Some drawing requirements could not be confirmed from extracted evidence.');
  assert.equal(model.drawingQuality.extractedSemantics.coverageItems[0].value, '1 extracted, 2 unknown');
  assert.equal(model.drawingQuality.extractedSemantics.coverageItems[1].value, '1 extracted, 1 unknown');
  assert.equal(model.drawingQuality.extractedSemantics.coverageItems[2].value, '4 / 4 extracted');
  assert.equal(model.drawingQuality.extractedSemantics.requiredGroups[0].items[0].classificationLabel, 'Extracted');
  assert.equal(model.drawingQuality.extractedSemantics.requiredGroups[0].items[1].classificationLabel, 'Unknown');
  assert.equal(model.drawingQuality.extractedSemantics.requiredGroups[1].items[1].classificationLabel, 'Unknown');
  assert.equal(model.drawingQuality.extractedSemantics.requiredGroups[0].items[1].detail, 'Low-confidence candidate: 16');
  assert.equal(model.drawingQuality.extractedSemantics.requiredGroups[1].items[0].classificationLabel, 'Extracted');
  assert.equal(model.drawingQuality.extractedSemantics.unmatchedGroups[0].items[0].classificationLabel, 'Advisory');
  assert.equal(model.drawingQuality.extractedSemantics.unmatchedGroups[1].items[0].label, 'Tolerance: KS B 0401 m');
  assert.equal(model.drawingQuality.extractedSemantics.unmatchedSummary, 'Some extracted drawing text could not be matched to required intent.');
  assert.equal(model.drawingQuality.extractedSemantics.readinessCopy, 'Still blocked by required Geometry / Drawing / DFM gates.');
  assert.equal(model.drawingQuality.extractedSemantics.suggestedActionCount, 3);
  assert.deepEqual(
    model.drawingQuality.extractedSemantics.suggestedActionGroups.map((group) => group.title),
    ['Dimensions', 'Notes', 'Mapping & labels']
  );
  assert.equal(model.drawingQuality.extractedSemantics.suggestedActionGroups[0].items[0].impactLabel, 'Review');
  assert.equal(model.drawingQuality.extractedSemantics.suggestedActionGroups[0].items[0].classificationLabel, 'Low confidence');
  assert.equal(model.drawingQuality.extractedSemantics.suggestedActionGroups[0].items[0].targetSummary, 'Requirement: HOLE_DIA · Feature: hole_001');
  assert.equal(model.drawingQuality.extractedSemantics.suggestedActionGroups[0].items[0].evidenceSourceSummary, 'Evidence source: Extracted drawing semantics');
  assert.equal(model.drawingQuality.extractedSemantics.suggestedActionGroups[1].items[0].title.includes('Material callout'), true);
  assert.equal(model.drawingQuality.extractedSemantics.suggestedActionGroups[2].items[0].impactLabel, 'Info');
  assert.equal(model.blockers.some((entry) => entry.includes('Improve intent aliases')), false);
  assert.equal(model.readyLabel, 'No');
}

{
  const artifacts = [
    makeArtifact({
      id: 'report-summary',
      key: 'report_summary_json',
      type: 'report.summary-json',
      file_name: 'optional_missing_report_summary.json',
      extension: '.json',
    }),
    makeArtifact({
      id: 'report-pdf',
      key: 'report_pdf',
      type: 'report.pdf',
      file_name: 'optional_missing_report.pdf',
      extension: '.pdf',
    }),
  ];

  const model = buildQualityDashboardModel({
    artifacts,
    artifactPayloads: {
      'report-summary': {
        overall_status: 'pass',
        ready_for_manufacturing_review: true,
        blocking_issues: [],
        top_risks: [],
        recommended_actions: ['Optional: rerun tolerance for a wider production sample.'],
        missing_optional_artifacts: ['fem', 'tolerance'],
        artifacts_referenced: [
          {
            key: 'fem',
            label: 'FEM analysis',
            status: 'not_run',
            required: false,
          },
          {
            key: 'tolerance',
            label: 'Tolerance analysis',
            status: 'not_available',
            required: false,
          },
        ],
        surfaces: {
          create_quality: {
            available: true,
            status: 'pass',
            invalid_shape: false,
            blocking_issues: [],
            warnings: [],
          },
          drawing_quality: {
            available: true,
            status: 'pass',
            score: 100,
            missing_required_dimensions: [],
            conflict_count: 0,
            overlap_count: 0,
            traceability_coverage_percent: 100,
            blocking_issues: [],
            warnings: [],
          },
          dfm: {
            available: true,
            status: 'pass',
            score: 100,
            severity_counts: {
              critical: 0,
              major: 0,
              minor: 0,
              info: 0,
            },
            top_fixes: [],
            blocking_issues: [],
            warnings: [],
          },
        },
      },
    },
  });

  assert.equal(model.layout, 'passed');
  assert.deepEqual(model.blockers, []);
  assert.deepEqual(model.failedGateNames, []);
  assert.equal(model.failedGateChecks.length, 0);
  assert.equal(model.checks.unavailable.find((entry) => entry.label === 'FEM analysis')?.displayStatus, 'Optional not run');
  assert.equal(model.checks.unavailable.find((entry) => entry.label === 'Tolerance analysis')?.displayStatus, 'Optional missing');
  assert.deepEqual(model.optionalImprovements, ['Optional: rerun tolerance for a wider production sample.']);
  assert.equal(model.drawingQuality.statusLabel, 'Pass');
  assert.equal(model.drawingQuality.decisionImpact, 'Does not block manufacturing review');
}

{
  const model = buildQualityDashboardModel({
    artifacts: [
      makeArtifact({
        id: 'report-summary',
        key: 'report_summary_json',
        type: 'report.summary-json',
        file_name: 'required_missing_report_summary.json',
        extension: '.json',
      }),
    ],
    artifactPayloads: {
      'report-summary': {
        overall_status: 'incomplete',
        ready_for_manufacturing_review: null,
        blocking_issues: [],
        top_risks: [],
        recommended_actions: [],
        artifacts_referenced: [
          {
            key: 'create_quality',
            label: 'Create quality JSON',
            status: 'not_available',
            required: true,
          },
        ],
        surfaces: {
          create_quality: {
            available: false,
            status: 'not_available',
            blocking_issues: [],
            warnings: [],
          },
          drawing_quality: {
            available: true,
            status: 'pass',
            blocking_issues: [],
            warnings: [],
          },
          dfm: {
            available: true,
            status: 'pass',
            severity_counts: {
              critical: 0,
              major: 0,
              minor: 0,
              info: 0,
            },
            blocking_issues: [],
            warnings: [],
          },
        },
      },
    },
  });

  assert.equal(model.layout, 'incomplete');
  assert.equal(model.failedGateNames.includes('Geometry'), true);
  assert.equal(model.failedGateChecks.find((entry) => entry.label === 'Geometry')?.displayStatus, 'Required missing');
  assert.equal(model.checks.unavailable.find((entry) => entry.label === 'Create quality JSON')?.displayStatus, 'Required missing');
}

{
  const model = buildQualityDashboardModel({
    artifacts: [
      makeArtifact({
        id: 'report-summary',
        key: 'report_summary_json',
        type: 'report.summary-json',
        file_name: 'drawing_unavailable_report_summary.json',
        extension: '.json',
      }),
    ],
    artifactPayloads: {
      'report-summary': {
        overall_status: 'incomplete',
        ready_for_manufacturing_review: null,
        blocking_issues: [],
        top_risks: [],
        recommended_actions: [],
        artifacts_referenced: [],
        surfaces: {
          create_quality: {
            available: true,
            status: 'pass',
            blocking_issues: [],
            warnings: [],
          },
          drawing_quality: {
            available: false,
            status: 'not_available',
            blocking_issues: [],
            warnings: [],
          },
          dfm: {
            available: true,
            status: 'pass',
            severity_counts: {
              critical: 0,
              major: 0,
              minor: 0,
              info: 0,
            },
            blocking_issues: [],
            warnings: [],
          },
        },
      },
    },
  });

  assert.equal(model.drawingQuality.statusLabel, 'Unknown');
  assert.equal(model.drawingQuality.decisionImpact, 'Unknown - drawing semantic QA not available for this job');
  assert.deepEqual(model.drawingQuality.suggestedActions, ['Run drawing semantic QA to produce drawing_quality evidence.']);
  assert.equal(model.drawingQuality.evidenceArtifact.label, 'Report summary JSON');
  assert.equal(model.drawingQuality.extractedSemantics.statusLabel, 'Unknown');
  assert.equal(model.drawingQuality.extractedSemantics.summary, 'Extracted drawing semantics evidence is not available for this job.');
  assert.equal(model.drawingQuality.extractedSemantics.evidenceItem.value, 'Not linked');
}

assert.equal(formatQualityStatusLabel('generated', true), 'Generated');
assert.equal(formatQualityStatusLabel('available', false), 'Available');
assert.equal(formatQualityStatusLabel('in_memory', false), 'Computed in report');
assert.equal(formatQualityStatusLabel('not_run', false), 'Optional not run');
assert.equal(formatQualityStatusLabel('not_available', false), 'Optional missing');
assert.equal(formatQualityStatusLabel('missing', false), 'Optional missing');
assert.equal(formatQualityStatusLabel('not_available', true), 'Required missing');
assert.equal(formatQualityStatusLabel('missing', true), 'Required missing');

{
  const artifacts = [
    makeArtifact({
      id: 'create-quality',
      key: 'create_quality',
      type: 'model.quality-summary',
      file_name: 'fallback_probe_create_quality.json',
      extension: '.json',
    }),
    makeArtifact({
      id: 'drawing-quality',
      key: 'drawing_quality',
      type: 'drawing.quality-summary',
      file_name: 'fallback_probe_drawing_quality.json',
      extension: '.json',
    }),
    makeArtifact({
      id: 'manifest',
      key: 'create_manifest',
      type: 'output.manifest.json',
      file_name: 'fallback_probe_manifest.json',
      extension: '.json',
    }),
    makeArtifact({
      id: 'report-pdf',
      key: 'report_pdf',
      type: 'report.pdf',
      file_name: 'fallback_probe_report.pdf',
      extension: '.pdf',
      exists: false,
    }),
  ];

  const model = buildQualityDashboardModel({
    artifacts,
    artifactPayloads: {
      'create-quality': {
        status: 'pass',
        geometry: {
          valid_shape: true,
        },
        blocking_issues: [],
        warnings: [],
      },
      'drawing-quality': {
        status: 'pass',
        score: 96,
        dimensions: {
          missing_required_intents: [],
          conflict_count: 0,
        },
        views: {
          overlap_count: 0,
        },
        traceability: {
          coverage_percent: 100,
        },
        blocking_issues: [],
        warnings: [],
        recommended_actions: [],
      },
      manifest: {
        command: 'report',
      },
    },
  });

  assert.equal(model.source, 'quality_artifact_fallback');
  assert.equal(model.configName, 'fallback_probe');
  assert.equal(model.layout, 'incomplete');
  assert.equal(model.overallStatus, 'incomplete');
  assert.equal(model.readyForManufacturingReview, null);
  assert.equal(model.readyLabel, 'Unknown');
  assert.equal(model.surfaces.find((surface) => surface.id === 'geometry')?.status, 'pass');
  assert.equal(model.surfaces.find((surface) => surface.id === 'drawing')?.status, 'pass');
  assert.equal(model.surfaces.find((surface) => surface.id === 'dfm')?.status, 'not_available');
  assert.equal(model.surfaces.find((surface) => surface.id === 'report')?.status, 'available');
  assert.equal(model.blockers.some((entry) => entry.includes('DFM')), true);
  assert.equal(model.artifactLinks.some((artifact) => artifact.fileName === 'fallback_probe_report.pdf'), false);
  assert.equal(model.artifactLinks.some((artifact) => artifact.fileName === 'fallback_probe_manifest.json'), true);
  assert.equal(model.checks.passed.some((entry) => entry.label === 'Geometry'), true);
  assert.equal(model.checks.passed.some((entry) => entry.label === 'Drawing'), true);
  assert.equal(model.checks.unavailable.some((entry) => entry.label === 'DFM'), true);
  assert.equal(model.drawingQuality.statusLabel, 'Pass');
  assert.equal(model.drawingQuality.criticalCoverageLabel, '100% traceability coverage');
  assert.equal(model.drawingQuality.evidenceArtifact.label, 'Drawing quality JSON');
}

{
  const artifacts = [
    makeArtifact({
      id: 'drawing-quality',
      key: 'drawing_quality',
      type: 'drawing.quality-summary',
      file_name: 'fallback_fail_drawing_quality.json',
      extension: '.json',
    }),
  ];

  const model = buildQualityDashboardModel({
    artifacts,
    artifactPayloads: {
      'drawing-quality': {
        status: 'warning',
        score: 83,
        dimensions: {
          missing_required_intents: [],
          missing_optional_intents: ['CHAMFER_NOTE'],
          conflict_count: 0,
        },
        views: {
          required_count: 3,
          generated_count: 3,
          overlap_count: 0,
        },
        notes: {
          missing_optional_notes: ['packaging note'],
        },
        traceability: {
          linked_dimensions: 2,
          dimension_count: 3,
        },
        blocking_issues: [],
        warnings: ['Finish note can be clarified.'],
        recommended_actions: ['Add the required finish note before release.'],
      },
    },
  });

  assert.equal(model.drawingQuality.statusLabel, 'Advisory');
  assert.equal(model.drawingQuality.decisionImpact, 'Advisory only');
  assert.deepEqual(model.drawingQuality.missingNotesViews, []);
  assert.deepEqual(
    model.drawingQuality.advisoryItems,
    ['Finish note can be clarified.', 'Optional dimension: CHAMFER_NOTE', 'Optional note: packaging note']
  );
}

{
  const model = buildQualityDashboardModel({
    artifacts: [
      makeArtifact({
        id: 'drawing-quality',
        key: 'drawing_quality',
        type: 'drawing.quality-summary',
        file_name: 'fallback_semantic_unknown_drawing_quality.json',
        extension: '.json',
      }),
      makeArtifact({
        id: 'extracted-semantics',
        key: 'extracted_drawing_semantics',
        type: 'drawing.extracted-semantics',
        file_name: 'fallback_semantic_unknown_extracted_drawing_semantics.json',
        extension: '.json',
      }),
    ],
    artifactPayloads: {
      'drawing-quality': {
        status: 'pass',
        score: 92,
        dimensions: {
          missing_required_intents: [],
          conflict_count: 0,
        },
        views: {
          overlap_count: 0,
        },
        traceability: {
          coverage_percent: 100,
        },
        semantic_quality: {
          enforceable: false,
          suggested_actions: ['Review low-confidence semantic evidence.'],
          extracted_evidence: {
            ...makePartialExtractedEvidence(),
            required_dimensions: [{
              ...makePartialExtractedEvidence().required_dimensions[0],
              classification: 'unknown',
            }],
          },
        },
        blocking_issues: [],
        warnings: [],
        recommended_actions: [],
      },
    },
  });

  assert.equal(model.drawingQuality.statusLabel, 'Pass');
  assert.equal(model.drawingQuality.extractedSemantics.requiredGroups[0].items[0].classificationLabel, 'Unknown');
  assert.notEqual(model.drawingQuality.extractedSemantics.requiredGroups[0].items[0].classificationLabel, 'Extracted');
  assert.equal(model.drawingQuality.extractedSemantics.evidenceArtifact.label, 'Extracted drawing semantics JSON');
  assert.equal(model.drawingQuality.extractedSemantics.evidenceItem.value, 'extracted_drawing_semantics_json');
}

{
  const model = buildQualityDashboardModel({
    artifacts: [
      makeArtifact({
        id: 'report-summary',
        key: 'report_summary_json',
        type: 'report.summary-json',
        file_name: 'grouped_action_report_summary.json',
        extension: '.json',
      }),
    ],
    artifactPayloads: {
      'report-summary': {
        overall_status: 'pass',
        ready_for_manufacturing_review: true,
        blocking_issues: [],
        top_risks: [],
        recommended_actions: [],
        artifacts_referenced: [],
        surfaces: {
          create_quality: {
            available: true,
            status: 'pass',
            blocking_issues: [],
            warnings: [],
          },
          drawing_quality: {
            available: true,
            status: 'pass',
            score: 95,
            missing_required_dimensions: [],
            conflict_count: 0,
            overlap_count: 0,
            traceability_coverage_percent: 100,
            blocking_issues: [],
            warnings: [],
            semantic_quality: {
              enforceable: false,
              suggested_actions: [],
              suggested_action_details: [
                {
                  id: 'view:section-a-a:missing',
                  severity: 'advisory',
                  category: 'view',
                  target_requirement_id: 'SECTION_A_A',
                  target_feature_id: 'slot_001',
                  classification: 'missing',
                  title: 'Add or label the required view Section A-A if it should appear in the drawing.',
                  message: 'The required section view is missing from extracted evidence.',
                  recommended_fix: 'Add or label the section view and keep the view label readable.',
                  evidence: [
                    {
                      source: 'drawing_quality.semantic_quality.extracted_evidence',
                      path: 'required_views.SECTION_A_A.classification',
                      value: 'missing',
                    },
                  ],
                },
              ],
              extracted_evidence: {
                status: 'partial',
                advisory_only: true,
                path: '/tmp/output/grouped_action_extracted_drawing_semantics.json',
                matched_required_dimensions: 0,
                matched_required_notes: 0,
                matched_required_views: 0,
                unknowns: [],
                limitations: [],
                suggested_actions: [],
                suggested_action_details: [],
              },
            },
          },
          dfm: {
            available: true,
            status: 'pass',
            score: 100,
            severity_counts: {
              critical: 0,
              major: 0,
              minor: 0,
              info: 0,
            },
            top_fixes: [],
            blocking_issues: [],
            warnings: [],
          },
        },
      },
    },
  });

  assert.deepEqual(
    model.drawingQuality.extractedSemantics.suggestedActionGroups.map((group) => group.title),
    ['Views']
  );
  assert.equal(model.drawingQuality.extractedSemantics.suggestedActionGroups[0].items[0].recommendedFix.includes('section view'), true);
  assert.equal(model.readyLabel, 'Yes');
}

console.log('studio-quality-dashboard.test.js: ok');
