# AF2 Job Platform Verification And Remediation

## Objective
- Verify that AF2 job-platform changes really enable tracked execution, canonical artifact continuation, and bundle-aware re-entry without recreating D/C internals.
- Repair narrow verified issues before finalization.

## Verification lanes

### Lane 1: Executor and contract coverage
- Confirm the shared executor and request validation recognize:
  - `review-context`
  - `compare-rev`
  - `readiness-pack`
  - `stabilization-review`
  - `generate-standard-docs`
  - `pack`
- Confirm failure surfaces remain machine-readable for unsupported or invalid handoffs.

### Lane 2: API, run history, and artifact surfaces
- Confirm AF2 jobs are visible through tracked-job history with coherent:
  - lifecycle states
  - retry lineage
  - logs
  - manifests
  - artifact open/download routes
- Confirm public API payloads keep path redaction behavior.

### Lane 3: Canonical artifact continuation
- Confirm tracked artifact continuation works for canonical:
  - `review_pack.json`
  - `readiness_report.json`
- Confirm continuation reuses canonical artifacts instead of recomputing D/C internals.
- Confirm lineage mismatch, missing canonical inputs, or unsupported handoffs fail closed.

### Lane 4: Bundle import recognition
- Confirm `release_bundle.zip` import detects canonical artifacts only when present in the expected bundle layout.
- Confirm bundle-backed re-entry extracts the canonical artifact needed for the requested workflow and rejects mismatched or incomplete bundles.
- Confirm auto-detected docs-manifest or config inputs only happen where the repository already has the supporting architecture.

### Lane 5: Claim audit
- Cross-check final claims against:
  - touched files
  - real tests executed
  - actual request/response shapes
  - actual tracked-job behavior
- Fix small verified gaps immediately when safe.

## Remediation rules
- Prefer thin adapter fixes over structural rewrites.
- Keep D/C logic in existing builders/workflows.
- Report unresolved gaps only when they could not be repaired safely within AF2 scope.
