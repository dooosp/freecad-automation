# CAD 기준에서 검사 근거까지: FreeCAD–MVS 품질보증 사례

2026-09-18 실행. 대상은 Coolgear 기준 장착판 USB-REF-ADAPTER / R1, 상면 한 뷰와 H1–H4/P1–P4의 8개 홀이다. 실제 CAD의 특징을 합성 이미지 검사·검토 기록·검증 ZIP까지 연결했다. **연동은 검증했지만 작은 홀 이상을 놓치는 성능 한계가 있으며, R2 재검사 계획은 보류 상태다.**

**저장소 전체 검증은 HOLD다.** MVS 전체 실행은 1,868건 통과·19건 실패였고, 누락 시험 자료를 복원한 뒤 실패 19건만 다시 실행해 2건 통과·17건 실패를 확인했다. 아래의 연동 검증 통과를 전체 저장소 PASS로 확대하지 않는다.

실물 시험과 제조 승인은 이번 범위가 아니다. physical_test=not_tested, manufacturing_release=false, 실사용 하중·체결 토크 null을 유지한다. 자동 작성된 검토 기록은 사람의 승인으로 세지 않는다.

로컬 [증거 뷰어](../../output/freecad-mvs-qa-case/index.html)에서 입력·정답 마스크·탐지 마스크를 비교할 수 있다. [한 페이지 PDF](../../output/freecad-mvs-qa-case/one-page.ko.pdf), [요구사항 CSV](../../output/freecad-mvs-qa-case/requirements.csv), [파일 무결성 목록](../../output/freecad-mvs-qa-case/evidence-index.json)은 실제 생성 자료다. output/과 실행 로그는 버전 관리에서 제외한다.

## 수행 범위와 버전

| 대상 | 사용 버전과 역할 |
|---|---|
| FreeCAD 출발점 | 코드 a4a1a3f696deaf260cc8b2879d98d9c2ffd0e8b8, 승인된 계획 포함 1ef42b2d469d0646c5f3996707d5588f9790a52b |
| R1 producer | 84e0a142c78359cf305907a56bdca3a66e80bb2b; 실제 FreeCAD BREP/STEP 읽기와 8개 원통면 검증 |
| R2 시연 입력 | 877bebf26cba6017f6a973608436fb298c000ada; H4 X만 113.0 → 113.5 mm 변경 |
| MVS 출발점 | 3ced81cd94edf1f15f80ce140eab59a267867b17; 원래 dirty 작업 트리와 분리 |
| MVS consumer / ZIP | 7e1eda8782fa6a4b943e3931a14af44458b52abb / 499bf1f57b80c4a83918366eaaecc4771c1bfa10 |
| 고정 평가 | 프로토콜 69712405b38dbc30d351cb6cf9bb91be91f1793d, 실행 42f195b4556c9a462eb54b7c1c12da9f9ae1ea2f |

FreeCAD 1.1.3 실제 런타임, Node v25.8.0, MVS Python 3.12.13을 사용했다. [실행 기록](../../output/freecad-mvs-qa-case/commands/index.json)에 명령·작업 경로·HEAD·시각·종료 코드·로그 해시를 보존했다. 개발 중 RED/GREEN 기록의 HEAD는 변경을 커밋하기 전 HEAD이며, 정식 export와 고정 평가는 각각 명시된 커밋에서 실행했다.

## 검사 항목의 근거

제조사 원도면의 공칭 장착 피치는 84×25.2 mm이며 표제란 일반 공차는 ±0.15 mm다. 이 값은 허브 도면의 기준이다. 장착판 외형 142×74×4 mm, H군 지름 4.0 mm, P군 지름 5.5 mm와 배치 좌표는 이 프로젝트의 설계 선택이다. 장착 중심 비교의 0.10 mm는 입력에 선언된 소프트웨어 비교 허용값이며 제조사 공차나 승인된 실물 검사 기준으로 바꾸어 해석하지 않는다. [Coolgear 원도면](https://www.coolgear.com/wp-content/uploads/CG-U3MINI4PH-G2_Drawing_JWV1-1.pdf), [R1 설계 입력](../../configs/examples/usb_hub_reference_mount.json).

연결표는 다음 9개 열을 고정했다. 전체 14개 행과 8개 홀별 좌표·지름은 [CSV](../../output/freecad-mvs-qa-case/requirements.csv)와 [JSON](../../output/freecad-mvs-qa-case/requirements.json)에 있다.

| requirement_id | feature_id | source_revision | requirement_kind | criterion_source | method | evidence_ref | status | limitation |
|---|---|---|---|---|---|---|---|---|
| REQ-01 | H1–H4 | R1 | manufacturer_nominal | 제조사 도면 피치 84×25.2 | 도면·입력 대조 | manufacturer-source.json | reference_recorded | 허브 공칭값, 현물 측정 아님 |
| REQ-hole_H1 등 8행 | 각 hole ID | R1 | design_choice | R1 shapes의 중심·지름 | 원통면 측정·ROI·왕복 확인 | cad/r1/cad-metadata.json | pass_digital_binding | 실물 치수 합격 판정 아님 |
| REQ-10 | hole_H4 | R1→R2 | software_comparison_tolerance | 0.10 mm | 실제 CAD 중심 비교 | native/r2/*_mounting_comparison.json | fail: 0.50 > 0.10 | 비교 허용값과 제조 공차 구분 |
| REQ-11 | 8개 ROI | R1 | software_detection_policy | 고정 임계값 0.0025 | 분리된 합성 평가 | evaluation/results.json | FN 5/8, FP 0/2 | 같은 CAD의 상관된 자료 |
| REQ-12 | 식별·리비전·해시 | R1/R2 | software_integrity | 독립 선택 digest | 거부 반례 4건 | evaluation/results.json | pass | 탐지 정확도 분모에서 제외 |
| REQ-13 | H4·식별 해결 | R2 | change_control | 공식 요구사항 미확정 | 변경 영향·빈 재검사 서식 | revision/delta-inspection-plan.json | hold_not_released | 검사·검토·발행 미완료 |
| REQ-14 | 조립체 | R1/R2 | unknown_physical_requirement | 하중·토크 null | 미확정 상태 보존 | summary.json | not_tested | 제조 승인 false |

위 표의 evidence_ref는 로컬 증거 묶음 기준 경로다. 정식 JSON의 원래 절대경로는 실행 당시 출처로 보존했고, 묶음 안의 실제 위치는 [복사 출처 목록](../../output/freecad-mvs-qa-case/copy-provenance.json)에서 확인한다.

## 소프트웨어 시정조치

**이번 연동 — 특징 ID 소실.** 기준 PNG 가져오기는 성공했지만 case가 가져온 8개 홀 대신 기본 예제 특징 5개를 반환했다. test_imported_feature_ids_reach_case의 실제 실패를 먼저 보존했다. 수정은 기준 이미지와 CAD payload·ROI를 같은 SQLite 트랜잭션으로 저장하고, 분석·화면·ZIP·재가져오기가 같은 불변 binding을 사용하게 한 것이다. 두 모델 호출 모두 저장된 ROI를 받으며, binding 누락·손상 시 기본 예제로 돌아가지 않고 거부한다. [RED](../../output/freecad-mvs-qa-case/commands/mvs/g1-feature-loss-red.log), [consumer GREEN](../../output/freecad-mvs-qa-case/commands/mvs/g3-green.log), [실제 왕복 결과](../../output/freecad-mvs-qa-case/roundtrip/api-roundtrip.json).

**이번 연동 — 재해시한 잘못된 판정과 화면 잘림.** 내부 파일을 모두 재해시하면 변조된 임계값·판정이 검증을 통과하는 반례 2건을 재현했다. 변경하지 않은 임계값 0.0025와 보존된 ROI로 분석을 재생해 판정·마스크·점수·특징을 대조하도록 수정했다. 실제 브라우저에서는 이미지의 cover와 마스크의 contain 차이로 기준판이 잘렸고, 같은 contain으로 맞춘 뒤 한국어 화면의 8개 홀과 마스크를 확인했다. [정책 RED](../../output/freecad-mvs-qa-case/commands/mvs/g4-classification-policy-red.log), [GREEN](../../output/freecad-mvs-qa-case/commands/mvs/g4-policy-final.log), [실제 화면](../../output/freecad-mvs-qa-case/screenshots/review-ko.png).

**과거 도면 수정 — 별도 입력별 관측.** 2026-09-15의 초기 묶음은 4dba0d32fe1b10f2266f27501165e56df9f943af, 입력 SHA f96d06ed…b68e5, 필수 추적 0/5, 전체 치수 18개, 상태 fail이었다. a910abf549168a1b68fa80334909b283e8ab0ff5의 수정 묶음은 입력 SHA 5b10a306…983c5, 필수 추적 6/6, 전체 치수 19개, 상태 pass였다. 두 묶음 모두 QA 점수는 91이었다.

분류 결과 bushing_plate를 억지로 바꾸지 않고 평판 형상 조건을 확인한 뒤, 혼합 지름을 H/P 명시 그룹으로 나누어 실제 원통면과 치수 객체를 연결했다. 후속 7844ce2는 그룹의 실제 원 중심과 고유 SVG anchor를 강화했다. **입력 해시와 필수 항목 수가 달라 같은 조건에서의 “0→100% 개선율”로 주장하지 않는다.** 원본 ZIP CRC, manifest, dimension-map의 required 분모와 traceability를 확인한 [관측 자료](../../output/freecad-mvs-qa-case/historical/comparison.json)를 제공한다. 현재 코드에서도 실제 FreeCAD를 쓰는 잘못된 그룹·지름·누락 홀 등의 반례 회귀를 다시 실행했다. [검사 코드](../../tests/test_plate_runtime_traceability.py), [새 실행 로그](../../output/freecad-mvs-qa-case/commands/freecad/g6-native-regression.log).

## 합성 평가: 연결 성공과 탐지 성공을 구분

프로토콜을 먼저 커밋한 뒤 smoke 5건과 evaluation 10건을 실행했다. 특징 위치/교란 종류별 그룹은 두 집합에 중복되지 않지만, 같은 CAD에서 파생된 상관된 합성 자료다. 모델에는 기준 이미지·검사 이미지·사전 선택한 ROI만 전달하며 정답·결함 파라미터·seed는 평가기에 남긴다. 임계값이나 E1 설정은 결과를 보고 조정하지 않았다.

| 지표 | 실제 결과 | 해석 범위 |
|---|---:|---|
| 평가 건수 / 그룹 | 10 / 10 | 정상 2, 이상 8 |
| TP / TN / FP / FN | 3 / 2 / 0 / 5 | recall 3/8=37.5%, FPR 0/2=0% |
| 홀 영역 내 양성 사례의 특징 연결 | 6/6 | 잘못된/누락된 연결 0; 전체 판정 성공을 뜻하지 않음 |
| 영역 밖 양성 / 영역 밖 탐지 사례 | 2 / 2 | hole ID를 억지로 할당하지 않음 |
| 실행 오류 / 모델 abstention | 0 / 0 | 사람 검토는 0/10, 모두 미검토 |
| 별도 smoke TP/TN/FP/FN | 0 / 2 / 0 / 3 | 위 평가 수치에 합산하지 않음 |
| 식별·리비전·바이트 변조 거부 | 4/4 | 정합성 반례; 탐지 정확도에 합산하지 않음 |

예를 들어 H2를 메운 e001은 hole_H2에 연결됐지만 점수 0.00098997이 임계값보다 낮아 정상으로 분류됐다. H4만 5 px 옮긴 e003은 전역 이동 (0,0)이고 정상으로 놓쳤다. 전체 이미지를 (7,-4) px 이동한 e008은 정합이 해당 이동을 복원하고 정상으로 남았다. 국소 결함과 촬영 위치 변화는 별도 사례다. [모든 입력·정답·결과](../../output/freecad-mvs-qa-case/evaluation/results.json).

실험은 성능 적합 판정이나 현장 불량률 추정이 아니다. 향후 탐지 정책 개선은 별도 요구·데이터·프로토콜로 검증해야 한다. 대칭 상면만으로 180° 방향이나 좌우 구분도 보장할 수 없다.

## R2 변경과 재검사 보류

R1과 원래 mounting_reference를 보존한 채 R2 시연용 새 입력에서 H4 X를 0.5 mm 변경했다. 실제 create --strict-quality와 draw --strict-quality는 종료 코드 0이며 도면 품질은 pass/91이다. 별도의 [장착 기준 비교](../../output/freecad-mvs-qa-case/native/r2/usb_hub_reference_adapter_R2_demo_mounting_comparison.json)는 H4 오차 0.50 mm가 허용값 0.10 mm를 넘어서 fail이다. 도면 품질 점수는 장착 적합성 판정을 덮어쓰지 않는다.

R2를 새 MVS case에 넣어 자기 기준과 비교하면 정상이다. R2 기준을 R1 case에 넣거나 반대로 넣으면 리비전 불일치로 거부하며 case는 변하지 않는다. 이 차이가 “영상 일치”와 “변경 승인”을 분리하는 이유다.

기존 review-context와 compare-rev는 파일명에서 유래한 다른 part ID를 처음에 거부했다. 원본 context를 보존하고 승인된 연동 별칭 USB-REF-ADAPTER와 R1/R2 대응을 별도 context에 기록한 뒤 다시 실행했다. 명령은 성공했지만 config 이름·package 식별·공식 검사 요구사항이 완성되지 않아 결정은 blocked_insufficient_identity_or_inputs다. 추정값으로 보완하지 않았다.

inspection-plan --scope delta가 만든 두 항목은 identity_resolution, hole_H4이며 상태는 blocked다. 측정값·단위·결과·작업자·검토자·방법·장비·완료시각은 [빈 결과 서식](../../output/freecad-mvs-qa-case/revision/delta-result-template.csv)에 비워 두었다. 검사 의뢰서가 생성됐다는 사실은 발행·발송·실측 완료를 뜻하지 않는다.

## 검증 상태

모든 새 실행은 2026-09-18이며 상세 UTC 시각은 개별 명령 기록에 있다.

| 범위 | 커밋 / 명령 | 종료·상태 |
|---|---|---|
| Producer 실제 R1 | 84e0a142 / node scripts/export-mvs-reference.js … | 0; 실제 BREP 검증·8개 ROI |
| Producer 실제 R2 | 877bebf / create, draw, export | 각 0; 장착 비교 결과는 별도로 fail |
| Consumer | G3 변경 / feature binding·registry·model·schema 회귀 | 0; 88 passed, 추가 malformed version 2 passed |
| ZIP 왕복·판정 재검증 | G4 변경 / 회귀·정책·API import/export | 0; 120 passed 후 정책 추가 최종 38 passed; ZIP byte-identical |
| 고정 합성 평가 | 42f195b / scripts/run_coolgear_integration.py | 0; 실행 완료, FN 5/8 성능 한계 |
| 웹 | 42f195b / 별도 web check, E2E; G4/G6 실제 브라우저 | 각 0; 최종 E2E 15 passed, 한국어 표시·재가져오기 확인 |
| FreeCAD 최종 | 877bebf / npm test; FCAD_MVS_RUNTIME=1 native regression; source hygiene | 각 0; npm test 통과, 투영·FreeCAD 회귀 31 passed |
| MVS 전체 | 42f195b / make validate | **종료 2 / HOLD**; Ruff·mypy 통과, pytest 1,868 passed·19 failed·1 warning; 뒤 웹 단계 미도달 |
| 실패 항목 재검사 | 42f195b / 기존 실패 19건만 실행 | 종료 1; 자료 복원 후 2 passed·17 failed. 전체 suite 재실행 결과와 합산하지 않음 |
| 기준 커밋 반례 | 깨끗한 3ced81c 작업 트리 / 남은 17건 | 종료 1; 같은 17건 모두 실패 |
| E1 | frozen 설정·결과 보존; 구현 해시 연결 진단 | **현재 근거 재검증 필요**; 별도 9020ea4 HOLD 이력도 해당 커밋의 기록으로 유지 |
| 실물·제조 승인 | 실행하지 않음 | not_tested / false; 하중·토크 null |

전체 실패의 원인은 두 갈래였다. 2건은 ignored 시험 자료인 data/e1-v2-development/candidate-a.json이 없어서 실패했다. frozen 선택 기록에 내장된 A 자료를 압축·원문 해시와 크기로 확인한 뒤 동일 바이트로 복원했으며, E1 결과를 재계산하거나 선택 기록을 수정하지 않았다. 해당 2건은 재검사에서 통과했다.

남은 17건은 candidate selection implementation projection changed로 실패했다. 별도의 깨끗한 3ced81c 작업 트리에서도 같은 17건을 재현했다. frozen 기록은 기준 커밋부터 e1/metrics.py의 이전 해시를 담고 있었다. 여기에 이번 연동은 E1이 고정한 공유 파일 evidence.py, registry.py, schema_validation.py의 해시를 추가로 바꿨다. 따라서 이를 전부 무관한 기존 실패로 취급하지 않는다. 기본 CAD 연동 경로의 통과와 E1 감사 근거의 유효성은 별도로 판정한다. [해시별 진단](../../output/freecad-mvs-qa-case/validation/e1-implementation-projection.json), [최종 HOLD 근거](../../output/freecad-mvs-qa-case/validation/mvs-validation-hold.json).

새 E1 감사와 버전이 구분된 근거 검증 없이는 전체 PASS나 병합을 추천하지 않는다. frozen 기록의 해시를 현재 값으로 덮어쓰거나 검증을 우회하지 않았다. 이번 포트폴리오의 완료는 실패 원인과 범위까지 재현해 기록했다는 뜻이며, 저장소 전체의 합격이나 제조 승인이 아니다.

G4 R1 왕복 ZIP SHA-256은 6c0a1975fd7ce17183009fdd094151b5a2f9c0b9cde77d7a4ace8cdf379b4c56이다. 과거 v0.1.0 묶음과 v1 schema를 보존하고 CAD용 v1.1 reader를 추가했다. MVS case 안의 평가 요약은 case_reproducibility_only이며 미확정 성능 수치는 null이다. 위 별도 정답이 있는 고정 평가의 수치와 혼동하지 않는다.

## 재현과 인계

1. FreeCAD와 MVS의 위 커밋, [투영 계약](../architecture/freecad-mvs-qa-integration-contract.md), 증거 묶음의 source selection을 확인한다.
2. 묶음 안에서 python3 verify-package.py로 파일 해시·ZIP CRC·멤버 해시·빈 결과 서식을 확인한다. MVS의 기존 verify_bundle은 스키마와 CAD 분석 재생까지 검증한다.
3. 아래 명령은 MVS 작업 트리에서 실행한다. 기존 출력 폴더는 거부하므로 새 이름을 사용한다. 기준 export와 선택 digest는 검증된 원본 사본을 사용한다.

~~~sh
uv run python scripts/run_coolgear_integration.py \
  --protocol configs/integration/coolgear-r1-v1.json \
  --reference-export ../freecad-automation/output/mvs-reference/coolgear-r1 \
  --r2-export ../freecad-automation/output/mvs-reference/coolgear-r2-demo \
  --r2-selection ../freecad-automation/tmp/codex/freecad-mvs-baseline/r2-selected-source.json \
  --out-dir output/coolgear-integration/run-002
~~~

실제 producer 재생성은 [기록된 명령](../../output/freecad-mvs-qa-case/commands/index.json)으로 별도 출력 경로에서 수행한다. 새 실행 시각과 manifest 바이트가 달라질 수 있으므로 기존 선택값이나 고정 v1 프로토콜 해시를 바꾸지 않는다. 새 근거를 검토하고 새 프로토콜 버전을 만든다.

codex/freecad-mvs-qa-integration 두 작업 브랜치를 사용한다. 원래 작업 트리·dirty 후보 선택·기존 CAD/ZIP을 보존한다. 작은 커밋과 일반 push까지 수행하며 merge, 클라우드 배포, 공급자 발송, 실물 시험, 사람 승인은 수행하지 않는다. 문서·코드·fixture만 Git에 포함하고 생성 CAD/이미지/DB/로그/원시 대화는 포함하지 않는다.
