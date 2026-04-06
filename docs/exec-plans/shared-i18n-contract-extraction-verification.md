# Shared i18n Contract Extraction Verification

## Mission
Verify the shared i18n contract extraction against the actual repo state, actual changed files, and actual validations, then remediate only verified scoped gaps.

## Non-Negotiables
- Preserve the current locale cookie name and locale-selection behavior.
- Keep route paths and JSON keys unchanged.
- Do not move browser-only DOM code into the shared module.
- The server must no longer import locale logic from `public/js`.
- Do not claim runtime, browser, or test results that did not actually run.

## Phase 0 Repo Control Verification
- Re-read `AGENTS.md`, the execution plan, and both task status files.
- Confirm the repo root basename is `freecad-automation`.
- Confirm all task control files live under that repo root.
- Capture a fresh diff snapshot before verification work.

## Phase 1 Claim Audit
- Compare the execution-plan claims with the actual changed files.
- Confirm the shared locale contract exists and owns the intended shared policy.
- Confirm the server and browser adapters now depend on the shared contract in the intended direction.
- Confirm the implementation status file matches the real work performed.

## Phase 2 Leftover Gap Audit
- Search for leftover duplicated locale cookie, fallback, or initial-resolution logic.
- Search for leftover server imports from `public/js`.
- Search for locale-aware surfaces in scope that were claimed but not actually migrated.

## Phase 3 Runtime/Path Verification
- Confirm touched tests are the ones that actually ran.
- Confirm manual smoke checks were only claimed if actually performed.
- Confirm route paths and JSON keys stayed unchanged within the touched scope.

## Phase 4 Minimal Fixes
- Apply only verified, safe, narrow fixes.
- Re-run the smallest relevant validations for any remediation.
- Update the verification status file after each remediation step.

## Phase 5 Final Report
- Record the final verification findings, repairs, validations, and any remaining risk.
- If no code changes were needed during verification, say so explicitly.
- Do not create an empty commit.
