# 제조 로봇 데이터 Studio 데모

- 문서 상태: `PREPARED_FOR_P0`
- 승인 프로필: `hinge-block-synthetic-inspection-v1`
- 사람 UAT: `NOT_RUN`
- 사람 한·영 의미 검토: `NOT_RUN`
- LeRobot 호환: `FALSE`
- 학습 준비: `FALSE`

이 데모는 합성 힌지 블록의 설계 정보와 검사 계획을 사람이 검토할 수
있는 제조 로봇 동작 데이터로 연결하는 과정을 보여 준다. 사용자는 Review
화면에서 승인 프로필 하나를 실행하고, 열 개 동작이 CAD 특징·로봇 관절·품질
특성과 어떻게 연결되는지 확인한 뒤 Design / Manufacturing / Quality 인계
내용과 신뢰 경계를 읽을 수 있다.

성공 경로는 다음 여덟 파일을 하나의 작업 디렉터리에 전부 게시한다.

1. `manufacturing_action_dictionary.json`
2. `manufacturing_episode_annotation.json`
3. `manufacturing_data_validation_report.json`
4. `manufacturing_robotics_dataset_manifest.json`
5. `design_manufacturing_quality_handoff.json`
6. `design_manufacturing_quality_handoff.md`
7. `artifact-manifest.json`
8. `output-manifest.json`

선택형 Revision B 불일치 시연은 결과를 일부라도 게시하지 않는다. 승인된
Revision A와 받은 Revision B가 다름을 `REVISION_LINEAGE_IDENTITY_MISMATCH`로
표시하고 `0 / 8`에서 멈춘다. 다음 안전 조치는 권위 있는 Revision A 설정에서
검토 자료를 다시 생성하는 것이다.

## 90초 안에 이해할 핵심

- 입력은 저장소가 소유한 고정 합성 자료이며 사용자가 파일 경로나 해시를
  주입할 수 없다.
- 생성은 로컬·오프라인이며 FreeCAD, 로봇 하드웨어, 외부/유료 API를 호출하지
  않는다.
- 결과는 의미 중심 주석 계층이다. 실제 센서 측정, 물리 검사 증거, 컴퓨터
  비전 결과가 아니다.
- 현재 결과는 LeRobot Dataset v3가 아니며 내보내기나 모델 학습에 사용할 수
  있다고 주장하지 않는다.
- 사람 검토는 여전히 필요하다. P0 기술 리허설과 P1–P5 사람 UAT 결과는 아직
  이 문서 팩의 증거가 아니다.

## 문서 지도

| 읽을거리 | 답하는 질문 |
| --- | --- |
| [English overview](README.en.md) | 같은 설명의 영어판은 어디에 있는가? |
| [문제와 해결](problem-and-solution.md) | 비개발자에게 어떤 문제를 어떻게 설명하는가? |
| [아키텍처](architecture.md) | 브라우저 요청부터 여덟 파일까지 어떤 경계가 있는가? |
| [인재상 증거 매핑](kia-talent-evidence-map.md) | 이 개인 포트폴리오가 보여 주는 역량은 무엇인가? |
| [신뢰 경계](trust-boundaries.md) | 데모가 증명하는 것과 보류하는 것은 무엇인가? |
| [LeRobot v3 격차 분석](lerobot-v3-gap-analysis.md) | 왜 아직 LeRobot 호환·학습 준비 상태가 아닌가? |
| [90초 한국어 대본](demo-script-90sec.ko.md) / [영어 대본](demo-script-90sec.en.md) | 짧은 시연을 어떻게 진행하는가? |
| [6분 한국어 대본](demo-script-6min.ko.md) | 구조와 판단 근거까지 어떻게 설명하는가? |
| [한국어 면접 Q&A](interview-questions.ko.md) / [영어 면접 Q&A](interview-questions.en.md) | 과장 없이 기술 선택을 어떻게 답하는가? |
| [사람 UAT 세션 키트](human-uat-session-kit.md) | P0와 P1–P5를 어떻게 분리해 실행하는가? |
| [Round 1 빈 집계](human-uat-round-1-aggregate.md) | 공개 가능한 수치만 어디에 기록하는가? |
| [스크린샷 캡처 목록](screenshots/README.md) | 어떤 실제 화면 증거가 아직 필요한가? |

## 증거 경계

이 저장소에서 확인 가능한 것은 고정 입력, 결정적 열 개 동작, 스키마 검증,
계보 검사, 원자적 여덟 파일 게시, 그리고 의도된 Revision 불일치 차단이다.
실제 현장 데이터, CV 인식, 물리 검사, 공식 Kia 프로젝트, 공식 DELMIA 또는
3DEXPERIENCE 연동, 엔지니어링 승인, 제품 출시를 증명하지 않는다.
