# Claude와의 기능 비교 및 수입검사 도구 리팩터링 계획

작성일 2026-11-19 · 대상 저장소 `freecad-automation` · 제품 방향 제안

## 2026-11-28 진행 상태

1~4단계는 PR #211에서 독립 Python 패키지로 구현했다. 구매자 기준과 CSV 열 매핑을 읽고, 표본별 판정과 원본 행을 보존하며, 수정본을 이전 제출과 비교할 수 있다. 설치와 실행 예제는 패키지 문서에 있다. [PR #211](https://github.com/dooosp/freecad-automation/pull/211) · [수입검사 패키지](../../packages/incoming-inspection/README.md)

현재 5단계 실전 비교 실험을 기다리고 있다. 품질 담당자 2명이 같은 제출 쌍을 검토한 뒤 정확도와 재검토 시간을 아래 기준으로 판정한다. [5단계 실험 기준](#5-개발을-계속할지-결정하는-실험)

**추천하는 방향은 협력사 검사성적서 재검토 도구다.** 첫 사용자는 부품을 납품받고 도면과 성적서를 대조하는 품질 담당자다. 담당자가 구매자 검사 기준과 협력사 측정표를 넣으면, 어떤 표본의 어떤 치수가 범위를 벗어났는지, 측정값이 어디에서 빠졌는지, 수정 성적서에서 무엇이 달라졌는지를 한 화면에서 확인한다. 첫 버전의 성공 기준은 담당자가 원본을 열어 판정을 검산하고 재검토 시간을 줄일 수 있는가다.

## 1. Claude와 현재 프로젝트는 어디까지 겹치는가

Claude 쪽은 2026-11-19에 확인한 공개 제품 설명과 플러그인 소스를 기준으로 했다. 비교 단위는 모델 자체, 설치한 커넥터, 제조용 스킬을 구분한다. 아래의 성능·우선순위 판단은 제품 가설이다. 동일 자료로 두 제품을 직접 시험한 결과는 5단계에서 수집한다.

| 사용자가 하는 일 | Claude에서 확인한 범위 | 이 저장소에서 확인한 범위 | 투자 판단 |
| --- | --- | --- | --- |
| 부품을 만들고 수정한다 | Autodesk의 공식 커넥터는 실행 중인 Fusion에서 스케치·형상을 생성·수정·조회한다. 커뮤니티 FreeCAD MCP도 FreeCAD 모델 편집과 FEM 실행을 제공한다. | `fcad create`는 설정 파일에서 모델과 내보내기 품질 자료를 만들고, `inspect`, `fem`은 모델을 검사·해석한다. | 겹침이 크다. 기존 자동화와 회귀 테스트를 유지하고 대화형 모델러 신설은 후순위로 둔다. [Fusion 커넥터](https://claude.com/marketplace/connectors/autodesk-fusion) · [커뮤니티 FreeCAD MCP](https://github.com/neka-nat/freecad-mcp) · [저장소 CLI](../../bin/fcad.js) |
| 도면과 설계 변경을 검토한다 | Autodesk는 속성 추출, 개정 비교, 내보내기와 설계 검토 문서화를 예시로 든다. 복잡한 조립품의 자동 생성에는 한계도 명시한다. | `draw`는 TechDraw 도면과 QA를 생성한다. `compare-rev`는 두 검토 패키지의 지표·근거 변화를 비교하며 구멍 위치와 형상 동등성은 검사 범위 밖이다. | 기존 도면 QA는 자산이다. STEP 개정에서 이동한 구멍까지 찾으려면 좌표 정합과 피처 대응을 새로 검증해야 한다. [Autodesk 활용 사례](https://www.autodesk.com/products/fusion-360/blog/how-to-improve-your-fusion-workflow-with-the-claude-desktop-connector/) · [도면 QA 계획](drawing-qa-gates.md) · [리비전 비교 구현](../../scripts/reporting/revision_diff.py) |
| 부적합을 분석하고 보고한다 | 11월 12일 공개된 Claude for Manufacturing은 검사 실패 조사, 과거 사례 검색, 시정조치 보고서 초안과 근거 연결을 지원한다. 공개 스킬에는 CSV·XLSX 실측값과 코드 기반 통계 분석이 있다. | `dfm`은 제조성 점검과 개선 제안을 제공한다. `review-context`와 `readiness-pack`은 자료를 모으고 누락 근거를 표시한다. | DFM, 실측, 부적합 원인조사는 각각 다른 입력을 쓴다. 범용 품질 보고서 작성기를 새 제품의 중심에 두면 중복이 크다. [Anthropic 출시 문서](https://claude.com/resources/articles/claude-for-manufacturing) · [공식 품질 스킬](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/claude-for-manufacturing/skills/root-cause-capa/SKILL.md) · [DFM 기능](dfm-actionable-suggestions.md) |
| 협력사 수치와 도면을 대조한다 | 공식 시연에 도면 개정, 허용 범위, 표본별 초과, 계측기 상태가 등장한다. 제조 플러그인은 부품·로트·공급업체 데이터를 결합하고 불일치를 정리한다. | CSV·TSV 입력, 단위 정규화, 원본 행 참조, 패키지별 필수 치수 누락 탐지가 이미 있다. 일부 경로는 공급사 판정을 우선한다. | 파일 읽기와 누락 경고만으로는 약하다. **모든 필수 항목×표본을 구매자 기준으로 독립 판정하고, 같은 규칙으로 재실행·재제출 비교하는 흐름**을 검증한다. [Claude 제조 시연](https://claude.com/solutions/manufacturing) · [공식 플러그인](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/claude-for-manufacturing/README.md) · [기존 검사 입력](../../scripts/adapters/load_inspection.py) · [패키지 대조](../../src/services/inspection-evidence-intake/inspection-evidence-intake-service.js) |
| 검토한 자료를 다음 담당자에게 넘긴다 | 제조 플러그인은 출처가 달린 초안을 만들고 담당자가 검토하는 흐름을 제공한다. | 준비도 JSON, 문서, 체크섬이 있는 배포 묶음과 증빙 첨부 절차가 있다. | 외부 수신자의 독립 검증은 두 번째 제품 후보로 남긴다. 첫 버전의 검토 결과는 오프라인에서 열 수 있게 한다. [Claude 제조 기능](https://claude.com/solutions/manufacturing) · [납품 묶음 테스트](../../tests/release-bundle.test.js) · [증빙 첨부 계약](../inspection-evidence-contract.md) |

### 지금 코드를 바꿀 이유

현재 Python 입력기는 공급사가 적은 상태를 우선한다. 실제로 `_normalized_status("pass", 0.20, 0.10, -0.10)`은 `in_tolerance`를 반환했다. 공차 양쪽이 비고 편차가 0일 때도 같은 결과였다. 기존 자료를 읽는 동작으로는 설명되지만, 구매자가 공급사 판정을 검산하는 도구의 기본값으로 쓰면 불일치를 놓친다. 기존 함수의 의미를 바꾸면 이미 그 결과를 읽는 보고서에도 영향이 간다. [기존 판정 코드](../../scripts/adapters/load_inspection.py) · [단위 처리](../../scripts/adapters/unit_normalizer.py)

저장소의 표준 예제 5개는 모두 실측 증빙 0건으로 준비도 판정이 보류돼 있다. 브래킷 수집 가이드에는 도면상의 검사 항목과 빈 실측 칸이 함께 있다. 이 자료는 시제품의 누락 사례로 쓸 수 있다. 실제 협력사 양식의 다양성과 고객 수요는 별도 파일럿에서 확인한다. [예제 목록](../examples/README.md) · [브래킷 수집 가이드](../inspection-evidence-collection/quality-pass-bracket.md)

### 검토한 세 방향

| 후보 | 재사용할 수 있는 자산 | 새로 증명할 것 | 순서 |
| --- | --- | --- | --- |
| 협력사 성적서 재검토 | 검사 행 출처, 입력 진단, 실측 증빙 계약 | 공급사 판정과 독립된 전수 대조, 수정본 재검토 시간 | **첫 제품.** 명확한 정답표를 만들 수 있고 CAD 없이 시연 가능 |
| 두 STEP 파일의 형상 변경 분석 | 형상 검사, 기존 개정 비교 | 좌표계가 바뀌거나 피처 ID가 재생성돼도 동일 구멍을 추적하는 정확도 | 기하 엔진을 개발하고 싶은 경우의 대안. 첫 제품의 선행조건은 아님 |
| 납품 패키지 수신 검증 | 체크섬, 문서 계보, 배포 묶음 | 수신자가 외부 폴더에서 빠진 자료와 바뀐 증빙을 찾아내는지 | 재검토 결과를 외부에 넘기는 수요가 관찰되면 확장 |

## 2. 첫 사용자 경험과 판정 계약

**사용 예시.** 구매자가 개정 B의 구멍 H1에 대해 9.90–10.10 mm를 허용하고 표본 S1·S2·S3을 요구한다. 아래는 기능을 설명하기 위한 가상 측정값이다.

| 표본 | 첫 제출 | 화면에서 보는 결과 | 수정본에서 보는 결과 |
| --- | --- | --- | --- |
| S1 | 10.10 mm, 공급사 합격 | 상한과 같으므로 범위 내. 공급사 원본 행으로 이동 | 같은 값이면 재검토 목록에서 제외 |
| S2 | 10.20 mm, 공급사 합격 | 상한보다 0.10 mm 큼. 공급사 판정과 불일치 | 10.02 mm로 재제출하면 이전 값·새 값·양쪽 출처를 표시 |
| S3 | 행 없음 | 필수 표본 누락. 구매자 검사 기준의 해당 항목으로 이동 | 여전히 없으면 미해결로 유지 |

**입력.** 구매자가 등록하는 `requirements.json`에 부품 번호·도면 개정·도면 위치·특성 ID·단위·절대 하한/상한·필수 표본 ID를 담는다. 협력사는 한 제출당 한 부품·개정·로트의 CSV를 낸다. `mapping.json`은 원본 열 이름을 부품·개정·로트·표본·특성·측정값·단위·공급사 판정에 연결한다. 접수 시 지정한 로트와 CSV의 로트를 대조한다. 공급사 열이 있으면 접수값과 대조하고, 없으면 공급사 이름의 출처를 ‘담당자 입력’으로 표시한다. 초기 지원은 UTF-8 CSV와 양측 한계가 명시된 선형 치수(mm·inch)다. 실제 양식이 XLSX·단측 공차 위주라면 파일럿에서 수요를 확인해 우선순위를 바꾼다.

**대조.** 특성 ID와 표본 ID를 정확히 결합하고, 요구 표본 전체에서 제출 행을 찾는다. 상·하한은 포함하고 십진수로 계산한다. mm로 환산할 때 1 inch = 25.4 mm를 적용하고 표시용 반올림은 비교 뒤에 한다. `supplier_result`와 계산한 `computed_result`를 따로 저장한다. 범위 내·범위 밖·누락·판정 불가를 구분하며, 중복 행·등록되지 않은 항목·개정 불일치·알 수 없는 단위·불완전한 한계는 이유와 함께 검토 목록에 남긴다. 누락행은 요구사항을, 충돌하는 중복행은 해당 원본 행 모두를 가리킨다. 계산 결과의 용도는 입고 담당자의 검토 지원이다.

**출력.** `review.json`에 입력 파일 해시, 규칙 버전, 행별 결과와 사유를 기록하고 같은 결과에서 한국어 `review.html`을 생성한다. HTML에서 치수, 한계, 공급사 기재값, 재계산 결과와 원본 행을 함께 읽는다. 최초본과 수정본은 각각 보존한다. 규칙·기준·열 매핑이 바뀌면 화면에 그 변경을 표시하고 전체 항목을 다시 검토한다.

## 3. 기존 코드와 독립 제품의 경계

**구현 제안.** 같은 저장소의 `packages/incoming-inspection/`에 독립 Python 패키지를 둔다. Python 표준 라이브러리의 `csv`, `decimal`, `hashlib`로 첫 버전을 만들고, 서버 없이 열리는 HTML을 제공한다. 이 디렉터리만 복사한 환경에서 실행하는 테스트를 배포 기준으로 삼는다. 패키지가 자리 잡은 뒤 별도 저장소로 옮기는 비용도 이 경계로 확인할 수 있다.

| 기존 자산 | 처리 방법 |
| --- | --- |
| `fcad create/draw/inspect/dfm/fem`, Studio, Node → Python → FreeCAD | 기존 사용자의 설정, 명령, 경로와 산출물 계약은 그대로 지원한다. 첫 버전의 신규 코드와 의존성은 독립 패키지 안에 둔다. |
| 열 매핑·원본 행·단위 정규화 | 기존 정상·오류 사례를 회귀 자료로 재사용한다. 새 입력기는 한국어 원본 헤더, 수치 원문, 헤더 제외 1부터 시작하는 논리 행 번호를 보존한다. 기존 공급사 상태 우선순위와 단위 기본값을 새 판정기로 가져오지 않는다. [행 출처 구현](../../scripts/adapters/evidence_refs.py) · [기존 입력 테스트](../../tests/test_ingest.py) |
| 검사 증빙 스키마와 Stage 5B 첨부 | `review.json`은 계산 결과다. 실측 원본·사람의 검토·허가가 필요한 기존 첨부 경로를 호출할 수 있는 어댑터는 후속 작업으로 둔다. 예제·합성 성적서는 계속 테스트 용도로 쓴다. [증빙 스키마](../../schemas/inspection-evidence.schema.json) · [첨부 계약](../inspection-evidence-contract.md) |
| 산출물 목록과 준비도 | 새 결과는 도메인 보고서 한 종이다. 향후 `fcad`로 연결할 때 파일 목록과 실행 메타데이터는 기존 output-manifest를 사용한다. 자동 입고 승인, ERP 쓰기, 새 전역 매니페스트는 초기 범위 밖이다. [기존 매니페스트](../output-manifest.md) |

구현을 시작할 때는 사용자 작업이 섞인 현재 체크아웃과 분리해 기준 커밋을 고정한 워크트리를 사용한다. 기존 코드에 수정이 필요한 경우에는 기존 호출자의 결과를 비교하는 테스트를 먼저 추가한다. 독립 패키지를 제외해도 기존 CLI와 Studio를 그대로 배포할 수 있어야 한다.

## 4. 실행 순서와 완료 기준

아래 파일과 명령은 **구현 제안**이다. 새 패키지 기준 경로는 `packages/incoming-inspection/`이다. 1단계에서 사례와 정답을 고정하고, 2–4단계는 각각 입력부터 사용자가 확인할 결과까지 작게 완성한다.

| 단계 | 할 일과 구현 위치 | 다음 단계로 넘어갈 기준 |
| --- | --- | --- |
| 1. 기준 사례 확보 | `tests/fixtures/`에 위의 가상 검사 기준, 공급사 양식 2종, 최초본·수정본, 담당자가 검산한 정답표를 둔다. 사용 가능한 Claude 제조 기능으로 같은 가상 사례를 먼저 풀고 정답률, 설정·재검토 시간을 기록한다. 가능하면 사용 허락을 받은 익명 성적서로 필요한 열과 실제 단위를 확인한다. | 서로 다른 열 이름으로 같은 검사 결과를 표현할 수 있다. 정답표에는 범위 내, 초과, 누락, 중복, 개정 불일치가 있다. 실자료가 없으면 소프트웨어 검증만 진행하고 현장 효과는 미측정으로 기록한다. |
| 2. CSV 한 건을 끝까지 대조 | `src/incoming_inspection/ingest.py`는 원본과 열 매핑을 읽는다. `evaluate.py`는 구매자 기준과 대조한다. `cli.py`의 `review`는 결과 JSON을 쓴다. | `tests/test_review.py`에서 위 세 표본이 각각 범위 내·초과 및 판정 불일치·누락이다. 경계와 inch 환산, 빈 값, 잘못된 단위, 중복·추가 행, 뒤바뀐 한계, 다른 개정·로트도 검증한다. 식별 실패 행이 정상 표본을 채우는 경우는 0건이어야 한다. |
| 3. 담당자가 결과를 검산 | `report.py`에서 JSON과 입력 스냅샷으로 정적 HTML을 만든다. CLI는 원본 CSV·구매자 기준·열 매핑의 동일 바이트를 검토 건 안에 보관한다. 원본 또는 기준 항목으로 이동하는 링크를 제공한다. | `tests/test_report.py`에서 한글 헤더, 따옴표 안의 쉼표·개행, 중복 헤더, 원본의 HTML 특수문자를 확인한다. 브라우저에서 네트워크를 끈 채 초과 항목은 원본 행으로, 누락 항목은 기준으로 이동한다. 기존 결과 폴더 재사용 시 덮어쓰기를 막는다. |
| 4. 재제출·재현·독립 배포 | `diff.py`에서 두 결과를 비교한다. 부품·개정·로트·공급사가 같을 때 특성·표본 키로 추가·삭제·값/판정 변경·미해결 항목을 연결한다. `pyproject.toml`에 독립 CLI `incoming-inspection`을 등록한다. | `tests/test_replay.py`에서 같은 바이트·설정·규칙의 재실행은 동일한 판정 JSON을 생성한다. 행 재정렬만으로는 값 변경 0건이다. 원본 해시가 달라지면 제출본은 구분한다. 기준·매핑·규칙 변경은 전체 재검토, 다른 로트는 별건으로 표시한다. 깨끗한 환경에서 패키지만 설치한 뒤 `review`와 `diff`가 모두 동작한다. |
| 5. 실제 업무와 비교 | 아래 파일럿으로 Excel 수기, 사용 가능한 Claude 제조 기능, 새 도구를 비교한다. 실제 사용자가 조작하고 독립 검토자가 정답표를 관리한다. | 아래의 품질·시간·차별성 기준을 모두 충족하면 XLSX 또는 수신자 검증 중 현장에서 가장 자주 요청한 기능 하나를 확장한다. 충족하지 못하면 원인을 기록하고 다음 기능 투자를 보류한다. |

구현 후 사용할 공개 명령의 예시는 다음과 같다.

```sh
incoming-inspection review --requirements rev-b.json --mapping supplier-a.json \
  --measurements first.csv --supplier A --lot L42 --out review-01
incoming-inspection review --requirements rev-b.json --mapping supplier-a.json \
  --measurements revised.csv --supplier A --lot L42 --out review-02
incoming-inspection diff review-01/review.json review-02/review.json --out changes
```

각 단계에서는 새 테스트를 먼저 실행해 실패 조건을 확인하고, 구현 후 저장소 루트에서 아래 검증을 실행한다. 첫 명령은 2단계부터 쓰는 새 패키지 테스트다. 기존 Node 레인과 Studio 검사는 독립 패키지를 추가한 이후의 회귀 확인에 사용한다.

```sh
PYTHONPATH=packages/incoming-inspection/src python3 -m unittest discover -s packages/incoming-inspection/tests
node scripts/run-pytest.js -q tests/test_ingest.py
node tests/inspection-evidence-contract.test.js
node tests/inspection-evidence-intake.test.js
node tests/readiness-inspection-evidence-contract.test.js
npm test
npm run test:studio-browser-smoke
```

## 5. 개발을 계속할지 결정하는 실험

**비교 방법.** 제안 표본은 공급사 양식 2종 이상, 익명 제출 묶음 10건, 품질 담당자 2명이다. 최초본과 수정본을 한 묶음으로 두고, 양품만 있는 제출과 문제가 있는 제출을 모두 넣는다. 수기 Excel·Claude 제조 플러그인·새 도구에 동일한 기준과 제출본을 제공하고, 채점용 정답표는 검토자에게만 제공한다. 도구 사용 순서를 교차 배정하고 최초 양식 설정 시간, 건별 검토 시간, 재검토 시간을 따로 잰다. 수동 보정 시간도 포함하며 Claude 모델·스킬 버전과 프롬프트를 기록한다. 외부 서비스 사용이 허용된 자료만 Claude 비교에 쓴다.

| 측정 항목 | 제안 통과선 |
| --- | --- |
| 잘못된 정상 처리 | 정답표상 초과·누락·판정 불가인 표본을 정상으로 표시한 건수 0 |
| 정상 항목과 근거 품질 | 정답표상 정상인 항목에 대한 잘못된 경고 비율 5% 이하. 모든 경고에서 원본 행 또는 누락된 요구사항에 도달 |
| 재현성 | 동일 입력·기준·매핑·규칙의 반복 판정 일치율 100% |
| 업무 효과 | 수정본 1건당 재검토 시간 중앙값이 수기 Excel 대비 30% 이상 감소. 최초 설정 시간을 포함한 총소요와 Claude 대비 관측 차이도 별도 공개 |
| Claude 대비 투자 판단 | 위 품질 기준을 모두 충족하면서 Claude보다 잘못된 정상 처리가 적거나, 같은 정확도에서 수정본 재검토 시간 중앙값이 20% 이상 짧으면 확장한다. 양쪽이 비슷하면 후속 기능 투자를 멈춘다. 현장에서 외부 모델 호출 없는 실행이 필수라고 확인된 경우에는 그 환경에서 별도 파일럿을 진행한다. Claude를 시험할 수 없으면 상대 성능은 미검증으로 남긴다. |

숫자는 파일럿 의사결정용 목표다. 소규모 표본에서 얻은 결과는 해당 양식과 대상 부품에 한정해 해석한다. 직접 측정할 첫 값은 **수정 성적서 한 건에서 담당자가 달라진 값을 찾고 도면과 대조하는 데 걸리는 시간**이다.

## 작성 시 확인한 기준선

- 저장소 루트 `freecad-automation`, 브랜치 `codex/mega-studio-api-contract-fuzz-audit`, HEAD `19981885360ef13e8c802890f8c134cc8a15a38a`, 기본 브랜치 메타데이터 `origin/master`. 조사 시작 시 미커밋 경로 73개가 있었으며 기능 비교는 당시 작업 트리 기준이다.
- 실제 확인한 항목은 `fcad --help`의 공개 명령, 기존 Python 입력 테스트 7개 통과, Node의 검사 증빙 계약·입수·준비도 반영 테스트 스크립트 3개 통과, 표준 예제 5개의 준비도 JSON, 기존 판정 함수의 두 입력 결과다.
- 이번 결과물은 계획서다. FreeCAD 실기동, Claude 커넥터 직접 실행, 양산 부품 검사 및 현장 시간 비교는 이번 조사에 포함되지 않았다.
