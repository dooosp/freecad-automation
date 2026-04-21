import assert from 'node:assert/strict';

import { collectReportManifestArtifacts } from '../src/services/jobs/job-executor.js';

{
  const artifacts = collectReportManifestArtifacts({
    pdf_path: '/tmp/job-artifacts/quality_pass_bracket_report.pdf',
    summary_json: '/tmp/job-artifacts/quality_pass_bracket_report_summary.json',
    feature_catalog_json: '/tmp/job-artifacts/quality_pass_bracket_feature_catalog.json',
    seeded_artifacts: {
      create_quality: '/tmp/job-artifacts/quality_pass_bracket_create_quality.json',
      drawing_quality: '/tmp/job-artifacts/quality_pass_bracket_drawing_quality.json',
      drawing_planner: '/tmp/job-artifacts/quality_pass_bracket_drawing_planner.json',
      create_manifest: '/tmp/job-artifacts/quality_pass_bracket_manifest.json',
      drawing_manifest: '/tmp/job-artifacts/quality_pass_bracket_drawing_manifest.json',
      drawing_svg: '/tmp/job-artifacts/quality_pass_bracket_drawing.svg',
      model_step: '/tmp/job-artifacts/quality_pass_bracket.step',
      model_stl: '/tmp/job-artifacts/quality_pass_bracket.stl',
    },
  });

  assert.equal(artifacts.some((artifact) => artifact.type === 'report.pdf'), true);
  assert.equal(artifacts.some((artifact) => artifact.type === 'report.summary-json'), true);
  assert.equal(artifacts.some((artifact) => artifact.type === 'feature-catalog.json'), true);
  assert.equal(artifacts.some((artifact) => artifact.type === 'model.quality-summary'), true);
  assert.equal(artifacts.some((artifact) => artifact.type === 'drawing.quality-summary'), true);
  assert.equal(artifacts.some((artifact) => artifact.type === 'drawing.planner'), true);
  assert.equal(artifacts.some((artifact) => artifact.type === 'output.manifest.json'), true);
  assert.equal(artifacts.some((artifact) => artifact.type === 'drawing.output-manifest.json'), true);
  assert.equal(artifacts.some((artifact) => artifact.type === 'drawing.svg'), true);
  assert.equal(artifacts.some((artifact) => artifact.type === 'model.step'), true);
  assert.equal(artifacts.some((artifact) => artifact.type === 'model.stl'), true);
}

{
  const artifacts = collectReportManifestArtifacts({
    pdf_path: '/tmp/job-artifacts/intent_probe_report.pdf',
    summary_json: '/tmp/job-artifacts/intent_probe_report_summary.json',
    report_summary: {
      drawing_intent: {
        part_type: 'mounting_bracket',
        missing_semantics_policy: 'advisory',
      },
    },
  });

  const summaryArtifact = artifacts.find((artifact) => artifact.type === 'report.summary-json');
  assert.equal(summaryArtifact?.metadata?.includes_drawing_intent, true);
  assert.equal(summaryArtifact?.metadata?.missing_semantics_policy, 'advisory');
}

{
  const artifacts = collectReportManifestArtifacts({
    pdf_path: '/tmp/job-artifacts/minimal_report.pdf',
  });

  assert.deepEqual(
    artifacts.map((artifact) => artifact.type),
    ['report.pdf']
  );
}

console.log('job-executor-report-artifacts.test.js: ok');
