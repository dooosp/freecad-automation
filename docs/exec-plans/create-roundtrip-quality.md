# Create Roundtrip Quality

## Goal

Add additive post-export quality checks for `fcad create` so STEP, STL, BREP, and related model metadata are validated after export and summarized in a machine-readable quality report without replacing existing create outputs or manifest surfaces.

## Planned scope

- add a reusable create-quality helper that compares create metadata with runtime-backed re-import/inspection results
- emit `<base>_create_quality.json` for default create runs when quality analysis can be evaluated honestly
- expose an explicit `--strict-quality` mode that fails only on blocking create-quality findings
- link the quality report through the existing output manifest and nearest manifest extension points
- cover threshold logic, status aggregation, missing artifact handling, strict-mode behavior, and runtime-unavailable fallback with non-FreeCAD tests
- extend runtime smoke and docs only where needed to prove the shipped behavior

## Working assumptions

- the existing `output-manifest` helper and schema from `output-manifest-foundation` are the only manifest layer touched in this task
- `origin/master` currently resolves to `75acc9fd656f0462c5d3f80467da097a9fe04a77`
- this task worktree root is `/Users/jangtaeho/worktrees/freecad-automation-create-roundtrip-quality`
- repo identity is proved by `package.json` name `freecad-automation` and `origin` URL `https://github.com/dooosp/freecad-automation.git`, even though the linked worktree directory basename differs from the canonical repo basename
- known pre-existing failure to classify, not fix unless directly touched:
  - `tests/output-contract-cli.test.js` currently expects `readiness-report.json`, while current code emits `input.readiness-report`
