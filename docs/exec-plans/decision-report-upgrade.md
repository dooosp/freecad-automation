# Decision Report Upgrade

## Goal

Upgrade `fcad report` so the PDF becomes a decision-ready engineering review artifact with a first-page executive summary, additive `*_report_summary.json`, and honest readiness logic that consumes existing manifest, create-quality, drawing-quality, and DFM conventions without replacing them.

## Planned scope

- add an additive report-summary layer for `fcad report` with overall status, score, readiness, top risks, recommended actions, and referenced artifacts
- consume existing `*_create_quality.json`, `*_drawing_quality.json`, and DFM/FEM/tolerance results without widening into create/draw/dfm engine fixes
- keep missing optional artifacts explicit as `not_run` / `not_available` instead of pass
- preserve existing report CLI behavior and output PDF path while linking the new summary JSON through the report artifact surfaces
- upgrade the PDF first page in the legacy report path and the template path with the executive decision summary
- add targeted Node coverage for readiness logic, report-service wiring, and partial-data PDF handling
- update README and testing docs with the new decision summary and report-summary JSON behavior

## Working assumptions

- the selected repo root is the task worktree for `feat/decision-report-upgrade`
- repo identity is proven by `package.json` name `freecad-automation` and `origin` remote `https://github.com/dooosp/freecad-automation.git`
- `origin/master` is the discoverable default branch at task start
- the current task branch is `feat/decision-report-upgrade` at `b5bc3d1f8e222b9e704fa59d624ea0e20247f7f9`
- prerequisite work is present on this branch:
  - `output-manifest-foundation`
  - `create-roundtrip-quality`
  - `drawing-qa-gates`
  - `dfm-actionable-suggestions`
- known upstream `ks_bracket` issues remain report inputs, not fix targets:
  - create-quality fail because the generated model shape is invalid
  - drawing-quality fail because `HOLE_DIA` is missing, dimension conflicts exist, and traceability coverage is low
  - DFM can exit non-zero because real critical/major findings exist
- if PDF dependencies such as `matplotlib` are unavailable on this machine, report that directly and keep verification on hosted-safe summary logic plus service wiring
