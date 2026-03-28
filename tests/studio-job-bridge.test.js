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

const missingArtifactResolver = await translateStudioJobSubmission({
  type: 'inspect',
  artifact_ref: {
    job_id: 'job-model',
    artifact_id: 'model-step',
  },
});

assert.equal(missingArtifactResolver.ok, false);
assert.match(missingArtifactResolver.errors.join('\n'), /requires a resolver/);

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

console.log('studio-job-bridge.test.js: ok');
