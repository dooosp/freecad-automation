# Engineering core drawing layout follow-through

The drawing follow-through is implemented and verified locally. Footer notes, coherent annotation placement and evidence reporting improved. This is not complete drawing acceptance: duplicate dimensions, unsupported feature anchors and approximate layout findings remain visible.

## Scope and provenance

- Repository: `dooosp/freecad-automation`.
- Branch: `codex/engineering-core-drawing-layout-v1` in a separate clean worktree.
- BASE: `d13f47ee7ec8782529cebda9f2355c3dea05397f`, the previous local Y-axis candidate.
- Final tested code: `439057f0485ecf8f1e345a46b311f0af25fa7402`.
- Implementation commits: `a3bcbc4`, `533a277`; cumulative-review repairs: `439057f`.
- Plan: [drawing follow-through](exec-plans/2026-09-08-engineering-core-drawing-layout.md).
- Controls and RED/GREEN logs: ignored `tmp/codex/engineering-core-drawing-layout/`.

The earlier refocus and Y-axis results remain historical. This follow-through adds no AI capability, provider call, framework, manifest system or replacement CAD pipeline.

## Reduced and strengthened behavior

- Removed text-only nudging of bound annotations and truncation of long notes. Notes retain all content; an overfull region is explicitly unavailable/overflow.
- Removed arbitrary feature dimensions rendered against overall bounds. Plate thickness, slot position and standoff height retain their IDs, nominal values and REVIEW markers when feature anchors cannot be established.
- Removed feature-only and bare numeric/symbol coincidence from required-dimension presence counts. Existing named identities and aliases still work with compatible values and context.
- Reused the annotation planner for real geometry, dimension rows, coherent diameter/radius leaders and datum frames. Datum triangle anchors stay fixed while frames move clear of completed dimension extensions.
- Coalesced baseline dimensions only for the same projected endpoint and tolerance, preserving every contributing feature ID. Equal unsigned values on opposite sides remain distinct.
- Added inherited/transformed SVG traversal to existing QA. Text/line intersections, frame/region overflow and retained cell overflow are advisory findings with source references. Unsupported geometry, text context or transforms prevent a complete layout score.
- Preserved existing default/advisory/strict policy. A top-level drawing-quality PASS is not full semantic or visual acceptance.

## Validation actually run

| Check | Result |
| --- | --- |
| Baseline Node contract | FAIL at the pre-existing Bootstrap doctor document-link check |
| Baseline Python | 97 PASS, 1 FAIL, 1 SKIP; same historical link |
| Focused final Python renderer/QA regression | 57 PASS on final tested code |
| Focused final Node drawing/semantics regression | 20 PASS on final tested code |
| Final `npm run test:py` | 152 PASS, 1 FAIL, 1 SKIP; historical link failure remains |
| `npm test` | FAIL at the existing Bootstrap doctor check; no all-green claim |
| Remaining contract steps | All 104 remaining steps executed; after standard-environment boundary rechecks, total contract outcome is 116 PASS / 1 historical FAIL across 117 steps |
| `npm run test:node:integration` | PASS |
| `npm run test:snapshots` | PASS |
| `npm run test:runtime-smoke` | PASS on the candidate before the two review repairs, including real create/draw/BOM/inspect/API/export checks |
| Final engineering-core CAD harness | PASS, 34 CLI commands, zero harness errors, clean final code HEAD |
| Source hygiene, canonical package integrity, diff whitespace | PASS |

The standard Node command stops at the historical failure; the continuation invokes the unchanged remaining manifest steps. Forcing non-CAD boundary tests into an ignored in-repository TMPDIR initially changed their repository/outside-repository classification. Inspection onboarding, revision-impact service and release-bundle tests all passed when rerun with their standard OS temporary directory. No product criterion or assertion was weakened. CAD config/output copies and CAD temporary outputs remained isolated in ignored directories before execution.

The existing document failures point into ignored output paths in `docs/engineering-core-refocus-results.md` (18 links reported by Bootstrap doctor). Neither that historical document nor its checkers was changed. Test command logs and exit codes are in `final-tests.json`, `contract-continuation.json`, and `logs/post-review-*` under the control directory; the boundary rechecks have `boundary-default-*` logs.

## Actual FreeCAD results

Final run: `output/engineering-core-refocus/runtime-1788867994077-84376/results.json`. It records code SHA `439057f0485ecf8f1e345a46b311f0af25fa7402`, `dirty_at_start: false`, input hashes and validated output/artifact manifests. Runtime: FreeCAD 1.1.3, bundled Python 3.11.14, Node 25.8.0 on macOS.

| Part | A to B change | Create / drawing top-level A and B | Engineering observations per revision | Required dimension identity coverage | Semantic advisory decision |
| --- | --- | --- | --- | --- | --- |
| quality-pass-bracket | Left hole 6 to 7 mm | PASS / PASS | 8 PASS, none unavailable | 2 / 2 | pass |
| plate-with-holes | Four mounting holes 4 to 5 mm | PASS / PASS | 16 PASS, none unavailable | 1 / 9 | needs_attention |
| hinge-block | Mounting holes 6 to 7 mm; Y pins stay 8 mm | PASS / PASS | 16 PASS, including Y observations | 2 / 2 | needs_attention (required notes) |

STEP and BREP reimports remain valid; BREP volume and bounding-box deltas are zero. The three A/B comparisons detect intended feature/nominal changes, reproduce identical JSON/Markdown with fixed timestamps, and return `reinspection_required`.

All five real injected geometry errors are detected: Z diameter, Z center, Y diameter, Y X-center and Y Z-center. The axial Y-origin invariance probe passes. Default create exit codes remain warning-oriented while quality artifacts report the injected failures. These are CAD observations, not physical inspection.

### Final drawing review

Six unchanged final SVGs were rendered as complete 1800 by 1350 Chrome captures and inspected by the assistant. Captures and provenance are under `tmp/codex/engineering-core-drawing-layout/screens/runtime-1788867994077-84376/`; supplementary hashes and observations are in `drawing-review.json`. The runtime harness itself retains visual review NOT_RUN because image inspection is recorded separately.

- Full sheet borders, right views and title blocks are visible; no thumbnail clipping is counted as a source drawing defect.
- Notes are inside the declared footer region in all six cases. The old footer-line crossing and overlapping BBox/SIZE label are resolved.
- Bracket right-hole callouts clear the overall vertical dimension. Duplicate auto/plan and baseline/chain dimensions remain because the source explicitly disables auto/plan deduplication.
- Plate's out-of-frame 42 mm line is replaced by an in-sheet REVIEW marker. THK and STANDOFF_HEIGHT also remain REVIEW. Repeated projected baseline endpoints are coalesced; some duplicate overall dimensions remain.
- Hinge datum A frames clear the dense baseline extensions. The 8 mm pin labels remain present and the mounting-hole A/B labels show 6/7 mm.
- Bounded QA still finds close text/symmetry-line interactions: plate A/B has 3/4 text-line findings; hinge A/B has 2/2; bracket has none. These use estimated text bounds. All six have partial evidence and a null full-layout score because curved boundaries are unsupported.

Drawing review is **IMPROVED_WITH_OPEN_ITEMS**, not human UAT or manufacturing acceptance. Required semantic ID linkage and unsupported anchors are not solved by merely moving labels.

## Changed files

| Area | Files |
| --- | --- |
| Existing annotation/rendering helpers | `scripts/_annotation_planner.py`, `scripts/_dim_baseline.py`, `scripts/_dim_plan.py`, `scripts/_drawing_svg.py`, `scripts/generate_drawing.py` |
| Existing SVG QA and repair | `scripts/svg_common.py`, `scripts/qa_scorer.py`, `scripts/svg_repair.py` |
| Existing drawing quality consumers | `src/services/drawing/drawing-quality-summary.js`, `src/services/drawing/layout-readability.js` |
| Regression coverage | `tests/test_dimension_layout.py`, `tests/test_notes_layout.py`, `tests/test_plan_dimension_layout.py`, `tests/test_radius_vertical_layout.py`, `tests/test_datum_layout.py`, `tests/test_qa_signal_quality.py`, `tests/drawing-layout-readability.test.js`, `tests/drawing-quality-summary.test.js`, `tests/engineering-core-runtime.test.js` |
| Documentation | `docs/exec-plans/2026-09-08-engineering-core-drawing-layout.md`, this results document |

## Protection, review and limits

The 172 protected files under `docs/examples/` retain their initial SHA256 values. Canonical packages, readiness, inspection records and human UAT are neither edited nor approved. The original dirty checkout and prior refocus/Y-axis and PR #199/#201 branch refs are unchanged. Verification is read-only against those workspaces.

Independent review covers the entire BASE-to-code-HEAD patch, not an empty working-tree diff. It found two P2 defects (generic diameter-symbol identity and missing diameter-overflow evidence); both received failing regression tests and fixes. Re-review found no additional confirmed actionable issue. Before/after names and patch hashes were identical; the final 20-file code/plan/test patch hash was `02d1d6c7a35b78a3fd2fa279a85723d97c0b2711c3bafd6674eddd4c78d0b700`. The final report addition is reviewed with the cumulative patch separately and recorded in the ignored controls.

Remaining limits:

- Named feature anchors for plate thickness, connector slot position and standoff height are unavailable to the current plan renderer. No fabricated overall extent substitutes for them.
- Dimension identity coverage is conservative: a visible number without established requirement linkage is insufficient. The older extracted-semantics sidecar can still make advisory numeric guesses, such as associating an unrelated 18 with a slot size; the quality summary does not promote those guesses to presence counts.
- Multiple circles of equal radius do not prove which named feature a plan callout selects. Circle matching verifies the diameter, not complete feature identity.
- Text bounds are approximate. Curves, stylesheet cascade, clipping/filter contexts and unsupported transforms/rotated regions remain partial/unsupported; no full layout score or universal collision-free claim is made.
- Drawing PDF verification is NOT_RUN; report PDFs do not substitute for drawing PDFs. No human UAT or physical inspection ran.
- Ignored quality/drawing sidecars remain excluded from canonical evidence attachment by the existing path policy.

All changes are local commits. No push, PR operation, merge, release, deployment, secret inspection or real AI provider call was performed.
