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

## Repo Identity And Task Control
- Before creating task control files or editing implementation files, print and record:
  - `pwd`
  - `git rev-parse --show-toplevel`
  - `git branch --show-current`
  - local vs worktree mode when available
- Detect the default branch from git metadata instead of assuming it.
- Verify the git root basename is `freecad-automation`.
- Verify implementation files and task control files live under the same git repo root.
- Capture and report:
  - `git status --short`
  - `git diff --name-only`
- If the target repo checkout is dirty and worktrees are available, create a clean task worktree and continue there.
- If repo identity or same-root verification fails, stop without editing implementation files.

## Dirty-Tree Discipline
- Prefer a clean task worktree over working in a dirty checkout.
- Never create task control files outside the detected git repository root.
- Keep temporary task status files under `tmp/codex/`.
- Do not commit temp status files unless the active task or repo convention explicitly requires it.

## Read-Only Review Diff Invariance
- For final read-only review, capture `git diff --name-only` immediately before and after the review.
- If the diff changes during the read-only review, report the review as invalid and do not claim merge readiness.

## AF1 Task: Review Execution Contract
- Active branch for this task: `feat/af1-execution-contract`
- Preferred clean worktree for this task: `/Users/jangtaeho/Documents/New/.worktrees/af1-execution-contract/freecad-automation`
- Execution plan source of truth:
  - `docs/exec-plans/af1-execution-contract.md`
- Verification and remediation plan:
  - `docs/exec-plans/af1-execution-contract-verification.md`
- Phase status files:
  - `tmp/codex/af1-execution-contract-status.md`
  - `tmp/codex/af1-execution-contract-verification-status.md`
- Preserve the canonical JSON-first path centered on:
  - `review_pack.json`
  - `readiness-pack`
  - `readiness-report --review-pack`
  - `readiness_report.json`
- Treat A+F as the execution, tracking, reopen, and artifact re-entry surface.
- Do not recreate D or C scoring, reasoning, or linkage logic in A+F.
- Fail closed on missing lineage, schema mismatch, or invalid artifact handoff.
- Preserve intentionally supported legacy compatibility paths without promoting them over the canonical JSON-first flow.

## AF2 Task: Job Platform For D/C Continuation
- Active branch for this task: `feat/af2-job-platform`
- Preferred clean worktree for this task: `/Users/jangtaeho/Documents/New/.worktrees/af2-job-platform/freecad-automation`
- Execution plan source of truth:
  - `docs/exec-plans/af2-job-platform.md`
- Verification and remediation plan:
  - `docs/exec-plans/af2-job-platform-verification.md`
- Phase status files:
  - `tmp/codex/af2-job-platform-status.md`
  - `tmp/codex/af2-job-platform-verification-status.md`
- Extend the shared jobs/API/run platform so these tracked job types execute, download, reopen, and continue through the same platform surface:
  - `review-context`
  - `compare-rev`
  - `readiness-pack`
  - `stabilization-review`
  - `generate-standard-docs`
  - `pack`
- Preserve the canonical JSON-first path centered on:
  - `review_pack.json`
  - `readiness_report.json`
- Keep A+F orchestration-first:
  - do not reimplement D reasoning, scoring, or linkage
  - do not reimplement C readiness synthesis inside API or jobs
- Prefer thin adapters, durable metadata, and lineage-preserving artifact routing over duplicated business logic.
- Preserve fail-closed behavior for:
  - missing readiness input
  - lineage mismatch
  - schema mismatch
  - invalid canonical artifact handoff
- Where the existing repository architecture already supports it, allow canonical artifact and bundle re-entry without shell-first operation.

## AF3 Task: Studio Review-First Console
- Active branch for this task: `feat/af3-studio-review-console`
- Preferred clean worktree for this task: `/Users/jangtaeho/Documents/New/.worktrees/af3-studio-review-console/freecad-automation`
- Execution plan source of truth:
  - `docs/exec-plans/af3-studio-review-console.md`
- Verification and remediation plan:
  - `docs/exec-plans/af3-studio-review-console-verification.md`
- Phase status files:
  - `tmp/codex/af3-studio-review-console-status.md`
  - `tmp/codex/af3-studio-review-console-verification-status.md`
- Keep Studio preferred on `/` and `/studio`, but reposition it as a review/decision console instead of a modeling-first workspace.
- Preserve the legacy viewer as a compatibility path without presenting it as a peer-primary browser surface.
- Preserve route paths, tracked-job behavior, preview-versus-tracked separation, artifact links, queue controls, and lineage-safe artifact re-entry unless a narrow execution-plan change explicitly requires more.
- Prefer information architecture, CTA order, navigation, disclosure, and orchestration updates over speculative visual rewrites.
- Keep browser-visible English and Korean copy aligned through the existing lightweight locale layer with English fallback.
- Wire to real tracked execution capabilities where available:
  - `review-context`
  - `compare-rev`
  - `readiness-pack`
  - `stabilization-review`
  - `generate-standard-docs`
  - `pack`
- Do not recreate D/C scoring, linkage, or reasoning logic in the browser UI. Surface canonical artifacts, statuses, and follow-up actions instead.

## Task: Local API Server Route Modularization
This section augments the existing repo guidance above and preserves it. For this task, the execution plan in `docs/exec-plans/local-api-server-modularization.md` is the task-specific source of truth, while the standing repo safety and reviewability rules remain in force.

### Purpose
- Split `src/server/local-api-server.js` into route modules and focused helpers while keeping the public local-API contract stable and reviewable.

### Repo Identity And Control-Plane Safety
- Record `pwd`, `git rev-parse --show-toplevel`, `git branch --show-current`, and local versus worktree mode before creating task control files or editing implementation files.
- Verify the git root basename is `freecad-automation`.
- Keep all control files for this task inside the same detected repo root:
  - `AGENTS.md`
  - `docs/exec-plans/local-api-server-modularization.md`
  - `docs/exec-plans/local-api-server-modularization-verification.md`
  - `tmp/codex/local-api-server-modularization-status.md`
  - `tmp/codex/local-api-server-modularization-verification-status.md`
- If the target checkout is dirty, prefer a clean task worktree and continue there instead of editing the dirty checkout.

### Working Style
- Work autonomously and bias toward action after repo identity and diff discipline checks pass.
- Prefer repo search and existing tests over assumptions.
- Keep diffs small, scoped, and reviewable.
- Debug and repair failures before moving to the next phase.

### Scope Discipline
- Keep `createLocalApiServer` as the stable entrypoint.
- Preserve current route paths, payload shapes, status codes, and redaction behavior.
- Extract route modules and focused helpers for jobs, artifacts, studio preview routes, landing/static delivery, shared response helpers, and server boot composition.
- Extract static asset registry and landing payload helpers.
- Do not widen into CLI runtime changes or unrelated refactors.

### Existing Guidance Preservation
- Preserve repo-specific guidance already present in this file.
- Treat previously established browser and artifact-safety guidance as still applicable where those surfaces are touched.
- Keep English fallback and lightweight mechanisms already in the repo where browser-facing copy is involved.

### Verification Rules
- Read the relevant server files and related tests before editing.
- Use repo search to find contract-sensitive route strings and response helpers before changing code.
- Run the smallest relevant validation after each milestone when it materially exercises the touched surface.
- Run `npm run test:node:contract && npm run test:node:integration` before finalization.
- Do not claim runtime-backed smoke checks or browser interaction unless they actually ran.

### Dirty-Tree Discipline
- Capture `git status --short` and `git diff --name-only` before implementation.
- Stop on a dirty tree unless a clean worktree is created for the task.
- Do not commit temp status files unless explicitly asked.

### Progress Tracking
- Maintain:
  - `tmp/codex/local-api-server-modularization-status.md`
  - `tmp/codex/local-api-server-modularization-verification-status.md`
- Update the implementation status file after each execution-plan phase with repo identity, diff snapshot, current phase, completed work, files changed, validations run, failures or findings, repairs, and remaining risks.
- Update the verification status file after each verification-plan phase with the same categories plus claim-audit findings.

### Read-Only Review Discipline
- Capture `git diff --name-only` immediately before and after the final read-only review.
- Do not modify files during the read-only review.
- If the before and after diff snapshots differ, report the read-only review as invalid and do not claim merge readiness.

### Completion Criteria
- The task execution phases and verification phases are completed.
- `src/server/local-api-server.js` is reduced to stable entrypoint and server boot composition responsibilities plus any narrow compatibility glue that still belongs there.
- Route paths, response shapes, status codes, artifact redaction, and landing payload behavior remain backward compatible.
- Validation commands relevant to the touched surfaces pass or any remaining gaps are clearly reported.

### Final Response Format
- Include:
  1. concise summary of what changed
  2. repo identity used for the task
  3. architecture and implementation decisions
  4. changed files grouped by surface
  5. tests and checks actually run
  6. pre-existing diff or dirty-tree notes
  7. remaining gaps and why they remain
  8. commit hashes/messages if commits were made
  9. whether the branch was pushed
  10. remaining risks or recommended follow-ups
