# Single-Source Metadata Manifests

## Mission
Create a single source of truth for CLI command metadata and test lane metadata so help text, runtime classifications, local API references, package suites, and `docs/testing.md` stop drifting.

## Branching And Separation
- Active branch: `refactor/metadata-manifests-v2`
- Preferred clean worktree:
  - a fresh linked worktree checked out on `refactor/metadata-manifests-v2`
- Base this refactor on:
  - merged default branch if the atomic-write bugfix already landed, or
  - `fix/job-store-atomic-write` if the bugfix is still stacked
- Do not mix in unrelated job-store or server bugfix work beyond correct stacking.

## Scope
- CLI command names, help metadata, and runtime classification metadata
- local API and Studio job-type references that should align with command metadata
- package test and serve scripts
- `docs/testing.md`
- focused manifest modules and drift-guard tests introduced for this task

## Non-Negotiables
- Preserve existing command names and exit behavior.
- Preserve package script names.
- Keep `serve` mapped to `node bin/fcad.js serve`.
- Keep `serve:legacy` mapped to `node bin/serve-legacy.js`.
- Do not change runtime execution semantics.
- Keep diffs small, scoped, and reviewable.
- Keep README changes out of scope unless a tiny correction is strictly required for consistency.

## Key Files To Inspect First
- `src/shared/command-manifest.js`
- `tests/lane-manifest.js`
- `bin/fcad.js`
- `lib/runtime-diagnostics.js`
- `src/server/local-api-server.js`
- `src/server/local-api-schemas.js`
- `src/server/studio-job-bridge.js`
- `src/services/jobs/job-executor.js`
- `package.json`
- `docs/testing.md`
- `tests/run-node-lane.js`
- `tests/command-manifest.test.js`
- `tests/lane-manifest.test.js`
- `tests/local-api-server.test.js`
- `scripts/run-test-suite.js`

## Preflight
- Print and record:
  - `pwd`
  - `git rev-parse --show-toplevel`
  - `git branch --show-current`
  - local vs worktree mode when available
- Verify the git root basename is `freecad-automation`.
- Confirm whether the bugfix is merged into the default branch or whether this refactor is explicitly stacked on `fix/job-store-atomic-write`.
- Capture and record:
  - `git status --short`
  - `git diff --name-only`
- If the target checkout is dirty, create or switch to a fresh clean worktree before editing.

## Working Method
- Use repo search before editing.
- Prefer small focused manifest modules over broad refactors.
- Update `tmp/codex/single-source-metadata-manifests-status.md` after each phase.
- Run the smallest relevant validation after each milestone.
- Repair failures before moving to the next phase.

## Phase 0 Discovery
- Read `AGENTS.md`.
- Read this plan and the verification plan.
- Inspect the key files and search for duplicated command metadata, lane metadata, job-type lists, and serve entrypoint copy.
- Record current drift points between CLI help, runtime classifications, package scripts, docs, and local API copy.

## Phase 1 Foundation
- Introduce focused manifest modules for command metadata and lane metadata.
- Keep the metadata structures explicit and easy to audit.
- Add drift-guard tests for help, docs, and package script alignment.

## Phase 2 Primary Surfaces
- Rewire `bin/fcad.js` help and related command copy to the shared command manifest.
- Rewire runtime classification exports in `lib/runtime-diagnostics.js`.
- Rewire `tests/run-node-lane.js`, package suite scripts, and any focused suite runner to the lane manifest.

## Phase 3 Secondary Surfaces
- Update `docs/testing.md` so the lane tables and command blocks match the shared lane metadata.
- Update `src/server/local-api-server.js`, `src/server/local-api-schemas.js`, `src/server/studio-job-bridge.js`, and `src/services/jobs/job-executor.js` where exposed job-type references should align with shared metadata.
- Keep `serve` and `serve:legacy` guidance accurate and compatibility-safe.

## Phase 4 Audit And Remediation
- Audit touched files for leftover duplicated metadata or misleading copy.
- Search for drift between help, docs, package scripts, runtime classifications, and server job-type references.
- Fix only verified, safe, in-scope gaps.

## Phase 5 Finalize
- Run the validation set.
- Confirm status-file claims match the actual repo state.
- Record intentionally preserved leftovers and why they remain.
- Perform a read-only review with unchanged diff snapshots before and after the review.

## Validation Commands
- `node tests/command-manifest.test.js`
- `node tests/lane-manifest.test.js`
- `node tests/local-api-server.test.js`
- `node tests/run-node-lane.js contract`
- `node tests/run-node-lane.js integration`
- `node tests/serve-cli.test.js`
- `node bin/fcad.js --help`
- `node bin/fcad.js serve --help`
- inspect package-script mapping from `package.json`
- `npm run test:ci:hosted` if available in this environment

## Final Report Format
1. concise summary
2. repo identity used
3. manifest architecture decisions
4. changed files grouped by surface
5. tests/checks actually run
6. whether the branch is correctly separated from the bugfix
7. remaining gaps
8. commit hash / branch / push status
9. recommendation for PR scope and review order
