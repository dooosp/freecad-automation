# Local API Server Route Modularization Verification

## Mission
Verify that the restacked local API modularization matches the execution plan, preserves the public contract, and keeps all task control files and claims inside the intended repo root.

## Non-Negotiables
- Preserve `createLocalApiServer` as the stable public entrypoint.
- Preserve route paths, payload shapes, status codes, artifact headers, and redaction behavior.
- Do not treat the verification pass as permission for unrelated refactors.
- Fix only verified, narrow issues that are safe to remediate within task scope.
- Keep status tracking inside `tmp/codex/` and do not commit temp status files unless explicitly asked.

## Phase 0 Repo Control Verification
- Re-read `AGENTS.md` and this verification plan.
- Verify repo identity details recorded in the status files match the actual worktree used.
- Verify the task control files exist inside the same repo root:
  - `AGENTS.md`
  - `docs/exec-plans/local-api-server-modularization.md`
  - `docs/exec-plans/local-api-server-modularization-verification.md`
  - `tmp/codex/local-api-server-modularization-status.md`
  - `tmp/codex/local-api-server-modularization-verification-status.md`
- Capture the current diff snapshot before claim audit.

## Phase 1 Claim Audit
- Compare the execution plan against the actual changed files and code paths.
- Compare implementation status claims against:
  - actual changed files
  - actual route modules
  - actual helper modules
  - actual validations run
- Correct any over-claiming in status files or final notes.

## Phase 2 Leftover Gap Audit
- Search for leftover responsibility clumps in `src/server/local-api-server.js`.
- Confirm the requested split actually covers:
  - jobs
  - artifacts
  - studio preview routes
  - landing/static delivery
  - shared response helpers
  - server boot composition
- Identify any intentionally retained logic and explain why it remains.

## Phase 3 Runtime/Path Verification
- Verify route strings, response schema assertions, content headers, and redaction helpers still line up with current tests and code.
- Run or verify the requested smoke coverage for:
  - `/`
  - `/api`
  - `/studio`
  - `/jobs`
  - artifact open/download content disposition
- If runtime-backed manual smoke checks did not actually run, confirm the status files and final notes say so.
- Reconcile any mismatch between claimed validations and command history.

## Phase 4 Minimal Fixes
- Apply only verified narrow fixes needed to align code, claims, or status tracking with reality.
- Re-run only the smallest relevant validations after each fix.
- Update `tmp/codex/local-api-server-modularization-verification-status.md` with findings, repairs, and remaining risks.

## Phase 5 Final Report
- Capture `git diff --name-only` immediately before and after the final read-only review.
- If the diff changes during the read-only review, report the review as invalid and do not claim merge readiness.
- Record:
  - verified repo identity
  - diff snapshot
  - audited claims
  - validations actually run
  - fixes made during verification
  - remaining gaps or residual risks
