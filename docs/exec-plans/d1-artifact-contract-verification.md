# D1 Artifact Contract Verification and Remediation

## Objective
- Verify canonical D artifact schemas, validation paths, and review-pack outputs.
- Repair any task-local contract regressions before finalization.

## Verification lanes

### Lane 1: Schema helper validation
- Confirm shared validation helper compiles and validates the new D schemas.
- Confirm validation errors include artifact type and field-level diagnostics.

### Lane 2: Artifact producer coverage
- Verify:
  - `analyze-part` writes valid geometry and hotspot artifacts
  - `quality-link` writes valid linkage and priority artifacts
  - `review-pack` writes valid canonical review-pack JSON before Markdown/PDF
  - `compare-rev` writes valid revision comparison JSON

### Lane 3: Golden contract stability
- Compare focused fixtures or snapshots for review-pack and related D artifacts.
- Update snapshots only when contract changes are intentional and documented.

### Lane 4: CLI remediation
- Exercise CLI error handling for schema failures.
- Ensure failures remain explicit and actionable without broad CLI redesign.

## Remediation rules
- Fix task-local schema or contract regressions immediately when safely possible.
- Avoid unrelated refactors while repairing validation or snapshot failures.
- If validation coverage is missing, add the smallest focused tests or fixtures needed to lock the contract.
