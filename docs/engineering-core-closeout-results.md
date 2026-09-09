# Engineering core final closeout — 2026-09-09

Implementation is closed for the original Tasks 0–5 and the four bounded
follow-ups: Y-axis holes, drawing layout, named dimension anchors and explicit
drawing notes. The final validation preserves the documented limits. It is not
an all-tests-green, manufacturing-readiness or release approval.

## Fixed version and final correction

- Original BASE_SHA: `57264a196b2f3ac5272aa8b78f0c35096a7925a0`.
- Validation SHA: `261d80a19a6698f7d0abcde551a89b3696c57c8c`.
- Branch: `codex/engineering-core-drawing-notes-v1`; the isolated continuation
  contains the preceding local refocus commits.
- Every command in the final validation record started and ended at this SHA.
  The real A/B run started with a clean working tree. This report is committed
  separately afterward; it changes no production or test code.

The first closeout run exposed an outdated assertion in
`tests/runtime-smoke-cli.js`: the intentionally invalid `ks_bracket` fixture was
still expected to prove `MOUNTING_HOLE_DIA` from automatic diameter text. Actual
artifacts showed invalid geometry, an unresolved plan observation and a REVIEW
marker. The corrected test requires `unknown`, `skipped_no_anchor`, no rendered
plan dimension, a null observed value, the invalid-shape reason and a required
blocker. Existing create/drawing fail and strict failure checks are retained.

That failure was recorded before the minimal test correction; the whole runtime
lane then passed. The correction was committed as `261d80a`, followed by the final
fixed-SHA run of every check below. No production change was needed during
closeout. The 396 files under production directories and the package files have the same aggregate SHA-256
before and after: `af16d9a89a12acd956a3126117082a669d821ca366d6b05f438793102c9cec82`.

## Final checks actually executed

| Command | Result |
| --- | --- |
| `npm run check:source-hygiene` | PASS |
| `npm run check:runtime` | PASS |
| `npm run test:runtime-smoke` | PASS, all four runtime steps |
| `npm test` / contract | FAIL at known bootstrap-doctor link check; contract 118 pass / 1 fail including explicit continuation |
| `npm run test:node:integration` | PASS, 24 steps |
| `npm run test:snapshots` | PASS, 2 steps |
| `npm run test:studio-browser-smoke` | PASS |
| `npm run test:v1:acceptance` | PASS |
| `npm run test:py` | FAIL, 159 passed / 1 historical-link failure / 7 skipped |
| `node tests/canonical-package-integrity.test.js` | PASS |
| `git diff --check BASE HEAD` | PASS |

The contract runner stops at bootstrap-doctor, so the remaining 106 commands
were invoked from the unchanged manifest with the standard environment. These
are completed checks, not an official green `npm test`. Runtime smoke alone used
an ignored repository TMPDIR so temporary CAD configs and export directories
were isolated before execution. No old output was copied in to hide failures.

Both remaining broad-suite failures refer to unavailable ignored artifacts in
protected `docs/engineering-core-refocus-results.md`. The Python failure names
the old `runtime-1788784398007-44635/results.json` link. Historical records and
test criteria were preserved; these are known failures, not passes or skips.

## Real FreeCAD results at the validation SHA

The entire runtime-smoke lane passed: CLI runtime, local API runtime, repeated
STEP export and the engineering-core A/B harness. The A/B harness itself executed
42 CLI commands with exit code zero and recorded no errors on FreeCAD 1.1.3.

| Part | A → B | Create / draw, both revisions | Observed engineering checks per revision | Required dimensions | Required notes |
| --- | --- | --- | --- | --- | --- |
| Bracket | Left hole 6 → 7 mm; right 10 mm unchanged | pass / pass | 8 pass | 2/2 | 1/1 |
| Plate | Four holes 4 → 5 mm | pass / pass | 16 pass | 5/9 | 3/3 |
| Hinge | Mounting holes 6 → 7 mm; Y pins 8 mm unchanged | pass / pass | 16 pass | 2/2 | 2/2 |

Three A/B comparisons passed with `reinspection_required`. Five geometry-error
injections were detected; eight dimension-anchor cases and one invariance case
passed. Three final-SVG note fault injections were detected despite stale
sidecar content. SVG edits are artifact tests, not physical or process evidence.

All six shapes and their supported export checks passed within the existing
contract. All three parts retain the semantic advisory `needs_attention`.
The intentionally invalid `ks_bracket` in the separate general CLI smoke still
fails quality and explicit strict gates as expected; it is not the representative
quality-pass bracket in this table.

## Reduced and strengthened responsibilities

AI design advice remains an optional draft adapter. Generic design lectures,
fixed clearance/material assumptions, duplicate validation and direct build
execution responsibility were removed from that path. Common deterministic
validation rejects invalid inputs before build side effects, and AI build calls
the existing `createModel` service once.

Observed validity, supported Y/Z hole measurements and STEP reinspection replace
unobserved or example-name-based passes. Drawing dimensions require coherent
identity and supported topology observations. Required notes require current
visible SVG content, and footer layout remains bounded. Existing quality,
manifest, revision-impact and warning/strict policies are reused.

The original C1–C14 criteria remain satisfied within their documented bounds.
In particular, C7 covers stale-evidence rejection and unavailable linkage, not a
successful attachment of canonical physical inspection evidence.

## Deferred limits and protection

No further feature extension is part of this closeout. Plate hole-pattern X/Y
spacing and connector-slot size/position remain four unknown required dimensions.
Conceptual critical-feature groups, approximate layout, unsupported curved
boundaries, existing overlaps and arbitrary SVG/CSS contexts remain bounded or
unqualified. Drawing PDF inspection, fresh visual inspection in this closeout,
human UAT and physical inspection are NOT_RUN. Earlier six-SVG agent inspection
is retained as separate historical evidence, not converted into human approval.

All 178 protected file hashes and six protected refs remained unchanged. The
original dirty checkout and prior worktrees were preserved, including the PR
#199/#201 branches. Canonical packages, readiness, historical evidence and human
UAT records were neither modified nor approved. No secrets were read or emitted,
and no real AI API, push, PR mutation, release or deployment was performed.

## Cumulative review, changed files and local evidence

Independent read-only reviews covered the entire original BASE-to-result patch.
The 70-file patch through the test correction had SHA-256
`fda05649433359e51e724b0142eba129510564ec3c105e12b1c22c90eb18cba5`, unchanged before
and after review. The report addition is reviewed separately with the full patch.
Final counts are 71 changed files and 27 local commits since the original BASE,
including this report. This closeout changes only `tests/runtime-smoke-cli.js`
and this document; the production implementation remains unchanged.

Prior file-by-file change and validation records:

- [Original Tasks 0–5](engineering-core-refocus-results.md).
- [Y-axis measurements](engineering-core-y-axis-results.md).
- [Drawing layout](engineering-core-drawing-layout-results.md).
- [Named anchors](engineering-core-dimension-anchors-results.md).
- [Required drawing notes](engineering-core-drawing-notes-results.md).

Local diagnostic evidence is ignored and deliberately not linked as portable
Markdown artifacts:

- Final checks: `tmp/codex/engineering-core-closeout-1788953255/final/checks.json`.
- Final A/B observations: `output/engineering-core-refocus/runtime-1788953801871-3829/results.json`.
- Failure, correction, protection and cumulative review: `tmp/codex/engineering-core-closeout-1788953255/`.

The final report commit SHA, clean git status and unchanged production/test tree
are recorded after commit in the ignored final-state record and the human reply.
No additional development is scheduled by this report.
