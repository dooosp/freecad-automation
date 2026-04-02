# AF4 Artifact Viewers And Re-entry Continuation Verification

## Mission
Verify that AF4 really makes tracked artifacts reopenable and continuable through the real job platform, then remediate only verified gaps.

## Scope
- Studio artifact detail and review-console surfaces
- local API artifact and viewer routes
- tracked job translation from artifact refs
- canonical review-pack, readiness, compare/stabilization, and release-bundle reopen paths
- touched English and Korean browser copy

## Non-negotiables
- Do not widen into unrelated refactors.
- Do not claim browser interaction unless it actually ran.
- Do not claim tests passed unless they were executed.
- Preserve canonical artifact lineage checks and fail-closed behavior.
- Keep verification notes in-repo under `tmp/codex/`.

## Working method
For each phase:
1. inspect repo state and touched files
2. verify claimed reopen behavior against real code paths
3. search for verified gaps in opened-artifact routing, viewer summaries, or disabled-state truthfulness
4. fix only safe, scoped issues
5. run the smallest relevant validations
6. update `tmp/codex/af4-artifact-reentry-verification-status.md`

## Phases

### Phase 0: repo and control-file verification
- confirm `AGENTS.md`, both AF4 plan files, and both AF4 status files exist inside the active repo root
- capture branch, `git status`, and `git diff --stat`

### Phase 1: viewer coverage audit
- verify review pack reopen renders meaningful structured state
- verify readiness reopen renders meaningful structured state
- verify compare/stabilization reopen renders meaningful structured state
- verify release bundle reopen is manifest-aware or canonical-entry-aware where supported

### Phase 2: action and continuation audit
- verify opened artifacts expose real tracked actions for docs generation, compare, and pack where supported
- verify disabled or unavailable actions are truthful and fail closed on unsupported combinations

### Phase 3: metadata and lineage audit
- verify warnings, coverage, confidence, lineage, and next-action affordances surface when present
- verify canonical lineage mismatch still fails closed through real platform paths

### Phase 4: read-only final review invariance
- capture `git diff --name-only` before and after the read-only review
- if the diff changes during the read-only review, report the review as invalid and do not claim merge readiness

### Phase 5: final validation summary
- run the final targeted checks for touched Studio, API, and artifact-platform areas
- report remaining risks, manual smoke items, and any blocked merge step clearly
