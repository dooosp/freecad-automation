# Plate With Holes Inspection Evidence Collection Guide

This guide helps a human collect genuine inspection measurements for
`docs/examples/plate-with-holes`. It is a collection worksheet, not an evidence
file or attachment instruction. Never copy a candidate directly to the canonical
package. A real source plus an authoritative envelope must pass quarantine,
validation, checksum-bound authorization, and `inspection-evidence-attach`; only
that command may create the canonical `inspection_evidence.json` and immutable
receipt. Readiness regeneration is a separate authorized operation.

This guide is not readiness evidence.
The future target `docs/examples/plate-with-holes/inspection/inspection_evidence.json`
may be created only by attachment; `<PATH_TO_COMPLETED_REAL_JSON>` is a legacy
placeholder, not permission to copy a candidate there.

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
- Readiness score: `61`
- Gate decision: `hold_for_evidence_completion`
- Missing input: `inspection_evidence`
- Package side inputs clear generated `quality_evidence`, but every checked-in
  package side input is marked as not inspection evidence.

## Required Inspection Metadata

The legacy field names below are worksheet hints only. A production candidate
must instead be represented by
`schemas/inspection-evidence-envelope.schema.json`, including package/revision,
source organization/type, final status, inspector and reviewer references,
measurements/units/specifications, source checksum, provenance, attachment
timestamps, and confidentiality/redaction. Collect these source values from the
real record for later envelope preparation:

- `schema_version`: `1.0`
- `evidence_type`: `inspection_evidence`
- `source_type`: one of `cmm_report`, `manual_caliper_check`,
  `go_no_go_gauge`, `first_article_inspection`,
  `supplier_inspection_report`, or `other_inspection_source`
- `package_id`: recommended `plate-with-holes`
- `inspected_part`: recommended `pcb_mount_plate`
- `inspected_at` or `inspection_date`: real inspection date/time
- `inspector` or `inspection_author`: real person, team, lab, or supplier
- `measurement_system` or `units`: recommended `metric` and `mm`
- `source_ref` or `source_file`: worksheet trace only; the authoritative envelope
  uses a sanitized origin reference plus the quarantined source checksum, never a
  private or absolute path
- `measured_features`: at least one real measured feature record
- `overall_result`: `pass`, `fail`, `partial`, or `unknown`

`partial`, `unknown`, blank, and `not_measured` values are useful collection
states only; they fail the production semantic gate.

Each measured feature record needs `feature_id`, `result`,
`measurement_method`, and `measured_value` when the result is `pass` or `fail`.

## Measurement Checklist

Blank measured-value cells are intentional. Use tolerances only when confirmed
by the released inspection plan or supplier report.

| Feature ID | Drawing or requirement ref | Nominal value | Units | Recommended method | Tolerance or allowed range | Real measured value |
| --- | --- | ---: | --- | --- | --- | --- |
| `hole1` through `hole4` diameter | `MOUNTING_HOLE_DIA`; drawing plan `HOLE_DIA` | 4 | mm | Pin gauge, bore gauge, CMM, or documented caliper method | No released tolerance found in package artifacts. |  |
| mounting hole pattern X | `MOUNTING_HOLE_PATTERN_X`; hole centers x=22 to x=123 | 101 | mm | CMM or optical layout from agreed datums | No released tolerance found in package artifacts. |  |
| mounting hole pattern Y | `MOUNTING_HOLE_PATTERN_Y`; hole centers y=22 to y=76 | 54 | mm | CMM or optical layout from agreed datums | No released tolerance found in package artifacts. |  |
| plate envelope length | `PLATE_LENGTH`; base plate envelope | 145 | mm | Caliper, CMM, or layout inspection | No released tolerance found in package artifacts. |  |
| plate envelope width | `PLATE_WIDTH`; base plate envelope | 98 | mm | Caliper, CMM, or layout inspection | No released tolerance found in package artifacts. |  |
| plate thickness | `PLATE_THICKNESS`; base plate envelope | 4 | mm | Micrometer, caliper, or CMM | No released tolerance found in package artifacts. |  |
| connector slot size | `CONNECTOR_SLOT_SIZE`; slot length and width | 18 length, 10 width | mm | Caliper, pin/slot gauges, optical comparator, or CMM | No released tolerance found in package artifacts. |  |
| connector slot position | `CONNECTOR_SLOT_POSITION`; source critical dimension `cd-02` | 42 | mm | CMM or optical layout from agreed datums | Source quality hint: +/-0.10 mm. Use only if confirmed as the released inspection tolerance. |  |
| standoff height | `STANDOFF_HEIGHT`; source critical dimension `cd-01` | 8 | mm | Height gauge, CMM, or documented caliper method | Source quality hint: +/-0.05 mm. Use only if confirmed as the released inspection tolerance. |  |

Package-specific caution: standoff and connector-slot checks are important
assembly-fit candidates, but the current drawing traceability mapper treats some
of that intent as advisory. Keep those results `not_measured` or top-level
`unknown` until the real inspection plan confirms acceptance criteria.

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
  "package_id": "plate-with-holes",
  "inspected_part": "pcb_mount_plate",
  "inspection_date": "<YYYY-MM-DD>",
  "inspector": "<REAL_PERSON_TEAM_LAB_OR_SUPPLIER>",
  "inspection_author": null,
  "measurement_system": "metric",
  "units": "mm",
  "source_ref": "<SAFE_REPO_RELATIVE_PATH_TO_REAL_INSPECTION_SOURCE_RECORD>",
  "measured_features": [
    {
      "feature_id": "mounting_hole_diameter",
      "drawing_ref": "docs/examples/plate-with-holes/drawing/pcb_mount_plate_drawing.svg:data-dim-id=HOLE_DIA",
      "requirement_ref": "MOUNTING_HOLE_DIA",
      "nominal_value": 4,
      // Add only after real inspection:
      // "measured_value": <REAL_MOUNTING_HOLE_DIAMETER_MM>,
      "tolerance_upper": null,
      "tolerance_lower": null,
      "units": "mm",
      "result": "not_measured",
      "measurement_method": "<REAL_METHOD>"
    },
    {
      "feature_id": "standoff_height",
      "drawing_ref": "docs/examples/plate-with-holes/drawing/pcb_mount_plate_drawing.svg:data-dim-id=STANDOFF_HEIGHT",
      "requirement_ref": "STANDOFF_HEIGHT",
      "nominal_value": 8,
      // Add only after real inspection:
      // "measured_value": <REAL_STANDOFF_HEIGHT_MM>,
      "tolerance_upper": null,
      "tolerance_lower": null,
      "units": "mm",
      "result": "not_measured",
      "measurement_method": "<REAL_METHOD>"
    }
  ],
  "overall_result": "unknown",
  "traceability_refs": [
    "MOUNTING_HOLE_DIA",
    "STANDOFF_HEIGHT"
  ],
  "notes": "Template only. Replace with real inspection source context before Stage 5B."
}
```

## Future Validation

Do not copy the worksheet or source into the canonical package. Follow the five
commands in
[`../inspection-evidence-contract.md`](../inspection-evidence-contract.md):
quarantine, validate against authoritative revision `A`, authorize, attach, then
separately create an attachment-bound review pack with explicit
`--part-id pcb_mount_plate --revision A`. A second authorization is required
before readiness regeneration.
