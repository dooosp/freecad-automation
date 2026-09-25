# USB 허브 시험판 — 기하·DFM·변경 검토

**누락됐던 분석 입력을 실제로 생성해 보고서의 소프트웨어 판정을 `incomplete`에서 `pass`로 재현했다. 자동 홀 패턴 항목은 기존 네 홀의 이동을 요약한 파생 정보로 대조했다. 재질·하중·체결·실물 적합성은 아직 확인되지 않았다.**

이 문서는 합성 CAD 사례의 후속 검토다. 142 × 74 × 4 mm 판, Ø5.2 홀, 10 mm 이동량은 [합성 요구사항](source/docs/portfolio/usb-hub-plate-change/inputs/revision-contract.json)의 시험 가정이다. 실제 허브의 제조사 도면이나 실측값이 아니다. 사람의 제조 승인, 검사 성적서, FEA 결과로 사용하지 않는다.

## 실행과 보고서 판정

2026-09-25에 기존 결과 `output/usb-hub-portfolio-VAokFT`와 원본 입력을 보존하고, 새 `output/usb-hub-engineering-review-WRU6p3`에서 실행했다. Node 25.8.0 / FreeCAD 1.1.3 환경이며 기준 소스 HEAD는 `4dba0d32fe1b10f2266f27501165e56df9f943af`다. 당시 작업 트리에는 별도의 Studio·STEP 수정이 있었으므로 이 HEAD만으로 수정 내용 전체를 식별하지 않는다.

| 실행 | 실제 결과 | 확인 범위 |
| --- | --- | --- |
| 기존 A/B STEP·SVG 사본 재읽기 | exit 0, `measurements.pass=true` | 네 홀 중심·지름·관통 깊이와 도면 대응 재확인 |
| 새 B `create --strict-quality` | exit 0, 품질 `pass` | 새 형상 생성 및 기존 생성 품질 검사 |
| 새 B `draw --strict-quality` | exit 0, 품질 `pass`, QA 89, 근거 연결률 100% | 기존 도면 품질 게이트 |
| 기존 DFM 서비스 실행 | exit 0, 95점, minor 경고 1개 | 설정 기반 machining 규칙 검사 |
| 새 B `report --dfm --out-dir ...` | exit 0, `overall_status=pass`, 점수 92 | 생성·도면 품질 및 실제 DFM 결과를 보고서가 소비 |

이전 브라우저 보고서 작업 `df44fe09-2de4-4963-b649-f561fb392251`은 DFM만 빠진 것이 아니었다. 저장된 요약에는 **`create_quality`, `drawing_quality`, `dfm` 세 입력이 모두 없음**으로 기록돼 있고, 판정은 `incomplete`, 점수와 검토 준비 값은 `null`이었다. 이번에는 생성·도면 품질 파일을 보고서와 같은 새 출력 폴더에 만들고 `--dfm`을 사용했다. 이전 보고서에 새 상태를 덮어쓰지 않았다.

새 요약의 `ready_for_manufacturing_review=true`는 현재 프로그램 규칙의 계산 결과다. FEM·공차 분석은 여전히 `not_available`이며, DFM에 minor 경고가 있어도 현재 보고서 규칙은 전체 `pass`를 허용한다. 따라서 이 필드를 실제 제품의 강도·조립·제조 승인으로 해석하지 않는다. 임계값과 상태를 수정하거나 결과를 강제로 통과시키지 않았다.

기계 판독 기록은 [공개용 검토 JSON](engineering/review.json), 원본 보고서 요약, `rev-b/dfm.json`에 있다. 로컬 공개용 사본은 `output/usb-hub-engineering-review-WRU6p3/engineering-review-portable.json`이다. 필요한 수치·상태·원본 SHA-256을 옮겼으며 개인 머신 경로를 포함하지 않는다. 원본 JSON은 그대로 보존했다.

## 남은 DFM 경고의 의미

실제로 반환된 `DFM-04`는 **cut 연산이 있으나 fillet/chamfer 연산이 0개**라는 설정 수준의 신호다. 심각도는 `minor`, 점수 영향은 −5, `feature_id=null`, `material=unknown`이다. 원본 결과의 경고와 95점을 유지한다.

이 검사 구현은 실제 모서리의 응력이나 특정 코너 반경을 측정하지 않는다. 이 모델의 네 cut은 원통 관통홀을 만든다. 따라서 자동 제안인 “R ≥ 0.5 mm fillet 또는 chamfer 추가”를 특정 면의 확정 수정 사항으로 볼 근거가 없다. 홀 입구·출구의 버 제거와 모서리 처리 필요성은 실제 공정·체결 부품·도면 요구를 확인한 뒤 결정해야 한다. 이 검토에서는 원본 형상을 바꾸거나 경고를 제거하지 않았다.

`machining`은 재질·공정이 지정되지 않은 입력에 적용된 현재 도구의 기본 분석 시나리오다. 실제 절삭 공정 선정이나 재료의 적합성을 검증한 결과가 아니다. 검사 구현은 [DFM checker](https://github.com/dooosp/freecad-automation/blob/ed317324c9f5ee4152a8d0ad6d6bebdbfb620e88/scripts/dfm_checker.py)의 `check_fillet_chamfer`에 있다.

## 자동 홀 패턴 항목 대조

원래 변경 영향 기록은 A의 `feature:hole_pattern:7c08c061b8`를 제거, B의 `feature:hole_pattern:cd5c293952`를 추가로 분류한다. B delta 계획의 `ipi:3b81de1e20a54a03d0368891`은 이 파생 ID와 명시적 검사 요구사항을 연결하지 못해 `revision_impact_characteristic_unresolved`로 남아 있다.

저장된 STEP을 다시 읽은 네 원통면과 기존 geometry intelligence의 cylinder 목록을 X·Y·지름으로 대조했다. 좌표계는 판 왼쪽 아래가 원점이고 X는 오른쪽, Y는 위, Z는 두께 방향이다.

| 항목 | A | B |
| --- | --- | --- |
| D1 / D2 중심 | (12,12) / (12,62) | 동일 |
| H1 / H2 중심 | (130,12) / (130,62) | (120,12) / (120,62) |
| 홀 수·지름·관통 구간 | 4개, Ø5.2, Z=0…4 | 동일 |
| 수평·수직 중심 간격 | 118 / 50 mm | 108 / 50 mm |
| 패턴 중심 | (71,37) mm | (66,37) mm |
| 직사각형 외접원 지름 | √(118²+50²) = 128.156155 mm | √(108²+50²) = 119.012604 mm |
| 자동 `pcd_mm` | 128.156 | 119.013 |

외접원 지름은 검출값의 0.001 mm 반올림과 일치한다. 이 대조에서 패턴은 **D1·D2·H1·H2 네 홀의 역할을 유지하면서 가로 간격이 바뀐 집합**이다. 다섯 번째 실제 홀이나 별개의 새 체결 요구가 추가된 것은 아니다. 단, A/B의 형상이 동일하다는 뜻은 아니다. H홀은 실제로 10 mm 이동했다.

[STEP 패턴 검출기](https://github.com/dooosp/freecad-automation/blob/ed317324c9f5ee4152a8d0ad6d6bebdbfb620e88/scripts/step_feature_detector.py)의 `detect_bolt_patterns`는 같은 반경·축의 홀들이 평균 중심에서 비슷한 거리에 있는지 확인한다. 직사각형의 네 꼭짓점도 이 조건을 만족한다. 따라서 내부 이름 `bolt_circle`과 `pcd_mm`만으로 동일 각도 간격의 원형 볼트 배치나 승인된 PCD 치수라고 해석하지 않는다. [파생 특징 생성](https://github.com/dooosp/freecad-automation/blob/ed317324c9f5ee4152a8d0ad6d6bebdbfb620e88/scripts/geometry/feature_extract.py)의 `_feature_record`는 entity 참조를 특징 ID에 반영하므로, 중심·외접원 값의 변경이 ID 변경으로 이어진다.

**후속 해석 상태는 `geometry_correspondence_demonstrated_pending_human_review`다.** 이 고정 사례에서는 멤버 기하와 명시적 홀 역할로 대응을 설명할 수 있다. 일반적인 BREP 특징 동일성 추적이 완성된 것은 아니다. canonical 변경 영향·전체 17개 계획·delta 9개 계획은 한 바이트도 수정하지 않았다. 원래 항목의 `review_required`, `not_started`, 공차·방법 `null`, 사람 검토·릴리스 필요 조건을 유지한다. 패턴 항목을 삭제하거나 검사 완료로 표시하지 않았다.

## 형상에서 계산 가능한 여유

다음 값은 실제 저장 STEP의 명목 형상에서 계산했다. 제조 공차나 허용치가 아니다. 홀 가장자리 여유는 중심 거리에서 반지름 2.6 mm를 뺀 값이다.

| 기하량 | A | B | 해석 |
| --- | --- | --- | --- |
| H홀 오른쪽 가장자리 여유 | 9.4 mm | 19.4 mm | 오른쪽 여유가 10 mm 증가 |
| 왼쪽·위·아래 최소 가장자리 여유 | 9.4 mm | 9.4 mm | 전체 최소 여유는 증가하지 않음 |
| 가로 홀 사이의 순수 재료 간격 | 112.8 mm | 102.8 mm | 중심 간격에서 Ø5.2를 뺀 값 |
| 세로 홀 사이의 순수 재료 간격 | 44.8 mm | 44.8 mm | 유지 |
| X에 수직인 판의 총 단면적 | 296 mm² | 296 mm² | 74×4 |
| 두 홀 중심을 지나는 단면의 순 면적 | 254.4 mm² | 254.4 mm² | (74−2×5.2)×4; 국부 응력 계산은 아님 |
| STEP 체적 | 약 41,692.20534 mm³ | 동일 | 재질·밀도 미정이므로 질량을 만들지 않음 |

## 같은 가정 아래의 굽힘 민감도

비교용으로 **D홀 중심선 X=12의 전 폭이 완전 고정되고, H홀 중심선에 Z방향 합력 P가 폭 전체에 대칭으로 전달되는 균일 직사각형 외팔보**를 가정한다. 실제 두 볼트 체결이 전 폭 고정을 제공한다는 근거는 없다. 홀에 의한 단면 변화, 국부 접촉·베어링·응력 집중, 비틀림, 넓은 판의 거동은 이 계산에 포함하지 않았다.

폭 `b=74 mm`, 두께 `t=4 mm`인 총 단면에 `I=bt³/12=394.6667 mm⁴`, 단면계수 `I/(t/2)=197.3333 mm³`를 사용한다. 선형 탄성·작은 처짐 조건의 일반식은 `σ=PL(t/2)/I`, `δ=PL³/(3EI)`다. 공식 근거는 MIT의 [보 굽힘 응력 강의자료](https://ocw.mit.edu/courses/1-050-solid-mechanics-fall-2004/8f0200f4ca3236383a2ef048c7ec4c40_emech9_04.pdf)와 [끝단 집중하중 외팔보 참고식](https://ocw.mit.edu/courses/1-050-solid-mechanics-fall-2004/fd4eff39aec922b8c07660006f40686e_pset04_11.pdf)이다.

| 이상화 계산 | A, L=118 mm | B, L=108 mm |
| --- | --- | --- |
| 단위 합력당 고정단 굽힘 모멘트 M/P | 118 mm | 108 mm |
| 총 단면 굽힘 응력 σ/P | 0.597973 MPa/N | 0.547297 MPa/N |
| 끝단 처짐 계수 Eδ/P | 1387.695946 mm⁻¹ | 1063.945946 mm⁻¹ |

`E`를 N/mm², `P`를 N으로 넣으면 B의 이상화 처짐은 `δ=1063.945946×P/E mm`다. 실제 E·P는 지정하지 않았다. 같은 하중·재질·단면·구속 가정에서 B/A 응력비는 `108/118=0.91525`, 처짐비는 `(108/118)³=0.76670`이다. 즉 이 **가정 안에서만** 응력 계수는 약 8.47%, 처짐 계수는 약 23.33% 작다. 실제 조립체가 그만큼 개선된다는 예측이나 허용 하중은 아니다. 안전율, 피로 수명, 볼트 토크, 허용 변형은 산출하지 않았다.

## 물리 검증 전 남은 항목

| 필요한 실제 입력·검토 | 현재 상태 | 이후 판단 |
| --- | --- | --- |
| 허브·브래킷·책상 고정점 치수, 커넥터·케이블 간섭 | 미확인 | 실측 또는 제조사 도면으로 조립·접근성 확인 |
| 재질·등급·열처리·두께 공차·표면 처리 | 미정 | 적절한 탄성·강도·부식 특성과 공정 선정 |
| 사용·케이블·충격 하중과 작용점·방향 | 미정 | 하중 조합 및 실제 지지 조건 결정 |
| 볼트·와셔·나사 물림·체결 토크·접촉 조건 | 미정 | 베어링, 미끄럼, 파단 및 체결 검토 |
| 치수·위치 공차, 기준 체계, 검사 방법·장비·샘플링 | `null` 유지 | 승인된 요구사항과 측정 계획으로 별도 정의 |
| 구조 검증·시험 및 사람의 설계 승인 | 수행하지 않음 | 조건 확정 후 적절한 계산/해석과 실제 시험 |

공차 없이 소프트웨어 좌표 비교에 사용한 0.00001 mm와 SVG 반올림 비교 0.03 mm를 제조 허용치로 옮기지 않는다. `DFM-04`의 국부 처리도 위 입력이 정해진 후 검토한다.

## 재현과 산출물 사용

먼저 [원래 재현 도구](source/docs/portfolio/usb-hub-plate-change/reproduce.mjs)로 사례 결과를 만들고, 출력된 폴더를 아래처럼 넘긴다.

```bash
node docs/portfolio/usb-hub-plate-change/engineering-review.mjs output/usb-hub-portfolio-VAokFT
```

[후속 검토 도구](source/docs/portfolio/usb-hub-plate-change/engineering-review.mjs)는 매번 새 `output/usb-hub-engineering-review-*` 폴더를 만든다. 원본 결과·입력의 SHA-256을 전후 대조하고, 기존 `measure.py`, `create`, `draw`, DFM 서비스, `report --dfm`을 실행한다. `commands.json`은 명령·종료 코드·로그, `source-hashes.json`은 원본 보존, `output-hashes.json`은 해당 실행 생성물의 해시를 기록한다. `engineering-review.json`은 원래 경로를 포함한 로컬 상세 기록, `engineering-review-portable.json`은 공개용 요약이다. 생성 데이터는 `output/`에 두고 소스로 커밋하지 않는다.

위 공개 링크의 9월 25일 검토 사본에는 이번 검토에서 확인한 이전 브라우저 보고서(`prior_report`), 원본 해시 목록(`source_artifacts`), 공식 출처와 PDF 관찰(`primary_technical_references`, `presentation_review`)을 별도로 덧붙였다. 이 과거 실행의 보충 기록은 재현 도구가 자동 생성하지 않는다. 재실행은 새 실행의 점수·DFM·패턴·기하 계산과 해당 파일의 해시를 생성한다. 공개 사본의 보충 필드까지 똑같이 재생성된다고 주장하지 않는다.

이 실행의 PDF 3페이지를 모두 렌더링해 확인했다. DFM 95점과 FEM·공차 데이터 부재는 표시되지만, 기존 PDF 레이아웃의 제목/생성 시각 및 3페이지 권고사항/경고 수 줄에 겹침이 있다. 원본 PDF를 수정하지 않았으며, 이를 완성된 편집물로 제시하지 않는다. 공개 설명은 이 검토 문서와 원본 해시를 연결한 portable JSON을 우선한다.
