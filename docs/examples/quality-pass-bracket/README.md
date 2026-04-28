# Quality Pass Bracket

`quality-pass-bracket` is the first curated AF5 example package. It is generated from `configs/examples/quality_pass_bracket.toml` and copied here as a portable docs package with canonical AF5 artifact names.

## Included Artifacts

- `config.toml`: copied from the source example config.
- `cad/quality_pass_bracket.step` and `cad/quality_pass_bracket.stl`: runtime-generated exports.
- `quality/quality_pass_bracket_create_quality.json`: strict create-quality result, including STEP/STL round-trip evidence.
- `quality/quality_pass_bracket_drawing_quality.json`: strict drawing-quality summary.
- `quality/quality_pass_bracket_drawing_qa.json`: drawing QA summary.
- `drawing/quality_pass_bracket_drawing.svg`: generated drawing preview.
- `drawing/quality_pass_bracket_drawing_intent.json` and `drawing/quality_pass_bracket_feature_catalog.json`: traceability context used by the review pack.
- `review/review_pack.json`: canonical review handoff.
- `readiness/readiness_report.json`: canonical readiness handoff.
- `standard-docs/standard_docs_manifest.json`: standard-document draft inventory.
- `release/release_bundle_manifest.json`: canonical release bundle inventory.
- `release/release_bundle.zip`: portable release bundle.

## Generation Notes

The package artifacts were generated with FreeCAD 1.1.1 on macOS, then sanitized so checked-in JSON and text files use repo-relative package paths instead of local output paths.

`readiness/readiness_report.json` is the readiness source of truth. The current readiness status remains `needs_more_evidence`, score 61, with gate decision `hold_for_evidence_completion`. The create and drawing quality gates passed, and the review pack links checked-in create quality, drawing quality, drawing QA, drawing intent, and feature catalog side inputs. These side inputs clear the generated `quality_evidence` gap, but they do not satisfy `inspection_evidence`; no real inspection evidence is attached yet.
