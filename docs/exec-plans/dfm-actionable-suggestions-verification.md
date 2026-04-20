# DFM Actionable Suggestions Verification

## Verification order

1. Run targeted Node and Python tests for DFM issue enrichment and compatibility behavior.
2. Run the smallest broader suite that exercises touched DFM/CLI output paths without widening into unrelated runtime-backed checks.
3. Run `node bin/fcad.js check-runtime` to classify FreeCAD availability on this machine.
4. If runtime is available, run a representative `fcad dfm` example and capture one actionable issue from produced output.
5. If runtime is unavailable, run the plain-Python DFM path or fixture-based CLI path and capture one actionable issue from real output.
6. Perform a read-only skeptical review with `git diff --name-only` captured immediately before and after the review pass.

## Candidate commands

- `node tests/dfm-cli-actionable.test.js`
- `python3 -m pytest -q tests/test_dfm_checker.py`
- `npm run test:node:contract`
- `npm run test:py`
- `node bin/fcad.js check-runtime`
- `node bin/fcad.js dfm configs/examples/ks_bracket.toml`

## Evidence rules

- record exact commands and exit codes
- distinguish runtime availability from plain-Python DFM execution, because `dfm` itself does not require a live FreeCAD launch
- capture at least one real actionable issue payload showing `severity`, `actual_value`, `required_value`, `delta`, `suggested_fix`, and `confidence`
- classify the known create-quality issue, drawing-quality issue, and `tests/output-contract-cli.test.js` provenance mismatch as pre-existing unless this task directly changes those paths
