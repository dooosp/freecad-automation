import assert from 'node:assert/strict';

import {
  buildStudioArtifactRef,
  canReenterModelWorkspace,
  canStartTrackedArtifactRun,
  deriveArtifactReentryCapabilities,
  findDefaultArtifactForJob,
  findPreferredConfigArtifact,
  findPreferredDocsManifestArtifact,
  findPreferredReleaseBundleManifestArtifact,
  isConfigLikeArtifact,
  isInspectableModelArtifact,
  isReviewContextArtifact,
  isReadinessReportArtifact,
  isReleaseBundleArtifact,
  isReleaseBundleManifestArtifact,
  isReviewPackArtifact,
  isRevisionComparisonArtifact,
  isStabilizationReviewArtifact,
} from '../public/js/studio/artifact-actions.js';

assert.deepEqual(buildStudioArtifactRef('job-1', 'artifact-2'), {
  job_id: 'job-1',
  artifact_id: 'artifact-2',
});

assert.equal(isConfigLikeArtifact({
  type: 'config.effective',
  file_name: 'effective-config.json',
  extension: '.json',
}), true);

assert.equal(isConfigLikeArtifact({
  type: 'report.sample',
  file_name: 'review.json',
  extension: '.json',
}), false);

assert.equal(isInspectableModelArtifact({
  type: 'model.step',
  file_name: 'part.step',
  extension: '.step',
  exists: true,
}), true);

assert.equal(isInspectableModelArtifact({
  type: 'report.pdf',
  file_name: 'report.pdf',
  extension: '.pdf',
  exists: true,
}), false);

assert.equal(isReviewContextArtifact({
  type: 'context.json',
  file_name: 'sample_context.json',
  extension: '.json',
  exists: true,
}), true);

const preferredConfig = findPreferredConfigArtifact([
  {
    id: 'input',
    type: 'config.input',
    file_name: 'input-config.json',
    extension: '.json',
    exists: true,
  },
  {
    id: 'effective',
    type: 'config.effective',
    file_name: 'effective-config.json',
    extension: '.json',
    exists: true,
  },
]);

assert.equal(preferredConfig?.id, 'effective');

const preferredDocsManifest = findPreferredDocsManifestArtifact([
  {
    id: 'work-instruction',
    type: 'standard-docs.work_instruction_draft.md',
    file_name: 'work_instruction_draft.md',
    extension: '.md',
    exists: true,
  },
  {
    id: 'manifest',
    type: 'standard-docs.summary',
    file_name: 'standard_docs_manifest.json',
    extension: '.json',
    exists: true,
  },
]);

assert.equal(preferredDocsManifest?.id, 'manifest');

assert.equal(canReenterModelWorkspace({
  type: 'config.effective',
  file_name: 'effective-config.json',
  extension: '.json',
  exists: true,
}), true);

assert.equal(canStartTrackedArtifactRun({
  type: 'model.step',
  file_name: 'part.step',
  extension: '.step',
  exists: true,
}, 'review-context'), true);

assert.equal(canStartTrackedArtifactRun({
  type: 'context.json',
  file_name: 'sample_context.json',
  extension: '.json',
  exists: true,
}, 'review-context'), true);

assert.equal(canStartTrackedArtifactRun({
  type: 'model.step',
  file_name: 'part.step',
  extension: '.step',
  exists: true,
}, 'inspect'), true);

assert.equal(canStartTrackedArtifactRun({
  type: 'model.step',
  file_name: 'part.step',
  extension: '.step',
  exists: true,
}, 'report'), false);

assert.equal(isReviewPackArtifact({
  type: 'review-pack.json',
  file_name: 'review_pack.json',
  extension: '.json',
  exists: true,
}), true);

assert.equal(isReadinessReportArtifact({
  type: 'readiness-report.json',
  file_name: 'readiness_report.json',
  extension: '.json',
  exists: true,
}), true);

assert.equal(isReleaseBundleArtifact({
  type: 'release-bundle.zip',
  file_name: 'release_bundle.zip',
  extension: '.zip',
  exists: true,
}), true);

assert.equal(isReleaseBundleManifestArtifact({
  type: 'release-bundle.manifest.json',
  file_name: 'release_bundle_manifest.json',
  extension: '.json',
  exists: true,
}), true);

assert.equal(isRevisionComparisonArtifact({
  type: 'revision-comparison.json',
  file_name: 'revision_comparison.json',
  extension: '.json',
  exists: true,
}), true);

assert.equal(isStabilizationReviewArtifact({
  type: 'review.stabilization.json',
  file_name: 'stabilization_review.json',
  extension: '.json',
  exists: true,
}), true);

const preferredBundleManifest = findPreferredReleaseBundleManifestArtifact([
  {
    id: 'bundle-log',
    type: 'release-bundle.log.json',
    file_name: 'release_bundle_log.json',
    extension: '.json',
    exists: true,
  },
  {
    id: 'bundle-manifest',
    type: 'release-bundle.manifest.json',
    file_name: 'release_bundle_manifest.json',
    extension: '.json',
    exists: true,
  },
]);

assert.equal(preferredBundleManifest?.id, 'bundle-manifest');

assert.equal(findDefaultArtifactForJob([
  {
    id: 'first-model',
    type: 'model.step',
    file_name: 'part.step',
    extension: '.step',
    exists: true,
  },
  {
    id: 'quality-report-pdf',
    type: 'report.pdf',
    file_name: 'quality_pass_bracket_report.pdf',
    extension: '.pdf',
    exists: true,
  },
  {
    id: 'report-summary',
    type: 'report.summary-json',
    file_name: 'quality_pass_bracket_report_summary.json',
    extension: '.json',
    exists: true,
  },
])?.id, 'report-summary');

assert.equal(findDefaultArtifactForJob([
  {
    id: 'missing-summary',
    type: 'report.summary-json',
    file_name: 'quality_pass_bracket_report_summary.json',
    extension: '.json',
    exists: false,
  },
  {
    id: 'quality-report-pdf',
    type: 'report.pdf',
    file_name: 'quality_pass_bracket_report.pdf',
    extension: '.pdf',
    exists: true,
  },
  {
    id: 'review-pack',
    type: 'review-pack.json',
    file_name: 'review_pack.json',
    extension: '.json',
    exists: true,
  },
])?.id, 'quality-report-pdf');

assert.equal(findDefaultArtifactForJob([
  {
    id: 'source-config',
    type: 'config.effective',
    file_name: 'effective-config.json',
    extension: '.json',
    exists: true,
  },
  {
    id: 'review-pack',
    type: 'review-pack.json',
    file_name: 'review_pack.json',
    extension: '.json',
    exists: true,
  },
  {
    id: 'create-quality',
    type: 'model.quality-summary',
    file_name: 'ks_bracket_create_quality.json',
    extension: '.json',
    exists: true,
  },
])?.id, 'review-pack');

assert.equal(canStartTrackedArtifactRun({
  type: 'review-pack.json',
  file_name: 'review_pack.json',
  extension: '.json',
  exists: true,
  contract: {
    reentry_target: 'review_pack',
  },
}, 'readiness-pack'), true);

assert.equal(canStartTrackedArtifactRun({
  type: 'readiness-report.json',
  file_name: 'readiness_report.json',
  extension: '.json',
  exists: true,
  contract: {
    reentry_target: 'readiness_report',
  },
}, 'pack'), true);

assert.equal(canStartTrackedArtifactRun({
  type: 'release-bundle.zip',
  file_name: 'release_bundle.zip',
  extension: '.zip',
  exists: true,
  contract: {
    reentry_target: 'release_bundle',
  },
}, 'generate-standard-docs'), true);

assert.equal(canStartTrackedArtifactRun({
  type: 'review-pack.json',
  file_name: 'review_pack.json',
  extension: '.json',
  exists: true,
  contract: {
    reentry_target: 'review_pack',
  },
}, 'generate-standard-docs'), false);

assert.deepEqual(deriveArtifactReentryCapabilities({
  type: 'drawing.qa-report',
  file_name: 'sheet_qa.json',
  extension: '.json',
  exists: true,
}), {
  canOpenInModel: false,
  canRunTrackedReviewContext: false,
  canRunTrackedReport: false,
  canRunTrackedInspect: false,
  canRunTrackedReadinessPack: false,
  canRunTrackedStandardDocs: false,
  canRunTrackedPack: false,
  canSeedReview: true,
});

assert.equal(canStartTrackedArtifactRun({
  type: 'review-pack.json',
  file_name: 'review_pack.json',
  extension: '.json',
  exists: true,
  contract: {
    reentry_target: 'review_pack',
  },
}, 'report'), false);

assert.deepEqual(deriveArtifactReentryCapabilities({
  type: 'release-bundle.zip',
  file_name: 'release_bundle.zip',
  extension: '.zip',
  exists: true,
  contract: {
    reentry_target: 'release_bundle',
  },
}), {
  canOpenInModel: false,
  canRunTrackedReviewContext: false,
  canRunTrackedReport: false,
  canRunTrackedInspect: false,
  canRunTrackedReadinessPack: true,
  canRunTrackedStandardDocs: true,
  canRunTrackedPack: true,
  canSeedReview: false,
});

console.log('studio-artifact-actions.test.js: ok');
