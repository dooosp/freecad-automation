# Engineering core: bounded Y-axis follow-up

## Scope and provenance

This is the follow-up authorized after engineering-core refocus v1. It extends existing hole observation to axis-aligned Y cylinders; it does not rewrite the pipeline or add AI behavior. The prior reduction of AI planning/validation duplication remains in place.

- Repository: `dooosp/freecad-automation`.
- Worktree: `engineering-core-y-axis-v1/freecad-automation`.
- Branch: `codex/engineering-core-y-axis-v1`.
- BASE: `1d02385dfca30c90a922bde3de64a6fd3ad0ab1d`.
- Tested code/test HEAD: `2f273f762c059a8cc3e0fa936b3c538d6366f342` (implementation `1aac79a`, review fixes `30d9c61`, runtime regression `2f273f7`).
- Plan: [bounded Y-axis follow-up](exec-plans/2026-09-07-engineering-core-y-axis.md).
- Task controls: ignored `tmp/codex/engineering-core-y-axis/`.
- Prior refocus results remain historical and unchanged.

## Supported contract

| Hole axis | Center plane | Report fields | Observation |
| --- | --- | --- | --- |
| Z | XY | Existing `expected_center_xy_mm`, `actual_center_xy_mm`; no new markers | Existing generated/STEP behavior and Z input alias precedence retained |
| Y | XZ | `hole_axis: y`, `center_plane: xz`, `expected_center_xz_mm`, `actual_center_xz_mm`; legacy XY fields null | Generated shape and STEP reimport each supply their own observed diameter and projected center |

Y matching uses the authored cutter's XZ position and Y depth interval. STEP cylinder axis direction may reverse and its axis reference point may move in Y. Neither changes the projected center. The existing exact decimal tolerance comparison, finite observations, single-solid requirement, cut lineage and unique-face rules remain in force.

Y intent accepts exactly one explicit center field: a two-coordinate `expected_center_xz_mm`/`center_xz_mm`, or a three-coordinate `expected_center_mm`/`center_mm` projected to XZ. An absent center uses the authored three-coordinate position. Conflicting aliases, wrong-plane XY intent and malformed observations remain non-pass. Fixed independent XZ intent is used in actual displacement error probes, so changing the cutter cannot move the expected result.

The schema, revision semantic validation and Studio share the projection meaning. Studio displays XZ values with an XZ label and suppresses PASS for malformed extension tuples or noncanonical measurement statuses. Revision semantic records retain axis/plane/projected coordinates and continue to ignore unstable face indices. Provenance points to the actual XZ report field and original 3D observation.

`schema_version` remains `1.0`. Updated readers accept existing Z reports. Old readers with the previous strict schema reject Y extension properties; this is not bidirectional compatibility. No new manifest, route, runtime engine or schema framework was introduced. The small shared JS guard uses the existing shared static path and import-map pattern.

## Verification

| Check actually executed | Result |
| --- | --- |
| New Y tests and existing geometry/consumer/workflow tests | PASS: 61 Node subtests in `logs/final-targeted.log`; latest consumer check 22/22 in `logs/final-consumers.log` |
| All contract lane steps, continued individually after failures | 116/117 PASS; only Bootstrap doctor fails (same protected historical links as baseline) |
| `npm run test:node:contract` before implementation and after final fixes | FAIL at Bootstrap doctor; no acceptance criterion was changed |
| `npm run test:node:integration` | PASS |
| `npm run test:snapshots` | PASS |
| `npm run test:studio-browser-smoke` | PASS, repeated after final display fix |
| `npm run test:v1:acceptance` | PASS |
| `npm run test:py` | 97 passed, 1 skipped, 1 failed: existing historical local-artifact link is absent in this clean worktree |
| `npm run check:source-hygiene` | PASS, including after final fixes |
| `node tests/canonical-package-integrity.test.js` | PASS |
| `npm run test:runtime-smoke` | PASS on tested HEAD, including the expanded engineering-core harness |
| `git diff --check` | PASS |

No full-suite green claim is made. The all-contract diagnostic runner invoked the exact 117 existing lane steps without changing their assertions; its output is `contract-all.json`. The final core/consumer fixes were followed by the targeted regressions, browser smoke, standard contract command and full runtime smoke. Logs and command/exit-code records are in `tmp/codex/engineering-core-y-axis/` (`final-tests.json`, `post-review-tests.json`, `logs/`). RED runs are preserved in `y-axis-red.log`, `legacy-alias-red.log`, `status-alias-red.log`, and `summary-null-red.log` under the same log directory.

### Actual CAD results

Runtime: macOS, Node 25.8.0, bundled Python 3.11.14, FreeCAD 1.1.3 revision 20260725. The final expanded run executed 34 CLI commands with no harness errors. Source configs and test copies have recorded SHA256 values; all create/draw outputs were resolved through their current validated manifests.

Final run: `output/engineering-core-refocus/runtime-1788786837558-99345/results.json`. This run records code HEAD `2f273f762c059a8cc3e0fa936b3c538d6366f342` and runtime-driver SHA256 `b73b45bacb92ffa55bec726e9165b7957f7b42fbed5ca890513a9f5137184dea`. Its dirty flag is true because this results document was untracked; code and runtime harness were committed. Subsequent changes are documentation only.

| Part | A → B design change | Create / drawing A and B | Engineering rows per revision | BREP A and B |
| --- | --- | --- | --- | --- |
| quality-pass-bracket | Left hole 6 → 7 mm | PASS / PASS | 8 PASS, 0 unavailable | Valid; volume delta 0%, bbox delta 0 mm |
| plate-with-holes | Four mounting holes 4 → 5 mm | PASS / PASS | 16 PASS, 0 unavailable | Valid; volume delta 0%, bbox delta 0 mm |
| hinge-block | Two mounting holes 6 → 7 mm; Y pins remain 8 mm | PASS / PASS | 16 PASS, including 8 Y rows; 0 unavailable | Valid; volume delta 0%, bbox delta 0 mm |

Both hinge revisions independently observed Y pin centers XZ `[21,27]` and `[69,27]` from generated shape and STEP. All three A/B comparisons detected the intended dimension/feature changes, returned `reinspection_required`, and reproduced byte-identical JSON and Markdown with a fixed generated timestamp. This is change tracking, not inspection approval.

| Actual error/invariance probe | Observed result |
| --- | --- |
| Z bracket diameter 8 vs expected 6 mm | DETECTED, quality FAIL |
| Z bracket center `[32,30]` vs `[30,30]` | DETECTED, quality FAIL |
| Y left pin diameter 10 vs expected 8 mm | DETECTED in generated and STEP rows |
| Y left pin center XZ `[22,27]` vs `[21,27]` | DETECTED in generated and STEP rows |
| Y left pin center XZ `[21,28]` vs `[21,27]` | DETECTED in generated and STEP rows |
| Left pin axial origin Y 28 → 29 mm | PASS; generated/STEP/BREP volume and bbox differences all zero |

The five injected-error create commands retained the default warning-oriented exit code 0 while their quality artifacts reported failures. BREP reimport itself remained valid in these probes; a valid solid is not proof of correct intended dimensions.

### Drawing review

Six final SVGs were rendered and reviewed separately from the runtime harness. Quick Look square thumbnails clipped the right side; full-sheet Chrome captures of the unchanged original SVGs supersede those previews. The runtime harness's own visual-review field remains NOT_RUN because rendering/review occurred separately. Supplementary paths, image/source hashes and observations are in `tmp/codex/engineering-core-y-axis/drawing-rendering.json`.

The full sheets contain the right-hand views and title blocks: the earlier right-side clipping was a Quick Look preview limitation. The drawing-quality JSONs report PASS, but visual layout review found defects and is **ISSUES_FOUND**, not PASS:

- Bracket: right-hole Ø10 leader text overlaps the vertical overall 100 dimension; lower dimensions are crowded/duplicated.
- Plate: multiple leaders crowd the lower-left hole, and some lower dimensions are duplicated/crowded; the top 42 dimension extends above the sheet frame.
- Hinge: duplicated front Ø8 labels include text on the ear boundary; datum A and nearby dimension extension lines overlap.
- All three: the footer border crosses a note line, and notes extend into the footer region.

The visible A/B diameter labels agree with the changed intent (bracket 6→7, plate 4→5, hinge mounting 6→7; hinge pin stays 8). These layout problems remain open. The follow-up changed quality observation/display and runtime coverage; it did not alter drawing layout or the source packages. No drawing visual acceptance, human UAT or manufacturing approval is claimed.

## Boundaries

- X-axis/inclined holes, assembly transforms, ambiguous/split cylindrical faces and unsupported boolean/feature histories remain unavailable.
- BREP roundtrip covers observed validity, volume and bounding boxes; per-hole engineering rows are generated/STEP observations, not BREP hole measurements.
- Test output/config copies live only under ignored `output/engineering-core-refocus/`. Output directory and realpath ownership are checked before each CAD command.
- Canonical packages, readiness, historical inspection evidence and human UAT are not modified or approved. CAD observations and assistant drawing review are not physical inspection or human acceptance.
- Existing policy excludes ignored quality/drawing sidecars from canonical review evidence. A/B comparisons retain their deterministic change records and reinspection decision; no new evidence-attachment claim is made.
- Existing BASE contract failure: `tests/bootstrap-doctor.test.js` rejects 18 Markdown links into ignored paths in `docs/engineering-core-refocus-results.md`. The failure was reproduced before production edits. This historical document and the checker are preserved; the contract lane must not be called PASS.
- Drawing PDF verification is NOT_RUN: these draw runs emitted SVG; report/review PDFs are not substitutes for a drawing PDF.
- No secrets, real AI provider calls, push, PR change, merge, release or deployment.

## Protection and review

The before/after SHA256 maps for all 172 files under `docs/examples/` agree. The original dirty checkout remains at `32f52f8` with its pre-existing untracked `docs/superpowers/`; it was not modified. Prior v1 is still `1d02385`, robotics demo is still `4cd1d421`, and UAT alignment is still `fbade2c3`. No readiness, canonical package, historical result, evidence or UAT file is changed by the cumulative diff.

Final review uses the entire follow-up BASE-to-HEAD change, including committed work, plus this results document before its final commit. Review fingerprints and final commit state are recorded in ignored task controls. Local commits only; no upstream/remote operation was performed.

## Changed files

- `lib/create-quality.js`: bounded axis projection, signed cutter depth and projected provenance.
- `schemas/create-quality.schema.json`: additive and internally consistent Y/XZ tuple.
- `src/shared/create-quality-projection.js`: shared strict extension validation.
- `src/services/revision-impact/revision-impact-semantic-adapters.js`: extension validation at semantic ingress.
- `public/js/studio/quality-dashboard.js`: XZ display and malformed-extension non-pass display.
- `package.json`, `public/index.html`, `public/studio.html`: existing shared import-map registration.
- `tests/engineering-core-y-axis.test.js`, `tests/lane-manifest.js`: synthetic projection/consumer regression coverage.
- `tests/engineering-core-runtime.test.js`: actual A/B, BREP, Y error and axial-origin probes, preserving existing Z checks.
- The follow-up plan and this separate results document.
