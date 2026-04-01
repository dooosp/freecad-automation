# AGENTS.md

## Purpose
This repository uses Codex for scoped, reviewable engineering tasks.
For complex browser-facing UI changes, follow the execution plan in:
- `docs/exec-plans/browser-i18n-rollout.md`

Codex should treat this file as persistent project guidance and the execution plan as the task-specific source of truth.

## Working style
- Work autonomously and bias toward action.
- Prefer repo search over assumptions.
- Do not stop for interim approval unless truly blocked.
- Keep diffs small, scoped, and reviewable.
- Do not widen scope into unrelated refactors.
- If something fails, debug, repair, and continue.
- Final reply only after the assigned work is complete.

## Browser-facing i18n constraints
- This rollout is for browser-facing UI only.
- Translate browser-visible text only:
  - document and page titles
  - headings
  - labels
  - buttons
  - badges
  - helper text
  - empty states
  - summaries
  - status messages
  - notices
  - accessibility labels
  - server-rendered browser help/info copy
- Keep internal identifiers in English unless a display wrapper is clearly safer:
  - code identifiers
  - endpoint names
  - route paths
  - schema keys
  - JSON keys
  - CLI command names
  - test IDs
  - variable names
- Keep runtime behavior unchanged except where needed for locale selection and translated browser copy.
- Missing i18n keys must fall back safely to English.
- Do not introduce a heavy i18n framework.

## Locale expectations
- Support both English and Korean.
- Use English as the fallback locale.
- Prefer one obvious centralized place for browser-visible copy.
- Keep technical identifiers such as `job_id`, route paths, and raw API keys unchanged unless only the surrounding visible label is being localized.

## Verification expectations
- Read the relevant files before editing.
- Use repo search to find related browser-visible strings before changing code.
- Run the smallest relevant validations after each milestone.
- Repair failures before moving to the next milestone.
- Do not claim browser interaction unless it actually ran.
- Do not claim tests passed unless they were actually executed.

## Progress tracking
Maintain:
- `tmp/codex/browser-i18n-status.md`

Update it after each phase with:
- current phase
- completed work
- files changed
- validations run
- failures encountered
- repairs made
- open risks
- remaining work

Do not commit this status file unless explicitly asked.

## Completion criteria
Done means:
- the execution plan phases assigned for this task are completed,
- relevant browser-facing surfaces support English and Korean through the shared locale mechanism,
- English fallback works safely,
- touched validations pass or any gaps are clearly reported,
- leftover English browser-visible strings are audited and explained if intentionally preserved.

## Final response format
The final response should include:
1. concise summary of what changed
2. locale architecture and persistence strategy
3. changed files grouped by surface
4. tests/checks run
5. leftover English browser-visible strings and why they remain
6. commit hashes/messages if commits were made
7. whether the branch was pushed
8. remaining risks or follow-up suggestions

## Follow-up verification and remediation tasks
- For post-implementation verification work, follow:
  - `docs/exec-plans/browser-i18n-verification-remediation.md`
- Do not stop for interim approval unless truly blocked.
- Audit claimed localized surfaces against actual touched files.
- If a previously claimed browser-facing surface was not actually localized, either:
  - fix it, or
  - clearly correct the report
- If any temp/status file was created outside the repo, report it clearly and create the correct in-repo temp file.
- Do not claim browser automation or manual browser QA unless it actually ran.
- Prefer fixing small verified issues immediately rather than only reporting them.
- If no code changes are needed after verification, do not create an empty commit.

## Repo-local task family: D pipeline
- For D-pipeline contract work, keep machine-readable JSON artifacts canonical and schema-backed.
- Prefer narrow validation seams shared by CLI and reporting code over broad architectural rewrites.
- Standardize common D artifact contract fields where applicable:
  - `schema_version`
  - `analysis_version`
  - `generated_at`
  - `part_id`
  - `revision`
  - `warnings`
  - `coverage`
  - `confidence`
  - `source_artifact_refs`
- For ingest normalization tasks, keep `scripts/ingest_context.py` orchestration-first and move normalization into adapter-layer helpers.
- Preserve the additive architecture direction: adapters -> geometry -> linkage -> decision -> reporting.
- Treat machine-readable JSON as canonical; keep markdown or PDF output concerns downstream.
- Do not move decision logic into ingest and do not introduce LLM-based normalization.
- Preserve metadata-only fallback behavior when FreeCAD runtime is unavailable.
- Keep downstream D1-facing fields backward compatible; additive normalized evidence fields and diagnostics are preferred over shape-breaking changes.
- Preserve the additive architecture direction: adapters -> geometry -> linkage -> decision -> reporting.
- Keep `scripts/analyze_part.py` orchestration-first; move geometry facts, entity indexing, and reason code logic into focused helpers.
- Treat machine-readable JSON geometry artifacts as canonical; keep markdown/PDF review output downstream.
- Prefer additive output expansion over contract-breaking renames. Keep legacy `metrics`, `features`, and hotspot category compatibility where safe while introducing richer geometry-facts and stable hotspot fields.
- Do not introduce LLM-based decision logic. Use explicit reason codes, stable refs, evidence refs, and auditable heuristics.
- Preserve metadata-only fallback behavior when FreeCAD runtime or STEP-derived helpers are unavailable.
- For linkage and decision tasks:
  - keep linkage and decision logic separate
  - prefer hotspot-level evidence mapping over category-only aggregation when auditable traceability is required
  - keep ambiguity visible in output fields instead of silently collapsing to a single match
  - favor small, focused tests around linkage ambiguity, scoring breakdowns, and false-positive regressions
- Maintain repo-local execution and verification plans under `docs/exec-plans/` and phase status files under `tmp/codex/` for the active task slug.

## D Integration Task
- Active branch for this task: `feat/d-integration`
- Integration worktree for this task: `/Users/jangtaeho/Documents/New/freecad-automation-d-integration`
- Preserve the D1 -> D5 evolution while integrating the five completed D phase commits in order.
- Keep the Node CLI + Python runner + FreeCAD structure intact.
- Keep canonical JSON artifacts, including `review_pack.json` as the source of truth.
- Preserve `evidence_refs`, `reason_codes`, hotspot-oriented scoring, and metadata-only fallback behavior.
- Do not widen scope into browser, i18n, or Studio tasks during this integration.
- Track merge progress in `tmp/codex/d-integration-merge-status.md`.
- Track verification and remediation in `tmp/codex/d-integration-merge-verification-status.md`.
