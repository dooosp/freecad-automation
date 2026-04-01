# D4 Evidence Linkage, Scoring, and Recommendations

## Task
- Slug: `d4-linkage-decision`
- Branch: `feat/d4-linkage-decision`
- Commit message: `feat(d): decompose linkage and add hotspot-level scoring breakdown`

## Guardrails
- Preserve additive architecture: adapters -> geometry -> linkage -> decision -> reporting.
- Keep linkage separate from decision logic.
- Keep machine-readable JSON artifacts canonical.
- Keep metadata-only fallback working when FreeCAD runtime is unavailable.
- Do not hide ambiguity.
- Do not emit opaque scores without component breakdown.
- Do not widen into unrelated reporting or rendering refactors.

## Phase 0: Preflight
- Confirm repo identity, branch, and worktree state.
- Capture dirty-tree snapshot before edits.
- Read existing linkage, scoring, recommendation, review-pack, and D-related tests.

## Phase 1: Control Plane
- Preserve existing `AGENTS.md`.
- Append a repo-local D-task guidance section.
- Maintain:
  - `docs/exec-plans/d4-linkage-decision.md`
  - `docs/exec-plans/d4-linkage-decision-verification.md`
  - `tmp/codex/d4-linkage-decision-status.md`
  - `tmp/codex/d4-linkage-decision-verification-status.md`

## Phase 2: Linkage Refactor
- Reduce orchestration responsibility in `scripts/quality_link.py`.
- Add matcher helpers for:
  - lexical match
  - location match
  - feature-class match
  - process-step match
- Introduce hotspot-level linkage outputs with explicit fields:
  - `linked_hotspot_ids`
  - `linked_feature_refs`
  - `match_type`
  - `confidence`
  - `reason_codes`
  - `ambiguity`
  - `evidence_refs`
- Preserve existing output surfaces where needed for downstream compatibility.

## Phase 3: Decision Refactor
- Move from category-level scoring to hotspot-level scoring.
- Add explicit scoring breakdowns:
  - geometry evidence score
  - inspection anomaly score
  - quality recurrence score
  - process sensitivity score
  - data quality penalty
  - ambiguity penalty
- Build auditable hotspot priorities and evidence-backed recommendations.

## Phase 4: Output Compatibility
- Keep `quality_link.py` response shape usable by current CLI/reporting flow.
- Update reporting or templates only where needed to render the richer decision artifacts safely.

## Phase 5: Validation
- Run the smallest relevant existing tests first.
- Add focused tests for:
  - ambiguous match visibility
  - score breakdown presence
  - hotspot-level output shape
  - false-positive linkage regression
- Separate pre-existing failures from new failures.
- Repair failures before finalization where safe.

## Phase 6: Finalization
- Stage only task-scoped files.
- Make one scoped commit with the required message.
- Push the branch if possible.
