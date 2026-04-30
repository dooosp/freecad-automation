# Hinge Block Inspection Evidence Collection Guide

This guide helps a human collect genuine inspection measurements for
`docs/examples/hinge-block`. It prepares a future completed evidence file at:

`docs/examples/hinge-block/inspection/inspection_evidence.json`

This guide is not readiness evidence. The package remains missing
`inspection_evidence` until a real completed JSON file is attached through the
Stage 5B `review-context --inspection-evidence <PATH_TO_COMPLETED_REAL_JSON>`
flow and the selected review/readiness artifacts are regenerated.

## Evidence Boundary

- Generated quality, drawing, feature catalog, readiness, and review-pack
  artifacts do not count as inspection evidence.
- The non-canonical Stage 2 fixture under `tests/fixtures/inspection-evidence/`
  is only a schema/validator example. Do not use it as package evidence.
- Nominal values below come from package config, drawing intent, and feature
  catalog context. They are measurement targets, not measured values.
- Measured values must come from real physical inspection or a supplier
  inspection record for the manufactured part.
- Do not derive measured values from CAD geometry, STEP/STL checks, drawing text
  extraction, readiness output, or generated quality output.

## Current Package State

- Readiness status: `needs_more_evidence`
- Readiness score: `52`
- Gate decision: `hold_for_evidence_completion`
- Missing input: `inspection_evidence`
- Package side inputs clear generated `quality_evidence`, but every checked-in
  package side input is marked as not inspection evidence.

## Required Inspection Metadata

A completed evidence file must satisfy `schemas/inspection-evidence.schema.json`.
Collect these values from the real inspection record:

- `schema_version`: `1.0`
- `evidence_type`: `inspection_evidence`
- `source_type`: one of `cmm_report`, `manual_caliper_check`,
  `go_no_go_gauge`, `first_article_inspection`,
  `supplier_inspection_report`, or `other_inspection_source`
- `package_id`: recommended `hinge-block`
- `inspected_part`: recommended `hinge_block`
- `inspected_at` or `inspection_date`: real inspection date/time
- `inspector` or `inspection_author`: real person, team, lab, or supplier
- `measurement_system` or `units`: recommended `metric` and `mm`
- `source_ref` or `source_file`: safe repo-relative reference to the real
  inspection source record
- `measured_features`: at least one real measured feature record
- `overall_result`: `pass`, `fail`, `partial`, or `unknown`

Each measured feature record needs `feature_id`, `result`,
`measurement_method`, and `measured_value` when the result is `pass` or `fail`.

## Measurement Checklist

Blank measured-value cells are intentional. Use tolerances only when confirmed
by the released inspection plan or supplier report.

| Feature ID | Drawing or requirement ref | Nominal value | Units | Recommended method | Tolerance or allowed range | Real measured value |
| --- | --- | ---: | --- | --- | --- | --- |
| `hinge_pin_left` and `hinge_pin_right` diameter | `HINGE_PIN_DIA` | 8 | mm | Pin gauge, bore gauge, CMM, or documented caliper method | Source quality says project default; no numeric released tolerance found in package artifacts. |  |
| `mount_hole_left` and `mount_hole_right` diameter | `MOUNTING_HOLE_DIA` | 6 | mm | Pin gauge, bore gauge, CMM, or documented caliper method | Source quality says project default; no numeric released tolerance found in package artifacts. |  |
| base block length | `BASE_BLOCK`; source envelope | 90 | mm | Caliper, CMM, or layout inspection | No released tolerance found in package artifacts. |  |
| base block width | `BASE_BLOCK`; source envelope | 50 | mm | Caliper, CMM, or layout inspection | No released tolerance found in package artifacts. |  |
| base block height | `BASE_BLOCK`; source envelope | 12 | mm | Micrometer, caliper, or CMM | No released tolerance found in package artifacts. |  |
| hinge ear height | `HINGE_EARS`; source ear height | 26 | mm | Height gauge, CMM, or layout inspection | No released tolerance found in package artifacts. |  |
| hinge ear visual deburr | required machining notes | visual requirement | n/a | Visual inspection against released work instruction | Use pass/fail only if the real inspection plan defines acceptance criteria. |  |

Package-specific caution: the package is a single-part hinge support example.
Do not record motion, load, fit, or durability results unless the actual
inspection source defines the method and acceptance basis.

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
  "package_id": "hinge-block",
  "inspected_part": "hinge_block",
  "inspection_date": "<YYYY-MM-DD>",
  "inspector": "<REAL_PERSON_TEAM_LAB_OR_SUPPLIER>",
  "inspection_author": null,
  "measurement_system": "metric",
  "units": "mm",
  "source_ref": "<SAFE_REPO_RELATIVE_PATH_TO_REAL_INSPECTION_SOURCE_RECORD>",
  "measured_features": [
    {
      "feature_id": "hinge_pin_diameter",
      "drawing_ref": "docs/examples/hinge-block/drawing/hinge_block_drawing.svg:data-dim-id=HINGE_PIN_DIA",
      "requirement_ref": "HINGE_PIN_DIA",
      "nominal_value": 8,
      // Add only after real inspection:
      // "measured_value": <REAL_HINGE_PIN_DIAMETER_MM>,
      "tolerance_upper": null,
      "tolerance_lower": null,
      "units": "mm",
      "result": "not_measured",
      "measurement_method": "<REAL_METHOD>"
    },
    {
      "feature_id": "mounting_hole_diameter",
      "drawing_ref": "docs/examples/hinge-block/drawing/hinge_block_drawing.svg:data-dim-id=MOUNTING_HOLE_DIA",
      "requirement_ref": "MOUNTING_HOLE_DIA",
      "nominal_value": 6,
      // Add only after real inspection:
      // "measured_value": <REAL_MOUNTING_HOLE_DIAMETER_MM>,
      "tolerance_upper": null,
      "tolerance_lower": null,
      "units": "mm",
      "result": "not_measured",
      "measurement_method": "<REAL_METHOD>"
    }
  ],
  "overall_result": "unknown",
  "notes": [
    "This JSONC guide is not evidence. Replace placeholders with real inspection data before validation."
  ]
}
```

Before attaching the completed JSON at
`docs/examples/hinge-block/inspection/inspection_evidence.json`, validate it:

```bash
node --input-type=module -e "import { readFileSync } from 'node:fs'; import { assertValidInspectionEvidence } from './lib/inspection-evidence.js'; const path = process.argv[1]; assertValidInspectionEvidence(JSON.parse(readFileSync(path, 'utf8')), { path }); console.log('valid inspection evidence: ' + path);" docs/examples/hinge-block/inspection/inspection_evidence.json
```

Only after that separate evidence-gated cycle should the review, readiness,
standard-doc, and release artifacts be regenerated with
`review-context --inspection-evidence <PATH_TO_COMPLETED_REAL_JSON>`.
