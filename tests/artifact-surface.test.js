import assert from 'node:assert/strict';

import {
  applyArtifactPublicationBoundary,
  collectCreateManifestArtifacts,
  collectDrawManifestArtifacts,
  collectReportManifestArtifacts,
  inferCreateArtifactPaths,
  inferDrawArtifactPaths,
  inferReportArtifactPaths,
} from '../src/shared/artifact-surface.js';

const createResult = {
  exports: [
    { format: 'STEP', path: '/repo/output/bracket.step' },
    { format: 'stl', path: '/repo/output/bracket.stl' },
    { format: 'BREP', path: '' },
  ],
};

assert.deepEqual(inferCreateArtifactPaths(createResult), {
  exports: ['/repo/output/bracket.step', '/repo/output/bracket.stl'],
});
assert.deepEqual(collectCreateManifestArtifacts(createResult), [
  {
    type: 'model.step',
    path: '/repo/output/bracket.step',
    label: 'STEP',
    scope: 'user-facing',
    stability: 'stable',
  },
  {
    type: 'model.stl',
    path: '/repo/output/bracket.stl',
    label: 'STL',
    scope: 'user-facing',
    stability: 'stable',
  },
]);

const drawResult = {
  drawing_paths: [
    { format: 'svg', path: '/repo/output/bracket_drawing.svg' },
  ],
};
assert.deepEqual(inferDrawArtifactPaths(drawResult), {
  drawing: '/repo/output/bracket_drawing.svg',
  qa: '/repo/output/bracket_drawing_qa.json',
  qa_issues: '/repo/output/bracket_drawing_qa_issues.json',
  drawing_quality: '/repo/output/bracket_drawing_quality.json',
  drawing_intent: '/repo/output/bracket_drawing_intent.json',
  feature_catalog: '/repo/output/bracket_feature_catalog.json',
  extracted_drawing_semantics: '/repo/output/bracket_extracted_drawing_semantics.json',
  drawing_planner: '/repo/output/bracket_drawing_planner.json',
  repair_report: '/repo/output/bracket_drawing_repair_report.json',
  run_log: '/repo/output/bracket_run_log.json',
  effective_config: '/repo/output/bracket_effective_config.json',
  plan_toml: '/repo/output/bracket_plan.toml',
  plan_json: '/repo/output/bracket_plan.json',
  traceability: '/repo/output/bracket_traceability.json',
  layout_report: '/repo/output/bracket_layout_report.json',
  dimension_map: '/repo/output/bracket_dimension_map.json',
  dim_conflicts: '/repo/output/bracket_dim_conflicts.json',
  dedupe_diagnostics: '/repo/output/bracket_dedupe_diagnostics.json',
});

assert.deepEqual(
  collectDrawManifestArtifacts(drawResult, { surface: 'cli' }).map(({ type, label, scope, stability }) => ({
    type,
    label,
    scope,
    stability,
  })),
  [
    { type: 'drawing.svg', label: 'SVG drawing', scope: 'user-facing', stability: 'stable' },
    { type: 'drawing.qa-report', label: 'Drawing QA', scope: 'user-facing', stability: 'best-effort' },
    { type: 'drawing.qa-issues', label: 'Drawing QA issues', scope: 'user-facing', stability: 'best-effort' },
    { type: 'drawing.quality-summary', label: 'Drawing quality summary', scope: 'user-facing', stability: 'stable' },
    { type: 'drawing.planner', label: 'Drawing planner advisory JSON', scope: 'user-facing', stability: 'best-effort' },
    { type: 'drawing.repair-report', label: 'Repair report', scope: 'user-facing', stability: 'best-effort' },
    { type: 'draw.run-log', label: 'Draw run log', scope: 'internal', stability: 'internal' },
    { type: 'config.effective', label: 'Effective config', scope: 'internal', stability: 'internal' },
    { type: 'draw.plan.toml', label: 'Drawing plan TOML', scope: 'user-facing', stability: 'best-effort' },
    { type: 'draw.plan.json', label: 'Drawing plan JSON', scope: 'user-facing', stability: 'best-effort' },
    { type: 'draw.traceability', label: 'Traceability map', scope: 'user-facing', stability: 'best-effort' },
    { type: 'draw.layout-report', label: 'Layout report', scope: 'user-facing', stability: 'best-effort' },
    { type: 'draw.dimension-map', label: 'Dimension map', scope: 'internal', stability: 'internal' },
    { type: 'draw.dimension-conflicts', label: 'Dimension conflicts', scope: 'internal', stability: 'internal' },
    { type: 'draw.dedupe-diagnostics', label: 'Dedupe diagnostics', scope: 'internal', stability: 'internal' },
  ]
);

assert.deepEqual(
  collectDrawManifestArtifacts(drawResult, { surface: 'tracked-job' }).map(({ type, label, scope, stability }) => ({
    type,
    label,
    scope,
    stability,
  })),
  [
    { type: 'drawing.svg', label: 'drawing', scope: 'user-facing', stability: 'stable' },
    { type: 'drawing.qa-report', label: 'qa', scope: 'user-facing', stability: 'best-effort' },
    { type: 'drawing.qa-issues', label: 'qa_issues', scope: 'user-facing', stability: 'best-effort' },
    { type: 'drawing.quality-summary', label: 'drawing_quality', scope: 'user-facing', stability: 'stable' },
    { type: 'drawing-intent.json', label: 'drawing_intent', scope: 'user-facing', stability: 'stable' },
    { type: 'feature-catalog.json', label: 'feature_catalog', scope: 'user-facing', stability: 'best-effort' },
    { type: 'drawing.extracted-semantics', label: 'extracted_drawing_semantics', scope: 'user-facing', stability: 'best-effort' },
    { type: 'drawing.planner', label: 'drawing_planner', scope: 'user-facing', stability: 'best-effort' },
    { type: 'drawing.repair-report', label: 'repair_report', scope: 'user-facing', stability: 'best-effort' },
    { type: 'draw.run-log', label: 'run_log', scope: 'internal', stability: 'internal' },
    { type: 'config.effective', label: 'effective_config', scope: 'internal', stability: 'internal' },
    { type: 'draw.plan.toml', label: 'plan_toml', scope: 'user-facing', stability: 'best-effort' },
    { type: 'draw.plan.json', label: 'plan_json', scope: 'user-facing', stability: 'best-effort' },
    { type: 'draw.traceability', label: 'traceability', scope: 'user-facing', stability: 'best-effort' },
    { type: 'draw.layout-report', label: 'layout_report', scope: 'user-facing', stability: 'best-effort' },
    { type: 'draw.dimension-map', label: 'dimension_map', scope: 'internal', stability: 'internal' },
    { type: 'draw.dimension-conflicts', label: 'dim_conflicts', scope: 'internal', stability: 'internal' },
    { type: 'draw.dedupe-diagnostics', label: 'dedupe_diagnostics', scope: 'internal', stability: 'internal' },
  ]
);

const reportResult = {
  path: '/repo/output/bracket_report.pdf',
  summary_json: '/repo/output/bracket_report_summary.json',
  drawing_intent_json: '/repo/output/bracket_drawing_intent.json',
  feature_catalog_json: '/repo/output/bracket_feature_catalog.json',
  extracted_drawing_semantics_json: '/repo/output/bracket_extracted_drawing_semantics.json',
  report_summary: {
    drawing_intent: {
      missing_semantics_policy: 'advisory',
    },
  },
  seeded_artifacts: {
    create_quality: '/repo/output/bracket_create_quality.json',
    drawing_quality: '/repo/output/bracket_drawing_quality.json',
    model_step: '/repo/output/bracket.step',
  },
};

assert.deepEqual(inferReportArtifactPaths(reportResult), {
  pdf: '/repo/output/bracket_report.pdf',
  drawing_intent: '/repo/output/bracket_drawing_intent.json',
  feature_catalog: '/repo/output/bracket_feature_catalog.json',
});

assert.deepEqual(
  collectReportManifestArtifacts(reportResult, { surface: 'cli' }).map((artifact) => ({
    type: artifact.type,
    label: artifact.label,
    scope: artifact.scope,
    stability: artifact.stability,
    metadata: artifact.metadata,
  })),
  [
    {
      type: 'report.pdf',
      label: 'Engineering report PDF',
      scope: 'user-facing',
      stability: 'stable',
      metadata: undefined,
    },
    {
      type: 'report.summary-json',
      label: 'Engineering report summary JSON',
      scope: 'user-facing',
      stability: 'stable',
      metadata: {
        includes_drawing_intent: true,
        missing_semantics_policy: 'advisory',
      },
    },
    {
      type: 'feature-catalog.json',
      label: 'Conservative feature catalog JSON',
      scope: 'user-facing',
      stability: 'best-effort',
      metadata: undefined,
    },
    {
      type: 'drawing.extracted-semantics-json',
      label: 'Extracted drawing semantics JSON',
      scope: 'user-facing',
      stability: 'best-effort',
      metadata: undefined,
    },
  ]
);

assert.deepEqual(
  collectReportManifestArtifacts(reportResult, { surface: 'tracked-job' }).map(({ type, label, scope, stability }) => ({
    type,
    label,
    scope,
    stability,
  })),
  [
    { type: 'report.pdf', label: 'PDF report', scope: 'user-facing', stability: 'stable' },
    { type: 'report.summary-json', label: 'Report summary JSON', scope: 'user-facing', stability: 'stable' },
    { type: 'drawing-intent.json', label: 'Drawing intent JSON', scope: 'user-facing', stability: 'stable' },
    { type: 'feature-catalog.json', label: 'Conservative feature catalog JSON', scope: 'user-facing', stability: 'best-effort' },
    { type: 'drawing.extracted-semantics', label: 'Extracted drawing semantics JSON', scope: 'user-facing', stability: 'best-effort' },
    { type: 'model.quality-summary', label: 'Create quality JSON', scope: 'user-facing', stability: 'stable' },
    { type: 'drawing.quality-summary', label: 'Drawing quality JSON', scope: 'user-facing', stability: 'stable' },
    { type: 'model.step', label: 'STEP model', scope: 'user-facing', stability: 'stable' },
  ]
);

const decisionOnlyReport = {
  summary_json: '/repo/output/decision_only_report_summary.json',
  decision_summary: {
    drawing_intent: {
      missing_semantics_policy: 'advisory',
    },
  },
};
assert.equal(
  collectReportManifestArtifacts(decisionOnlyReport, { surface: 'cli' })[0]?.metadata,
  undefined
);
assert.equal(
  collectReportManifestArtifacts(decisionOnlyReport, { surface: 'tracked-job' })[0]?.metadata?.includes_drawing_intent,
  true
);

const boundaryArtifacts = applyArtifactPublicationBoundary({
  projectRoot: '/repo/freecad-automation',
  jobDir: '/repo/freecad-automation/.jobs/job-1',
  artifacts: [
    {
      type: 'report.pdf',
      path: '/private/tmp/outside-report.pdf',
      label: 'Outside report',
      scope: 'user-facing',
      stability: 'stable',
    },
    {
      type: 'report.summary-json',
      path: '/repo/freecad-automation/.jobs/job-1/artifacts/report_summary.json',
      label: 'Tracked summary',
      scope: 'user-facing',
      stability: 'stable',
    },
  ],
});

assert.equal(boundaryArtifacts[0].scope, 'internal');
assert.equal(boundaryArtifacts[0].metadata.publication_boundary.downgraded_to_internal, true);
assert.equal(boundaryArtifacts[1].scope, 'user-facing');

console.log('artifact-surface.test.js: ok');
