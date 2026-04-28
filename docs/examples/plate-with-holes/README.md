# Plate With Holes

`plate-with-holes` is the second curated AF5 example package. It is based on `configs/examples/pcb_mount_plate.toml` and promoted here as a portable docs package with canonical AF5 artifact names.

## Included Artifacts

- `config.toml`: curated copy of the PCB mount plate source config with explicit drawing intent.
- `cad/pcb_mount_plate.step` and `cad/pcb_mount_plate.stl`: runtime-generated exports.
- `quality/pcb_mount_plate_create_quality.json`: strict create-quality result with STEP/STL round-trip evidence.
- `quality/pcb_mount_plate_drawing_quality.json`: strict drawing-quality summary.
- `drawing/pcb_mount_plate_drawing.svg`: generated drawing preview.
- `review/review_pack.json`: canonical review handoff.
- `readiness/readiness_report.json`: canonical readiness handoff.
- `standard-docs/standard_docs_manifest.json`: standard-document draft inventory.
- `release/release_bundle_manifest.json`: canonical release bundle inventory.
- `release/release_bundle.zip`: portable release bundle.

## Drawing Intent

The curated config adds the drawing intent that is missing from the source example: overall plate size and thickness, four-hole pattern intent, shared hole diameter, connector slot size and position, standoff height, required drawing views, and manufacturing notes for material, process, and traceability.

The current drawing renderer can strictly trace the hole-diameter plan dimension through the hole feature graph. Plate envelope, slot, and standoff requirements remain explicit advisory drawing intent because the current traceability mapper does not resolve those feature keys as strict linked dimensions.

## Generation Notes

The package artifacts were generated with the local FreeCAD runtime, then sanitized so checked-in JSON and text files use repo-relative package paths instead of local runtime paths.

`readiness/readiness_report.json` is the readiness source of truth. The current readiness status remains `needs_more_evidence`, score 61, with gate decision `hold_for_evidence_completion`. The create and drawing quality gates passed, and the review pack links the checked-in package quality and drawing side inputs. These side inputs clear the generated `quality_evidence` gap, but they do not satisfy `inspection_evidence`; no real inspection evidence is attached yet.

## Studio Reopen

This package is covered by the deterministic Studio reopen fixture. The fixture represents the package as a tracked job/artifact set without committing volatile job IDs.
