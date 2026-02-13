# Phase 23: DFM 체크 + D4 Manufacturing 치수

**베이스**: `master` 3b50889 (Phase 22 완료)
**총 예상 변경량**: ~800줄 (7개 파일)

---

## 구현 단위 (50줄 단위, 순차 검증)

### Unit 1: TOML 스키마 확장 + D4 프리셋 (~50줄)

**파일 1**: `configs/templates/flange.toml` (+8줄)
- `[manufacturing]` 섹션 추가 (process/material/batch_size 기본값)
- dim_intents에 `process_step` 필드 예시 1건 추가

**파일 2**: `configs/overrides/presets/V1_D4.toml` (신규, ~20줄)
```toml
[drawing_plan.dimensioning]
scheme = "manufacturing"
process_sequence = ["face", "rough_turn", "bore", "drill", "finish_turn"]
functional_surface_priority = true
datum_axis_radial = true

[drawing_plan.manufacturing]
process = "machining"
material = "SS304"
batch_size = 100
```

**파일 3**: `configs/examples/ks_flange.toml` (+10줄)
- `[manufacturing]` 섹션 추가 (예시 config에 DFM 입력 제공)

**검증**: TOML 파싱 확인 (`node -e "..."`)

---

### Unit 2: DFM 체커 — 코어 프레임워크 (~50줄)

**파일**: `scripts/dfm_checker.py` (신규, L1~50)

```python
#!/usr/bin/env python3
"""DFM (Design for Manufacturability) Checker.

Reads enriched config JSON from stdin, analyzes features
against manufacturing constraints, outputs DFM report JSON.

Usage:
    cat enriched_config.json | python3 scripts/dfm_checker.py
"""
import json, sys, os, math
sys.path.insert(0, os.path.dirname(__file__))

# Manufacturing constraint tables by process type
PROCESS_CONSTRAINTS = {
    "machining":    {"min_wall": 1.5, "hole_edge_factor": 2.0, "hole_spacing_factor": 1.5, "max_drill_ratio": 5.0},
    "casting":      {"min_wall": 3.0, "hole_edge_factor": 2.5, "hole_spacing_factor": 2.0, "max_drill_ratio": 3.0},
    "sheet_metal":  {"min_wall": 0.5, "hole_edge_factor": 1.5, "hole_spacing_factor": 1.0, "max_drill_ratio": 10.0},
    "3d_printing":  {"min_wall": 0.8, "hole_edge_factor": 1.0, "hole_spacing_factor": 1.0, "max_drill_ratio": 20.0},
}

class DFMCheck:
    """Single DFM check result."""
    def __init__(self, code, severity, message, feature=None, recommendation=None):
        self.code = code
        self.severity = severity  # "error" | "warning" | "info"
        self.message = message
        self.feature = feature
        self.recommendation = recommendation
    def to_dict(self):
        return {k: v for k, v in self.__dict__.items() if v is not None}
```

**검증**: `python3 -c "import scripts.dfm_checker"` 구문 확인

---

### Unit 3: DFM 체커 — 형상 분석 유틸 (~50줄)

**파일**: `scripts/dfm_checker.py` (L51~100)

- `_extract_cylinders(config)`: 모든 실린더 + cut/non-cut 분류
- `_extract_boxes(config)`: 박스 형상 추출
- `_calc_wall_thickness(shapes)`: 인접 형상 간 최소 벽 두께 계산
- `_calc_hole_edge_distance(holes, bodies)`: 홀 중심~외곽 거리
- `_calc_hole_spacing(holes)`: 홀 간 최소 간격

**검증**: 단위 함수 독립 테스트

---

### Unit 4: DFM 체커 — DFM-01/02/03 검사 (~60줄)

**파일**: `scripts/dfm_checker.py` (L101~160)

- `check_wall_thickness(config, constraints)` → DFM-01
  - non-cut 실린더/박스의 벽 두께 vs min_wall
  - 인접 cut 실린더와의 거리 계산
- `check_hole_edge_distance(config, constraints)` → DFM-02
  - 각 홀의 중심~외곽 거리 ≥ factor × 홀직경
- `check_hole_spacing(config, constraints)` → DFM-03
  - 홀 쌍 간 중심거리 ≥ factor × max(직경1, 직경2)

**검증**: ks_flange config로 각 체크 실행

---

### Unit 5: DFM 체커 — DFM-04/05/06 검사 (~60줄)

**파일**: `scripts/dfm_checker.py` (L161~220)

- `check_fillet_chamfer(config, constraints)` → DFM-04
  - operations에 chamfer/fillet 없는 cut → 내부 코너 경고
- `check_drill_ratio(config, constraints)` → DFM-05
  - cut 실린더의 height/diameter ≥ max_drill_ratio → 경고
- `check_undercut(config, constraints)` → DFM-06
  - 내부 단차 (큰 실린더 위 작은 실린더 cut) 감지

**검증**: 각 체크 함수 독립 실행

---

### Unit 6: DFM 체커 — 메인 엔트리 + 점수 계산 (~60줄)

**파일**: `scripts/dfm_checker.py` (L221~280)

```python
def run_dfm_check(config):
    """Run all DFM checks and return report."""
    mfg = config.get("manufacturing", {})
    process = mfg.get("process", "machining")
    constraints = PROCESS_CONSTRAINTS.get(process, PROCESS_CONSTRAINTS["machining"])

    checks = []
    checks.extend(check_wall_thickness(config, constraints))
    checks.extend(check_hole_edge_distance(config, constraints))
    checks.extend(check_hole_spacing(config, constraints))
    checks.extend(check_fillet_chamfer(config, constraints))
    checks.extend(check_drill_ratio(config, constraints))
    checks.extend(check_undercut(config, constraints))

    # Score: 100 - deductions
    errors = sum(1 for c in checks if c.severity == "error")
    warnings = sum(1 for c in checks if c.severity == "warning")
    score = max(0, 100 - errors * 15 - warnings * 5)

    return {
        "success": True,
        "process": process,
        "material": mfg.get("material", "unknown"),
        "checks": [c.to_dict() for c in checks],
        "summary": {"errors": errors, "warnings": warnings, "info": ...},
        "score": score,
    }

if __name__ == "__main__":
    config = json.load(sys.stdin)
    result = run_dfm_check(config)
    json.dump(result, sys.stdout, indent=2)
```

**검증**: `fcad create ... | python3 scripts/dfm_checker.py`

---

### Unit 7: CLI — fcad dfm 명령 (~50줄)

**파일**: `bin/fcad.js`

- USAGE에 `fcad dfm <config.toml|json>` 추가 (+2줄)
- `main()`에 `command === 'dfm'` 분기 (+5줄)
- `cmdDfm(configPath, flags)` 함수 (+40줄):
  - `loadConfig(absPath)` → manufacturing 섹션 주입
  - `--process machining|casting|...` 플래그 지원
  - `runScript('dfm_checker.py', config)` 호출
  - 결과 포맷팅: 체크별 색상 출력 (error=빨강, warning=노랑, info=초록)
  - DFM 점수 표시, exit code: 0=pass, 1=fail(≥1 error)

**검증**: `fcad dfm configs/examples/ks_flange.toml`

---

### Unit 8: D4 Manufacturing 치수 — intent_compiler 확장 (~50줄)

**파일**: `scripts/intent_compiler.py`

- `KNOWN_PART_TYPES`에 변경 없음 (D4는 part_type 아닌 dimensioning scheme)
- `merge_plan()` (L263~329)에 D4 처리 로직 추가:
  - `scheme == "manufacturing"` 감지
  - `process_sequence` 배열에 따라 dim_intents 정렬
  - 각 dim_intent에 `process_step` 자동 추론 (feature → 공정 매핑)
  - 기능면 우선순위 부스트 (`functional_surface_priority`)

공정→피처 매핑 테이블:
```python
PROCESS_FEATURE_MAP = {
    "face":        ["thickness", "height"],
    "rough_turn":  ["outer_diameter"],
    "bore":        ["inner_diameter"],
    "drill":       ["bolt_hole_diameter", "bolt_circle_diameter"],
    "finish_turn": ["fillet_radius", "chamfer"],
}
```

**검증**: `--classify-only` 모드로 D4 적용 확인

---

### Unit 9: D4 Manufacturing 치수 — _dim_plan 그루핑 (~50줄)

**파일**: `scripts/_dim_plan.py`

- `render_plan_dimensions_svg()` (L398)에 `process_group` 파라미터 추가
- D4 모드일 때 dim_intents를 `process_step` 기준으로 그루핑
- 같은 공정 그룹의 치수는 인접 배치 (offset 연속)
- 그룹 간 시각적 분리 (gap 2배)
- 공정 그룹 레이블 옵션 (dim_intents 위에 작은 텍스트)

**검증**: D4 프리셋으로 draw 실행 → SVG 치수 그루핑 육안 확인

---

### Unit 10: D4 Manufacturing 치수 — intent_compiler 피처 매핑 확장 (~50줄)

**파일**: `scripts/intent_compiler.py`

- `_infer_process_step(dim_intent, process_seq)`: 피처 ID에서 공정 단계 추론
- `_sort_by_process(dim_intents, process_seq)`: 공정 순서대로 정렬
- 공차 등급 매핑: `tolerance_grade_mapping = true`일 때
  - 황삭(rough): IT11~IT14
  - 정삭(finish): IT6~IT9
  - dim_intent에 `tolerance_grade` 자동 삽입
- 기준축 방사형 치수: `datum_axis_radial = true`일 때
  - 회전체 피처의 치수를 중심축 기준으로 배치

**검증**: flange config + D4 프리셋 → enriched plan의 process_step/tolerance_grade 확인

---

### Unit 11: QA Scorer — DFM 메트릭 통합 (~50줄)

**파일**: `scripts/qa_scorer.py`

- `WEIGHTS` dict에 DFM 메트릭 추가 (L49 이후):
  ```python
  "dfm_error_count":   10,  # per error
  "dfm_warning_count":  3,  # per warning
  ```
- `WEIGHT_PRESETS`에 DFM 가중치 추가 (제조 중요 파트에 높은 가중)
- `collect_dfm_metrics(config)` 함수 신규:
  - `dfm_checker.run_dfm_check(config)` 호출
  - error/warning 카운트 반환
- `compute_score()`에 DFM 메트릭 통합 (기존 패턴 따름)

**검증**: `python3 scripts/qa_scorer.py output.svg --json /tmp/qa.json` → DFM 필드 확인

---

### Unit 12: 테스트 — DFM 체커 단위 테스트 (~60줄)

**파일**: `tests/test_dfm.py` (신규)

```python
# Test cases:
# 1. 정상 config → 0 errors, score 100
# 2. 얇은 벽 (1mm, machining) → DFM-01 error
# 3. 홀이 엣지 가까이 → DFM-02 error
# 4. 홀 간격 좁음 → DFM-03 error
# 5. chamfer 없음 → DFM-04 warning
# 6. 깊은 드릴 (10:1) → DFM-05 warning
# 7. 언더컷 존재 → DFM-06 warning
# 8. 공정별 기준 차이 (casting vs machining)
# 9. D4 프리셋 적용 → dim_intents에 process_step 존재
```

**검증**: `python3 tests/test_dfm.py --verbose`

---

### Unit 13: 테스트 — D4 통합 + 프리셋 테스트 (~40줄)

**파일**: `tests/test_presets.py` (+40줄)

- V1_D4 프리셋 파싱 + 기대값 검증 추가
- D4 프리셋 draw 실행 → QA 점수 범위 검증 (≥ 70)
- process_step 필드 존재 확인
- 공차 등급 매핑 확인

**검증**: `python3 tests/test_presets.py --verbose`

---

## 수정 파일 요약

| 파일 | 변경 | 줄 수 |
|------|------|-------|
| `scripts/dfm_checker.py` (신규) | DFM 6개 검사 + 점수 | ~280 |
| `scripts/intent_compiler.py` | D4 공정 매핑 + 정렬 + 공차 | +100 |
| `scripts/_dim_plan.py` | D4 공정 그루핑 렌더링 | +50 |
| `scripts/qa_scorer.py` | DFM 메트릭 통합 | +50 |
| `bin/fcad.js` | dfm 명령 추가 | +50 |
| `configs/overrides/presets/V1_D4.toml` (신규) | D4 프리셋 | ~20 |
| `configs/templates/flange.toml` | manufacturing 섹션 | +8 |
| `configs/examples/ks_flange.toml` | manufacturing 예시 | +10 |
| `tests/test_dfm.py` (신규) | DFM 단위 테스트 | ~60 |
| `tests/test_presets.py` | D4 프리셋 테스트 | +40 |
| **합계** | | **~670** |

---

## 구현 순서 (의존성 기반)

```
Unit 1  : TOML 스키마 + D4 프리셋      ← 독립
Unit 2-6: DFM 체커 (순차)              ← 독립
Unit 7  : CLI dfm 명령                 ← Unit 6 이후
Unit 8  : D4 intent_compiler 확장      ← Unit 1 이후
Unit 9  : D4 _dim_plan 그루핑          ← Unit 8 이후
Unit 10 : D4 피처 매핑 확장            ← Unit 8 이후 (Unit 9와 병렬 가능)
Unit 11 : QA Scorer DFM 통합           ← Unit 6 이후
Unit 12 : DFM 테스트                   ← Unit 6, 7 이후
Unit 13 : D4 통합 테스트               ← Unit 8, 9, 10 이후
```

---

## 커밋 전략

| 커밋 | 내용 | 단위 |
|------|------|------|
| `P23-1` | feat: DFM checker with 6 manufacturing checks | Unit 2~6 |
| `P23-2` | feat: fcad dfm CLI command | Unit 7 |
| `P23-3` | feat: D4 manufacturing dimension strategy | Unit 1, 8~10 |
| `P23-4` | feat: QA scorer DFM metrics integration | Unit 11 |
| `P23-5` | test: DFM + D4 test suite | Unit 12~13 |

---

## 리스크

| 리스크 | 대응 |
|--------|------|
| 벽 두께 계산이 복잡한 형상에서 부정확 | 인접 실린더/박스 기반 근사치 사용, 정확도 한계 문서화 |
| 공정→피처 매핑이 파트 유형마다 다름 | 기본 매핑 테이블 + 사용자 오버라이드 지원 |
| D4 치수 그루핑이 기존 레이아웃과 충돌 | 그룹 간 gap 확대 + overflow 감지 |
| DFM 점수와 QA 점수 이중 감점 | DFM은 별도 카테고리, QA 감점은 경미하게 (3~10점) |
