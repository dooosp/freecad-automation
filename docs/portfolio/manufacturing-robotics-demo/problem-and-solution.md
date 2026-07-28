# Problem and solution / 문제와 해결

## 문제

제조 자동화 결과가 JSON 파일 여러 개로만 보이면 채용 담당자나 비개발자는
세 가지를 빠르게 판단하기 어렵다.

1. 설계 정보가 로봇 동작과 품질 확인으로 어떻게 이어지는가?
2. 결과가 어디에서 왔고, 어떤 변경을 신뢰할 수 있는가?
3. 데모용 합성 데이터와 실제 현장·학습 데이터의 경계는 어디인가?

기존 생성 서비스에는 계보, 검증, 여덟 파일 원자 게시가 이미 있었지만,
CLI 지식이 없는 관찰자에게는 그 의미가 잘 보이지 않았다.

## 해결

기존 Review 화면에 승인 프로필 하나만 노출한다. 실행 후에는 열 개 동작을
순서대로 보여 주고, 선택한 동작의 CAD 특징 ID, 로봇 관절 ID, 품질 특성,
한·영 지시문, 전제·사후 조건을 한곳에서 설명한다. 품질 요약과 네 역할의
인계(Design, Manufacturing, Quality, Trust)는 “파일이 생겼다”를 넘어
“무엇을 확인했고 무엇을 확인하지 못했는가”를 보여 준다.

```text
고정 합성 프로필
  -> 정확한 바이트/해시로 입력 확인
  -> 기존 생성·검증 서비스 재사용
  -> 열 개 의미 동작과 설계/로봇/품질 연결
  -> 여덟 결과 파일을 전부 게시하거나 전부 게시하지 않음
  -> 사람이 읽는 품질·인계·신뢰 설명
```

Revision B 불일치 옵션은 신뢰 실패를 숨기지 않는 짧은 반례다. 시스템은
Revision A를 기대했는데 B를 받으면 `0 / 8`에서 차단하고 안전한 복구 방향만
제시한다.

## 왜 이 설계인가

| 선택 | 이유 | 보존되는 경계 |
| --- | --- | --- |
| 서버 소유 프로필 | 초보자에게 한 개의 명확한 시작점 제공 | 임의 경로·해시·리비전 주입 금지 |
| 기존 서비스 재사용 | 브라우저가 규칙을 복제하지 않음 | CLI와 Studio의 생성 계약 일치 |
| 작업 추적과 등록된 파일 링크 | 진행/실패/결과를 기존 방식으로 표시 | 작업 디렉터리 밖 쓰기 금지 |
| 여덟 파일 원자 게시 | 부분 성공을 완전한 결과처럼 보이지 않음 | 실패 시 성공 산출물 `0 / 8` |
| 명시적 신뢰·LeRobot 패널 | 데모와 운영/학습 주장을 분리 | 호환·학습·현장 증거 주장 보류 |

## 확인 가능한 결과

- 정확히 열 개의 고정 순서 동작과 ID
- 설계 특징, 로봇 관절, 품질 특성으로 이어지는 명시적 참조
- 한·영 지시문과 `human_review_required: true`
- 스키마·참조·타임라인·계보·경계 검사 결과
- 성공 시 정확히 여덟 파일, 리비전 불일치 시 성공 파일 0개

## 확인할 수 없는 결과

이 데모는 실제 로봇 궤적 안전성, 현장 사이클 타임, 센서 정확도, 물리 검사
통과, CV 성능, LeRobot 로더 호환, 학습 성능 또는 제품 출시 승인을 검증하지
않는다. 사람 UAT와 한·영 의미 검토도 현재 `NOT_RUN`이다.

### English summary

The solution makes an existing deterministic, lineage-checked generator
understandable through one bounded Studio journey. It visualizes the ten-action
semantic layer and its evidence limits; it does not convert synthetic metadata
into real robotics, inspection, LeRobot, training, or release evidence.
