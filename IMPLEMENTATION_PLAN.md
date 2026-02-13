# Phase 24: DFM 고도화 + D4 확장 + 포트폴리오

**베이스**: `master` 66c86f9 (Phase 23 완료)
**총 예상 변경량**: ~520줄 (7개 파일)

---

## 현재 상태 요약

| 영역 | 상태 | 한계 |
|------|------|------|
| DFM 체커 (`dfm_checker.py`, 496줄) | 6개 검사, 4공정 | **실린더 중심** — 박스 벽두께 미지원 |
| DFM-06 언더컷 | 동축 스텝다운 탐지 | 다단 보어 severity 미분화, T-슬롯 미지원 |
| D4 (`intent_compiler.py`) | 5공정 맵 (선반 중심) | milling 공정 없음, 미매핑 feature는 skip |
| 템플릿 4종 | `[manufacturing]` 기본값만 | dim_intents에 `process_step` 미할당 |
| 리포트 (`engineering_report.py`) | 공차/MC/FEM/BOM | **DFM 섹션 없음** |
| 테스트 | 21개 PASS | — |

---

## 구현 단위 (50줄 단위, 순차 검증)

### Unit 1: 박스 형상 벽두께 분석 — 헬퍼 (~50줄)

**파일**: `scripts/dfm_checker.py`

`_extract_bodies()` 확장 + 새 헬퍼 추가:
- `_analyze_box_walls(boxes, holes, outer_ref)`:
  - box 외벽 ↔ 가장 가까운 hole edge 간 최소 거리
  - 2개 box가 직교 교차 시 (L-bracket) 교차부 벽두께 계산
  - housing 패턴: box 내 cavity(cut box)가 있으면 cavity 벽두께
- `_box_face_pairs(box)`: 대향 면 쌍 추출 (width/height/depth 축별)
- 반환: `[(wall_mm, feature_desc), ...]`

**검증**: 단위 함수 독립 테스트

---

### Unit 2: 박스 벽두께 — DFM-01 통합 (~50줄)

**파일**: `scripts/dfm_checker.py`

`check_wall_thickness()` 수정:
- 기존 실린더 로직 유지 (`feature_type: "cylinder_wall"`)
- `_analyze_box_walls()` 결과를 DFM-01 체크에 병합
- 결과에 `feature_type: "box_wall"` 태그 추가
- L-bracket 교차부: `feature_type: "intersection_wall"`
- 임계값은 동일 `PROCESS_CONSTRAINTS.min_wall` 사용

**검증**: ks_flange (기존 통과) + 신규 box config 테스트

---

### Unit 3: 복합 형상 언더컷 개선 (~50줄)

**파일**: `scripts/dfm_checker.py`

`check_undercut()` 확장:
- **다단 보어**: 3단계+ 동축 감소 시 severity `warning` → `error` 상향
  - 기존 2단 = warning 유지, 3단+ = error
- **T-슬롯 탐지**: `_detect_t_slot(boxes)` 신규
  - 두 box 교차 여부: 위치 + 크기로 겹침 판단
  - 한쪽 폭 < 다른쪽 폭의 60% → T-슬롯 패턴
  - `DFM-06` 코드, severity=warning, feature="t_slot"
- **도구 접근성**: 기존 undercut에 `tool_approach: "axial"|"radial"` 추가

**검증**: 다단 보어 config + T-슬롯 config 테스트

---

### Unit 4: 템플릿 [manufacturing] 확장 (~40줄)

**파일**: `configs/templates/{shaft,bracket,housing,flange}.toml`

각 템플릿의 `[manufacturing]` 섹션에 `process_sequence` 추가 + dim_intents에 `process_step` 매핑:

**shaft.toml** (+10줄):
```toml
[manufacturing]
process_sequence = ["face", "rough_turn", "finish_turn", "drill", "bore"]
# dim_intents 매핑: TOTAL_LENGTH→face, OD1/OD2→rough_turn, KEYWAY_W→finish_turn
```

**bracket.toml** (+10줄):
```toml
[manufacturing]
process_sequence = ["face", "rough_mill", "drill", "deburr"]
# dim_intents 매핑: WIDTH/HEIGHT→face, THK/WEB_H→rough_mill, HOLE_DIA→drill
```

**housing.toml** (+10줄):
```toml
[manufacturing]
process_sequence = ["face", "rough_mill", "bore", "drill", "finish_mill"]
# dim_intents 매핑: WIDTH/HEIGHT/DEPTH→face, WALL_THK→rough_mill, BORE_ID→bore
```

**flange.toml** (+10줄): 기존 확인 + `process_sequence` 보강

**검증**: TOML 파싱 확인 (`node -e "..."`)

---

### Unit 5: D4 공정 맵 확장 (~50줄)

**파일**: `scripts/intent_compiler.py`

`PROCESS_FEATURE_MAP` + `TOLERANCE_GRADE_MAP` 확장:
```python
# 밀링 공정 추가
PROCESS_FEATURE_MAP["rough_mill"] = ["width", "height", "depth", "wall_thickness"]
PROCESS_FEATURE_MAP["finish_mill"] = ["surface_finish", "flatness"]
PROCESS_FEATURE_MAP["deburr"] = ["edge_break"]

TOLERANCE_GRADE_MAP["rough_mill"] = "IT11"
TOLERANCE_GRADE_MAP["finish_mill"] = "IT8"
TOLERANCE_GRADE_MAP["deburr"] = "IT12"
```

`_apply_d4_manufacturing()` 수정:
- 미매핑 feature → `"general"` 공정으로 폴백 (현재 skip)
- `TOLERANCE_GRADE_MAP["general"] = "IT12"` 추가
- 폴백 시 info 로그 출력

**검증**: bracket config + D4 프리셋 → rough_mill 할당 확인

---

### Unit 6: DFM 리포트 — engineering_report 확장 (~50줄)

**파일**: `scripts/engineering_report.py`

`_render_dfm_section(ax, dfm_results)` 신규:
- DFM 스코어 바 차트 (0~100, 색상: 80+=초록, 50+=노랑, <50=빨강)
- 체크 결과 요약 테이블: 코드 | 심각도 | 건수
- 공정 시퀀스 시각화 (process_step별 그룹)

레이아웃 변경:
- 기존 2×2 그리드 → 3×2 (DFM 스코어 + DFM 테이블 추가)
- DFM 결과 없으면 기존 2×2 유지 (하위 호환)

**검증**: DFM 결과 포함 리포트 생성 확인

---

### Unit 7: DFM 리포트 — CLI 통합 (~30줄)

**파일**: `bin/fcad.js`

`cmdReport()` 수정:
- `--dfm` 플래그 추가
- `--dfm` 시: DFM 체커 먼저 실행 → 결과를 report config에 `dfm_results`로 주입
- USAGE 문자열 업데이트

**검증**: `fcad report config.toml --dfm` 실행

---

### Unit 8: 테스트 보강 — DFM (~50줄)

**파일**: `tests/test_dfm.py`

| 테스트 클래스 | 신규 케이스 | 내용 |
|-------------|-----------|------|
| TestDFM01WallThickness | +2 | `box_thin_wall_error`, `bracket_intersection_wall` |
| TestDFM06Undercut | +2 | `multi_step_bore_error`, `t_slot_detection` |
| TestD4ManufacturingStrategy | +2 | `milling_process_assignment`, `unmapped_feature_fallback` |

총 테스트: 21 → 27개

**검증**: `python3 tests/test_dfm.py --verbose` 전체 통과

---

### Unit 9: 테스트 보강 — DFM 리포트 (~30줄)

**파일**: `tests/test_dfm.py`

| 테스트 클래스 | 신규 케이스 | 내용 |
|-------------|-----------|------|
| TestDFMReport (신규) | +2 | `dfm_section_rendered`, `no_dfm_fallback_layout` |

총 테스트: 27 → 29개

**검증**: 전체 테스트 실행

---

### Unit 10: 포트폴리오 반영 (~40줄)

**파일**: `~/portfolio/PORTFOLIO.md`

Phase 12~24 성과 추가 (문제→해결→결과 프레임):
- **TechDraw 자동 도면**: KS 규격 GD&T + SVG 후처리 + 프리셋 12종
- **DFM 체커**: 8개 검사 (박스+실린더), 4공정, 제조성 점수
- **D4 치수 전략**: 공정 시퀀스 그루핑, IT 등급 자동매핑, 밀링 확장
- 수치 업데이트: "~21,500줄", "테스트 29개", "Phase 24"

**빌드**: `bash ~/portfolio/build.sh` → PDF 재생성

---

## 수정 파일 요약

| 파일 | 변경 유형 | 예상 줄수 | Unit |
|------|----------|----------|------|
| `scripts/dfm_checker.py` | 수정 | +150 | 1,2,3 |
| `scripts/intent_compiler.py` | 수정 | +50 | 5 |
| `scripts/engineering_report.py` | 수정 | +80 | 6 |
| `configs/templates/*.toml` (4파일) | 수정 | +40 | 4 |
| `bin/fcad.js` | 수정 | +30 | 7 |
| `tests/test_dfm.py` | 수정 | +80 | 8,9 |
| `~/portfolio/PORTFOLIO.md` | 수정 | +40 | 10 |
| **합계** | | **~470** | |

---

## 구현 순서 (의존성 기반)

```
Unit 1-2 (박스 벽두께)  ──┐
Unit 3   (언더컷 개선)  ──┤
Unit 4   (템플릿 확장)  ──┼── Unit 8 (테스트-DFM)
Unit 5   (D4 공정 맵)  ──┤
Unit 6-7 (DFM 리포트)  ──┴── Unit 9 (테스트-리포트)
                                  └── Unit 10 (포트폴리오)
```

Unit 1~7: 병렬 가능 (의존성 없음)
Unit 8~9: Unit 1~7 완료 후
Unit 10: 최후

---

## 커밋 전략

| 커밋 | 내용 | Unit |
|------|------|------|
| `P24-1` | feat: box wall thickness + composite undercut DFM checks | 1,2,3 |
| `P24-2` | feat: D4 milling process map + template manufacturing sections | 4,5 |
| `P24-3` | feat: DFM report integration in engineering report | 6,7 |
| `P24-4` | test: Phase 24 DFM + D4 test suite (29 cases) | 8,9 |
| `P24-5` | docs: portfolio Phase 12-24 achievements | 10 |

---

## 리스크

| 리스크 | 대응 |
|--------|------|
| L-bracket 교차부 벽두께 계산 부정확 | 직교 박스 교차만 지원, 비직교는 Phase 25로 |
| T-슬롯 탐지가 TOML 형상에서 어려움 | boolean subtract 패턴 (box cut 교차)으로 간접 탐지 |
| 리포트 레이아웃 3×2에서 DFM 테이블 overflow | 체크 5건 초과 시 상위 5건만 표시 + 요약 |
| 밀링 공정 맵이 실제 가공과 불일치 | 기본 매핑 + `process_step` 수동 오버라이드 유지 |
