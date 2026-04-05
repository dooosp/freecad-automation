const CONFIG_EXTENSIONS = new Set(['.json', '.toml']);
const INSPECT_MODEL_EXTENSIONS = new Set(['.step', '.stp', '.stl', '.fcstd', '.brep', '.brp']);
const REVIEW_SOURCE_MATCHERS = [
  'readiness',
  'review.product',
  'product_review',
  'quality_risk',
  'review.quality-risk',
  'investment_review',
  'review.investment-review',
  'standard-docs.summary',
  'standard_docs_manifest',
  'review-pack',
  'process_plan',
  'line_plan',
  'drawing.qa-report',
];
const DOCS_MANIFEST_MATCHERS = [
  'standard_docs_manifest',
  'standard-docs.summary',
  'docs_manifest',
];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function artifactSearchText(artifact = {}) {
  return [
    artifact.type,
    artifact.key,
    artifact.file_name,
    artifact.id,
    artifact.extension,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function includesAny(value, needles = []) {
  return needles.some((needle) => value.includes(needle));
}

function contractReentryTarget(artifact = {}) {
  const target = artifact?.contract?.reentry_target;
  return normalizeString(target);
}

function configArtifactPriority(artifact = {}) {
  const type = normalizeString(artifact.type);
  const extension = normalizeString(artifact.extension);

  if (type === 'config.effective') return 0;
  if (type === 'config.input') return 1;
  if (extension === '.toml') return 2;
  if (extension === '.json') return 3;
  return 10;
}

export function buildStudioArtifactRef(jobId, artifactId) {
  return {
    job_id: String(jobId || '').trim(),
    artifact_id: String(artifactId || '').trim(),
  };
}

export function deriveStudioArtifactFamily(artifact = {}) {
  if (canReenterModelWorkspace(artifact)) return 'config';
  if (isReviewSourceArtifact(artifact)) return 'review';
  if (isInspectableModelArtifact(artifact)) return 'model';
  return 'generic';
}

export function isConfigLikeArtifact(artifact = {}) {
  const extension = normalizeString(artifact.extension);
  const type = normalizeString(artifact.type);
  const search = artifactSearchText(artifact);

  if (!CONFIG_EXTENSIONS.has(extension)) return false;
  if (type.startsWith('config.')) return true;
  return includesAny(search, [
    'effective config',
    'effective_config',
    'effective-config',
    'input config',
    'input_config',
    'input-config',
    'config copy',
    'config.',
    'config_',
    'config-',
  ]);
}

export function isInspectableModelArtifact(artifact = {}) {
  const extension = normalizeString(artifact.extension);
  if (artifact.exists === false) return false;
  return INSPECT_MODEL_EXTENSIONS.has(extension);
}

export function isReviewSourceArtifact(artifact = {}) {
  const target = contractReentryTarget(artifact);
  if (target === 'review_pack' || target === 'readiness_report') {
    return true;
  }
  return includesAny(artifactSearchText(artifact), REVIEW_SOURCE_MATCHERS);
}

export function isReviewPackArtifact(artifact = {}) {
  const target = contractReentryTarget(artifact);
  if (target === 'review_pack') return true;
  return includesAny(artifactSearchText(artifact), [
    'review_pack.json',
    'review-pack.json',
    'review_pack',
    'review-pack',
  ]);
}

export function isReadinessReportArtifact(artifact = {}) {
  const target = contractReentryTarget(artifact);
  if (target === 'readiness_report') return true;
  return includesAny(artifactSearchText(artifact), [
    'readiness_report.json',
    'readiness-report.json',
    'readiness_report',
    'readiness-report',
    'input.readiness-report',
  ]);
}

export function isReleaseBundleArtifact(artifact = {}) {
  const target = contractReentryTarget(artifact);
  if (target === 'release_bundle') return true;
  return includesAny(artifactSearchText(artifact), [
    'release_bundle.zip',
    'release-bundle.zip',
    'release_bundle',
    'release-bundle',
  ]);
}

export function canReenterModelWorkspace(artifact = {}) {
  return artifact.exists !== false && isConfigLikeArtifact(artifact);
}

export function canStartTrackedArtifactRun(artifact = {}, type = 'report') {
  if (artifact.exists === false) return false;
  if (type === 'readiness-pack') {
    return isReviewPackArtifact(artifact) || isReleaseBundleArtifact(artifact);
  }
  if (type === 'generate-standard-docs') {
    return isReadinessReportArtifact(artifact) || isReleaseBundleArtifact(artifact);
  }
  if (type === 'pack') {
    return isReadinessReportArtifact(artifact) || isReleaseBundleArtifact(artifact);
  }
  if (type === 'report') return canReenterModelWorkspace(artifact);
  if (type === 'inspect') return isInspectableModelArtifact(artifact);
  return false;
}

export function deriveArtifactReentryCapabilities(artifact = {}) {
  return {
    canOpenInModel: canReenterModelWorkspace(artifact),
    canRunTrackedReport: canStartTrackedArtifactRun(artifact, 'report'),
    canRunTrackedInspect: canStartTrackedArtifactRun(artifact, 'inspect'),
    canRunTrackedReadinessPack: canStartTrackedArtifactRun(artifact, 'readiness-pack'),
    canRunTrackedStandardDocs: canStartTrackedArtifactRun(artifact, 'generate-standard-docs'),
    canRunTrackedPack: canStartTrackedArtifactRun(artifact, 'pack'),
    canSeedReview: artifact.exists !== false && isReviewSourceArtifact(artifact),
  };
}

export function findPreferredConfigArtifact(artifacts = []) {
  return [...artifacts]
    .filter((artifact) => isConfigLikeArtifact(artifact) && artifact.exists !== false)
    .sort((left, right) => configArtifactPriority(left) - configArtifactPriority(right))[0] || null;
}

export function findPreferredDocsManifestArtifact(artifacts = []) {
  return [...artifacts]
    .filter((artifact) => artifact.exists !== false && includesAny(artifactSearchText(artifact), DOCS_MANIFEST_MATCHERS))
    .sort((left, right) => artifactSearchText(left).localeCompare(artifactSearchText(right)))[0] || null;
}

export function findPreferredReviewPackArtifact(artifacts = []) {
  return [...artifacts]
    .filter((artifact) => artifact.exists !== false && isReviewPackArtifact(artifact))
    .sort((left, right) => artifactSearchText(left).localeCompare(artifactSearchText(right)))[0] || null;
}

export function findPreferredReadinessReportArtifact(artifacts = []) {
  return [...artifacts]
    .filter((artifact) => artifact.exists !== false && isReadinessReportArtifact(artifact))
    .sort((left, right) => artifactSearchText(left).localeCompare(artifactSearchText(right)))[0] || null;
}

export function findPreferredReleaseBundleArtifact(artifacts = []) {
  return [...artifacts]
    .filter((artifact) => artifact.exists !== false && isReleaseBundleArtifact(artifact))
    .sort((left, right) => artifactSearchText(left).localeCompare(artifactSearchText(right)))[0] || null;
}
