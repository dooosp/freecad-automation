# Architecture / 아키텍처

## 한눈에 보기

```text
Review workspace
  -> closed request: profile + optional revision mismatch only
  -> Studio bridge injects proof-lineage policy
  -> Local API creates tracked job
  -> job executor resolves server-owned, hash-pinned inputs
  -> existing manufacturing-action dataset service
  -> job-owned artifact directory
  -> exactly 8 registered artifacts or 0 on failure
  -> existing safe artifact preview + Review explanation panels
```

브라우저는 생성 규칙을 구현하지 않는다. 기존 서비스가 유일한 생성·검증
주체이고, Studio는 승인된 선택을 작업 요청으로 번역하고 결과를 설명한다.

## 요청 계약

성공 요청은 의미상 다음 두 필드뿐이다.

```json
{
  "type": "manufacturing-action-dataset",
  "demo_profile": "hinge-block-synthetic-inspection-v1"
}
```

선택형 실패 시연은 `"trust_demo": "revision-mismatch"`만 추가한다. 서버는
임의 경로, 출력 경로, 업로드, 설정/로봇/작업 계획 본문, 리비전, 해시,
알 수 없는 옵션을 거부한다. 내부 `proof_lineage: true`는 브리지에서 고정하며
브라우저가 끌 수 없다.

## 서버 소유 프로필

| 역할 | 고정 입력 |
| --- | --- |
| 권위 설정 | `configs/examples/hinge_block.toml` |
| Revision A 검토 팩 | `configs/examples/manufacturing/hinge_block_synthetic_inspection_v1/review_pack.json` |
| 검사 계획 control fixture | `configs/examples/manufacturing/hinge_block_synthetic_inspection_v1/inspection_plan.json` (`0` items) |
| 로봇 설정 | `configs/examples/robot_arm_6axis.toml` |
| 제조 작업 계획 | `configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json` |

프로필 레지스트리는 서비스 호출 전에 각 파일의 저장소 상대 경로, 크기,
SHA-256을 확인한다. 불일치 시 생성 단계로 넘어가지 않는다. Revision B 검토
팩은 허용된 부정 시연에만 선택된다.

proof `inspection_plan.json`은 의도적인 **0-item control fixture**다. 기존 curated
task plan이 `inspection_plan_item_ids`를 제공하지 않으므로, 품질 특성 ID와
inspection snapshot의 Revision A 계보만 보존하고 없는 action-to-inspection-plan-item
연결을 발명하지 않는다. 따라서 이 입력은 검사 계획 snapshot의 identity/lineage
control이지 실제 검사 실행이나 inspection evidence가 아니다.

## 데이터 흐름과 책임

| 계층 | 책임 | 하지 않는 일 |
| --- | --- | --- |
| Review UI | 시작, 상태, 열 개 동작, 품질/인계/신뢰 설명 | 파일 읽기, 경로 선택, 생성 규칙 복제 |
| Studio bridge / Local API | 닫힌 요청 검증과 추적 작업 생성 | 사용자 입력으로 정책 확장 |
| 작업 실행기 | 서버 소유 프로필 해석, 작업 디렉터리 설정, 기존 서비스 호출 | 전역 출력이나 부분 산출물 승인 |
| 생성 서비스 | 입력 검증, 계보, 의미 연결, 원자 게시 | FreeCAD/로봇/네트워크 호출 |
| 작업 저장소 / artifact route | 안전한 결과 메타데이터와 등록 파일 제공 | 절대 경로 또는 미등록 파일 공개 |

## 성공 계약

서비스는 여섯 도메인 파일과 두 manifest, 총 여덟 파일을 작업 전용
`artifacts` 디렉터리에 게시한다. UI의 Result files는 등록된 파일 링크만
사용한다. 주요 도메인 내용은 다음과 같다.

1. `manufacturing_action_dictionary.json`
2. `manufacturing_episode_annotation.json`
3. `manufacturing_data_validation_report.json`
4. `manufacturing_robotics_dataset_manifest.json`
5. `design_manufacturing_quality_handoff.json`
6. `design_manufacturing_quality_handoff.md`
7. `artifact-manifest.json`
8. `output-manifest.json`

- action dictionary: 열 개 동작의 의미, 한·영 지시, 특징/관절/품질 참조
- episode annotation: 연속된 열 개 타임라인 구간과 계보
- validation report: 스키마·참조·언어·전이·타임라인·경계 검사
- dataset manifest: 입력과 도메인 멤버의 해시/역할
- JSON/Markdown handoff: Design, Manufacturing, Quality, Trust 책임
- artifact/output manifests: 게시 및 실행 수준 추적

동작에는 근거가 있는 quality characteristic IDs가 남지만
`inspection_plan_item_ids`는 비어 있다. 화면이나 산출물은 이 부재를 임의
inspection-plan item 연결로 채우지 않는다.

## 실패 계약

Revision A/B가 충돌하면 기존 계보 검사가 먼저 실패한다. 프로필 경계에서만
이를 `REVISION_LINEAGE_IDENTITY_MISMATCH`로 안전하게 매핑한다. 응답에는
기대/수신 ID, `0 / 8`, Revision A에서 검토 자료를 다시 만들라는 다음 조치만
포함한다. 부분 결과는 성공 파일로 등록하지 않는다.

## 실행 효과

- 네트워크: 없음
- FreeCAD 런타임: 호출하지 않음
- 로봇 하드웨어: 호출하지 않음
- 외부 또는 유료 API: 호출하지 않음
- 파일 쓰기: 해당 작업의 서버 소유 artifact 디렉터리 내부만
- 결정성: 같은 고정 입력과 생성 시각에서 같은 도메인 내용을 목표로 함

이 구조는 합성 데모의 추적 가능성을 설명하지만 실제 제어 시스템, 공식
DELMIA/3DEXPERIENCE 연결, 물리 검사 또는 제품 출시 아키텍처를 뜻하지 않는다.
