# Engineering core: dimension identity and named anchors

Continuation of the refocus and drawing-layout work; BASE_SHA is
`d7eef128c4ffe40f61a13377d471fc7047aca6a9`.
The original refocus plan remains the scope and protection contract.
One implementer edits; parallel agents inspect and review read-only.

1. Record isolated branch, baseline checks and protected hashes in ignored
   `tmp/codex/engineering-core-dimension-anchors/` (done before implementation).
2. Add failing tests for nominal-only identity and named geometry anchors.
   Preserve explicit observed identity through SVG, dimension_map and semantic QA.
3. Resolve bounded axis-aligned primitive extents and cylindrical diameters from
   runtime shapes, final topology and the selected projection. Check every member
   of a named group. Reject removed geometry, mismatched values and context.
4. Keep offsets without an authored axis/datum, absent plan dimensions and
   unsupported geometry unresolved. Do not guess the plate slot's 42 mm datum.
   Required-note composition is a separate limitation, not part of this change.
5. Run unit/contract regressions and isolated real CAD A/B cases, plus removal,
   mismatch and translation tests. Record diagnostics without changing default
   quality policy or canonical artifacts.
6. Review cumulative BASE-to-final diff, recheck protected bytes/refs and write
   results. Keep verified changes in local commits; no remote mutation.

Test sequence for each implementation: observed failure, minimal fix, regression.
Runtime artifacts and copies must have ignored output paths before execution.
Actual CAD evidence is not physical inspection, human UAT or readiness approval.
