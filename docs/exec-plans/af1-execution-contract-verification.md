# AF1 Execution Contract Verification And Remediation

## Objective
- Verify the shared A+F execution contract, canonical artifact recognition, and artifact re-entry behavior.
- Repair task-local regressions before finalization.

## Verification lanes

### Lane 1: Shared contract validation
- Confirm shared validators accept the supported job kinds and lifecycle states.
- Confirm artifact identity validation requires schema version, lineage markers, and source artifact refs where the contract expects them.
- Confirm machine-readable failures are emitted for missing lineage, schema mismatch, and invalid artifact handoff.

### Lane 2: CLI and job-surface coverage
- Verify the review/readiness/docs/pack/compare CLI paths use the shared contract instead of ad hoc routing.
- Verify job executor and job store surfaces track the allowed states only.
- Verify tracked-job and reopen surfaces preserve current behavior apart from explicit contract enforcement.

### Lane 3: Canonical artifact re-entry
- Verify canonical re-entry targets are recognized and validated:
  - `review_pack.json`
  - `readiness_report.json`
  - `release_bundle.zip`
- Verify lineage mismatch or unsupported compatibility markers fail closed.
- Verify intentionally supported compatibility paths still work when they already existed.

### Lane 4: Contract regression audit
- Cross-check final claims against actual changed files, executed tests, and real code paths.
- Fix small verified issues immediately when safe.
- Report any unresolved gap only if it could not be safely repaired within scope.

## Remediation rules
- Prefer narrow contract repairs over rewrites.
- Do not add new artifact entrypoints beyond the defined canonical set.
- Do not move D/C reasoning into A+F while fixing validation or routing gaps.
