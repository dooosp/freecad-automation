# USB 허브 기준 장착판 R1

Coolgear CG-U3MINI4PH-G2의 공개 도면과 STEP을 기준으로 만든 검토용 장착판이다. 실제 사용자 허브의 모델과 받침면은 확인되지 않았다. 제조사 CAD, 생성된 도면, 소프트웨어 QA는 실물 장착·검사 증거가 아니다.

## 설계 입력

[재현 가능한 JSON](../configs/examples/usb_hub_reference_mount.json)을 사용한다.

| 항목 | 공칭값 | 근거 |
|---|---|---|
| 장착판 | 142×74×4 mm, 6061-T6 알루미늄 | 설계 선택 |
| 허브 구멍 배열 | 84×25.2 mm | 제조사 도면과 STEP 대조 |
| H1–H4 | Ø4.0, M3용, 관통 | 조립 위치 여유를 둔 설계값 |
| P1–P4 | Ø5.5, M5용, 관통 | 받침면 고정용 설계값 |
| 받침면 배열 | 118×50 mm | 설계 선택 |
| 조립 검토 스페이서 | 길이 10 mm | 설계 선택 |
| 조립 검토 받침판 | 두께 2 mm | 가정; 실제 책상의 모델이 아님 |

원점은 장착판 좌측 하단, X는 오른쪽, Y는 위쪽이다. 단위는 mm이다.

| 구멍 | X | Y | 지름 |
|---|---:|---:|---:|
| H1 | 29 | 24.4 | 4.0 |
| H2 | 29 | 49.6 | 4.0 |
| H3 | 113 | 24.4 | 4.0 |
| H4 | 113 | 49.6 | 4.0 |
| P1 | 12 | 12 | 5.5 |
| P2 | 12 | 62 | 5.5 |
| P3 | 130 | 12 | 5.5 |
| P4 | 130 | 62 | 5.5 |

허브는 M3×12와 평와셔/너트, 받침면은 M5×25와 평와셔/너트/스페이서의 공칭 외형으로 조립을 검토했다. 실제 체결재 강도 등급, 토크, 풀림 방지와 제조 공차는 확정하지 않았다. M3용 Ø4.0은 별도의 설계 선택이며 표준 중간 여유 구멍이라는 주장이 아니다.

## 자료와 재현성

- [제품 페이지](https://www.coolgear.com/product/4-port-usb-3-2-gen-2-mini-powered-hub-w-esd-surge-protection-power-adapter)
- [제조사 도면](https://www.coolgear.com/wp-content/uploads/CG-U3MINI4PH-G2_Drawing_JWV1-1.pdf): 84×25.2 배열, 전체 폭 96, 깊이 46.65, 높이 29.2, 일반 공차 ±0.15.
- [제조사 STEP ZIP](https://www.coolgear.com/wp-content/uploads/CG-U3MINI4PH-G2-Assembly.step-1.zip): 로컬 FreeCAD에서 51개 솔리드의 유효성을 확인했다. 플랜지 두께 약 1, 접시형 구멍 최소/상부 지름 약 3.2/5.2는 CAD 측정값이다.
- [6061 제조사 자료](https://online.kaiseraluminum.com/depot/PublicProductInformation/Document/1015/Kaiser_Aluminum_6061_Sheet_Coil_and_Plate.pdf): 재료 후보의 참고 자료이며 실물 재료 성적서가 아니다.

2026-09-15에 확보한 파일의 SHA-256:

| 파일 | SHA-256 |
|---|---|
| 도면 PDF | `7bcc654c9cdda3db6ae81e0874265e52e87853a05af332f97253aeac41cec44e` |
| STEP ZIP | `020c48ce5421b5f9d3bc63c27703e9f00685241c060a3fa24ab21d5bad3063b3` |
| 압축 해제한 STEP | `4f53636fabfede54fd1a6b4cdad4c663b8681367638af345b986ac97ddb0b9ca` |

STEP 외함 깊이는 46.66으로 도면과 0.01 차이가 있다. 커넥터 등을 포함한 전체 STEP 깊이는 약 47.013이다. 제조사 좌표에서 장착판 좌표로의 변환은 `(X,Y,Z)=(x+71,36.4-z,y+4)`이다.

## 소프트웨어 수정

기존 분류기는 구멍 6개 이상을 `bushing_plate`로 분류하고 실제 치수 연결은 `plate`만 허용했다. 지름 연결 역시 전체 구멍이 한 지름일 때만 가능했다. 이 입력에서는 기존 엄격 QA가 91점, 추적률 0%로 실패했다.

분류 결과와 QA 기준은 유지한다. 실제 측정값 연결은 동일한 수평 박스/원통 절삭 규칙을 만족하는 다공 판에도 적용하고, 지름별로 명시한 `member_feature_ids`만 증거에 포함한다. 각 그룹의 모든 구멍, 실제 표시된 지시선 중심과 지름이 일치해야 연결된다.

예제는 `plate` 템플릿을 명시적으로 선택한다. `HOLE_DIA`는 H1–H4, `PANEL_HOLE_DIA`는 P1–P4를 요구한다. [그룹 지시선 구현 계획](exec-plans/usb-hub-reference-next.md)에 따라, 같은 지름의 별도 하위 그룹에도 해당 그룹 안의 실제 구멍으로 지시선을 연결한다. 측정된 중심을 렌더링과 추적에 함께 사용하고, 다른 그룹의 같은 숫자나 다른 종류의 치수로 지시선을 생략하지 않는다.

## 실행과 결과

`mounting_reference`는 제조사 기준 H1–H4의 좌표를 같은 실행에서 측정한 CAD 구멍 중심과 자동 비교한다. 기준 배열 84×25.2 mm를 장착판 중심 `[71,37]`에 놓은 좌표를 입력에 별도로 기록한다. 0.10 mm는 XY 거리의 소프트웨어 비교 허용값이며 가공 능력이나 실물 공차 검증값이 아니다. P1–P4는 별도 설계값이므로 제조사 기준 비교에 포함하지 않는다.

`*_mounting_comparison.json`에는 각 구멍의 기준·측정 좌표, 편차, 거리와 실제 면 참조를 기록하고, `*_mounting_comparison.html`에서 한국어 표로 확인한다. 단위·좌표계·출처·완전한 측정 근거가 없으면 `unknown`, 지정 구멍 누락이나 허용값 초과는 `fail`이다. 이 비교 결과는 도면 QA와 별도로 읽어야 하며 `--strict-quality`의 종료 조건을 바꾸지 않는다. [구현 및 검증 계획](exec-plans/mounting-center-comparison.md).

저장소 루트, Node.js 의존성 설치 및 FreeCAD 런타임이 있는 환경에서 실행한다.

```sh
node bin/fcad.js create configs/examples/usb_hub_reference_mount.json --strict-quality
node bin/fcad.js draw configs/examples/usb_hub_reference_mount.json --strict-quality
node tests/config-schema-cli.test.js
node tests/mounting-comparison.test.js
node scripts/run-pytest.js -q tests/test_mounting_comparison_runtime.py
node scripts/run-pytest.js -q tests/test_intent_compiler.py tests/test_plate_dimension_consistency.py tests/test_plate_runtime_traceability.py tests/test_diameter_group_anchors.py
npm test
```

FreeCAD 1.1.3에서 기준 입력의 create quality는 `pass`, drawing quality는 `pass`/91점, 필수 치수 추적률은 100%를 확인했다. 지름 그룹별로 4개의 서로 다른 면 참조와 올바른 중심 좌표가 연결된다. 다른 지름을 섞은 그룹, 없는 구멍 ID, 잘못된 공칭값, 사라진 구멍과 가장자리 노치는 실패 상태를 유지한다.

다음 두 경우도 실제 FreeCAD 엄격 도면 검사로 검증한다. P4만 선택하면 지시선 중심은 `[130,62]`이고 P4의 면 하나만 참조한다. Ø5.5를 P1/P2와 P3/P4로 나누면 각 그룹 안의 서로 다른 지시선과 겹치지 않는 면 참조가 생성된다. 원본 JSON의 `PANEL_HOLE_DIA.member_feature_ids`를 바꾸거나 같은 지름의 필수 intent를 추가하여 재현할 수 있다. 구멍의 위치나 모델 형상을 바꾸는 기능은 아니다.

생성 결과는 `output/usb-hub-reference-mount/cad/`에 기록된다. 기존 create/draw manifest와 품질 JSON 계약을 사용하며 생성 CAD와 다운로드 자료는 Git에 포함하지 않는다.

## 판정 경계

위 통과는 구성한 도면의 소프트웨어 QA 결과다. 실제 사용자 제품 적합성, 나사산/좌면 공차, 케이블 여유, 발열, 실제 받침면, 하중·충격·피로·풀림 및 제조 승인은 미검증이다. 업체 연락·발주·실물 시험은 수행하지 않았다.
