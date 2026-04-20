# Output Manifest Foundation Verification

## Verification order

1. Run targeted helper tests for the new output-manifest module.
2. Run the smallest CLI integration test that proves automatic manifest emission without FreeCAD.
3. Run the existing manifest-related Node tests that should remain green.
4. Run `fcad check-runtime` only if FreeCAD is available, then a minimal runtime-backed smoke for one command if practical.
5. Perform a read-only skeptical review and confirm the diff is unchanged by that review pass.

## Candidate commands

- `node tests/output-manifest.test.js`
- `node tests/output-manifest-cli.test.js`
- `node tests/artifact-manifest.test.js`
- `node tests/stdout-manifest-cli.test.js`
- `node tests/output-contract-cli.test.js`
- `npm run test:node:contract`
- `node bin/fcad.js check-runtime`

## Evidence rules

- record exact commands and exit codes
- distinguish runtime-unavailable from passing validation
- note any pre-existing failures separately from task-introduced failures
