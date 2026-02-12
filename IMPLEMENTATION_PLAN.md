# Phase 19.1: QA Foundation — 중복 정의 고정 + Golden 프로파일 + Quick Wins

## 목표

Phase 19 Intent Compiler가 도입한 14메트릭 체계의 **측정 기반을 고정**한다.
템플릿 확장(shaft/bracket) 전에 "무엇이 중복인지", "어떤 범위가 정상인지"를 코드로 박아두어
이후 개선이 발산하지 않도록 한다.

## 변경 순서

### S1. 중복 판정 규칙 고정 (`qa_scorer.py` ~30줄)

**현재 문제**: `check_dim_redundancy`가 단순 값 매칭(±0.5mm 하드코딩).
표기 타입(⌀ vs linear), datum 차이, 공차 차이를 무시.

**변경**:
1. tolerance 파라미터화: `tol = max(0.5, 0.002 * value)` (기본값, plan에서 오버라이드 가능)
2. `_extract_dim_numbers` → `_extract_dim_entries` 확장
   - 반환: `{value, style("diameter"|"linear"|"radius"|"callout"), view, text}`
   - style 판별: Ø → diameter, R → radius, C → callout, else → linear
3. 중복 판정 로직:
   - 동일 값(±tol) AND 동일 style → 중복 후보
   - 예외 1: datum이 다른 baseline 치수 (plan.dimensioning에서 판별)
   - 예외 2: 공차 표기가 다르면 중복 아님 (text에 ± 있으면 공차 추출 비교)
   - 예외 3: inspection_redundancy_allowed 플래그 (dim_intents에서 설정, 미래 확장)
4. plan.dimensioning.redundancy_tol_mm 파라미터 (기본 0.5)
5. 규칙 전체를 함수 docstring에 명시적 문서화

### S2. Golden 메트릭 프로파일 (`tests/golden_metrics.json` ~50줄)

**구조**:
```json
{
  "profile_version": "1.0",
  "description": "Phase 19.1 baseline — 14 metrics, flange template only",
  "defaults": {
    "overflow_count": {"max": 0},
    "text_overlap_pairs": {"max": 2},
    "notes_overflow": {"max": 0},
    "dim_redundancy": {"max": 6, "target": 0},
    "dim_completeness": {"min": 0},
    "datum_coherence": {"max": 0},
    "stroke_violations": {"max": 3}
  },
  "by_part_type": {
    "flange": {
      "dim_completeness": {"min": 80, "target": 100},
      "dim_redundancy": {"max": 4, "target": 0}
    }
  }
}
```
- `max`/`min`: CI gate (초과 시 FAIL)
- `target`: 리포트 목표치 (초과해도 PASS, 경고만)
- `profile_version`: QA 규칙 변경 시 버전업 강제

### S3. Quick Win 3개 (~20줄)

**S3a. repair_report.json에 plan 메타 추가** (`fcad.js`)
- `repairReport.plan = { used: true/false, template: "flange", part_type: "flange" }`
- plan 없으면 `{ used: false }`

**S3b. flange.toml reason 필드 보강**
- required dim_intents 6개에 reason 1줄씩 추가
- 예: `reason = "가장 큰 원통 외경 — 조립/검사 기준"`

**S3c. --no-plan CI 회귀 테스트** (`tests/test_no_plan.py`)
- flange config를 `--no-plan`으로 실행
- QA 점수 > 0, intent 메트릭 모두 0 확인
- 약 15줄 pytest 스타일

### S4. Golden 회귀 테스트 (`tests/test_qa_golden.py` ~80줄)

- 6개 SVG 각각의 QA JSON을 golden과 비교
- gate 초과 시 diff 출력: `FAIL: flange dim_redundancy=7 > max=4`
- target 초과 시 경고: `WARN: flange dim_redundancy=3 > target=0`
- profile_version 불일치 시 명시적 에러

## 변경하지 않는 것

- generate_drawing.py: 변경 없음
- intent_compiler.py: 변경 없음
- postprocess_svg.py: 변경 없음
- 새 템플릿(shaft/bracket): 이번 스텝에서 만들지 않음

## 검증

1. `fcad draw configs/examples/ks_flange.toml` → QA 점수 확인
2. `fcad draw configs/examples/ks_flange.toml --no-plan` → intent 메트릭 0 확인
3. `python3 tests/test_qa_golden.py` → 6개 SVG 모두 PASS
4. repair_report.json에 plan 메타 존재 확인
