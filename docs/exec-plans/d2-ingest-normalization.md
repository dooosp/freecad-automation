# D2 ingest normalization and evidence reference layer

## Scope guardrails
- Keep `scripts/ingest_context.py` orchestration-first.
- Preserve the additive architecture direction: adapters -> geometry -> linkage -> decision -> reporting.
- Keep the Node CLI + Python runner + FreeCAD structure intact.
- Do not move decision logic into ingest.
- Do not introduce LLM-based normalization.
- Keep downstream artifacts compatible with the D1 contract through additive fields and safe English defaults.

## Phase 0: Preflight and repo identity
- Confirm the git root, active branch, and worktree mode.
- Verify the task files live inside the same repository root.
- Capture `git status --short` and `git diff --name-only`.
- Stop if nested-repo or wrong-root ambiguity is detected.

## Phase 1: Baseline analysis
- Read `scripts/ingest_context.py`, the adapter loaders, and nearby linkage/tests.
- Search for downstream field usage to preserve existing contracts while adding normalized evidence metadata.
- Identify the smallest adapter-layer helper split that covers units, refs, process/location normalization, provenance, and diagnostics.

## Phase 2: Adapter normalization implementation
- Add helper modules for column mapping, unit normalization, ID/reference normalization, location normalization, process normalization, and evidence reference assembly where they clarify responsibilities.
- Keep `scripts/ingest_context.py` focused on orchestration and aggregation.
- Enrich inspection and quality evidence records with:
  - canonical IDs/refs
  - normalized feature/location/process refs
  - source provenance
  - raw tokens
  - data quality flags
- Surface ambiguous header, missing-field, and unit-conflict diagnostics without hiding ambiguity.

## Phase 3: Fixtures and regression coverage
- Add focused ingest fixtures and pytest coverage for:
  - mixed `mm` / `inch` / string-number normalization
  - ambiguous token or header mapping
  - missing feature or location hints
  - provenance retention
- Preserve existing ingest behavior where values are already valid.

## Phase 4: Verification and remediation
- Run the smallest relevant ingest/adapters validations after implementation milestones.
- Distinguish pre-existing failures from regressions introduced in this task.
- Repair safe regressions before moving on.

## Phase 5: Finalization
- Update the task status files with completed work, validations, failures, repairs, and remaining risks.
- Stage only task-scoped files.
- Commit once with `feat(d): normalize ingest evidence, units, ids, and provenance`.
- Push `feat/d2-ingest-normalization` if the environment allows.
