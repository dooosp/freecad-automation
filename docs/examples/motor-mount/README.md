# Motor Mount

`motor-mount` is the third curated AF5 example package. It is based on `configs/generated/cnc_motor_mount_bracket.toml` and promoted here as a portable docs package with canonical AF5 artifact names.

The generated source was normalized into a curated docs package so the package is self-contained, carries manufacturing and quality context, uses the same drawing intent conventions as the first two packages, and can be reopened through deterministic Studio artifact routes without depending on ignored generated-output directories. The single-part hole pattern remains the package basis; the support rib was moved away from the left hole pair so DFM edge-distance checks stay warning-only, and the source fillet operation is represented as deburr and edge-break intent because runtime strict quality rejected the generated fillet/chamfer geometry.

## Included Artifacts

- `config.toml`: curated copy of the single-part CNC motor mount source config with manufacturing, quality, export, drawing plan, and drawing intent metadata.
- `cad/cnc_motor_mount_bracket.step` and `cad/cnc_motor_mount_bracket.stl`: runtime-generated exports.
- `quality/cnc_motor_mount_bracket_create_quality.json`: strict create-quality result with STEP/STL round-trip evidence.
- `quality/cnc_motor_mount_bracket_drawing_quality.json`: strict drawing-quality summary.
- `drawing/cnc_motor_mount_bracket_drawing.svg`: generated drawing preview.
- `review/review_pack.json`: canonical review handoff.
- `readiness/readiness_report.json`: canonical readiness handoff.
- `standard-docs/standard_docs_manifest.json`: standard-document draft inventory.
- `release/release_bundle_manifest.json`: canonical release bundle inventory.
- `release/release_bundle.zip`: portable release bundle.

## Drawing Intent

The curated config adds explicit drawing intent for the base plate envelope, mounting face and base plate intent, support web, support rib, four-hole motor mounting pattern, shared 9 mm hole diameter, material and machining notes, deburr and edge-break notes, and required front, top, right, and iso drawing views.

The current drawing renderer can strictly trace the shared hole-diameter plan dimension through the hole feature graph. Base envelope, web, and rib requirements remain explicit advisory drawing intent when the traceability mapper cannot resolve those feature keys as strict linked dimensions.

## Generation Notes

The package artifacts were generated with the local FreeCAD runtime, then sanitized so checked-in JSON and text files use repo-relative package paths instead of local runtime paths.

`readiness/readiness_report.json` is the readiness source of truth. The current readiness status remains `needs_more_evidence`, score 55, with gate decision `hold_for_evidence_completion`. The create and drawing quality gates passed, and the review pack links the checked-in package quality and drawing evidence as side inputs. These side inputs clear the generated `quality_evidence` gap, but they do not satisfy `inspection_evidence`; no real inspection evidence is attached yet. DFM is warning-only because edge treatment remains note-driven rather than modeled as a fillet/chamfer operation.

## Assembly Deferral

`configs/generated/cnc_motor_mount_bracket_assembly.toml` is a related tolerance-analysis companion. It is intentionally deferred and is not packaged here so this curated package remains a single-part motor mount example.

## Studio Reopen

This package is covered by the deterministic Studio reopen fixture. The fixture represents the package as a tracked job/artifact set without committing volatile job IDs.
