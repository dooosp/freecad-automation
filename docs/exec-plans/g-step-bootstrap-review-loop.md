# G STEP Bootstrap Review Loop

## Task
- Slug: `g-step-bootstrap-review-loop`
- Branch: `codex/g-step-bootstrap-review-loop`
- Base branch: `master`

## Mission
Implement G as a review-first intake and bootstrap lane for existing `STEP` and `FCStd` artifacts. The success condition is:

> take an existing STEP/FCStd and get it into the review loop safely, quickly, and honestly

## Product framing
- D remains the core geometry, linkage, and decision engine.
- C remains the canonical readiness package layer.
- A+F remain execution, tracking, artifact re-entry, and the Studio review console.
- G must safely bootstrap imported CAD into D, C, and A+F without becoming a modeling-first hero flow.

## Non-goals
- Do not attempt full parametric history reconstruction.
- Do not imply automatic drawing-intent completion.
- Do not present low-confidence feature inference as fact.
- Do not duplicate D or C reasoning inside API, Studio, or tracked jobs.
- Do not introduce LLM-based geometry inference or decision logic.

## Contracts To Preserve
- Runtime-backed execution path:
  - `bin/fcad.js -> lib/runner.js -> scripts/*.py -> scripts/_bootstrap.py -> import FreeCAD`
- Canonical review/readiness path:
  - `review-context -> review_pack.json -> readiness-pack/readiness-report --review-pack -> readiness_report.json -> generate-standard-docs / pack`
- Studio preference and tracked-artifact lineage.
- Metadata-only fallback when runtime-backed geometry inspection is unavailable.
- Additive architecture direction:
  - `adapters -> geometry -> linkage -> decision -> reporting`

## Required Bootstrap Artifacts
- `import_diagnostics.json`
- `bootstrap_summary.json`
- `draft_config.toml`
- `engineering_context.json`
- `geometry_intelligence.json`
- `bootstrap_warnings.json`
- `confidence_map.json`

## Wave 0: Preflight And Control Plane
- Verify `pwd`, git root, branch, worktree mode, default branch, and cleanliness.
- Stop on repo identity ambiguity.
- Create or update:
  - `docs/exec-plans/g-step-bootstrap-review-loop.md`
  - `docs/exec-plans/g-step-bootstrap-review-loop-verification.md`
  - `tmp/codex/g-step-bootstrap-review-loop-status.md`
  - `tmp/codex/g-step-bootstrap-review-loop-verification-status.md`
  - repo-local `.codex` task agents when absent

## Wave 1: Discovery
- Map the existing STEP and `FCStd` intake path.
- Map canonical review-pack and readiness lineage.
- Map Studio import, jobs, artifact re-entry, and preview surfaces.
- Map the smallest representative fixture and validation additions.
- Synthesize the narrowest additive contract for G bootstrap outputs before implementation.

## Wave 2A: Intake Hardening
- Extend `src/services/import/step-import-service.js` and nearby helpers.
- Harden import handling for:
  - part vs assembly detection when possible
  - unit assumptions when possible
  - bbox, body count, empty import, partial import, and unsupported import conditions
  - machine-readable diagnostics
- Preserve fail-closed behavior for unsupported or unstable imports.

## Wave 2B: Bootstrap Extraction
- Extend `scripts/ingest_context.py`, `scripts/analyze_part.py`, `scripts/geometry/*`, and narrow reporting helpers as needed.
- Produce honest draft bootstrap outputs with warnings, coverage, and confidence.
- Carry imported geometry into the review loop without pretending to know design intent.

## Wave 2C: Studio Bootstrap Gate
- Extend local API, Studio bridge, and Studio browser surfaces.
- Keep `/` and `/studio` review-first.
- Expose import bootstrap preview, features, warnings, confidence, and correction actions.
- Add truthful entrypoints for imported review work such as:
  - `Start review from imported STEP`
  - `Start review from imported STEP + quality context`

## Wave 2D: Review-First Handoff
- Ensure corrected bootstrap state hands off into `review-context`, `review_pack.json`, `readiness-pack`, `readiness-report --review-pack`, docs generation, and pack.
- Preserve tracked lineage and fail-closed behavior.
- Avoid duplicating D and C reasoning in API or jobs.

## Wave 2E: Regression Fixtures And Tests
- Add representative fixtures for:
  - one simple bracket
  - one machined part with clear hole or pattern structure
  - one small assembly
- Keep hosted-safe validations fast where possible.
- Attempt FreeCAD-backed runtime smoke only when runtime is actually available.

## Wave 3: Integration And Narrative Coherence
- Resolve cross-surface contract mismatches in the supervisor lane.
- Update README only where needed to keep the product narrative coherent.
- Keep diffs additive and reviewable.

## Wave 4: Validation, Commit, Push, And Read-Only Verification
- Run the smallest relevant checks after each milestone and repair failures before moving on.
- Target:
  - `npm run test:node:contract`
  - targeted JS tests for intake, Studio, handoff, and artifacts
  - `npm run test:node:integration` when local API or Studio routes are touched
  - `npm run test:py` when Python helpers change
  - `fcad check-runtime` and targeted runtime smoke only if FreeCAD is available
- Create one to three logical commits maximum.
- Push if environment allows.
- Perform a diff-invariant read-only verification pass at the end.
