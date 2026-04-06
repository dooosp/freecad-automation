# Job Store Atomic Write Fix

## Goal
Extract only the verified `job.json` atomic write and job listing race fix from the broader uncommitted metadata-manifest workspace.

## Scope
- Work only in the clean `fix/job-store-atomic-write` worktree.
- Inspect the dirty `refactor/metadata-manifests` checkout read-only to identify the minimal bugfix slice.
- Limit implementation to the `job.json` persistence path and the smallest regression coverage needed to prove listing stability.

## Out Of Scope
- Command manifest changes
- Lane manifest changes
- Package script changes
- CLI help or browser copy refactors
- Any metadata-manifest single-source refactor beyond the verified atomic write fix

## Files To Inspect First
- `src/services/jobs/job-store.js`
- `src/services/jobs/job-executor.js`
- `src/server/local-api-server.js`
- `tests/local-api-server.test.js`
- `tests/job-queue-controls.test.js`
- `tests/af-execution-jobs.test.js`

## Planned Phases
1. Preflight and isolate the minimal bugfix from the dirty sibling workspace.
2. Implement atomic `job.json` writes and add a narrow regression test for list/read stability.
3. Run the narrow regression plus required validation commands.
4. Perform a read-only diff invariance review, then commit and push if all validations pass.
