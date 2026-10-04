import assert from 'node:assert/strict';

import {
  buildStudioArtifactRef,
  canReenterModelWorkspace,
  canStartTrackedArtifactRun,
  deriveArtifactReentryCapabilities,
  deriveStudioArtifactFamily,
  findDefaultArtifactForJob,
  findPreferredConfigArtifact,
  findPreferredDocsManifestArtifact,
  findPreferredReadinessReportArtifact,
  findPreferredInspectionEvidenceIntakeArtifact,
  findPreferredReleaseBundleArtifact,
  findPreferredReleaseBundleManifestArtifact,
  findPreferredReviewPackArtifact,
  isConfigLikeArtifact,
  isInspectableModelArtifact,
  isInspectionEvidenceIntakeArtifact,
  isInspectionEvidencePromotionDryRunArtifact,
  isReviewContextArtifact,
  isReadinessReportArtifact,
  isReleaseBundleArtifact,
  isReleaseBundleManifestArtifact,
  isReviewPackArtifact,
  isRevisionImpactArtifact,
  isRevisionComparisonArtifact,
  isStabilizationReviewArtifact,
} from '../public/js/studio/artifact-actions.js';

assert.deepEqual(buildStudioArtifactRef('job-1', 'artifact-2'), {
  job_id: 'job-1',
  artifact_id: 'artifact-2',
});

const savedDrawingArtifact = {
  id: 'saved-sheet', type: 'drawing.svg', file_name: 'saved_drawing.svg', extension: '.svg',
  scope: 'user-facing', exists: true,
  capabilities: { can_open: false, can_download: true },
};
for (const [type, extension] of [['drawing.svg', '.svg'], ['draw.plan.toml', '.toml'], ['draw.plan.json', '.json']]) {
  assert.equal(deriveArtifactReentryCapabilities({ ...savedDrawingArtifact, type, extension, file_name: `saved_plan${extension}` }).canContinueDrawing, true,
    `registered public ${type} must allow drawing continuation even without inline opening`);
}
for (const [label, overrides] of [
  ['missing file', { exists: false }],
  ['unknown file existence', { exists: undefined }],
  ['internal artifact', { scope: 'internal' }],
  ['unspecified scope', { scope: undefined }],
  ['unregistered artifact', { id: '' }],
  ['whitespace artifact id', { id: '  ' }],
  ['SVG filename without supported type', { type: 'artifact' }],
  ['similar unsupported type', { type: 'drawing.svg.backup' }],
  ['quality JSON', { type: 'drawing.quality-summary', extension: '.json' }],
  ['model', { type: 'model.step', extension: '.step' }],
]) {
  assert.equal(deriveArtifactReentryCapabilities({ ...savedDrawingArtifact, ...overrides }).canContinueDrawing, false, label);
}

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

assert.equal(canReenterModelWorkspace({
  type: 'config.effective',
  file_name: 'effective-config.json',
  extension: '.json',
  exists: true,
  scope: 'internal',
}), false);

assert.equal(canStartTrackedArtifactRun({
  type: 'model.step',
  file_name: 'part.step',
  extension: '.step',
  exists: true,
}, 'review-context'), false);

assert.equal(canStartTrackedArtifactRun({
  type: 'context.json',
  file_name: 'sample_context.json',
  extension: '.json',
  exists: true,
}, 'review-context'), false);

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
  scope: 'internal',
}, 'inspect'), false);

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

const revisionImpactArtifact = {
  type: 'revision-impact.report-json',
  file_name: 'revision_impact_report.json',
  extension: '.json',
  exists: true,
};

assert.equal(isRevisionImpactArtifact(revisionImpactArtifact), true);
assert.equal(deriveStudioArtifactFamily(revisionImpactArtifact), 'review');
assert.equal(canStartTrackedArtifactRun(revisionImpactArtifact, 'compare-rev'), false);

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

const intakeReportArtifact = {
  type: 'inspection-evidence.intake-report',
  file_name: 'inspection-evidence-intake-report.json',
  extension: '.json',
  exists: true,
};
const promotionDryRunManifestArtifact = {
  type: 'inspection-evidence.promotion-dry-run-manifest',
  file_name: 'promotion_dry_run_manifest.json',
  extension: '.json',
  exists: true,
};

assert.equal(isInspectionEvidenceIntakeArtifact(intakeReportArtifact), true);
assert.equal(isInspectionEvidencePromotionDryRunArtifact(promotionDryRunManifestArtifact), true);
assert.equal(canStartTrackedArtifactRun(intakeReportArtifact, 'inspection-evidence-promotion-dry-run'), true);
assert.equal(canStartTrackedArtifactRun(promotionDryRunManifestArtifact, 'inspection-evidence-promotion-dry-run'), false);
assert.equal(findPreferredInspectionEvidenceIntakeArtifact([
  promotionDryRunManifestArtifact,
  intakeReportArtifact,
]), intakeReportArtifact);

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
  canContinueDrawing: false,
  canOpenInModel: false,
  canRunTrackedReviewContext: false,
  canRunTrackedReport: false,
  canRunTrackedInspect: false,
  canRunTrackedReadinessPack: false,
  canRunTrackedStandardDocs: false,
  canRunTrackedPack: false,
  canRunTrackedPromotionDryRun: false,
  canSeedReview: true,
});

assert.deepEqual(deriveArtifactReentryCapabilities({
  type: 'drawing.qa-report',
  file_name: 'sheet_qa.json',
  extension: '.json',
  exists: true,
  scope: 'internal',
}), {
  canContinueDrawing: false,
  canOpenInModel: false,
  canRunTrackedReviewContext: false,
  canRunTrackedReport: false,
  canRunTrackedInspect: false,
  canRunTrackedReadinessPack: false,
  canRunTrackedStandardDocs: false,
  canRunTrackedPack: false,
  canRunTrackedPromotionDryRun: false,
  canSeedReview: false,
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
  canContinueDrawing: false,
  canOpenInModel: false,
  canRunTrackedReviewContext: false,
  canRunTrackedReport: false,
  canRunTrackedInspect: false,
  canRunTrackedReadinessPack: true,
  canRunTrackedStandardDocs: true,
  canRunTrackedPack: true,
  canRunTrackedPromotionDryRun: false,
  canSeedReview: false,
});

function makeAf5Artifact({
  id,
  type,
  fileName,
  extension = '.json',
  reentryTarget = null,
}) {
  return {
    id,
    key: id,
    type,
    file_name: fileName,
    extension,
    exists: true,
    capabilities: {
      can_open: extension !== '.zip',
      can_download: true,
      browser_safe: extension !== '.zip',
    },
    links: {
      open: `/artifacts/job-af5/${id}`,
      download: `/artifacts/job-af5/${id}/download`,
    },
    contract: reentryTarget
      ? {
          reentry_target: reentryTarget,
          canonical_file_name: fileName,
        }
      : null,
  };
}

const af5CanonicalArtifacts = [
  makeAf5Artifact({
    id: 'review-pack',
    type: 'review-pack.json',
    fileName: 'review_pack.json',
    reentryTarget: 'review_pack',
  }),
  makeAf5Artifact({
    id: 'readiness-report',
    type: 'readiness-report.json',
    fileName: 'readiness_report.json',
    reentryTarget: 'readiness_report',
  }),
  makeAf5Artifact({
    id: 'standard-docs-manifest',
    type: 'standard-docs.summary',
    fileName: 'standard_docs_manifest.json',
  }),
  makeAf5Artifact({
    id: 'release-bundle-manifest',
    type: 'release-bundle.manifest.json',
    fileName: 'release_bundle_manifest.json',
  }),
  makeAf5Artifact({
    id: 'release-bundle',
    type: 'release-bundle.zip',
    fileName: 'release_bundle.zip',
    extension: '.zip',
    reentryTarget: 'release_bundle',
  }),
];

assert.deepEqual(af5CanonicalArtifacts.map((artifact) => artifact.file_name), [
  'review_pack.json',
  'readiness_report.json',
  'standard_docs_manifest.json',
  'release_bundle_manifest.json',
  'release_bundle.zip',
]);
assert.equal(
  af5CanonicalArtifacts.some((artifact) => [
    'review-pack.json',
    'readiness-report.json',
    'standard-docs-manifest.json',
    'release-bundle-manifest.json',
    'release-bundle.zip',
  ].includes(artifact.file_name)),
  false
);
assert.equal(findPreferredReviewPackArtifact(af5CanonicalArtifacts)?.file_name, 'review_pack.json');
assert.equal(findPreferredReadinessReportArtifact(af5CanonicalArtifacts)?.file_name, 'readiness_report.json');
assert.equal(findPreferredDocsManifestArtifact(af5CanonicalArtifacts)?.file_name, 'standard_docs_manifest.json');
assert.equal(findPreferredReleaseBundleManifestArtifact(af5CanonicalArtifacts)?.file_name, 'release_bundle_manifest.json');
assert.equal(findPreferredReleaseBundleArtifact(af5CanonicalArtifacts)?.file_name, 'release_bundle.zip');
assert.equal(findDefaultArtifactForJob(af5CanonicalArtifacts)?.file_name, 'review_pack.json');

for (const artifact of af5CanonicalArtifacts) {
  assert.equal(artifact.capabilities.can_open, artifact.extension !== '.zip', `${artifact.file_name} should expose only inline-safe open routes`);
  assert.equal(artifact.links.open, `/artifacts/job-af5/${artifact.id}`);
  assert.equal(artifact.links.open.includes('/local-file'), false);
}

assert.deepEqual(deriveArtifactReentryCapabilities(af5CanonicalArtifacts[0]), {
  canContinueDrawing: false,
  canOpenInModel: false,
  canRunTrackedReviewContext: false,
  canRunTrackedReport: false,
  canRunTrackedInspect: false,
  canRunTrackedReadinessPack: true,
  canRunTrackedStandardDocs: false,
  canRunTrackedPack: false,
  canRunTrackedPromotionDryRun: false,
  canSeedReview: true,
});
assert.deepEqual(deriveArtifactReentryCapabilities(af5CanonicalArtifacts[1]), {
  canContinueDrawing: false,
  canOpenInModel: false,
  canRunTrackedReviewContext: false,
  canRunTrackedReport: false,
  canRunTrackedInspect: false,
  canRunTrackedReadinessPack: false,
  canRunTrackedStandardDocs: true,
  canRunTrackedPack: true,
  canRunTrackedPromotionDryRun: false,
  canSeedReview: true,
});
assert.deepEqual(deriveArtifactReentryCapabilities(af5CanonicalArtifacts[2]), {
  canContinueDrawing: false,
  canOpenInModel: false,
  canRunTrackedReviewContext: false,
  canRunTrackedReport: false,
  canRunTrackedInspect: false,
  canRunTrackedReadinessPack: false,
  canRunTrackedStandardDocs: false,
  canRunTrackedPack: false,
  canRunTrackedPromotionDryRun: false,
  canSeedReview: true,
});
assert.deepEqual(deriveArtifactReentryCapabilities(af5CanonicalArtifacts[3]), {
  canContinueDrawing: false,
  canOpenInModel: false,
  canRunTrackedReviewContext: false,
  canRunTrackedReport: false,
  canRunTrackedInspect: false,
  canRunTrackedReadinessPack: false,
  canRunTrackedStandardDocs: false,
  canRunTrackedPack: false,
  canRunTrackedPromotionDryRun: false,
  canSeedReview: false,
});
assert.deepEqual(deriveArtifactReentryCapabilities(af5CanonicalArtifacts[4]), {
  canContinueDrawing: false,
  canOpenInModel: false,
  canRunTrackedReviewContext: false,
  canRunTrackedReport: false,
  canRunTrackedInspect: false,
  canRunTrackedReadinessPack: true,
  canRunTrackedStandardDocs: true,
  canRunTrackedPack: true,
  canRunTrackedPromotionDryRun: false,
  canSeedReview: false,
});

console.log('studio-artifact-actions.test.js: ok');
