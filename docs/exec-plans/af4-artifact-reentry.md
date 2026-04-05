# AF4 Artifact Viewers And Re-entry Continuation

## Mission
Implement AF4 so tracked artifacts can be reopened as meaningful working state and continued through real job-platform actions instead of only being downloaded.

## Product intent
- Results are not dead files; they are reopenable working state.
- The minimum viewer set covers:
  - review pack viewer
  - readiness viewer
  - stabilization / compare viewer
  - bundle manifest viewer
- The minimum action set supports:
  - open review pack
  - open readiness report
  - open release bundle
  - from an opened artifact, trigger:
    - `generate-standard-docs`
    - `compare-rev`
    - `pack`
- Do not build a fake UI layer detached from the real artifact/job platform.
- Do not recreate D or C reasoning logic in the viewer layer.

## Non-negotiables
- Preserve the real tracked-job, artifact, and bundle platform.
- Keep canonical artifact names and lineage checks intact.
- Prefer the smallest coherent viewer and hydration layer over a broad UI refactor.
- Fail closed on lineage mismatch or unsupported artifact types.
- Keep diffs scoped to AF4.

## Discovery targets
- artifact open, reopen, and resume flows
- review pack and readiness rendering paths
- compare and stabilization rendering paths
- bundle manifest rendering and bundle import paths
- action dispatchers that trigger jobs from opened artifacts
- tracked run hydration or persisted state reconstruction
- API and job-platform integration points
- canonical AF1/AF2 artifact metadata already carried on tracked artifacts

## Working method
For each phase:
1. read the relevant files and nearby helpers
2. use repo search before editing
3. implement the smallest coherent reopenable slice
4. run the smallest safe validation for touched areas
5. update `tmp/codex/af4-artifact-reentry-status.md`
6. repair failures before continuing

## Phases

### Phase -1: repo and base-branch preflight
- confirm repo identity, git root, branch, worktree mode, and cleanliness
- detect the default branch automatically
- base from the default branch if AF3 is already merged there; otherwise base from `feat/af3-studio-review-console` if present
- stop on repo ambiguity, dirty-tree ambiguity, or control-file root mismatch

### Phase 0: discovery and artifact-open map
- map the real Studio/browser artifact detail path, tracked job bridge, local API artifact routes, and bundle import helpers
- identify the minimum viable viewer seam that can render canonical artifacts without duplicating D/C logic
- identify the smallest safe validation set for AF4

### Phase 1: artifact viewers and state hydration
- add the real artifact viewer/hydration path for:
  - review pack
  - readiness report
  - revision comparison / stabilization review
  - release bundle manifest-aware inspection
- expose warnings, coverage, confidence, lineage, and next-action affordances when the artifact contains them

### Phase 2: decision-console actions from opened artifacts
- add opened-artifact actions that queue real tracked jobs for:
  - `generate-standard-docs`
  - `compare-rev`
  - `pack`
- keep action routing grounded in the existing job submission bridge and canonical artifact refs

### Phase 3: bundle manifest/open integration and coherence sweep
- make bundle reopen flow recognize canonical `review_pack.json`, `readiness_report.json`, and `release_bundle.zip` paths where the architecture already supports it
- ensure release-bundle reopen is manifest-aware and truthful about available canonical entries
- align opened-artifact copy, routing, and disabled states with actual platform support

### Phase 4: audit reopen gaps and remediate verified issues only
- verify the claimed reopen flows against actual touched code paths
- fix only verified viewer, hydration, or action gaps that are safe and scoped

### Phase 5: final validation and read-only review
- run the strongest safe targeted checks for the touched Studio, API, and artifact-platform surfaces
- execute the AF4 verification and remediation plan
- capture `git diff --name-only` before and after the read-only review; if they differ, report the review as invalid
- finalize git state with commit, push, and merge attempt if cleanly allowed
