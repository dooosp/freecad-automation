# D3 geometry facts, entity refs, and stable hotspots

## Scope guardrails
- Preserve the additive architecture direction: adapters -> geometry -> linkage -> decision -> reporting.
- Keep the Node CLI + Python runner + FreeCAD structure intact.
- Keep machine-readable JSON artifacts canonical.
- Do not redesign linkage or decision logic beyond narrow compatibility updates needed for hotspot-ready outputs.
- Preserve metadata-only fallback when FreeCAD runtime is unavailable.

## Phase 0: Preflight and repo identity
- Confirm the git root, active branch, and worktree mode.
- Verify the task files live inside the same repository root.
- Capture `git status --short` and `git diff --name-only`.
- Stop if nested-repo or wrong-root ambiguity is detected.

## Phase 1: Baseline geometry pipeline analysis
- Read `scripts/analyze_part.py`, `scripts/geometry/shape_metrics.py`, `scripts/geometry/feature_extract.py`, `scripts/geometry/hotspot_detector.py`, and downstream linkage/tests.
- Search for `metrics`, `features`, and hotspot consumer expectations so additive output changes remain backward compatible.
- Identify the smallest helper split for entity indexing, reason codes, and geometry facts.

## Phase 2: Geometry facts and stable entity indexing
- Add focused geometry helpers for:
  - geometry facts extraction from metadata and feature hints
  - stable entity refs for cylinders, bolt circles, fillets, chamfers, and region hints
  - explicit reason code assembly
- Produce `geometry_facts` with bbox, area/volume, raw topology stats, raw feature stats, and optional inspect/STEP facts.

## Phase 3: Derived features and hotspot modeling
- Enrich analyze-part outputs to include:
  - `geometry_facts`
  - `derived_features`
  - `hotspots` with stable `hotspot_id`, `reason_codes`, and `evidence_refs`
- Keep legacy `metrics` / `features` summaries present for downstream consumers while adding richer records.
- Ensure hotspot IDs derive from stable region/entity/feature refs where practical.

## Phase 4: Verification and remediation
- Run the smallest relevant existing analyze-part/linkage workflow tests.
- Add focused tests for:
  - stable hotspot IDs
  - reason codes and evidence refs
  - metadata-only fallback
  - regression guard against collapsing multiple entity-aware hotspots into a single category-only record
- Repair safe regressions before moving to finalization.

## Phase 5: Finalization
- Update the task status files with completed work, validations, failures, repairs, and remaining risks.
- Stage only task-scoped files.
- Commit once with `feat(d): add geometry facts, entity refs, and stable hotspot ids`.
- Push `feat/d3-geometry-hotspots` if the environment allows.
