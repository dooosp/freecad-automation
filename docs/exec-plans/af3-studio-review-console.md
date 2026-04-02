# AF3 Studio Review-First Console

## Mission
Realign Studio so the preferred browser surface behaves like a review and decision console rather than a modeling-first workspace.

## Product intent
- The hero flow is review-first, not create-first.
- The default Studio mental model should be:
  1. context ingest
  2. geometry hotspot
  3. inspection and quality linkage
  4. recommended actions
  5. review pack
  6. readiness package
  7. compare-rev and stabilization
  8. export, pack, and reopen
- Do not turn Studio into a generic CAD modeler.
- Do not recreate D/C reasoning inside browser UI.
- Prefer smaller orchestration and IA changes over speculative redesign.

## Non-negotiables
- Keep `/` and `/studio` Studio-first.
- Keep `/api` as the browser-facing local API info page and make it reinforce Studio-first guidance.
- Keep the legacy viewer reachable, but present it as classic or compatibility mode.
- Preserve route paths, tracked-job behavior, preview-versus-tracked separation, artifact links, queue-control behavior, and canonical artifact handoff.
- Keep browser-facing English and Korean copy aligned through the existing lightweight i18n layer with English fallback.

## Discovery targets
- Studio app entry
- landing, home, dashboard, and navigation
- review-related surfaces
- import, open, and reopen flows
- recent runs and recent artifact lists
- action panels that trigger jobs or open outputs
- existing create and draw entrypoints that should be demoted instead of removed
- local API integration points
- empty, loading, and error states

## Required IA outcomes
The default Studio surface should prioritize or clearly expose:
- Start new review
- Import or reopen existing artifact or bundle
- Recent review packs
- Readiness packages
- Compare revisions
- Export and pack

## Working method
For each phase:
1. read the relevant files and nearby helpers
2. use repo search before editing
3. implement the smallest coherent review-first slice
4. run the smallest safe validation for touched areas
5. update `tmp/codex/af3-studio-review-console-status.md`
6. repair failures before continuing

## Phases

### Phase -1: repo and base-branch preflight
- confirm repo identity, git root, branch, worktree mode, and cleanliness
- detect the default branch automatically
- base from default if AF2 is already merged there; otherwise base from `feat/af2-job-platform` if present
- stop on repo ambiguity or nested-repo ambiguity until resolved cleanly

### Phase 0: discovery and IA map
- map Studio entry, shell, review, artifacts, jobs, and API-info surfaces
- identify real tracked capabilities already available for review-first flows
- capture the smallest coherent IA shift and the validation set

### Phase 1: navigation and home realignment
- make the default shell framing and nav review-first
- demote create and draw copy without breaking those workspaces
- make the first screen answer review, reopen, compare, and export questions before authoring questions

### Phase 2: review-first actions and recent/open/import surfaces
- elevate recent review packs, readiness packages, compare, and pack flows
- wire to tracked job and artifact capabilities already supported by the platform
- add minimal truthful placeholders only where capability exposure is necessary but not yet implemented end to end

### Phase 3: legacy-path preservation and coherence sweep
- keep classic compatibility copy accurate but subordinate
- align `/api`, Studio shell, review surfaces, jobs center, and artifacts wording
- keep terminology consistent across English and Korean

### Phase 4: audit missed UX gaps and remediate verified issues only
- search for lingering modeling-first primary messaging on touched surfaces
- fix only verified IA or wiring gaps

### Phase 5: final validation and read-only review
- run the strongest safe targeted checks
- execute the AF3 verification and remediation plan
- capture diff names before and after the read-only review; if they differ, report the review as invalid
- finalize git state with commit, push, and merge attempt if cleanly allowed
