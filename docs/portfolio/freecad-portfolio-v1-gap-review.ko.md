# FreeCAD Automation 포트폴리오 v1 부족함 점검

점검일: 2026-09-24. 제품 코드 수정 없이 수행한 진단이다. 아래의 PASS는 명시한 조건에 한정한다. 전수 결함 발견, 제조 승인, 실물 검사 완료를 뜻하지 않는다.

본문의 “현재”와 실행 결과는 위 점검일의 고정 SHA에 대한 기록이다. 로컬 증거 ID는 문서 끝의 보존 경로 목록을 가리킨다. 해당 증거는 ignored `tmp/codex/` 아래의 로컬 점검 자료이며 저장소에 포함되지 않아, 새 체크아웃에서 열 수 있는 공개 증거 링크로 제공하지 않는다.

## 1. 현재 판단

**핵심 CAD 자동화는 포트폴리오로 정리할 근거가 충분하다. 기능을 더 크게 확장할 단계는 아니다.** 이번에 가정 기반 USB 허브 플레이트의 A→B 설계 변경, 실제 STEP 재읽기, 도면 좌표 검증, 주석 불일치의 엄격한 거절, 브라우저와 PDF 생성을 확인했다.

다만 **Studio 중심의 완성된 시연**으로 내세우려면, 실제 도면 품질 실패를 결과 요약에 연결하는 작은 수정이 우선이다. **변경 영향·재검사 계획까지 자동으로 연결된 USB 허브 사례**라는 주장은 아직 성립하지 않는다. 기존 A/B 입력의 부품 ID와 review revision이 그 흐름의 계약에 맞지 않았다. 이 두 문제를 전체 시스템의 기능 부재로 확대 해석하지 않는다.

추가 개발 없이도 **TOML → CAD/STEP → SVG → 별도 재측정 → strict 품질 거절**에 범위를 한정하고, 아래 한계를 공개하는 소프트웨어 사례로 정리할 수 있다. JSON 입력, 가져온 STEP의 특징 분류, 자동 재검사 계획이 모두 완성됐다고 시연하면 안 된다.

| 최종 질문 | 답 |
| --- | --- |
| 소프트웨어 포트폴리오로 공개할 근거가 충분한가? | **범위를 한정하면 충분하다.** 이번에 확인한 형상 자동화·검증 사례는 설명 가능하다. Studio 결과 표시와 자동 변경 영향 연결을 완성된 기능으로 주장하려면 F01·F02를 먼저 해결해야 한다. |
| 실물 제작·장착·사용까지 검증됐다고 말할 수 있는가? | **아니다.** 허브 실측, 재료, 체결, 케이블 접근성, 하중, 제작·장착·사용 기록이 없다. canonical 제조 준비도 HOLD와 소프트웨어 사례 공개는 별개의 판단이다. |
| AI 활용과 기계공학적 판단에서 어떤 기여가 확인되는가? | AI가 작성·보조한 시험 문서와 자동화 구조, 이번 AI 보조 진단·검사 작성은 확인된다. 실행 중 외부 AI의 설계 성공은 이번에 검증하지 않았다. 좌표·변경 관계·검증 경계는 설명할 수 있지만, 사용자가 직접 내린 설계 결정과 이해도는 별도 확인이 필요하다. |

## 2. 기준 상태와 점검 범위

### 저장소와 환경

- 사용자 작업 폴더: `freecad-automation` 저장소 루트(`.`).
- 시작 브랜치: `codex/mega-studio-api-contract-fuzz-audit`.
- 시작 HEAD: `25fc0562fb67374ee5d2c4a1a932a4d8cd66bd40`.
- 시작 변경: 추적 파일 diff 없음, 미추적 `docs/superpowers/` 존재. 해당 작업에는 쓰지 않았다.
- `git ls-remote`로 확인한 원격 기본 브랜치: `master`, SHA `4dba0d32fe1b10f2266f27501165e56df9f943af`. 확인 시각은 remote-tip.json(로컬 증거 `remote`)에 있다. 이후 원격 상태까지 보장하지 않는다.
- 두 브랜치의 이력이 달랐고, 요청된 최신 문서와 기능은 master에 있었다. 원래 체크아웃을 변경하지 않고 **고정 SHA의 새 detached worktree**에서 제품 실행을 수행했다.
- 실행 체크아웃: 별도로 만든 `portfolio-gap-review` worktree의 `freecad-automation` 저장소 루트.
- Node `v25.8.0`은 원래 작업 폴더와 검사 worktree 양쪽에서 확인했다. FreeCAD `1.1.3`, 번들 Python `3.11.14`, macOS runtime 준비 상태 및 실제 명령 실행을 확인했다.
- 새 worktree의 기본 `python3`는 Apple CLT `3.9.6`으로 선택됐다. `tomllib` 입력 준비 실패 후 설치된 FreeCAD 번들 Python으로 준비 작업만 다시 수행했다. 원래 폴더의 Python은 `3.14.3`이었다. 검사 결과를 환경별로 혼동하지 않는다.
- `npm ci --ignore-scripts --no-audit --no-fund`로 해당 SHA의 lockfile에 맞춰 설치했다. 의존성 업그레이드는 하지 않았다.
- package scripts에 Node/Python/런타임 test lane과 `serve`가 있다. 독립적인 `build`, `lint`, `typecheck` npm script는 없다.

근거: 원래 preflight(로컬 증거 `preflight`), 실행 worktree preflight(로컬 증거 `master-preflight`), 런타임 fingerprint(로컬 증거 `runtime`), 명령 원장(로컬 증거 `commands`).

### 읽은 자료와 과거 증거의 구분

요청된 README의 실행·구조·테스트 안내, AGENTS.md, product-workflows, project-closeout-status, final-maintainer-handoff, final-non-inspection-software-closeout, revision-impact-and-reinspection, USB 허브 확장 점검 및 master 통합 검증 문서를 읽고 연결된 CLI·구현·테스트를 확인했다.

`docs/product-workflows.md`, `docs/revision-impact-and-reinspection.md`, `docs/usage-trials/usb-hub-master-integration-verification.ko.md`는 시작 브랜치에는 없고 검사한 master에는 있었다. 이를 “프로젝트에 문서가 없다”로 분류하지 않았다.

| 증거 종류 | 이번에 확보한 것 | 해석 |
| --- | --- | --- |
| 과거 실행 기록 | 9월 12~13일 확장 점검, 9월 15일 master 통합 검증 문서 | 과거 전체 테스트·축척·브라우저·한글 PDF 기록이다. 이번 통과로 대체하지 않는다. |
| 과거 원본 파일 확보 | 기존 `output/usage-trials/usb-hub-mount/`의 요구사항·변경 요청·A/B TOML | 가정 기반 대리 시험 입력이다. 실측 기반 실제 장착 설계와 섞지 않았다. |
| 현재 실행 | 이번 create/draw/STEP·SVG 재측정, 브라우저, strict 거절, report, review-context, 비교·계획 시도 | 새 경로에 기록했다. 입력 원본 SHA와 복사 이력(로컬 증거 `inputs`) 및 원본 보존 확인(로컬 증거 `preservation`)을 남겼다. |
| 직접 확인 필요 | 실제 허브와 설치면, 사용자 판단·작업 시간·이해도 | 생성 파일이나 AI 대리 조작으로 대신 증명하지 않았다. |

별도 로보틱스·UAT 실험을 필수 과제로 가져오지 않았다. 과거 master 통합 원시 로그 전체는 이번 실행 증거로 가져오지 않았다.

### 대표 사례의 요구사항

원본: 요구사항(로컬 증거 `requirements`), 변경 요청(로컬 증거 `change-request`). 원본 설정에서 **export.directory만 새 실행 경로로 변경**하여 A/B 모델을 생성했다. 비교용 별도 사본은 private absolute path 거절을 확인한 뒤 export.directory만 저장소 상대경로로 바꿨다. 가상의 과거 이력이나 실물 측정값을 추가하지 않았다.

| 항목 | REV A | REV B | 출처·가정 |
| --- | --- | --- | --- |
| 판 외곽·두께 | 142 × 74 × 4 mm | 동일 | 시험 가정 |
| 기준 좌표 | 왼쪽 아래 원점, X 오른쪽·Y 위·Z 두께 | 동일 | 원본 시험 정의 |
| D1 / D2 | (12,12), (12,62) | 동일 | 책상 쪽 고정점을 가정 |
| H1 / H2 | (130,12), (130,62) | (120,12), (120,62) | 허브 브래킷 쪽 두 홀만 왼쪽 10 mm 이동 |
| 구멍 | 4개, Ø5.2 관통 | 동일 | 시험 가정 |
| X 중심 간격 | 118 mm | 108 mm | 위 좌표에서 계산 |
| 오른쪽 모서리↔H 홀 중심 | 12 mm | 22 mm | 위 좌표에서 계산 |
| 재료·제조 공차·하중·실제 체결 | 미확인 | 미확인 | 강도·제작·장착 적합성 주장 불가 |

기존 요구의 CAD 수치 허용오차 `0.00001 mm`와 SVG 표시 검사 한계 `0.03 mm`를 사용했다. **제조 공차가 아니다.** FEA 부재는 이 형상 자동화 주장 자체의 결격 사유가 아니다. 강도·안전성을 주장하려면 별도 근거가 필요하다.

## 3. 이미 갖춘 역량과 현재 실행 결과

현재 코드·문서에는 모델/도면 생성 외에도 runtime 진단, 작업 이력·artifact manifest, review pack, readiness, revision impact, inspection plan, software-demo closeout과 기존 포트폴리오 사례가 있다. 이를 이번 부족함 목록을 채우기 위해 새로 개발해야 할 기능으로 제안하지 않는다. 이번 런타임 성공으로 확인한 범위는 아래 표이고, 다른 기능은 현재 구현·문서 및 명시한 선택 검사 수준의 근거다.

다섯 canonical 패키지의 체크인된 readiness JSON도 직접 읽었다. 모두 `needs_more_evidence / hold_for_evidence_completion`을 유지한다. 상태 추출 기록(로컬 증거 `canonical-readiness`)은 **기존 산출물 확인**이며 이번 실물 검사나 readiness 재생성이 아니다. USB 시험품을 이들 패키지 중 하나로 간주하지 않는다.

### A. 기준 형상과 B. 실제 설계 변경

| 확인 항목 | A | B | 근거 |
| --- | --- | --- | --- |
| `create --strict-quality` | exit 0, pass | exit 0, pass | 명령 로그 |
| 실제 저장 STEP 재읽기 | 유효 solid 1 | 유효 solid 1 | FreeCAD 재측정(로컬 증거 `geometry`) |
| 외곽·두께 | 142 × 74 × 4 | 동일 | Part.read의 BoundBox |
| 구멍 | Ø5.2 네 개, H X=130 | Ø5.2 네 개, H X=120 | 원통면·관통 범위 재측정 |
| 별도 기준 형상과 대칭 차집합 | 0 mm³ | 0 mm³ | 프로젝트 모델 생성 모듈을 사용하지 않은 검사 |
| `draw --strict-quality` | exit 0, pass, 89점 | exit 0, pass, 89점 | A 품질(로컬 증거 `quality-a`), B 품질(로컬 증거 `quality-b`) |
| SVG 형상·홀·축척 | 실제 1:1, 좌표 일치 | 실제 1:1, 좌표 일치 | SVG 좌표 검사(로컬 증거 `svg-measurements`) |
| 종속 치수·revision·시험 표시 | 118 / 12 / A | 108 / 22 / B | 실제 SVG 텍스트와 원 좌표 |

STEP 검사는 생성 메타데이터를 다시 읽은 것이 아니다. 저장된 STEP을 FreeCAD 커널로 열어 검사하고, 중립 요구사항으로 별도 구성한 box-minus-cylinders와 비교했다. 다만 **동일 FreeCAD/OpenCascade 커널과 같은 기본 Boolean 모델링을 사용**했으므로 독립 CAD 엔진·실물 측정에 해당하지 않는다.

도면의 통합 pass는 필수 치수·traceability 등 현재 게이트 범위의 통과다. 이번 설정의 고급 semantic_quality는 `unknown / enforceable:false`이며, 재료·실사용 적합성까지 검증한 결과가 아니다.

### C. 주석만 바꾼 시험

실제 한국어 Studio에서 B TOML을 열고 모델 및 3뷰 1:1 도면을 생성했다. WIDTH 주석만 142→150으로 편집하고 추적 도면 작업을 실행했다.

| 확인 대상 | 현재 결과 |
| --- | --- |
| 형상 / 자동 WIDTH | 142 유지 |
| 편집 계획·표시 주석 | 150 |
| 미리보기 원시 QA | 89/100, 충돌 0 |
| 추적 작업 상태 | `succeeded` — 기본 warning-friendly 동작 |
| 통합 drawing-quality | `fail`, traceability 80%, WIDTH 근거 누락 |
| 동일 편집 설정의 `--strict-quality` | exit 1: traceability 80% < 요구 95% |
| Studio 결과 요약 | 품질 “결과 없음”, 주요 “도면”으로 QA JSON 선택 |

따라서 **주석 편집이 형상을 바꾸지 않는 것과 기본 작업이 완료되는 것은 계약에 맞는다.** 엄격 검사는 실제로 거절했다. 이 사례에서 부족한 것은 그 실패를 주요 화면에 전달하는 연결이다. 89점을 형상 일치로 해석하면 안 된다. 이 검사는 일반적인 모든 치수 불일치를 탐지한다고 증명하지도 않는다.

근거: 편집 화면 기록(로컬 증거 `annotation-dom`), 추적 작업(로컬 증거 `draw-job`), 불일치 통합 품질(로컬 증거 `annotation-quality`), 엄격 거절 로그(로컬 증거 `strict-log`), 화면 캡처(로컬 증거 `summary-image`).

### PDF와 보고서 입력

미리보기 150 주석·1:2 설정 상태에서 실제 “보고서 생성” 버튼을 실행했다. 보고서 작업은 성공했고 PDF 2페이지를 Poppler로 렌더링·시각 확인하고 텍스트를 추출했다.

- 보고서의 실제 설정과 재생성 SVG는 **142, 1:1**이었다. 미리보기만의 150·1:2를 포함하지 않았다.
- 이 동작을 알리는 한국어 안내가 실행 전에 표시됐다. 현 계약과 일치하므로 편집 손실 결함으로 분류하지 않는다.
- 보고서 전체 상태는 `incomplete`, 제조 검토 준비는 `null/Unknown`이다. DFM·FEM·공차 분석은 수행하지 않았다.
- 두 번째 PDF 페이지는 해당 분석·BOM 데이터가 없다는 표시가 대부분이다. 첫 페이지 제목과 생성 시각 간격도 좁다. **파일 생성 성공은 이 PDF가 좋은 대표 설명 자료라는 뜻이 아니다.** 빈 칸을 채우기 위한 FEA 확장은 추천하지 않는다. 이 사례에는 STEP 측정표와 전후 SVG가 더 직접적인 근거다.
- 새 PDF는 영문 설정의 결과다. 과거 문서의 한글 PDF 글꼴 검증을 이번 실행으로 주장하지 않는다.

근거: 보고서 입력 화면(로컬 증거 `report-input`), 입력 대조 JSON(로컬 증거 `report-provenance`), 실제 보고서(로컬 증거 `pdf`), PDF 추출 텍스트(로컬 증거 `pdf-text`).

### 변경 영향·검사 계획

기존 기능을 실제로 시도했지만 **이 USB 사례에서 연결이 완성되지는 않았다.**

1. `review-context` A/B는 각각 exit 0으로 JSON·Markdown·PDF를 생성했다. 실제 형상 inspect는 성공했다.
2. 별도 STEP 특징 검출기는 `No JSON found`로 fallback했다. 원인을 좁힌 결과는 F03에 있다.
3. review pack의 part_id는 파일명에서 나온 `usb_hub_surrogate_A` / `usb_hub_surrogate_B`이고 revision은 둘 다 `null`이었다.
4. `compare-rev --impact-out`은 처음에는 absolute export 경로를 거절했다. 비교용 경로만 상대경로로 바꾼 뒤에는 **부품 ID 불일치**로 거절했다. revision impact 파일은 생성되지 않았다.
5. `inspection-plan --config`는 `config revision mismatch`로 거절했다. config를 생략한 진단 실행은 exit 0이지만 canonical 계획은 **blocked, package_revision_missing, items=[]**였다.
6. 새 `output/` 품질 side input은 canonical evidence 연결에서 제외된다는 경고도 있었다. 안전 경계를 우회하거나 출력 JSON의 ID·revision을 사후 조작하지 않았다.

이는 “비교/계획 기능이 없다”는 증거가 아니다. 존재하는 계약 검사와 관련 단위 검사는 통과했다. **기존 형상 시연 입력을 후속 계획 입력으로 정리하는 일이 남았다는 증거**다. `--proof-lineage`의 승인 패키지 allowlist는 현재 hinge-block이므로 USB 허브에 임의로 적용하지 않는다.

현재 좌표로 설명할 수 있는 수동 변경 영향은 H1/H2의 X 좌표, X 중심 간격 118→108, 오른쪽 중심 여유 12→22다. 두께·D 홀·지름·Y좌표는 유지 대상이다. 이것은 이번 진단자의 확인 목록이며 **CLI가 생성한 재검사 계획이나 완료된 검사 기록이 아니다.**

## 4. 8개 영역 점검표

| 영역 | 판정 | 확인 방법·근거 종류 | 미확인·제한 |
| --- | --- | --- | --- |
| 문제와 요구사항 | PASS | 원본 요구·변경 요청과 A/B 입력 확인. 현재 코드·현재 실행 | 실제 허브 소유·불편·설치 요구는 사용자 확인 필요 |
| 기계공학적 판단 | BLOCKED | 좌표계·변경/유지 관계는 재측정으로 확인. 원본은 전부 시험 가정 | 재료·4 mm 두께·Ø5.2 선정 이유·체결·하중 근거와 본인 결정은 없음 |
| CAD와 설계 변경 | PASS | 실제 FreeCAD 생성, 저장 STEP 커널 재읽기, 별도 기준 비교 | 이 평판 범위이며 전 형상·전 플랫폼 보증 아님 |
| 도면·출력물 일치 | PASS | 전후 SVG 재측정, revision 확인, 주석 불일치 strict 거절, PDF 입력 대조 | UI 표시 실패는 사용성 항목. 고급 semantic 판단·제조 적합성은 미확인 |
| 검증과 변경 영향 | BLOCKED | STEP/SVG 검증 PASS. 실제 compare/inspection-plan 실행으로 ID·revision 차단 확인 | 이 사례의 자동 영향 보고서·유효한 delta 계획은 없음 |
| 사용성과 재현 | FAIL | TOML 업로드→모델→도면→편집→추적→보고서 실제 브라우저 수행. JSON 거절·결과 표시 결함 재현 | 타인 PC, 전체 언어·화면 크기 조합, 실제 사용자 평가 미실행 |
| AI 활용과 기여 | NOT_RUN | 외부 AI 실호출 미실행. 현재 코드의 초안 검토 단계·default-deny와 fake-fetch 검사 확인. 과거 AI 대리 기록 확인 | 실제 외부 AI 입출력·사용자 검토·개인 기여 분량 미확인 |
| 포트폴리오 전달력 | FAIL | 기존 case 문서와 이번 산출물 비교. 현재 실행·과거 실행 기록 | USB 사례의 공개 가능한 입력·전후 증거·본인 설명·시연 묶음 부족. 본 보고서는 진단이며 최종 발표물이 아님 |

`PASS`는 정해진 검사 조건 충족, `FAIL`은 기대 동작/전달 조건 미충족, `BLOCKED`는 시도 후 필요한 입력/근거 부족, `NOT_RUN`은 미실행, `N/A`는 현재 주장 밖이다. 강도 해석·제조 승인·실물 검사 완료는 이 소프트웨어 시연의 PASS 조건이 아니며 **N/A**다.

## 5. 실제 부족함과 최소 조치

### F01. 품질 결과와 주요 파일의 화면 연결

**분류: Studio 중심 v1 전 해결 필요 / 코드 결함.**

- 위치: master `public/js/studio/recent-job-quality-status.js:50,181`, `artifacts-workspace.js:1453,1545`, `result-files.js:29,93,112`.
- 기대: 작업 실행 완료와 품질 실패를 동시에 보여주고, draw의 주요 결과는 실제 도면으로 안내한다.
- 실제: tracked draw의 `result.drawing_quality.status=fail`과 산출물은 존재하지만 “결과 없음” 표시. 주요 “도면”은 `drawing_qa.json`. 품질 파일을 열어도 전용 상태 대신 metadata만 표시됐다.
- 재현: B TOML → Drawing 3뷰 1:1 → WIDTH 150 → 추적 도면 → 결과 파일. 원시 작업(로컬 증거 `draw-job`)과 화면(로컬 증거 `summary-image`) 대조.
- 코드 근거: 상태 추출기가 report 계열 summary를 읽고 draw의 `drawing_quality`를 연결하지 않는다. 파일 분류는 `drawing` 문자열을 가진 QA JSON도 주요 결과 후보로 우선시한다. 이 경우 JSON의 view 가능 점수가 download-only SVG보다 높다.
- 영향: 검증은 실패했는데 대표 화면에서 그 이유를 확인하기 어렵다. **품질 pass를 잘못 표시한 것으로 과장하지 않는다.**
- 최소 변경: draw/create의 기존 canonical quality 상태를 표시 모델에 연결하고, draw SVG/PDF와 QA sidecar 우선순위를 분리한다. backend 검사 기준은 유지한다.
- 완료 조건: 동일 150 주석 작업에서 “실행 완료 / 품질 실패 / WIDTH 근거 부족”을 확인하고, 원래 142 작업에서는 pass를 표시한다. 주 파일은 SVG/PDF다. 저장된 실제 작업 구조로 회귀 검사 후 동일 브라우저 경로를 한 번 재확인한다.
- 현재 상태: **수정하지 않음.** 해당 표시 관련 기존 테스트 명령은 exit 0이었으나 이 실제 조합을 잡지 못했다.

### F02. 대표 A/B 사례의 식별·요구 정보 연결 부족

**분류: v1 설명·증거 보완 / 자동 영향·재검사까지 주장한다면 v1 전 해결 필요.**

- 위치: A review pack(로컬 증거 `review-a`), B review pack(로컬 증거 `review-b`), blocked 계획(로컬 증거 `inspection`), `src/services/revision-impact/revision-impact-service.js:1025`, `lib/revision-impact-contract.js:829`.
- 기대: 같은 부품의 A/B revision을 정확히 연결하고 변경된 요구에 해당하는 영향·후속 확인 목록을 만든다.
- 실제: 서로 다른 part_id, review revision null, canonical side input 제외, 비교 거절 및 빈 blocked 계획.
- 재현: compare-portable.log(로컬 증거 `compare-log`), inspection-plan.log(로컬 증거 `plan-config-log`), inspection-plan-no-config.log(로컬 증거 `plan-log`).
- 영향: 형상 A/B 비교는 입증했지만, 이 입력으로 자동 reinspection까지 완료했다고 설명할 수 없다.
- 최소 조치: 기존 `review-context --context` 등 문서화된 입력 계약을 검토해 같은 part_id와 명시적 A/B revision·package·stable characteristic 정의를 가진 **별도 합성 사례 입력**을 준비한다. source revision과 모델 경로/해시를 기록하고 기존 artifact를 덮거나 결과 JSON을 고쳐 통과시키지 않는다. 실제 공차·검사 방법은 없으면 미확인으로 유지한다.
- 완료 조건: 비교 결과가 H1/H2와 유지 항목을 올바르게 연결하고, 계획은 미확인 공차·방법을 숨기지 않는다. 합성 이력과 미완료 검사 표시를 유지한다.
- 코드 수정 필요성: 현재 확인한 차단은 의도된 입력 계약이다. **새 기능이나 일반화된 형상 매칭 개발 필요성은 입증되지 않았다.** 이 입력 보완 경로의 성공은 아직 검증하지 않았다.

### F03. FreeCAD CLI에서 STEP 특징 검출 진입점 미실행

**분류: 후속 개선 / STEP 자동 특징 추출을 v1 핵심으로 주장하면 먼저 해결할 코드 결함.**

- 위치: `scripts/step_feature_detector.py:329,343`, `lib/paths.js:528`, `bin/fcad.js:270`, `lib/model-analysis.js:97`.
- 기대: 정상 STEP에서 특징 검출 JSON을 얻는다.
- 실제: 두 review-context 모두 `No JSON found` 경고 후 특징 힌트 없이 계속했다. STEP 자체는 이번 독립 검사에서 유효했다.
- 원인 근거: FreeCAD 1.1.3의 직접 스크립트 실행에서 `__name__`은 파일 모듈명이다. 해당 detector는 `if __name__ == "__main__"`에만 main 호출이 있다. runtime 이름 probe(로컬 증거 `name-probe`)와 기존 함수 직접 호출 probe(로컬 증거 `detector-probe`)에서 차이를 확인했다. 직접 호출에서는 네 원통 홀을 검출했다.
- 영향: 생성·inspect·독립 재측정은 가능하지만 자동 import/review 특징 힌트는 약해진다. 기존 canonical readiness 기록에도 같은 과거 경고가 있어 이번 새 regression으로 단정하지 않는다.
- 최소 변경: 지원 FreeCAD 호출 방식에서 detector main이 실행되도록 진입점을 좁게 수정한다. 실패 안내가 정상 STEP 수정을 무조건 권하지 않도록 원인을 구분한다.
- 완료 조건: **원래 CLI 경로**에서 동일 STEP의 특징 JSON·네 홀을 받고 경고가 사라진다. helper 직접 호출 성공만으로 완료 처리하지 않는다.
- 현재 상태: 제품 수정 없음. 별도 진단 wrapper만 사용했다.

### F04. Studio JSON 파일 입력의 안내·처리 불일치

**분류: 후속 개선 / JSON 지원을 시연한다면 v1 전 해결 필요인 코드 결함.**

- 위치: `public/js/studio/model-workspace.js:1392`, `src/server/studio-model-service.js:76`.
- 기대: 선택기에서 허용한 JSON을 처리하거나, 지원하지 않는 입력을 명확히 안내한다.
- 실제: 정상 config.json 선택 및 작업 확인은 가능하지만 생성에서 TOML parse error. 같은 내용을 TOML로 선택하면 모델 생성과 이후 흐름이 성공했다.
- 근거: JSON 오류 DOM(로컬 증거 `json-error`), TOML 성공 DOM(로컬 증거 `model-success`).
- 최소 변경: 공용 설정 로더의 JSON 정규화를 재사용하거나 해당 UI의 지원 형식을 정확하게 제한한다. TOML 경로를 유지한다.
- 완료 조건: 동일 JSON과 TOML이 같은 모델을 생성하거나, JSON 선택 전 명시적 지원 안내가 일치한다.
- v1 영향: TOML만 사용하는 이번 대표 시연의 차단 요인은 아니다.

### F05. 사례 전달·본인 기여 증거의 부족

**분류: v1 설명·증거 보완 + 직접 확인 필요. 제품 코드 추가가 기본 해법은 아니다.**

- 위치: 과거 USB 문서는 시험/수정 기록이며, 실제 입력·원시 산출물은 ignored `output/`에 있다. 기존 `docs/portfolio/`에는 다른 좋은 software-demo case들이 이미 있다. “포트폴리오 문서가 전혀 없다”는 판단은 틀리다.
- 기대: 평가자가 한 사례의 문제, 본인 판단, 변경, 검증, 한계를 짧게 따라갈 수 있다.
- 실제: 이번 결과는 로컬 증거 묶음으로 보존했지만 공개된 재현 묶음·2~3분 시연·사용자 설계 근거 기록은 없다. 현재 PDF는 분석 미수행 화면이 대부분이므로 대표 도면/설명 자료를 대신하지 못한다.
- 최소 조치: 가정 기반 사례라고 표기하고 입력·전후 SVG·측정 JSON·실패 예 한 개·한 페이지 설명을 묶는다. 가독성 목적의 PDF 제목 간격/빈 분석 영역 개선은 필요하면 후속으로 다룬다.
- 완료 조건: fresh clone과 제공 입력만으로 재현 경로를 따라갈 수 있고, 사용자가 아래 질문을 직접 답한다. 사람의 작업 시간 절감률·물리적 적합성·AI 실호출을 근거 없이 덧붙이지 않는다.

## 6. AI 역할과 면접에서 설명할 내용

확인된 구조는 Node CLI/Studio가 입력과 작업·artifact를 관리하고 Python/FreeCAD가 모델·도면을 생성하며, JSON 품질·traceability가 판단 근거를 제공하는 방식이다. 현재 시연에서 외부 AI가 형상을 검증한 것이 아니다.

`src/services/design/openai-responses-client.js`에는 별도 실호출 허용과 요청 횟수 제한이 있고, `public/js/studio/ai-guided-flow.js`에는 초안 검토·검증 후 실행 상태가 있다. 관련 fake-fetch·상태 검사는 이번에 실행했다. 유료 외부 요청은 이번 승인 범위에 없어 실행하지 않았고 키·청구 설정도 열지 않았다. 따라서 모델 접근성, 실제 응답 품질, 실제 AI 초안→사용자 검토 성공은 **NOT_RUN**이다.

설명에 사용할 수 있는 사실:

- 같은 요구로 A/B를 정의하고, 변경 홀 두 개와 유지 항목을 따로 확인했다.
- 모델 생성 성공, 도면 QA 점수, strict 품질 판정, 실제 물리적 검사 성공은 서로 다르다.
- 150 주석/142 형상 사례는 점수 89가 검증 완료가 아니라는 실제 반례다.
- 결과 요약 표시 문제와 STEP detector 진입점 문제를 현재 실행으로 좁혔다. **이번에 고쳤다고 말하지 않는다.**
- 과거 문서에는 AI 대리 사용과 수정 기록이 있지만, 그것으로 사용자의 독립 설계 역량·개발 기여 분량을 추정하지 않는다.

면접 전에 본인이 답해야 하는 질문:

1. 왜 이 문제를 선택했고 실제 누구의 어떤 반복 작업을 줄이려 했는가?
2. 142×74×4, Ø5.2, 홀 좌표 중 직접 결정한 값은 무엇이며 어떤 자료에 근거했는가?
3. X를 10 mm 이동할 때 어떤 제약은 유지하고 어떤 간격은 바뀌어야 하는가?
4. 생성 코드·AI 초안 중 직접 검토하거나 수정한 부분과 이유는 무엇인가?
5. 89점, strict fail, 실행 완료, 제조 HOLD를 각각 어떻게 설명하는가?
6. 실물에 적용하려면 무엇을 측정하고 어떤 하중·체결 조건을 확인해야 하는가?

직무 연결은 **생산기술의 설계·검토 자동화와 품질 데이터 추적**을 우선 제안한다. 근거는 반복 출력 생성, 리비전·artifact 관리, 오류 신호와 한계 구분이다. 기계설계에서는 형상 변경 규칙과 도면·모델 일치 설명을 보조 강점으로 제시할 수 있다. 강도·재료 선정·현장 품질 개선 실적까지 증명한 사례는 아니다. 채용 시장 조사를 하지 않았으므로 취업 효과나 시장 수요는 단정하지 않는다.

## 7. 2~3분 시연과 확인된 명령

권장 제목: **가정 기반 USB 허브 플레이트의 설계 변경 자동화와 CAD·도면 검증**

설명 문장: “FreeCAD와 설정 기반 자동화로 구멍 위치 변경을 재현하고 저장 STEP·도면 좌표를 다시 확인했다. 주석과 형상 불일치가 높은 QA 점수에도 남을 수 있음을 보여주고 엄격 품질 검사와 현재 UI의 한계를 구분했다.”

| 시간 | 보여줄 내용 | 주장 범위 |
| --- | --- | --- |
| 0:00–0:25 | 원본 요구와 모의 변경 요청 | 실측·실제 장착 설계가 아닌 시험 가정 |
| 0:25–1:05 | A/B SVG와 H1/H2 위치, 간격 118→108 | 실제 형상 변경과 유지 항목 |
| 1:05–1:40 | STEP 재측정 표, 유효 solid·네 홀·기준 형상 차이 0 | CAD 커널 검사이며 실물 검사가 아님 |
| 1:40–2:15 | WIDTH 150 주석, 형상 142, QA 89, strict exit 1 | 오류 탐지 사례. 현재 UI “결과 없음”은 결함이라고 명시 |
| 2:15–2:45 | blocked 검사 계획과 남은 사용자 판단 | ID/revision 연결 부족, 실제 제작·AI 실호출·본인 판단 미확인 |

자동 revision impact 성공 화면은 이번에 얻지 못했으므로 시연에 넣지 않는다. 2~3분 녹화 자체는 **NOT_RUN**이다.

다음은 **이번에 실행한 명령의 축약 기록**이다. 실행 위치는 위 고정 master worktree다. 입력/출력 경로·전체 인자·종료 코드는 명령 원장(로컬 증거 `commands`)에 있다. 이미 생성한 경로를 그대로 재실행하면 덮어쓸 수 있으므로, 재현할 때는 A/B 설정 사본의 export.directory와 아래 출력 경로를 새 ignored 디렉터리로 함께 바꾼다.

```bash
npm ci --ignore-scripts --no-audit --no-fund
node bin/fcad.js check-runtime --json \
  --fingerprint-out output/portfolio-gap-review-20260924/runtime_fingerprint.json

node bin/fcad.js create output/portfolio-gap-review-20260924/rev-a/config.toml --strict-quality
node bin/fcad.js create output/portfolio-gap-review-20260924/rev-b/config.toml --strict-quality
node bin/fcad.js draw output/portfolio-gap-review-20260924/rev-a/config.toml --strict-quality
node bin/fcad.js draw output/portfolio-gap-review-20260924/rev-b/config.toml --strict-quality

# 사용자에게 보여준 주석 불일치 사본: exit 1이 기대 결과
node bin/fcad.js draw output/portfolio-gap-review-20260924/annotation-only-strict/config.json --strict-quality

node bin/fcad.js serve 8897 --jobs-dir output/portfolio-gap-review-20260924/jobs
```

A/B TOML 입력 A(로컬 증거 `config-a`) / TOML 입력 B(로컬 증거 `config-b`), STEP 측정 스크립트(로컬 증거 `step-script`), SVG 측정 스크립트(로컬 증거 `svg-script`)도 함께 보존했다. 측정 스크립트에는 이번 실행 체크아웃 경로가 있으므로 다른 PC에서 그대로 재사용할 수 있는 배포 도구라고 주장하지 않는다.

실제 브라우저 경로: 새 모델 시작 → 설정 파일 → TOML → 생성 → 모델 보기 → 도면 편집 → 미리보기 → WIDTH 편집 → 추적 도면 → 결과 파일 → 보고서 생성. Home·Model·Drawing은 해당 흐름을 수행했고, Review·Console은 로드 smoke, 결과 파일은 생성 결과·품질 파일 선택까지 확인했다. OS 네이티브 선택기·외부 FreeCAD GUI 열기·전체 뷰포트 조합은 수행하지 않았다.

## 8. 실행 원장 요약과 미실행 범위

| 실행 | 결과 | 해석 |
| --- | --- | --- |
| 설치·runtime·help | exit 0 | 고정 master·실제 FreeCAD 경로 확인 |
| A/B create·draw strict | 각각 exit 0 | 이 사례의 모델·도면 gate 통과 |
| STEP·SVG 별도 측정 | exit 0, 요구값 일치 | 현재 실행 |
| 선택 Node 검사 6파일 | runner 보고 92 pass, 0 fail | QA 집계·초안 상태·AI 보호·영향 의미·계획 계약 |
| 선택 Python 2파일 | 18 pass, 하위 검사 2 pass | 치수 일치 및 실제 plate runtime traceability 포함 |
| 표시 관련 기존 검사 명령 | exit 0 | 실제 F01을 잡았다는 뜻 아님 |
| review-context A/B | exit 0 + 특징 검출 fallback 경고 | 경고를 숨기지 않음 |
| compare-rev impact | exit 1 | 경로 거절 후 portable 사본도 part_id 불일치 |
| inspection-plan + config | exit 1 | revision 불일치 |
| inspection-plan config 생략 | exit 0, status blocked | 사용 가능한 계획 성공으로 간주하지 않음 |
| 주석 불일치 strict draw | exit 1 | 기대한 방어 동작 PASS |
| 브라우저 tracked draw | succeeded + drawing-quality fail | 기본 경고 중심 실행 계약 |
| 브라우저 tracked report | succeeded, report incomplete | 생성과 공학 검증 완료를 구분 |
| PDF info/render/text | 모두 exit 0, 2페이지 | 실제 파일 시각 확인 완료 |
| 전체 npm test / 전체 Python / 전체 runtime smoke | NOT_RUN | 과거 통합 기록을 먼저 읽고 대표 흐름·관련 선택 검사만 수행 |
| 유료 AI, 실물 측정·제작·장착, 사람 작업 시간·UAT | NOT_RUN | 이 환경의 실행으로 대신 증명할 수 없음 |
| 과거 explicit-scale-unmet·취소 409·guided 제목 잔류 | NOT_RUN | 과거 문서만 확인. 이번 새 결함 또는 회귀로 집계하지 않음 |

실패한 임시 입력 준비 뒤 존재하지 않는 config로 한 create 시도가 exit 1이었다. 이는 준비 단계 환경 오류로 분류했으며 유효한 A 생성 실패로 집계하지 않았다. 별도 FreeCAD 번들 Python의 직접 `import FreeCAD` 시도도 실패했으나, 지원 freecadcmd 경로의 실제 런타임 실행은 성공했다.

## 9. 가장 효과적인 다음 작업 하나

**Studio 결과 요약을 실제 draw 품질 결과와 연결하는 F01만 작게 수정한다.**

이 사례의 핵심 강점은 “그럴듯한 모델”보다 “틀린 결과를 알아보고 설명하는 것”이다. 이미 게이트가 가진 실패 정보를 사용자가 즉시 볼 수 있게 하는 수정이 새 분석 기능보다 효과적이다.

완료 기준은 B의 142 정상 도면과 150 주석 불일치 도면 두 결과에서 실행/품질 상태가 정확하고, 주요 파일이 실제 도면이며, WIDTH 근거 부족을 화면에서 확인할 수 있는 것이다. 이후 새로운 기능 대신 위 한 사례의 입력·전후 증거·본인 설명·2~3분 시연을 정리한다.

사용자가 CLI·JSON 중심의 소프트웨어 사례로 범위를 확정한다면 **제품 개발 없이 그 설명·시연 정리로 마무리하는 선택도 가능**하다. F02 자동 영향 연결, F03 자동 특징 추출, F04 JSON 입력을 완성했다고 표현하지만 않으면 된다.

## 10. 변경·보존·배포 상태

- 제품 코드·테스트 코드·기존 설정 파일은 수정하지 않았다.
- 기존 A/B 입력 두 파일은 시작 시 SHA-256과 동일함을 확인했다.
- 새 보고서 1개와 ignored 진단 스크립트·로그·산출물을 작성했다.
- 새 산출물 157개를 증거 폴더에 복사하고 원본과 SHA-256을 대조했다. 체크섬 목록(로컬 증거 `hashes`).
- 검사 worktree는 제품 소스 변경 없이 보존했다. 원래 브랜치의 `docs/superpowers/` 작업은 그대로 두었다.
- 자신이 시작한 127.0.0.1:8897 서버와 임시 브라우저 탭은 종료했다.
- commit, push, PR 생성·병합, 배포, 외부 메시지 전송, 검사 승인·증거 첨부는 하지 않았다.
- 이 보고서는 이번 점검 범위의 진단이다. 모든 결함 발견을 보장하지 않는다.

## 로컬 증거 보존 경로 (저장소 미포함)

다음은 점검 당시 로컬 증거를 찾기 위한 저장소 루트 기준 상대 경로다. 파일은 이 문서와 함께 배포되지 않으며, 경로 목록 자체가 실행 결과의 재검증을 대신하지 않는다.

- `preflight`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/preflight.json`
- `master-preflight`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/master-preflight.json`
- `remote`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/remote-tip.json`
- `commands`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/command-ledger.json`
- `runtime`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/runtime_fingerprint.json`
- `inputs`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/input-provenance.json`
- `preservation`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/source-preservation.json`
- `requirements`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/requirements.md`
- `change-request`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/change-request.md`
- `geometry`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/geometry-measurements.json`
- `svg-measurements`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/svg-measurements.json`
- `quality-a`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/rev-a/usb_hub_surrogate_A_drawing_quality.json`
- `quality-b`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/rev-b/usb_hub_surrogate_B_drawing_quality.json`
- `annotation-dom`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/browser-annotation-150.txt`
- `draw-job`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/jobs/08124149-4c3c-4fda-b5dd-b49b96744e92/job.json`
- `annotation-quality`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/annotation-only-strict/usb_hub_surrogate_B_drawing_quality.json`
- `strict-log`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/annotation-strict.log`
- `summary-image`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/browser-artifact-summary.png`
- `report-input`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/browser-report-input-final.txt`
- `report-provenance`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/report-provenance-check.json`
- `pdf`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/jobs/1d1ee020-e2fe-4df7-a542-fb5a5e55efa9/artifacts/usb_hub_surrogate_B_report.pdf`
- `pdf-text`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/report-text.txt`
- `review-a`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/rev-a/review/review_pack.json`
- `review-b`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/rev-b/review/review_pack.json`
- `inspection`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/inspection/inspection_plan.json`
- `compare-log`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/compare-portable.log`
- `plan-config-log`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/inspection-plan.log`
- `plan-log`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/inspection-plan-no-config.log`
- `name-probe`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/runtime-script-name.log`
- `detector-probe`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/detector-explicit-call.log`
- `json-error`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/browser-json-error.txt`
- `model-success`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/browser-model-success.txt`
- `config-a`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/rev-a/config.toml`
- `config-b`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifacts/rev-b/config.toml`
- `step-script`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/measure_step.py`
- `svg-script`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/measure_svg.py`
- `hashes`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/artifact-checksums.json`
- `canonical-readiness`: `tmp/codex/portfolio-gap-review-20260924-1rvof6ig/canonical-readiness.json`
