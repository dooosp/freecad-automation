# DELMIA Manufacturing DX Prototype Execution Plan

## Goal
Reposition the repository as a DELMIA-adjacent manufacturing DX portfolio prototype by adding additive documentation, schema-backed manufacturing context, deterministic demo data, and lightweight manufacturing review scripts without claiming official DELMIA integration.

## Scope
- Add DELMIA alignment and training documentation under `docs/delmia-alignment/`, `docs/training/`, `docs/research/`, and `docs/case-studies/`.
- Add a practical manufacturing context schema and example JSON under `schemas/` and `configs/examples/manufacturing/`.
- Add deterministic Python demos for production flow simulation and inspection-to-manufacturing linkage under `scripts/`.
- Add auditable sample outputs only where they help explain the new demos.
- Preserve the existing CLI, Node/Python runtime model, public commands, and existing review/readiness contracts.

## Non-Negotiables
- Do not claim official DELMIA or 3DEXPERIENCE integration.
- Present all manufacturing outputs as learning/demo guidance, not verified engineering truth.
- Keep changes additive and scoped.
- Avoid heavy new dependencies.
- Keep JSON examples valid and scripts deterministic.

## Phases
1. Preflight and bootstrap
   - Prove repo identity, clean worktree, branch, HEAD SHA, and default branch.
   - Maintain task status and tool evidence files under `tmp/codex/`.
2. DELMIA-alignment documentation
   - Add gap analysis and manufacturing context documentation anchored to existing manufacturing-review terminology.
3. Schema and sample data
   - Add `schemas/manufacturing-context.schema.json`.
   - Add bracket-line sample manufacturing JSON and inspection records.
4. Deterministic demos
   - Add a production flow simulation script plus docs.
   - Add an inspection-to-manufacturing linkage script plus docs.
5. Training, research, and case studies
   - Add beginner-friendly training modules, research briefs, and demo case studies.
6. Verification and skeptical review
   - Run the smallest relevant JSON, script, and repo test checks actually supported by the repo.
   - Perform a read-only claim audit with diff invariance before final reporting.

## Expected Validation Ladder
- `python3 -m json.tool` on new JSON example/config files
- `python3 scripts/simulate_production_flow.py ...`
- `python3 scripts/link_inspection_to_manufacturing.py ...`
- Focused repo tests if new scripts or schema helpers warrant them
- Additional docs/schema checks only if supported by existing repo patterns

## Risk Watch
- Overclaiming DELMIA alignment
- Drifting into runtime CLI refactors instead of additive docs/demo work
- Introducing non-deterministic logic or opaque recommendations
- Breaking existing schema or test expectations
