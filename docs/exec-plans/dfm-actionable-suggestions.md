# DFM Actionable Suggestions

## Goal

Extend `fcad dfm` so every non-pass issue can carry actionable engineering guidance: severity, measurable actual/required values, delta, manufacturability impact, and a concrete suggested fix while preserving the existing `checks`, `summary`, and `score` compatibility surfaces.

## Planned scope

- enrich DFM rule results with additive issue fields such as `rule_id`, `rule_name`, `status`, `severity`, `actual_value`, `required_value`, `delta`, `manufacturability_impact`, `suggested_fix`, `confidence`, and `evidence`
- keep unavailable measurements explicit with `null` or `unknown` rather than inferred values
- preserve legacy DFM consumer access to `checks`, `summary`, and `score`, adding compatibility mapping only where needed
- improve summary output with severity counts and top recommended fixes
- add non-FreeCAD tests covering actionable issue generation and legacy compatibility
- update README and testing docs with the new DFM issue schema and one representative example

## Working assumptions

- the selected repo root is the task worktree for `feat/dfm-actionable-suggestions`
- repo identity is proven by `package.json` name `freecad-automation` and `origin` remote `https://github.com/dooosp/freecad-automation.git`, even though the worktree directory basename differs
- `origin/master` is the discoverable default branch at task start
- the current task branch is `feat/dfm-actionable-suggestions` at `1bcde6cc364e665266fbb9a9dc83fd01ab96a59a`
- `lib/output-manifest.js`, `lib/create-quality.js`, and `src/services/drawing/drawing-quality-summary.js` are present, so the prerequisite work is available on this branch
- `tests/output-contract-cli.test.js` remains a known unrelated pre-existing failure unless this task is forced onto that contract path
