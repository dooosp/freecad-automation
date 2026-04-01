# D1 Artifact Contract and Canonical JSON Foundation

## Objective
- Establish schema-backed, JSON-first D pipeline artifacts.
- Make `review_pack.json` the canonical decision artifact shape for downstream renderers.
- Add the smallest shared validation seam needed for CLI and reporting workflows.

## Repo identity
- Expected git root: the repository root for the D1 worktree
- Task branch: `feat/d1-artifact-contract`
- Key files:
  - `bin/fcad.js`
  - `lib/context-loader.js`
  - `scripts/reporting/review_pack.py`

## Constraints
- Preserve the additive architecture: adapters -> geometry -> linkage -> decision -> reporting.
- Do not widen into ingest normalization or scoring redesign beyond contract alignment.
- Keep machine-readable JSON canonical; Markdown/PDF remain renderers.
- Preserve metadata-only fallback when FreeCAD runtime is unavailable.

## Phase 1: Baseline inspection and control plane
- Confirm repo identity, branch, key files, and clean worktree.
- Inspect current D artifact producers, schemas, and tests.
- Create repo-local execution, verification, and status files.

## Phase 2: Contract design
- Define shared D artifact contract primitives under `schemas/`.
- Standardize common fields:
  - `schema_version`
  - `analysis_version`
  - `generated_at`
  - `part_id`
  - `revision`
  - `warnings`
  - `coverage`
  - `confidence`
  - `source_artifact_refs`
- Add or upgrade:
  - `schemas/geometry_intelligence.schema.json`
  - `schemas/manufacturing_hotspots.schema.json`
  - `schemas/inspection_linkage.schema.json`
  - `schemas/quality_linkage.schema.json`
  - `schemas/review_priorities.schema.json`
  - `schemas/review_pack.schema.json`
  - `schemas/revision_comparison.schema.json`

## Phase 3: Validation seam
- Add a narrow shared validation helper where CLI/reporting code can use it without widening scope.
- Ensure schema failures surface actionable CLI errors.
- Keep success-path behavior unchanged apart from canonical field population.

## Phase 4: Canonical review pack alignment
- Strengthen `scripts/reporting/review_pack.py` and related template logic so JSON is the source of truth.
- Ensure renderers derive from canonical JSON output, not vice versa.
- Align revision comparison with the new artifact contract where applicable.

## Phase 5: Contract stability tests
- Add targeted schema tests and focused golden JSON snapshots/fixtures for D artifacts.
- Prefer small fixtures covering review-pack, schema validation, and contract drift.

## Phase 6: Verification and finalization
- Run the smallest relevant Node and Python tests for schema, CLI, and reporting surfaces.
- Separate pre-existing failures from task-introduced failures.
- Stage only task-scoped files, create one scoped commit, and push if available.
