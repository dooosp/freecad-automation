const RELEASE_BUNDLE_WARNING =
  'Release bundle presence does not mean production-ready; package remains needs_more_evidence until real inspection_evidence is attached.';

export const CANONICAL_ARTIFACT_KEYS = Object.freeze([
  'readme',
  'review_pack',
  'readiness_report',
  'standard_docs_manifest',
  'release_manifest',
  'release_checksums',
  'release_bundle',
  'reopen_notes',
  'collection_guide',
]);

export const CANONICAL_ARTIFACT_CONTENT_KINDS = Object.freeze([
  'json',
  'markdown',
  'text',
  'zip',
  'manifest',
  'checksum',
]);

export const CANONICAL_ARTIFACT_KEY_CONTRACT = Object.freeze([
  {
    key: 'readme',
    label: 'README',
    path_field: 'readme_path',
    content_kind: 'markdown',
    text_preview_allowed: true,
    optional: false,
  },
  {
    key: 'review_pack',
    label: 'Review pack',
    path_field: 'review_pack_path',
    content_kind: 'json',
    text_preview_allowed: true,
    optional: false,
  },
  {
    key: 'readiness_report',
    label: 'Readiness report',
    path_field: 'readiness_report_path',
    content_kind: 'json',
    text_preview_allowed: true,
    optional: false,
  },
  {
    key: 'standard_docs_manifest',
    label: 'Standard docs manifest',
    path_field: 'standard_docs_manifest_path',
    content_kind: 'manifest',
    text_preview_allowed: true,
    optional: false,
  },
  {
    key: 'release_manifest',
    label: 'Release manifest',
    path_field: 'release_manifest_path',
    content_kind: 'manifest',
    text_preview_allowed: true,
    optional: false,
  },
  {
    key: 'release_checksums',
    label: 'Release checksums',
    path_field: 'release_checksums_path',
    content_kind: 'checksum',
    text_preview_allowed: true,
    optional: false,
  },
  {
    key: 'release_bundle',
    label: 'Release bundle',
    path_field: 'release_bundle_path',
    content_kind: 'zip',
    text_preview_allowed: false,
    optional: false,
    warning_required: true,
    warning: RELEASE_BUNDLE_WARNING,
    production_ready: false,
  },
  {
    key: 'reopen_notes',
    label: 'Reopen notes',
    path_field: 'reopen_notes_path',
    content_kind: 'markdown',
    text_preview_allowed: true,
    optional: false,
  },
  {
    key: 'collection_guide',
    label: 'Inspection evidence collection guide',
    path_field: 'collection_guide_path',
    content_kind: 'markdown',
    text_preview_allowed: true,
    optional: true,
  },
]);

export function buildCanonicalArtifactCatalog(pathsByField = {}) {
  return CANONICAL_ARTIFACT_KEY_CONTRACT.map((definition) => {
    const path = pathsByField[definition.path_field] || null;
    return {
      key: definition.key,
      label: definition.label,
      path_field: definition.path_field,
      path,
      content_kind: definition.content_kind,
      text_preview_allowed: definition.text_preview_allowed === true,
      download_allowed: false,
      warning_required: definition.warning_required === true,
      warning: definition.warning || null,
      path_must_be_repo_relative: true,
      optional: definition.optional === true,
      available: typeof path === 'string' && path.length > 0,
      production_ready: definition.production_ready ?? null,
    };
  });
}
