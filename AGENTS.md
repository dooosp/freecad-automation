# AGENTS.md

## Purpose
This repository uses Codex for scoped, reviewable engineering tasks.
For complex browser-facing UI changes, follow the execution plan in:
- `docs/exec-plans/browser-i18n-rollout.md`

Codex should treat this file as persistent project guidance and the execution plan as the task-specific source of truth.

## Working style
- Work autonomously and bias toward action.
- Prefer repo search over assumptions.
- Do not stop for interim approval unless truly blocked.
- Keep diffs small, scoped, and reviewable.
- Do not widen scope into unrelated refactors.
- If something fails, debug, repair, and continue.
- Final reply only after the assigned work is complete.

## Browser-facing i18n constraints
- This rollout is for browser-facing UI only.
- Translate browser-visible text only:
  - document and page titles
  - headings
  - labels
  - buttons
  - badges
  - helper text
  - empty states
  - summaries
  - status messages
  - notices
  - accessibility labels
  - server-rendered browser help/info copy
- Keep internal identifiers in English unless a display wrapper is clearly safer:
  - code identifiers
  - endpoint names
  - route paths
  - schema keys
  - JSON keys
  - CLI command names
  - test IDs
  - variable names
- Keep runtime behavior unchanged except where needed for locale selection and translated browser copy.
- Missing i18n keys must fall back safely to English.
- Do not introduce a heavy i18n framework.

## Locale expectations
- Support both English and Korean.
- Use English as the fallback locale.
- Prefer one obvious centralized place for browser-visible copy.
- Keep technical identifiers such as `job_id`, route paths, and raw API keys unchanged unless only the surrounding visible label is being localized.

## Verification expectations
- Read the relevant files before editing.
- Use repo search to find related browser-visible strings before changing code.
- Run the smallest relevant validations after each milestone.
- Repair failures before moving to the next milestone.
- Do not claim browser interaction unless it actually ran.
- Do not claim tests passed unless they were actually executed.

## Progress tracking
Maintain:
- `tmp/codex/browser-i18n-status.md`

Update it after each phase with:
- current phase
- completed work
- files changed
- validations run
- failures encountered
- repairs made
- open risks
- remaining work

Do not commit this status file unless explicitly asked.

## Completion criteria
Done means:
- the execution plan phases assigned for this task are completed,
- relevant browser-facing surfaces support English and Korean through the shared locale mechanism,
- English fallback works safely,
- touched validations pass or any gaps are clearly reported,
- leftover English browser-visible strings are audited and explained if intentionally preserved.

## Final response format
The final response should include:
1. concise summary of what changed
2. locale architecture and persistence strategy
3. changed files grouped by surface
4. tests/checks run
5. leftover English browser-visible strings and why they remain
6. commit hashes/messages if commits were made
7. whether the branch was pushed
8. remaining risks or follow-up suggestions

## Follow-up verification and remediation tasks
- For post-implementation verification work, follow:
  - `docs/exec-plans/browser-i18n-verification-remediation.md`
- Do not stop for interim approval unless truly blocked.
- Audit claimed localized surfaces against actual touched files.
- If a previously claimed browser-facing surface was not actually localized, either:
  - fix it, or
  - clearly correct the report
- If any temp/status file was created outside the repo, report it clearly and create the correct in-repo temp file.
- Do not claim browser automation or manual browser QA unless it actually ran.
- Prefer fixing small verified issues immediately rather than only reporting them.
- If no code changes are needed after verification, do not create an empty commit.
