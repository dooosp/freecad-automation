# Controller Housing EOL

`controller-housing-eol` is the fourth curated AF5 example package. It is based on `configs/examples/controller_housing_eol.toml` and promoted here as the enclosure and end-of-line package with canonical AF5 artifact names.

The package focuses on an infotainment controller housing plus PCB assembly closeout scenario: cast AL6061 enclosure geometry, rear connector opening, internal electronics cavity, mounting hole pattern, gasket/seal interface, torque trace, barcode pairing, cross-site launch context, and EOL electrical release. `configs/examples/controller_housing.toml` remains a broader enclosure candidate; this package uses the EOL variant because it carries the stronger assembly, traceability, functional-test, and cross-site production basis.

## Included Artifacts

- `config.toml`: curated copy of the controller housing EOL source config with self-contained drawing plan, drawing intent, STEP/STL export, production, quality, traceability, and EOL metadata.
- `cad/controller_housing_eol.step` and `cad/controller_housing_eol.stl`: runtime-generated exports.
- `quality/controller_housing_eol_create_quality.json`: strict create-quality result with STEP/STL round-trip evidence.
- `quality/controller_housing_eol_drawing_quality.json`: strict drawing-quality summary.
- `drawing/controller_housing_eol_drawing.svg`: generated drawing preview.
- `review/review_pack.json`: canonical review handoff.
- `readiness/readiness_report.json`: canonical readiness handoff.
- `standard-docs/standard_docs_manifest.json`: current canonical standard-document draft inventory generated from the readiness report.
- `release/release_bundle_manifest.json`: canonical release bundle inventory.
- `release/release_bundle.zip`: portable release bundle.

## Drawing Intent

The curated config adds explicit drawing intent for housing envelope, internal cavity, rear connector opening and datum, four-hole mounting pattern, gasket/seal interface, material and process notes, torque trace, barcode pairing, EOL functional-test release, and front/top/right/iso drawing views.

The current drawing renderer can strictly trace the shared mounting-hole diameter plan dimension through the hole feature graph. The seal depth, cavity, connector opening, and package envelope requirements remain explicit advisory drawing intent when the current traceability mapper cannot prove those links as strict drawing-plan dimensions.

## Standard Docs

The default `standard-docs/` set is now the canonical package standard-document output. It was regenerated from `readiness/readiness_report.json` and uses current `schema_version: "1.0"`.

The retained `standard-docs-korea/` and `standard-docs-mexico/` directories are legacy site-document examples from the earlier standard-doc sanitization work. They remain useful for site preset comparison and intentionally keep their legacy `schema_version: "0.1"` manifests.

## Generation Notes

The package artifacts were generated with the local FreeCAD runtime, then sanitized so checked-in JSON and text files use repo-relative package paths instead of local runtime paths.

Create quality passed. Drawing quality passed with score 72 and 100% strict traceability coverage for the supported drawing-plan dimension. DFM is warning-only because the housing still carries deep through-hole drill-ratio warnings and note-driven edge-treatment risk; no checked-in package DFM report is used as review-pack side input. The readiness report status remains `needs_more_evidence`, score 52, because package quality and drawing evidence is now linked while genuine inspection evidence is still missing.

## Studio Reopen

This package is covered by the deterministic Studio reopen fixture. The fixture represents the package as a tracked job/artifact set without committing volatile job IDs.
