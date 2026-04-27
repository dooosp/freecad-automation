# Example Library

The example library collects curated packages that can be reviewed from the repository without generating new CAD outputs. A canonical package is a checked-in example package with portable source config, CAD/export artifacts, quality and drawing evidence, canonical review/readiness artifacts, standard-document and release-bundle manifests, a small curated release bundle, and deterministic Studio reopen coverage.

The current canonical packages are:

- [`quality-pass-bracket`](./quality-pass-bracket/README.md)
- [`plate-with-holes`](./plate-with-holes/README.md)
- [`motor-mount`](./motor-mount/README.md)
- [`controller-housing-eol`](./controller-housing-eol/README.md)

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
- `release/release_bundle.zip`
- `reopen-notes.md` plus deterministic Studio tracked re-entry coverage

The checked-in release bundles are intentionally small curated package artifacts. They are part of the public example package contract, not ignored generated-output directories.

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
  -> Studio tracked job/artifact reopen
```

`readiness_report.json` is the readiness source of truth for standard docs and release packaging. The checked-in Studio reopen coverage proves tracked job/artifact re-entry for canonical artifacts; it is not arbitrary local file import.

## Canonical Packages

| Package | Source basis | What it demonstrates | Readiness status | Release bundle | Studio reopen fixture | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [`quality-pass-bracket`](./quality-pass-bracket/README.md) | `configs/examples/quality_pass_bracket.toml` | Canonical passing bracket seed and first AF5 package template | `needs_more_evidence`, score 50 | Yes | Yes | Baseline package pattern for canonical review, readiness, standard-doc, release, and reopen artifacts. |
| [`plate-with-holes`](./plate-with-holes/README.md) | `configs/examples/pcb_mount_plate.toml` | Hole pattern, connector slot, standoff/plate package with curated drawing intent | `needs_more_evidence`, score 50 | Yes | Yes | Curated drawing intent makes the plate package useful for hole-pattern and manufacturing-note review. |
| [`motor-mount`](./motor-mount/README.md) | `configs/generated/cnc_motor_mount_bracket.toml` | Generated-config promotion into a curated single-part motor mount package | `needs_more_evidence`, score 44 | Yes | Yes | The related assembly config is intentionally deferred and is not part of this package. |
| [`controller-housing-eol`](./controller-housing-eol/README.md) | `configs/examples/controller_housing_eol.toml` | Enclosure and EOL package for controller housing assembly, traceability, torque, barcode pairing, gasket confirmation, and functional-test release | `needs_more_evidence`, score 41 | Yes | Yes | Default standard docs are regenerated canonical evidence; Korea and Mexico standard-doc directories remain legacy site examples. |

`needs_more_evidence` is not a package failure. It reflects that the safe canonical review/readiness path currently lacks separate inspection evidence and quality-linkage side inputs. Do not rephrase these packages as passed readiness until those inputs are supplied and the readiness artifacts are regenerated through the canonical flow.

## Next Candidates

`controller_housing.toml` remains a broader enclosure candidate for a later package or comparison pass. New simple geometry examples such as `spacer` or `hinge-block` are also possible later.

No fifth package is complete yet.
