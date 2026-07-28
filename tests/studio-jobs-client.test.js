import assert from 'node:assert/strict';

import {
  MANUFACTURING_ROBOTICS_DEMO_PROFILE,
  MANUFACTURING_ROBOTICS_JOB_TYPE,
  MANUFACTURING_ROBOTICS_TRUST_DEMO,
  buildStudioTrackedJobRequest,
  findResumableStudioJob,
  findResumableStudioJobs,
  isReviewableStudioJob,
  isActiveStudioJobStatus,
  submitStudioTrackedJob,
  supportsStudioJobCancellation,
  supportsStudioJobRetry,
  studioJobTone,
} from '../public/js/studio/jobs-client.js';

assert.equal(isActiveStudioJobStatus('queued'), true);
assert.equal(isActiveStudioJobStatus('running'), true);
assert.equal(isActiveStudioJobStatus('succeeded'), false);
assert.equal(isActiveStudioJobStatus('failed'), false);
assert.equal(isActiveStudioJobStatus('cancelled'), false);

assert.equal(studioJobTone('queued'), 'info');
assert.equal(studioJobTone('running'), 'warn');
assert.equal(studioJobTone('succeeded'), 'ok');
assert.equal(studioJobTone('failed'), 'bad');
assert.equal(studioJobTone('cancelled'), 'bad');

const resumable = findResumableStudioJob([
  { id: 'done', status: 'succeeded' },
  { id: 'queued-job', status: 'queued' },
  { id: 'running-job', status: 'running' },
]);

assert.equal(resumable.id, 'queued-job');
assert.deepEqual(
  findResumableStudioJobs([
    { id: 'done', status: 'succeeded' },
    { id: 'queued-job', status: 'queued' },
    { id: 'running-job', status: 'running' },
  ]).map((job) => job.id),
  ['queued-job', 'running-job']
);
assert.equal(supportsStudioJobCancellation({ capabilities: { cancellation_supported: true } }), true);
assert.equal(supportsStudioJobCancellation({ capabilities: { cancellation_supported: false } }), false);
assert.equal(supportsStudioJobRetry({ capabilities: { retry_supported: true } }), true);
assert.equal(supportsStudioJobRetry({ capabilities: { retry_supported: false } }), false);
assert.equal(isReviewableStudioJob({ type: 'report', status: 'succeeded' }), true);
assert.equal(isReviewableStudioJob({ type: 'inspection-evidence-intake', status: 'succeeded' }), true);
assert.equal(isReviewableStudioJob({ type: 'inspection-evidence-promotion-dry-run', status: 'succeeded' }), true);
assert.equal(isReviewableStudioJob({ type: 'stage5b-evidence-audit', status: 'succeeded' }), true);
assert.equal(isReviewableStudioJob({ type: MANUFACTURING_ROBOTICS_JOB_TYPE, status: 'succeeded' }), true);
assert.equal(isReviewableStudioJob({ type: MANUFACTURING_ROBOTICS_JOB_TYPE, status: 'failed' }), true);
assert.equal(isReviewableStudioJob({ type: 'compare-rev', status: 'succeeded' }), false);
assert.equal(isReviewableStudioJob({ type: 'stabilization-review', status: 'succeeded' }), false);
assert.equal(isReviewableStudioJob({ type: 'draw', status: 'succeeded' }), false);
assert.equal(isReviewableStudioJob({ type: 'inspect', status: 'running' }), false);

assert.deepEqual(buildStudioTrackedJobRequest({
  type: MANUFACTURING_ROBOTICS_JOB_TYPE,
  demoProfile: MANUFACTURING_ROBOTICS_DEMO_PROFILE,
}), {
  type: MANUFACTURING_ROBOTICS_JOB_TYPE,
  demo_profile: MANUFACTURING_ROBOTICS_DEMO_PROFILE,
});
assert.deepEqual(buildStudioTrackedJobRequest({
  type: MANUFACTURING_ROBOTICS_JOB_TYPE,
  demoProfile: MANUFACTURING_ROBOTICS_DEMO_PROFILE,
  trustDemo: MANUFACTURING_ROBOTICS_TRUST_DEMO,
}), {
  type: MANUFACTURING_ROBOTICS_JOB_TYPE,
  demo_profile: MANUFACTURING_ROBOTICS_DEMO_PROFILE,
  trust_demo: MANUFACTURING_ROBOTICS_TRUST_DEMO,
});
assert.throws(() => buildStudioTrackedJobRequest({
  type: MANUFACTURING_ROBOTICS_JOB_TYPE,
  demoProfile: 'unknown-profile',
}), /approved server-owned demo profile/);
assert.throws(() => buildStudioTrackedJobRequest({
  type: MANUFACTURING_ROBOTICS_JOB_TYPE,
  demoProfile: MANUFACTURING_ROBOTICS_DEMO_PROFILE,
  trustDemo: 'arbitrary-failure',
}), /unsupported trust demo/);
assert.throws(() => buildStudioTrackedJobRequest({
  type: MANUFACTURING_ROBOTICS_JOB_TYPE,
  demoProfile: MANUFACTURING_ROBOTICS_DEMO_PROFILE,
  contextPath: '/private/local/input.json',
}), /does not accept browser paths/);
assert.throws(() => buildStudioTrackedJobRequest({
  type: MANUFACTURING_ROBOTICS_JOB_TYPE,
  demoProfile: MANUFACTURING_ROBOTICS_DEMO_PROFILE,
  options: { proofLineage: false },
}), /does not accept browser paths or arbitrary options/);

let capturedRequest = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  capturedRequest = {
    url,
    options,
    body: JSON.parse(options.body),
  };
  return {
    ok: true,
    async json() {
      return {
        ok: true,
        job: {
          id: 'job-review-context',
          status: 'queued',
        },
      };
    },
  };
};

try {
  const submittedJob = await submitStudioTrackedJob({
    type: 'review-context',
    contextPath: 'output/imports/bootstrap-123/artifacts/engineering_context.json',
    modelPath: 'output/imports/bootstrap-123/source/simple_bracket.step',
    bomPath: 'output/imports/bootstrap-123/artifacts/bom.csv',
    inspectionPath: 'output/imports/bootstrap-123/artifacts/inspection.json',
    qualityPath: 'tests/fixtures/sample_quality.csv',
    createQualityPath: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_create_quality.json',
    drawingQualityPath: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_quality.json',
    drawingQaPath: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_qa.json',
    drawingIntentPath: 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_drawing_intent.json',
    featureCatalogPath: 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_feature_catalog.json',
    dfmReportPath: 'docs/examples/infotainment-display-bracket/quality-risk.json',
    compareToPath: 'docs/examples/motor-mount/review/review_pack.json',
  });
  assert.equal(submittedJob.id, 'job-review-context');
  assert.equal(capturedRequest.url, '/api/studio/jobs');
  assert.equal(capturedRequest.options.method, 'POST');
  assert.deepEqual(capturedRequest.body, {
    type: 'review-context',
    context_path: 'output/imports/bootstrap-123/artifacts/engineering_context.json',
    model_path: 'output/imports/bootstrap-123/source/simple_bracket.step',
    bom_path: 'output/imports/bootstrap-123/artifacts/bom.csv',
    inspection_path: 'output/imports/bootstrap-123/artifacts/inspection.json',
    quality_path: 'tests/fixtures/sample_quality.csv',
    create_quality_path: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_create_quality.json',
    drawing_quality_path: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_quality.json',
    drawing_qa_path: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_qa.json',
    drawing_intent_path: 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_drawing_intent.json',
    feature_catalog_path: 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_feature_catalog.json',
    dfm_report_path: 'docs/examples/infotainment-display-bracket/quality-risk.json',
    compare_to_path: 'docs/examples/motor-mount/review/review_pack.json',
  });

  await submitStudioTrackedJob({
    type: MANUFACTURING_ROBOTICS_JOB_TYPE,
    demoProfile: MANUFACTURING_ROBOTICS_DEMO_PROFILE,
    trustDemo: MANUFACTURING_ROBOTICS_TRUST_DEMO,
  });
  assert.deepEqual(capturedRequest.body, {
    type: MANUFACTURING_ROBOTICS_JOB_TYPE,
    demo_profile: MANUFACTURING_ROBOTICS_DEMO_PROFILE,
    trust_demo: MANUFACTURING_ROBOTICS_TRUST_DEMO,
  });
  assert.equal(JSON.stringify(capturedRequest.body).includes('/private/'), false);
  assert.equal(Object.hasOwn(capturedRequest.body, 'options'), false);
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = async () => ({
  ok: false,
  status: 422,
  async json() {
    return {
      ok: false,
      error: {
        code: 'invalid_request',
        messages: 'Request body must be a JSON object.',
      },
    };
  },
});

try {
  await assert.rejects(
    () => submitStudioTrackedJob({
      type: 'create',
      configToml: 'name = "malformed_error_envelope"',
    }),
    /Request body must be a JSON object/
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('studio-jobs-client.test.js: ok');
