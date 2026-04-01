# D4 Verification and Remediation

## Verification Focus
- Verify hotspot-level linkage is produced for inspection and quality evidence.
- Verify ambiguity, confidence, reason codes, and evidence refs are explicit.
- Verify score breakdowns exist for ranked hotspot decisions.
- Verify recommendations target hotspots and remain evidence-backed.
- Verify downstream review-pack generation still works with the richer payload.

## Verification Steps
1. Run focused linkage tests around `scripts/quality_link.py`.
2. Run review-pack regression coverage that consumes the linkage outputs.
3. Run CLI workflow coverage if the linkage payload contract changed in persisted artifacts.
4. Inspect any failures and classify them as:
   - pre-existing
   - introduced during D4
   - fixture/contract drift that needs remediation

## Remediation Rules
- Prefer fixing small contract drift immediately.
- Do not broaden into unrelated rendering or UI work.
- If an existing assertion is too category-centric for the new hotspot contract, update it narrowly and keep coverage on legacy-compatible summary fields where they still matter.

## Exit Criteria
- Focused linkage tests pass.
- Reporting/CLI consumers touched by the new contract pass.
- Any untested edge remains explicitly called out in the final report.
