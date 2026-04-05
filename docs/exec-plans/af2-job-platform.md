# AF2 Job Platform For D/C Continuation

## Objective
- Extend the shared A+F jobs/API/run platform so D/C-centered workflows can execute, track, download, reopen, and continue without shell-first operation.
- Keep the platform layer centered on canonical artifacts instead of reimplementing D/C business logic.
- Preserve the canonical path around:
  - `review_pack.json`
  - `readiness_report.json`

## Repo Identity
- Expected git root basename: `freecad-automation`
- Default branch: detect from git metadata
- Task branch: `feat/af2-job-platform`
- Preferred worktree: `../.worktrees/af2-job-platform/freecad-automation` relative to the parent workspace that contains this repo checkout

## Scope
- Shared platform job coverage:
  - `review-context`
  - `compare-rev`
  - `readiness-pack`
  - `stabilization-review`
  - `generate-standard-docs`
  - `pack`
- Shared platform surfaces:
  - job executor and registry
  - job store and run history
  - local API request/response wiring
  - artifact manifests, logs, and download surfaces
  - reopen/rerun from tracked artifacts
  - canonical bundle import recognition where the repo already supports it

## Constraints
- Do not recreate D reasoning, scoring, or linkage inside jobs or API.
- Do not recreate C readiness synthesis outside the existing canonical builders/workflows.
- Preserve `generate-standard-docs` fail-closed behavior for missing readiness input or lineage mismatch.
- Prefer thin orchestration adapters and durable metadata over new domain logic.
- Keep diffs narrow and reviewable.

## Phase -1: Repo/base preflight
- Record:
  - `pwd`
  - `git rev-parse --show-toplevel`
  - `git branch --show-current`
  - local vs worktree mode
  - detected default branch
  - `git status --short`
  - `git diff --name-only`
- Verify repo basename, same-root control files, and clean worktree isolation.
- Resolve base branch policy:
  - use default branch if AF1 is already merged
  - otherwise base from `feat/af1-execution-contract` when it exists

## Phase 0: Discovery and execution-path map
- Inspect the concrete files for:
  - job executor and job store
  - local API server, schemas, and tracked-job bridge
  - artifact manifests, download routes, and public redaction
  - release bundle workflow and canonical artifact helpers
  - Studio/browser artifact re-entry seams
- Capture the narrow gaps between AF1 contract coverage and AF2 continuation behavior.

## Phase 1: Executor and job-registry wiring
- Verify the shared executor and request validation accept all AF2 job kinds.
- Add any missing thin adapters needed for canonical artifact or bundle re-entry.
- Keep manifests, logs, and job results coherent when re-entry is artifact-backed or bundle-backed.

## Phase 2: API and run-history wiring
- Route AF2 continuation through the local API/browser-safe tracked-job surface where already supported.
- Preserve coherent run history, retry lineage, request redaction, and capability reporting.
- Keep download/open surfaces consistent for canonical artifacts and derived manifests.

## Phase 3: Artifact reopen/rerun and bundle recognition
- Allow canonical artifact re-entry for:
  - `review_pack.json`
  - `readiness_report.json`
- Auto-detect canonical artifacts inside `release_bundle.zip` only where the repository architecture already supports the handoff.
- Fail closed on lineage mismatch, schema mismatch, or unsupported bundle content.

## Phase 4: Audit and minimal remediation
- Audit touched executor, API, and browser re-entry surfaces for missed AF2 gaps.
- Fix only verified task-local issues.
- Avoid unrelated Studio or runtime refactors.

## Phase 5: Final validation, verification/remediation, read-only review, and git finalize
- Run the strongest safe minimal tests for the changed platform surfaces.
- Execute `docs/exec-plans/af2-job-platform-verification.md`.
- Capture pre/post read-only review diffs and invalidate the review if the diff changes during review.
- Create one scoped commit, push if possible, and attempt a clean merge into the detected default branch when policy allows.
