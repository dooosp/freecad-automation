# Single-Source Metadata Manifests Verification

## Mission
Verify that the metadata-manifest refactor landed in the intended repo and clean worktree, covers the claimed CLI, test-lane, package, and local API surfaces, and remains cleanly separated from the atomic-write bugfix concern except for intentional stacking.

## Non-Negotiables
- Preserve existing command names and exit behavior.
- Preserve package script names and the required `serve` / `serve:legacy` mappings.
- Do not claim browser, app, or runtime-backed verification unless it actually ran.
- Keep fixes minimal, safe, and scoped to verified metadata drift.
- Do not create an empty remediation commit.

## Phase 0 Repo Control Verification
- Confirm repo identity records point to the `freecad-automation` git root.
- Confirm the worktree used for implementation is the clean linked worktree for this branch.
- Confirm the status files and control docs live under that repo root.
- Confirm the branch is either based on merged default-branch history or explicitly stacked on `fix/job-store-atomic-write`.

## Phase 1 Claim Audit
- Read `AGENTS.md`, the execution plan, and `tmp/codex/single-source-metadata-manifests-status.md`.
- Compare claimed changed surfaces with actual diffs.
- Compare claimed manifest centralization with actual import paths and consumers.
- Confirm `job-store.js` was not edited in this branch beyond whatever already exists in the chosen base branch.

## Phase 2 Leftover Drift Audit
- Search touched surfaces for duplicated command lists, lane lists, suite chains, and serve copy.
- Verify any remaining duplication is intentional and explained.
- Verify technical identifiers that remain English-only are still identifiers rather than user-copy regressions.

## Phase 3 Safe Verification
- Run the safe manual checks:
  - `node bin/fcad.js --help`
  - `node bin/fcad.js serve --help`
  - inspect `package.json` serve mappings
- Run the declared automated checks that are available in the current environment.
- Record exactly what did or did not run.

## Phase 4 Minimal Fixes
- Apply only verified, low-risk fixes needed to align code, docs, scripts, and status-file claims.
- Re-run the smallest relevant validations after each fix.
- Update `tmp/codex/single-source-metadata-manifests-verification-status.md` with findings and repairs.

## Phase 5 Read-Only Review
- Capture `git diff --name-only` immediately before the final read-only review.
- Re-read the touched files without editing.
- Capture `git diff --name-only` immediately after the review.
- If the diff changed during the read-only review, report the review as invalid.
