# AGENTS.md

## Purpose
- This file provides repo-local guidance for Codex work in `freecad-automation`.
- Source of truth is always the repository state: `git status`, diffs, tests, artifacts, and PR state.
- When a task has a matching plan under `docs/exec-plans/`, treat that plan as the task-specific source of truth.

## Repo Preflight
- Before implementation or review work, record:
  - `pwd`
  - `git rev-parse --show-toplevel`
  - `git branch --show-current`
  - `git rev-parse HEAD`
  - default branch, if discoverable from git metadata
- Verify the git root basename is `freecad-automation`.
- If the checkout is dirty and the task needs isolation, prefer a clean worktree.

## Working Style
- Work autonomously and bias toward action after repo identity is confirmed.
## Task addendum: freecad-studio-redesign-v3
For this task, follow:
- `docs/exec-plans/freecad-studio-redesign-v3.md`

Treat that execution plan as the task-specific source of truth for the Studio redesign worktree.

### Task-specific frontend constraints
- Goal: redesign the five browser Studio surfaces to share one premium dark CAD/SaaS system modeled on the provided console SVG while preserving runtime behavior.
- Scope surfaces:
  - Console
  - Review
  - Package / Artifacts
  - Model
  - Drawing
- Non-negotiables:
  - preserve routes, data flow, local API connection logic, runtime checks, and state handling
  - preserve Korean UI support through the existing shared locale mechanism
  - keep diffs scoped to browser-facing Studio shell, styles, and workspace renderers
  - prefer shared tokens and reusable rendering patterns over one-off page styling
  - do not widen into backend rewrites unless a small UI compatibility fix is strictly required
- Validation baseline:
  - `npm test`
  - `npm run serve`
  - browser smoke checks for Console, Review, Package, Model, and Drawing
- Progress tracking files for this task:
  - `tmp/codex/freecad-studio-redesign-v3-status.md`
  - `tmp/codex/freecad-studio-redesign-v3-tool-evidence.md`
  - `tmp/codex/freecad-studio-redesign-v3-verification-status.md`
- Verification/remediation plan for this task:
  - `docs/exec-plans/freecad-studio-redesign-v3-verification.md`
- Prefer repo search and existing tests over assumptions.
- Keep diffs small, scoped, and reviewable.
- Do not widen scope into unrelated refactors.
- If a check fails, debug, repair, and continue when safe.

## Architecture Guardrails
- Preserve the Node CLI + Python runner + FreeCAD runtime structure unless a task explicitly requires a narrow compatibility change.
- Treat machine-readable JSON artifacts as canonical; markdown and PDF outputs are downstream views.
- When touching the analysis stack, preserve the additive direction:
  - `adapters -> geometry -> linkage -> decision -> reporting`
- Prefer deterministic heuristics, stable reason codes, and auditable evidence refs over opaque AI-only logic.
- Preserve metadata-only fallback behavior when runtime-backed FreeCAD inspection is unavailable.

## Browser And UX Guardrails
- Keep browser-visible locale behavior lightweight with safe English fallback.
- Do not introduce a heavy i18n framework unless the task explicitly requires it.
- Preserve existing route paths, public command names, and browser-entry compatibility unless a task requires a compatibility wrapper.

## Manufacturing And Portfolio Positioning
- Position manufacturing materials as DELMIA-adjacent learning and portfolio assets unless proven otherwise.
- Do not claim official DELMIA or 3DEXPERIENCE integration unless it already exists and is verified.
- Keep manufacturing review outputs auditable and frame recommendations as guidance, not verified engineering truth.

## Validation And Review
- Read the relevant files before editing.
- Run the smallest relevant validations after each milestone.
- Do not claim tests, browser checks, runtime checks, or external-tool interaction unless they actually ran.
- For read-only final review, capture `git diff --name-only` immediately before and after the review. If the diff changes, report the review as invalid.

## Temporary Files
- Keep task status or verification notes under `tmp/codex/`.
- Do not commit temporary task-status files unless explicitly asked or the task specifically requires them to be versioned.

## Final Reporting
- Summarize what changed, what was validated, any remaining risks, and the commit/push/PR state.

## Task addendum: output-manifest-foundation
For this task, follow:
- `docs/exec-plans/output-manifest-foundation.md`

Treat that execution plan as the task-specific source of truth for this worktree.

### Task-specific manifest constraints
- Goal: add an additive `output-manifest` layer for major `fcad` commands without replacing the existing `artifact-manifest` contract.
- Scope surfaces:
  - CLI orchestration
  - output file tracking
  - run metadata
  - manifest writer helper
  - tests and docs
- Non-negotiables:
  - preserve existing output filenames unless additive manifest files are required by the new contract
  - keep `artifact-manifest` behavior backward compatible
  - do not claim FreeCAD-backed validation unless a real runtime command actually ran
  - keep control files inside this repo root only
- Progress tracking files for this task:
  - `tmp/codex/output-manifest-foundation-status.md`
  - `tmp/codex/output-manifest-foundation-tool-evidence.md`
- `tmp/codex/output-manifest-foundation-verification-status.md`
- Verification/remediation plan for this task:
  - `docs/exec-plans/output-manifest-foundation-verification.md`

## Task addendum: create-roundtrip-quality
For this task, follow:
- `docs/exec-plans/create-roundtrip-quality.md`

Treat that execution plan as the task-specific source of truth for this worktree.

### Task-specific create quality constraints
- Goal: add additive STEP/STL/BREP round-trip quality checks after `fcad create` without replacing the shipped output-manifest helper.
- Scope surfaces:
  - `create` CLI orchestration
  - model export validation
  - inspect/runtime reuse
  - create quality JSON output
  - tests and docs
- Non-negotiables:
  - preserve existing create outputs and filenames
  - keep default `create` behavior warning-oriented; only explicit strict quality mode may fail the command
  - do not claim geometry validation passed unless the runtime actually re-imported or inspected the exported files
  - reuse `lib/output-manifest.js` and `schemas/output-manifest.schema.json`; do not create a second manifest system
  - keep control files inside this repo root only
- Progress tracking files for this task:
  - `tmp/codex/create-roundtrip-quality-status.md`
  - `tmp/codex/create-roundtrip-quality-tool-evidence.md`
  - `tmp/codex/create-roundtrip-quality-verification-status.md`
- Verification/remediation plan for this task:
  - `docs/exec-plans/create-roundtrip-quality-verification.md`

## Task addendum: drawing-qa-gates
For this task, follow:
- `docs/exec-plans/drawing-qa-gates.md`

Treat that execution plan as the task-specific source of truth for this worktree.

### Task-specific drawing QA constraints
- Goal: strengthen draw QA gates and add a unified additive drawing quality summary without replacing existing draw outputs or manifest contracts.
- Scope surfaces:
  - `fcad draw`
  - draw QA aggregation
  - plan validation integration
  - generated JSON summaries
  - tests and docs
- Non-negotiables:
  - preserve the existing TechDraw/SVG generation pipeline unless a narrow compatibility hook is required
  - keep existing draw sidecars intact; add the unified drawing-quality JSON additively
  - default draw behavior must remain warning-friendly; strict failure should only happen through explicit strict-quality behavior
  - do not claim runtime-backed drawing validation unless a real draw command ran on this machine
  - keep control files inside this repo root only
- Known upstream issue:
  - `configs/examples/ks_bracket.toml` currently yields a create-quality failure because the generated model shape is invalid even though STEP round-trip and STL checks pass; treat that as upstream unless this task needs a tiny compatibility hook
- Known pre-existing failure:
  - `tests/output-contract-cli.test.js` currently expects `readiness-report.json` while the code emits `input.readiness-report`; do not fix it here unless this task directly requires that contract
- Progress tracking files for this task:
  - `tmp/codex/drawing-qa-gates-status.md`
  - `tmp/codex/drawing-qa-gates-tool-evidence.md`
  - `tmp/codex/drawing-qa-gates-verification-status.md`
- Verification/remediation plan for this task:
  - `docs/exec-plans/drawing-qa-gates-verification.md`

## Task addendum: dfm-actionable-suggestions
For this task, follow:
- `docs/exec-plans/dfm-actionable-suggestions.md`

Treat that execution plan as the task-specific source of truth for this worktree.

### Task-specific DFM constraints
- Goal: make non-pass `fcad dfm` checks actionable by adding severity, measurable values, manufacturability impact, and concrete fix guidance without replacing the existing DFM `checks`, `summary`, or `score` surfaces.
- Scope surfaces:
  - `fcad dfm`
  - Python DFM checker output
  - Node CLI compatibility mapping
  - DFM summary/reporting
  - tests and docs
- Non-negotiables:
  - preserve existing DFM coverage and legacy top-level fields unless an additive compatibility wrapper is required
  - do not invent exact part/feature locations when the checker cannot measure them
  - use `null` or `unknown` for unavailable evidence instead of guessing
  - keep default DFM exit-code behavior unchanged unless an existing strict path is explicitly used
  - reuse the shipped output-manifest conventions; do not create a second manifest or quality-report system
  - keep control files inside this repo root only
- Known upstream issue:
  - `configs/examples/ks_bracket.toml` currently yields a create-quality failure because the generated model shape is invalid even though STEP round-trip and STL checks pass; do not fix geometry generation or create-quality internals in this task
- Known upstream issue:
  - `configs/examples/ks_bracket.toml` currently yields a drawing-quality failure because of missing required intent `HOLE_DIA`, dimension conflicts, and low traceability coverage; do not fix drawing QA internals in this task
- Known pre-existing failure:
  - `tests/output-contract-cli.test.js` has a readiness provenance mismatch; do not fix it here unless this task directly requires that contract
- Progress tracking files for this task:
  - `tmp/codex/dfm-actionable-suggestions-status.md`
  - `tmp/codex/dfm-actionable-suggestions-tool-evidence.md`
  - `tmp/codex/dfm-actionable-suggestions-verification-status.md`
- Verification/remediation plan for this task:
  - `docs/exec-plans/dfm-actionable-suggestions-verification.md`
