# Job Store Atomic Write Fix Verification

## Verification Targets
- The store persists `job.json` through an atomic replace instead of direct in-place writes.
- Listing jobs tolerates concurrent writes without surfacing truncated or partially-written `job.json` files.
- Existing local API and queue-control behavior stays unchanged.

## Required Commands
1. Narrow regression test added or updated for this fix
2. `node tests/local-api-server.test.js`
3. `node tests/job-queue-controls.test.js`
4. `node tests/af-execution-jobs.test.js`

## Review Guardrails
- Capture `git diff --name-only` immediately before the final read-only review.
- Capture `git diff --name-only` again after the review.
- Treat the review as invalid if the diff changes during that read-only pass.
