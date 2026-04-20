# Decision Report Upgrade Verification

## Verification order

1. Run targeted Node tests for decision-summary logic, report-service wiring, and the updated lane manifest.
2. Run the smallest existing report-adjacent regressions that can detect compatibility breaks in report service behavior.
3. Run the hosted-safe Python lane only if the pre-existing markdown/local-path failure is either fixed or still clearly unrelated.
4. Run `fcad check-runtime` to classify runtime availability on this machine.
5. If PDF/runtime dependencies are available, run a representative `fcad report configs/examples/ks_bracket.toml` and capture the generated PDF/summary evidence.
6. If PDF/runtime dependencies are unavailable, record that explicitly and stop at the hosted-safe summary/service validations.
7. Perform a read-only skeptical review with `git diff --name-only` captured immediately before and after the review pass.

## Candidate commands

- `node tests/report-decision-summary.test.js`
- `node tests/report-service-summary.test.js`
- `node tests/report-decision-pdf.test.js`
- `node tests/report-runtime-fallback.test.js`
- `node tests/lane-manifest.test.js`
- `npm run test:node:integration`
- `npm run test:node:contract`
- `npm run test:py`
- `node bin/fcad.js check-runtime`
- `node bin/fcad.js report configs/examples/ks_bracket.toml`

## Evidence rules

- record exact commands, exit codes, and whether the dependency failure is environmental or code-induced
- treat missing `matplotlib` / PDF-render dependencies as environment limits, not as proof that the report code is broken
- classify the known `ks_bracket` create-quality, drawing-quality, and DFM findings as upstream report inputs unless this task accidentally changes those engines
- if `tests/test_manufacturing_agent_cli.py::test_markdown_docs_do_not_contain_local_paths_and_links_resolve` still fails and this task did not touch the referenced markdown path, report it as pre-existing
- confirm that missing optional artifacts are shown as `not_run` or `not_available`, never as pass
