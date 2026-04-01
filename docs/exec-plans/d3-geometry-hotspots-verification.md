# D3 geometry hotspots verification and remediation

## Verification goals
- Confirm analyze-part emits geometry facts, derived features, and stable hotspot records without dropping legacy summaries.
- Confirm hotspots are entity-aware and include `hotspot_id`, `reason_codes`, and `evidence_refs` when applicable.
- Confirm metadata-only fallback remains operational without FreeCAD runtime requirements.
- Confirm downstream linkage continues to function with the enriched geometry artifact.

## Verification phases
### V1: Contract checks
- Re-run targeted analyze-part, linkage, and CLI workflow tests.
- Verify legacy `metrics`, `features`, and hotspot categories still exist where downstream consumers expect them.
- Verify new fields are additive and machine-readable.

### V2: Focused scenario coverage
- Stable hotspot IDs remain unchanged for equivalent geometry inputs.
- Repeated entity-aware patterns produce distinct hotspots instead of a single collapsed category bucket.
- Hotspots include explicit reason codes and matched evidence refs when inspection or quality evidence is available.
- Metadata-only fallback still succeeds when geometry path/runtime access is absent.

### V3: Remediation rules
- Fix regressions introduced by this task immediately.
- Report unrelated pre-existing failures separately if they appear during targeted validation.
- Prefer the smallest repair that preserves the additive D-stage contract.

## Exit criteria
- Targeted analyze-part/linkage validations pass.
- New tests cover hotspot stability, evidence/reason-code presence, metadata-only fallback, and category-collapse regression.
- Remaining risks are documented in `tmp/codex/d3-geometry-hotspots-verification-status.md`.
