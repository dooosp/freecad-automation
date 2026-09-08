# Engineering core dimension identity and named anchors

The bounded dimension-anchor continuation is implemented and verified locally.
Plate thickness and standoff height now use observed final FreeCAD boundaries.
Drawing QA requires coherent feature identity instead of promoting matching text,
nominal values or stale plan rows to observed coverage. Remaining drawing gaps
stay visible; this is not complete drawing acceptance or manufacturing approval.

## Scope and provenance

- Repository: `dooosp/freecad-automation`.
- Branch: `codex/engineering-core-dimension-anchors-v1`, isolated worktree.
- BASE: `d7eef128c4ffe40f61a13377d471fc7047aca6a9`, the previous drawing-layout candidate.
- Final tested code: `018d1f09b6b602c40baa4b7d4bc3834715b2db7b`.
- Plan: [dimension identity and named anchors](exec-plans/2026-09-08-engineering-core-dimension-anchors.md).
- Original scope/protection contract: [engineering core refocus](exec-plans/2026-09-06-engineering-core-refocus.md).
- Preflight, hashes and RED/GREEN logs: ignored `tmp/codex/engineering-core-dimension-anchors/`.

The previous refocus, Y-axis and drawing-layout results remain historical.
This phase adds no AI prompt/provider capability, framework, manifest system or
replacement CAD pipeline. It reuses the drawing generator, output-manifest,
create-quality, drawing-quality and revision-impact services.

## Reduced and strengthened behavior

- Removed nominal-only, numeric/symbol-only and named-text-only promotion to
  observed required-dimension identity. Legacy trace links and aggregate coverage
  cannot manufacture missing feature evidence.
- Added bounded named primitive anchors. Original primitives select the locus;
  retained external final faces/edges establish the actual extent or cylindrical
  cavity. Every member of a named group must survive and agree. Removed, covered,
  mismatched, extended or unsupported geometry remains unresolved.
- Retained model endpoints, projection endpoints, measurement meaning, named
  features, emitted dimension ID and run-local topology witnesses through SVG,
  dimension_map and extracted semantics. Nominal values corroborate observations;
  they do not replace measurement.
- Checked visible SVG context, declared units/values, member evidence and identity
  together. Hidden labels, unsupported contexts and conflicting duplicate IDs do
  not satisfy either semantic coverage or the main required-dimension gate.
- Kept projection origins tied to the whole view. Named feature anchors respect
  authored placement, preventing a right-side thickness label from using the
  plate's left boundary and landing inside the part.
- Preserved default/advisory versus explicit strict behavior and existing
  tolerances. More conservative diagnostics do not imply a stricter default exit
  policy or relaxed criteria for unsupported input.

## Validation actually run

Each implementation and review repair has a failing test/log before its fix and
a passing regression afterward. Positive Node observation fixtures are explicitly
synthetic unit data; they are not runtime or physical inspection evidence.

| Check | Observed result |
| --- | --- |
| Baseline `npm test` | FAIL at pre-existing Bootstrap doctor docs alignment |
| Baseline Python | 152 PASS, 1 FAIL, 1 SKIP |
| `npm test` after implementation | FAIL at the same Bootstrap doctor check |
| Full 118-step contract continuation | Raw run: 116 PASS, 2 FAIL; started at `2965b67` while the last TDD repair was underway |
| Contract failure #40, dimension identity | RED captured during repair; PASS at final `018d1f0` |
| Contract failure #13, Bootstrap doctor | Existing protected historical document links; unresolved |
| Final focused Node checks | Dimension evidence, quality summary and extracted semantics PASS at `018d1f0` |
| Broader focused regressions | Eight Node commands PASS, including workflow, semantic regression, revision impact and reporting |
| `npm run test:node:integration` | PASS |
| `npm run test:snapshots` | PASS |
| Final `npm run test:py` | 154 PASS, 1 FAIL, 7 SKIP |
| FreeCAD bundled Python named-anchor tests | 6 PASS with actual FreeCAD geometry |
| Source hygiene and cumulative whitespace checks | PASS |

The raw contract record is retained unchanged in `contract-final.json`; the final
repair checks are in `post-review-checks.json`. Across per-step results and the
repair recheck, 117 contract steps have passing evidence and the historical
Bootstrap failure remains. This is not a single all-green full-suite run.

Bootstrap doctor reports 18 ignored-local-output links in the protected
`docs/engineering-core-refocus-results.md`. Python's one failure is
`test_markdown_docs_do_not_contain_local_paths_and_links_resolve`, which encounters
the absent historical `runtime-1788784398007-44635/results.json` link. Neither the
historical document nor its checkers was changed. Six normal-Python skips are the
new FreeCAD-dependent tests, separately executed successfully with FreeCAD's
bundled Python; the other skip predates this phase.

## Actual FreeCAD results

The complete driver at clean code `2965b678b2ce1ec9ef869f8c647bcf988da426a3`
executed 42 CLI commands, including actual CAD generation/reimport/drawing,
comparisons and runtime diagnostics, with zero command or harness failures.
Its record is `output/engineering-core-refocus/runtime-1788870907962-56536/results.json`.
After the final duplicate-ID quality-gate repair, six additional actual FreeCAD
draw commands passed at `018d1f0`; the record is
`output/engineering-core-dimension-anchors/recheck-1788871178250/results.json`.
Runtime: FreeCAD 1.1.3 revision 20260725, Node 25.8.0 on macOS.
Every trial config had its output redirected into ignored storage before execution.

| Part | A to B change | Create / drawing A and B | Engineering checks per revision | Observed required dimensions per revision | Semantic advisory |
| --- | --- | --- | --- | --- | --- |
| quality-pass-bracket | Left hole 6 to 7 mm; right stays 10 mm | PASS / PASS | 8 PASS | 2 / 2 | needs_attention |
| plate-with-holes | Four mounting holes 4 to 5 mm | PASS / PASS | 16 PASS | 5 / 9, previously 1 / 9 | needs_attention |
| hinge-block | Mounting holes 6 to 7 mm; Y pins stay 8 mm | PASS / PASS | 16 PASS | 2 / 2 | needs_attention |

Generated shape validity, STEP/BREP reimport validity and measured round trips
passed; existing STL checks passed. All three A/B comparisons detected intended
changes, reproduced deterministic JSON/Markdown and returned
`reinspection_required`. Five real geometry injections were detected: Z-hole
diameter, Z-hole XY center, Y-hole diameter, Y-hole X center and Y-hole Z center.
The Y-axis origin shift from 28 to 29 mm preserved the observed result.

Eight additional anchor scenarios passed their expected assertions:

| Scenario | Actual outcome |
| --- | --- |
| Plate thickness 4 to 5 mm | Final boundary measures 5 mm |
| Four standoff heights 8 to 10 mm | Every named member measures 10 mm |
| One standoff height mismatch | Group rejected as unresolved |
| Nominal THK 6 with actual thickness 4 mm | Nominal does not create 6 mm geometry or coverage |
| Removed boss | Missing final geometry rejected |
| Duplicate dimension ID | Ambiguous identity rejected |
| Whole model translation by 10, 20, 30 mm | Projection retained; thickness UV bounds become 155, 30, 155, 34 |
| Wrong view | Unsupported measurement/view combination rejected |

The six full-sheet SVG captures from the 42-command run were inspected by the
assistant. They are under
`tmp/codex/engineering-core-dimension-anchors/screens/runtime-1788870907962-56536/`.
Plate thickness and height placement now remain outside the intended boundary;
the unsupported slot-position REVIEW marker remains visible. Existing duplicate
auto/plan dimensions remain. This separate image inspection does not change the
runtime notes' `visual layout NOT_RUN` or represent human UAT. Plate A/B and hinge
A/B still have layout warnings for text/line overlap. All six layouts retain
partial completeness and a null score; the top-level PASS does not clear these
observed warnings.

## Changed files

| Area | Files |
| --- | --- |
| Runtime anchors and renderer | `scripts/_dimension_anchors.py`, `scripts/_dim_plan.py`, `scripts/generate_drawing.py` |
| Evidence qualification and QA | `lib/drawing-dimension-evidence.js`, `src/services/drawing/extracted-drawing-semantics.js`, `src/services/drawing/drawing-quality-summary.js`, `schemas/extracted-drawing-semantics.schema.json` |
| Runtime and Python regressions | `tests/engineering-core-runtime.test.js`, `tests/test_named_dimension_anchors.py`, `tests/test_plan_dimension_layout.py` |
| Node regressions | `tests/drawing-dimension-evidence.test.js`, `tests/extracted-drawing-semantics.test.js`, `tests/drawing-quality-summary.test.js`, `tests/drawing-semantic-regression.test.js`, `tests/helpers/dimension-observation.js`, `tests/lane-manifest.js` |
| Synthetic expectations | Four JSON files under `tests/fixtures/drawing-semantics/`: the two `ks_bracket` expectations and the `slot_hole_pattern_semantics_case` / `unsupported_semantics_case` suites |
| Documentation | This report and `docs/exec-plans/2026-09-08-engineering-core-dimension-anchors.md` |

The expectation updates reject unsupported or nominal-only coverage and explicitly
identify positive mock observations. They do not edit historical inspection evidence.

## Protection, cumulative review and remaining limits

All 176 protected file hashes are unchanged, including 172 files under
`docs/examples/`, the representative canonical bracket config and three historical
results documents. Canonical packages, readiness, inspection evidence and human
UAT were neither modified nor approved. The original dirty checkout, prior local
candidate worktrees and five protected branch refs, including PR #199/#201
branches, remain unchanged.

Independent final code review covered the complete 21-file BASE-to-`018d1f0`
patch. Review findings received RED/GREEN repairs; the final review reported no
additional confirmed actionable finding in the reviewed scope. Before/after HEAD,
working diff names, cumulative file names and patch hash matched. Code patch
SHA256: `93e822a90a10dd955fc65b3fb47543455a1e7a2f3d6f1aca4990f8f5d9ed4b72`.
The report addition is reviewed separately with the cumulative patch; records are
kept under the ignored control directory.

- Named anchors cover bounded axis-aligned primitives and supported projections,
  not arbitrary BRep features, arbitrary boolean lineage or every CAD dimension.
  Topology indices are run-local witnesses, not persistent cross-revision IDs.
- Plate mounting-pattern X/Y, connector-slot size and slot position remain
  unresolved. The 42 mm slot position lacks an authored axis/from-to datum.
- Plate PROCESS/TRACEABILITY and hinge EVIDENCE_BOUNDARY notes remain absent.
  Required-note composition is deliberately outside this phase.
- Conceptual critical-feature groups are not proven solely by dimension counts or
  old trace links. Removing that inference leaves all three parts' semantic
  advisory decision at `needs_attention`, even when the existing top-level quality
  status is PASS.
- SVG context qualification is bounded; unsupported styles/transforms/contexts
  remain unqualified. Approximate layout QA and unsupported curved boundaries do
  not establish a complete layout score or collision-free drawing.
- Drawing PDF verification, physical inspection and human UAT are NOT_RUN.
  No readiness or manufacturing acceptance is inferred from runtime observations.
- Ignored sidecars are excluded by the existing portable-path evidence policy.
  Supplying A sidecars with the B model therefore gives unavailable linkage; it
  does not demonstrate checksum-based stale-evidence rejection.

Local implementation commits are `cd43ccf`, `5db15e4`, `2965b67` and `018d1f0`;
this report is committed afterward. No push, PR creation/update/merge, release,
deployment, secret inspection or real AI API call was performed.
