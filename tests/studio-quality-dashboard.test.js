import assert from 'node:assert/strict';

import { buildQualityDashboardModel } from '../public/js/studio/quality-dashboard.js';

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
  assert.equal(model.overallStatus, 'pass');
  assert.equal(model.readyForManufacturingReview, true);
  assert.equal(model.readyLabel, 'Yes');
  assert.equal(model.surfaces.find((surface) => surface.id === 'geometry')?.status, 'pass');
  assert.equal(model.surfaces.find((surface) => surface.id === 'drawing')?.status, 'pass');
  assert.equal(model.surfaces.find((surface) => surface.id === 'dfm')?.status, 'pass');
  assert.equal(model.surfaces.find((surface) => surface.id === 'report')?.status, 'pass');
  assert.equal(model.artifactLinks.some((artifact) => artifact.fileName === 'quality_pass_bracket_report.pdf'), true);
  assert.equal(model.artifactLinks.some((artifact) => artifact.fileName === 'quality_pass_bracket.step'), true);
  assert.equal(model.recommendedActions[0], 'Archive the approved release bundle.');
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
  assert.equal(model.overallStatus, 'fail');
  assert.equal(model.readyForManufacturingReview, false);
  assert.equal(model.readyLabel, 'No');
  assert.equal(model.surfaces.find((surface) => surface.id === 'geometry')?.status, 'fail');
  assert.equal(model.surfaces.find((surface) => surface.id === 'drawing')?.status, 'fail');
  assert.equal(model.surfaces.find((surface) => surface.id === 'dfm')?.status, 'fail');
  assert.equal(model.blockers.some((entry) => entry.includes('Generated model shape is invalid.')), true);
  assert.equal(model.recommendedActions.some((entry) => entry.includes('Increase edge distance')), true);
}

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
}

console.log('studio-quality-dashboard.test.js: ok');
