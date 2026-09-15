# USB Hub Reference Drawing QA Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan inline. Steps use checkbox syntax for tracking.

**Goal:** Link the eight-hole reference plate's required dimensions to measured FreeCAD geometry, commit and push the fix, and document the next bounded task.

**Architecture:** Keep existing part classification and drawing-quality thresholds. Reuse the horizontal-box/cylinder-cut recipe guard for runtime evidence eligibility, then restrict diameter evidence to explicit named groups when provided. A group must match complete cylindrical faces and the actual SVG anchor.

**Tech Stack:** Node.js CLI and JSON schema, Python, FreeCAD 1.1.3, pytest.

**Spec:** The user requested a fix, commit, push, and next plan after `usb_hub_reference_adapter_R1` failed strict drawing QA with traceability 0%. The design uses four Ø4.0 holes and four Ø5.5 holes on a 142×74×4 mm plate.

## Global Constraints

- Preserve routes, public commands, manifest contracts, default warning behavior, and strict gate thresholds.
- Preserve the six-or-more-hole `bushing_plate` classification for existing configurations.
- Keep an unscoped mixed-diameter intent unverified; explicit grouping is required.
- Missing holes, edge notches, wrong nominal values, invalid groups, and incorrect anchors cannot receive measured links.
- Public manufacturer CAD is reference geometry. Software QA cannot establish physical fit or manufacturing approval.
- Commit the reproducible input and documentation. Keep downloaded CAD, generated binaries, and temporary evidence under ignored output/control directories.

## Task 1: Reproduce and fix grouped diameter evidence

**Files:**

- Modify `scripts/_drawing_traceability.py`: eligibility and measured group selection.
- Modify `lib/config-canonical-schema.js`: optional nonempty unique `member_feature_ids` list on drawing-plan dimension intents.
- Modify `scripts/plan_validator.py` and `tests/test_intent_compiler.py`: recognize the supported selector without a false typo diagnostic.
- Modify `tests/test_plate_runtime_traceability.py`: real FreeCAD positive and negative cases.
- Modify `tests/config-schema-cli.test.js`: selector shape validation.

**Interfaces:** `drawing_plan.dim_intents[].member_feature_ids: string[]` identifies named cylindrical cut tools for one diameter intent. Existing unscoped intents continue to refer to all holes. The existing `link_plate_runtime_dimensions(config, model_object_id, metadata, view_data, telemetry, traceability)` signature and evidence fields remain unchanged.

- [x] Add a real runtime fixture with eight holes and two explicit groups. Verify literal bounds 142×74×4, group values 4.0/5.5, four face references per group, and strict traceability 100%.
- [x] Run the positive fixture against the baseline; expect missing measured links and strict failure.
- [x] Add guard cases for unknown members, mixed-size members, wrong nominal value, missing hole, edge notch, and an unscoped mixed-size label. Each must retain an unresolved required diameter and fail strict QA.
- [x] Add schema tests: accept `['hole_H1','hole_H2']`; reject `null`, strings, empty arrays, duplicate IDs, empty IDs, and numeric IDs.
- [x] Reuse `_is_flat_mounting_plate` after checking existing `plate`/`bushing_plate` classification and valid single-solid metadata. Select only explicitly named measured holes; require a uniform matching diameter and a unique projected annotation anchor in that group.
- [x] Run `node tests/config-schema-cli.test.js` and `node scripts/run-pytest.js -q tests/test_intent_compiler.py tests/test_plate_dimension_consistency.py tests/test_plate_runtime_traceability.py`.

## Task 2: Ship the reference input and next plan

**Files:**

- Create `configs/examples/usb_hub_reference_mount.json` with a repository-relative export directory and two required grouped diameter intents.
- Update `docs/config-schema.md` with the additive selector and evidence limits.
- Create `docs/usb-hub-reference-mount.md` with design dimensions, source URLs/hashes, verified commands, and physical-evidence boundaries.
- Create `docs/exec-plans/usb-hub-reference-next.md` for the next bounded enhancement, including exact files, interfaces, acceptance tests, and held physical status.

- [x] Run strict create and strict draw on the committed example using the real FreeCAD runtime.
- [x] Verify both diameter labels and all group face references in the regenerated SVG/JSON; refresh the local review package without rewriting the archived pre-fix evidence.
- [x] Run `npm test` and source-hygiene checks; inspect all exits and results.
- [x] Request a read-only code review; address correctness findings and run the affected checks again.
- [x] Compare `git diff --name-only` before/after final review.

### Delivery after the verified implementation snapshot

Commit only the listed source, test, example, and documentation changes.
Push `codex/usb-hub-reference-mount-v1` normally, verify the remote SHA equals the commit, and report the next-plan path. No merge requested. Delivery IDs are recorded after the push in the task result.

## Verified implementation snapshot

- Final targeted suite: 51 passed, 23 subtests passed.
- Schema test and source hygiene: passed.
- Final `npm test`: passed.
- Actual FreeCAD 1.1.3 strict create/draw: passed; drawing score 91, required traceability 100%.
- Independent read-only review and follow-up review: passed with no findings.
- Logs remain in `tmp/codex/usb-hub-reference-qa-fix/`; generated geometry remains non-inspection evidence.
