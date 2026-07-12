import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildArtifactManifest } from '../lib/artifact-manifest.js';
import { createJobStore } from '../src/services/jobs/job-store.js';
import { LOCAL_API_VERSION } from '../src/server/local-api-contract.js';
import { toPublicJobRequest } from '../src/server/public-job-request.js';
import { validateJobRequest } from '../src/services/jobs/job-executor.js';
import { validateLocalApiResponse } from '../src/server/local-api-schemas.js';

const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-job-api-'));

try {
  const invalid = validateJobRequest({ type: 'draw' });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join('\n'), /config_path|config/);

  const invalidExtraField = validateJobRequest({
    type: 'inspect',
    file_path: 'output/sample.step',
    unexpected: true,
  });
  assert.equal(invalidExtraField.ok, false);
  assert.match(invalidExtraField.errors.join('\n'), /unsupported property "unexpected"/);

  const invalidInspectAbsolutePath = validateJobRequest({
    type: 'inspect',
    file_path: '/tmp/private/sample.step',
  });
  assert.equal(invalidInspectAbsolutePath.ok, false);
  assert.match(invalidInspectAbsolutePath.errors.join('\n'), /safe repo-relative model path/i);

  const validInspectArtifactRef = validateJobRequest({
    type: 'inspect',
    artifact_ref: {
      job_id: 'source-job',
      artifact_id: 'model-step',
    },
  });
  assert.equal(validInspectArtifactRef.ok, true, validInspectArtifactRef.errors?.join('\n'));

  [
    {
      type: 'inspect',
      artifact_ref: {
        job_id: '..',
        artifact_id: 'model-step',
      },
    },
    {
      type: 'inspect',
      artifact_ref: {
        job_id: 'source-job',
        artifact_id: 'model/step',
      },
    },
    {
      type: 'inspection-evidence-promotion-dry-run',
      intake_report_artifact_ref: {
        job_id: 'source-job',
        artifact_id: 'intake-report\u0000json',
      },
    },
    {
      type: 'inspection-evidence-promotion-dry-run',
      intake_report_artifact_ref: {
        job_id: 'source%2fjob',
        artifact_id: 'intake-report-json',
      },
    },
  ].forEach((request) => {
    const validation = validateJobRequest(request);
    assert.equal(validation.ok, false, `${request.type} should reject unsafe artifact refs`);
    assert.match(validation.errors.join('\n'), /safe tracked id/i);
  });

  const invalidDualConfig = validateJobRequest({
    type: 'create',
    config_path: 'configs/examples/ks_bracket.toml',
    config: { name: 'duplicate-source' },
  });
  assert.equal(invalidDualConfig.ok, false);
  assert.match(invalidDualConfig.errors.join('\n'), /must NOT be valid|unsupported|config/);

  const valid = validateJobRequest({
    type: 'report',
    config: {
      name: 'api_report',
      shapes: [{ id: 'body', type: 'box', length: 10, width: 10, height: 10 }],
      export: { formats: ['step'], directory: 'output' },
    },
    options: {
      include_tolerance: false,
    },
  });
  assert.equal(valid.ok, true);

  const invalidReviewTrackedAbsolutePath = validateJobRequest({
    type: 'readiness-pack',
    review_pack_path: '/tmp/review_pack.json',
  });
  assert.equal(invalidReviewTrackedAbsolutePath.ok, false);
  assert.match(invalidReviewTrackedAbsolutePath.errors.join('\n'), /safe repo-relative path/i);

  const validEvidenceGraph = validateJobRequest({
    type: 'evidence-graph',
    package_id: 'quality-pass-bracket',
    review_pack_path: 'docs/examples/quality-pass-bracket/review/review_pack.json',
    readiness_report_path: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
  });
  assert.equal(validEvidenceGraph.ok, true, validEvidenceGraph.errors?.join('\n'));

  const validInspectionPlan = validateJobRequest({
    type: 'inspection-plan',
    review_pack_path: 'tests/fixtures/revision-impact/tightened-tolerance-candidate-review-pack.json',
    scope: 'full',
    options: { generated_at: '2026-07-12T00:00:00Z' },
  });
  assert.equal(validInspectionPlan.ok, true, validInspectionPlan.errors?.join('\n'));
  const invalidDeltaInspectionPlan = validateJobRequest({
    type: 'inspection-plan',
    review_pack_path: 'tests/fixtures/revision-impact/tightened-tolerance-candidate-review-pack.json',
    scope: 'delta',
  });
  assert.equal(invalidDeltaInspectionPlan.ok, false);
  assert.match(invalidDeltaInspectionPlan.errors.join('\n'), /delta scope requires revision_impact_path/i);

  const validRevisionImpactCompanions = validateJobRequest({
    type: 'compare-rev',
    baseline_path: 'tests/fixtures/d-artifacts/sample_review_pack.canonical.json',
    candidate_path: 'tests/fixtures/d-artifacts/sample_review_pack.canonical.json',
    baseline_readiness_path: 'tests/fixtures/c-artifacts/sample_readiness_report.canonical.json',
    candidate_readiness_path: 'tests/fixtures/c-artifacts/sample_readiness_report.canonical.json',
    baseline_config_path: 'configs/examples/ks_bracket.toml',
    candidate_config_path: 'configs/examples/ks_bracket.toml',
    baseline_evidence_envelope_path: 'tests/fixtures/inspection-evidence-onboarding/synthetic-envelope.json',
    candidate_evidence_envelope_path: 'tests/fixtures/inspection-evidence-onboarding/synthetic-envelope.json',
    baseline_evidence_receipt_path: 'tests/fixtures/revision-impact/baseline-receipt.json',
    candidate_evidence_receipt_path: 'tests/fixtures/revision-impact/candidate-receipt.json',
    options: { generated_at: '2026-07-11T00:00:00Z' },
  });
  assert.equal(validRevisionImpactCompanions.ok, true, validRevisionImpactCompanions.errors?.join('\n'));

  const trustedStudioResolvedComparison = validateJobRequest({
    type: 'compare-rev',
    baseline_path: '/tmp/fcad-tracked/jobs/baseline/review_pack.json',
    candidate_path: '/tmp/fcad-tracked/jobs/candidate/review_pack.json',
    options: { studio: { source: 'artifact-comparison' } },
  }, { trustedPathRoots: ['/tmp/fcad-tracked/jobs'] });
  assert.equal(trustedStudioResolvedComparison.ok, true, trustedStudioResolvedComparison.errors?.join('\n'));

  const invalidEvidenceGraphPackage = validateJobRequest({
    type: 'evidence-graph',
    package_id: '../quality-pass-bracket',
    review_pack_path: 'docs/examples/quality-pass-bracket/review/review_pack.json',
    readiness_report_path: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
  });
  assert.equal(invalidEvidenceGraphPackage.ok, false);
  assert.match(invalidEvidenceGraphPackage.errors.join('\n'), /package_id must be a safe package slug/i);

  const invalidEvidenceGraphAbsolutePath = validateJobRequest({
    type: 'evidence-graph',
    package_id: 'quality-pass-bracket',
    review_pack_path: '/tmp/review_pack.json',
    readiness_report_path: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
  });
  assert.equal(invalidEvidenceGraphAbsolutePath.ok, false);
  assert.match(invalidEvidenceGraphAbsolutePath.errors.join('\n'), /review_pack_path must be a safe repo-relative/i);

  [
    {
      type: 'review-context',
      context_path: '/tmp/private/context.json',
    },
    {
      type: 'inspect',
      file_path: 'local/stage5b-candidate-evidence-inbox/quality-pass-bracket/source.step',
    },
    {
      type: 'review-context',
      context_path: 'tests/fixtures/sample_part_context.json',
      create_quality_path: '../private/create_quality.json',
    },
    {
      type: 'readiness-pack',
      review_pack_path: 'C:\\private\\review_pack.json',
    },
    {
      type: 'generate-standard-docs',
      config_path: '/tmp/private/config.toml',
      readiness_report_path: 'docs/examples/motor-mount/readiness/readiness_report.json',
    },
    {
      type: 'pack',
      readiness_report_path: 'docs/examples/motor-mount/readiness/readiness_report.json',
      docs_manifest_path: '../private/standard_docs_manifest.json',
    },
    {
      type: 'compare-rev',
      baseline_path: '/tmp/private/baseline.json',
      candidate_path: 'docs/examples/motor-mount/review/review_pack.json',
    },
    {
      type: 'compare-rev',
      baseline_path: 'docs/examples/motor-mount/review/review_pack.json',
      candidate_path: 'docs/examples/motor-mount/review/review_pack.json',
      candidate_evidence_receipt_path: '../private/attachment_receipt.json',
    },
    {
      type: 'compare-rev',
      baseline_path: '/tmp/tracked/baseline.json',
      candidate_path: '/tmp/tracked/candidate.json',
      baseline_config_path: '/tmp/private/config.toml',
      options: { studio: { source: 'artifact-comparison' } },
    },
    {
      type: 'stabilization-review',
      baseline_path: 'docs/examples/motor-mount/review/review_pack.json',
      candidate_path: '~/private/candidate.json',
    },
    {
      type: 'evidence-graph',
      package_id: 'quality-pass-bracket',
      review_pack_path: 'docs/examples/quality-pass-bracket/review/review_pack.json',
      readiness_report_path: '../private/readiness_report.json',
    },
  ].forEach((request) => {
    const validation = validateJobRequest(request);
    assert.equal(validation.ok, false, `${request.type} should reject unsafe direct path fields`);
    assert.match(validation.errors.join('\n'), /safe repo-relative.*path/i);
  });

  const reviewContextSideInputs = validateJobRequest({
    type: 'review-context',
    context_path: 'tests/fixtures/sample_part_context.json',
    create_quality_path: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_create_quality.json',
    drawing_quality_path: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_quality.json',
    drawing_qa_path: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_qa.json',
    drawing_intent_path: 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_drawing_intent.json',
    feature_catalog_path: 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_feature_catalog.json',
    dfm_report_path: 'docs/examples/infotainment-display-bracket/quality-risk.json',
  });
  assert.equal(reviewContextSideInputs.ok, true, reviewContextSideInputs.errors?.join('\n'));

  const invalidReviewContextInspectionEvidence = validateJobRequest({
    type: 'review-context',
    context_path: 'tests/fixtures/sample_part_context.json',
    inspection_evidence_path: 'docs/examples/demo/inspection/inspection_evidence.json',
  });
  assert.equal(invalidReviewContextInspectionEvidence.ok, false);
  assert.match(invalidReviewContextInspectionEvidence.errors.join('\n'), /inspection_evidence_path|additional properties/i);

  const inspectionEvidenceIntake = validateJobRequest({
    type: 'inspection-evidence-intake',
    options: {
      package_slugs: ['quality-pass-bracket', 'hinge-block'],
      include_github: false,
    },
  });
  assert.equal(inspectionEvidenceIntake.ok, true, inspectionEvidenceIntake.errors?.join('\n'));
  assert.deepEqual(inspectionEvidenceIntake.request.options.package_slugs, ['quality-pass-bracket', 'hinge-block']);

  const invalidInspectionEvidenceIntakeRepo = validateJobRequest({
    type: 'inspection-evidence-intake',
    options: {
      include_github: false,
      github_repo: 'other/repo',
    },
  });
  assert.equal(invalidInspectionEvidenceIntakeRepo.ok, false);
  assert.match(invalidInspectionEvidenceIntakeRepo.errors.join('\n'), /options only accepts include_github and package_slugs|github_repo/);

  const invalidInspectionEvidenceIntakeAlias = validateJobRequest({
    type: 'inspection-evidence-intake',
    options: {
      github: true,
    },
  });
  assert.equal(invalidInspectionEvidenceIntakeAlias.ok, false);
  assert.match(invalidInspectionEvidenceIntakeAlias.errors.join('\n'), /options only accepts include_github and package_slugs|github/);

  const invalidInspectionEvidenceIntakeIncludeGitHub = validateJobRequest({
    type: 'inspection-evidence-intake',
    options: {
      include_github: 'yes',
    },
  });
  assert.equal(invalidInspectionEvidenceIntakeIncludeGitHub.ok, false);
  assert.match(invalidInspectionEvidenceIntakeIncludeGitHub.errors.join('\n'), /include_github.*boolean/i);

  const invalidInspectionEvidenceIntakePath = validateJobRequest({
    type: 'inspection-evidence-intake',
    out: '/tmp/private/intake-report.json',
  });
  assert.equal(invalidInspectionEvidenceIntakePath.ok, false);
  assert.match(invalidInspectionEvidenceIntakePath.errors.join('\n'), /unsupported property "out"/);

  const stage5bAudit = validateJobRequest({
    type: 'stage5b-evidence-audit',
    options: {
      include_github: false,
    },
  });
  assert.equal(stage5bAudit.ok, true, stage5bAudit.errors?.join('\n'));
  assert.deepEqual(stage5bAudit.request.options, { include_github: false });

  const invalidStage5bAuditOutDir = validateJobRequest({
    type: 'stage5b-evidence-audit',
    out_dir: '/tmp/private/stage5b-audit',
  });
  assert.equal(invalidStage5bAuditOutDir.ok, false);
  assert.match(invalidStage5bAuditOutDir.errors.join('\n'), /unsupported property "out_dir"|must NOT have additional properties/);

  const invalidStage5bAuditOptionPath = validateJobRequest({
    type: 'stage5b-evidence-audit',
    options: {
      include_github: false,
      out_dir: '../private/stage5b-audit',
    },
  });
  assert.equal(invalidStage5bAuditOptionPath.ok, false);
  assert.match(invalidStage5bAuditOptionPath.errors.join('\n'), /options\.out_dir|only accepts include_github/);

  const invalidStage5bAuditIncludeGitHub = validateJobRequest({
    type: 'stage5b-evidence-audit',
    options: {
      include_github: 'yes',
    },
  });
  assert.equal(invalidStage5bAuditIncludeGitHub.ok, false);
  assert.match(invalidStage5bAuditIncludeGitHub.errors.join('\n'), /include_github.*boolean/i);

  const promotionDryRunFromSafePath = validateJobRequest({
    type: 'inspection-evidence-promotion-dry-run',
    intake_report_path: 'output/inspection-evidence-intake-report.json',
  });
  assert.equal(promotionDryRunFromSafePath.ok, true, promotionDryRunFromSafePath.errors?.join('\n'));

  const promotionDryRunFromArtifact = validateJobRequest({
    type: 'inspection-evidence-promotion-dry-run',
    intake_report_artifact_ref: {
      job_id: 'job-intake',
      artifact_id: 'inspection-evidence-intake-report-0',
    },
  });
  assert.equal(promotionDryRunFromArtifact.ok, true, promotionDryRunFromArtifact.errors?.join('\n'));

  const invalidPromotionDryRunAbsolutePath = validateJobRequest({
    type: 'inspection-evidence-promotion-dry-run',
    intake_report_path: '/tmp/private/intake-report.json',
  });
  assert.equal(invalidPromotionDryRunAbsolutePath.ok, false);
  assert.match(invalidPromotionDryRunAbsolutePath.errors.join('\n'), /safe repo-relative/i);

  const invalidPromotionDryRunTraversalPath = validateJobRequest({
    type: 'inspection-evidence-promotion-dry-run',
    intake_report_path: '../private/intake-report.json',
  });
  assert.equal(invalidPromotionDryRunTraversalPath.ok, false);
  assert.match(invalidPromotionDryRunTraversalPath.errors.join('\n'), /safe repo-relative/i);

  const invalidPromotionDryRunInboxPath = validateJobRequest({
    type: 'inspection-evidence-promotion-dry-run',
    intake_report_path: 'local/stage5b-candidate-evidence-inbox/quality-pass-bracket/intake-report.json',
  });
  assert.equal(invalidPromotionDryRunInboxPath.ok, false);
  assert.match(invalidPromotionDryRunInboxPath.errors.join('\n'), /safe repo-relative/i);

  const invalidReviewTracked = validateJobRequest({
    type: 'pack',
  });
  assert.equal(invalidReviewTracked.ok, false);
  assert.match(invalidReviewTracked.errors.join('\n'), /readiness_report_path/);

  const publicArtifactRequest = toPublicJobRequest({
    type: 'report',
    config_path: '/tmp/private/effective-config.json',
    options: {
      override_path: '/tmp/private/override.toml',
      studio: {
        source: 'artifact-reference',
        source_job_id: 'job-upstream',
        source_artifact_id: 'effective-config',
        source_artifact_type: 'config.effective',
        source_label: 'Effective config copy',
        source_artifact_path: '/tmp/private/effective-config.json',
      },
      metadata: {
        nested_path: 'C:\\temp\\private\\source.fcstd',
      },
    },
  });
  assert.equal(publicArtifactRequest.type, 'report');
  assert.deepEqual(publicArtifactRequest.artifact_ref, {
    job_id: 'job-upstream',
    artifact_id: 'effective-config',
  });
  assert.equal(publicArtifactRequest.source_label, 'Effective config copy');
  assert.equal('config_path' in publicArtifactRequest, false);
  assert.equal('source_artifact_path' in (publicArtifactRequest.options?.studio || {}), false);
  assert.equal(publicArtifactRequest.options.override_path, 'override.toml');
  assert.equal(publicArtifactRequest.options.metadata.nested_path, 'source.fcstd');
  assert.equal(JSON.stringify(publicArtifactRequest).includes('/tmp/private'), false);
  assert.equal(JSON.stringify(publicArtifactRequest).includes('C:\\\\temp\\\\private'), false);

  const publicInspectRequest = toPublicJobRequest({
    type: 'inspect',
    file_path: 'C:\\private\\secret\\source.fcstd',
    options: {
      labels: [
        '/tmp/private/model.step',
        {
          source_artifact_path: '/tmp/private/ignored.step',
          raw_path: '/tmp/private/raw.step',
        },
      ],
    },
  });
  assert.equal(publicInspectRequest.type, 'inspect');
  assert.equal('file_path' in publicInspectRequest, false);
  assert.equal(publicInspectRequest.options.labels[0], 'model.step');
  assert.equal('source_artifact_path' in publicInspectRequest.options.labels[1], false);
  assert.equal(publicInspectRequest.options.labels[1].raw_path, 'raw.step');
  assert.equal('artifact_ref' in publicInspectRequest, false);
  assert.equal(JSON.stringify(publicInspectRequest).includes('/tmp/private'), false);
  assert.equal(JSON.stringify(publicInspectRequest).includes('C:\\\\private\\\\secret'), false);

  const publicEvidenceGraphRequest = toPublicJobRequest({
    type: 'evidence-graph',
    package_id: 'quality-pass-bracket',
    review_pack_path: 'docs/examples/quality-pass-bracket/review/review_pack.json',
    readiness_report_path: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
  });
  assert.deepEqual(publicEvidenceGraphRequest, {
    type: 'evidence-graph',
    package_id: 'quality-pass-bracket',
  });

  const internalPathFields = [
    'config_path',
    'file_path',
    'context_path',
    'model_path',
    'bom_path',
    'inspection_path',
    'quality_path',
    'create_quality_path',
    'drawing_quality_path',
    'drawing_qa_path',
    'drawing_intent_path',
    'feature_catalog_path',
    'dfm_report_path',
    'compare_to_path',
    'baseline_path',
    'candidate_path',
    'baseline_readiness_path',
    'candidate_readiness_path',
    'baseline_config_path',
    'candidate_config_path',
    'baseline_evidence_envelope_path',
    'candidate_evidence_envelope_path',
    'baseline_evidence_receipt_path',
    'candidate_evidence_receipt_path',
    'review_pack_path',
    'process_plan_path',
    'quality_risk_path',
    'readiness_report_path',
    'docs_manifest_path',
    'intake_report_path',
    'intake_report_artifact_ref',
    'source_artifact_path',
  ];
  const publicManyPathRequest = toPublicJobRequest(Object.fromEntries([
    ['type', 'review-context'],
    ...internalPathFields.map((field) => [field, `/tmp/private/${field}.json`]),
  ]));
  internalPathFields.forEach((field) => {
    assert.equal(field in publicManyPathRequest, false, `${field} must not appear in public job request payloads`);
  });
  assert.equal(JSON.stringify(publicManyPathRequest).includes('/tmp/private'), false);

  const publicStage5bAuditRequest = toPublicJobRequest({
    type: 'stage5b-evidence-audit',
    options: {
      include_github: false,
    },
  });
  assert.deepEqual(publicStage5bAuditRequest, {
    type: 'stage5b-evidence-audit',
    options: {
      include_github: false,
    },
  });

  const store = createJobStore({ jobsDir: join(tmpRoot, 'jobs') });
  const job = await store.createJob(valid.request);
  await store.appendLog(job.id, 'queued');
  assert.deepEqual(
    JSON.parse(readFileSync(job.paths.request, 'utf8')),
    valid.request
  );

  await assert.rejects(
    () => store.writeJobFile(job.id, '../escape.json', '{}\n'),
    /safety|inside the tracked job directory/i
  );
  await assert.rejects(
    () => store.writeJobFile(job.id, '/tmp/private.json', '{}\n'),
    /safety|inside the tracked job directory/i
  );
  await assert.rejects(
    () => store.writeJobFile(job.id, 'artifacts\\private.json', '{}\n'),
    /safety|inside the tracked job directory/i
  );

  const artifactPath = await store.writeJobFile(job.id, 'artifacts/sample.json', '{"ok":true}\n');
  const manifest = await buildArtifactManifest({
    projectRoot: process.cwd(),
    interface: 'api',
    command: 'report',
    jobType: 'report',
    status: 'succeeded',
    requestId: job.id,
    artifacts: [
      {
        type: 'report.sample',
        path: artifactPath,
        label: 'Sample artifact',
        scope: 'user-facing',
        stability: 'stable',
      },
    ],
    timestamps: {
      created_at: job.created_at,
      started_at: job.started_at,
      finished_at: new Date().toISOString(),
    },
  });
  await store.completeJob(job.id, { success: true }, { sample: artifactPath }, { config_warnings: [] }, manifest);

  const persistedJob = await store.getJob(job.id);
  assert.equal(persistedJob.status, 'succeeded');
  assert.equal(persistedJob.result.success, true);
  assert.equal(persistedJob.manifest.manifest_version, '1.0');
  assert.equal(persistedJob.manifest.command, 'report');
  assert.match(readFileSync(persistedJob.paths.log, 'utf8'), /queued/);

  const artifacts = await store.listArtifacts(job.id);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].exists, true);
  assert.match(artifacts[0].id, /sample|report-sample|artifact/i);
  assert.equal(artifacts[0].key, 'Sample artifact');
  assert.equal(artifacts[0].type, 'report.sample');
  assert.equal(artifacts[0].file_name, 'sample.json');
  assert.equal(artifacts[0].extension, '.json');

  const malformedManifestJob = await store.createJob(valid.request);
  const malformedArtifactPath = await store.writeJobFile(malformedManifestJob.id, 'artifacts/malformed-scope.json', '{"ok":true}\n');
  await store.completeJob(malformedManifestJob.id, { success: true }, {}, {}, {
    manifest_version: '1.0',
    command: 'report',
    artifacts: [
      {
        type: 'report.malformed-scope',
        path: malformedArtifactPath,
        label: 'Malformed scope fixture',
      },
    ],
  });
  const malformedArtifacts = await store.listArtifacts(malformedManifestJob.id);
  assert.equal(malformedArtifacts[0].scope, 'internal');

  const collidingManifestJob = await store.createJob(valid.request);
  const firstCollisionPath = await store.writeJobFile(collidingManifestJob.id, 'artifacts/first-collision.json', '{"first":true}\n');
  const secondCollisionPath = await store.writeJobFile(collidingManifestJob.id, 'artifacts/second-collision.json', '{"second":true}\n');
  await store.completeJob(collidingManifestJob.id, { success: true }, {}, {}, {
    manifest_version: '1.0',
    command: 'report',
    artifacts: [
      {
        id: 'Review Pack',
        type: 'review-pack.json',
        path: firstCollisionPath,
        label: 'First collision',
        scope: 'user-facing',
      },
      {
        id: 'review-pack',
        type: 'review-pack.json',
        path: secondCollisionPath,
        label: 'Second collision',
        scope: 'user-facing',
      },
    ],
  });
  const collidingArtifacts = await store.listArtifacts(collidingManifestJob.id);
  assert.deepEqual(collidingArtifacts.map((artifact) => artifact.id), ['review-pack', 'review-pack-1']);
  assert.equal((await store.getArtifact(collidingManifestJob.id, 'review-pack-1')).file_name, 'second-collision.json');

  const apiArtifacts = artifacts.map((artifact) => ({
    id: artifact.id,
    key: artifact.key,
    type: artifact.type,
    scope: artifact.scope,
    stability: artifact.stability,
    file_name: artifact.file_name,
    extension: artifact.extension,
    exists: artifact.exists,
    size_bytes: artifact.size_bytes,
    content_type: 'application/json; charset=utf-8',
    capabilities: {
      can_open: true,
      can_download: true,
      browser_safe: true,
    },
    links: {
      open: `/jobs/${job.id}/artifacts/${artifact.id}/content`,
      download: `/jobs/${job.id}/artifacts/${artifact.id}/content?download=1`,
      api: `/jobs/${job.id}/artifacts/${artifact.id}/content`,
    },
    contract: null,
  }));

  const internalStorage = await store.describeStorage(job.id);
  assert.equal(internalStorage.root.endsWith(job.id), true);
  assert.equal(internalStorage.files.job.exists, true);
  assert.equal(internalStorage.files.request.exists, true);
  assert.equal(internalStorage.files.log.exists, true);
  assert.equal(internalStorage.files.manifest.exists, true);
  const storage = {
    files: Object.fromEntries(
      Object.entries(internalStorage.files).map(([key, entry]) => [
        key,
        {
          exists: entry.exists,
          size_bytes: entry.size_bytes,
        },
      ])
    ),
  };

  const responseValidation = validateLocalApiResponse('job', {
    api_version: LOCAL_API_VERSION,
    ok: true,
    job: {
      id: job.id,
      type: job.type,
      status: persistedJob.status,
      created_at: persistedJob.created_at,
      updated_at: persistedJob.updated_at,
      started_at: persistedJob.started_at,
      finished_at: persistedJob.finished_at,
      error: persistedJob.error,
      retried_from_job_id: persistedJob.retried_from_job_id,
      request: toPublicJobRequest(persistedJob.request),
      diagnostics: persistedJob.diagnostics,
      artifacts: {
        sample: 'sample.json',
      },
      manifest: persistedJob.manifest,
      result: { success: true },
      status_history: persistedJob.status_history,
      storage,
      execution: null,
      capabilities: {
        cancellation_supported: false,
        retry_supported: false,
      },
      links: {
        self: `/jobs/${job.id}`,
        artifacts: `/jobs/${job.id}/artifacts`,
        cancel: `/jobs/${job.id}/cancel`,
        retry: `/jobs/${job.id}/retry`,
      },
    },
  });
  assert.equal(responseValidation.ok, true, responseValidation.errors.join('\n'));

  const artifactsResponseValidation = validateLocalApiResponse('artifacts', {
    api_version: LOCAL_API_VERSION,
    ok: true,
    job_id: job.id,
    artifacts: apiArtifacts,
    manifest: persistedJob.manifest,
    storage,
  });
  assert.equal(artifactsResponseValidation.ok, true, artifactsResponseValidation.errors.join('\n'));

  console.log('job-api.test.js: ok');
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
