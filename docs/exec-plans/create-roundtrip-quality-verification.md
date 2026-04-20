# Create Roundtrip Quality Verification

## Verification order

1. Run focused non-FreeCAD helper/schema tests for the create-quality logic.
2. Run the smallest CLI-oriented Node tests that prove default create-quality emission and strict-quality behavior without depending on a live FreeCAD launch.
3. Re-run adjacent manifest/create contract tests that should remain green.
4. If FreeCAD runtime is available, run `fcad check-runtime` and a minimal live `fcad create` smoke that proves the generated quality JSON and manifest linkage.
5. Perform a read-only skeptical review and confirm the diff is unchanged by the review pass.

## Candidate commands

- `node tests/create-quality.test.js`
- `node tests/create-quality-cli.test.js`
- `node tests/output-manifest.test.js`
- `node tests/output-manifest-cli.test.js`
- `node tests/artifact-manifest.test.js`
- `node tests/output-contract-cli.test.js`
- `npm run test:node:contract`
- `node bin/fcad.js check-runtime`
- `node bin/fcad.js create configs/examples/ks_bracket.toml`

## Evidence rules

- record exact commands and exit codes
- classify the known `tests/output-contract-cli.test.js` readiness provenance mismatch as pre-existing if it is observed again
- distinguish runtime-unavailable, skipped quality evaluation, warnings, and blocking failures explicitly
