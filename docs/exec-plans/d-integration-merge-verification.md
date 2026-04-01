# D Integration Merge Verification

## Required Validations
- `node -e "import('./lib/d-artifact-schema.js').then(()=>console.log('schemas-reloaded: ok'))"`
- `node tests/d-artifact-schema.test.js`
- `node tests/artifact-manifest.test.js`
- `node tests/run-node-lane.js contract`
- `node tests/check-runtime.test.js`
- `node tests/runtime-health-parity.test.js`
- `python3 -m py_compile scripts/d_artifact_contract.py scripts/analyze_part.py scripts/quality_link.py scripts/reporting/review_templates.py scripts/reporting/review_pack.py scripts/reporting/revision_diff.py scripts/ingest_context.py scripts/adapters/*.py scripts/geometry/*.py scripts/linkage/*.py scripts/decision/*.py`
- `python3 -m pytest -q tests/test_ingest.py tests/test_analyze_part.py tests/test_linkage.py tests/test_review_pack.py tests/test_cli_workflow.py`

## Failure Handling
- Diagnose whether failures come from integration conflicts or environment issues.
- Repair task-local integration problems immediately.
- Do not claim a validation passed unless the command actually succeeded.
