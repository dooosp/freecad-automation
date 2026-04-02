# AF5 Verification And Remediation

## Purpose
- Verify that AF1 through AF4 now behave as one coherent review-first execution and reopen surface.
- Audit claimed behavior against actual diffs, code paths, and executed validations.
- Fix safe verified issues immediately instead of only reporting them.

## Verification Scope
- AF execution contract helpers and lineage validation
- Job store persistence, manifest visibility, and recent-run history
- Local API responses for tracked jobs and artifacts
- Studio artifact actions, viewers, and job translation
- Canonical readiness/docs/pack handoff
- Representative runtime smoke where the environment supports it

## Verification Steps
1. Re-read the touched files and confirm each change is scoped to a verified AF integration gap.
2. Compare claimed affected surfaces against the actual diff.
3. Run the smallest strong tests for the touched surfaces.
4. Run the repo-advertised Node contract and integration lanes.
5. Run runtime smoke if the current machine supports the repo-owned runtime path.
6. Capture `git diff --name-only` before the read-only final review.
7. Perform a read-only review only; do not edit during that pass.
8. Capture `git diff --name-only` again after the review.
9. If the diff changed during the read-only review, report the review as invalid and do not claim merge readiness.

## Expected AF5 Checks
- `node tests/af-execution-contract.test.js`
- `node tests/af-execution-jobs.test.js`
- `node tests/job-api.test.js`
- `node tests/local-api-server.test.js`
- `node tests/local-api.integration.test.js`
- `node tests/c-artifact-schema.test.js`
- `npm run test:node:contract`
- `npm run test:node:integration`
- `npm run smoke:runtime`

## Remediation Guidance
- Prefer persistence and API-truth fixes over UX-only workarounds.
- Preserve canonical artifact names, lineage, and re-entry rules.
- Preserve D/C ownership of reasoning and synthesis.
- Do not widen scope into unrelated Studio, runtime, or i18n cleanup.
