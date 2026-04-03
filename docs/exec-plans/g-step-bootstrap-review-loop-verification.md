# G STEP Bootstrap Review Loop Verification And Remediation Plan

## Mission
Verify that imported `STEP` and `FCStd` assets can enter the review loop through a hardened, honest bootstrap lane without breaking canonical downstream lineage.

## Scope
- intake diagnostics and fail-closed behavior
- bootstrap artifact contracts and confidence visibility
- Studio bootstrap gate and review-first positioning
- review-context and readiness handoff coherence
- representative regression fixtures and runtime guards

## Verification Passes

### Pass 1: Repo And Control-File Verification
- Confirm the G execution plan, verification plan, and both status files exist under the repo root.
- Capture branch, `git status --short`, and `git diff --name-only`.
- Confirm all touched files remain inside the same `freecad-automation` git root.

### Pass 2: Intake Diagnostics And Failure Semantics
- Verify machine-readable diagnostics exist for supported imports.
- Verify unsupported, empty, unstable, or partial imports remain explicit and fail closed where required.
- Verify assembly, body-count, unit-assumption, and bbox facts are carried when detectable.

### Pass 3: Bootstrap Artifact Honesty
- Verify high-confidence findings are structured.
- Verify medium or low-confidence findings remain visible as warnings or review-needed items.
- Verify the output does not overstate design intent or reverse-engineered certainty.

### Pass 4: Studio Review Gate
- Verify Studio remains the preferred browser surface on `/` and `/studio`.
- Verify imported preview, warnings, features, and confidence are surfaced.
- Verify correction or confirmation paths are present without inventing unsupported workflows.

### Pass 5: Canonical Handoff And Lineage
- Verify imported bootstrap state reaches `review-context`, `review_pack.json`, and readiness outputs coherently.
- Verify tracked jobs and artifact re-entry still preserve lineage.
- Verify no duplicate D or C reasoning was pushed into browser or API layers.

### Pass 6: Regression Coverage
- Run the smallest targeted Node and Python tests for the new contract.
- Attempt runtime-backed validation only if FreeCAD is available.
- Separate pre-existing failures from task regressions and repair task regressions before finalization.

### Pass 7: Read-Only Diff Invariance
- Capture `git diff --name-only` immediately before and after the read-only review.
- If the diff changes during that review, report the review as invalid and do not claim merge readiness.

## Remediation Rules
- Prefer the smallest fix that restores the intended G contract.
- Do not widen into unrelated refactors.
- Preserve metadata-only fallback behavior when runtime-backed geometry inspection is unavailable.
- If a validation gap remains, report it explicitly in the verification status file and final summary.
