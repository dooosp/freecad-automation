# 기아 지원 관점의 역량 증거 매핑

> 이 문서는 개인 포트폴리오의 설명 구조다. 기아의 공식 프로젝트, 공식
> 인재상 정의, 채용 평가, 회사의 승인 또는 보증이 아니다. 아래 연결은 지원자가
> 저장소 증거를 바탕으로 한 자기 해석이며, 실제 공고의 표현과 면접 맥락에 맞춰
> 사람이 다시 검토해야 한다.

## 증거를 말하는 원칙

“역량이 있다”는 추상적 주장보다 **결정 → 구현 → 검증 → 남은 한계** 순서로
설명한다. 자동 테스트 통과를 사용자 검증으로, 합성 데이터를 현장 데이터로,
의미 주석을 로봇 제어 또는 학습 데이터로 확대하지 않는다.

| 역량 관점 | 이 데모에서 내린 결정 | 저장소에서 확인할 수 있는 증거 | 말하지 않는 것 |
| --- | --- | --- | --- |
| 전문성 | CAD 특징·로봇 관절·품질 특성을 열 개 동작에 명시적으로 연결 | action dictionary, episode annotation, validation report, schema/contract tests | 실제 궤적 안전성 또는 물리 검사 성능 |
| 성장 | CLI 전용 결과를 비개발자도 읽는 Studio 흐름과 사람 UAT 준비물로 확장 | 기존 서비스 재사용 구조, 한·영 문서/화면, P1–P5 프로토콜 | UAT가 이미 통과했다는 주장 (`NOT_RUN`) |
| 신뢰 | 해시·Revision 계보·원자 게시와 거짓 호환성 차단을 먼저 설계 | 서버 소유 profile, exact-byte 검증, `0 / 8` mismatch, 고정 false 경계 | LeRobot 호환·학습 준비·생산 준비 |
| 문제 해결 | Revision A/B 충돌을 재현 가능한 실패 시연으로 바꿈 | `REVISION_LINEAGE_IDENTITY_MISMATCH`, expected/received, 안전한 next action | 검사를 우회하거나 B를 자동 승인했다는 주장 |
| 변화 적응 | 기존 CAD/검사 계약을 깨지 않고 제조 로봇 의미 계층을 덧붙임 | browser → tracked job → 기존 service, 기존 route/artifact preview 재사용 | 공식 DELMIA/3DEXPERIENCE 연동 |
| 협업 | 역할별로 필요한 정보를 다른 언어로 분리해 전달 | Design / Manufacturing / Quality / Trust handoff, 한·영 지시문 | 실제 조직 간 승인이나 현장 인수인계 완료 |

## 면접에서 사용할 수 있는 STAR 구조

### 상황

제조 로봇 데이터 생성 기능은 결정적이고 검증 가능했지만 CLI와 JSON 중심이라
채용 담당자나 비개발자가 가치와 한계를 짧게 파악하기 어려웠다.

### 과제

기존 데이터 계약을 늘리거나 안전 경계를 약화하지 않고, 설계–제조–품질의
연결과 실패 시 신뢰 동작을 화면에서 설명해야 했다.

### 행동

- 브라우저 입력을 승인 프로필과 하나의 bounded mismatch enum으로 닫았다.
- 생성 로직을 복사하지 않고 기존 서비스를 tracked job으로 연결했다.
- 열 개 동작의 특징/관절/품질 참조와 역할별 handoff를 시각화했다.
- LeRobot v0.6.0 소스를 고정해 실제 포맷 gap을 문서화했다.
- 사람 UAT를 자동 테스트와 분리하고 고정 분모의 P1–P5 프로토콜을 준비했다.

### 결과

검증 가능한 결과는 성공 시 여덟 파일, Revision 불일치 시 `0 / 8`, 고정된
합성/비호환/사람검토 경계다. 사람 이해도 결과는 아직 `NOT_RUN`이므로 숫자를
제시하지 않는다. 실제 결과가 생기면 [Round 1 집계](human-uat-round-1-aggregate.md)의
count-only 기준으로만 갱신한다.

## 증거 링크

- [문제와 해결](problem-and-solution.md)
- [아키텍처](architecture.md)
- [신뢰 경계](trust-boundaries.md)
- [LeRobot v3 격차](lerobot-v3-gap-analysis.md)
- [6분 시연 대본](demo-script-6min.ko.md)
- [사람 UAT 프로토콜](human-uat-session-kit.md)
