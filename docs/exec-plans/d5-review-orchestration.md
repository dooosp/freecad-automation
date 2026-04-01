# D5 Review Orchestration Execution Plan

## Task
- Slug: `d5-review-orchestration`
- Branch: `feat/d5-review-orchestration`
- Commit message: `feat(d): finalize canonical review-pack, revision diffing, and review-context flow`

## Goals
- Make `review_pack.json` the canonical decision artifact.
- Keep Markdown and PDF as renderers derived from canonical JSON.
- Upgrade revision comparison from category-only diffing to evidence-driven explanation.
- Add a flagship `fcad review-context` workflow that orchestrates the existing D-stage steps without removing the independent debug commands.
- Preserve metadata-only and partial-evidence graceful handling.

## Constraints
- Preserve the additive architecture direction: adapters -> geometry -> linkage -> decision -> reporting.
- Keep the Node CLI + Python runner + FreeCAD structure intact.
- Do not introduce LLM-centered decision logic.
- Keep machine-readable JSON artifacts canonical.
- Do not broaden scope into create/draw/dfm/readiness-report beyond narrow supporting changes.

## Phase 0: Preflight And Repo Verification
- Verify `pwd`, git root, branch, and worktree identity.
- Confirm the repo root contains the D5 implementation surfaces.
- Capture `git status --short` and `git diff --name-only`.
- Stop if wrong-root, nested-repo ambiguity, or unrelated dirty-tree state appears.

## Phase 1: Control Plane Setup
- Preserve the existing repo-local `AGENTS.md`.
- Add:
  - `docs/exec-plans/d5-review-orchestration.md`
  - `docs/exec-plans/d5-review-orchestration-verification.md`
  - `tmp/codex/d5-review-orchestration-status.md`
  - `tmp/codex/d5-review-orchestration-verification-status.md`
- Record repo identity and starting state in the status files.

## Phase 2: Canonical Review-Pack
- Inspect and update:
  - `scripts/reporting/review_pack.py`
  - `scripts/reporting/review_templates.py`
  - any narrow helpers needed under `scripts/reporting/`
- Make the JSON artifact explicitly canonical and structured around required sections when evidence exists:
  - executive summary
  - prioritized hotspots
  - inspection anomaly linkage
  - quality pattern linkage
  - evidence ledger
  - uncertainty / coverage report
  - recommended actions
  - data quality notes
- Ensure Markdown and PDF rendering consume the canonical JSON representation rather than rebuilding logic independently.
- Preserve English identifiers and graceful fallback when inspection or quality evidence is missing.

## Phase 3: Evidence-Driven Revision Diffing
- Inspect the current `compare-rev` flow in `bin/fcad.js`.
- Extract revision comparison logic into a narrow helper when it improves clarity.
- Produce outputs that explain reasons for change, including when applicable:
  - `new_hotspots`
  - `resolved_hotspots`
  - `shifted_hotspots`
  - `evidence_added`
  - `evidence_removed`
  - `action_changes`
  - `confidence_changes`
- Keep the output JSON-first and preserve partial-evidence behavior.

## Phase 4: Flagship Review-Context Workflow
- Add or refine a representative command shaped like:
  - `fcad review-context --model ... --bom ... --inspection ... --quality ... --out ...`
- Prefer a narrow orchestration module under `src/orchestration/` if it improves maintainability.
- Internally orchestrate:
  - ingest
  - analyze-part
  - quality-link
  - review-pack
  - optional compare-rev
- Keep the individual commands independently usable for debugging.

## Phase 5: Validation And Fixture Coverage
- Reuse existing test structure first.
- Add focused tests or fixtures for:
  - canonical review-pack JSON shape
  - evidence ledger and recommended actions
  - revision diff reason visibility
  - flagship `review-context` near-E2E flow
- Run the smallest relevant validations after each milestone and repair failures before continuing.

## Phase 6: Finalization
- Update status files with completed work, validations, and remaining risks.
- Stage only D5-scoped files.
- Create one scoped commit using the brief’s commit message.
- Push the branch if environment support allows.
