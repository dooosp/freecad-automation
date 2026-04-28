# Quality Pass Bracket Inspection Evidence Collection Guide

This guide helps a human collect genuine inspection measurements for
`docs/examples/quality-pass-bracket`. It prepares a future completed evidence file
at:

`docs/examples/quality-pass-bracket/inspection/inspection_evidence.json`

This guide is not readiness evidence. The package remains missing
`inspection_evidence` until a real completed JSON file is attached through the
Stage 5B `review-context --inspection-evidence <PATH_TO_COMPLETED_REAL_JSON>`
flow and the selected review/readiness artifacts are regenerated.

## Evidence Boundary

- Generated quality, drawing, feature catalog, readiness, and review-pack
  artifacts do not count as inspection evidence.
- The non-canonical Stage 2 fixture under `tests/fixtures/inspection-evidence/`
  is only a schema/validator example. Do not use it as package evidence.
- Nominal values and feature IDs below come from the package config, drawing
  intent, drawing semantics, feature catalog, and existing quality artifacts.
- Measured values must come from real physical inspection or a supplier
  inspection record for the manufactured part.
- Do not derive measured values from CAD nominal dimensions, generated shape
  geometry, STEP re-import checks, drawing text extraction, or readiness output.

## Current Package State

- Readiness status: `needs_more_evidence`
- Readiness score: `61`
- Gate decision: `hold_for_evidence_completion`
- Missing input: `inspection_evidence`
- Review-pack package side inputs include create quality, drawing quality,
  drawing QA, drawing intent, and feature catalog records. Those records are
  explicitly marked as not inspection evidence.

## Required Inspection Metadata

A completed evidence file must satisfy `schemas/inspection-evidence.schema.json`.
Collect these values from the real inspection record:

- `schema_version`: `1.0`
- `evidence_type`: `inspection_evidence`
- `source_type`: one of `cmm_report`, `manual_caliper_check`,
  `go_no_go_gauge`, `first_article_inspection`,
  `supplier_inspection_report`, or `other_inspection_source`
- `package_id`: recommended `quality-pass-bracket`
- `inspected_part`: recommended `quality_pass_bracket`
- `inspected_at` or `inspection_date`: real inspection date/time
- `inspector` or `inspection_author`: real person, team, lab, or supplier
- `measurement_system` or `units`: recommended `metric` and `mm`
- `source_ref` or `source_file`: safe repo-relative reference to the real
  inspection source record
- `measured_features`: at least one real measured feature record
- `overall_result`: `pass`, `fail`, `partial`, or `unknown`

Each measured feature record needs:

- `feature_id`
- `result`: `pass`, `fail`, or `not_measured`
- `measurement_method`
- `measured_value` when `result` is `pass` or `fail`

## Measurement Checklist

Use the following as a collection checklist. Blank measured-value cells are
intentional.

| Feature ID | Drawing or requirement ref | Nominal value | Units | Recommended method | Tolerance or allowed range | Real measured value |
| --- | --- | ---: | --- | --- | --- | --- |
| `hole_left` diameter | `HOLE_LEFT_DIA`; top view diameter label | 6 | mm | CMM, bore gauge, pin gauge, or documented caliper method | Package quality hint: +/-0.05 mm. Use only if confirmed as the released inspection tolerance. |  |
| `hole_right` diameter | `HOLE_RIGHT_DIA`; top view diameter label | 10 | mm | CMM, bore gauge, pin gauge, or documented caliper method | Package quality hint: +/-0.05 mm. Use only if confirmed as the released inspection tolerance. |  |
| `hole_left` center X/Y | Feature catalog/config position for `hole_left` | X 30, Y 30 | mm | CMM or optical layout from agreed datums | Package quality hint: +/-0.2 mm. Use only if confirmed as the released inspection tolerance. |  |
| `hole_right` center X/Y | Feature catalog/config position for `hole_right` | X 125, Y 70 | mm | CMM or optical layout from agreed datums | Package quality hint: +/-0.2 mm. Use only if confirmed as the released inspection tolerance. |  |
| `plate` envelope length | `PLATE`; base plate envelope | 160 | mm | Caliper, CMM, or height/layout inspection | No released tolerance found in package artifacts. Use `unknown`/`not_measured` semantics until supplied by the real inspection plan. |  |
| `plate` envelope width | `PLATE`; base plate envelope | 100 | mm | Caliper, CMM, or height/layout inspection | No released tolerance found in package artifacts. Use `unknown`/`not_measured` semantics until supplied by the real inspection plan. |  |
| `plate` thickness | `PLATE`; base plate envelope | 8 | mm | Micrometer, caliper, or CMM | No released tolerance found in package artifacts. Use `unknown`/`not_measured` semantics until supplied by the real inspection plan. |  |
| `chamfer_3` size | Feature catalog/config chamfer operation | 1.0 | mm | Chamfer gauge, optical comparator, or CMM | No released tolerance found in package artifacts. Use `unknown`/`not_measured` semantics until supplied by the real inspection plan. |  |

The two required drawing-intent dimensions are `HOLE_LEFT_DIA` and
`HOLE_RIGHT_DIA`. The plate envelope, hole centers, and chamfer are useful
candidate checks from the feature catalog and generated quality hints, but they
still require a real inspection plan or supplier report to define acceptance.

## Result Semantics

- Use feature `result: "pass"` only when the real measured value is within the
  confirmed tolerance or allowed range.
- Use feature `result: "fail"` when the real measured value is outside the
  confirmed tolerance or allowed range.
- Use feature `result: "not_measured"` when the feature was not measured, the
  tolerance is not confirmed, or measurement confidence is insufficient.
- Use top-level `overall_result: "unknown"` when package-level acceptance cannot
  be decided from the completed measurements.
- Use top-level `overall_result: "partial"` when some required features are
  measured and others remain unresolved.

## Copy/Paste JSONC Template

This is intentionally JSONC, not a ready evidence file. Remove comments, replace
placeholders, add real measured values, and set results from the real inspection
record before Stage 5B.

```jsonc
{
  "schema_version": "1.0",
  "evidence_type": "inspection_evidence",
  "source_type": "<manual_caliper_check|cmm_report|supplier_inspection_report|first_article_inspection|go_no_go_gauge|other_inspection_source>",
  "package_id": "quality-pass-bracket",
  "inspected_part": "quality_pass_bracket",
  "inspection_date": "<YYYY-MM-DD>",
  "inspector": "<REAL_PERSON_TEAM_LAB_OR_SUPPLIER>",
  "inspection_author": null,
  "measurement_system": "metric",
  "units": "mm",
  "source_ref": "<SAFE_REPO_RELATIVE_PATH_TO_REAL_INSPECTION_SOURCE_RECORD>",
  "measured_features": [
    {
      "feature_id": "hole_left",
      "drawing_ref": "docs/examples/quality-pass-bracket/drawing/quality_pass_bracket_drawing.svg:data-dim-id=HOLE_LEFT_DIA",
      "requirement_ref": "HOLE_LEFT_DIA",
      "nominal_value": 6,
      // Add only after real inspection:
      // "measured_value": <REAL_LEFT_HOLE_DIAMETER_MM>,
      "tolerance_upper": null,
      "tolerance_lower": null,
      "units": "mm",
      "result": "not_measured",
      "measurement_method": "<REAL_METHOD>"
    },
    {
      "feature_id": "hole_right",
      "drawing_ref": "docs/examples/quality-pass-bracket/drawing/quality_pass_bracket_drawing.svg:data-dim-id=HOLE_RIGHT_DIA",
      "requirement_ref": "HOLE_RIGHT_DIA",
      "nominal_value": 10,
      // Add only after real inspection:
      // "measured_value": <REAL_RIGHT_HOLE_DIAMETER_MM>,
      "tolerance_upper": null,
      "tolerance_lower": null,
      "units": "mm",
      "result": "not_measured",
      "measurement_method": "<REAL_METHOD>"
    }
  ],
  "overall_result": "unknown",
  "traceability_refs": [
    "HOLE_LEFT_DIA",
    "HOLE_RIGHT_DIA"
  ],
  "notes": "Template only. Replace with real inspection source context before Stage 5B."
}
```

## Future Validation

After a real completed JSON file exists, validate it with the shared validator
before attaching it:

```bash
node --input-type=module -e "import { readFileSync } from 'node:fs'; import { assertValidInspectionEvidence } from './lib/inspection-evidence.js'; const path = process.argv[1]; assertValidInspectionEvidence(JSON.parse(readFileSync(path, 'utf8')), { path }); console.log('valid inspection evidence: ' + path);" docs/examples/quality-pass-bracket/inspection/inspection_evidence.json
```

Then Stage 5B may attach the completed real JSON through
`review-context --inspection-evidence <PATH_TO_COMPLETED_REAL_JSON>` and
regenerate only the selected review/readiness artifacts required by that stage.
