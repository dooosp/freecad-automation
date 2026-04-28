export const CANONICAL_PACKAGES_ENDPOINT = '/api/canonical-packages';

const RELEASE_BUNDLE_COPY_NOTE = 'Release bundle presence does not mean production-ready; package remains needs_more_evidence until real inspection_evidence is attached.';

const ARTIFACT_REF_LABELS = Object.freeze([
  ['review_pack_path', 'review_pack', ''],
  ['readiness_report_path', 'readiness_report', ''],
  ['standard_docs_manifest_path', 'standard-docs manifest', ''],
  ['release_manifest_path', 'release manifest', ''],
  ['release_checksums_path', 'checksums', ''],
  ['release_bundle_path', 'release bundle', RELEASE_BUNDLE_COPY_NOTE],
  ['reopen_notes_path', 'reopen notes', ''],
]);

const DEFAULT_BOUNDARY_NOTES = Object.freeze([
  'Checked-in canonical packages are read-only docs packages for discovery.',
  'Studio tracked job/artifact reopen remains separate from checked-in canonical docs package discovery.',
  'Release bundle presence does not mean production-ready; readiness remains gated by the canonical readiness report.',
  'Canonical packages remain needs_more_evidence until real inspection_evidence is attached through the canonical flow.',
  'Quality and drawing evidence does not satisfy inspection_evidence without genuine completed inspection evidence.',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pathValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function compactString(value, fallback = 'Unavailable') {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function formatScore(value) {
  return Number.isFinite(value) ? String(value) : 'Unavailable';
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
}

export function normalizeCanonicalPackagesPayload(payload = {}) {
  const packages = Array.isArray(payload?.packages) ? payload.packages.filter(isPlainObject) : [];
  return {
    status: packages.length > 0 ? 'ready' : 'empty',
    items: packages,
    message: packages.length > 0
      ? ''
      : 'Canonical package discovery returned no checked-in packages.',
  };
}

export async function fetchCanonicalPackages(fetchJson) {
  if (typeof fetchJson !== 'function') {
    throw new Error('Canonical package loading requires a JSON fetch helper.');
  }
  return normalizeCanonicalPackagesPayload(await fetchJson(CANONICAL_PACKAGES_ENDPOINT));
}

export function buildCanonicalPackageCardModel(pkg = {}) {
  const readiness = isPlainObject(pkg.readiness) ? pkg.readiness : {};
  const artifactRefs = ARTIFACT_REF_LABELS
    .map(([key, label, note]) => ({
      key,
      label,
      path: pathValue(pkg.artifacts?.[key]),
      note,
      copyAction: {
        label: 'Copy repo path',
        copiedLabel: 'Copied',
        failedLabel: 'Copy failed',
      },
    }))
    .filter((entry) => entry.path);
  const missingInputs = Array.isArray(readiness.missing_inputs)
    ? readiness.missing_inputs.filter((entry) => typeof entry === 'string' && entry.trim())
    : [];
  const missingInspectionEvidence = readiness.inspection_evidence_missing === true
    || missingInputs.includes('inspection_evidence')
    || !pkg.inspection_evidence_path;
  const status = compactString(readiness.status, 'needs_more_evidence');

  return {
    title: compactString(pkg.name, compactString(pkg.slug, 'Canonical package')),
    slug: compactString(pkg.slug, 'unknown-package'),
    packagePath: pathValue(pkg.package_path),
    readmePath: pathValue(pkg.readme_path),
    readiness: {
      status,
      score: formatScore(readiness.score),
      gateDecision: compactString(readiness.gate_decision),
      missingInputs,
      missingInspectionEvidence,
    },
    callout: missingInspectionEvidence
      ? `${status}: missing inspection_evidence. Quality and drawing evidence do not satisfy inspection_evidence.`
      : `${status}: inspection_evidence is attached.`,
    sourceOfTruthPath: pathValue(readiness.source_of_truth_path),
    artifactRefs,
    actions: [],
  };
}

export function buildCanonicalPackageSectionModel(canonicalPackagesState = {}) {
  const items = Array.isArray(canonicalPackagesState.items) ? canonicalPackagesState.items : [];
  const cards = items.map(buildCanonicalPackageCardModel);
  const boundaryNotes = uniqueStrings([
    ...DEFAULT_BOUNDARY_NOTES,
    ...items.flatMap((pkg) => [
      ...Object.values(isPlainObject(pkg.studio_boundary) ? pkg.studio_boundary : {}),
      ...Object.values(isPlainObject(pkg.evidence_boundary) ? pkg.evidence_boundary : {}),
    ]),
  ]);

  return {
    title: 'Canonical CAD packages',
    status: canonicalPackagesState.status || 'loading',
    message: canonicalPackagesState.message || '',
    cards,
    boundaryNotes,
  };
}
