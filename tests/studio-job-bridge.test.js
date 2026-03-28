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

const drawSubmission = translateStudioJobSubmission({
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

const drawSubmissionWithPlan = translateStudioJobSubmission({
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

const reportSubmission = translateStudioJobSubmission({
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

const invalidDrawingSettings = translateStudioJobSubmission({
  type: 'create',
  config_toml: baseToml,
  drawing_settings: {
    views: ['front'],
  },
});

assert.equal(invalidDrawingSettings.ok, false);
assert.match(invalidDrawingSettings.errors.join('\n'), /drawing_settings is only supported/);

const invalidDrawingPlan = translateStudioJobSubmission({
  type: 'report',
  config_toml: baseToml,
  drawing_plan: {
    dim_intents: [],
  },
});

assert.equal(invalidDrawingPlan.ok, false);
assert.match(invalidDrawingPlan.errors.join('\n'), /drawing_plan is only supported/);

console.log('studio-job-bridge.test.js: ok');
