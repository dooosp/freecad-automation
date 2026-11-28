# Quality Baseline

## 회전 텍스트 겹침 검사 — 2026-11-06

`quality_pass_bracket`의 Ø10/100 겹침은 회전된 100의 경계를 무시해서
검사에서 누락됐다. bbox는 이제 요소와 부모의 SVG 변환, 상속된 글꼴 크기와
text-anchor를 적용한다. 기존 글자 폭 근사와 IoU > 0.10, 겹침당 2점 감점은 유지한다.
지름 치수의 선호 배치가 기존 치수 문자와 충돌하면 생성기가 지시선 전체의 대체 배치를 검사한다.
명시적 각도는 유지하며, 안전한 대체 위치가 없으면 치수를 숨기지 않고 QA에 남긴다.
형상·지름·지시 대상은 바꾸지 않으며, 후처리는 연결된 치수 문자만 따로 이동하지 않는다.

텍스트 겹침의 기본 계약은 `text_overlap` medium/advisory다.
`--strict-quality`만으로 모든 글자 겹침이 실패한다고 해석하지 않는다.
100점 기준의 명시적 실패 검증에는 기존 `--fail-under 100`을 사용한다.
`--raw`는 후처리만 생략하고 FreeCAD 생성과 QA는 실행하므로 고의 겹침 회귀에 사용할 수 있다.
회전 경계를 반영한 QA도 글꼴 렌더러 자체가 아니므로 실제 SVG 렌더 검토를 함께 수행한다.
아래 실행 기록과 canonical package 산출물은 각 당시의 증거이며 자동 재생성하지 않는다.

## 현재 Mac 실행 기준 — 2026-11-02 (Asia/Seoul)

**판정: 이 Mac의 FreeCAD 1.1.4 안정판으로 CAD/STEP/SVG/PDF 실행을 재현했다.
CAD 수치 검증과 GUI STEP 표시가 통과했다. 생성 SVG의 제조 전달용 시각 검토는 실패했다.**
아래 과거 기록은 이 실행의 성공 증거가 아니다.

경로 표기 정리 (2026-11-06): `$REPO_ROOT`는 해당 실행의 `freecad-automation` 저장소 루트다.
공유용 문서에서는 개인 홈 아래의 절대경로만 이 변수로 치환했다. 재실행할 때는 저장소 안에서
`REPO_ROOT="$(git rev-parse --show-toplevel)"`로 설정한다. 이 변수 설정을 당시 실행했다는 뜻은 아니다.
경로 치환 전 원문은 ignored 로컬 증거인
`tmp/codex/pcb-closure-20261106T181004-a5cf01/quality-baseline-original.md`에 보존했다.

### 소스와 보존 범위

- 저장소: `$REPO_ROOT`
- 원격: `https://github.com/dooosp/freecad-automation.git` — 요청한 동일 프로젝트.
- 브랜치: `codex/mega-studio-api-contract-fuzz-audit`
- HEAD: `19981885360ef13e8c802890f8c134cc8a15a38a`
- 기본 브랜치: 로컬 Git metadata의 `origin/master`. 원격 최신 tip/PR 상태는 이번 작업에서 조회하지 않았다.
- 시작 시 `git status --short --untracked-files=all`은 빈 결과였다. 기존 ignored 로컬 데이터는 별도로 존재했다.
- 실행을 마친 뒤 문서 수정 전 tracked 파일 983개의 SHA-256이 시작 시점과 같았다.
  제품 코드, 입력 TOML, 기존 canonical package는 수정하지 않았다. `.env.local`도 보존했다.
- 영구 변경은 이 기준 문서 갱신이다. 로그/보조 스크립트는 ignored `tmp/codex/`,
  새 결과는 ignored `output/`, 테스트 의존성은 ignored `.cache/test-python/` 안에 둔다.
- 새 브랜치, commit, push, PR 생성, merge, release는 하지 않았다.

적용 지침은 저장소 `AGENTS.md`와 사용자 작업 범위이다.
관련 근거는 `README.md`, `docs/testing.md`, `package.json`,
`bin/fcad.js`, `lib/paths.js`, `lib/runner.js`, `scripts/_bootstrap.py`,
`scripts/create_model.py`, `scripts/_shapes.py`, `scripts/_export.py`,
`scripts/generate_drawing.py`, 모델/도면/보고서 서비스와 해당 테스트다.
이번 환경 기준 작업과 일치하는 별도 실행 계획은 없었다.
별도 build/lint/typecheck npm script는 없고, source hygiene와 Node/Python 테스트 lane을 사용한다.

### 실측 환경과 유지 판단

| 항목 | 이번 확인 결과 |
| --- | --- |
| 하드웨어 | MacBook Pro `Mac16,7`, Apple M4 Pro, 14 CPU cores (10P+4E), RAM 24 GB |
| OS / 프로세스 아키텍처 | macOS 27.0.1, build 26A434 / arm64 |
| 안정판 | `/Applications/FreeCAD-1.1.4.app`, runtime `1.1.4R20260928`, Git `4fd3bf320d9566a27e60069fc8387448aaa3a094` |
| 개발판 | `/Applications/FreeCAD-26.3-dev.app`, bundle `26.3.0d39`, runtime `26.3.0R20260922`; 버전 확인만 수행 |
| FreeCAD runtime | `/Applications/FreeCAD-1.1.4.app/Contents/Resources/bin/freecadcmd`, Mach-O arm64 |
| FreeCAD Python | 같은 bundle의 `Contents/Resources/bin/python`, Python 3.11.14; FreeCADCmd 안에서도 3.11.14/arm64 확인 |
| Qt / OCC | Qt/PySide 6.8.3 / Open CASCADE 7.8.1 |
| 일반 Python | `/opt/homebrew/opt/python@3.14/bin/python3.14`, 3.14.3 |
| 프로젝트 테스트 Python | `.cache/test-python/bin/python`, 3.14.3, pytest 8.4.2, matplotlib 3.10.8 |
| Node / npm | 25.8.0 / 11.11.0. 프로젝트 `node >=24` 충족; hosted CI의 Node 24와는 버전이 다름 |
| Add-on | v1-1 사용자 Mod에 RobustMCPBridge 존재, 실행 로그에서 auto-start false; 이 작업은 MCP bridge에 의존하지 않음 |
| 템플릿 | bundle TechDraw Templates 아래 SVG 126개(하위 폴더 포함). 이번 CLI 도면은 자체 A3 composer 사용 |
| 폰트 | Qt에서 Arial, Helvetica, Apple SD Gothic Neo 사용 가능; Noto Sans KR 없음. 실제 PDF는 bundle matplotlib의 DejaVu 폰트 내장 |

2026-11-02에 확인한 [공식 최신 안정 릴리스는 1.1.4](https://github.com/FreeCAD/FreeCAD/releases/tag/1.1.4)이다.
설치 안정판과 일치하므로 **유지**한다. 26.3은 **테스트용 분리**를 유지한다.
시스템 앱 교체나 업데이트가 필요하다는 근거는 없다.

주의할 실제 경로 차이:

- `~/Applications/FreeCAD.app`과 `~/.local/bin/FreeCADCmd`는 개발판으로 연결되어 있다.
- 전역 `/opt/homebrew/bin/fcad`는 다른 worktree의 `bin/fcad.js`로 연결되어 있다.
- 따라서 이 기준에서는 현재 저장소의 `node bin/fcad.js`와 명시적 `FREECAD_APP`을 사용한다.
- `FREECAD_PYTHON/BIN/CMD`는 `FREECAD_APP`보다 우선한다. 재실행 helper는 이 override들을 제거한다.
- 설치본 `freecadcmd --help`에서 스크립트 파일 인자, `--version`, `--user-cfg`, `--safe-mode` 등을 직접 확인했다.
  지원 여부를 추정한 headless 전용 옵션을 사용하지 않았다.
- 일반 Python의 FreeCAD import 여부로 설치 건전성을 판정하지 않았다.
  실제 FreeCADCmd가 CAD, import, TechDraw, report를 실행한 결과를 사용했다.

### 무엇이 원본인가

| 자료 | 이 사례에서의 역할 |
| --- | --- |
| `configs/examples/quality_pass_bracket.toml` | 치수·형상·연산·도면 의도를 가진 원본 입력 |
| `scripts/*.py`, Node CLI/서비스, schema, lockfile | 입력을 실행하는 원본 프로그램/의존성 계약 |
| 이번 FCStd | TOML을 기존 `_shapes` 함수로 계산해 저장한 단일 `Part::Feature` snapshot. Sketch/Pad 설계 이력은 없음 |
| 이번 STEP/STL/SVG/보고서 PDF/품질 JSON | 위 입력과 runtime에서 새로 생성한 결과. PDF는 분석 보고서이며 2D 도면 PDF가 아님 |
| 외부에서 가져온 FCStd/STEP, 수동 작성 SVG template | 해당 import workflow에서는 원본 입력일 수 있으므로 확장자만 보고 삭제/재생성 대상으로 분류하면 안 됨 |
| canonical docs-package JSON | 그 package의 기존 증거/상태 계약. 이번 시험 결과로 덮어쓰지 않음 |

선택은 Git HEAD, 입력 내용과 SHA-256, 실행 흐름으로 했다. 파일명이나 수정 날짜를 최신성의 증거로 쓰지 않았다.

### 입력과 실제 명령

후보 5개가 모두 존재한다. 이번 실제 CAD 실행은 가장 단순한 3 shapes/3 operations의
`quality_pass_bracket`만 대상으로 했다.

| 후보 | 확인한 입력 | 이번 CAD 실행 |
| --- | --- | --- |
| cnc_motor_mount_bracket | `configs/generated/cnc_motor_mount_bracket.toml` | 미실행 |
| controller_housing_eol | `configs/examples/controller_housing_eol.toml` | 미실행 |
| hinge_block | `configs/examples/hinge_block.toml` | 미실행 |
| pcb_mount_plate | `configs/examples/pcb_mount_plate.toml` | 미실행 |
| quality_pass_bracket | `configs/examples/quality_pass_bracket.toml` | 통과 |

원본 SHA-256: `9a63c9f01f918a71b342bbbae1a7f7bc2a53a32baefd39bea352218b63b92e2f`.
원본은 보존하고 단계별 TOML 사본에서 `export.directory`만 변경했다.
`hinge_block` 원본의 기본 export는 tracked docs 아래이므로 향후에도 반드시 별도 출력 경로로 덮어써야 한다.

```bash
cd "$REPO_ROOT"
unset FREECAD_PYTHON FREECAD_BIN FREECAD_CMD FREECAD_DIR
export FREECAD_APP=/Applications/FreeCAD-1.1.4.app
export PYTHON="$PWD/.cache/test-python/bin/python"
BASE=tmp/codex/mac-freecad-baseline-20261102T194501+0900
OUT=output/mac-freecad-baseline-20261102T194501+0900

node bin/fcad.js check-runtime --json
node bin/fcad.js validate-config configs/examples/quality_pass_bracket.toml
node bin/fcad.js create "$BASE/create.toml" --strict-quality
node bin/fcad.js draw "$BASE/draw.toml" --bom --strict-quality
node bin/fcad.js report "$BASE/report-02.toml" --dfm --out-dir "$OUT/report-02"
npm test
npm run test:py
npm run check:source-hygiene
```

위 명령은 이미 실행한 경로를 설명한다. **새 실행에는 기존 OUT을 재사용하지 않는다.**
검증된 로컬 replay helper는 매번 새로운 control/output 폴더를 만든다:

```bash
python3 tmp/codex/mac-freecad-baseline-20261102T194501+0900/reproduce.py
```

helper는 runtime → create → native FCStd 저장/STEP 별도 문서 import → draw →
현재 실행의 quality/manifest만 report 폴더로 복사 → report → SVG/PDF 렌더를 직렬 실행한다.
2026-11-02 20:07 KST에 `mac-freecad-repro-20261102T200731-bf7203`에서 실제 replay가 통과했다.
두 실행의 형상 측정값과 SVG bytes는 동일했다. STEP 차이는 HEADER 생성시각 한 줄뿐이었다
(`repeatability.json`, `step-reproduction.diff`). 파일 전체 hash 일치를 재현성 기준으로 삼지 않았다.
GUI와 사람의 시각 검토는 helper의 자동 통과에 포함하지 않는다.
이 helper와 로그는 ignored 로컬 자료이므로 새 clone으로 옮길 때에는 해당 evidence 폴더도 보관해야 한다.

프로젝트 테스트 환경의 실제 국소 보완은 다음뿐이다:

```bash
python3 -m venv .cache/test-python
.cache/test-python/bin/python -m pip install \
  -r .github/requirements/ci-python.txt -r .github/requirements/ci-report.txt
```

기존 npm dependencies는 `npm ls --depth=0`에서 충족되어 다시 설치하지 않았다.
새 clone에서는 먼저 `npm ci`를 실행한다. 이번에는 `npm ci`를 실행했다고 주장하지 않는다.
설치된 Python transitive 버전은 evidence의 `python-freeze.txt`에 기록했다.

### CAD / STEP 검증

| 요구 | 실측/검사 결과 |
| --- | --- |
| 단위 | mm, mm³. FreeCAD에서 1 cm = 10 mm. STEP에 `SI_UNIT(.MILLI.,.METRE.)` 명시 |
| 외곽/위치 | min (0,0,0), max (160,100,8) mm |
| 두께 | 8 mm |
| 구멍 | 관통홀 2개: Ø6 @ (30,30), Ø10 @ (125,70) mm |
| 모따기 | C1, 홀 양면 cone 4개, 45°, 원통부 z=1..7 mm |
| 솔리드/유효성 | solid 1, closed true, valid true; faces 32, edges 62 |
| 부피 | 126560.36585889466 mm³; 원시 box/holes 및 C1 모따기의 독립 해석식과 비교 |
| 재계산/저장 | 새 native 문서 recompute, FCStd save, reopen, state `Up-to-date` |
| STEP round-trip | native export STEP와 CLI STEP을 각각 별도 새 문서에 import/recompute |
| 비교 | bbox/min/max/질량중심/부피/solid/홀 중심·반경·축/관통 여부/모따기 비교 |
| 차이 | STEP 부피 차이 -1.4551915228366852e-10 mm³; 양방향 차집합 부피 0 |
| 총 검사 | native/FCStd/두 STEP 합계 133개 통과. GUI 저장 FCStd 추가 8개 통과 |

수치 허용오차는 길이/위치/반경 `1e-6 mm`, 부피 `1e-3 mm³`이다.
이 실행 STEP의 uncertainty가 `1e-7 mm`여서 길이는 그 10배로 잡았고,
부피는 약 126560 mm³에서 파일 직렬화 오차를 허용하는 회귀검사 한계로 정했다.
가공 공차나 도면에 자동 인쇄된 KS 공차를 의미하지 않는다.

CLI create의 지원 export는 STEP/STL/OBJ/BREP이며 FCStd 자동 저장은 없다.
점검용 `native_roundtrip.py`가 동일 `_shapes`와 `_export`를 재사용해 FCStd 저장을 보완했다.
최초 보조 스크립트는 embedded FreeCAD의 `__file__` 부재와 Compound의
`CenterOfMass` 부재를 만났다. 보조 스크립트만 수정하고 solid별 질량중심으로 계산했다.
제품 형상 코드의 실패로 취급하지 않았다. 실패 시도 로그/빈 출력 폴더도 남겼다.
FreeCADCmd는 Python 예외에도 종료 0을 반환할 수 있어, JSON 결과와 실제 파일까지 확인했다.

### 검증 결과와 실제 출력 검토

| 구분 | 상태 | 근거/한계 |
| --- | --- | --- |
| 코드 검사 | 통과 | `npm test`: contract/integration/snapshots 모두 통과, `test:py`: 173 passed, source hygiene 통과 |
| 설정 검사 | 통과 | 원본 validate-config: errors 0, warnings 0; mm 기본값 정규화 |
| 실제 FreeCAD | 통과 | 안정판 check-runtime ready; strict create/draw, report 실제 실행 |
| STEP / FCStd | 통과 | 위 133+8개 검사 및 독립 새 출력 경로의 replay |
| SVG 자동 gate | 통과 | drawing quality pass, QA 97, required presence 100%, 자동 conflict 0 |
| SVG 시각/의미 검토 | **실패** | 아래 재현된 겹침·누락·datum 불일치 |
| PDF 생성/렌더 | 통과 | 실제 3 pages를 Poppler로 렌더하고 확인; DejaVu embedded font 확인 |
| PDF 전달용 내용/표현 | **실패** | 자동 PASS/ready 표기가 SVG 시각 결함을 반영하지 않음; page 1 권고문 일부 잘림 |
| GUI | 통과(범위 한정) | 안정판 GUI에서 이번 STEP을 새 문서로 import, top/iso 실형상 표시, GUI FCStd 저장; `gui-step.png` |
| 환경 차단 | 최종 필수 CLI 경로 없음 | 첫 GUI 세션에서 AppKit 접근성 경로의 SIGTRAP 1회 확인. 재시작 후 STEP GUI 성공; 장시간 GUI 자동화 안정성은 미확인 |
| 미실행 | 명시적 제외 | 나머지 4개 부품, 개발판 CAD 비교, FEM/Monte Carlo, 한글 PDF 실제 출력, Studio 5개 화면 smoke |

원본 생성 SVG를 Qt 6.8.3으로 2100×1485 px 렌더했다.
A3 420×297 mm, 축척 1:2, mm 표기, Ø/⌀ 기호와 모따기 C1 note는 확인했다.
큰 도형의 페이지 밖 잘림은 없었다. 다음 결함은 자동 QA pass와 별개다.

1. 우측 `plan_top_002` Ø10 글자가 전체 100 세로 치수와 겹친다.
2. Ø6/Ø10의 auto/plan 치수가 반복되고, 30/30.0 및 chain/baseline이 중복된다.
   ⌀8/⌀12는 C1 입구 지름과 수치상 맞지만 관통 지름과 구별하는 설명이 부족하다.
3. top/iso만 있어 두께 8이 치수로 전달되지 않는다.
4. 입력 datum 의도는 top face / left hole / right hole인데 SVG는 B를 왼쪽 외곽,
   C를 위쪽 외곽에 붙이며 A를 표시하지 않는다.
   `scripts/_drawing_constants.py:DATUM_VIEW_MAP`의 고정 매핑과
   `generate_drawing.py:render_datums_svg`가 근거다.
5. general tolerance는 입력의 승인된 수치 공차가 아니라 기본 composer에서 인쇄된다.
   이 점검으로 해당 KS 표준 적합성이나 제조 승인을 확인했다고 해석하면 안 된다.

두 명시적 홀 지시선의 화살표 끝은 실제 Ø6/Ø10 원주에 맞는다.
지면상 반경 오차는 약 0.00083/0.00428 mm이고, SVG 좌표가 소수 둘째 자리로
반올림되므로 지면 `0.01 mm` 허용오차로 확인했다.
이는 글자 겹침을 해소했다는 뜻이 아니다.

PDF는 2D 도면을 포함하지 않는 기존 분석 보고서다.
page 2에 tolerance/MC/FEM/BOM 데이터가 없다고 표시되는 것은 해당 분석을
실행하지 않은 결과다. page 1 마지막 권고문의 끝이 잘리고,
page 3 DFM 메시지는 말줄임되므로 전체 권고는 summary JSON을 읽는다.
`report-02`는 이번 create/draw의 output manifests까지 연결한 최종 보고서다.
초기 `report/`의 missing create/drawing manifests는 보조 복사 절차를 고쳐 해소했다.
`report_manifest`는 생성 시점 summary에 optional missing으로 남는다.
PDF의 자동 `PASS / Ready for manufacturing review: Yes`는 이 문서의 제조 전달용 판정을 대체하지 않는다.

### 열어볼 파일과 증거

모든 아래 경로는 저장소 루트 기준이며 이번 실행에서 새로 만들었다.

- 바로 열 모델: `output/mac-freecad-baseline-20261102T194501+0900/native-04/quality_pass_bracket_gui.FCStd`
- TOML 기반 native snapshot: 같은 폴더의 `quality_pass_bracket.FCStd`
- CLI STEP: `output/mac-freecad-baseline-20261102T194501+0900/create/quality_pass_bracket.step`
- SVG: `output/mac-freecad-baseline-20261102T194501+0900/draw/quality_pass_bracket_drawing.svg`
- 렌더: 같은 draw 폴더의 `drawing-render.png`, `top-view-detail.png`
- PDF: `output/mac-freecad-baseline-20261102T194501+0900/report-02/quality_pass_bracket_report.pdf`
- 검증/명령/환경/GUI 증거: `tmp/codex/mac-freecad-baseline-20261102T194501+0900/`
  (`verification.json`, `*.run.json`, `*.stdout.log`, `*.stderr.log`, `native-roundtrip.json`,
  `gui-fcstd-verification.json`, `leader-anchor-verification.json`, `gui-step.png`).

GUI용 FCStd는 STEP import 후 GUI에서 저장한 snapshot이며 parametric history가 없다.
첫 headless native FCStd는 GUI에서 숨김으로 열렸으므로 GUI용 파일을 우선 사용한다.
19:57 KST의 첫 GUI 충돌은 `gui-crash-summary.json`에 기록했다. stack은
`objc_opt_respondsToSelector`와 `NSAccessibility...` 경로를 가리키지만 정확한 원인은 확정하지 않았다.
CAD kernel 오류로 단정하거나 시스템 앱을 교체하지 않았다.
GUI용 파일을 열면 회색 판, 서로 다른 크기의 관통홀 2개와 C1 모따기가 보여야 한다.
`0`은 등각이고, 방향 큐브의 `TOP`으로 평면을 확인한다. `V,F`는 Fit All이다.
숨겨져 있으면 모델 트리의 실제 행을 선택하여 Visibility를 확인한다.
수치 치수는 이 문서와 JSON 검증값으로 대조한다.

### 다음 작업 후보와 완료 기준

1. **대표 도면 수정**: 두께 8, 명시적 hole X/Y, datum A/B/C의 실제 의도를 반영하고
   반복 치수/겹침을 제거한다. 원본 CAD 133개 검사를 유지하며 새 SVG를 렌더해 모두 읽히는 것이 완료 기준이다.
2. **QA와 보고서 판정 정합성**: 현재 실패 SVG를 회귀 fixture로 삼아 회전 텍스트 겹침,
   누락 두께, datum target 불일치를 검출한다. 이 fixture에서 strict gate가 실패하고
   보고서가 문제와 수정 지침을 표시하며 기존 pass fixture가 유지되는 것이 완료 기준이다.
3. **나머지 4개 사례 실행 행렬**: 입력별 요구/예상 solid 수를 먼저 정의하고 별도 폴더에서
   create→STEP→draw/report를 실행한다. 각 사례의 수치 비교·렌더·통과/실패 원인이 기록되는 것이 완료 기준이다.

### 다음 세션 인계

이 HEAD와 안정판 경로를 먼저 재확인한다. 제품 코드 수정은 아직 없다.
replay helper와 `verification.json`을 읽고, 추가 무차별 테스트보다 확인된 SVG 결함을
첫 작업으로 선택한다. CAD/STEP은 검증됐지만 도면의 제조 전달용 검토는 실패다.
전역 fcad/개발판 자동탐지를 쓰지 않는다. 기존 canonical artifacts를 덮어쓰지 않는다.
commit/push/PR/merge는 하지 않은 상태다.

---

## 과거 기준 (보존 기록)

- baseline git commit: `baba643b1933cdef5dbf02a568c45e4fd90433fb`
- baseline branch for this follow-up: `origin/master`
- runtime availability:
  - `node bin/fcad.js check-runtime` -> `Status: ready`
  - runtime mode: `macos-bundle`
  - runtime executable: `/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd`
  - FreeCAD version: `FreeCAD 1.1.1 Revision: 20260414 (Git shallow)`

## Baseline fail-demo: `ks_bracket`

- commands run:
  - `node bin/fcad.js create configs/examples/ks_bracket.toml`
  - `node bin/fcad.js draw configs/examples/ks_bracket.toml --bom`
  - `node bin/fcad.js dfm configs/examples/ks_bracket.toml`
  - `node bin/fcad.js report configs/examples/ks_bracket.toml --dfm`
- observed create result:
  - command exited `0`
  - `output/ks_bracket_create_quality.json` -> `status: "fail"`
  - blocker: `Generated model shape is invalid.`
- observed drawing result:
  - command exited `0`
  - `output/ks_bracket_drawing_quality.json` -> `status: "fail"`
  - blockers:
    - required dimension coverage `83.33%`
    - dimension conflict count `7`
    - traceability coverage `0%`
    - missing required intent `HOLE_DIA`
- observed DFM result:
  - command exited `1`
  - score: `70/100`
  - critical blockers:
    - `hole1` edge distance `3.5 mm < 9.0 mm`
    - `hole3` edge distance `3.5 mm < 9.0 mm`
- observed report result:
  - `output/ks_bracket_report_summary.json` -> `overall_status: "fail"`
  - `ready_for_manufacturing_review: false`
  - inspected PDF first page says `Ready for manufacturing review: No`

## Strict-pass fixture: `quality_pass_bracket`

- commands run:
  - `node bin/fcad.js create configs/examples/quality_pass_bracket.toml --strict-quality`
  - `node bin/fcad.js draw configs/examples/quality_pass_bracket.toml --bom --strict-quality`
  - `node bin/fcad.js dfm configs/examples/quality_pass_bracket.toml`
  - `node bin/fcad.js report configs/examples/quality_pass_bracket.toml --dfm`
- observed create result:
  - command exited `0`
  - `output/quality_pass_bracket_create_quality.json` -> `status: "pass"`
- observed drawing result:
  - command exited `0`
  - `output/quality_pass_bracket_drawing_quality.json` -> `status: "pass"`
  - required dimension coverage `100%`
  - dimension conflicts `0`
  - traceability coverage `100%`
- observed DFM result:
  - command exited `0`
  - score: `100/100`
  - informational note only: chamfer present, fillet optional for stress-critical corners
- observed report result:
  - `output/quality_pass_bracket_report_summary.json` -> `overall_status: "pass"`
  - `ready_for_manufacturing_review: true`
  - inspected PDF first page says `Ready for manufacturing review: Yes`

## Interpretation

- `ks_bracket.toml` remains the intentional fail-demo for blocker-rich quality regression coverage.
- `quality_pass_bracket.toml` is the strict-pass example for create/draw/DFM/report readiness.
- Neither fixture required gate weakening to reach its observed result.
