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

console.log('studio-quality-dashboard.test.js: ok');
