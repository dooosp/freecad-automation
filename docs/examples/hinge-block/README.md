# Hinge Block

`hinge-block` is the fifth curated AF5 example package. It is based on `configs/examples/hinge_block.toml` and promoted here as a portable docs package with canonical AF5 artifact names.

The source config creates a small machined AL6061 hinge support: a rectangular base block, two bounded hinge ears, two hinge-pin clearance holes, and two base mounting holes. It is intentionally a single-part mechanism-like example; it does not claim assembly motion, load rating, or production readiness.

## Included Artifacts

- `config.toml`: curated copy of the hinge-block source config with manufacturing, quality, export, drawing plan, and drawing intent metadata.
- `cad/hinge_block.step` and `cad/hinge_block.stl`: runtime-generated exports.
- `quality/hinge_block_create_quality.json`: strict create-quality result with STEP/STL round-trip evidence.
- `quality/hinge_block_drawing_quality.json`: strict drawing-quality summary.
- `quality/hinge_block_drawing_qa.json`: drawing QA report.
- `drawing/hinge_block_drawing.svg`: generated drawing preview.
- `drawing/hinge_block_drawing_intent.json`, `drawing/hinge_block_extracted_drawing_semantics.json`, and `drawing/hinge_block_feature_catalog.json`: drawing intent, extracted semantics, and feature catalog sidecars.
- `review/review_pack.json`: canonical review handoff.
- `readiness/readiness_report.json`: canonical readiness handoff.
- `standard-docs/standard_docs_manifest.json`: standard-document draft inventory.
- `release/release_bundle_manifest.json`: canonical release bundle inventory.
- `release/release_bundle.zip`: portable release bundle.

## Drawing Intent

The curated config adds explicit drawing intent for the base block, two hinge ears, hinge-pin clearance holes, base mounting holes, AL6061 material note, and an evidence-boundary note. The required drawing dimensions are the shared 8 mm hinge-pin hole diameter and the shared 6 mm base mounting hole diameter.

The drawing quality gate passed with the current renderer. Any remaining manufacturability or drawing observations are review topics only; they are not inspection evidence and do not prove physical conformance.

## Generation Notes

The package artifacts were generated with the local FreeCAD runtime, then sanitized so checked-in JSON and text files use repo-relative package paths instead of local runtime paths.

`readiness/readiness_report.json` is the readiness source of truth. The current readiness status remains `needs_more_evidence`, score 52, with gate decision `hold_for_evidence_completion`. The create and drawing quality gates passed, and the review pack links the checked-in package quality and drawing evidence as side inputs. These side inputs clear the generated `quality_evidence` gap, but they do not satisfy `inspection_evidence`; no real inspection evidence is attached yet.

## Studio Reopen

This package is covered by the deterministic Studio reopen fixture. The fixture represents the package as a tracked job/artifact set without committing volatile job IDs.
