# Quality Pass Bracket

`quality-pass-bracket` is the first curated AF5 example package. It is generated from `configs/examples/quality_pass_bracket.toml` and copied here as a portable docs package with canonical AF5 artifact names.

## Included Artifacts

- `config.toml`: copied from the source example config.
- `cad/quality_pass_bracket.step` and `cad/quality_pass_bracket.stl`: runtime-generated exports.
- `quality/quality_pass_bracket_create_quality.json`: strict create-quality result, including STEP/STL round-trip evidence.
- `quality/quality_pass_bracket_drawing_quality.json`: strict drawing-quality summary.
- `drawing/quality_pass_bracket_drawing.svg`: generated drawing preview.
- `review/review_pack.json`: canonical review handoff.
- `readiness/readiness_report.json`: canonical readiness handoff.
- `standard-docs/standard_docs_manifest.json`: standard-document draft inventory.
- `release/release_bundle_manifest.json`: canonical release bundle inventory.
- `release/release_bundle.zip`: portable release bundle.

## Generation Notes

The package artifacts were generated with FreeCAD 1.1.1 on macOS, then sanitized so checked-in JSON and text files use repo-relative package paths instead of local output paths.

The create and drawing quality gates passed. The readiness report status is `needs_more_evidence` because the review pack was built from the generated STEP without separate inspection or quality side inputs.
