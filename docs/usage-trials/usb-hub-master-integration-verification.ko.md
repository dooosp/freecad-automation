# USB 허브 수정 사항의 master 통합 검증

2026-09-15. [실행 계획](../exec-plans/usb-hub-master-integration.md)에 따라 분리 작업 트리의 `codex/usb-hub-master-integration`에서 검증했다. 기준은 master `57264a196b2f3ac5272aa8b78f0c35096a7925a0`, 소스는 `25fc0562fb67374ee5d2c4a1a932a4d8cd66bd40`이다. 아래 제품 검증 HEAD는 `1a0954fc1dfb092993a34d92a7924541c6d47066`이며 이후 이 보고서와 과거 시험 문서만 추가했다.

## 통합 범위

- 도면 분류·치수·명시 뷰/메모·실제 축척·FreeCAD 근거 연결, AUTO 처리와 QA 집계를 통합했다.
- Studio 미리보기/추적 계획 일치, 치수 이력·초안·오래된 응답 처리, 재시도·중복 제출·취소 상태, 한글 다운로드/PDF, 조립품 표시 제어를 통합했다.
- 최신 master의 guided 입력/결과 검사, AI 초안 검토 단계, 도면에서 보고서 생성, locale 접근성, 경로 비공개 처리와 기존 manifest 계약을 보존했다. 도면 보고서의 입력 교체 및 공용 모델 제출 잠금도 네 회귀 사례로 보완했다.
- 이미 master에 반영된 audit/journal 두 커밋은 다시 이식하지 않았다. 소스 pilot 문서는 제외하고 과거 시험 문서에서 고정 SHA 링크로 참조한다. 원본 브랜치, 기존 서버 8765/8768, 별도 `docs/superpowers/` 작업에는 쓰지 않았다.

## 실행한 검사

| 검사 | 이번 실행 결과 |
| --- | --- |
| `npm test` | contract, integration, snapshots 모두 통과 |
| `npm run test:py` | 176 통과, 27 하위 검사 통과, 생성 SVG 부재로 1 skip |
| `test_no_plan.py::test_no_plan` | 이번 FreeCAD 생성 SVG를 사용한 보완 실행 1 통과 |
| `npm run check:source-hygiene` | 통과 |
| `npm run check:runtime` / `npm run test:runtime-smoke` | FreeCAD 1.1.3 확인 및 실제 smoke 통과 |
| `test_plate_runtime_traceability.py` | 실제 런타임 8 통과 |
| `test_cli_runtime.py`, `test_infotainment_draw_qa_regression.py`, `test_infotainment_hole_dia_regression.py` | 실제 런타임 4 통과 |
| `studio-draft-state-controller.test.js` | 통합된 56 사례 통과. 제어된 DOM/응답 검사이며 실제 브라우저 검사와 구분 |
| `report-decision-pdf.test.js` | 실제 PDF 생성 및 한글 글꼴/텍스트 검사 통과; matplotlib skip 없음 |
| 실제 browser 도구 | 아래 작업과 24개 화면·언어·너비 조합 확인 |

첫 작업 트리가 `tmp/codex` 아래에 있을 때 기존 intake 분류기가 절대 경로의 상위 폴더까지 generated/control로 분류해 기준 검사 한 건이 실패했다. 제품 코드를 바꾸지 않고 자신의 작업 트리를 ignored `.codex` 아래로 옮겼다. 동일 master 기준 contract/integration/snapshots와 해당 검사가 통과한 뒤 구현했다.

로컬 `npm run test:studio-browser-smoke`는 Chrome/CDP를 사용하는 별도 경로이므로 실행하지 않았다. 이번 실제 UI 검증에는 설치된 in-app browser 도구를 사용했다. 저장소의 hosted browser smoke 검사는 그대로 유지했다.

## 1~8 실제 재현 결과

| 항목 | 이번 근거 |
| --- | --- |
| 1. 축척 | 3/4뷰 × 1:1·1:2·AUTO 여섯 SVG의 top-view 외곽, X/Y 축척, 구멍 중심·지름을 좌표로 측정했다. 표제란과 모두 일치했다. 4뷰 1:1만 `explicit-scale-unmet`으로 strict exit 1, 나머지 다섯 조건은 pass/exit 0이었다. 4뷰 1:1의 실제 축척은 약 0.7505103, 표시값은 `1:1.332427`이다. |
| 2. 계획 입력 | no-plan, notes-only, full-plan, conflicting-views 네 조건을 실제 draw로 생성했다. 모두 exit 0, 계획 치수 7개. 명시 메모와 뷰가 유지됐고 누락 항목만 보완됐다. |
| 3. 미리보기→추적 도면 | 브라우저에서 WIDTH를 142→150으로 수정한 뒤 추적 저장했다. 작업 `02af1ad4-7d33-4dde-b376-0cd651f1c00d`는 편집 계획을 보존했다. 양쪽 SVG에 150 주석이 있고 실제 형상 외곽은 142×74, 축척은 1:2로 같았다. |
| 4. 이력 | 실제 적용·undo·Shift+Z redo 대기 중 언어를 전환했다. 완료 후 추가 조작 없이 값·버튼·이력이 갱신됐다. 입력칸 1503→기본 undo→150은 도면 이력을 바꾸지 않았다. undo 후 148 편집은 이전 150 redo 분기를 제거했다. 별도로 생성한 150×74×4와 142×74×4 STEP을 FreeCAD `Part.read`로 검사해 각각 유효 솔리드 1개와 네 Ø5.2 구멍을 확인했다. |
| 5. 초안·응답 | 미제출 153은 실제 언어 전환 뒤 값과 포커스를 유지했다. 설정 변경 시 stale 안내가 표시됐다. 새로고침은 설정과 입력만 복구하고 미리보기 재생성을 안내했다. 이전/새 요청의 응답 순서 경합과 빌드 중 입력 교체는 제어된 회귀 검사로 확인했다. |
| 6. 오류·취소 | 실제 음수 입력은 제출 전 거부됐고 마지막 도면과 초안은 남았다. 자신의 서버 중단·재시작 후 연결 실패와 만료된 미리보기 안내를 확인했고 재생성으로 복구했다. 중복 제출은 제어된 검사로 확인했다. 실제 실행 중 report 취소는 HTTP 409, 실행 완료를 확인했다. 시작 전 취소는 자신의 store에 실행을 예약하지 않은 queued fixture를 만들고 실제 HTTP 취소 경로로 확인했다. 일반 POST는 즉시 실행되므로 이를 직렬 대기열로 가정한 첫 시험은 폐기했다. |
| 7. 다운로드·PDF | 한글·공백 STEP/PDF를 실제 HTTP로 다운로드해 서버 원본과 바이트가 같음을 확인했다. UTF-8 filename과 attachment 헤더가 맞았다. 다운로드 STEP은 유효 솔리드 1개, 142×74×4, 구멍 중심 `(12,12)`, `(12,62)`, `(120,12)`, `(120,62)`와 지름 5.2였다. PDF 두 페이지를 Poppler로 렌더링·시각 확인하고 한글 텍스트를 추출했다. NanumGothic CID TrueType 글꼴의 embedding/Unicode 지원을 확인했다. 브라우저 SVG 다운로드 전후 탭은 1개로 같았다. |
| 8. 조립품·화면 | 캠과 4절 링크를 실제 생성해 부품 선택·숨김·불투명도·와이어프레임·에지와 모션 재생/정지/초기화를 조작했다. 언어 및 Model↔Drawing 이동 뒤 캠 선택과 숨김이 유지됐고 새 4절 링크 preview는 초기 표시 상태로 시작했다. 단일 판으로 복귀해 불투명도와 AUTO 도면도 확인했다. |

Home, Console, Review, 결과 파일, Model, Drawing을 각각 한·영으로 1280px/390px에서 측정했다. 24조합 모두 document clientWidth와 scrollWidth가 같았고 가시 버튼 겹침이 없었다. 완료 작업을 연 Review·결과 파일도 두 언어·두 너비에서 별도로 가로 넘침이 없었다. 모바일 메뉴 Escape 후 포커스는 메뉴 버튼으로 돌아왔다. 추적 보고서 작업 `a56fb108-1b3f-46fa-a2c9-d8b4f6c627bf`는 실제 도면의 보고서 버튼으로 시작되어 완료 후 결과 파일로 이동했다.

## 결과 해석과 남은 한계

- 기준은 가정한 판과 구멍이다. 실물 허브, 재료, 체결·장착 적합성은 검증하지 않았다. FreeCAD GUI로 외부 파일 열기는 수행하지 않았다. 파일 입력은 browser filechooser 도구로 확인했으며 네이티브 OS 선택기 조작으로 표현하지 않는다.
- 수정 주석 150과 형상 142의 원시 QA 점수는 여전히 89다. 이번 추적 도면의 통합 drawing-quality는 WIDTH 근거 누락, 추적성 80%로 **fail**이었다. 점수 89를 형상/모든 주석 일치나 제조 승인으로 해석하면 안 된다.
- 보고서는 기존 master 계약대로 현재 config에서 도면을 다시 만든다. 미리보기 주석 148 및 화면의 별도 축척 설정을 보고서에 넘기지 않았다. 이 안내·버튼 상태·완료 이동을 보존했다.
- 기존 JSON 파일 입력에는 한계가 있다. 선택기는 JSON을 허용하지만 미리보기 API는 `config_toml`을 TOML로 해석한다. 실제 JSON 입력 거부를 기록하고 동일 내용을 TOML로 변환해 계속 검증했다. 이 경로의 기존 계약을 이번에 확장하지 않았다.
- 기존 Advanced 예제 교체는 preview를 지워도 이전 guided 결과 제목이 실행 요약을 다시 열 때까지 남을 수 있다. 입력 교체·실행 보호와 다음 생성은 확인했으며 별도 guided 흐름 재작성은 하지 않았다.
- 일부 고급 진단 문자열은 영어로 남고 일부 artifact는 전용 viewer 대신 metadata를 표시한다. 한국어 locale, 접근성 이름과 기존 fallback을 보존했다.

원시 명령·exit·SHA·PNG·DOM·측정 JSON은 `tmp/codex/usb-hub-master-integration/`에, 생성 산출물은 `output/usb-hub-master-integration/`에 보관했다. 주요 근거는 `integration-ledger.json`, `final-node/results.json`, `final-python-runtime/results.json`, `final/scale-matrix.json`, `final/input-matrix.json`, `final/layout-matrix.json`, `final/loaded-layouts.json`, `final/download-evidence.json`, `final/downloaded-step-native.json`, `final/preview-tracked-measurements.json`이다. 임시 파일과 산출물은 커밋하지 않았다. [과거 소스 시험](usb-hub-mount-extended-checks.ko.md)의 수치를 이번 통합 결과로 대체하지 않았다.
