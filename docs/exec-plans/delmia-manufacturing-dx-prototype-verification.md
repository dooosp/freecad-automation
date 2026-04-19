# DELMIA Manufacturing DX Prototype Verification Plan

## Verification Goals
- Prove new DELMIA-adjacent materials stay additive, deterministic, and clearly non-official.
- Validate all new JSON artifacts.
- Smoke-test both new Python demos with checked-in example data.
- Run the smallest relevant existing test lanes impacted by the new files.

## Verification Steps
1. Repo identity and branch
   - `pwd`
   - `git rev-parse --show-toplevel`
   - `git branch --show-current`
   - `git rev-parse HEAD`
2. Tree state
   - `git status --short`
   - `git diff --name-only`
3. JSON validity
   - `python3 -m json.tool` on new manufacturing context and inspection example files
   - `python3 -m json.tool` on generated JSON reports when scripts run
4. Script smoke checks
   - Run `scripts/simulate_production_flow.py` against the new manufacturing context
   - Run `scripts/link_inspection_to_manufacturing.py` against the new manufacturing context and inspection records
5. Focused existing checks
   - Run the smallest relevant repo test commands if helper code or schema wiring touches shared validation seams
6. Read-only skeptical review
   - Capture `git diff --name-only` immediately before review
   - Review claims, scope, deterministic logic, and file placement without editing
   - Capture `git diff --name-only` immediately after review
   - Invalidate the review if the diff changes during the review step
7. Landing check
   - Re-check branch, HEAD, status, and stale-base evidence
   - Draft PR summary only; do not push or open a PR

## Claim Audit Checklist
- Every DELMIA / 3DEXPERIENCE reference is framed as adjacent, analogous, or learning-oriented
- No doc claims official API, product, or partner integration
- Demo scripts describe outputs as guidance, not engineering truth
- Recommendations remain auditable and backed by explicit heuristics
