# Phase 20-B: PCD Virtual Circle + BOLT_COUNT Note

## 목표
PCD 가상원 렌더 + 볼트 카운트 노트 자동 삽입 → QA 확장 2개

## 현재 상태
- PCD value_mm=100 추출 성공, SVG circles 매칭 불가 (가상원이라 형상 없음)
- required_presence_miss=1(PCD), QA=71

---

## S1: PCD 가상원 렌더 (postprocess_svg.py에 신규 pass)

### 전략
- `postprocess_svg.py`에 `inject_pcd_virtual_circle()` pass 추가
- generate_drawing.py 변경 0줄 유지 (postprocess 단계에서 추가)
- plan JSON을 postprocess에 전달하여 PCD value_mm 참조

### 구현 (postprocess_svg.py)

1. **plan 전달**: `postprocess()` 시그니처에 `plan_file=None` 추가
   - plan_file이 있으면 TOML/JSON 로드 → dim_intents에서 PCD intent 추출
   - `inject_pcd_virtual_circle(tree, plan)` pass를 `round_coords` 전에 삽입

2. **inject_pcd_virtual_circle(tree, plan)**:
   - plan에서 `id="PCD"` intent → `value_mm` 읽기 (없으면 skip)
   - plan에서 `id="BOLT_DIA"` intent → bolt_hole_diameter 읽기
   - front view 셀(CELLS["front"]) 기준으로 작업
   - SVG에서 front view 내 `<circle>` 요소들 수집 → bolt hole 후보 필터링
     - bolt_hole_diameter * 0.5 ± 30% 범위의 r을 가진 원들
   - bolt hole 중심점 평균 → virtual circle center (cx, cy)
   - bolt hole 중심들의 평균 반경 → r_virtual (PCD/2에 해당하는 SVG 좌표 반경)
   - SVG 삽입:
     ```svg
     <g class="virtual-pcd">
       <circle cx="{cx}" cy="{cy}" r="{r_avg}"
               fill="none" stroke="#333" stroke-width="0.18"
               stroke-dasharray="8,2,1.5,2"/>
       <!-- leader + shelf + diameter text -->
     </g>
     ```
   - 리더 라인: 가상원 위 45° 지점에서 외부로 leader + shelf + "⌀100" 텍스트

3. **SVG에서 bolt hole 원 찾기 로직**:
   - front view cell 영역 내의 모든 `<circle>` 요소 수집
   - BOLT_DIA value_mm가 있으면: r ≈ BOLT_DIA/2 (±30%) 인 원들 필터
   - 매칭 실패 fallback: 동일 반경(±10%)인 3개 이상 원 그룹 → bolt 후보
   - 3개 미만이면 skip (리턴 empty)
   - 중심 좌표 평균 → PCD center, 중심에서의 평균 거리 → r_virtual

### 예상 변경량: ~80줄

---

## S2: BOLT_COUNT 노트 자동 삽입 (postprocess_svg.py에 신규 pass)

### 전략
- `inject_bolt_count_note(tree, plan)` pass 추가
- general-notes 그룹에 한 줄 추가 (기존 노트 뒤에)

### 구현

1. **inject_bolt_count_note(tree, plan)**:
   - plan에서 `id="BOLT_COUNT"` → `value_mm` (정수: 볼트 개수)
   - plan에서 `id="BOLT_DIA"` → `value_mm` (볼트 홀 직경 mm)
   - plan에서 `id="PCD"` → `value_mm` (PCD 직경)
   - 텍스트 생성: `"{N}x dia.{d} HOLES EQUALLY SPACED ON PCD dia.{pcd}"`
     - 예: "6x dia.13.5 HOLES EQUALLY SPACED ON PCD dia.100"
   - SVG에서 `<g class="general-notes">` 찾기
   - 마지막 `<text>` 요소의 y좌표 + LINE_H(4mm) 위치에 새 `<text>` 삽입
   - TITLEBLOCK_Y(247) 초과 시 삽입 skip (overflow 방지)

### 예상 변경량: ~40줄

---

## S3: fcad.js 파이프라인 수정

- postprocess 호출 시 `--plan` 인자 전달 (plan_file 경로)
- 기존: `python3 scripts/postprocess_svg.py input.svg -o output.svg --report report.json`
- 변경: `... --plan {plan_path}` 추가

### 예상 변경량: ~5줄

---

## S4: QA 메트릭 확장 (qa_scorer.py)

1. **`virtual_geometry_present`** (bool): SVG에 `class="virtual-pcd"` 그룹 존재 여부
   - plan에 PCD intent required가 있을 때만 평가 (없으면 None)
   - 없으면 5점 감점

2. **`note_semantic_consistency`** (int): bolt count 노트 값 일치 여부
   - general-notes 내 텍스트에서 `(\d+)x.*dia\.([\d.]+)` regex
   - N == BOLT_COUNT.value_mm && d == BOLT_DIA.value_mm 확인
   - plan에 BOLT_COUNT/DIA intent가 없으면 None
   - 불일치 시 3점 감점

### 예상 변경량: ~50줄

---

## S5: Golden Metrics 업데이트

- `golden_metrics.json` v1.2: 19개 메트릭 (기존 17 + 2 신규)
- flange 타입: `virtual_geometry_present: { min: 1 }`, `note_semantic_consistency: { max: 0 }`
- defaults: `virtual_geometry_present: { min: 0 }`, `note_semantic_consistency: { max: 1 }`

### 예상 변경량: ~15줄

---

## S6: 테스트 + E2E 검증

1. `fcad draw ks_flange.toml` → SVG에 virtual-pcd 원 + bolt count note 확인
2. QA score: PCD presence miss=0, virtual_geometry_present=true
3. golden 6/6 PASS (no regression)
4. `--no-plan` 모드 → 신규 메트릭 N/A (기존 동작 유지)

---

## 파일 변경 요약

| 파일 | 변경 | 줄수 |
|------|------|------|
| `scripts/postprocess_svg.py` | +2 pass (PCD circle, bolt note) + plan 로딩 | ~120줄 |
| `scripts/qa_scorer.py` | +2 메트릭 + weights | ~50줄 |
| `bin/fcad.js` | --plan 인자 전달 | ~5줄 |
| `tests/golden_metrics.json` | v1.2, 19 메트릭 | ~15줄 |
| `tests/test_no_plan.py` | 신규 메트릭 N/A 검증 | ~5줄 |
| **합계** | | **~195줄** |

## 변경하지 않는 것
- generate_drawing.py: 변경 0줄
- _dim_plan.py: 변경 0줄
- feature_extractor.py: 변경 0줄
- intent_compiler.py: 변경 0줄

## 구현 순서
1. S1 (PCD virtual circle) — 핵심
2. S2 (bolt count note) — S1과 동일 패턴
3. S3 (fcad.js plan 전달)
4. S4 (QA 메트릭)
5. S5 (golden)
6. S6 (E2E 검증)
