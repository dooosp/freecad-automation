import assert from 'node:assert/strict';

import {
  translateStudioJobSubmission,
  validateStudioJobSubmission,
} from '../src/server/studio-job-bridge.js';

let manufacturingResolverCalled = false;
const manufacturingDemoSubmission = await translateStudioJobSubmission({
  type: 'manufacturing-action-dataset',
  demo_profile: 'hinge-block-synthetic-inspection-v1',
}, {
  resolveArtifactRef: async () => {
    manufacturingResolverCalled = true;
    throw new Error('manufacturing demo must not resolve browser artifacts');
  },
});
assert.equal(manufacturingDemoSubmission.ok, true, manufacturingDemoSubmission.errors?.join('\n'));
assert.deepEqual(manufacturingDemoSubmission.request, {
  type: 'manufacturing-action-dataset',
  demo_profile: 'hinge-block-synthetic-inspection-v1',
});
assert.equal(manufacturingResolverCalled, false);

const manufacturingMismatchSubmission = await translateStudioJobSubmission({
  type: 'manufacturing-action-dataset',
  demo_profile: 'hinge-block-synthetic-inspection-v1',
  trust_demo: 'revision-mismatch',
});
assert.equal(manufacturingMismatchSubmission.ok, true, manufacturingMismatchSubmission.errors?.join('\n'));
assert.deepEqual(manufacturingMismatchSubmission.request, {
  type: 'manufacturing-action-dataset',
  demo_profile: 'hinge-block-synthetic-inspection-v1',
  trust_demo: 'revision-mismatch',
});

for (const rejected of [
  { type: 'manufacturing-action-dataset' },
  { type: 'manufacturing-action-dataset', demo_profile: 'unknown-profile' },
  { type: 'manufacturing-action-dataset', demo_profile: 'hinge-block-synthetic-inspection-v1', trust_demo: 'custom' },
  { type: 'manufacturing-action-dataset', demo_profile: 'hinge-block-synthetic-inspection-v1', config_toml: 'name = "unsafe"' },
  { type: 'manufacturing-action-dataset', demo_profile: 'hinge-block-synthetic-inspection-v1', artifact_ref: { job_id: 'job', artifact_id: 'artifact' } },
  { type: 'manufacturing-action-dataset', demo_profile: 'hinge-block-synthetic-inspection-v1', options: { proof_lineage: true } },
  { type: 'report', demo_profile: 'hinge-block-synthetic-inspection-v1', config_toml: 'name = "unsafe"' },
]) {
  const validation = validateStudioJobSubmission(rejected);
  assert.equal(validation.ok, false, `unsafe manufacturing studio submission should fail: ${JSON.stringify(rejected)}`);
}

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

const automaticScaleDrawSubmission = await translateStudioJobSubmission({
  type: 'draw',
  config_toml: baseToml,
  drawing_settings: {
    views: ['front', 'iso'],
    scale: 'auto',
  },
});

assert.equal(automaticScaleDrawSubmission.ok, true, automaticScaleDrawSubmission.errors?.join('\n'));
assert.equal(Object.hasOwn(automaticScaleDrawSubmission.request.config.drawing, 'scale'), false);

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
  create_quality_path: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_create_quality.json',
  drawing_quality_path: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_quality.json',
  drawing_qa_path: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_qa.json',
  drawing_intent_path: 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_drawing_intent.json',
  feature_catalog_path: 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_feature_catalog.json',
  dfm_report_path: 'docs/examples/infotainment-display-bracket/quality-risk.json',
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
assert.equal(reviewContextSubmission.request.create_quality_path, 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_create_quality.json');
assert.equal(reviewContextSubmission.request.drawing_quality_path, 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_quality.json');
assert.equal(reviewContextSubmission.request.drawing_qa_path, 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_qa.json');
assert.equal(reviewContextSubmission.request.drawing_intent_path, 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_drawing_intent.json');
assert.equal(reviewContextSubmission.request.feature_catalog_path, 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_feature_catalog.json');
assert.equal(reviewContextSubmission.request.dfm_report_path, 'docs/examples/infotainment-display-bracket/quality-risk.json');
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

const invalidDirectProofReviewContext = validateStudioJobSubmission({
  type: 'review-context',
  context_path: 'output/imports/bootstrap-123/artifacts/engineering_context.json',
  options: { proof_lineage: true },
});
assert.equal(invalidDirectProofReviewContext.ok, false);
assert.match(
  invalidDirectProofReviewContext.errors.join('\n'),
  /requires artifact_ref.*registered config sibling.*immutable binding/i
);

const proofReviewContextArtifact = {
  id: 'engineering-context',
  path: '/tmp/jobs/job-proof-review/artifacts/engineering_context.json',
  type: 'engineering-context.json',
  file_name: 'engineering_context.json',
  extension: '.json',
  exists: true,
  scope: 'user-facing',
};
const proofReviewConfigArtifact = {
  id: 'authoritative-config',
  path: '/tmp/jobs/job-proof-review/artifacts/config.toml',
  type: 'input.config',
  file_name: 'config.toml',
  extension: '.toml',
  exists: true,
  scope: 'internal',
};
const proofReviewBinding = (artifact) => ({
  schema_version: '1.0',
  job_id: 'job-proof-review',
  artifact_id: artifact.id,
  path: artifact.path,
  sha256: artifact.id === 'authoritative-config' ? 'a'.repeat(64) : 'b'.repeat(64),
  size_bytes: artifact.id === 'authoritative-config' ? 128 : 256,
});
const proofReviewFromArtifact = await translateStudioJobSubmission({
  type: 'review-context',
  artifact_ref: {
    job_id: 'job-proof-review',
    artifact_id: 'engineering-context',
  },
  options: { proof_lineage: true },
}, {
  async resolveArtifactRef(ref, options = {}) {
    assert.equal(options.proofLineage, true);
    const artifact = ref.artifact_id === 'authoritative-config'
      ? proofReviewConfigArtifact
      : proofReviewContextArtifact;
    return {
      jobId: 'job-proof-review',
      artifact,
      jobArtifacts: [proofReviewContextArtifact, proofReviewConfigArtifact],
      artifactBinding: proofReviewBinding(artifact),
    };
  },
});
assert.equal(proofReviewFromArtifact.ok, true, proofReviewFromArtifact.errors?.join('\n'));
assert.equal(proofReviewFromArtifact.request.context_path, proofReviewContextArtifact.path);
assert.equal(proofReviewFromArtifact.request.config_path, proofReviewConfigArtifact.path);
assert.deepEqual(
  proofReviewFromArtifact.request.options.studio.source_artifact_binding,
  proofReviewBinding(proofReviewContextArtifact)
);
assert.deepEqual(
  proofReviewFromArtifact.request.options.studio.config_artifact_binding,
  proofReviewBinding(proofReviewConfigArtifact)
);

const rejectedProofReviewWithoutConfig = await translateStudioJobSubmission({
  type: 'review-context',
  artifact_ref: {
    job_id: 'job-proof-review',
    artifact_id: 'engineering-context',
  },
  options: { proof_lineage: true },
}, {
  async resolveArtifactRef() {
    return {
      jobId: 'job-proof-review',
      artifact: proofReviewContextArtifact,
      jobArtifacts: [proofReviewContextArtifact],
      artifactBinding: proofReviewBinding(proofReviewContextArtifact),
    };
  },
});
assert.equal(rejectedProofReviewWithoutConfig.ok, false);
assert.match(rejectedProofReviewWithoutConfig.errors.join('\n'), /requires a registered config artifact/i);

const invalidUnsafeArtifactRef = validateStudioJobSubmission({
  type: 'inspect',
  artifact_ref: {
    job_id: '../job-review',
    artifact_id: 'artifact-review',
  },
});

assert.equal(invalidUnsafeArtifactRef.ok, false);
assert.match(invalidUnsafeArtifactRef.errors.join('\n'), /safe tracked id/i);

const invalidEncodedUnsafeArtifactRef = validateStudioJobSubmission({
  type: 'inspect',
  artifact_ref: {
    job_id: 'job-review',
    artifact_id: 'artifact%2Freview',
  },
});

assert.equal(invalidEncodedUnsafeArtifactRef.ok, false);
assert.match(invalidEncodedUnsafeArtifactRef.errors.join('\n'), /safe tracked id/i);

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

const evidenceGraphSubmission = await translateStudioJobSubmission({
  type: 'evidence-graph',
  package_id: ' quality-pass-bracket ',
  review_pack_path: 'docs/examples/quality-pass-bracket/review/review_pack.json',
  readiness_report_path: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
  options: {
    source: 'studio-card',
  },
});

assert.equal(evidenceGraphSubmission.ok, true, evidenceGraphSubmission.errors?.join('\n'));
assert.deepEqual(evidenceGraphSubmission.request, {
  type: 'evidence-graph',
  package_id: 'quality-pass-bracket',
  review_pack_path: 'docs/examples/quality-pass-bracket/review/review_pack.json',
  readiness_report_path: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
  options: {
    source: 'studio-card',
  },
});

const invalidEvidenceGraphSubmission = validateStudioJobSubmission({
  type: 'evidence-graph',
  package_id: '../quality-pass-bracket',
  review_pack_path: '/tmp/review_pack.json',
  readiness_report_path: 'docs/examples/quality-pass-bracket/readiness/readiness_report.txt',
  config_toml: baseToml,
});

assert.equal(invalidEvidenceGraphSubmission.ok, false);
assert.match(invalidEvidenceGraphSubmission.errors.join('\n'), /package_id must be a safe package slug/);
assert.match(invalidEvidenceGraphSubmission.errors.join('\n'), /review_pack_path must be a safe repo-relative JSON path/);
assert.match(invalidEvidenceGraphSubmission.errors.join('\n'), /readiness_report_path must be a safe repo-relative JSON path/);
assert.match(invalidEvidenceGraphSubmission.errors.join('\n'), /evidence-graph does not accept config_toml/);

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
assert.deepEqual(inspectFromArtifact.request.artifact_ref, {
  job_id: 'job-model',
  artifact_id: 'model-step',
});
assert.equal(inspectFromArtifact.request.options.studio.source_artifact_id, 'model-step');
assert.equal(inspectFromArtifact.request.options.studio.source_label, 'example.step');

const internalInspectFromArtifact = await translateStudioJobSubmission({
  type: 'inspect',
  artifact_ref: {
    job_id: 'job-model',
    artifact_id: 'internal-model-step',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: '/tmp/internal.step',
        type: 'model.step',
        file_name: 'internal.step',
        extension: '.step',
        exists: true,
        scope: 'internal',
      },
    };
  },
});

assert.equal(internalInspectFromArtifact.ok, false);
assert.match(internalInspectFromArtifact.errors.join('\n'), /internal tracked artifact/i);

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

const spoofedReadinessFromArtifact = await translateStudioJobSubmission({
  type: 'readiness-pack',
  artifact_ref: {
    job_id: 'job-spoofed-review',
    artifact_id: 'review-pack-name-only',
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
      },
      jobArtifacts: [],
    };
  },
});

assert.equal(spoofedReadinessFromArtifact.ok, false);
assert.match(spoofedReadinessFromArtifact.errors.join('\n'), /AF contract|re-entry target/i);

const unsupportedReviewContext = validateStudioJobSubmission({
  type: 'review-context',
  config_toml: baseToml,
});

assert.equal(unsupportedReviewContext.ok, false);
assert.match(unsupportedReviewContext.errors.join('\n'), /requires either context_path or model_path/i);
assert.match(unsupportedReviewContext.errors.join('\n'), /does not accept config_toml, artifact_ref/i);

const intakeSubmission = await translateStudioJobSubmission({
  type: 'inspection-evidence-intake',
  options: {
    include_github: true,
    package_slugs: ['quality-pass-bracket'],
  },
});

assert.equal(intakeSubmission.ok, true, intakeSubmission.errors?.join('\n'));
assert.deepEqual(intakeSubmission.request, {
  type: 'inspection-evidence-intake',
  options: {
    include_github: true,
    package_slugs: ['quality-pass-bracket'],
  },
});

const invalidIntakeRepoOption = validateStudioJobSubmission({
  type: 'inspection-evidence-intake',
  options: {
    include_github: false,
    github_repo: 'other/repo',
  },
});

assert.equal(invalidIntakeRepoOption.ok, false);
assert.match(invalidIntakeRepoOption.errors.join('\n'), /options only accepts include_github and package_slugs|github_repo/);

const invalidIntakeIncludeGithub = validateStudioJobSubmission({
  type: 'inspection-evidence-intake',
  options: {
    include_github: 'yes',
  },
});

assert.equal(invalidIntakeIncludeGithub.ok, false);
assert.match(invalidIntakeIncludeGithub.errors.join('\n'), /include_github.*boolean/i);

const promotionDryRunFromArtifact = await translateStudioJobSubmission({
  type: 'inspection-evidence-promotion-dry-run',
  artifact_ref: {
    job_id: 'job-intake',
    artifact_id: 'inspection-evidence-intake-report-0',
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: {
        id: ref.artifact_id,
        path: '/tmp/inspection-evidence-intake-report.json',
        type: 'inspection-evidence.intake-report',
        file_name: 'inspection-evidence-intake-report.json',
        extension: '.json',
        exists: true,
      },
    };
  },
});

assert.equal(promotionDryRunFromArtifact.ok, true, promotionDryRunFromArtifact.errors?.join('\n'));
assert.equal(promotionDryRunFromArtifact.request.type, 'inspection-evidence-promotion-dry-run');
assert.deepEqual(promotionDryRunFromArtifact.request.intake_report_artifact_ref, {
  job_id: 'job-intake',
  artifact_id: 'inspection-evidence-intake-report-0',
});
assert.equal(promotionDryRunFromArtifact.request.options.studio.source_artifact_type, 'inspection-evidence.intake-report');

const invalidPromotionDryRunArtifact = await translateStudioJobSubmission({
  type: 'inspection-evidence-promotion-dry-run',
  artifact_ref: {
    job_id: 'job-config',
    artifact_id: 'effective-config',
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

assert.equal(invalidPromotionDryRunArtifact.ok, false);
assert.match(invalidPromotionDryRunArtifact.errors.join('\n'), /inspection-evidence intake report artifact/i);

const invalidPromotionDryRunUnsafePath = validateStudioJobSubmission({
  type: 'inspection-evidence-promotion-dry-run',
  intake_report_path: '../private/intake-report.json',
});

assert.equal(invalidPromotionDryRunUnsafePath.ok, false);
assert.match(invalidPromotionDryRunUnsafePath.errors.join('\n'), /safe repo-relative/i);

const invalidPromotionDryRunInboxPath = validateStudioJobSubmission({
  type: 'inspection-evidence-promotion-dry-run',
  intake_report_path: 'local/stage5b-candidate-evidence-inbox/quality-pass-bracket/intake-report.json',
});

assert.equal(invalidPromotionDryRunInboxPath.ok, false);
assert.match(invalidPromotionDryRunInboxPath.errors.join('\n'), /safe repo-relative/i);

const invalidReviewContextInboxPath = validateStudioJobSubmission({
  type: 'review-context',
  model_path: 'local/stage5b-candidate-evidence-inbox/quality-pass-bracket/source.step',
});

assert.equal(invalidReviewContextInboxPath.ok, false);
assert.match(invalidReviewContextInboxPath.errors.join('\n'), /safe repo-relative/i);

const evidenceReadinessAuditSubmission = await translateStudioJobSubmission({
  type: 'evidence-readiness-audit',
  options: {
    package_slugs: ['quality-pass-bracket'],
  },
});

assert.equal(evidenceReadinessAuditSubmission.ok, true, evidenceReadinessAuditSubmission.errors?.join('\n'));
assert.equal(evidenceReadinessAuditSubmission.request.type, 'evidence-readiness-audit');
assert.deepEqual(evidenceReadinessAuditSubmission.request.options, { package_slugs: ['quality-pass-bracket'] });
assert.equal('out_dir' in evidenceReadinessAuditSubmission.request, false);

const invalidEvidenceReadinessAuditWithArtifact = validateStudioJobSubmission({
  type: 'evidence-readiness-audit',
  artifact_ref: {
    job_id: 'job-intake',
    artifact_id: 'inspection-evidence-intake-report-0',
  },
});

assert.equal(invalidEvidenceReadinessAuditWithArtifact.ok, false);
assert.match(invalidEvidenceReadinessAuditWithArtifact.errors.join('\n'), /evidence-readiness-audit does not accept artifact_ref/i);

const invalidEvidenceReadinessAuditOption = validateStudioJobSubmission({
  type: 'evidence-readiness-audit',
  options: {
    out_dir: '../private',
  },
});

assert.equal(invalidEvidenceReadinessAuditOption.ok, false);
assert.match(invalidEvidenceReadinessAuditOption.errors.join('\n'), /options only accepts package_slugs and generated_at|out_dir/i);

const stage5bAuditSubmission = await translateStudioJobSubmission({
  type: 'stage5b-evidence-audit',
  options: {
    include_github: true,
  },
});

assert.equal(stage5bAuditSubmission.ok, true, stage5bAuditSubmission.errors?.join('\n'));
assert.equal(stage5bAuditSubmission.request.type, 'stage5b-evidence-audit');
assert.deepEqual(stage5bAuditSubmission.request.options, { include_github: true });
assert.equal('out_dir' in stage5bAuditSubmission.request, false);

const invalidStage5bAuditWithPath = validateStudioJobSubmission({
  type: 'stage5b-evidence-audit',
  out_dir: '/tmp/private/stage5b-audit',
});

assert.equal(invalidStage5bAuditWithPath.ok, false);
assert.match(invalidStage5bAuditWithPath.errors.join('\n'), /Unsupported property "out_dir"|does not accept/i);

const invalidStage5bAuditWithArtifact = validateStudioJobSubmission({
  type: 'stage5b-evidence-audit',
  artifact_ref: {
    job_id: 'job-intake',
    artifact_id: 'inspection-evidence-intake-report-0',
  },
});

assert.equal(invalidStage5bAuditWithArtifact.ok, false);
assert.match(invalidStage5bAuditWithArtifact.errors.join('\n'), /stage5b-evidence-audit does not accept artifact_ref/i);

const invalidStage5bAuditIncludeGithub = validateStudioJobSubmission({
  type: 'stage5b-evidence-audit',
  options: {
    include_github: 'yes',
  },
});

assert.equal(invalidStage5bAuditIncludeGithub.ok, false);
assert.match(invalidStage5bAuditIncludeGithub.errors.join('\n'), /include_github.*boolean/i);

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
assert.equal(docsFromBundle.request.options.studio.source, 'artifact-reference');
assert.deepEqual(docsFromBundle.request.options.studio.source_job_id, 'job-bundle');
assert.deepEqual(docsFromBundle.request.options.studio.source_artifact_id, 'release-bundle');

const readinessFromBundle = await translateStudioJobSubmission({
  type: 'readiness-pack',
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

assert.equal(readinessFromBundle.ok, true, readinessFromBundle.errors?.join('\n'));
assert.equal(readinessFromBundle.request.type, 'readiness-pack');
assert.equal(readinessFromBundle.request.review_pack_path, '/tmp/release_bundle.zip');
assert.equal(readinessFromBundle.request.options.studio.source, 'artifact-reference');
assert.equal(readinessFromBundle.request.options.studio.source_job_id, 'job-bundle');
assert.equal(readinessFromBundle.request.options.studio.source_artifact_id, 'release-bundle');
assert.equal('config_toml' in readinessFromBundle.request, false);
assert.equal('context_path' in readinessFromBundle.request, false);

const packFromBundle = await translateStudioJobSubmission({
  type: 'pack',
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
      jobArtifacts: [
        {
          id: 'release-bundle-manifest',
          path: '/tmp/release_bundle_manifest.json',
          type: 'release-bundle.manifest.json',
          file_name: 'release_bundle_manifest.json',
          extension: '.json',
          exists: true,
        },
      ],
    };
  },
});

assert.equal(packFromBundle.ok, true, packFromBundle.errors?.join('\n'));
assert.equal(packFromBundle.request.type, 'pack');
assert.equal(packFromBundle.request.readiness_report_path, '/tmp/release_bundle.zip');
assert.equal('docs_manifest_path' in packFromBundle.request, false);
assert.equal(packFromBundle.request.options.studio.source, 'artifact-reference');
assert.equal(packFromBundle.request.options.studio.source_label, 'release_bundle.zip');

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
