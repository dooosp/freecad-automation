# Output Manifest Foundation

## Goal

Add a unified output-manifest layer for major `fcad` commands so a run can trace one input to all produced outputs, linked sidecars, runtime context, git context, warnings, and failure state without replacing the existing artifact-manifest contract.

## Planned scope

- add `lib/output-manifest.js` plus any required schema/helper support
- integrate automatic output-manifest emission for `create`, `draw`, `dfm`, `fem`, `tolerance`, `report`, and `inspect`
- keep existing CLI behavior and legacy manifest surfaces intact
- write manifests on failure when safe, including partial outputs and error summaries
- add non-FreeCAD helper tests and a non-FreeCAD CLI integration test
- update docs for naming, purpose, and example JSON

## Working assumptions

- the existing `artifact-manifest` contract remains documented and tested, so the new output manifest should be additive
- `origin/master` at `75acc9fd656f0462c5d3f80467da097a9fe04a77` is the pinned base for this task worktree
- the selected task repo root is the dedicated output-manifest-foundation worktree for `freecad-automation`
