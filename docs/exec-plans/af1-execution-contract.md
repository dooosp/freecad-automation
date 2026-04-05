# AF1 Execution Contract And Artifact Re-entry

## Objective
- Freeze one shared execution and artifact contract for the review-first A+F operating surface.
- Make A+F consume and route D/C artifacts for execution, tracking, reopen, and re-entry without recomputing D/C internals.
- Preserve the canonical JSON-first path centered on:
  - `review_pack.json`
  - `readiness-pack`
  - `readiness-report --review-pack`
  - `readiness_report.json`
- Fail closed on missing lineage, schema mismatch, or invalid artifact handoff.

## Repo Identity
- Expected git root basename: `freecad-automation`
- Default branch: detect from git metadata
- Task branch: `feat/af1-execution-contract`
- Task worktree: `../.worktrees/af1-execution-contract/freecad-automation` relative to the parent workspace that contains this repo checkout

## Scope
- Define a single shared execution and artifact contract for:
  - `review-context`
  - `compare-rev`
  - `readiness-pack`
  - `stabilization-review`
  - `generate-standard-docs`
  - `pack`
- Standardize lifecycle states:
  - `queued`
  - `running`
  - `succeeded`
  - `failed`
  - `canceled`
- Standardize artifact identity fields:
  - artifact type
  - schema version
  - source artifact refs
  - warnings
  - coverage
  - confidence
  - lineage markers
  - compatibility markers
- Lock explicit A+F re-entry targets to:
  - `review_pack.json`
  - `readiness_report.json`
  - `release_bundle.zip`

## Constraints
- Preserve D as the decision engine and C as the production-readiness/package layer.
- Keep A+F focused on orchestration, tracking, reopen, and artifact routing.
- Do not recreate D/C scoring, reasoning, or linkage logic in A+F.
- Preserve canonical artifact names and existing intentionally supported compatibility paths.
- Prefer adapters, shared types, and validators over broad rewrites.
- Keep changes scoped and reviewable.

## Phase -1: Repo identity preflight and dirty-tree isolation
- Record:
  - `pwd`
  - `git rev-parse --show-toplevel`
  - `git branch --show-current`
  - local vs worktree mode
  - detected default branch
  - `git status --short`
  - `git diff --name-only`
- Verify repo identity, same-root control-file placement, and clean task isolation.

## Phase 0: Discovery and contract design brief
- Inspect the real implementation files for:
  - CLI commands for review, readiness, docs, pack, and compare flows
  - local API server and job endpoints
  - job executor, job store, run history, manifests, and logs
  - artifact manifests, schema types, and canonical artifact naming
  - review pack, readiness report, release bundle, and Studio/shared contracts
- Write down the narrow contract seams to introduce and the compatibility edges to preserve.

## Phase 1: Shared types, schemas, and validators
- Add or extend shared execution and artifact contract types.
- Add contract validation helpers for job kinds, lifecycle states, artifact identity, lineage, and re-entry eligibility.
- Make missing lineage, schema mismatch, or invalid artifact handoff machine-readable failures where possible.

## Phase 2: CLI, API, and job-surface wiring
- Route the shared contract through CLI, local API, and job tracking surfaces.
- Keep execution surfaces orchestration-first and avoid pushing D/C logic upward into A+F.
- Preserve current queue-control and tracked-job behavior unless a narrow contract fix is required.

## Phase 3: Canonical artifact recognition and re-entry rules
- Centralize canonical artifact recognition for:
  - `review_pack.json`
  - `readiness_report.json`
  - `release_bundle.zip`
- Make reopen and re-entry flows validate lineage and compatibility before accepting artifacts.
- Preserve already intentional legacy compatibility paths only where they are already supported.

## Phase 4: Contract gap audit and narrow remediation
- Audit touched CLI, API, job, and artifact surfaces for missed contract gaps.
- Remediate verified task-local issues only.
- Avoid unrelated refactors.

## Phase 5: Final validation, verification/remediation, read-only final review, and git finalize
- Run the smallest strong validation set discovered from the repo and CI-relevant paths.
- Execute the verification/remediation plan after implementation.
- Perform a read-only final review with pre/post `git diff --name-only` capture.
- Create one scoped commit, push if possible, and attempt a clean merge into the detected default branch if policy and permissions allow.
