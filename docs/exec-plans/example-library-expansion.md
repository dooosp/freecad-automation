# Example Library Expansion

## Goal

Define and grow a curated example-library structure for canonical AF5 packages. The first three canonical packages are now `quality-pass-bracket`, `plate-with-holes`, and `motor-mount`; the next maintenance step is keeping the public example-library index aligned with the manifest and package tests.

## Scope Boundary

- Add the execution plan and coverage manifest for the curated example library.
- Reuse the existing AF5 publish/reopen contract and canonical artifact names.
- Do not generate CAD, quality, drawing, review, readiness, standard-doc, or release outputs in this phase.
- Do not add new production geometry examples in this phase.
- Do not commit binary release bundles in this phase.
- Do not change runtime workflow code, Studio behavior, local API routes, or backend execution.
- Do not treat generic fixtures as curated per-example package coverage.

## Canonical Curated Example Structure

Each curated package should live under `docs/examples/<slug>/` and use this structure:

```text
docs/examples/<slug>/
  README.md
  config.toml
  cad/
  quality/
  drawing/
  review/review_pack.json
  readiness/readiness_report.json
  standard-docs/standard_docs_manifest.json
  release/release_bundle_manifest.json
  release/release_bundle.zip
  reopen-notes.md
```

When the package directly reuses a tracked config from `configs/examples/`, `config.toml` may be replaced by a README source note that links to the tracked config. The curated package must still make the source config relationship explicit.

`reopen-notes.md` should describe deterministic tracked job and artifact re-entry behavior, supported Studio routes, and artifact families. It must not include local machine job ids, absolute paths, or user-specific storage locations.

## AF5 Artifact Contract Reused By Examples

Curated examples reuse the AF5 canonical artifact contract:

- `review_pack.json`
- `readiness_report.json`
- `standard_docs_manifest.json`
- `release_bundle_manifest.json`
- `release_bundle.zip`

`review_pack.json` starts the canonical review handoff. `readiness_report.json` is the source of truth for standard docs and release packaging. `standard_docs_manifest.json` inventories generated draft documents. `release_bundle_manifest.json` inventories the portable release package, and `release_bundle.zip` is the derived transport artifact.

The coverage manifest must use these exact underscore names. Legacy hyphenated AF5 names are not part of the curated package contract.

## Candidate Examples And Priority Order

1. `quality-pass-bracket`: canonical passing bracket seed from `configs/examples/quality_pass_bracket.toml`.
2. `plate-with-holes`: plate and hole-pattern seed from `configs/examples/pcb_mount_plate.toml`; can also reference existing quality fixture patterns.
3. `motor-mount`: generated motor-mount seed from `configs/generated/cnc_motor_mount_bracket.toml`; promote only after reviewing generated provenance and drawing intent gaps.
4. `enclosure`: controller-housing seed from `configs/examples/controller_housing.toml`.
5. `controller-housing-eol`: standard-docs-rich enclosure variant from `configs/examples/controller_housing_eol.toml`; existing checked-in standard docs are useful but should be regenerated or sanitized before canonical package promotion.
6. `fixture-plate`: possible fixture-oriented package using `configs/examples/pcb_mount_plate.toml` until a distinct fixture config exists.
7. `shaft-support`: partial seed from `configs/examples/ks_shaft.toml`, with `configs/examples/seatbelt_retractor.toml` as a related mechanism-heavy reference.
8. `ks-bracket`: intentional blocker-rich bracket demo from `configs/examples/ks_bracket.toml`; keep as a fail/demo package, not the happy path.
9. `hinge-block`: absent; create only after the first AF5 packages and validations are stable.
10. `spacer`: absent; create only after the first AF5 packages and validations are stable.
11. `simple-jig`: absent; create only after the first AF5 packages and validations are stable.

## First Package Target: quality_pass_bracket

The first package should be `docs/examples/quality-pass-bracket/` and should use `configs/examples/quality_pass_bracket.toml` as the seed. It is the strict-pass quality fixture for create quality, drawing quality, DFM, and report readiness, so it is the safest first canonical happy path.

Package generation should happen in a later task. That task should generate or copy only reviewed artifacts into the curated package root, then validate the package without relying on ignored generated directories.

## Validation Strategy

Planning and manifest phase:

- `node tests/example-library-manifest.test.js`
- `git diff --check`
- `npm run test:node:contract`

First package phase:

- run the targeted manifest test
- validate package file presence and canonical names
- run package validation tests for the curated root
- run `npm run test:node:contract`
- run runtime smoke only if real package artifacts are generated or runtime workflow code changes
- run browser smoke only if browser-facing Studio behavior changes

Studio reopen validation should be deterministic. It should use a temp job-store fixture or focused test, not local machine job ids.

## Risk Register

- Existing checked-in docs examples include older artifact conventions and should not be promoted without normalization.
- `controller-housing-eol` has useful checked-in standard docs, but the existing manifest should be treated as legacy until regenerated or sanitized for portable paths.
- Generic review and readiness fixtures prove schema behavior, not curated per-example package coverage.
- Generated motor-mount configs are promising, but need provenance review before becoming canonical examples.
- Binary release bundles can create noisy diffs and should be added only when the package contract and validation are locked.
- Studio reopen can be overclaimed if it relies on local job ids instead of deterministic tracked job fixtures.
- `ks_bracket` is valuable as a blocker-rich demo, but it must not become the canonical passing bracket.

## Task Queue

1. Create this execution plan and `docs/examples/example-library-manifest.json`.
2. Add a lightweight manifest contract test and wire it into the Node contract lane.
3. Build `quality-pass-bracket` as the first canonical AF5 package.
4. Add package validation tests for canonical names, required directories, and artifact coverage.
5. Add deterministic Studio reopen validation for tracked job and artifact re-entry.
6. Extend packages to `plate-with-holes` and `motor-mount`.
7. Refresh the public example-library index after the first three canonical packages are merged.
8. Decide whether `controller-housing-eol` becomes a full canonical package or remains a standard-docs example after manifest regeneration or sanitization.
9. Extend packages to `enclosure` only when a fourth package is intentionally scheduled.
10. Create new geometry examples for `hinge-block`, `spacer`, and `simple-jig` after the first package set is stable.

## Definition Of Done For The First 3 Canonical Packages

For `quality-pass-bracket`, `plate-with-holes`, and `motor-mount`:

- each package has a `docs/examples/<slug>/README.md`
- each package identifies its source config without absolute paths
- each package uses the canonical AF5 artifact names
- each package has review, readiness, standard-docs, release manifest, and release ZIP coverage when generated
- each package has package validation coverage in Node tests
- each package has deterministic Studio reopen notes or fixture coverage without machine-specific job ids
- binary release bundles are included only after package validation is stable and intentional
- validation results are recorded in the task final report with skipped checks explained
