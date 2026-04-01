# D5 Review Orchestration Verification And Remediation Plan

## Scope
- Verify the D5 implementation for canonical review-pack behavior, evidence-driven revision diffing, and flagship `review-context` orchestration.

## Verification Passes

### Pass 1: Canonical Review-Pack Contract
- Confirm `review_pack.json` is the source of truth for the reporting payload.
- Confirm Markdown and PDF are rendered from the canonical JSON representation.
- Verify required sections are present when evidence exists.
- Verify English fallback and partial-evidence behavior remain safe.

### Pass 2: Revision Diff Explanations
- Verify `compare-rev` explains change reasons, not just category deltas.
- Confirm the output includes the expected reason-oriented sections when applicable:
  - `new_hotspots`
  - `resolved_hotspots`
  - `shifted_hotspots`
  - `evidence_added`
  - `evidence_removed`
  - `action_changes`
  - `confidence_changes`
- Verify baseline/candidate provenance and revision metadata remain clear.

### Pass 3: Review-Context Orchestration
- Verify `fcad review-context` runs the intended D-stage steps in order.
- Confirm it writes the canonical review-pack artifact set.
- Confirm optional compare-rev support behaves safely when baseline input is absent.
- Confirm individual commands remain available and unchanged as standalone debugging tools.

### Pass 4: Test Coverage
- Run the smallest focused Python and CLI tests that cover the touched behavior.
- Separate pre-existing failures from D5 regressions.
- Repair any D5 regressions before finalization.

## Remediation Rules
- Prefer the smallest fix that restores the intended contract.
- Do not widen scope into unrelated refactors.
- Preserve metadata-only fallback behavior when evidence inputs are incomplete.
- If a validation gap remains, report it explicitly in the status file and final summary.
