# Engineering core drawing notes results — 2026-09-09

The explicit-note continuation is implemented and locally verified. Required
notes now survive final drawing composition, and quality checks require their
visible bodies in the current SVG. This is a bounded continuation of the original
refocus plan, not a new CAD or quality platform. Manufacturing approval remains
outside these results.

## Baseline and scope

- Branch: `codex/engineering-core-drawing-notes-v1`, fresh isolated worktree.
- BASE_SHA: `14219e8b8de5e98f4529f525b9dcb85a8d846502`, the verified local
  dimension-anchor continuation. Earlier refocus work was retained.
- Final code SHA: `c5f91e55ac995628eef7df084bb8505a3794a893`.
- Task plan: [explicit drawing notes](exec-plans/2026-09-09-engineering-core-drawing-notes.md).
- Original plan: [engineering core refocus](exec-plans/2026-09-06-engineering-core-refocus.md).
- Repository identity, default branch, available commands, git state and existing
  worktrees were checked before implementation. Dependencies were installed with
  `npm ci --ignore-scripts`; package files were unchanged.

## Behavior changes

Existing plan/basic notes keep their order. Explicit required note bodies are
appended without inventing instructions or material/process specifications.
Optional, empty and duplicate content is skipped; same-category distinct text is
retained. Logical note indices survive wrapping and repair.

The final SVG, including inherited visibility and note identity, is the note
evidence source. ID-only text, wrong or negated bodies, hidden content, conflicting
IDs and stale sidecar matches cannot prove required notes. Material and tolerance
shorthand remains narrowly compatible with the authored value. Material title
block pairing cannot consume a line from a grouped logical note and thereby
qualify only the remaining body.

The reserved footer can use two columns when the existing single-column estimate
does not fit and width permits it. Font size and declared boundaries are retained;
excess content remains an overflow. Note convention QA uses that declared region,
while legacy SVG without one retains its existing limit.

The existing drawing-quality, extracted semantics, output-manifest, create-quality
and revision-impact paths are reused. No AI API, prompt expansion, new framework,
canonical config change or readiness approval was introduced.

## Actual CAD observations

The complete isolated runtime harness ran at
`d8a5e8d4404c8fff30a7291f9729fafdbc564b86` using FreeCAD 1.1.3 on macOS.
All 42 CLI commands exited zero: runtime check 1, create 12, draw 14,
review-context 9 and compare-rev 6. Results contain no errors.

After review repairs, all six A/B drawings were regenerated at final code SHA
`c5f91e55ac995628eef7df084bb8505a3794a893` into a fresh ignored directory.
All six passed drawing quality, had no note overflow and reported zero note
convention violations. This final recheck did not repeat all 42 commands.

| Part | A → B change | Create / drawing quality, A and B | Observed engineering checks per revision | Required dimensions | Required notes |
| --- | --- | --- | --- | --- | --- |
| Bracket | Left hole diameter 6 → 7 mm; right remains 10 mm | pass / pass | 8 pass | 2/2 | 1/1 |
| Plate | Four hole diameters 4 → 5 mm | pass / pass | 16 pass | 5/9 | 3/3 |
| Hinge | Mounting holes 6 → 7 mm; Y-axis pins remain 8 mm | pass / pass | 16 pass | 2/2 | 2/2 |

The six create cases observed valid generated shapes and valid STEP/BREP
reimports, with zero reported volume/bounding-box differences. Existing STL checks
passed. Three deterministic A/B comparisons passed and retained
`reinspection_required`; ignored local sidecars did not become canonical evidence.

Five geometry-error cases were detected: Z-hole diameter and XY center, plus
Y-hole diameter, X center and Z center. The Y-origin invariance case passed. Eight
existing dimension-anchor cases passed, covering changed thickness/height,
height mismatch, nominal-only input, removed boss, duplicate identity,
translation and wrong view.

Three additional **artifact fault injections** edited the actual plate A SVG:
PROCESS removal, hiding and substitution of machining with casting. All three
dropped required-note coverage from 3 to 2 despite the old note sidecar. These are
SVG evidence tests, not physical inspection or proof of a manufacturing process.

Ignored evidence locations, intentionally recorded without live Markdown links:

- Full CAD run: `output/engineering-core-refocus/runtime-1788952557886-8926/results.json`.
- Intermediate six-draw recheck at `0e2fd98`: `output/engineering-core-drawing-notes/recheck-1788952770478/results.json`.
- Final six-draw recheck: `output/engineering-core-drawing-notes/final-1788952980135/results.json`.
- Logs, preflight, protection hashes and visual review: `tmp/codex/engineering-core-drawing-notes/`.

## Tests and review

Implementation followed failing test, observed failure, minimum repair and
regression checks. Initial note-evidence negatives failed before the fix; later
review regressions separately reproduced authored-value/identity handling,
declared footer bounds and logical-note consumption before correction.

| Check actually executed | Result and version boundary |
| --- | --- |
| `node --test tests/drawing-note-evidence.test.js` | 34 pass at final code SHA |
| Extracted drawing semantics, drawing-quality summary, drawing semantic regression | pass after the final repair |
| Focused Python note layout, dimension layout and QA tests | 43 pass at `0e2fd98`; Python unchanged afterward |
| Dimension evidence, drawing intent, draw pipeline, revision semantic adapters and engineering workflow targeted checks | pass during this phase |
| `npm run test:node:integration` | 24 steps pass at `d8a5e8d` |
| `npm run test:snapshots` | 2 steps pass at `d8a5e8d` |
| `npm test` | FAIL, same baseline bootstrap-doctor historical-link failure at step 13 |
| Remaining contract steps, unchanged manifest commands | 106/106 pass after the official run stopped; together with the first 12, 118/119 steps passed |
| `npm run test:py` | FAIL: baseline 154 pass / 1 fail / 7 skip; broad rerun at `d8a5e8d` 158 pass / 1 fail / 7 skip |
| Source hygiene and cumulative `git diff --check` | pass |

The continued contract run started at `d8a5e8d` and overlapped later repairs;
it is not an immutable final-SHA full-suite run. Changed paths were checked again
at the later SHAs as listed above. One attempted semantic regression command used
a nonexistent pluralized filename; the correct manifest command was then run and
passed. This was a command-selection error, not a product test failure.

Both broad-suite failures concern protected historical results referring to
absent ignored output from an earlier worktree. Those records were neither edited
nor supplied with fabricated artifacts. Seven skipped Python cases remain skips;
the focused and actual-CAD results do not silently convert them into passes.

Read-only reviews covered the cumulative BASE-to-code patch, not just the empty
working diff. Four P2 findings from successive reviews were reproduced and fixed.
The final Node review passed at `c5f91e5`; Python review passed at `0e2fd98` with
no later Python edits. Review file lists and patch hashes were unchanged before
and after each review. The final cumulative code patch contains 12 files and has
SHA-256 `d7af7e1fc6c0f3a6be8c029bbbb9d94d347e65e26b56516f15d63fcaad449941`.
This results document is the additional thirteenth file.

## Visual inspection and remaining limits

The root agent inspected all six rendered A/B SVG screenshots from the complete
CAD run. Required notes fit inside the footer; the plate and hinge use a second
column without colliding with the legend or title block. Screenshots represent
`d8a5e8d`; subsequent changes affect qualification and QA, not the renderer.
The harness itself correctly records visual review as NOT_RUN; the separate
agent inspection is recorded in `drawing-review.json` without rewriting history.

All six semantic decisions remain advisory/needs_attention: conceptual critical
feature groups are not fully proven. The plate's X/Y hole spacing and connector
slot size/position remain four unknown required dimensions. The slot-position
REVIEW marker, dense/repeated dimensions and existing plate/hinge text-line
overlap remain. Bounded annotation completeness stays partial, with no complete
layout score for curved boundaries.

The SVG note scanner is bounded to supported plain-text contexts and logical
groups; arbitrary nested text markup, external CSS and universal SVG rendering
semantics are not covered. Content beyond the reserved two-column capacity still
overflows. Note presence proves the displayed instruction only, not material
certification, actual machining, traceability operation or inspection.

PDF inspection, human UAT, physical part inspection and manufacturing approval
were NOT_RUN. No unsupported input was passed by weakening thresholds.

## Changed files and protection

Production changes are limited to `scripts/_general_notes.py`,
`scripts/generate_drawing.py`, `scripts/svg_repair.py`, `scripts/qa_scorer.py`,
`src/services/drawing/extracted-drawing-semantics.js` and
`src/services/drawing/drawing-quality-summary.js`.

Tests changed in `tests/test_notes_layout.py`, `tests/drawing-note-evidence.test.js`,
`tests/engineering-core-runtime.test.js`, `tests/lane-manifest.js` and
`tests/fixtures/drawing-semantics/slot_hole_pattern_semantics_case/expected_suite.json`.
The synthetic fixture changes one empty-SVG unmatched-note expectation; it is not
a canonical package or historical inspection record. The phase plan and this
results document complete the file list.

All 177 protected file hashes and six protected branch refs remained unchanged.
Canonical packages, readiness, historical evidence, human UAT records and the
PR #199/#201 branches were preserved. The original checkout remained at
`32f52f8ed73419a77b309cd00c567cbb043c9c7a` with its pre-existing untracked
`docs/superpowers/`; the previous dimension-anchor worktree remained clean at BASE.
All trial configuration export directories were rewritten into ignored output
before execution. No secrets were read or emitted, and no real AI API was called.

Implementation commits: `de6c16a`, `a034491`, `d8a5e8d`, `0e2fd98`, `c5f91e5`.
Changes and this report are local only. No push, PR creation/update/merge, release
or deployment was performed. The document commit's final SHA is reported after
commit; code validation remains tied to the explicit SHAs above.
