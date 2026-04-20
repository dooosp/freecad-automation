# Drawing QA Gates Verification

## Verification order

1. Run targeted Node tests for the new drawing-quality aggregation helper and draw strict-gate behavior.
2. Run the smallest existing draw-pipeline Node tests that should still pass without FreeCAD.
3. Run manifest/contract tests touched by the new draw artifact wiring.
4. Run `node bin/fcad.js check-runtime` to determine whether runtime-backed draw validation is available.
5. If runtime is available, run a minimal `fcad draw` command and verify `<base>_drawing_quality.json` plus related manifest output.
6. Perform a read-only skeptical review and verify the diff is unchanged by the review pass.

## Candidate commands

- `node tests/drawing-quality-summary.test.js`
- `node tests/draw-pipeline-qa-config.test.js`
- `node tests/artifact-manifest.test.js`
- `node tests/output-manifest.test.js`
- `npm test`
- `node bin/fcad.js check-runtime`
- `node bin/fcad.js draw configs/examples/ks_bracket.toml`

## Evidence rules

- record exact commands and exit codes
- distinguish runtime-unavailable from passing runtime-backed draw validation
- record generated artifact paths only when they actually exist on disk
- classify the known `ks_bracket` geometry validity issue and the known `tests/output-contract-cli.test.js` contract mismatch as pre-existing unless this task directly changes them
