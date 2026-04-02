# AF3 Studio Review-First Console Verification

## Mission
Verify that Studio now presents as a review-first console, audit any mismatches between the intended IA and the real wiring, and remediate only verified gaps.

## Scope
- Studio shell, nav, and default route framing
- Start or console surface
- Review workspace
- Artifacts workspace
- jobs center and completion routing
- `/api` browser-facing info page
- touched English and Korean browser copy

## Non-negotiables
- Do not widen into unrelated refactors.
- Do not claim browser interaction unless it actually ran.
- Do not claim tests passed unless they were executed.
- Preserve legacy compatibility routes and tracked-job behavior.
- Keep all verification notes in-repo under `tmp/codex/`.

## Working method
For each phase:
1. inspect repo state and touched files
2. verify claimed UI shifts against real code paths
3. search for remaining modeling-first primary messaging on touched surfaces
4. fix only verified issues that are safe and scoped
5. run the smallest relevant validations
6. update `tmp/codex/af3-studio-review-console-verification-status.md`

## Phases

### Phase 0: repo and control-file verification
- confirm `AGENTS.md`, the AF3 plan files, and both AF3 status files exist inside the repo root
- capture branch, `git status`, and `git diff --stat`

### Phase 1: Studio IA claim audit
- verify nav order, home/default console framing, and CTA order match the review-first intent
- verify create and draw entrypoints were demoted rather than removed

### Phase 2: capability wiring audit
- verify recent review-pack, readiness, compare, and pack surfaces route to real tracked capabilities where implemented
- verify any placeholder remains explicit about current limits

### Phase 3: browser-copy and locale audit
- verify touched English and Korean copy stays aligned
- classify any leftover English browser-visible strings on touched surfaces as intentional, false positive, or missed copy

### Phase 4: read-only final review invariance
- capture `git diff --name-only` before and after the read-only review
- if the diff changes during the review, report the review as invalid and do not claim merge readiness

### Phase 5: final validation summary
- run the final targeted checks for touched areas
- report remaining risks, manual smoke items, and any blocked merge step clearly
