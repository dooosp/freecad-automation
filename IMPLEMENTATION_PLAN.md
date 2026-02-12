# Phase 19: Intent Compiler + Drawing Plan System

## 목표

FreeCAD 자동 도면에서 "AI 티"를 제거하기 위해, 규칙 기반 Intent Plan 시스템을 도입한다.
- LLM은 부품 유형 분류 1회 호출에만 사용 (규칙 매칭 실패 시 fallback)
- 템플릿은 TOML (기존 관례 유지)
- generate_drawing.py 변경 최소화 (plan read-only)
- QA 지표 확장 (레이아웃 9개 → 14개)

## 품질 3축 정의

| 축 | 내용 | 현재 커버리지 |
|----|------|---------------|
| 의미(Manufacturing Intent) | 치수 선택, 기준면, GD&T가 가공/검사 가능 | 없음 |
| 표현(Conventions) | KS/ISO 관례, 뷰 선택, 단면, 노트 형식 | 부분 (postprocess) |
| 레이아웃(미학+가독성) | 겹침, 오버플로, 정렬, 여백 | QA 9개 지표 |

Phase 19는 **의미 + 표현** 축을 체계적으로 끌어올린다.

---

## 파이프라인 (확정)

```
ks_flange.toml
     │
     ▼
intent_compiler.py ◄── configs/templates/flange.toml
     │                  (부품군별 규칙)
     ▼
enriched config (drawing_plan 섹션 병합)
     │
     ▼
generate_drawing.py  ← plan 필드 조건부 읽기 (없으면 기존 fallback)
     │
     ▼
postprocess_svg.py   ← 기존 그대로
     │
     ▼
qa_scorer.py         ← 기존 9개 + 신규 5개 지표
```

---

## M1: Intent Compiler + Flange Template + Validator

### 산출물

| 파일 | 역할 |
|------|------|
| `scripts/intent_compiler.py` | config + template → drawing_plan 병합 |
| `configs/templates/flange.toml` | 플랜지 부품군 규칙 |
| `configs/templates/bracket.toml` | 브라켓 부품군 규칙 (2차) |
| `scripts/plan_validator.py` | plan 필드 유효성 검증 |

### intent_compiler.py 설계

```python
"""Intent Compiler: config → enriched config with drawing_plan."""
import json, sys, os

def classify_part_type(config):
    """규칙 기반 부품 유형 분류. LLM 없이 shapes/operations에서 추론."""
    shapes = config.get("shapes", [])
    ops = config.get("operations", [])
    assembly = config.get("assembly")

    # 분류 규칙 (우선순위 순)
    if assembly:
        return "assembly"

    shape_types = {s.get("type") for s in shapes}
    op_types = {o.get("type") for o in ops}
    has_cylinder = "cylinder" in shape_types
    has_hole = "hole" in op_types or "circular_pattern" in op_types
    has_fillet = "fillet" in op_types
    has_chamfer = "chamfer" in op_types
    has_step = sum(1 for s in shapes if s.get("type") == "cylinder") > 2

    if has_cylinder and has_hole and not has_step:
        return "flange"
    if has_cylinder and has_step:
        return "shaft"
    if "box" in shape_types and has_hole:
        if any(s.get("type") == "box" and s.get("size", [0,0,0])[2] < 20 for s in shapes):
            return "bracket"
        return "housing"

    return "generic"  # fallback → Gemini 1회 호출 가능

def load_template(part_type, templates_dir):
    """configs/templates/{part_type}.toml 로드."""
    ...

def merge_plan(config, template):
    """template 규칙 + config 명시값 → drawing_plan 섹션 생성.
    우선순위: config 명시값 > template 규칙값 > generate 기존 로직
    """
    ...

def main():
    config = json.load(sys.stdin)
    part_type = config.get("drawing_plan", {}).get("part_type") or classify_part_type(config)
    template = load_template(part_type, templates_dir)
    plan = merge_plan(config, template)
    config["drawing_plan"] = plan
    json.dump(config, sys.stdout)
```

### 부품 유형 분류 규칙

| 조건 | 분류 |
|------|------|
| assembly 섹션 존재 | assembly |
| cylinder + hole/circular_pattern, step 없음 | flange |
| cylinder 3개+ (단차) | shaft |
| box + hole + 얇은 두께(<20mm) | bracket |
| box + hole + cavity | housing |
| 매칭 실패 | generic (Gemini fallback) |

### drawing_plan TOML 스키마

```toml
[drawing_plan]
schema_version = "0.1"
part_type = "flange"
profile = "KS"

# --- 뷰 ---
[drawing_plan.views]
enabled = ["front", "top", "right", "iso"]
layout = "third_angle"

[drawing_plan.views.options]
front = { show_hidden = true, show_centerlines = true }
top   = { show_hidden = true, show_centerlines = true }
right = { show_hidden = true, show_centerlines = true }
iso   = { show_hidden = false, show_centerlines = false }

# --- 단면 (선택) ---
# [[drawing_plan.sections]]
# label = "A-A"
# plane = "XZ"
# offset = 0.0
# source_view = "front"

# --- 스케일 ---
[drawing_plan.scale]
mode = "auto"
min = 0.4
max = 2.5

# --- Datum ---
[[drawing_plan.datums]]
name = "A"
kind = "plane"
selector = "largest_planar"
reason = "primary mounting face"

[[drawing_plan.datums]]
name = "B"
kind = "axis"
selector = "largest_cyl_axis"
reason = "bore center axis"

# --- 치수 스타일 ---
[drawing_plan.dimensioning]
scheme = "baseline"
baseline_datum = "A"
avoid_redundant = true

# --- 필수 치수 목록 (부품군 DNA) ---
[[drawing_plan.dim_intents]]
id = "OD"
feature = "outer_diameter"
view = "front"
style = "diameter"
required = true
priority = 100

[[drawing_plan.dim_intents]]
id = "ID"
feature = "inner_diameter"
view = "front"
style = "diameter"
required = true
priority = 95

[[drawing_plan.dim_intents]]
id = "PCD"
feature = "bolt_circle_diameter"
view = "front"
style = "diameter"
required = true
priority = 90

[[drawing_plan.dim_intents]]
id = "BOLT_DIA"
feature = "bolt_hole_diameter"
view = "front"
style = "diameter"
required = true
priority = 85

[[drawing_plan.dim_intents]]
id = "BOLT_COUNT"
feature = "bolt_hole_count"
view = "notes"
style = "note"
required = true
priority = 80

[[drawing_plan.dim_intents]]
id = "THK"
feature = "thickness"
view = "right"
style = "linear"
required = true
priority = 75

# --- 노트 ---
[drawing_plan.notes]
general = [
  "UNLESS OTHERWISE SPECIFIED:",
  "  TOLERANCES PER KS B 0401 CLASS m",
  "  SURFACE FINISH Ra 3.2",
  "REMOVE ALL BURRS AND SHARP EDGES.",
]
placement = "bottom_left"
```

### flange.toml 템플릿

```toml
[template]
part_type = "flange"
schema_version = "0.1"
description = "KS flange standard drawing template"

[views]
enabled = ["front", "top", "right", "iso"]
layout = "third_angle"
front = { show_hidden = true, show_centerlines = true }
top   = { show_hidden = true, show_centerlines = true }
right = { show_hidden = true, show_centerlines = true }
iso   = { show_hidden = false, show_centerlines = false }

[[datums]]
name = "A"
kind = "plane"
selector = "largest_planar"
reason = "primary mounting face"

[[datums]]
name = "B"
kind = "axis"
selector = "largest_cyl_axis"
reason = "bore center axis"

[dimensioning]
scheme = "baseline"
baseline_datum = "A"
avoid_redundant = true

[[dim_intents]]
id = "OD"
feature = "outer_diameter"
view = "front"
style = "diameter"
required = true
priority = 100

[[dim_intents]]
id = "ID"
feature = "inner_diameter"
view = "front"
style = "diameter"
required = true
priority = 95

[[dim_intents]]
id = "PCD"
feature = "bolt_circle_diameter"
view = "front"
style = "diameter"
required = true
priority = 90

[[dim_intents]]
id = "BOLT_DIA"
feature = "bolt_hole_diameter"
view = "front"
style = "diameter"
required = true
priority = 85

[[dim_intents]]
id = "BOLT_COUNT"
feature = "bolt_hole_count"
view = "notes"
style = "note"
required = true
priority = 80

[[dim_intents]]
id = "THK"
feature = "thickness"
view = "right"
style = "linear"
required = true
priority = 75

[[dim_intents]]
id = "FILLET"
feature = "fillet_radius"
view = "right"
style = "radius"
required = false
priority = 40

[[dim_intents]]
id = "CHAMFER"
feature = "chamfer"
view = "right"
style = "callout"
required = false
priority = 35

[notes]
general = [
  "UNLESS OTHERWISE SPECIFIED:",
  "  TOLERANCES PER KS B 0401 CLASS m",
  "  SURFACE FINISH Ra 3.2",
  "REMOVE ALL BURRS AND SHARP EDGES.",
]
placement = "bottom_left"
```

### plan_validator.py 체크리스트

| # | 검증 항목 | 레벨 | 설명 |
|---|-----------|------|------|
| V1 | schema_version 존재 | ERROR | 지원 버전 "0.1" |
| V2 | part_type 존재 | ERROR | 알려진 유형 집합 |
| V3 | views.enabled 비어있지 않음 | ERROR | 유효 뷰 이름만 |
| V4 | required dim_intents 완전성 | ERROR | part_type별 필수 목록 |
| V5 | dim_intents[].view ∈ views.enabled | WARN | notes 제외 |
| V6 | datums 최소 1개 | WARN | |
| V7 | scale.min <= scale.max | ERROR | |
| V8 | notes.general 비어있지 않음 | WARN | |
| V9 | 알 수 없는 key | WARN | typo 탐지 |
| V10 | dim_intents[].id 중복 없음 | ERROR | |

```python
def validate_plan(plan, part_type):
    """plan 유효성 검사. 반환: { valid: bool, errors: [...], warnings: [...] }"""
```

### 검증

```bash
# M1 검증 명령
echo '{"name":"test","shapes":[{"type":"cylinder"}],"operations":[{"type":"hole"}]}' | \
  python3 scripts/intent_compiler.py | python3 -m json.tool

# validator 단독 실행
python3 scripts/plan_validator.py enriched_config.json
```

---

## M2: generate_drawing.py Plan Read-Only 적용

### 변경 원칙

- 조건부 읽기만 추가 (plan 없으면 기존 동작 100% 유지)
- 새 SVG 조작 코드 없음
- 총 변경량 ~20줄

### 2-1. 뷰 옵션 읽기 (~5줄)

위치: compose_drawing() → render_view_svg() 호출부 (line ~2410)

```python
# 기존: show_hidden = style.get("show_hidden", True)
# 변경:
plan_views = config.get("drawing_plan", {}).get("views", {}).get("options", {})
vplan = plan_views.get(vname, {})
show_hidden = vplan.get("show_hidden", style.get("show_hidden", True))
show_centerlines = vplan.get("show_centerlines", style.get("show_centerlines", True))
```

### 2-2. 치수 전략 읽기 (~5줄)

위치: 치수 전략 선택부 (line ~2434)

```python
# 기존: dim_strategy = select_dimension_strategy(feature_graph)
# 변경:
plan_dim = config.get("drawing_plan", {}).get("dimensioning", {})
if plan_dim.get("scheme"):
    dim_strategy = plan_dim["scheme"]
else:
    dim_strategy = select_dimension_strategy(feature_graph)
```

### 2-3. 노트 텍스트 읽기 (~5줄)

위치: compose_drawing() 내 notes 렌더링 부분

```python
# 기존: notes_lines 하드코딩
# 변경:
plan_notes = config.get("drawing_plan", {}).get("notes", {})
if plan_notes.get("general"):
    notes_lines = plan_notes["general"]
else:
    notes_lines = [기존 하드코딩 값]
```

### 2-4. ISO hidden 제어 (~3줄)

```python
plan_views = config.get("drawing_plan", {}).get("views", {}).get("options", {})
iso_hidden = plan_views.get("iso", {}).get("show_hidden", False)
```

### 변경하지 않는 것 (M4로 연기)

- dim_intents → 치수 생성 로직 연동
- sections → 자동 단면 뷰 생성
- datums → GD&T 연동

### 검증

```bash
# plan 적용
fcad draw configs/examples/ks_flange.toml
# plan 스킵 (회귀 확인)
fcad draw configs/examples/ks_flange.toml --no-plan
# 두 결과의 QA 점수 비교: plan >= no-plan 이어야 함
```

---

## M3: QA 지표 확장 (5개 추가)

### 기존 9개 + 신규 5개 = 14개

| # | 이름 | 감점 | 측정 방법 | plan 필요 |
|---|------|------|-----------|-----------|
| Q10 | `dim_completeness` | 5/missing | plan required intents vs SVG 텍스트 매칭 | Yes |
| Q11 | `dim_redundancy` | 2/duplicate | 동일 수치(±0.5mm)가 다른 뷰에 반복 | No |
| Q12 | `datum_coherence` | 3 (bool) | 치수 extension line 방향 분산도 | No |
| Q13 | `view_coverage` | 5 (bool) | required feature의 view 가시성 | Yes |
| Q14 | `note_convention` | 3 | notes 위치/행간/wrap 준수 | No |

### dim_completeness (핵심 지표)

```python
def check_dim_completeness(tree, plan):
    """plan의 required dim_intents가 SVG에 존재하는지.
    plan 없으면 0 반환 (하위 호환).

    매칭 규칙:
    - diameter → SVG에 "Ø" + 숫자 존재
    - linear → 숫자 + mm 형태 존재
    - note → 키워드 매칭 (e.g., "6-" for bolt count)
    - callout → "C" + 숫자 or 각도 형태

    반환: missing count (감점 = count * 5)
    """
```

### dim_redundancy

```python
def check_dim_redundancy(tree):
    """동일 수치가 다른 뷰 셀에 반복되는 치수 쌍 수.
    뷰별 <text> 숫자 추출 → round(0.5) → 교집합 카운트.
    반환: duplicate count (감점 = count * 2)
    """
```

### datum_coherence

```python
def check_datum_coherence(tree):
    """치수 extension line들이 일관된 기준에서 출발하는지.
    dimensions-* 그룹 내 수직/수평 line 시작점 클러스터링.
    기준점이 3개 이상으로 분산 → incoherent.
    반환: bool (감점 = 3 if incoherent)
    """
```

### view_coverage

```python
def check_view_coverage(tree, plan):
    """plan의 required dim_intents 중, 해당 view에 치수가 실제로 존재하는지.
    plan 없으면 0 반환 (하위 호환).
    반환: bool (감점 = 5 if uncovered features exist)
    """
```

### note_convention

```python
def check_note_convention(tree):
    """general-notes 그룹의 위치/행간/wrap 규칙 준수.
    - notes가 bottom_left 영역에 위치하는지
    - 행간이 3.5~4.5mm 범위인지
    - wrap 폭이 180mm 이내인지
    반환: violation count (감점 = min(count, 3))
    """
```

### 점수 체계

```
기존: score = max(0, 100 - 감점)  ← 9개 지표
신규: 동일 구조 (100점 만점, 14개 지표)
plan 없으면 Q10/Q13은 0점 감점 (하위 호환 보장)
```

### 검증

```bash
# 6종 전체 QA (신규 지표 포함)
for f in configs/examples/ks_*.toml; do fcad draw "$f"; done
# 신규 지표 값 확인
python3 scripts/qa_scorer.py output/ks_flange_drawing.svg --json /dev/stdout | python3 -m json.tool
```

---

## M4: 심화 연동 (Phase 19 이후)

M1~M3 안정화 후:

1. **dim_intents → 치수 생성 연동**: plan feature 목록 기반 치수 on/off
2. **자동 단면 뷰**: plan.sections → make_section() 호출
3. **datum → GD&T 연동**: plan.datums로 auto-GD&T datum 선정 제어
4. **추가 템플릿**: shaft.toml, bracket.toml, housing.toml, assembly.toml
5. **인터랙티브 편집**: 웹 뷰어에서 치수 클릭→수정 (사람 20%)

---

## fcad.js 통합

```javascript
// cmdDraw() 내부, runScript('generate_drawing.py') 호출 전에 추가:
if (!flags.includes('--no-plan')) {
  const compilerScript = join(PROJECT_ROOT, 'scripts', 'intent_compiler.py');
  try {
    const enriched = execSync(
      `python3 "${compilerScript}"`,
      { input: JSON.stringify(config), encoding: 'utf-8', timeout: 15_000 }
    );
    const enrichedConfig = JSON.parse(enriched);
    Object.assign(config, enrichedConfig);
    console.log(`  Plan: ${enrichedConfig.drawing_plan?.part_type || 'unknown'} template applied`);
  } catch (e) {
    console.error(`  Plan warning: ${e.message} (falling back to default)`);
  }
}
```

CLI 플래그:
- `--no-plan`: intent plan 스킵 (기존 동작 100%)
- 기본: plan 적용 (template 없으면 자동 fallback)

---

## 회귀 방지

- 6종 ks_*.toml: `--no-plan` vs plan 적용 QA 비교
- plan 적용 시 QA 점수 ≥ `--no-plan` (하락 시 FAIL)
- M1 완료 시점 스냅샷: `tests/snapshots/phase19_m1_scores.json`
- 기존 테스트 (`node tests/test-runner.js`) 통과 유지

---

## 마일스톤 순서 + 검증

| # | 작업 | 검증 기준 | 변경 파일 |
|---|------|-----------|-----------|
| M1 | intent_compiler.py + flange.toml + validator | stdin→enriched config 출력, validator PASS | 신규 4파일 |
| M2 | generate_drawing.py plan read-only | plan 반영 확인 + --no-plan 회귀 없음 | generate_drawing.py (~20줄) |
| M3 | qa_scorer.py 5개 지표 추가 | 6종 QA 실행, 14개 지표 값 확인 | qa_scorer.py |
| M4 | fcad.js 통합 + E2E | `fcad draw` 전체 파이프라인 정상 | fcad.js |

순서: M1 → 검증 → M2 → 검증 → M3 → 검증 → M4 → 6종 회귀 (50줄 단위, 단위별 검증)
