# AF5 A+F Integration Sweep And Publish Readiness

## Mission
- Make AF1 through AF4 behave as one coherent review-first execution and re-entry surface.
- Keep A+F positioned as the orchestration, tracking, publish, and reopen layer over D/C rather than a parallel reasoning stack.
- Minimize human handoff from review-context through readiness, docs, pack, and Studio reopen.

## Repo Identity
- Expected git root basename: `freecad-automation`
- Default branch: detect from git metadata
- Task branch: `feat/af5-integration-publish`
- Preferred worktree: `/Users/jangtaeho/Documents/New/.worktrees/af5-integration-publish/freecad-automation`

## Integration Intent
- Representative story:
  - existing STEP + BOM + inspection + quality
  - `review-context`
  - `review_pack.json`
  - `readiness-pack`
  - `readiness_report.json`
  - `generate-standard-docs`
  - `release_bundle.zip`
  - Studio reopen
- Keep canonical names and lineage stable:
  - `review_pack.json`
  - `readiness_report.json`
  - `standard_docs_manifest.json`
  - `release_bundle_manifest.json`
  - `release_bundle.zip`
- Preserve tracked job, artifact-open, retry/cancel, and bundle import behavior unless a narrow verified fix is needed.

## Branch Integration Policy
- Detect whether AF1 through AF4 branches or equivalent commits exist locally or remotely.
- Detect whether each one is already merged into the default branch.
- If branches are unmerged, integrate in dependency order:
  1. `feat/af1-execution-contract`
  2. `feat/af2-job-platform`
  3. `feat/af3-studio-review-console`
  4. `feat/af4-artifact-reentry`
- If all are merged already, audit the default branch and remediate only verified integration gaps.

## Discovery Targets
- Canonical review, readiness, docs, and bundle paths
- Shared contract helpers and validators
- Job platform request translation, persistence, run history, and artifact manifests
- Studio IA, recent-job surfaces, artifact viewers, and tracked follow-up actions
- Bundle manifest and canonical-entry reopen behavior
- Existing integration or smoke tests that already prove the representative story

## Constraints
- Do not recreate D linkage, hotspot scoring, or decision logic in A+F.
- Do not recreate C readiness synthesis or release packaging logic in A+F.
- Prefer adapters and persistence fixes over refactors.
- Keep diffs scoped and reviewable.
- Keep task control files inside the same repo root as implementation files.

## Phases

### Phase -1: repo identity, default branch, and AF merge audit
- Record:
  - `pwd`
  - `git rev-parse --show-toplevel`
  - `git branch --show-current`
  - local vs worktree mode
  - detected default branch
  - `git status --short`
  - `git diff --name-only`
- Verify repo basename and same-root control-file placement.
- If the source checkout is dirty, isolate into a clean worktree before editing.
- Determine whether AF1 through AF4 are already merged.

### Phase 0: integration map and risk register
- Read AGENTS and AF1 through AF4 execution plans.
- Map the current merged-default surfaces that implement:
  - review-context
  - readiness-pack
  - generate-standard-docs
  - pack
  - Studio recent/open/reopen flows
  - bundle manifest inspection
- Capture only verified integration risks.

### Phase 1: merge or align AF surfaces
- If AF branches are unmerged, integrate them in dependency order with minimal conflict resolution.
- If they are already merged, fix only concrete coherence gaps between contract, job-platform, Studio, and artifact-open surfaces.

### Phase 2: representative-flow validation and targeted remediation
- Run the closest safe checks to the representative story.
- Repair verified mismatches in:
  - job persistence
  - manifest truth
  - recent-history visibility
  - canonical artifact handoff
  - Studio reopen wiring

### Phase 3: leftover audit
- Search for remaining verified A+F integration gaps only.
- Avoid speculative cleanup.

### Phase 4: final validation and verification/remediation
- Run targeted tests for touched surfaces.
- Run the strongest repo-advertised safe lanes available.
- Execute `docs/exec-plans/af5-integration-publish-verification.md`.
- Perform the read-only final review with pre/post `git diff --name-only` capture.

### Phase 5: git finalize, push, and merge attempt
- Create one scoped commit if real implementation changes exist:
  - `feat(af5): integrate A+F review-console workflow`
- Push the branch if allowed.
- Attempt a clean merge into the detected default branch only if the environment and branch state support it.
- Never force-push the default branch.
