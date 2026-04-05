# Studio shell decomposition verification

## Mission
Verify that the Studio shell decomposition preserved the browser entry contract and behavior while narrowing responsibility boundaries into smaller modules.

## Non-negotiables
- Do not widen into unrelated refactors.
- Keep `public/js/studio-shell.js` as the browser entrypoint.
- Preserve route and deep-link shape, DOM ids, `data-action` hooks, and current API calls.
- Do not claim browser interaction unless it actually ran.
- Do not claim tests passed unless they were executed.
- Keep all verification notes in-repo under `tmp/codex/`.

## Phase 0 repo control verification
- confirm `AGENTS.md`, the decomposition plan files, and both decomposition status files exist inside the repo root
- confirm repo identity, branch, and worktree mode still match the task control assumptions
- capture `git status --short` and `git diff --name-only`

## Phase 1 claim audit
- compare the execution plan with the actual changed files
- verify `public/js/studio-shell.js` is now a stable facade rather than the main implementation body
- verify claimed module boundaries for shell core, state or store, route synchronization, job-monitor control, workspace orchestration, and DOM binding are present in code

## Phase 2 leftover gap audit
- search for remaining oversized shell logic and leftover direct DOM or state coupling in touched paths
- classify leftovers as intentional compatibility glue, low-risk debt, or missed extraction
- audit browser-visible touched surfaces for behavior-affecting regressions or unexplained string changes

## Phase 3 runtime and path verification
- verify route and hash sync paths still match the prior shape
- verify tracked-job monitor, jobs drawer, recent jobs, workspace mounting, completion notice, and locale rerender hooks still connect through real code paths
- run the smallest relevant validations for any verified gap fixes

## Phase 4 minimal fixes
- fix only verified safe issues found during the audit
- keep changes narrow and reviewable
- update `tmp/codex/studio-shell-decomposition-verification-status.md` after each fix or confirmed no-fix phase

## Phase 5 final report
- run the final validation set if not already current
- perform the read-only diff invariance check by capturing `git diff --name-only` before and after the review
- report actual changed files, actual validations, leftovers, risks, and whether the read-only review stayed valid
