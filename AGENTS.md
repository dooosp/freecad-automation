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
