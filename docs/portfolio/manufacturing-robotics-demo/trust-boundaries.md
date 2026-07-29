# Trust boundaries / 신뢰 경계

## 고정 선언

아래 값은 v1 산출물의 고정 경계다. UI 문구가 아니라 서비스 계약이며, 요청이
이를 바꿀 수 없다.

| 선언 | 값 |
| --- | --- |
| `synthetic_demo` | `true` |
| `real_shop_floor_data` | `false` |
| `automatic_video_segmentation` | `false` |
| `computer_vision_model_used` | `false` |
| `lerobot_compatible` | `false` |
| `training_ready` | `false` |
| `inspection_evidence` / `evidence_attached` | `false` / `false` |
| `readiness_regenerated` | `false` |
| `product_release` / `production_readiness` | `false` / `false` |
| `human_review_required` | `true` |

## 0-item inspection-plan control의 의미

프로필의 proof `inspection_plan.json`은 의도적인 **0-item control fixture**다.
기존 curated task plan에는 `inspection_plan_item_ids`가 없기 때문에 이 데모는
action-to-inspection-plan-item linkage를 발명하지 않는다. 동작의 근거 있는
quality characteristic IDs와 inspection snapshot의 Revision A identity/lineage는
보존되지만, 동작별 inspection-plan item 참조는 비어 있다.

이 fixture는 exact-byte와 lineage control을 제공할 뿐 실제 검사 실행, 측정값,
물리 inspection evidence 또는 품질 승인을 제공하지 않는다. 이에 따라
`inspection_evidence: false`와 `evidence_attached: false`는 그대로 유지된다.

## 신뢰하는 것

- 승인 프로필에 기록된 다섯 입력의 경로·크기·SHA-256 일치
- `hinge-block / hinge_block / Revision A`의 상호 일관된 계보
- 닫힌 JSON Schema와 결정적 참조/타임라인 검사
- 열 개 동작과 허용된 특징·품질 특성·관절·도구 ID의 연결
- 0-item inspection snapshot의 identity/lineage와 비어 있는
  `inspection_plan_item_ids`를 그대로 보존하는 동작
- 성공 시 여덟 파일의 원자적 게시와 등록
- Revision B 불일치가 성공으로 보이지 않고 `0 / 8`에서 멈추는 동작

## 신뢰하지 않거나 검증하지 않은 것

- 합성 주석을 실제 작업자·로봇·센서가 수행했다는 주장
- 로봇 모션 계획, 충돌 회피, 토크/속도/안전 한계 또는 실제 사이클 타임
- 측정기 교정, 검사 결과, 물리 증거, 공정 능력 또는 현장 승인
- 존재하지 않는 action-to-inspection-plan-item linkage
- CV 탐지, 영상 분할, 이미지 관측 또는 MP4 획득
- LeRobot Dataset v3 호환, Hub 게시, 로더 통과 또는 모델 학습 가능성
- 공식 Kia 업무, 공식 DELMIA/3DEXPERIENCE 연동, 채용 평가 또는 회사 승인
- 엔지니어링 승인, 생산 준비, 제품 출시

## 경계별 통제

| 경계 | 위협 | 통제 | 실패 결과 |
| --- | --- | --- | --- |
| Browser → API | 경로/해시/정책 주입 | 두 개 닫힌 enum과 unknown-field 거부 | 요청 거부 |
| API → profile | 승인되지 않은 fixture 선택 | 서버 소유 레지스트리 | 요청 거부 |
| Profile → filesystem | 파일 교체·바이트 변조 | 상대 경로, 크기, SHA-256 확인 | 생성 전 실패 |
| Inputs → service | 리비전/part/package 충돌 | proof lineage identity agreement | `REVISION_LINEAGE_IDENTITY_MISMATCH` |
| Service → output | 부분 게시, 작업 밖 쓰기 | 신뢰된 job root와 atomic publication | 성공 파일 `0 / 8` |
| Job → browser | 절대 경로/미등록 파일 노출 | 등록 artifact 링크와 안전 메타데이터 | 비공개 정보 숨김 |
| Demo → audience | 합성 결과의 과대 해석 | 항상 보이는 경계·gap·human-review 상태 | 호환/준비 주장 보류 |

## 상태 해석

`VALID SYNTHETIC DEMO`는 합성 계약 내부의 구조·계보·참조 검사가 통과했다는
뜻이다. “실제 공정에 유효”, “검사 통과”, “LeRobot 호환”, “학습 준비”,
“출시 승인”을 뜻하지 않는다.

`BLOCKED`는 의도된 Revision 불일치가 안전하게 차단됐다는 뜻이다. 실패를
수정하기 위해 받은 Revision B를 승인하거나 검사를 우회해서는 안 된다.
권위 있는 Revision A로 검토 자료를 재생성해야 한다.

사람 UAT와 한·영 의미 검토는 이 문서 작성 시점에 `NOT_RUN`이다. 자동 테스트,
synthetic fixture 또는 P0 리허설을 사람 수용성 증거로 바꾸어 표현하지 않는다.
