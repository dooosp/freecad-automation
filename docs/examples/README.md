# Example Library

The example library collects curated packages that can be reviewed from the repository without generating new CAD outputs. A canonical package is a checked-in example package with portable source config, CAD/export artifacts, quality and drawing evidence, canonical review/readiness artifacts, standard-document and release-bundle manifests, a small curated release bundle, and deterministic Studio reopen coverage.

The current canonical packages are:

- [`quality-pass-bracket`](./quality-pass-bracket/README.md)
- [`plate-with-holes`](./plate-with-holes/README.md)
- [`motor-mount`](./motor-mount/README.md)
- [`controller-housing-eol`](./controller-housing-eol/README.md)

For the browser review path, use the [Studio first-user walkthrough](../studio-first-user-walkthrough.md). For DFM and readiness boundaries, use the [DFM and readiness guide](../dfm-readiness-guide.md).

## Canonical Package Contract

Each canonical package lives under `docs/examples/<slug>/` and is tracked in [`example-library-manifest.json`](./example-library-manifest.json) with status `canonical-package`.

Canonical packages include:

- `config.toml`
- CAD/export artifacts under `cad/`
- quality and drawing evidence under `quality/` and `drawing/`
- `review/review_pack.json`
- `readiness/readiness_report.json`
- `standard-docs/standard_docs_manifest.json`
- `release/release_bundle_manifest.json`
- `release/release_bundle_checksums.sha256`
- `release/release_bundle_log.json`
- `release/release_bundle.zip`
- `reopen-notes.md` plus deterministic Studio tracked re-entry coverage

The checked-in release bundles are intentionally small curated package artifacts. They are part of the public example package contract, not ignored generated-output directories.

## Artifact Map

For any canonical package, start with these checked-in package artifacts:

- `review/review_pack.json`: package evidence ledger with portable source refs for CAD, quality, drawing, and package-side evidence inputs.
- `readiness/readiness_report.json`: readiness source of truth for status, score, gate decision, and missing evidence.
- `standard-docs/`: generated standard-document drafts plus `standard_docs_manifest.json`.
- `release/`: release metadata and bundle files, including `release_bundle_manifest.json`, `release_bundle_checksums.sha256`, `release_bundle_log.json`, and `release_bundle.zip`.
- `reopen-notes.md`: deterministic Studio reopen fixture notes for the checked-in package routes.

Studio supports read-only canonical package cards and allowlisted artifact preview through the local API. Checked-in canonical package artifacts are discoverable there; tracked job/artifact reopen remains separate, and the route is not arbitrary local package import.

Release bundle presence does not mean production-ready. All four packages remain `needs_more_evidence` until real `inspection_evidence` is attached and the canonical review/readiness/release chain is deliberately regenerated.

## Canonical AF5 Flow

The canonical AF5 package flow is:

```text
review-context
  -> review_pack.json
  -> readiness-pack
  -> readiness_report.json
  -> generate-standard-docs
  -> standard_docs_manifest.json
  -> pack
  -> release_bundle_manifest.json
  -> release_bundle.zip
  -> Studio package cards / allowlisted artifact preview and tracked job/artifact reopen
```

`readiness_report.json` is the readiness source of truth for standard docs and release packaging. The checked-in Studio coverage proves read-only package-card discovery, allowlisted artifact preview, and tracked job/artifact re-entry for canonical artifacts; it is not arbitrary local file import.

## Canonical Packages

| Package | Source basis | What it demonstrates | Readiness status | Release bundle | Studio reopen fixture | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [`quality-pass-bracket`](./quality-pass-bracket/README.md) | `configs/examples/quality_pass_bracket.toml` | Canonical passing bracket seed and first AF5 package template | `needs_more_evidence`, score 61 | Yes | Yes | Baseline package pattern for canonical review, readiness, standard-doc, release, and reopen artifacts. |
| [`plate-with-holes`](./plate-with-holes/README.md) | `configs/examples/pcb_mount_plate.toml` | Hole pattern, connector slot, standoff/plate package with curated drawing intent | `needs_more_evidence`, score 61 | Yes | Yes | Curated drawing intent makes the plate package useful for hole-pattern and manufacturing-note review. |
| [`motor-mount`](./motor-mount/README.md) | `configs/generated/cnc_motor_mount_bracket.toml` | Generated-config promotion into a curated single-part motor mount package | `needs_more_evidence`, score 55 | Yes | Yes | The related assembly config is intentionally deferred and is not part of this package. |
| [`controller-housing-eol`](./controller-housing-eol/README.md) | `configs/examples/controller_housing_eol.toml` | Enclosure and EOL package for controller housing assembly, traceability, torque, barcode pairing, gasket confirmation, and functional-test release | `needs_more_evidence`, score 52 | Yes | Yes | Default standard docs are regenerated canonical evidence; Korea and Mexico standard-doc directories remain legacy site examples. |

`needs_more_evidence` is not a package failure. In the current readiness reports, all four packages are held at `hold_for_evidence_completion` because `inspection_evidence` remains missing. The linked quality and drawing evidence is review evidence and closes `quality_evidence`, but it does not satisfy `inspection_evidence`; only genuine completed inspection evidence JSON attached through the canonical flow should change that. Do not rephrase these packages as passed readiness until that evidence is supplied and the readiness artifacts are regenerated through the canonical flow.

## Next Candidates

`controller_housing.toml` remains a broader enclosure candidate for a later package or comparison pass. New simple geometry examples such as `spacer` or `hinge-block` are also possible later.

No fifth package is complete yet.
