export const CANONICAL_PACKAGES_ENDPOINT = '/api/canonical-packages';

const RELEASE_BUNDLE_COPY_NOTE = 'Release bundle presence does not mean production-ready; package remains needs_more_evidence until real inspection_evidence is attached.';
const PREVIEW_ACTION_LABEL = 'Preview';

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

export function buildCanonicalArtifactPreviewRoute(slug, artifactKey) {
  return `${CANONICAL_PACKAGES_ENDPOINT}/${encodeURIComponent(slug)}/artifacts/${encodeURIComponent(artifactKey)}/preview`;
}

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

function normalizePreviewState(preview = {}) {
  if (!isPlainObject(preview) || !preview.status) {
    return { status: 'idle' };
  }

  const payload = isPlainObject(preview.payload) ? preview.payload : {};
  return {
    status: compactString(preview.status, 'idle'),
    slug: pathValue(preview.slug),
    artifactKey: pathValue(preview.artifactKey),
    label: compactString(preview.label, compactString(preview.artifactKey, 'Preview')),
    path: pathValue(payload.path),
    contentKind: compactString(payload.content_kind),
    contentType: compactString(payload.content_type),
    sizeBytes: Number.isFinite(payload.size_bytes) ? payload.size_bytes : null,
    truncated: payload.truncated === true,
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.filter((warning) => typeof warning === 'string' && warning.trim())
      : [],
    content: typeof payload.content === 'string' ? payload.content : '',
    errorMessage: typeof preview.errorMessage === 'string' ? preview.errorMessage : '',
  };
}

function buildFallbackArtifactCatalog(pkg = {}) {
  return ARTIFACT_REF_LABELS.map(([pathField, label, note]) => ({
    key: pathField.replace(/_path$/, ''),
    label,
    path: pathValue(pkg.artifacts?.[pathField]),
    text_preview_allowed: false,
    warning: note,
    available: Boolean(pathValue(pkg.artifacts?.[pathField])),
  }));
}

function buildArtifactRefs(pkg = {}) {
  const catalog = Array.isArray(pkg.artifact_catalog) && pkg.artifact_catalog.length > 0
    ? pkg.artifact_catalog
    : buildFallbackArtifactCatalog(pkg);

  return catalog
    .filter((entry) => isPlainObject(entry) && entry.available !== false && pathValue(entry.path))
    .map((entry) => {
      const key = pathValue(entry.key);
      const textPreviewAllowed = entry.text_preview_allowed === true && key !== 'release_bundle';
      return {
        key,
        slug: pathValue(pkg.slug),
        label: compactString(entry.label, key),
        path: pathValue(entry.path),
        contentKind: compactString(entry.content_kind),
        note: entry.warning || (key === 'release_bundle' ? RELEASE_BUNDLE_COPY_NOTE : ''),
        copyAction: {
          label: 'Copy repo path',
          copiedLabel: 'Copied',
          failedLabel: 'Copy failed',
        },
        previewAction: textPreviewAllowed
          ? {
              label: PREVIEW_ACTION_LABEL,
              route: buildCanonicalArtifactPreviewRoute(pkg.slug, key),
            }
          : null,
      };
    });
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
  const artifactRefs = buildArtifactRefs(pkg);
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
    preview: normalizePreviewState(canonicalPackagesState.preview),
    boundaryNotes,
  };
}
