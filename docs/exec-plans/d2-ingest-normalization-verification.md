# D2 ingest normalization verification and remediation

## Verification goals
- Confirm ingest remains orchestration-first.
- Confirm normalization logic sits in adapter helpers.
- Confirm inspection and quality evidence records carry normalized refs, provenance, and data quality flags.
- Confirm ambiguity and data-quality diagnostics remain visible in machine-readable output.

## Verification phases
### V1: Contract checks
- Re-run targeted ingest pytest coverage.
- Verify existing D1-shaped fields still exist on BOM, inspection, and quality records.
- Verify additive fields do not break linkage consumers.

### V2: Focused scenario coverage
- Mixed-unit inspection rows normalize numeric fields to canonical units and retain raw unit provenance.
- Ambiguous header mapping is surfaced through diagnostics and data quality flags.
- Missing location or feature hints are preserved as missing data, not silently inferred.
- Source row provenance and `source_ref` values survive into normalized evidence records.

### V3: Remediation rules
- If targeted tests fail because of regressions introduced here, fix them immediately.
- If unrelated pre-existing failures appear, report them separately with command output context.
- Prefer the smallest repair that restores the additive ingest contract.

## Exit criteria
- Targeted ingest tests pass.
- New fixtures cover mixed units, ambiguity, missing hints, and provenance retention.
- Remaining risks are documented in `tmp/codex/d2-ingest-normalization-verification-status.md`.
