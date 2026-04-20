# Drawing QA Gates

## Goal

Strengthen `fcad draw` quality gating by adding a unified additive `<base>_drawing_quality.json` summary that reuses the existing draw sidecars, artifact manifest, and output-manifest conventions.

## Planned scope

- add a draw-quality aggregation helper that summarizes existing draw artifacts into one JSON
- write `<base>_drawing_quality.json` during draw runs without removing existing `_qa.json`, `_qa_issues.json`, `_traceability.json`, `_layout_report.json`, `_dimension_map.json`, `_dim_conflicts.json`, `_repair_report.json`, `_run_log.json`, or `_bom.csv`
- fail strict-quality evaluation when required dimension coverage, conflicts, overlaps, BOM consistency, or traceability fall below the task thresholds
- keep default draw behavior warning-friendly unless strict quality is explicitly requested
- expose the new artifact through the existing manifest surfaces rather than inventing a second manifest system
- add non-FreeCAD tests for aggregation/gating logic and update docs

## Working assumptions

- the selected repo root is the dedicated drawing-qa-gates worktree for `freecad-automation`
- repo identity is proven by `package.json` name `freecad-automation` and `origin` remote `https://github.com/dooosp/freecad-automation.git`, even though the worktree directory basename differs
- `origin/master` at `75acc9fd656f0462c5d3f80467da097a9fe04a77` is the discoverable default-branch pin at task start
- the current task branch is `feat/drawing-qa-gates` at `379d0063b542f2adb641d8a773827f1dae33e9da`
- `tests/output-contract-cli.test.js` is a known unrelated pre-existing failure and should be reported, not repaired, unless this task is forced onto that path
