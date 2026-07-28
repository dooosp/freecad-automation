# 6분 시연 대본 — 한국어

- 대상: 기술 면접관과 비개발자 혼합 청중
- 시연 목표: 가치, 구조, 신뢰 실패, 표준 gap을 한 흐름에서 설명
- Human UAT / Human bilingual review: `NOT_RUN` / `NOT_RUN`

## 00:00–00:40 — 문제와 범위

**화면:** Review의 실행 전 카드.

“이 프로젝트의 출발점은 이미 구현된 CLI 데이터 생성기였습니다. 문제는
기능보다 전달 방식이었습니다. 여러 JSON 파일만으로는 설계 특징, 로봇 동작,
품질 요구사항이 왜 연결되는지 채용 담당자와 비개발자가 빠르게 이해하기
어렵습니다. 그래서 새 데이터 계약을 늘리지 않고 기존 생성기를 안전한 Studio
시연으로 연결했습니다.”

“여기서 다루는 것은 실제 공장 데이터가 아니라 저장소가 소유한 합성 힌지
블록 검사 시나리오입니다. 물리 검사, 로봇 운전, CV, 생산 승인을 시연한다고
말하지 않습니다.”

## 00:40–01:25 — 실행 전 신뢰 경계

**화면:** 입력, 효과, 예상 파일 설명.

“브라우저가 보낼 수 있는 성공 입력은 프로필 ID 하나입니다. 사용자는 로컬
경로, config, robot config, inline task JSON, output 경로, 리비전이나 해시를
넣을 수 없습니다. 서버가 권위 설정, Revision A 검토 팩, 검사 계획, 6축 로봇
설정, curated task plan 다섯 입력을 선택하고 각 파일의 경로·크기·SHA-256을
확인합니다.”

“로컬·오프라인 작업이며 FreeCAD 런타임, 로봇 하드웨어, 외부/유료 API를
호출하지 않습니다. 모든 쓰기는 서버가 만든 작업 artifact 디렉터리 안에
한정됩니다.”

## 01:25–02:05 — tracked job과 여덟 파일

**조작:** `데이터셋 생성`을 누르고 진행 상태에서 완료 상태로 이동한다.

“Studio는 생성 규칙을 복제하지 않습니다. 닫힌 요청이 Local API의 tracked
job이 되고, executor가 기존 `manufacturing-action-dataset` 서비스를 호출합니다.
성공하면 action dictionary, episode annotation, validation report, dataset
manifest, JSON/Markdown handoff, artifact/output manifest까지 정확히 여덟 파일이
원자적으로 게시됩니다. Result files도 기존 등록 artifact 경로만 사용합니다.”

## 02:05–03:05 — 열 개 동작과 연결

**화면:** 전체 timeline을 훑고 1번, 6번, 9번을 차례로 선택한다.

“동작은 접근, 파지, fixture 운반, 정렬, 안착, 좌우 힌지 핀 검사, 힌지 이어
검사, 장착 홀 검사, 해제/후퇴의 고정된 열 단계입니다.”

“1번은 작업 시작 전제와 접근 의미를, 6번은 `hinge_pin_left`와 품질 특성,
로봇 관절·probe 연결을, 9번은 장착 홀 feature와 검사 요구를 보여 줍니다.
각 동작에는 한국어/영어 지시, actor/tool, target part, 실제 ID, precondition,
postcondition, `curated_task_plan` origin과 사람 검토 필요 상태가 있습니다.
따라서 label 목록이 아니라 설계–로봇–품질 사이의 추적 가능한 의미 계층입니다.”

## 03:05–03:45 — 품질 요약과 handoff

**화면:** Quality summary와 Handoff.

“품질 요약은 동작/segment 수, 고유 primitive, 알 수 없는 feature·joint·quality
참조, 언어 coverage, 중복 ID, 전이 위반, timeline overlap, 계보와 경계를
검사합니다. 녹색 상태 하나보다 어떤 검사를 했는지가 중요합니다.”

“Handoff는 Design의 package/part/revision/feature, Manufacturing의 동작·로봇·도구,
Quality의 특성과 검사 계획, Trust의 입력 해시와 남은 hold를 분리합니다.
이 분리는 실제 조직의 승인을 대신하지 않지만 서로 다른 역할이 같은 근거를
읽게 하는 협업 설계입니다.”

## 03:45–04:35 — LeRobot v3 gap

**화면:** LeRobot panel.

“공식 LeRobot v0.6.0의 commit
`30da8e687a6dfc617fcd94afc367ac7071c376ce`에 고정해 비교했습니다. 현재 있는
것은 episode identity, task instruction, action semantics, joint reference,
segment timing, source lineage입니다.”

“하지만 frame-level Parquet, dataset/episode/frame index와 timestamp, 양의 FPS,
feature/counter metadata, `tasks.parquet`, episode metadata, 통계, 수치형
`observation.state`와 `action`, writer finalization과 실제 loader 검증이 없습니다.
그래서 `NOT_EXPORTABLE_YET`, compatible false, training-ready false입니다.
이미지/MP4가 없는 것은 이 검사 데모의 vision modality gap이며 모든 v3 데이터셋의
보편 필수라고 단정하지 않습니다.”

## 04:35–05:25 — Revision mismatch 실패

**조작:** mismatch checkbox를 켠다. 실행 전 무엇이 달라질지 질문한 뒤 생성한다.

“이 옵션도 자유로운 리비전 입력이 아니라 저장소가 소유한 하나의 bounded
fixture입니다. 권위 설정은 Revision A인데 검토 팩이 B이면 기존 계보 검사가
충돌을 발견합니다.”

**화면:** BLOCKED, code, A/B, `0 / 8`, next action.

“프로필 경계는 이를 `REVISION_LINEAGE_IDENTITY_MISMATCH`로 표시하고 부분 성공
파일을 하나도 등록하지 않습니다. 수정 방향은 검사를 끄거나 B를 승인하는 것이
아니라 권위 있는 A에서 검토 artifact를 재생성하는 것입니다.”

## 05:25–06:00 — 검증 상태와 다음 단계

“자동 검증은 요청 거부, profile byte drift, 실제 executor 성공/실패, 정확한
파일 수와 안전한 미리보기, Studio locale·keyboard·responsive 계약을 다룹니다.
하지만 자동 검증과 P0 리허설은 사람 이해도 증거가 아닙니다.”

“현재 사람 한·영 의미 검토와 P1–P5 UAT는 `NOT_RUN`입니다. 후보 commit과 전체
content fingerprint를 고정한 뒤 P0, 의미 검토, 다섯 세션 순서로 진행합니다.
결과는 개인 식별 정보 없이 `4/5`, `32/40`, median 같은 count-only 집계로만
공개합니다. 이 정직한 경계까지가 이번 시연의 핵심입니다.”
