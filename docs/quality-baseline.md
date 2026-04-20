# Quality Baseline

- baseline git commit: `baba643b1933cdef5dbf02a568c45e4fd90433fb`
- baseline branch for this follow-up: `origin/master`
- runtime availability:
  - `node bin/fcad.js check-runtime` -> `Status: ready`
  - runtime mode: `macos-bundle`
  - runtime executable: `/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd`
  - FreeCAD version: `FreeCAD 1.1.1 Revision: 20260414 (Git shallow)`

## Baseline fail-demo: `ks_bracket`

- commands run:
  - `node bin/fcad.js create configs/examples/ks_bracket.toml`
  - `node bin/fcad.js draw configs/examples/ks_bracket.toml --bom`
  - `node bin/fcad.js dfm configs/examples/ks_bracket.toml`
  - `node bin/fcad.js report configs/examples/ks_bracket.toml --dfm`
- observed create result:
  - command exited `0`
  - `output/ks_bracket_create_quality.json` -> `status: "fail"`
  - blocker: `Generated model shape is invalid.`
- observed drawing result:
  - command exited `0`
  - `output/ks_bracket_drawing_quality.json` -> `status: "fail"`
  - blockers:
    - required dimension coverage `83.33%`
    - dimension conflict count `7`
    - traceability coverage `0%`
    - missing required intent `HOLE_DIA`
- observed DFM result:
  - command exited `1`
  - score: `70/100`
  - critical blockers:
    - `hole1` edge distance `3.5 mm < 9.0 mm`
    - `hole3` edge distance `3.5 mm < 9.0 mm`
- observed report result:
  - `output/ks_bracket_report_summary.json` -> `overall_status: "fail"`
  - `ready_for_manufacturing_review: false`
  - inspected PDF first page says `Ready for manufacturing review: No`

## Strict-pass fixture: `quality_pass_bracket`

- commands run:
  - `node bin/fcad.js create configs/examples/quality_pass_bracket.toml --strict-quality`
  - `node bin/fcad.js draw configs/examples/quality_pass_bracket.toml --bom --strict-quality`
  - `node bin/fcad.js dfm configs/examples/quality_pass_bracket.toml`
  - `node bin/fcad.js report configs/examples/quality_pass_bracket.toml --dfm`
- observed create result:
  - command exited `0`
  - `output/quality_pass_bracket_create_quality.json` -> `status: "pass"`
- observed drawing result:
  - command exited `0`
  - `output/quality_pass_bracket_drawing_quality.json` -> `status: "pass"`
  - required dimension coverage `100%`
  - dimension conflicts `0`
  - traceability coverage `100%`
- observed DFM result:
  - command exited `0`
  - score: `100/100`
  - informational note only: chamfer present, fillet optional for stress-critical corners
- observed report result:
  - `output/quality_pass_bracket_report_summary.json` -> `overall_status: "pass"`
  - `ready_for_manufacturing_review: true`
  - inspected PDF first page says `Ready for manufacturing review: Yes`

## Interpretation

- `ks_bracket.toml` remains the intentional fail-demo for blocker-rich quality regression coverage.
- `quality_pass_bracket.toml` is the strict-pass example for create/draw/DFM/report readiness.
- Neither fixture required gate weakening to reach its observed result.
