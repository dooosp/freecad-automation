const RESULT_GROUP_ORDER = Object.freeze([
  'immediate',
  'quality',
  'technical',
  'system',
]);

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

function artifactExtension(artifact = {}) {
  return String(artifact.extension || '').trim().toLowerCase();
}

function includesAny(value, needles = []) {
  return needles.some((needle) => value.includes(needle));
}

export function classifyResultFilePurpose(artifact = {}) {
  const search = artifactSearchText(artifact);
  const extension = artifactExtension(artifact);

  if (includesAny(search, [
    'manifest',
    'runtime fingerprint',
    'runtime_fingerprint',
    'runtime-fingerprint',
    'checksum',
    'sha256',
    'provenance',
    'traceability',
  ])) {
    return 'system';
  }

  if (includesAny(search, [
    'quality',
    'readiness',
    'review-pack',
    'review_pack',
    'product_review',
    'quality_risk',
    'investment_review',
    'dfm',
    'inspection',
    'manufacturing_data_validation',
    'manufacturing-data-validation',
    'revision-impact',
    'revision_impact',
    'revision-comparison',
    'revision_comparison',
    'stabilization',
    'report_summary',
    'report summary',
  ])) {
    return 'quality';
  }

  if (
    extension === '.pdf'
    || extension === '.fcstd'
    || extension === '.brep'
    || extension === '.brp'
    || extension === '.svg'
    || extension === '.dxf'
    || includesAny(search, ['drawing', 'report', '3d model', 'model preview'])
  ) {
    return 'immediate';
  }

  return 'technical';
}

export function collectResultFileGroups(artifacts = []) {
  const groups = new Map(RESULT_GROUP_ORDER.map((id) => [id, []]));
  for (const artifact of artifacts) {
    groups.get(classifyResultFilePurpose(artifact)).push(artifact);
  }
  return RESULT_GROUP_ORDER.map((id) => ({
    id,
    artifacts: groups.get(id),
  }));
}

function jobTypePreferenceScore(artifact = {}, jobType = '') {
  const normalizedType = String(jobType || '').trim().toLowerCase();
  const search = artifactSearchText(artifact);
  const extension = artifactExtension(artifact);

  if (normalizedType === 'manufacturing-action-dataset'
    && includesAny(search, ['manufacturing_robotics_dataset_manifest', 'manufacturing robotics dataset manifest'])) {
    return -400;
  }

  if (normalizedType === 'create' && (
    ['.fcstd', '.brep', '.brp', '.step', '.stp', '.stl'].includes(extension)
    || includesAny(search, ['3d model', 'model preview'])
  )) return -250;
  if (normalizedType === 'draw' && (
    ['.svg', '.dxf', '.pdf'].includes(extension)
    || search.includes('drawing')
  )) return -250;
  if (normalizedType === 'report' && (extension === '.pdf' || search.includes('report'))) return -250;
  if (includesAny(normalizedType, ['review', 'inspect', 'readiness', 'compare', 'stabilization'])
    && classifyResultFilePurpose(artifact) === 'quality') return -200;
  return 0;
}

function primaryResultScore(artifact = {}, jobType = '') {
  const groupIndex = RESULT_GROUP_ORDER.indexOf(classifyResultFilePurpose(artifact));
  const action = deriveResultFileAction(artifact);
  const search = artifactSearchText(artifact);
  const extension = artifactExtension(artifact);
  let score = (groupIndex === -1 ? RESULT_GROUP_ORDER.length : groupIndex) * 100;

  if (action.kind === 'view') score -= 20;
  else if (action.kind === 'download') score -= 10;
  if (extension === '.fcstd' || extension === '.pdf') score -= 4;
  if (includesAny(search, ['drawing', 'report summary', 'report_summary'])) score -= 2;
  return score + jobTypePreferenceScore(artifact, jobType);
}

export function selectPrimaryResultArtifact(artifacts = [], { jobType = '' } = {}) {
  const available = artifacts.filter((artifact) => artifact?.exists !== false);
  const candidates = available.length > 0 ? available : artifacts;
  return candidates
    .map((artifact, index) => ({ artifact, index, score: primaryResultScore(artifact, jobType) }))
    .sort((left, right) => left.score - right.score || left.index - right.index)[0]?.artifact || null;
}

export function deriveResultFileAction(artifact = {}) {
  const exists = artifact?.exists !== false;
  const openHref = exists && artifact?.capabilities?.can_open === true && typeof artifact?.links?.open === 'string'
    ? artifact.links.open
    : '';
  const downloadHref = exists && artifact?.capabilities?.can_download === true && typeof artifact?.links?.download === 'string'
    ? artifact.links.download
    : '';

  if (openHref) {
    return {
      kind: 'view',
      href: openHref,
      downloadHref,
      openHref,
    };
  }
  if (downloadHref) {
    return {
      kind: 'download',
      href: downloadHref,
      downloadHref,
      openHref: '',
    };
  }
  return {
    kind: 'details',
    href: '',
    downloadHref: '',
    openHref: '',
  };
}

export function resultFileLabelKey(artifact = {}) {
  const search = artifactSearchText(artifact);
  const extension = artifactExtension(artifact);

  if (extension === '.pdf') return 'studio.artifacts.file.report';
  if (extension === '.fcstd' || extension === '.brep' || extension === '.brp') return 'studio.artifacts.file.model';
  if (extension === '.step' || extension === '.stp') return 'studio.artifacts.file.step';
  if (extension === '.stl') return 'studio.artifacts.file.stl';
  if (includesAny(search, ['bom', 'bill of material'])) return 'studio.artifacts.file.bom';
  if (includesAny(search, ['readiness'])) return 'studio.artifacts.file.readiness';
  if (includesAny(search, ['quality', 'dfm', 'inspection', 'review', 'revision', 'stabilization', 'report_summary', 'report summary'])) {
    return 'studio.artifacts.file.quality';
  }
  if (extension === '.svg' || extension === '.dxf' || search.includes('drawing')) return 'studio.artifacts.file.drawing';
  if (classifyResultFilePurpose(artifact) === 'system') return 'studio.artifacts.file.system';
  if (search.includes('report')) return 'studio.artifacts.file.report';
  return '';
}
