# Phase 22: 중규모 확장 계획서

**베이스**: `master` a28388d (Phase 21 완료)
**총 예상 변경량**: ~610줄 (프리셋 4종은 이미 구현 확인 → 제외)

---

## 1. 코드 정리 (5줄)

### 문제

| 위치 | 버그 | 영향 |
|------|------|------|
| `_dim_plan.py:264` | `or 0.0` — offset_mm=0 입력 시 falsy로 기본값 적용 | 세만틱 오류 (0.0==0.0이라 실제 영향 없음) |
| `_dim_plan.py:319` | 동일 | 동일 |
| `_dim_plan.py:341-346` | if/else 양쪽 동일 화살표 방향 | 왼쪽 배치 시 화살표 방향 미반전 |

### 수정

**파일**: `scripts/_dim_plan.py` (3줄 수정)

```python
# L264, L319: or 0.0 → .get() 기본값
extra = plc.get("offset_mm", 0.0)

# L341-346: else 분기 화살표 방향 반전
if side_left:
    out.append(_arrow_head(x_dim, top, math.pi / 2))
    out.append(_arrow_head(x_dim, bottom, -math.pi / 2))
else:
    out.append(_arrow_head(x_dim, top, -math.pi / 2))    # 반전
    out.append(_arrow_head(x_dim, bottom, math.pi / 2))   # 반전
```

### 검증
```bash
fcad draw configs/examples/ks_flange.toml
# 좌측 배치 치수의 화살표 방향 육안 확인
python3 tests/test_qa_golden.py --verbose
python3 tests/test_no_plan.py
```

---

## 2. fcad validate CLI (~80줄)

### 현재 상태
- `scripts/plan_validator.py` (210줄) 이미 존재 — V1~V10 검증 로직 완비
- CLI에서 직접 호출 불가 (import 또는 stdin 파이프만 지원)

### 구현

**파일 1**: `bin/fcad.js` (+50줄)

- USAGE에 `fcad validate <config.toml|json>` 추가
- `main()`에 `command === 'validate'` 분기 추가
- `cmdValidate(configPath, flags)` 함수:
  - `loadConfig(absPath)` → JSON 직렬화
  - `runScript('plan_validator.py', config, { args: flags })` 호출
  - 결과 파싱: valid/errors/warnings 구조화 출력
  - `--strict`: warning도 에러 취급
  - exit code: 0=valid, 1=invalid

**파일 2**: `scripts/plan_validator.py` (+30줄)

- 스키마 마이그레이션 프레임워크:
  - `SCHEMA_MIGRATIONS = {"0.0→0.1": migrate_0_0_to_0_1}`
  - `--migrate` 플래그: 구버전 자동 업그레이드
  - 기존 V1~V10 검증 로직은 그대로 유지

### 수정 파일 목록

| 파일 | 변경 | 줄 수 |
|------|------|-------|
| `bin/fcad.js` | validate 명령 추가 | +50 |
| `scripts/plan_validator.py` | 마이그레이션 프레임워크 | +30 |
| **합계** | | **+80** |

### 검증
```bash
# 정상 config
fcad validate configs/examples/ks_flange.toml
# → VALID (0 errors, 0 warnings)

# 의도적 오류
echo '{"drawing_plan":{"schema_version":"0.1"}}' > /tmp/bad.json
fcad validate /tmp/bad.json
# → INVALID (missing part_type, missing views, ...)
# exit code 1

# 마이그레이션
fcad validate old_config.toml --migrate
# → 0.0 → 0.1 마이그레이션 적용 후 검증
```

---

## 3. 프리셋 현황 확인 + E2E 테스트 (+30줄)

### 조사 결과

`configs/overrides/presets/`에 11개 프리셋 이미 존재:

| 코드 | 파일 | 설명 |
|------|------|------|
| D3 | `V1_D3.toml` | required_only = true |
| S1 | `V1_D1_S1.toml` | clean spacing (offset=12, stack=9) |
| S2 | `V4_D1_S2.toml` | exam stroke profile |
| S3 | `V1_D1_S3.toml` | dense spacing (offset=5, stack=5) |

**결론**: MEMORY.md에 "미구현"으로 기록되어 있었으나 실제로는 전부 구현 완료.
→ MEMORY.md 수정 + 프리셋 E2E 검증만 추가.

### 추가 작업: 프리셋 통합 테스트

**파일**: `tests/test_qa_golden.py` (+30줄)

- 프리셋별 draw 실행 → QA 점수 범위 검증
  - V1_D3 (required_only): dim_completeness ≥ 0.8
  - V1_D1_S1 (clean): text_overlap = 0
  - V4_D1_S2 (exam): QA ≥ 70
  - V1_D1_S3 (dense): overflow ≤ 0.1

### 검증
```bash
python3 tests/test_qa_golden.py --verbose
# 프리셋별 테스트 케이스 PASS 확인
```

---

## 4. 인터랙티브 치수 편집 (~500줄)

### 아키텍처

```
[웹 뷰어] ──click──→ [SVG 치수 파싱] ──→ [편집 UI]
    ↑                                        │
    │                                   value 변경
    │                                        │
    └──── SVG 갱신 ←── WS ←── [서버] ←── TOML 업데이트
```

### 구현 단계

#### 4a. SVG 치수 파싱 + 하이라이트 (+120줄, viewer.js)

- `parseDimensions(svgEl)`: `<text>` 요소 중 치수 값 패턴 (∅, R, ±, 숫자) 매칭
- 각 치수에 `data-dim-id` 속성 매핑 (dim_intents ID와 연결)
- hover: 하이라이트 (outline + cursor: pointer)
- click: 편집 모드 진입

#### 4b. 인라인 편집 UI (+80줄, viewer.js)

- 치수 텍스트 위치에 `input[type=number]` 오버레이
- Enter: 확인 → WS 전송, Escape: 취소
- 변경 전/후 값 표시 (before: dim, after: colored)

#### 4c. 서버 WebSocket 핸들러 (+100줄, server.js)

- `action: 'update_dimension'`
  - payload: `{ dim_id, value_mm, config_path }`
  - TOML 로드 → dim_intents에서 id 매칭 → value_mm 업데이트
  - TOML 저장 (smol-toml stringify)
  - draw 파이프라인 재실행 → 갱신된 SVG + QA 점수 응답

#### 4d. TOML 직렬화 유틸 (+60줄, lib/toml-writer.js 신규)

- `updateDimIntent(tomlPath, dimId, newValue)`:
  - parseTOML → dim_intents에서 id 매칭 → value_mm 업데이트
  - tomlStringify → 파일 쓰기
  - 주석 보존 미지원 (smol-toml 한계) → 편집 시 경고 표시

#### 4e. 클라이언트 상태 관리 (+80줄, viewer.js)

- editHistory[]: undo/redo 스택 (최대 20)
- Ctrl+Z / Ctrl+Y 단축키
- 편집된 치수 목록 패널 (사이드바)
- "Reset All" 버튼 → 원본 TOML 복원

#### 4f. 에러 핸들링 + UX (+60줄, viewer.js)

- 재생성 중 스피너 + 입력 비활성화
- 파이프라인 에러 시 원본 SVG 유지 + 에러 토스트
- QA 점수 변화 표시 (before→after)
- 치수 간 충돌 감지 (OD < ID 등) → 경고 표시

### 수정 파일 목록

| 파일 | 변경 | 줄 수 |
|------|------|-------|
| `public/js/viewer.js` | 파싱+편집+상태+UX | +340 |
| `server.js` | update_dimension 핸들러 | +100 |
| `lib/toml-writer.js` (신규) | TOML 업데이트 유틸 | +60 |
| **합계** | | **+500** |

### 검증
```bash
fcad serve 3000
# 브라우저에서:
# 1. 예제 로드 → Draw 클릭
# 2. SVG 도면에서 치수 값 클릭
# 3. 값 수정 → Enter → SVG 자동 갱신 + QA 점수 변화 확인
# 4. Ctrl+Z 되돌리기 확인
# 5. 잘못된 값 (음수, OD<ID) 입력 시 경고 확인
```

---

## 5. Phase 23 대규모 확장 설계 (설계만, 구현은 다음)

### 5a. DFM (Design for Manufacturability) 체크

**목적**: 도면에서 가공성 위반 사항 자동 감지 + 경고

#### 체크 항목

| 코드 | 항목 | 기준 |
|------|------|------|
| DFM-01 | 최소 벽 두께 | 주조: 3mm, 가공: 1.5mm, 판금: 0.5mm |
| DFM-02 | 홀-엣지 최소 거리 | ≥ 2 x 홀직경 |
| DFM-03 | 홀-홀 최소 거리 | ≥ 1.5 x 홀직경 |
| DFM-04 | 필렛/챔퍼 누락 | 내부 코너에 R 없으면 경고 |
| DFM-05 | 드릴 깊이/직경 비 | ≤ 5:1 (표준), ≤ 10:1 (특수) |
| DFM-06 | 언더컷 감지 | 선반/밀링 접근 불가 형상 |

#### 아키텍처

```
TOML config ──→ [dfm_checker.py] ──→ DFM Report JSON
                       │
             형상 분석 (features 기반)
             + 공정별 제약 테이블
```

- 신규: `scripts/dfm_checker.py` (~400줄)
- 입력: enriched config (features 포함)
- 출력: `{ checks: [{code, severity, message, feature, recommendation}], score: 0-100 }`

#### TOML 확장

```toml
[manufacturing]
process = "machining"        # "casting" | "machining" | "sheet_metal" | "3d_printing"
material = "SS304"           # 재질 (DFM 기준 참조용)
batch_size = 100             # 수량 (비용 최적화 힌트)
```

### 5b. D4 Manufacturing 치수 전략

**목적**: 가공 기준면/기준축 기반으로 치수 자동 배치

#### 현재 전략 비교

| 전략 | 설명 |
|------|------|
| D1 Baseline | 데이텀 기준 단방향 치수 |
| D2 Ordinate | 좌표 원점 기준 누적 치수 |
| D3 Required Only | 최소 필수 치수만 |
| **D4 Manufacturing** | 공정 순서 기반 치수 그루핑 (신규) |

#### D4 특징

- 가공 공정 순서대로 치수 그루핑
- 기능면(functional surface) 우선 치수
- 기준축(datum axis) 기반 방사형 치수
- 공차 등급을 가공 정밀도에 맞춤 (IT6~IT14)
- dim_intents에 `process_step` 필드 추가

#### Phase 23 예상 규모

| 항목 | 줄 수 |
|------|-------|
| `scripts/dfm_checker.py` (신규) | ~400 |
| `scripts/intent_compiler.py` (D4 확장) | +150 |
| `scripts/qa_scorer.py` (DFM 메트릭) | +50 |
| `bin/fcad.js` (dfm 명령) | +40 |
| `configs/overrides/presets/V1_D4.toml` | +20 |
| TOML 스키마 확장 | +30 |
| 테스트 | +100 |
| **합계** | **~800** |

---

## 구현 순서 (의존성 기반)

```
Step 1: 코드 정리          ← 의존성 없음
Step 2: fcad validate CLI  ← 의존성 없음 (Step 1과 병렬 가능)
Step 3: 프리셋 E2E 테스트  ← Step 1 이후 (golden 기준 영향)
Step 4: 인터랙티브 편집    ← Step 2 이후 (validate로 수정된 TOML 검증 가능)
  4a → 4b → 4c → 4d → 4e → 4f (순차)
Step 5: Phase 23 설계 확정  ← Step 1~4 완료 후 (설계 문서만)
```

## 커밋 전략

| 커밋 | 내용 |
|------|------|
| `P22-1` | fix: _dim_plan 동일분기 + or 0.0 패턴 수정 |
| `P22-2` | feat: fcad validate CLI + 스키마 마이그레이션 |
| `P22-3` | test: 프리셋 통합 E2E 검증 추가 |
| `P22-4` | feat: 인터랙티브 치수 편집 (viewer + server) |
| `P22-5` | docs: Phase 23 DFM + D4 설계 문서 |

## 리스크

| 리스크 | 대응 |
|--------|------|
| 화살표 방향 반전이 SVG 좌표계에서 의도와 다를 수 있음 | Step 1에서 육안 검증 후 진행 |
| smol-toml stringify가 주석을 제거 | 편집 시 경고 표시 + 원본 백업 |
| draw 재실행 지연 (2~5초) | 스피너 표시 + 입력 비활성화 |
| WebSocket 동시 편집 충돌 | 단일 세션 전용 (다중 사용자 미지원) |
