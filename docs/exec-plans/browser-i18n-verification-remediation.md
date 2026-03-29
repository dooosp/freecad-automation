# Browser i18n verification and remediation

## Mission
Verify the completed browser-facing English/Korean rollout, audit any coverage gaps, and remediate issues before merge.

This phase is a follow-up to the main bilingual browser UI rollout.
The purpose is not to redesign the system, but to verify claims, inspect remaining risks, fix any real gaps, and produce a trustworthy final verification report.

## Scope
Browser-facing surfaces only:
- homepage
- legacy viewer if browser-visible text was touched
- studio shell/chrome
- Start / Model / Drawing
- Review / Artifacts / Jobs center
- completion notices / log drawer browser copy
- server-rendered `/api` landing/info page

## Non-negotiables
- Keep diffs scoped and reviewable.
- Do not widen into unrelated refactors.
- Do not replace the locale architecture unless a small targeted fix is required.
- Keep technical identifiers in English unless only the surrounding visible label is localized:
  - endpoint names
  - route paths
  - schema keys
  - JSON keys
  - CLI command names
  - test IDs
  - raw ids such as job_id or artifact ids
- Do not claim browser interaction unless it actually ran.
- Do not claim tests passed unless they were actually executed.

## Working method
For each phase:
1. inspect the relevant files and repo state,
2. use repo search before editing,
3. verify claims against actual code,
4. fix verified issues immediately where safe,
5. run the smallest relevant validations,
6. update `tmp/codex/browser-i18n-verification-status.md`,
7. continue until all phases are complete.

## Branch strategy
Preferred:
- continue on the current rollout branch if the PR is still open

Alternative:
- if a separate follow-up branch is needed, branch from the current rollout branch HEAD

## Phase 0 — repo artifact and branch verification

### Objective
Verify repository control files, branch state, and status-file placement before auditing localization coverage.

### Requirements
- Confirm whether these files exist inside the repository:
  - `AGENTS.md`
  - `docs/exec-plans/browser-i18n-rollout.md`
  - `tmp/codex/browser-i18n-status.md`
- Confirm whether the prior status file is inside the repository root or outside it.
- If the prior status file was created outside the repo, do not silently ignore that fact.
- Create or update the correct follow-up status file at:
  - `tmp/codex/browser-i18n-verification-status.md`
- Inspect:
  - current branch name
  - `git status`
  - `git diff --stat`
  - current PR-facing commit range if practical
- Confirm whether the previously claimed plan files were committed or intentionally left uncommitted.

### Acceptance
- There is a clear, accurate statement about the location of the prior status file.
- The follow-up status file exists in the correct repo-relative location.
- Branch and worktree state are clearly documented before code edits.

## Phase 1 — localization scope claim audit

### Objective
Check whether previously claimed localized surfaces actually match the code changes.

### Requirements
- Audit the claimed localized surfaces against actual touched files and code paths.
- Specifically inspect whether these files were:
  - changed,
  - intentionally left unchanged,
  - indirectly covered elsewhere,
  - or missed:
  - `public/js/studio/jobs-center.js`
  - `public/js/studio/workspaces.js`
  - `public/js/studio/artifact-insights.js`
- If a surface was claimed as localized but the underlying user-visible copy is still English, fix it.
- If a surface was not actually touched and does not need touching, document why.
- Check whether the changed-file report from the prior final summary accurately matched the actual diff.

### Acceptance
- Claimed coverage now matches real code state.
- Any mismatches are either fixed or explicitly corrected in the final report.

## Phase 2 — leftover English browser-copy audit

### Objective
Find remaining browser-visible English strings and classify them correctly.

### Requirements
- Search across browser-facing surfaces for remaining English strings.
- Focus on user-visible text, not raw code identifiers.
- Classify each leftover string as one of:
  - intentional technical English
  - preserved product/acronym terminology
  - false positive
  - missed browser-visible copy that should be localized
- Translate any missed browser-visible strings that should not remain English.
- Pay special attention to:
  - page titles
  - buttons
  - badges
  - helper text
  - empty states
  - aria labels
  - shell summaries
  - notice titles/messages
  - Jobs center labels
  - `/api` info/help copy

### Acceptance
- Obvious stray browser-facing English strings are either fixed or explicitly justified.

## Phase 3 — persistence and runtime verification

### Objective
Verify that locale selection behaves consistently enough across homepage, studio, and `/api`.

### Requirements
- Re-check the locale architecture in code:
  - shared i18n files
  - English fallback behavior
  - `ui_locale` persistence path
  - `/api` locale resolution
- Run the strongest safe verification available.
- If browser automation or an existing browser test harness exists, run a minimal smoke pass for:
  - `/`
  - `/studio`
  - `/api`
  - locale switching
  - reload persistence
- If no browser automation exists, do not claim runtime browser QA.
  Instead:
  - run code-level tests,
  - verify locale resolution paths in code,
  - and produce a concise manual smoke checklist.
- Specifically verify whether the same locale source of truth is used consistently across client and server-rendered browser surfaces.

### Acceptance
- Locale persistence behavior is either validated or clearly bounded by what was and was not tested.

## Phase 4 — remediate verified gaps

### Objective
Fix only the issues that were actually verified in phases 0–3.

### Requirements
- Apply the smallest safe fixes for:
  - incorrect coverage claims
  - missed browser-visible strings
  - incorrect or incomplete locale wiring
  - status-file path mistakes if repo-local temp tracking is needed
  - report/doc mismatches
- Keep the locale architecture intact unless a tiny targeted repair is needed.
- Avoid cosmetic refactors unrelated to verification findings.

### Acceptance
- Verified gaps are fixed without broadening scope.

## Phase 5 — finalize and report

### Objective
Produce a PR-ready verification result and trustworthy follow-up report.

### Requirements
- Update:
  - `tmp/codex/browser-i18n-verification-status.md`
- If needed, add a tiny doc note only when it corrects rollout status or language claims.
- Run the smallest relevant final validation set for touched files.
- If changes were made, create a descriptive commit.
- Push the branch if the environment allows it.
- If no code changes were needed, say so clearly and do not create an empty commit.

### Final report must include
1. concise verification summary
2. whether the prior rollout claims were fully accurate
3. exact location of the prior status file and whether it was inside the repo
4. whether `public/js/studio/jobs-center.js`, `public/js/studio/workspaces.js`, and `public/js/studio/artifact-insights.js` were intentionally unchanged, indirectly covered, or newly fixed
5. changed files in this follow-up, if any
6. tests/checks run
7. leftover English browser-visible strings and why they remain
8. whether AGENTS/plan files exist and whether they were committed
9. commit hashes/messages if commits were made
10. whether the branch was pushed
11. remaining risks or manual smoke items still recommended

## Commit expectations
If fixes are needed, preferred messages are:

1. `chore(ui): audit bilingual browser rollout coverage`
2. `fix(ui): address bilingual browser rollout followups`

If only one commit is appropriate, combine them sensibly.
If no changes are needed, do not create an empty commit.
