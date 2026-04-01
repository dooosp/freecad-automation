# D Integration Merge Plan

## Scope
- Integrate D1 through D5 onto `feat/d-integration` in this worktree only.
- Preserve the original phase commits where possible.
- Add one integration-fix commit only if conflict resolution or compatibility repairs require it.

## Commit Order
1. `c49c7c7`
2. `5bf71f10da0d99bd2a0eb32489185aa050927abf`
3. `2e185a3153d5ab10662d260f3244672a12c505ec`
4. `6ccf04165831b77a7d9dd4e695fc652a61cc944b`
5. `4df91d2`

## Guardrails
- Preserve additive architecture.
- Keep Node CLI + Python runner + FreeCAD structure.
- Keep JSON artifacts canonical.
- Preserve `review_pack.json` as the source of truth.
- Preserve `evidence_refs`, `reason_codes`, hotspot-oriented scoring, and metadata-only fallback behavior.
- Avoid unrelated browser, i18n, or Studio work.

## Conflict Policy
- Prefer later-phase intent only when it builds on earlier D foundations.
- Resolve shared-file conflicts to preserve the full D1 -> D5 behavior, not just the last textual patch.
- Keep diffs scoped to integration needs.
