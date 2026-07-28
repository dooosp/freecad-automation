# 제조 로봇 Studio 데모 — 한국어 면접 질문

모든 답변은 현재 저장소 증거에 한정한다. 사람 UAT와 한·영 의미 검토는
`NOT_RUN`, LeRobot 호환과 학습 준비는 `false`다.

## 1. 이 프로젝트가 해결한 핵심 문제는 무엇인가요?

CLI가 여덟 파일을 올바르게 만드는 것과 비개발자가 그 의미를 이해하는 것은
다른 문제였습니다. 기존 생성·검증 계약은 그대로 두고 Review 화면에서 열 개
동작, CAD/로봇/품질 연결, 역할별 handoff와 신뢰 경계를 한 흐름으로 읽게
했습니다.

## 2. 왜 새로운 Studio 메뉴를 만들지 않았나요?

제조 데이터는 기존 CAD 검토 이후의 설명 단계이므로 Review 안에 두는 편이
사용자 mental model과 현재 route 계약을 보존합니다. 새 workspace는 탐색
복잡도와 회귀 범위를 키우지만 이 목표에 필요한 새로운 도메인 경계는 아닙니다.

## 3. 왜 사용자가 파일을 선택하게 하지 않았나요?

브라우저 파일 경로, 임의 리비전·해시·inline JSON은 시연 재현성과 보안을
깨뜨립니다. 서버 소유 profile이 다섯 승인 입력과 정확한 SHA-256을 고정하고,
요청은 profile과 bounded mismatch enum만 허용합니다.

## 4. UI에서 생성 로직을 다시 구현하지 않은 이유는 무엇인가요?

CLI와 Studio가 서로 다른 규칙으로 파일을 만들면 drift가 생깁니다. Studio는
tracked job을 제출하고 기존 서비스가 유일한 생성·검증 주체가 되게 했습니다.
UI는 상태와 의미를 설명할 뿐 canonical artifact를 계산하지 않습니다.

## 5. 정확히 여덟 파일이어야 하는 이유와 실패 전략은 무엇인가요?

여섯 도메인 파일과 두 manifest가 하나의 검토 단위입니다. 일부만 남으면
사용자가 완전한 결과로 오해할 수 있으므로 atomic publication을 유지합니다.
Revision mismatch 시 `0 / 8`이고 성공 artifact를 등록하지 않습니다.

## 6. `VALID SYNTHETIC DEMO`는 무엇을 의미하나요?

고정 합성 계약 안에서 스키마, 참조, 한·영 coverage, timeline, 계보, 경계
검사가 통과했다는 뜻입니다. 실제 로봇 실행, 센서 측정, 물리 검사, 공정 안전,
생산 준비 또는 출시 승인을 뜻하지 않습니다.

## 7. Revision mismatch 시 왜 자동으로 B에 맞추지 않나요?

권위 있는 설계가 A인데 검토 자료만 B라면 어느 쪽이 옳은지 시스템이 임의로
결정하면 안 됩니다. 충돌을 안정된 code와 expected/received identity로 보여
주고, A에서 검토 자료를 재생성하도록 안내해야 계보가 감사 가능합니다.

## 8. 현재 결과가 LeRobot Dataset v3가 아닌 가장 중요한 이유는 무엇인가요?

현재 결과는 고수준 의미 JSON입니다. v3 호환을 말하려면 frame-level Parquet,
indices/timestamps/FPS, metadata와 statistics, 수치형 state/action, writer
finalization과 실제 pinned loader 검증이 필요합니다. 이 항목들이 없으므로
compatible과 training-ready는 false입니다.

## 9. 카메라 MP4가 없어서 무조건 비호환인가요?

그렇게 일반화하지 않습니다. 영상은 이 검사 시나리오에 필요한 vision modality
gap이지만 모든 LeRobot v3 데이터셋의 보편 필수라고 볼 수 없습니다. 이 결과의
보편적 format blocker는 frame tables, index/time/FPS, metadata, statistics,
numeric state/action과 loader validation입니다.

## 10. 자동 테스트와 사람 UAT를 어떻게 구분했나요?

자동 테스트는 계약, 분모 계산기, 접근성/locale 구조와 실패 동작을 검증합니다.
사람이 설명을 이해했는지는 P1–P5만 측정합니다. synthetic fixture는 계산기
테스트에서만 명시 옵션으로 허용하고 결과를 `TEST_ONLY`, human UAT를
`NOT_RUN`으로 냅니다.

## 11. UAT에서 가장 중요한 기준은 무엇인가요?

단순 클릭 성공뿐 아니라 4/5가 action–CAD feature 연결, 합성/현장 경계,
LeRobot gap, mismatch 이유를 자기 말로 설명해야 합니다. next-action 예측은
고정 40문항에서 80% 이상, 완료 경로 median primary actions는 MR-UAT-01 통과를
전제로 4 이하, 중대한 한·영 의미 오류는 0이어야 합니다.

## 12. 개인정보와 결과 왜곡을 어떻게 막나요?

raw record는 저장소 밖 owner-only 디렉터리에 두고 이름·연락처·자유 메모를
schema 자체가 허용하지 않습니다. 공개 파일에는 participant row나 locale 매핑,
raw path 없이 count만 남깁니다. 누락 세션이나 놓친 prediction은 분모를 줄이지
않고 해당 attempt를 무효화해 같은 익명 label로 교체합니다.

## 13. 이 데모에서 가장 보여 주고 싶은 판단은 무엇인가요?

기능을 크게 보이게 하는 것보다 증거 경계를 유지하는 판단입니다. 기존 서비스를
재사용하고, 브라우저 입력을 닫고, 실패를 `0 / 8`로 만들고, 공식 표준과의 gap을
고정 source로 비교해 거짓 호환성 주장을 막았습니다.

## 14. 다음 구현 우선순위는 무엇인가요?

먼저 고정 candidate에서 P0와 사람 한·영 의미 검토, P1–P5 UAT를 실행하고 관찰
근거가 있는 최소 수정만 합니다. LeRobot adapter는 별도 목표로 두고 실제
sampled numeric data, metadata/writer, pinned loader 검증이 준비될 때 진행합니다.
