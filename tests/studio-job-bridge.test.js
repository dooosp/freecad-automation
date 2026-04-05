import assert from 'node:assert/strict';

import {
  translateStudioJobSubmission,
  validateStudioJobSubmission,
} from '../src/server/studio-job-bridge.js';

const baseToml = `
name = "studio_bridge"

[[shapes]]
id = "body"
type = "box"
length = 20
width = 10
height = 5

[export]
formats = ["step"]
directory = "output/studio-bridge"
`;

const drawSubmission = await translateStudioJobSubmission({
  type: 'draw',
  config_toml: baseToml,
  drawing_settings: {
    views: ['front', 'iso'],
    scale: '1:2',
    section_assist: true,
    detail_assist: true,
  },
  options: {
    qa: true,
  },
});

assert.equal(drawSubmission.ok, true, drawSubmission.errors?.join('\n'));
assert.equal(drawSubmission.request.type, 'draw');
assert.deepEqual(drawSubmission.request.config.drawing.views, ['front', 'iso']);
assert.equal(drawSubmission.request.config.drawing.scale, '1:2');
assert.equal(drawSubmission.request.config.drawing.bom_csv, true);
assert.deepEqual(drawSubmission.request.options, { qa: true });

const drawSubmissionWithPlan = await translateStudioJobSubmission({
  type: 'draw',
  config_toml: baseToml,
  drawing_settings: {
    views: ['top'],
    scale: '1:5',
  },
  drawing_plan: {
    dim_intents: [
      {
        id: 'WIDTH',
        value_mm: 45,
        feature: 'body_width',
      },
    ],
  },
});

assert.equal(drawSubmissionWithPlan.ok, true, drawSubmissionWithPlan.errors?.join('\n'));
assert.equal(drawSubmissionWithPlan.request.config.drawing_plan.dim_intents[0].value_mm, 45);
assert.equal(drawSubmissionWithPlan.request.config.drawing.scale, '1:5');

const reportSubmission = await translateStudioJobSubmission({
  type: 'report',
  config_toml: baseToml,
  report_options: {
    style: 'summary',
  },
  options: {
    include_drawing: true,
  },
});

assert.equal(reportSubmission.ok, true, reportSubmission.errors?.join('\n'));
assert.equal(reportSubmission.request.type, 'report');
assert.equal(reportSubmission.request.options.include_drawing, true);
assert.deepEqual(reportSubmission.request.options.report_options, { style: 'summary' });

const invalidShape = validateStudioJobSubmission({
  type: 'create',
  config_toml: '',
  unexpected: true,
});

assert.equal(invalidShape.ok, false);
assert.match(invalidShape.errors.join('\n'), /config_toml is required/);
assert.match(invalidShape.errors.join('\n'), /Unsupported property "unexpected"/);

const invalidDrawingSettings = await translateStudioJobSubmission({
  type: 'create',
  config_toml: baseToml,
  drawing_settings: {
    views: ['front'],
  },
});

assert.equal(invalidDrawingSettings.ok, false);
assert.match(invalidDrawingSettings.errors.join('\n'), /drawing_settings is only supported/);

const invalidDrawingPlan = await translateStudioJobSubmission({
  type: 'report',
  config_toml: baseToml,
  drawing_plan: {
    dim_intents: [],
  },
});

assert.equal(invalidDrawingPlan.ok, false);
assert.match(invalidDrawingPlan.errors.join('\n'), /drawing_plan is only supported/);

const reviewContextSubmission = await translateStudioJobSubmission({
  type: 'review-context',
  context_path: 'output/imports/bootstrap-123/artifacts/engineering_context.json',
  model_path: 'output/imports/bootstrap-123/source/simple_bracket.step',
  quality_path: 'tests/fixtures/sample_quality.csv',
  options: {
    bootstrap: {
      import_diagnostics: {
        import_kind: 'part',
        body_count: 1,
      },
      bootstrap_summary: {
        review_gate: {
          status: 'review_required',
        },
      },
      warnings: ['unit assumption needs review'],
      confidence_map: {
        import_bootstrap: {
          overall: {
            level: 'medium',
            score: 0.6,
          },
        },
      },
    },
  },
});

assert.equal(reviewContextSubmission.ok, true, reviewContextSubmission.errors?.join('\n'));
assert.equal(reviewContextSubmission.request.type, 'review-context');
assert.equal(reviewContextSubmission.request.context_path, 'output/imports/bootstrap-123/artifacts/engineering_context.json');
assert.equal(reviewContextSubmission.request.model_path, 'output/imports/bootstrap-123/source/simple_bracket.step');
assert.equal(reviewContextSubmission.request.quality_path, 'tests/fixtures/sample_quality.csv');
assert.deepEqual(reviewContextSubmission.request.options.bootstrap.import_diagnostics, {
  import_kind: 'part',
  body_count: 1,
});
assert.equal(reviewContextSubmission.request.options.bootstrap.bootstrap_summary.review_gate.status, 'review_required');
assert.deepEqual(reviewContextSubmission.request.options.bootstrap.warnings, ['unit assumption needs review']);
assert.equal(reviewContextSubmission.request.options.bootstrap.confidence_map.import_bootstrap.overall.level, 'medium');

const invalidReviewContextSubmission = validateStudioJobSubmission({
  type: 'review-context',
  artifact_ref: {
    job_id: 'job-review',
    artifact_id: 'artifact-review',
  },
});

assert.equal(invalidReviewContextSubmission.ok, false);
assert.match(invalidReviewContextSubmission.errors.join('\n'), /review-context does not accept config_toml, artifact_ref/);

const missingArtifactResolver = await translateStudioJobSubmission({
  type: 'inspect',
  artifact_ref: {
    job_id: 'job-model',
    artifact_id: 'model-step',
  },
});

assert.equal(missingArtifactResolver.ok, false);
assert.match(missingArtifactResolver.errors.join('\n'), /requires a resolver/);

const invalidReviewContextSourceSubmission = await translateStudioJobSubmission({
  type: 'review-context',
  config_toml: baseToml,
});

assert.equal(invalidReviewContextSourceSubmission.ok, false);
assert.match(invalidReviewContextSourceSubmission.errors.join('\n'), /requires either context_path or model_path/i);
assert.match(invalidReviewContextSourceSubmission.errors.join('\n'), /does not accept config_toml, artifact_ref/i);

const inspectFromArtifact = await translateStudioJobSubmission({
  type: 'inspect',
  artifact_ref: {
    job_id: '  job-model  ',
    artifact_id: '  model-step  ',
  },
}, {
  async resolveArtifactRef(ref) {
    assert.equal(ref.job_id, 'job-model');
    assert.equal(ref.artifact_id, 'model-step');
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: '/tmp/example.step',
        type: 'model.step',
        file_name: 'example.step',
        extension: '.step',
        exists: true,
      },
    };
  },
});

assert.equal(inspectFromArtifact.ok, true, inspectFromArtifact.errors?.join('\n'));
assert.equal(inspectFromArtifact.request.type, 'inspect');
assert.equal(inspectFromArtifact.request.file_path, '/tmp/example.step');
assert.equal(inspectFromArtifact.request.options.studio.source_artifact_id, 'model-step');
assert.equal(inspectFromArtifact.request.options.studio.source_label, 'example.step');

const reportFromArtifact = await translateStudioJobSubmission({
  type: 'report',
  artifact_ref: {
    job_id: 'job-config',
    artifact_id: 'effective-config',
  },
  report_options: {
    style: 'summary',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: '/tmp/effective-config.json',
        type: 'config.effective',
        file_name: 'effective-config.json',
        extension: '.json',
        exists: true,
      },
    };
  },
});

assert.equal(reportFromArtifact.ok, true, reportFromArtifact.errors?.join('\n'));
assert.equal(reportFromArtifact.request.type, 'report');
assert.equal(reportFromArtifact.request.config_path, '/tmp/effective-config.json');
assert.deepEqual(reportFromArtifact.request.options.report_options, { style: 'summary' });
assert.equal(reportFromArtifact.request.options.studio.source_label, 'effective-config.json');

const readinessFromArtifact = await translateStudioJobSubmission({
  type: 'readiness-pack',
  artifact_ref: {
    job_id: 'job-review',
    artifact_id: 'review-pack',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: '/tmp/review_pack.json',
        type: 'review-pack.json',
        file_name: 'review_pack.json',
        extension: '.json',
        exists: true,
        contract: {
          reentry_target: 'review_pack',
        },
      },
      jobArtifacts: [],
    };
  },
});

assert.equal(readinessFromArtifact.ok, true, readinessFromArtifact.errors?.join('\n'));
assert.equal(readinessFromArtifact.request.type, 'readiness-pack');
assert.equal(readinessFromArtifact.request.review_pack_path, '/tmp/review_pack.json');

const unsupportedReviewContext = validateStudioJobSubmission({
  type: 'review-context',
  config_toml: baseToml,
});

assert.equal(unsupportedReviewContext.ok, false);
assert.match(unsupportedReviewContext.errors.join('\n'), /requires either context_path or model_path/i);
assert.match(unsupportedReviewContext.errors.join('\n'), /does not accept config_toml, artifact_ref/i);

const compareFromArtifacts = await translateStudioJobSubmission({
  type: 'compare-rev',
  baseline_artifact_ref: {
    job_id: 'job-baseline',
    artifact_id: 'review-pack-a',
  },
  candidate_artifact_ref: {
    job_id: 'job-candidate',
    artifact_id: 'review-pack-b',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: `/tmp/${ref.artifact_id}.json`,
        type: 'review-pack.json',
        file_name: `${ref.artifact_id}.json`,
        extension: '.json',
        exists: true,
        contract: {
          reentry_target: 'review_pack',
        },
      },
    };
  },
});

assert.equal(compareFromArtifacts.ok, true, compareFromArtifacts.errors?.join('\n'));
assert.equal(compareFromArtifacts.request.type, 'compare-rev');
assert.equal(compareFromArtifacts.request.baseline_path, '/tmp/review-pack-a.json');
assert.equal(compareFromArtifacts.request.candidate_path, '/tmp/review-pack-b.json');

const stabilizationFromArtifacts = await translateStudioJobSubmission({
  type: 'stabilization-review',
  baseline_artifact_ref: {
    job_id: 'job-readiness-a',
    artifact_id: 'readiness-a',
  },
  candidate_artifact_ref: {
    job_id: 'job-readiness-b',
    artifact_id: 'readiness-b',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: `/tmp/${ref.artifact_id}.json`,
        type: 'readiness-report.json',
        file_name: `${ref.artifact_id}.json`,
        extension: '.json',
        exists: true,
        contract: {
          reentry_target: 'readiness_report',
        },
      },
    };
  },
});

assert.equal(stabilizationFromArtifacts.ok, true, stabilizationFromArtifacts.errors?.join('\n'));
assert.equal(stabilizationFromArtifacts.request.type, 'stabilization-review');
assert.equal(stabilizationFromArtifacts.request.baseline_path, '/tmp/readiness-a.json');
assert.equal(stabilizationFromArtifacts.request.candidate_path, '/tmp/readiness-b.json');

const docsFromArtifact = await translateStudioJobSubmission({
  type: 'generate-standard-docs',
  artifact_ref: {
    job_id: 'job-readiness',
    artifact_id: 'readiness-report',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: '/tmp/readiness_report.json',
        type: 'readiness-report.json',
        file_name: 'readiness_report.json',
        extension: '.json',
        exists: true,
        contract: {
          reentry_target: 'readiness_report',
        },
      },
      jobArtifacts: [
        {
          id: 'effective-config',
          path: '/tmp/effective-config.json',
          type: 'config.effective',
          file_name: 'effective-config.json',
          extension: '.json',
          exists: true,
        },
      ],
    };
  },
});

assert.equal(docsFromArtifact.ok, true, docsFromArtifact.errors?.join('\n'));
assert.equal(docsFromArtifact.request.type, 'generate-standard-docs');
assert.equal(docsFromArtifact.request.config_path, '/tmp/effective-config.json');
assert.equal(docsFromArtifact.request.readiness_report_path, '/tmp/readiness_report.json');

const docsFromReadinessOnly = await translateStudioJobSubmission({
  type: 'generate-standard-docs',
  artifact_ref: {
    job_id: 'job-readiness-no-config',
    artifact_id: 'readiness-report',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: '/tmp/readiness_report.json',
        type: 'readiness-report.json',
        file_name: 'readiness_report.json',
        extension: '.json',
        exists: true,
        contract: {
          reentry_target: 'readiness_report',
        },
      },
      jobArtifacts: [],
    };
  },
});

assert.equal(docsFromReadinessOnly.ok, true, docsFromReadinessOnly.errors?.join('\n'));
assert.equal(docsFromReadinessOnly.request.type, 'generate-standard-docs');
assert.equal(docsFromReadinessOnly.request.config_path, '/tmp/readiness_report.json');
assert.equal(docsFromReadinessOnly.request.readiness_report_path, '/tmp/readiness_report.json');
assert.equal(docsFromReadinessOnly.request.options.studio.config_rehydration, 'readiness_report');

const packFromArtifact = await translateStudioJobSubmission({
  type: 'pack',
  artifact_ref: {
    job_id: 'job-docs',
    artifact_id: 'readiness-report',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: '/tmp/readiness_report.json',
        type: 'readiness-report.json',
        file_name: 'readiness_report.json',
        extension: '.json',
        exists: true,
        contract: {
          reentry_target: 'readiness_report',
        },
      },
      jobArtifacts: [
        {
          id: 'docs-manifest',
          path: '/tmp/standard_docs_manifest.json',
          type: 'standard-docs.summary',
          file_name: 'standard_docs_manifest.json',
          extension: '.json',
          exists: true,
        },
      ],
    };
  },
});

assert.equal(packFromArtifact.ok, true, packFromArtifact.errors?.join('\n'));
assert.equal(packFromArtifact.request.type, 'pack');
assert.equal(packFromArtifact.request.readiness_report_path, '/tmp/readiness_report.json');
assert.equal(packFromArtifact.request.docs_manifest_path, '/tmp/standard_docs_manifest.json');

const docsFromBundle = await translateStudioJobSubmission({
  type: 'generate-standard-docs',
  artifact_ref: {
    job_id: 'job-bundle',
    artifact_id: 'release-bundle',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: '/tmp/release_bundle.zip',
        type: 'release-bundle.zip',
        file_name: 'release_bundle.zip',
        extension: '.zip',
        exists: true,
        contract: {
          reentry_target: 'release_bundle',
        },
      },
      jobArtifacts: [],
    };
  },
});

assert.equal(docsFromBundle.ok, true, docsFromBundle.errors?.join('\n'));
assert.equal(docsFromBundle.request.config_path, '/tmp/release_bundle.zip');
assert.equal(docsFromBundle.request.readiness_report_path, '/tmp/release_bundle.zip');

const invalidDocsFromReviewPack = await translateStudioJobSubmission({
  type: 'generate-standard-docs',
  artifact_ref: {
    job_id: 'job-review',
    artifact_id: 'review-pack',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: '/tmp/review_pack.json',
        type: 'review-pack.json',
        file_name: 'review_pack.json',
        extension: '.json',
        exists: true,
        contract: {
          reentry_target: 'review_pack',
        },
      },
      jobArtifacts: [
        {
          id: 'effective-config',
          path: '/tmp/effective-config.json',
          type: 'config.effective',
          file_name: 'effective-config.json',
          extension: '.json',
          exists: true,
        },
      ],
    };
  },
});

assert.equal(invalidDocsFromReviewPack.ok, false);
assert.match(invalidDocsFromReviewPack.errors.join('\n'), /canonical readiness report JSON or a release bundle/i);

const invalidInspectArtifact = await translateStudioJobSubmission({
  type: 'inspect',
  artifact_ref: {
    job_id: 'job-bad',
    artifact_id: 'report-pdf',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: '/tmp/report.pdf',
        type: 'report.pdf',
        file_name: 'report.pdf',
        extension: '.pdf',
        exists: true,
      },
    };
  },
});

assert.equal(invalidInspectArtifact.ok, false);
assert.match(invalidInspectArtifact.errors.join('\n'), /supported model artifact/i);

const invalidReviewContextArtifact = await translateStudioJobSubmission({
  type: 'review-context',
  artifact_ref: {
    job_id: 'job-bad',
    artifact_id: 'report-pdf',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: '/tmp/report.pdf',
        type: 'report.pdf',
        file_name: 'report.pdf',
        extension: '.pdf',
        exists: true,
      },
    };
  },
});

assert.equal(invalidReviewContextArtifact.ok, false);
assert.match(invalidReviewContextArtifact.errors.join('\n'), /requires either context_path or model_path/i);
assert.match(invalidReviewContextArtifact.errors.join('\n'), /does not accept config_toml, artifact_ref/i);

const invalidReportArtifact = await translateStudioJobSubmission({
  type: 'report',
  artifact_ref: {
    job_id: 'job-model',
    artifact_id: 'model-step',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: '/tmp/example.step',
        type: 'model.step',
        file_name: 'example.step',
        extension: '.step',
        exists: true,
      },
    };
  },
});

assert.equal(invalidReportArtifact.ok, false);
assert.match(invalidReportArtifact.errors.join('\n'), /config-like artifact/i);

const invalidDocsArtifact = await translateStudioJobSubmission({
  type: 'generate-standard-docs',
  artifact_ref: {
    job_id: 'job-readiness',
    artifact_id: 'readiness-report',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: '/tmp/readiness_report.json',
        type: 'readiness-report.json',
        file_name: 'readiness_report.json',
        extension: '.json',
        exists: true,
        contract: {
          reentry_target: 'readiness_report',
        },
      },
      jobArtifacts: [],
    };
  },
});

assert.equal(invalidDocsArtifact.ok, true, invalidDocsArtifact.errors?.join('\n'));
assert.equal(invalidDocsArtifact.request.options.studio.config_rehydration, 'readiness_report');

const invalidCompareArtifacts = await translateStudioJobSubmission({
  type: 'compare-rev',
  baseline_artifact_ref: {
    job_id: 'job-baseline',
    artifact_id: 'baseline-readiness',
  },
  candidate_artifact_ref: {
    job_id: 'job-candidate',
    artifact_id: 'candidate-review',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: `/tmp/${ref.artifact_id}.json`,
        type: ref.artifact_id.includes('readiness') ? 'readiness-report.json' : 'review-pack.json',
        file_name: `${ref.artifact_id}.json`,
        extension: '.json',
        exists: true,
        contract: {
          reentry_target: ref.artifact_id.includes('readiness') ? 'readiness_report' : 'review_pack',
        },
      },
    };
  },
});

assert.equal(invalidCompareArtifacts.ok, false);
assert.match(invalidCompareArtifacts.errors.join('\n'), /canonical review-pack JSON/i);

console.log('studio-job-bridge.test.js: ok');
