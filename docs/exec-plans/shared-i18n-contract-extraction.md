# Shared i18n Contract Extraction

## Mission
Introduce a shared locale contract module such as `src/shared/i18n-contract.js` for locale cookie name, initial locale resolution, and fallback policy, then migrate both server and browser adapters to depend on that shared contract instead of the server importing browser-public code.

## Scope
- Locale cookie handling
- Initial locale resolution
- Fallback policy
- Browser i18n adapter wiring
- Local API landing page locale bootstrap
- Tests that cover locale resolution or persisted locale state

## Global Non-Negotiables
- Preserve the current locale cookie name and locale-selection behavior.
- Keep route paths and JSON keys unchanged.
- Do not place browser-only DOM code in the shared module.
- The browser entry may wrap the shared contract, but the server must no longer import from `public/js`.
- Keep English as the fallback locale.
- Keep diffs small, scoped, and reviewable.

## Key Files To Inspect First
- `public/js/i18n/index.js`
- `src/server/local-api-server.js`
- `src/shared/i18n-contract.js`
- `public/js/studio-shell.js`
- Any locale-aware landing or static helper files touched during extraction

## Repo Identity Constraints
- The detected git root for implementation work must basename-match `freecad-automation`.
- All task control files for this task must live inside that same repo root.
- If the primary checkout is dirty, create or use a clean task worktree and continue there.
- Record `pwd`, `git rev-parse --show-toplevel`, `git branch --show-current`, and local/worktree mode before implementation edits.

## Working Method
- Use repo search before editing.
- Read the relevant files before changing them.
- Prefer one shared locale contract module over duplicate helpers.
- Preserve runtime behavior outside the stated scope.
- Update `tmp/codex/shared-i18n-contract-extraction-status.md` after each phase.
- Run the smallest relevant validation after each phase and repair failures before moving on.
- Run the full validation command set before finalization.
- Do not claim browser interaction unless it actually ran.

## Branch
- `refactor/shared-i18n-contract`

## Acceptance Criteria
- A shared module owns locale cookie name, supported locales, initial locale resolution, and fallback policy.
- Server code no longer imports locale bootstrapping behavior from `public/js`.
- Browser i18n wiring depends on the shared contract through a browser-safe adapter layer.
- The local API landing page still boots with the expected locale behavior.
- English fallback remains safe for missing or unsupported locale input.
- Touched validations pass, or any remaining gap is clearly reported.

## Phase -1 Repo Identity Preflight
- Print and record:
  - `pwd`
  - `git rev-parse --show-toplevel`
  - `git branch --show-current`
  - local vs worktree mode when available
- Verify the git root basename is `freecad-automation`.
- Verify the key files are present under that root or are expected to be created there.
- Stop without edits if repo identity or same-root expectations fail.

## Phase 0 Discovery
- Inspect current locale helpers, browser entry points, and server locale usage.
- Search for locale cookie names, fallback handling, and any server import from `public/js`.
- Identify tests that already cover locale selection, cookie persistence, or landing-page locale behavior.
- Initialize the status file with repo identity, clean diff snapshot, and discovery notes.
- Run the smallest safe read-only checks needed to confirm the starting point.

## Phase 1 Foundation
- Create `src/shared/i18n-contract.js` or an equivalent shared module.
- Move shared locale constants and pure resolution helpers into the shared module.
- Keep the module browser-safe and free of DOM access.
- Add or update focused tests for the shared contract if the existing test layout supports it.
- Update the status file with files changed, validations run, failures, repairs, and remaining risks.

## Phase 2 Primary Surfaces
- Migrate `public/js/i18n/index.js` to consume the shared contract through a browser-safe adapter.
- Migrate `src/server/local-api-server.js` and any server-side landing/static helpers to consume the shared contract directly.
- Preserve locale cookie behavior, fallback behavior, and existing route/API outputs.
- Update affected tests for server and browser wiring where needed.
- Update the status file after completing the phase.

## Phase 3 Secondary/Operational Surfaces
- Audit `public/js/studio-shell.js` and any locale bootstrap helpers for direct assumptions that should now depend on the shared contract.
- Tighten any narrow integration seams needed for landing-page locale bootstrap or persisted locale state.
- Keep scope limited to locale contract extraction and adapter wiring.
- Update the status file after completing the phase.

## Phase 4 Audit/Remediation
- Search for leftover server imports from `public/js` and leftover duplicated locale contract logic.
- Audit touched browser-visible locale behavior for English and Korean fallback expectations.
- Fix only verified gaps that are safe and scoped.
- Update the status file with findings, repairs, and remaining risks.

## Phase 5 Finalize
- Run:
  - `npm run test:node:contract && npm run test:node:integration`
- Record what actually ran and any failures or skips.
- Prepare a concise accounting of changed files grouped by surface.
- Do not commit temp status files unless explicitly requested.

## Validation Commands
- `npm run test:node:contract && npm run test:node:integration`

## Manual Smoke Checks
- Open `/` and `/studio`, switch locale, refresh, and verify cookie persistence plus fallback copy behavior if runnable.
- If not runnable in the current environment, report the smoke checks as not run.

## Final Report Format
1. Summary
2. Changed files grouped by surface
3. Validations run
4. Pre-existing diff notes
5. Leftovers
6. Commit hashes/messages if commits were made
7. Push status
8. Remaining risks
