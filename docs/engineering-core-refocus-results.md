# Engineering core refocus verification — 2026-09-07

This implements [the selected refocus plan](./exec-plans/2026-09-06-engineering-core-refocus.md), Tasks 0–5, using the existing engine and artifact contracts. It is software/CAD verification, not physical inspection, human UAT, manufacturing approval, or a release. Final regression results and the independent read-only closeout record are described below; unexecuted validation scopes are explicit.

## Scope and code

- Repository: `dooosp/freecad-automation`; base `57264a196b2f3ac5272aa8b78f0c35096a7925a0` (also fetched `origin/master` at start).
- Isolated branch: `codex/engineering-core-refocus-v1`; final production/test correction: `bac8324` (after Task 4 commit `99a2e1b`). Documentation is committed separately. The original dirty worktree and the protected robotics/UAT branches were not used for implementation.
- The primary attached plan was copied verbatim. The secondary background document's proposed new profile was not adopted.
- `lib/cad-config-validation.js` owns deterministic parsing, canonical schema diagnostics, supported shapes/operations, reference semantics and joint checks. `scripts/design-reviewer.js` keeps the old `validateTomlStructure` facade and AI response/stream contracts. Build validates before mkdir/write/load/runtime and delegates once to `createModel` in `src/services/design/design-service.js`.
- The AI script's general design lectures, fixed fits/clearances/material assumptions, and robot example were removed. Advice is labelled as a draft, not validation. Live-provider protections remain; no real AI API call or secret read was performed.
- The only canonical schema compatibility adjustment accepts assembly rotation vectors of length 3 or 4, matching the existing Euler/axis-angle runtime and legacy validation behavior. No new schema, framework, manifest platform, or command was introduced. `design` was already experimental.

Changed files, relative to the starting base:

| Area | Files |
| --- | --- |
| Production | `lib/cad-config-validation.js`, `lib/config-canonical-schema.js`, `lib/create-quality.js`, `scripts/design-reviewer.js`, `src/services/design/design-service.js` |
| Tests | `tests/cad-config-validation.test.js`, `tests/create-quality.test.js`, `tests/design-core-boundary.test.js`, `tests/design-reviewer-validation.test.js`, `tests/engineering-core-quality-boundaries.test.js`, `tests/engineering-core-runtime.test.js`, `tests/engineering-core-workflow-regression.test.js`, `tests/helpers/engineering-core-fixtures.js`, `tests/lane-manifest.js` |
| Documentation | `README.md`, `docs/command-lifecycle.md`, `docs/exec-plans/2026-09-06-engineering-core-refocus.md`, `docs/product-workflows.md`, `docs/quality-baseline.md`, `docs/engineering-core-refocus-results.md` |

## Observation boundaries

`lib/create-quality.js` requires explicit boolean `valid_shape`/`validShape`. Missing, numeric, or string values remain `null`; a declared runtime validation without validity observations cannot PASS. Runtime-unavailable fallback remains skipped. Default commands retain their warning-friendly exits; explicit strict quality fails when quality is incomplete or failed.

Required diameter/XY-center checks no longer depend on `config.name`. The bounded scope is a single solid from a single part, an explicit requirement/feature ID, an unmodified cylindrical cut tool on the Z axis, and a unique observed cylinder face at the authored position and cutter depth. Generated shape and STEP reimport use independent actual values and provenance. Face indices are local observation references, not revision identities. Existing diameter/center defaults are 0.05/0.2 mm; explicit finite, nonnegative tolerances are honored without rounding errors into PASS.

Independent source review found and reproduced two final boundary cases: an explicit empty `final` reference bypassed truthiness checks, and binary subtraction could reject a decimal value exactly at tolerance. Presence checks now reject empty root/part finals before build side effects. Decimal scaling and integer squared-distance comparison preserve exact diameter/XY tolerance boundaries without adding an epsilon. Tests include zero tolerance, the next representable value above a boundary, exponent notation, and diagonal XY distance. Both reviewers confirmed their findings resolved in `bac8324`.

Missing coordinates/axes/linkage, ambiguous or split faces, duplicate face assignment, assemblies, Y/inclined axes, pattern/shell operations, modified cutters, and earlier cavities whose survival after fuse/common cannot be established remain unavailable/missing. No geometric or quality threshold was loosened to make a fixture pass. Unsupported feature recognition and cavity polarity are not general BREP reverse engineering.

## Actual CAD execution

Task 4 completed on macOS with Node 25.8.0, bundled Python 3.11.14, and FreeCAD 1.1.3 Revision 20260725. Each copy had its `export.directory` rewritten and verified under ignored `output/engineering-core-refocus/<run>/<part>/<A|B>/` before execution. Original source hashes, copy hashes, exact commands, exit codes, measured durations, manifests, runtime details, and observation rows are in the local [Task 4 results](../output/engineering-core-refocus/runtime-1788784398007-44635/results.json). The run used production code `b854e83` plus the subsequently committed Task 4 test harness; the harness identity correction was then committed in `99a2e1b`.

| Part / copies | Fixed A → B oracle | Generated + STEP measurement rows per copy | Create quality A / B | Drawing quality A / B | Revision comparison |
| --- | --- | --- | --- | --- | --- |
| quality-pass-bracket | left hole 6 → 7 mm; right hole 10 mm unchanged | 8 PASS | PASS / PASS | PASS / PASS | `reinspection_required` |
| plate-with-holes | all four mounting holes 4 → 5 mm; XY [22,22], [123,22], [22,76], [123,76] | 16 PASS | PASS / PASS | PASS / PASS | `reinspection_required` |
| hinge-block | both Z mounting holes 6 → 7 mm; Y pin holes remain 8 mm | 8 PASS + 8 UNAVAILABLE | FAIL / FAIL | PASS / PASS | `reinspection_required` |

All six create/draw commands exited 0. All six generated shapes and STEP reimports had explicit valid-shape observations. Hinge's Y-axis limitation correctly prevents a whole-part quality PASS; a passing boundary test does not make those two parts validated. B copies update corresponding requirements and drawing intents together, including hinge `cd-02`; original stable IDs remain unchanged. Missing bracket/plate product identity fields were explicitly declared only in test copies (part ID equals source name); no historical revision was invented in canonical files.

These six copies retain their source STEP/STL export formats. They do not exercise BREP reimport; its existing implementation and unit coverage are preserved without claiming new runtime validation.

Files are discovered from current validated output-manifests for create/draw and existing artifact-manifests for review-context. Each A/B comparison uses its actual configs and review packs. Changed nominal values and cylinder radii are checked against literal input oracles. Identical input and fixed `generated-at` produce byte-identical revision-impact JSON/Markdown; reordered unordered records preserve semantic decisions while source hashes correctly change.

The existing review-context policy excludes ignored quality/drawing paths from canonical evidence linkage. A's real sidecars supplied with B's real model were also excluded: linkage is **UNAVAILABLE**, not a successful canonical evidence validation. Synthetic checksum tests separately accept a valid B binding, replace the bytes with A, and reject `declared_artifact_hash_mismatch` for both quality and drawing. Missing ID and unsupported/conflicting unit tests retain indeterminate decisions. No inspection evidence was invented, and no readiness was regenerated.

## Error detection and baseline comparison

Actual FreeCAD negative runs preserve requirements while changing the bracket cutter: required 6 mm / observed STEP 8 mm is FAIL; required center [30,30] / observed STEP [32,30] is FAIL. Both default create commands still exit 0, and both separate STEP measurement rows detect the errors. These runs are recorded under `injections` in the results JSON.

The same synthetic unit inputs were probed in a separate detached baseline worktree and the improved implementation. This is not an AI benchmark or a runtime performance comparison.

| Synthetic input | Baseline | Improved |
| --- | --- | --- |
| Missing validity, positive volume/faces | PASS, inferred `true` | FAIL, `null` |
| Arbitrary name, STEP diameter 8 vs required 6 | PASS, no STEP hole rows | FAIL, STEP diameter detected |
| Arbitrary name, wrong STEP axis | PASS, no STEP hole rows | FAIL, unsupported observation |
| Supported valid input | PASS | PASS, two STEP rows |

Logs: [baseline probe](../tmp/codex/engineering-core-refocus/baseline-probe.json), [improved probe](../tmp/codex/engineering-core-refocus/improved-probe.json), and [36 synthetic boundary tests](../tests/engineering-core-quality-boundaries.test.js). The normal supported fixtures were not falsely blocked; hinge Y holes are intentionally outside scope. No speed improvement or overall repair-cost estimate is claimed. Individual command durations are recorded; no comparable AI timing was measured. Initial harness failures (incorrect validation-kind spelling and synthetic identity aliases) were repaired and rerun; they are retained in local logs and are not product geometry failures.

## Verification records

Local ignored records are under `tmp/codex/engineering-core-refocus/`; they are diagnostic records, not versioned canonical evidence.

- Baseline: runtime check, source hygiene, contract, integration, snapshots, Python all PASS; Python 98 passed / 1 skipped. See `baseline-tests.json`.
- Tasks 1–3: RED → minimal correction → targeted GREEN, plus relevant full contract/integration lanes. See `task1-tests.json`, `task2-tests.json`, `task3-tests.json`, and retained `logs/task*-red*.log`.
- Task 4: workflow regression, revision-impact service/matrix/lineage, complete runtime smoke all PASS (`task4-tests.json`). Final corrected A/B and two real negative runs PASS as tests (`task4-runtime.json`); two hinge quality results remain FAIL as shown above.
- Final Task 5 checks: all ten commands below PASS on production/test commit `bac8324`. The earlier mixed-code run is superseded; use [verified-final-tests.json](../tmp/codex/engineering-core-refocus/verified-final-tests.json). Python reports 98 passed / 1 skipped.


| Final command | Result | Log |
| --- | --- | --- |
| `npm run check:source-hygiene` | PASS (exit 0; 0.41 s) | [log](../tmp/codex/engineering-core-refocus/logs/verified-0-check-source-hygiene.log) |
| `npm run test:node:contract` | PASS (exit 0; 202.23 s) | [log](../tmp/codex/engineering-core-refocus/logs/verified-1-test-node-contract.log) |
| `npm run test:node:integration` | PASS (exit 0; 64.54 s) | [log](../tmp/codex/engineering-core-refocus/logs/verified-2-test-node-integration.log) |
| `npm run test:snapshots` | PASS (exit 0; 0.51 s) | [log](../tmp/codex/engineering-core-refocus/logs/verified-3-test-snapshots.log) |
| `npm run test:studio-browser-smoke` | PASS (exit 0; 22.92 s) | [log](../tmp/codex/engineering-core-refocus/logs/verified-4-test-studio-browser-smoke.log) |
| `npm run test:v1:acceptance` | PASS (exit 0; 9.71 s) | [log](../tmp/codex/engineering-core-refocus/logs/verified-5-test-v1-acceptance.log) |
| `npm run test:py` | PASS (exit 0; 31.62 s) | [log](../tmp/codex/engineering-core-refocus/logs/verified-6-test-py.log) |
| `node tests/canonical-package-integrity.test.js` | PASS (exit 0; 0.17 s) | [log](../tmp/codex/engineering-core-refocus/logs/verified-7-tests/canonical-package-integrity.test.js.log) |
| `git diff --check` | PASS (exit 0; 0.03 s) | [log](../tmp/codex/engineering-core-refocus/logs/verified-8---check.log) |
| `npm run test:runtime-smoke` | PASS (exit 0; 90.4 s) | [log](../tmp/codex/engineering-core-refocus/logs/verified-9-test-runtime-smoke.log) |

New deterministic tests belong to the contract lane; the new real CAD test is only in the runtime-smoke lane. The final-code [runtime results](../output/engineering-core-refocus/runtime-1788785243527-41609/results.json) reproduce all six cases, three revision comparisons, actual stale mixes, and both geometry-error injections. A further run on the documentation commit is recorded in [final-head-runtime.json](../tmp/codex/engineering-core-refocus/final-head-runtime.json); this identifies the exact final repository SHA without embedding a commit hash into its own commit.

## Protection and remaining limits

The Task 0 SHA-256 snapshot covers 172 tracked files under `docs/examples/`, including five canonical packages and readiness records. It remains identical after final regression. All five readiness states remain `needs_more_evidence` / `hold_for_evidence_completion`; both protected branch heads and original dirty-worktree HEAD/status match the start. See [protection-final.json](../tmp/codex/engineering-core-refocus/protection-final.json).

C1–C14 are covered within the bounded criteria: C1–C6/C8/C10/C11 by the deterministic, service, quality and real-runtime tests; C9/C13/C14 by the protection snapshot and unchanged authority boundaries; C12 by separate synthetic/runtime/NOT_RUN reporting. C7 is satisfied at the fail-closed boundary (ignored linkage unavailable plus synthetic checksum rejection), not as a canonical attachment success. The independent cumulative BASE-to-final review and identical before/after fingerprints are recorded separately in [final-review.md](../tmp/codex/engineering-core-refocus/final-review.md), so writing the attestation does not alter the reviewed diff.

Visual drawing layout/manufacturing suitability, physical inspection, human UAT, AI-provider execution, Linux/Windows runtime, and manufacturing/release approval are **NOT_RUN**. The next bounded geometry extension suggested by actual runs is Y-axis cylindrical holes; it is not implemented here. To reproduce the present scope, run `node tests/engineering-core-runtime.test.js` or `npm run test:runtime-smoke` on a FreeCAD-equipped machine. Outputs remain isolated and ignored.

Only local commits are authorized. No push, PR creation/edit/merge, tag, release, or deployment was performed. A read-only fetch of `origin/master` established the baseline; existing remote state was not modified.
