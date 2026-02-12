# Implementation Plan: D3 + S1/S3 + S2 Presets

## Task 1: D3 Required Only (난이도: 낮음)

### 변경 파일
1. **`scripts/_dim_plan.py`** (Line 224)
   - `render_plan_dimensions_svg()` 시그니처에 `required_only=False` 추가
   - Line 246 for loop에서 `required_only and not di.get("required", True)` → skip

2. **`scripts/generate_drawing.py`** (Line 2578-2587)
   - `plan_dim.get("required_only", False)` 읽어서 `render_plan_dimensions_svg()`에 전달

3. **`configs/overrides/presets/V1_D3.toml`** — 신규
   - `[drawing_plan.dimensioning] required_only = true`

### 핵심: 자동 치수(바운딩/체인)는 영향 없음 — plan intent만 필터링

---

## Task 2: S1/S3 Spacing Config화 (난이도: 중간)

### 변경 파일
1. **`scripts/generate_drawing.py`** (Lines 412-422, 670-770, 2577-2587)
   - plan style에서 오버라이드 읽기: `drawing_plan.style.{dim_offset,feat_dim_stack,dim_gap,dim_ext_overshoot}`
   - 자동치수 렌더에서 상수 대신 effective 값 사용
   - `render_plan_dimensions_svg()` 호출 시 style_cfg 전달

2. **`scripts/_dim_plan.py`** (Lines 9-18, 함수 시그니처)
   - `render_plan_dimensions_svg()`에 `style_cfg=None` 파라미터 추가
   - 내부에서 `style_cfg.get("dim_offset", DIM_OFFSET)` 등으로 effective 값 계산
   - 모든 렌더 함수에 effective 값 전달

3. **`scripts/_dim_baseline.py`** (Lines 10-17)
   - `render_baseline_dimensions_svg()`에 `style_cfg=None` 파라미터 추가
   - 동일 패턴으로 effective 값 사용

4. **`configs/overrides/presets/V1_D1_S1.toml`** — 신규 (넉넉)
5. **`configs/overrides/presets/V1_D1_S3.toml`** — 신규 (빽빽)

---

## Task 3: S2 KS Exam Stroke Profile (난이도: 중간)

### 변경 파일
1. **`scripts/postprocess_svg.py`** (Line 54 이후)
   - `STROKE_PROFILE_EXAM` dict 추가
   - `PROFILES` 매핑 dict: `{"ks": STROKE_PROFILE_KS, "exam": STROKE_PROFILE_EXAM}`
   - `normalize_strokes()` (Line 531): profile 문자열 → dict 변환
   - `postprocess()`: profile 인자를 normalize_strokes에 전달

2. **`bin/fcad.js`** (Line 272)
   - `drawing_plan.style.stroke_profile` → `--profile` 인자로 전달

3. **`configs/overrides/presets/V4_D1_S2.toml`** — 신규

---

## 구현 순서
1. D3 → _dim_plan.py + generate_drawing.py + preset
2. S1/S3 → generate_drawing.py + _dim_plan.py + _dim_baseline.py + 2 presets
3. S2 → postprocess_svg.py + fcad.js + preset
4. 각 단계별 `fcad draw ks_flange.toml --override ...` 검증
