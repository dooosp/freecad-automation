# Legacy Viewer Isolation Verification

## Mission
Verify that the legacy viewer isolation task actually landed in the intended repo, on the intended surfaces, with compatibility-only positioning and without overstating validation coverage.

## Non-Negotiables
- Keep `serve:legacy` available.
- Do not break documented legacy websocket message action names.
- Do not claim runtime, websocket, browser, or smoke verification unless it actually ran.
- Keep fixes minimal, safe, and scoped to verified gaps.
- Do not create an empty remediation commit.

## Phase 0 Repo Control Verification
- Confirm repo identity records point to the `freecad-automation` git root.
- Confirm control files live under that repo root.
- Confirm the status files track repo identity, diff snapshots, phases, validations, failures, repairs, and remaining risks.
- Confirm the working tree state described in the status file matches actual git state.

## Phase 1 Claim Audit
- Read `AGENTS.md`, the execution plan, and `tmp/codex/legacy-viewer-isolation-status.md`.
- Compare claimed changed surfaces with actual diffs.
- Compare claimed implementation decisions with actual code and docs.
- Correct any over-claims about isolation, compatibility framing, or validation coverage.

## Phase 2 Leftover Gap Audit
- Search for legacy serve references and browser-facing wording that still positions the legacy viewer as a peer-primary surface.
- Verify any remaining English-only or legacy-first strings are intentional and explained.
- Flag docs or wrappers that still invite new development on the legacy path.

## Phase 3 Runtime/Path Verification
- If runtime execution is possible, run the legacy server entry and check `/api/examples` plus static asset responses.
- Record exactly what was or was not exercised.
- Do not claim websocket action verification unless those paths were actually exercised.

## Phase 4 Minimal Fixes
- Apply only verified, low-risk fixes needed to align code, docs, and status-file claims.
- Re-run the smallest relevant validations after each fix.
- Update `tmp/codex/legacy-viewer-isolation-verification-status.md` with findings and repairs.

## Phase 5 Final Report
- Confirm the final read-only review did not change the diff snapshot.
- Report actual validations, leftovers, remaining risks, and any pre-existing or intentionally preserved legacy wording.
