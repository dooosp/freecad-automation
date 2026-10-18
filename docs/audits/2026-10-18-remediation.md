# Audit remediation verification — 2026-10-18

Base: `659405b3e36d01d21027f0c75db3f7e36ded159b`.
Branch: `codex/audit-remediation-20261018`. Node 24.19.0, Python 3.12.14,
Linux. This record covers the corrective code and repository SVG inventory;
it does not establish the state of a user's running Mac checkout.

Plan: [audit remediation](../exec-plans/audit-remediation-2026-10-18.md).

## Changes

- Reports bind the consumed config bytes and exact producer quality bytes to
  command/run manifests before using them for current quality or readiness.
  Missing, malformed, mismatched, failed, and error-bearing runs remain visible
  as diagnostics but cannot supply a current pass. Draw failure paths retain
  the captured input record rather than hashing a later file version.
- DFM results bind the source config, effective process/standard, and analysis
  result. Ordinary report analysis honors the configured process. Unbound or
  mismatched historical analyses cannot supply readiness.
- Studio model, drawing, and tracked jobs share JSON/TOML parsing and input
  validation. Invalid JSON returns HTTP 400. Saved preview/revision checks stay
  in force. Async parameter tests wait for observable completion.
- Canonical create/draw quality takes priority over generic summaries. Failed
  or unavailable canonical checks cannot inherit affirmative readiness, and
  report component quality cannot stand in for a missing aggregate decision.
  Unmapped dimensions and blockers are visible in English and Korean.
- URL CAD imports refresh every time, have a 30-second socket timeout, and
  replace cache files atomically after complete receipt. Failed refreshes do
  not silently import cached bytes. Design passes the expected argument array
  to create.
- Guidance distinguishes historical tasks from current behavior, declares the
  Node 24 CI baseline, and classifies review-context as runtime-conditional.
  Both public path redactors cover `/workspace` and `/root`, including embedded
  spaced paths, while retaining API route links.

PR #203 was reconciled selectively. JSON/error handling and canonical quality
display fixes were retained; already superseded STEP detection and artifact
selection were not replaced. Its portfolio reproduction code was not imported.

## Verification

- Final `npm test` (contract, integration, snapshots): **passed**, exit 0.
- `npm run test:py`: **199 passed, 16 skipped**, 53.35 seconds, using an isolated
  Python test environment. The script excludes FreeCAD runtime test files.
- Final report/CLI/DFM focused integration: **61 passed, 0 failed, 0 skipped**.
- Final defensive UI focused integration: **42 passed, 0 failed, 0 skipped**.
- Public path redaction and Stage 5B runtime-validation API tests: passed.
- Source hygiene and final whitespace checks: **passed**. Two verified synthetic
  test remnants were removed after the suite; no source or historical artifacts
  were removed.
- Chrome browser smoke: **skipped; Chrome unavailable**. FreeCAD diagnostics:
  **runtime not detected**. No native FreeCAD geometry, STEP reread, drawing,
  or PDF validation, and no paid AI call, was performed.

Behavioral fixes were tested with failing regressions first. In particular, the
review follow-up reproduced seven provenance regressions before passing all
nine targeted cases, and three conflicting UI cases before their focused suite
passed. A deliberately delayed SHA-256 operation reproduced both async test
failures; all 37 parameter tests subsequently passed with that delay.

The first full Node run exposed an existing Stage 5B API absolute-path leak.
The same assertion failed in an isolated checkout of the original base commit.
The additional public-path regression failed before the container-root fix;
both the new test and the unchanged Stage 5B test then passed.

Independent read-only review identified two important provenance findings
(failed-draw reuse and effective DFM inputs), plus minor contradictory legacy UI
states. All were addressed. The follow-up review approved the code with no
remaining critical, important, or minor findings in its scope. Its frozen staged
diff SHA-256 was `9d9a6de7fafc4bd4de4b9ae17cda10dce4929494d86a8e0f5d54a76fadf5e4d9`;
only completion documentation changed after that review. This is not a claim of
exhaustive review or runtime validation.

## SVG inventory

Nine fetched remote branch tips and six distinct tracked ZIPs yielded eleven
unique SVG originals: five master examples, two portfolio-branch A/B drawings,
and four test fixtures/snapshots. The portfolio ZIP's two SVGs were byte-identical
to the separate A/B originals. The delivery includes original paths, branch and
commit IDs, per-file last-change dates, Git blob IDs, SHA-256, and duplicate
source records. Archive contents and bytes were checked against Git originals.

Nine SVGs parsed and rendered with Inkscape. The assembly fixture and its
normalized snapshot have undeclared Inkscape namespace prefixes; both remain
unchanged and are labelled test-only. No historical SVG was rewritten.
"Latest" means checked-in branch-tip contents: April example drawings and
September portfolio drawings, not newly regenerated geometry. Mac-only files
and ignored outputs outside this checkout were not inventoried.

## Remaining boundaries

- Provenance covers config and result bytes; it does not recursively bind
  referenced CAD/URL/plan files or rule/material/profile contents.
- CLI `draw --override` has an unverified base-input hash for general report
  reuse. Save the effective config or run a fresh Studio full-quality report.
- Old manifests without quality output hashes require fresh generation before
  their quality can count as current evidence. Originals remain intact.
- These software checks and stored SVGs do not establish physical inspection,
  load capacity, or manufacturing approval. Native FreeCAD and Chrome checks
  remain necessary on a suitable target environment.
- On 2026-10-18, the user explicitly approved publishing the reviewed branch
  and a draft PR to `dooosp/freecad-automation` after the initial automatic
  approval review block. The handoff records the publication result and CI
  state. Master merge is separate; this task did not inspect or update the
  user's Mac Finder folders.
