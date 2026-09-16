# Mounting Center Comparison Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement the connected draw pipeline changes. Track actual completion below.

**Goal:** Compare explicitly mapped manufacturer-reference centers with measured CAD hole centers and report deviations, missing features, and ambiguous evidence.

**Architecture:** Add optional `mounting_reference` config input. The existing FreeCAD draw run supplies complete measured plate holes through `measure_plate_holes`; a pure Node comparison produces canonical JSON and a small Korean HTML review. Register both artifacts through existing manifest contracts. Drawing QA remains independent.

**Tech Stack:** Node.js, Python/FreeCAD, existing draw pipeline and artifact manifests.

**Spec:** The user approved the four-step follow-up in [the previous plan](usb-hub-reference-next.md#next-bounded-task--mounting-center-comparison): record reference identity/coordinates; compare actual CAD measurements; show JSON and review view; test and commit/push. This document makes the authorized input and output contract explicit.

## Global constraints

- Preserve existing outputs, drawing QA thresholds, default and strict drawing exit behavior. Comparison status is reported separately and never implies manufacturing release.
- The input is a manufacturer reference, not the unidentified user's hardware. Output always includes `physical_fit_result: "not_tested"`, `user_hardware_identity: "unknown"`, and `manufacturing_release: false`.
- Support the existing bounded single flat plate recipe only. Reuse actual complete cylindrical-face measurements, never substitute configured coordinates as measurements.
- Only units `mm` and frame `model_xy` are supported initially. Reference coordinates must already be expressed in that frame; do not align, rotate, rescale, or perform nearest-neighbor matching automatically.
- Every reference row names exactly one `target_feature_id`. Duplicate reference IDs, target IDs, measured IDs, coincident centers, or reused face references remain unknown. An equal diameter never establishes identity.
- Missing identity, units/frame, tolerance, or runtime measurement is unknown. An absent explicitly requested feature in a complete measured set is a failed comparison (`missing_feature`). A shifted center is failed (`center_out_of_tolerance`).
- Tolerance is a declared nonnegative Euclidean XY distance in mm. It is a software comparison threshold, not a verified manufacturing tolerance. A numerical allowance of 1e-9 mm is only for floating-point arithmetic.
- JSON is canonical; HTML is a downstream view with escaped text and no external scripts. Missing values display as unknown, never zero.
- Keep control files under `tmp/codex/mounting-center-comparison/`; generated deliverables stay under `output/`.

## Input and measurement contracts

```json
{
  "mounting_reference": {
    "source": {
      "kind": "manufacturer_reference",
      "product_id": "Coolgear CG-U3MINI4PH-G2",
      "evidence_ref": "https://www.coolgear.com/wp-content/uploads/CG-U3MINI4PH-G2_Drawing_JWV1-1.pdf"
    },
    "units": "mm",
    "coordinate_frame": "model_xy",
    "coordinate_basis": "84 x 25.2 mm pattern centered at model XY (71,37); lower-left plate origin",
    "center_tolerance_mm": 0.1,
    "holes": [{"id":"H1","target_feature_id":"hole_H1","center_mm":[29,24.4]}]
  }
}
```

The example contains all four hub holes H1–H4. Panel holes P1–P4 are design choices and are excluded from the manufacturer's reference comparison.

`generate_drawing.py` conditionally returns `mounting_measurements`:

```json
{
  "source":"freecad_runtime", "status":"available",
  "units":"mm", "coordinate_frame":"model_xy", "model_object_id":"final",
  "holes":[{"feature_id":"hole_H1","center_mm":[29,24.4],"diameter_mm":4,"face_ref":"final:Face7"}]
}
```

Unsupported geometry returns `status: "unavailable"`, an empty hole array, and a reason. Face references identify this run only.

## Task 1: Deterministic comparison and review view

**Files:** Create `src/services/drawing/mounting-comparison.js` and `tests/mounting-comparison.test.js`; register the test in `tests/lane-manifest.js`.

**Interfaces:** `compareMountingCenters(reference, measurements, { modelName, inputConfigPath } = {})` returns schema version `0.1`, scope `nominal_cad`, source/measurement records, stable reasons, rows, summary counts and overall `pass|fail|unknown`. Each row records reference/target IDs, expected/measured XY, delta XY, distance, face reference, status and reason. Any proven failure makes the overall result fail; otherwise unknown rows/global errors prevent pass.

`renderMountingComparisonHtml(report)` returns standalone HTML with a status summary, source and coordinate basis, threshold, per-hole measurements/deviations/reasons, and explicit untested physical status.

- [x] Write and observe failing tests for matching, shifted `(0.3,0.4)` → distance `0.5`, boundary tolerance, missing feature, duplicate mapping/measurement/center/face, unsupported units/frame, missing source/runtime data, invalid numbers, and empty input.
- [x] Implement finite numeric validation and explicit ID lookup. Preserve evidence and never fall back to nearest coordinates or diameter.
- [x] Verify escaped HTML and the difference between unknown and a measured zero; register the tests in the normal Node suite.

## Task 2: Native draw integration and artifacts

**Files:** Modify `scripts/generate_drawing.py`, `src/orchestration/draw-pipeline.js`, `src/shared/artifact-surface.js`, `bin/fcad.js`, `lib/config-canonical-schema.js`, and `configs/examples/usb_hub_reference_mount.json`. Create `tests/test_mounting_comparison_runtime.py`.

- [x] Add a native test using the reference plate: expect four rows at `[29,24.4]`, `[29,49.6]`, `[113,24.4]`, `[113,49.6]`; status pass and four distinct live face refs. Observe failure before integration.
- [x] Return current measured centers with the existing helper only when comparison is requested. Unsupported geometry remains unavailable.
- [x] Write `<name>_mounting_comparison.json` and `<name>_mounting_comparison.html` after generation. Include their paths in the run log, artifact manifest, and output manifest only for a requested comparison. Never infer optional paths from leftover files.
- [x] Preserve warning-oriented draw semantics; emit a readable comparison status. Existing `--strict-quality` continues to gate drawing QA only.
- [x] Validate input shapes/types without silently normalizing unsupported units or frames. Missing semantic evidence produces unknown. Add the four manufacturer-reference entries to the committed example.
- [x] Native tests cover a shifted configured hole with independently measured displacement, removed feature, invalid evidence/frame, and absent comparison input. Check both manifests and ensure later runs without comparison do not publish stale comparison artifacts.

## Task 3: Verify and deliver

**Files:** Update `docs/config-schema.md`, `docs/usb-hub-reference-mount.md`, this plan, and the prior plan's follow-up link.

- [x] Run `node tests/mounting-comparison.test.js`, `node tests/config-schema-cli.test.js`, native mounting and previous plate traceability tests, `npm test`, and `npm run check:source-hygiene`.
- [x] Run actual strict draw for the example and mismatch case, then inspect generated JSON and the HTML in the browser. Record exact results and limits.
- [x] Obtain independent read-only review of the completed diff while preserving before/after changed-path evidence; resolve actionable findings.
- [x] Document comparison semantics, commands, source identity and remaining limits.

## Later scope

The next potential extension is an explicit coordinate transform contract or additional plate geometries. Neither is required for this delivery. Actual user hardware remains unidentified; no physical testing or supplier action is authorized by a software comparison.


## Verification snapshot — 2026-09-16

- The missing feature first failed 5 actual FreeCAD integration cases; the pure comparison module was absent.
- Pure Node comparison/review checks: 35 passed. Native mounting checks: 7 passed. Existing native plate traceability: 19 passed (61 distinct targeted cases).
- Config-schema CLI, artifact-surface, draw-pipeline QA bridge, source hygiene, and `git diff --check` passed. Full `npm test` (`default-node`) completed successfully.
- Actual strict reference draw: comparison `pass`, all 4 manufacturer-reference centers matched, maximum deviation 0 mm. Actual strict shifted-H4 draw: comparison `fail`, 3 matched and 1 failed, maximum deviation 0.5 mm. Both drawing QA results remain pass/91 points/100% traceability.
- Desktop browser review confirmed both summaries and their per-hole tables. The JSON link's local target exists; no download completion is claimed.
- Independent review found a missing output-manifest path when strict drawing QA fails. A native test reproduced 0 comparison entries before the fix; the fix preserves both emitted files and hashes. All 7 mounting runtime cases and the scoped re-review then passed; no remaining actionable findings.
- Control evidence: `tmp/codex/mounting-center-comparison/`. Generated reference output: `output/usb-hub-reference-mount/cad/`; intentional mismatch demonstration: `output/usb-hub-reference-mount/mounting-comparison/shifted/`.
- Physical testing remains unperformed; actual user hardware is unidentified.

## Delivery

Commit these verified changes and push `codex/usb-hub-reference-mount-v1` normally. Record and verify the resulting remote SHA under the ignored evidence directory. Preserve other worktrees and the user's existing servers. No merge or manufacturing release is included.
