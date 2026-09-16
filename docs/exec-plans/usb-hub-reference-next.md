# Explicit Diameter Group Anchor Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan inline. Steps use checkbox syntax for tracking.

**Goal:** 같은 지름의 서로 다른 구멍 그룹도 각 그룹 안의 실제 구멍에 지시선을 연결하고, 다른 그룹의 자동 치수로 잘못 중복 제거하지 않게 한다.

**Architecture:** 실제 판 형상에서 검증한 구멍 중심을 렌더러와 추적 기록이 함께 사용한다. 명시된 그룹의 중심으로 원과 자동 치수 후보를 먼저 제한한 뒤 기존 렌더링·중복 제거 코드를 호출한다. 그룹이 없으면 기존 동작을 유지하고, 그룹 검증 실패는 빈 후보로 전달해 불명확한 연결을 막는다.

**Tech Stack:** Python/FreeCAD, 기존 SVG 렌더러, Node.js drawing QA, pytest.

**Spec:** [USB 기준 설계와 현재 검증 범위](../usb-hub-reference-mount.md). 기준 커밋 `a910abf`에서 `member_feature_ids`는 증거 범위를 제한했지만 그룹 밖 지시선을 이동하지 못했다. 사용자의 2026-09-16 계속 진행 요청에 따라 이 계획을 실행한다. 이전에 승인한 커밋·푸시 절차까지 이어가며 실물 검증 상태는 변경하지 않는다.

## Global Constraints

- 기존 자동 분류, 경로, 명령, manifest 계약과 엄격 QA 기준을 유지한다.
- `member_feature_ids`가 없는 입력의 렌더링·추적 의미를 유지한다.
- 수평 단일 박스 + 이름 있는 원통 절삭이라는 현재 지원 범위를 유지한다.
- 실제 완전한 원통 면, 지름, 높이, 중심, 최종 SVG 지시선을 함께 검증한다.
- 구멍 그룹을 숫자 지름만으로 추측하지 않는다. 누락·잘못된 그룹은 다른 원으로 대체하지 않는다.
- 실물 장착 상태는 계속 `not_tested`이다. 업체 연락·발주·실물 검사 기록 생성은 범위에 없다.
- 현재 사용자가 지정하지 않은 허브나 받침면을 실제 보유품으로 간주하지 않는다.

## Task 1: Share measured hole candidates

**Files:**

- Modify `scripts/_drawing_traceability.py`.
- Modify `tests/test_plate_runtime_traceability.py`.

**Interfaces:**

- `measure_plate_holes(config, metadata)` returns `None` when the recipe/body/any hole is unsupported; otherwise returns the existing ordered `(hole_spec, cylindrical_face)` pairs.
- `diameter_group_centers(config, metadata)` returns `dict[str, list[list[float]]]`, keyed by explicit dimension intent ID. An unsupported or invalid explicit group maps to `[]`; an unscoped intent is absent from the map.
- Existing `link_plate_runtime_dimensions(...)` signature and result fields remain unchanged.
- The implementation preserves independently verified body bounds when a hole is unproven, and returns centers from measured face metadata.

- [x] Add a native test that imports the helpers in the same FreeCAD process used for final-body measurement. The two literal expected center lists are:

```python
assert centers['HOLE_DIA'] == [[29, 24.4], [29, 49.6], [113, 24.4], [113, 49.6]]
assert centers['PANEL_HOLE_DIA'] == [[12, 12], [12, 62], [130, 12], [130, 62]]
```

- [x] Run `node scripts/run-pytest.js -q tests/test_plate_runtime_traceability.py`; the new import/candidate test must fail before extraction.
- [x] Move the existing eligibility, measured-face matching, full circumference/height checks and unique-face checks from `link_plate_runtime_dimensions` into `measure_plate_holes`. Preserve all existing predicates and the conservative all-holes requirement.
- [x] Implement the group-center adapter using that verified result and the existing `_dimension_holes` helper:

```python
def diameter_group_centers(config, metadata):
    measured = measure_plate_holes(config, metadata)
    result = {}
    for intent in config.get('drawing_plan', {}).get('dim_intents', []):
        if 'member_feature_ids' not in intent:
            continue
        group = _dimension_holes(intent, measured or [])
        centers = []
        if (intent.get('feature') == 'mounting_hole_diameter'
                and intent.get('style') == 'diameter' and group
                and all(_same(intent.get('value_mm'), face['diameter_mm']) for _, face in group)):
            centers = [face['center_mm'][:2] for _, face in group]
        result[intent.get('id', '')] = centers
    return result
```

- [x] Reuse `measure_plate_holes` in the existing link function. Confirm current positive and all negative native tests still pass, including unscoped mixed sizes and edge notches.

## Task 2: Constrain both rendering and duplicate suppression

**Files:**

- Modify `scripts/_dim_plan.py`.
- Modify `scripts/generate_drawing.py`.
- Create `tests/test_diameter_group_anchors.py`.
- Modify `tests/test_plate_runtime_traceability.py`.

**Interfaces:**

- Add optional keyword `diameter_group_centers=None` to `render_plan_dimensions_svg`.
- `generate_drawing.py` computes candidates from the final body's existing `parts_metadata[final_name]` and passes them for the top view. For assembly and unsupported views, pass every explicit diameter intent ID mapped to `[]`. The renderer also rejects an explicit selector when its map is absent or empty.
- Presence of an intent ID with `[]` means a required group has no verified anchor; it must never fall back to all circles.
- The renderer also recognizes the explicit selector itself. Missing maps cannot silently restore unscoped behavior. It verifies the top projection, exact radius/value, and automatic annotation category before duplicate suppression.

- [x] Write a renderer test with equal-diameter circles at `[12,12,2.75]` and `[130,62,2.75]`, an automatic diameter label on `[12,12]`, and a requested group's only verified center `[130,62]`.

```python
assert record['status'] == 'rendered'
assert record['center_uv'] == [130, 62]
assert record['svg_element_id']
```

- [x] Write a second test with `diameter_group_centers={'PANEL_HOLE_DIA': []}`. Assert no rendered record, no automatic-label dedupe, and an unresolved required intent.
- [x] Run `node scripts/run-pytest.js -q tests/test_diameter_group_anchors.py` and observe both failing behaviors before changing the renderer.
- [x] Before `_find_auto_dedupe_match` and `_render_diameter`, restrict candidates when the current intent ID exists in the mapping. Use `_same_center` and `_same_model_value` from `scripts/_dim_plan.py` for finite values and absolute tolerance 1e-6; only automatic diameter records with a matching `center_uv` may suppress that intent.

```python
circles_for_intent = circles
auto_for_intent = existing_auto_dims
values_for_intent = existing_dim_values
group_map = diameter_group_centers or {}
grouped = ((style == "diameter" or (style == "linear" and fid in DIA_FEATURES))
           and ('member_feature_ids' in di or fid in group_map))
if grouped:
    # These centers are measured in the plate's XY plane. Missing or
    # unsupported evidence must not restore the unscoped fallback.
    centers = (group_map.get(fid) or []) if vname == 'top' else []
    circles_for_intent = [circle for circle in circles
                          if _same_model_value(2 * circle[2], value_mm)
                          and any(_same_center(circle[:2], c) for c in centers)]
    auto_for_intent = [ad for ad in (existing_auto_dims or [])
                       if ad.get('category') == 'hole_diameter'
                       and _same_model_value(ad.get('value_mm'), value_mm)
                       and any(_same_center(ad.get('center_uv'), circle[:2])
                               for circle in circles_for_intent)]
    values_for_intent = []
```

- [x] Pass filtered circles and automatic candidates to the existing routines. For grouped intents, disable the value-only legacy dedupe fallback by passing `existing_values=[]`; equal diameter alone is insufficient evidence of the same annotation.
- [x] Replace the current `anchor_outside_group` negative runtime case with a positive case selecting only `hole_P4`. Assert a new rendered diameter at `[130,62]`, a face reference for P4 only, and strict QA pass. Keep unknown-member, wrong-value, missing-hole, mixed-member and edge-notch cases negative.
- [x] Add a native case with two required Ø5.5 subgroups, `['hole_P1','hole_P2']` and `['hole_P3','hole_P4']`. Assert distinct in-group anchors and nonoverlapping face-reference sets. Inspect generated SVG for label collisions and existing layout QA failures.

## Task 3: Validate and document the boundary

**Files:**

- Update `docs/config-schema.md` and `docs/usb-hub-reference-mount.md`.
- Update this plan's checkboxes with actual evidence after implementation.
- Store logs and generated SVG/JSON in `tmp/codex/usb-hub-group-anchors/` and ignored output paths.

- [x] Run:

```sh
node scripts/run-pytest.js -q tests/test_diameter_group_anchors.py tests/test_plate_runtime_traceability.py tests/test_plate_dimension_consistency.py tests/test_intent_compiler.py
node bin/fcad.js draw configs/examples/usb_hub_reference_mount.json --strict-quality
node tests/config-schema-cli.test.js
npm test
npm run check:source-hygiene
```

- [x] Confirm the existing mixed-diameter reference example still has both required groups, 100% traceability, and no blocking quality issues. Open the SVG and check the two-group equal-diameter fixture visually.
- [x] Request read-only review focused on empty-candidate fallback, cross-group dedupe, stale face metadata, unsupported views, and accidental physical-fit claims.
- [x] Document supported explicit group anchor selection and retain physical/thermal/load verification as unperformed.

## Acceptance summary

1. A non-first group can receive a valid in-group leader.
2. A different group's automatic label cannot suppress it merely because the diameter is equal.
3. Unsupported/invalid explicit groups remain unresolved.
4. The current R1 example and legacy unscoped inputs retain their expected behavior.
5. No result becomes physical inspection evidence.

## Verification snapshot — 2026-09-16

- Before implementation, the P4-only case failed strict QA at 83.33% traceability and the two equal-diameter subgroups failed at 85.71%.
- Targeted Python checks passed: 48 renderer/consistency/compiler tests plus 23 subtests, 19 native traceability tests, and 16 scale-evidence tests (83 tests total).
- `npm test` (`default-node`), config-schema CLI validation, source hygiene, and `git diff --check` passed.
- Three actual FreeCAD strict drawing runs passed: the existing R1 reference, P4-only selection, and two equal-diameter subgroups. Each scored 91 with 100% traceability and no blocking issues.
- Browser visual review confirmed the top-view P4 leader at `[130,62]` and distinct subgroup leaders at `[12,12]` and `[130,12]`, without visible new label collisions. The original mixed-diameter reference labels remain present.
- Independent read-only review found no actionable issues. Changed path lists and HEAD were unchanged throughout that review.
- Logs and screenshots: `tmp/codex/usb-hub-group-anchors/`. Scenario SVGs and JSON: `output/usb-hub-reference-mount/group-anchors/`.
- Software/CAD verification only; physical fit, load, and thermal testing remain unperformed.

## Delivery

Commit the verified implementation and this record, then push `codex/usb-hub-reference-mount-v1` normally and verify the remote SHA. Record the resulting SHA and push result under the ignored evidence directory; this document cannot contain its own commit SHA. No merge or manufacturing release is part of this delivery.

## Next bounded task — mounting-center comparison

1. Define an additive JSON comparison record with explicit source identity, units, coordinate frame, expected centers, measured CAD centers, and comparison tolerance. Keep manufacturer-reference data distinct from user hardware, which is still unidentified.
2. Compare the reference mounting pattern with centers measured from the final model. Report each displacement and missing/ambiguous match; do not infer a match from equal diameter alone.
3. Cover matching, shifted, missing, duplicate, wrong-unit, and unsupported-frame cases. Missing identity or evidence must remain `unknown`/unverified.
4. Add a compact review view and auditable evidence references using the existing artifact contracts. Keep physical fit `not_tested`; the result describes nominal CAD pattern agreement only.

This follow-up is implemented separately under [the mounting-center comparison plan](mounting-center-comparison.md); it is not part of the group-anchor change.
