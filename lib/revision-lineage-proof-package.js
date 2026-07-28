/**
 * The first proof-lineage package is an explicit authority decision. None of
 * these values may be derived from a filename, directory, or descendant.
 *
 * The source config and generated descendant are deliberately separate
 * allowlist entries. Only the source is manually curated; the package-local
 * descendant is kept as its exact copy.
 */
export const SELECTED_REVISION_LINEAGE_PACKAGE = Object.freeze({
  package_directory: 'docs/examples/hinge-block',
  package_slug: 'hinge-block',
  part_id: 'hinge_block',
  revision: 'A',
  authoritative_config_path: 'configs/examples/hinge_block.toml',
  generated_config_descendants: Object.freeze([
    'docs/examples/hinge-block/config.toml',
  ]),
});

export const REVISION_LINEAGE_PROOF_PACKAGE_ALLOWLIST = Object.freeze([
  SELECTED_REVISION_LINEAGE_PACKAGE,
]);
