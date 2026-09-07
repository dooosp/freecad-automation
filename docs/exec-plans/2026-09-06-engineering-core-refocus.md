# FreeCAD Automation — Engineering Core Refocus Implementation Plan

> **For agentic workers:** 이 문서는 사용자가 기술적 권장안의 선택을 위임한 상태에서 작성된 실행 계획이다. 사용 가능한 경우 `superpowers:executing-plans`로 작업을 순서대로 수행한다. 구현자는 한 명으로 유지하고, 독립 검토 도구가 실제로 있을 때만 읽기 전용 검토자를 사용한다. 구현·검토·실행하지 않은 작업을 수행했다고 기록하지 않는다. 아래 체크박스로 진행 상황을 추적한다.

**Goal:** AI의 설계 발상·일반 설명을 프로젝트의 핵심 기능에서 분리하고, 외부에서 만든 설계도 같은 기준으로 실행·검사·변경 비교할 수 있는 공학 검증 경로를 강화한다.

**Architecture:** 기존 Node CLI → Python runner → FreeCAD 구조를 유지한다. 자연어 설계/AI 검토는 선택적 입력 어댑터로 축소하고, 설정 검증과 모델 생성 호출은 공통 코드로 연결한다. 기존 create-quality, drawing-quality, revision-impact, output-manifest를 재사용하며 새로운 판정 플랫폼을 만들지 않는다.

**Tech Stack:** 저장소의 현재 Node.js ESM, Python, FreeCAD, smol-toml, Ajv, 기존 테스트 러너. lockfile을 유지하고 신규 프레임워크·모델 공급자·데이터베이스를 추가하지 않는다.

**Spec:** 이 문서의 「1. 확정한 설계」와 「2. 합격 기준」. 저장소에 저장할 위치는 `docs/exec-plans/2026-09-06-engineering-core-refocus.md`이다.

**조사 기준:** 2026-09-06 GitHub 읽기 전용 조사. `dooosp/freecad-automation`, 기본 브랜치 `master`, 조사한 커밋 `57264a196b2f3ac5272aa8b78f0c35096a7925a0`.

**검증 범위:** 이 계획 작성 단계에서는 주요 코드·설정·테스트·문서와 PR 메타데이터를 읽었다. 저장소 수정, 로컬 테스트, FreeCAD 실행, 커밋, push, PR 생성은 수행하지 않았다. 아래 PASS는 요구하는 합격 기준이지 이미 확보한 성과가 아니다.

---

## 1. 확정한 설계

### 1.1 프로젝트의 중심

프로젝트의 정의는 **“설계 입력을 실제 CAD로 실행하고, 요구사항과 결과 형상·도면·변경 영향을 대조하는 로컬 작업 환경”**으로 고정한다.

AI가 직접 맡을 것은 설명·사진 해석, 설계 대안, 초안 TOML/코드, 수정 아이디어, 일반적인 해설이다. 프로젝트가 맡을 것은 동일 입력의 반복 실행, 설정 검증, 실제 형상 관측, 요구사항 대조, 변경 영향, 산출물 출처와 연결이다. AI가 검사 코드를 작성할 수 있다는 사실은 그 검사 코드가 프로젝트에 불필요하다는 뜻이 아니다.

### 1.2 기능별 결정

| 대상 | 이번 결정 | 실제 조치 |
|---|---|---|
| 자연어 설계와 AI의 일반적인 설계 검토 | 선택적 입력 어댑터로 축소 | 기존 `design`/review API·응답·스트리밍 호환성을 유지한다. 범용 설계 전문가 역할을 재현하려는 프롬프트 확장을 중단한다. |
| 프롬프트 안의 고정 공차·간극·재료 추정 | 검증 권한 제거 | 사용자 요구와 실제 입력에서 확인되지 않은 값을 규격상 확정값처럼 제시하지 않는다. 필요한 가정은 초안임을 표시한다. |
| AI 스크립트 내부 설정 검증 | 공학 코드로 이동 | 공통 canonical parser/schema를 재사용하고, 기존 실행 가능 형상·참조 의미 검사는 결정적 모듈에 한 번만 둔다. |
| AI build 경로의 직접 Python 호출 | 중복 축소 | 기존 `createModel` 서비스에 위임한다. 모델을 만들었다는 결과와 품질 검증 완료를 혼동하지 않는다. |
| 모델 생성·STEP/STL/BREP 출력·실제 재검사 | 유지·강화 | AI를 호출하지 않고 작동하는 주 경로로 유지한다. |
| `create-quality` | 최우선 강화 | 유효성 추정 제거, 예제 이름 기반 검사 범위 제거, 지원되는 형상에 대한 요구 치수 검사를 강화한다. |
| 도면 QA·설계 버전 비교·재검사 계획 | 유지·회귀 검증 | 새 엔진을 만들지 않고 실제 변경 시나리오로 기존 연결을 검증한다. |
| FEM·공차 해석·DFM | 유지, 이번 확장 제외 | AI의 설명과 실제 계산은 다르므로 삭제하지 않는다. 검증되지 않은 범위로 확대하지 않는다. |
| `line-plan`·`investment-review` 등 주변 실험 기능 | 유지보수만 | 명령을 삭제하지 않고 추가 개발을 이번 범위에서 제외한다. |
| 로보틱스 데모·컴퓨터 비전·LeRobot | 별도 작업으로 보호 | 기존 코드·PR·UAT 후보를 수정하거나 병합하지 않는다. |
| 승인·증거·ready 상태 체계 | 기존 체계 보존 | 새 승인 위원회, 새 readiness 상태, 새 manifest 플랫폼을 만들지 않는다. |

명령 수나 코드 삭제 비율을 목표로 삼지 않는다. 이번 버전에서 공개 명령을 강제로 제거하지 않는다. **중복된 구현 책임과 근거 없는 판정 권한을 제거하는 것**이 목표다.

### 1.3 조사에서 확인한 구체적 근거

아래 경로는 모두 조사 커밋에 존재한다. 실행 시 최신 checkout에서 다시 확인한다.

| 확인 경로 | 확인 내용 | 계획 반영 |
|---|---|---|
| `docs/command-lifecycle.md` | `design`은 이미 experimental이며 기본 도움말은 12개 주요 명령으로 정리되어 있다. | 같은 메뉴 정리를 다시 구현하지 않는다. |
| `scripts/design-reviewer.js` | 설계·검토 프롬프트, 고정 숫자 규칙, TOML 구조 검증이 한 파일에 있다. | 조언과 설정 검증을 분리한다. |
| `src/services/design/design-service.js` | design/review/build를 분기하고 build에서 `create_model.py`를 직접 호출한다. | build의 공통 서비스 위임과 사전 검증을 추가한다. |
| `lib/config-schema.js` | `parseConfigText`, `validateConfigDocument`, `loadConfigWithDiagnostics`가 이미 있다. | 새 canonical 스키마를 만들지 않는다. |
| `src/services/model/create-service.js` | 기존 `createModel` 서비스가 있다. | 모델 생성 호출을 재사용한다. |
| `lib/create-quality.js` | `coerceGeometry`에서 유효성 값이 없을 때 양의 부피와 면 개수로 true를 추론할 수 있다. | 관측되지 않은 shape validity를 true로 만들지 않는다. |
| `lib/create-quality.js` | STEP 구멍 재검사 분기가 `isStepReimportHoleGeometryFixture(config)`와 정해진 이름에 묶여 있다. | 이름이 아니라 지원되는 입력 구조와 실제 측정 가능성으로 범위를 결정한다. |
| `src/services/model/create-quality-service.js` | 실제 출력 경로를 `inspectModel`로 재검사하고 기존 quality JSON을 쓴다. | 두 번째 품질 검사 경로를 만들지 않는다. |
| `docs/revision-impact-and-reinspection.md` | 변경 비교는 명시적 안정 ID 중심이며 범용 BREP 유사도 비교가 아니다. | 새 임의 CAD 형상 매칭을 추가하지 않는다. |
| `tests/lane-manifest.js`, `package.json` | 결정적 Node/Python 검사와 FreeCAD 런타임 검사가 분리되어 있다. | 두 검증 수준을 구분해 보고한다. |

추가 보호 대상: 조사 시 PR #201은 Draft/open이며 PR #199의 `codex/manufacturing-robotics-studio-demo-v1` 위에 쌓여 있다. 조사 시 #201 head는 `fbade2c3b5c874c14f12053e182c797f86f13408`이다. 이 계획은 그 브랜치나 UAT 후보의 수정·승인·대체를 허가하지 않는다.

---

## 2. 합격 기준

### 2.1 공학적 기준

- C1. AI 공급자 접근 없이 설정 검증, 모델 생성 서비스, quality 평가, 도면 QA, 변경 비교가 작동한다. 단, 모델 생성·실제 측정에는 FreeCAD 런타임이 필요하다.
- C2. 잘못된 TOML이나 실행에 필요한 참조 오류는 build 전에 탐지한다. 오류 입력은 파일 쓰기와 FreeCAD 호출 이전에 거부한다.
- C3. 런타임 유효성 관측이 없으면 `geometry.valid_shape`는 `null`이며, 양의 부피·면 개수만으로 true로 바꾸지 않는다.
- C4. 지원 범위 안의 동일 설계는 프로젝트 이름을 바꿔도 동일한 STEP 구멍 검사 항목과 판정을 낸다. 출력 경로나 표시 이름이 다른 것은 허용한다.
- C5. 필수 구멍 직경/중심이 틀린 경우, 또는 일대일 대응을 확정하지 못한 경우 PASS로 처리하지 않는다.
- C6. 실제 값은 생성 형상 또는 재불러온 STEP의 관측값에서만 읽는다. 요구사항 숫자를 actual에 복사하지 않는다.
- C7. 고정된 요구사항과 결과물의 연결을 검사한다. 새 모델에 오래된 도면/quality를 섞어도 단순 파일 존재만으로 통과하지 않는다.
- C8. 비교에 필요한 명시적 ID·단위·버전 연결이 부족하면 기존 `unable_to_determine` 등을 유지한다. CAD 면 인덱스(face_index)를 설계 버전 사이의 안정 ID로 승격하지 않는다.

### 2.2 호환성과 범위 기준

- C9. canonical package 5개의 파일 바이트와 기존 readiness 상태는 바뀌지 않는다.
- C10. 기존 명령, 경로, output-manifest/artifact-manifest, AI 응답 및 스트리밍 계약을 보존한다. 명시한 오류 수정으로 달라지는 진단은 테스트와 결과 문서에 기록한다.
- C11. 기본 명령의 경고 친화적 종료 동작은 유지한다. 기존 `--strict-quality`에서만 품질 실패에 따른 비정상 종료를 적용한다.
- C12. 런타임이 없으면 실제 CAD 검증은 `NOT_RUN`으로 보고한다. mock 기반 검사 PASS를 FreeCAD PASS로 부르지 않는다.
- C13. real inspection evidence·사람 UAT·제조 승인·제품 출시 승인을 생성하거나 대행하지 않는다.
- C14. 과거 제출물, 기존 태그/릴리스, Draft PR 및 기존 worktree는 보존한다.

---

## 3. 실행 권한과 금지선

이 문서를 Codex에 실행하도록 전달한 작업에서는 별도 clean worktree 안의 지정 범위 코드·테스트·문서 수정, 잠금 파일에 따른 의존성 설치, 로컬 테스트, 작은 로컬 커밋을 수행한다. 세부 함수명·테스트 배치 같은 되돌릴 수 있는 결정은 Codex가 이 문서의 기준으로 결정하고 진행한다.

다음 작업은 범위에 없다: push, PR 생성/수정/병합, release/배포, branch protection 변경, 강제 reset/rebase, dirty worktree의 변경 이동, 비밀키 읽기/복사/출력, 실제 AI API 호출, 외부 자료 업로드, canonical package 재생성, 실제 검사 evidence 부착, readiness 승격, 사람 승인 기록 작성.

앱/운영체제/조직의 권한 승인 창을 우회하지 않는다. 기존 task-specific 금지선과 겹치면 그 작업만 멈추고 충돌을 보고한다. 이 계획을 이유로 `AGENTS.md`의 안전 제약을 제거하지 않는다.

**작업 순서:** Task 0 → 1 → 2 → 3 → 4 → 5. 병렬로 같은 파일을 편집하지 않는다. 코드 재작성이나 추가 질문만 반복하지 말고, 진행 가능한 범위를 실제로 완성한다.

---

## Task 0 — 기준선 고정과 비파괴 작업공간

**Read:** `AGENTS.md`, 관련 `docs/exec-plans/`, `package.json`, `tests/lane-manifest.js`, `docs/product-workflows.md`, `docs/command-lifecycle.md`.

**Write:** 이 계획 파일과 `tmp/codex/engineering-core-refocus-status.md`. 기존 task 상태 파일을 덮어쓰지 않는다.

- [ ] 아래 명령으로 저장소 identity, 기존 변경, checkout, origin을 확인한다. origin URL에 인증정보가 있다면 출력에 노출하지 않는다.

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git worktree list --porcelain
# origin은 원문을 출력하지 않고 URL에서 인증정보를 제거한 host/owner/repo만 확인한다.
```

- [ ] 올바른 `dooosp/freecad-automation`이며 repository-local 지침과 일치하는지 확인한다. 이미 적절한 isolated worktree라면 다시 worktree를 만들지 않는다.
- [ ] 선택한 시작 커밋의 SHA를 `BASE_SHA`로 기록한다. 이후 최종 검토는 깨끗한 working tree만 보는 것이 아니라 이 기준점부터 누적된 모든 변경을 대상으로 한다.
- [ ] `master`의 최신 안전한 기준점을 확인하되 원본 working tree를 checkout/reset/stash하지 않는다. 네트워크가 허용되면 `git fetch origin master`로 remote-tracking ref만 갱신한다. 불가능하면 확인 가능한 ref와 한계를 기록한다.
- [ ] 조사 SHA와 현재 기준점이 다르면 대상 파일의 차이를 읽고 이미 구현된 항목을 생략한다. 오래된 파일을 덮어써서 이 계획에 맞추지 않는다. 계보나 저장소 identity가 불명확하면 구현하지 않는다.
- [ ] 새 작업 브랜치는 `codex/engineering-core-refocus-v1`로 한다. 이미 사용 중이면 안전한 숫자 suffix를 사용한다. 원본 worktree와 PR #199/#201의 브랜치를 수정하거나 cherry-pick하지 않는다.
- [ ] `docs/examples/`의 tracked 파일별 SHA-256을 `tmp/codex/`에 기록한다. 이 기록은 임시 비변경 확인용이며 새 제품 manifest가 아니다.
- [ ] `npm ci` 후 기준선 검사를 수행한다. 기존 실패·환경 오류·도메인상 예상 실패를 구분한다. 기존 실패를 없애려고 무관한 코드를 수정하지 않는다.

```bash
npm ci
node bin/fcad.js check-runtime
npm run check:source-hygiene
npm run test:node:contract
npm run test:node:integration
npm run test:snapshots
npm run test:py
```

`check-runtime` 실패는 실제 런타임 시험을 막을 뿐, 결정적 코드의 수정·단위 테스트까지 무조건 막지는 않는다. 출력 디렉터리를 건드리는 명령은 실행 전 계약을 읽고 작업공간의 ignored `output/` 또는 `tmp/codex/`에만 결과를 쓴다.

**완료 조건:** 저장소/기준 SHA/작업 브랜치/dirty 상태/기준선 검사 상태/런타임 여부를 확인했고 보호 파일 목록을 확보했다.

---

## Task 1 — AI 어댑터 축소와 결정적 설정 검증 분리

**Create:** `lib/cad-config-validation.js`, `tests/cad-config-validation.test.js`, `tests/design-core-boundary.test.js`.

**Modify:** `scripts/design-reviewer.js`, `src/services/design/design-service.js`, `tests/lane-manifest.js`.

**Reuse, 원칙적으로 수정하지 않음:** `lib/config-schema.js`, `lib/config-canonical-schema.js`, `src/services/model/create-service.js`, `src/services/design/openai-responses-client.js`.

**Interfaces:**

```text
validateCadToml(tomlText: string)
  -> { valid: boolean, errors: string[], config: object | null }

기존 validateTomlStructure(tomlStr)의 export는 호환 facade로 유지한다.
createDesignService(...)에는 테스트 가능한 createModelFn 의존성을 추가한다.
기본 createModelFn은 기존 model/create-service.js의 createModel이다.
```

### Step 1 — 기존 계약을 먼저 고정

- [ ] `tests/design-reviewer-validation.test.js`와 design 서비스 호출자/스트리밍 소비자를 검색한다. 정상 입력·오류 처리·응답 shape를 기록한다.

```bash
rg -n 'validateTomlStructure|createDesignService|runDesignTask|designFromText|reviewToml' src scripts tests
node tests/design-reviewer-validation.test.js
node tests/openai-responses-client.test.js
```

- [ ] 아래 단위 검사를 `tests/cad-config-validation.test.js`에 작성한다. 이 단계의 초기 실패는 아직 새 모듈이 없다는 오류여야 한다. 생성 코드를 작성한 뒤에도 일부러 잘못된 입력을 받는 검사가 실제로 남아야 한다.

```javascript
import assert from 'node:assert/strict';
import { validateCadToml } from '../lib/cad-config-validation.js';

const valid = `config_version = 1
name = "external_candidate"
[[shapes]]
id = "plate"
type = "box"
length = 40
width = 20
height = 4
[export]
formats = ["step"]
directory = "output"
`;
assert.equal(validateCadToml(valid).valid, true);
assert.equal(validateCadToml('name = [').valid, false);
assert.equal(validateCadToml(valid.replace('length = 40', 'length = "forty"')).valid, false);
assert.equal(validateCadToml(valid.replace('type = "box"', 'type = "unsupported_magic_shape"')).valid, false);
assert.equal(validateCadToml(valid + '\n[[operations]]\nop = "cut"\nbase = "plate"\ntool = "missing_hole"\nresult = "final"\n').valid, false);
console.log('cad config validation passed');
```

### Step 2 — 중복을 늘리지 않는 이동

- [ ] `parseConfigText`와 `validateConfigDocument`를 재사용해 canonical schema 진단을 얻는다. AI용 새 JSON schema를 만들지 않는다.
- [ ] 기존 shape/operation 허용 목록과 형상 참조 의미 검사는 `cad-config-validation.js`로 이동한다. canonical schema 검사를 그대로 또 작성하지 않는다. canonical schema에 없는 실행 의미 검사만 이 모듈이 담당한다.
- [ ] 기존 단일 부품/조립 모드, canonical `op`와 허용된 legacy 표현, 정상 example 계약은 보존한다. 정상 입력의 반환 config 의미를 characterization test와 비교한다. 기존 함수의 반환 shape는 유지한다.
- [ ] `scripts/design-reviewer.js`는 이 결정적 모듈을 호출하고 기존 이름을 재수출한다. 결정적 모듈은 AI client를 import하거나 환경 파일을 읽지 않는다.
- [ ] build에서 검증 실패 시 디렉터리 생성·TOML 쓰기·`loadConfig`·FreeCAD 호출을 하지 않는다. 정상 build는 기존 `createModel` 서비스로 위임하고 기존 응답 필드를 유지한다.

### Step 3 — AI 역할 축소

- [ ] 긴 프롬프트의 범용 기계설계 강의와 근거 없는 고정 숫자 판정 규칙을 줄인다. 저장소가 지원하는 입력 형식, 사용자 요구 보존, 가정 명시, 후보 출력이라는 범위만 남긴다.
- [ ] “AI가 검토했음”을 실제 clearance 측정, shape validity, 제조 준비 완료로 해석하지 않도록 조언임을 표시한다. 기존 응답 구조를 깨는 새 최상위 상태 체계를 만들지 않는다.
- [ ] 명시하지 않은 공차·재료·부하를 검증된 사실로 확정하지 않는다. 콘셉트에 필요한 가정을 사용하는 경우 설명/기존 report 필드에 가정임을 표시한다.
- [ ] 기존 API 키 보호, 요청 제한, timeout, 명시적 live-request 허가를 보존한다. 실제 API 호출은 하지 않는다. 새로운 provider framework나 자동 승인 에이전트를 만들지 않는다.

### Step 4 — 서비스 경계 테스트

`tests/design-core-boundary.test.js`에서 아래 입력·관측을 검사한다. 이는 mock 기반 프로그램 테스트이며 FreeCAD 검증이 아니다.

| 사례 | 주입/입력 | 요구 관측 |
|---|---|---|
| 오류 TOML | `name = [` | reject, mkdir/write/load/create 호출 수 모두 0 |
| 없는 tool 참조 | Task 1의 missing_hole 입력 | reject, FreeCAD 호출 수 0 |
| 정상 build | 외부에서 작성한 valid TOML | createModelFn 1회, AI design/review 함수 0회 |
| 이전 응답 계약 | 정상 build의 fake 반환값 | 기존 result 필드와 상대 configPath 유지 |
| AI 모듈 비의존 | AI 함수는 호출 시 즉시 throw | build·결정적 검사가 정상 완료 |
| 기존 AI 호출 모드 | stubbed design/review 함수 | 기존 mode·응답·오류 처리 계약 유지 |

- [ ] 신규 검사를 기존 contract lane에 등록하고 관련 테스트를 실행한다.

```bash
node tests/cad-config-validation.test.js
node tests/design-core-boundary.test.js
node tests/design-reviewer-validation.test.js
node tests/openai-responses-client.test.js
node tests/config-example-parity.test.js
npm run test:node:contract
npm run test:node:integration
git diff --check
```

**완료 조건:** C1/C2/C10 충족. AI 코드에서 빠진 책임과 공통 코드로 이동한 책임을 실제 diff로 설명할 수 있다.

**로컬 커밋 제목:** `refactor: separate optional AI advice from CAD execution core`

---

## Task 2 — 유효성 관측이 없을 때 PASS를 만들지 않기

**Modify:** `lib/create-quality.js`, `tests/create-quality.test.js`.

**Create:** `tests/engineering-core-quality-boundaries.test.js`.

**Reuse:** `schemas/create-quality.schema.json`, `src/services/model/create-quality-service.js`.

### Step 1 — 실제 관측/추론 경계를 실패 검사로 고정

- [ ] 아래 코드 전체를 새 테스트 파일의 출발점으로 사용한다. 모든 geometry는 명시적인 **합성 단위 테스트 입력**이다. 실물 측정이나 runtime 결과라고 기록하지 않는다.

```javascript
import assert from 'node:assert/strict';
import {
  buildCreateQualityReport,
  validateCreateQualityReport,
} from '../lib/create-quality.js';

function config(name = 'arbitrary_part_name') {
  return {
    config_version: 1,
    name,
    shapes: [
      { id: 'plate', type: 'box', length: 40, width: 20, height: 4 },
      { id: 'hole', type: 'cylinder', radius: 3, height: 8, position: [10, 10, -2] },
    ],
    operations: [{ op: 'cut', base: 'plate', tool: 'hole', result: 'final' }],
    drawing_intent: {
      required_dimensions: [{
        id: 'HOLE_DIA', feature: 'hole', dimension_type: 'diameter',
        value_mm: 6, tolerance_mm: 0.05,
        expected_center_xy_mm: [10, 10], center_tolerance_mm: 0.2,
        required: true,
      }],
    },
  };
}

function geometry(overrides = {}) {
  return {
    valid_shape: true, volume: 3000, area: 1700,
    solid_count: 1, face_count: 7, edge_count: 15,
    bbox: { min: [0, 0, 0], max: [40, 20, 4], size: [40, 20, 4] },
    cylindrical_faces: [{
      face_index: 7, surface_type: 'Cylinder', radius_mm: 3, diameter_mm: 6,
      center_mm: [10, 10, 0], center_of_mass_mm: [10, 10, 2], axis: [0, 0, 1],
      bbox: { min: [7, 7, 0], max: [13, 13, 4], size: [6, 6, 4] },
      area_mm2: 75,
    }],
    ...overrides,
  };
}

function reportFor({ name = 'arbitrary_part_name', generated, reimported } = {}) {
  return buildCreateQualityReport({
    inputConfigPath: '/tmp/engineering-core-unit.toml',
    config: config(name),
    createResult: {
      model: generated ?? geometry(),
      exports: [{ format: 'step', path: '/tmp/engineering-core-unit.step', size_bytes: 1000 }],
    },
    inspections: { step: { success: true, model: reimported ?? geometry() } },
    runtimeAvailable: true,
  });
}

const missingValidity = geometry();
delete missingValidity.valid_shape;
const unknown = reportFor({ generated: missingValidity });
assert.equal(unknown.geometry.valid_shape, null);
assert.notEqual(unknown.status, 'pass');
assert.equal(validateCreateQualityReport(unknown).ok, true);

const explicitInvalid = reportFor({ generated: geometry({ valid_shape: false }) });
assert.equal(explicitInvalid.geometry.valid_shape, false);
assert.notEqual(explicitInvalid.status, 'pass');

console.log('engineering core validity boundaries passed');
```

- [ ] `node tests/engineering-core-quality-boundaries.test.js`를 실행한다. 초기 실패가 `valid_shape`가 null 대신 true로 추론되는 현상을 실제로 드러내는지 확인한다.

### Step 2 — 필요한 범위만 수정

- [ ] `coerceGeometry`에서 부피·면 개수로 `valid_shape`를 true로 추정하는 경로를 제거한다. 명시적 boolean만 관측값으로 인정하며 없으면 null이다.
- [ ] 기존 `valid_shape`/`validShape` 호환 alias는 보존하되 숫자·문자열을 true로 변환하지 않는다. 명시적 false를 덮어쓰지 않는다.
- [ ] 런타임을 실행했다고 선언된 검증에서 필수 shape validity가 관측되지 않은 경우 전체 PASS가 되지 않도록 한다. 메시지는 “형상이 잘못됐다”가 아니라 “유효성을 확인할 관측값이 없다”여야 한다.
- [ ] 필수 검증이 미완료이면 기존 quality 집계에서 blocking issue로 표현한다. 기본 CLI 종료 동작은 유지하며 strict-quality에서만 실패 종료한다. 런타임 미설치로 원래 skip하는 경로는 계속 명시적인 skipped/fallback으로 유지한다.
- [ ] `collectGeometryIssues`, `evaluateRoundtrip`, 집계와 schema의 null 허용을 함께 확인한다. shape validity가 null인데 다른 집계가 PASS로 덮어쓰는 우회 경로를 남기지 않는다.
- [ ] 실제 런타임 metadata가 validity를 제공하지 않는 것이 원인이면 해당 producer를 먼저 읽고 실제 FreeCAD 관측을 전달하는 작은 수정만 한다. 새 프레임워크를 만들거나 관측값을 추정해서 채우지 않는다.

### Step 3 — 경계·회귀 검사

| 추가 검사 | 기대 결과 |
|---|---|
| validity 없음 + 양의 volume/face_count | null, 전체 PASS 금지 |
| validity 명시적 false | false 유지, 실패 설명 유지 |
| validity 문자열 `"true"` | boolean true로 해석하지 않음 |
| STEP 재검사 validity 없음 | 재검사 PASS 금지 |
| 런타임 unavailable | 실제 검증 완료라고 표시하지 않음, 기존 fallback 보존 |
| 정상 명시적 validity | 기존 정상 케이스 유지 |

```bash
node tests/engineering-core-quality-boundaries.test.js
node tests/create-quality.test.js
node tests/quality-fixture-matrix.test.js
npm run test:node:contract
git diff --check
```

**완료 조건:** C3/C6/C11/C12 충족. 기존 fixture에 관측 필드가 빠져 있었다면 해당 합성 테스트에서 명시적으로 추가하며 실제 historical artifact는 변경하지 않는다.

**로컬 커밋 제목:** `fix: require observed geometry validity for quality passes`

---

## Task 3 — 예제 이름 대신 측정 가능성으로 STEP 구멍 검사

**Modify:** `lib/create-quality.js`, `tests/engineering-core-quality-boundaries.test.js`, `tests/create-quality.test.js`.

**필요한 작은 전달 수정만 허용:** `src/services/model/create-quality-service.js`. 추가 런타임 metadata가 꼭 필요하면 기존 inspect producer를 먼저 찾아 읽고 범위를 기록한다.

### Step 1 — 이름 불변성 실패 검사

- [ ] Task 2 테스트 파일 끝에 다음 검사를 추가한다. 이 검사의 초기 실패는 임의 이름의 입력에 STEP 검사 행이 생성되지 않는 것이어야 한다.

```javascript
const renamed = reportFor({ name: 'external_design_731' });
const stepRows = renamed.engineering_quality.measurements.filter(
  (row) => row.validation_kind === 'reimported_step_geometry_check'
);
assert.ok(stepRows.length > 0, 'supported geometry must be checked independently of config.name');
assert.ok(stepRows.every((row) => row.source === 'reimported_step_geometry'));

const changedStep = geometry();
changedStep.cylindrical_faces[0] = {
  ...changedStep.cylindrical_faces[0], radius_mm: 4, diameter_mm: 8,
};
const wrongDiameter = reportFor({ name: 'external_design_731', reimported: changedStep });
assert.ok(wrongDiameter.engineering_quality.measurements.some(
  (row) => row.validation_kind === 'reimported_step_geometry_check'
    && row.measurement_type === 'hole_diameter' && row.status === 'fail'
));
assert.notEqual(wrongDiameter.status, 'pass');
```

### Step 2 — 지원 범위를 좁고 명시적으로 유지

- [ ] `STEP_REIMPORT_HOLE_GEOMETRY_FIXTURE_NAME_PREFIXES`와 이름 기반 gate를 제거한다. 검사 허용 여부는 입력 구조, 명시적 요구사항, 실제 reimport 관측으로 판단한다.
- [ ] 첫 지원 범위는 **단일 부품의 명시적 Z축 원통 절삭과 직경·XY 중심 요구사항**이다. 우선 단순 평판 형상으로 증명한다. 이름이 임의적이어도 지원 조건이 같으면 검사한다.
- [ ] 복잡한 assembly transform, 경사 구멍, 불명확한 cylinder 면 대응, 임의 STEP 역설계까지 지원한다고 주장하지 않는다. 해당 조건은 기존 `unavailable`/`missing`과 구체적인 이유로 표현한다.
- [ ] 필수 요구사항마다 generated shape 측정과 STEP reimport 측정을 별도 행으로 유지한다. actual은 재검사 geometry에서만 읽고 expected와 분리한다.
- [ ] 직경이 비슷하다는 이유만으로 축·위치가 다른 cylinder를 확정하지 않는다. 하나의 실제 face를 서로 다른 구멍 요구사항에 중복 배정해 둘 다 PASS시키지 않는다.
- [ ] 대응 후보가 여러 개라 유일하게 정할 수 없으면 unavailable로 남긴다. 동일 구멍의 분할 면을 안전하게 묶는 처리가 아직 없으면 지원 한계로 밝힌다. 억지 매칭은 금지한다.
- [ ] 생성 geometry와 STEP geometry 사이에서 face_index가 같아야 한다는 가정을 두지 않는다. face_index는 그 실행 안의 관측 출처에만 사용한다.
- [ ] 허용 오차의 음수·비유한 수나 좌표·축 누락은 통과시키지 않는다. 입력 검증 오류 또는 unavailable로 처리하고 기존 의미를 document/test에 명시한다.

### Step 3 — 필수 오류 주입 검사

| 사례 | 입력 변경 | 합격 기준 |
|---|---|---|
| 모델 이름만 변경 | config.name만 교체 | 검사 항목과 의미상 판정 동일 |
| 직경 오류 | 요구 6mm 유지, 실제 STEP 8mm | 직경 fail, 전체 PASS 금지 |
| 중심 오류 | 요구 [10,10] 유지, 관측 [12,10] | 중심 fail 또는 대응 불가, PASS 금지 |
| 면 누락 | cylindrical_faces 비움 | unavailable/missing, PASS 금지 |
| 동일 면 중복 사용 | 서로 다른 두 feature가 같은 face를 소비 | 두 요구를 모두 PASS시키지 않음 |
| 모호한 후보 | 같은 대응 조건의 후보 두 개 | unavailable, 임의 선택 금지 |
| 축이 다름 | 실제 axis [1,0,0] | Z축 검사로 PASS 금지 |
| STEP만 틀림 | generated 정상, STEP 치수 오류 | STEP의 별도 검사 행에서 탐지 |
| actual 출처 | expected와 actual 의도적 불일치 | actual에 expected 복사 금지 |
| 변경 허용오차 초과 | tolerance를 유지하고 실제 값만 변경 | threshold 변경 없이 탐지 |

기존 테스트가 이미 해당 경계를 정확히 보장하면 재사용한다. 중복 테스트 파일이나 새로운 상태 이름을 늘리지 않는다.

```bash
node tests/engineering-core-quality-boundaries.test.js
node tests/create-quality.test.js
node tests/quality-fixture-matrix.test.js
npm run test:node:contract
npm run test:node:integration
git diff --check
```

**완료 조건:** C4/C5/C6 충족. 이름 기반 특례가 사라지고, 지원 범위와 미지원 이유를 설명할 수 있다. 지원을 늘렸다는 주장은 실제 런타임 시험 이후에만 한다.

**로컬 커밋 제목:** `feat: check supported STEP hole geometry without fixture-name gates`

---

## Task 4 — 대표 부품 3개와 변경 1회씩으로 실제 경로 증명

**Read/reuse:**

- `configs/examples/quality_pass_bracket.toml`
- `docs/examples/plate-with-holes/config.toml`
- `docs/examples/hinge-block/config.toml`
- `docs/drawing-quality-v1.md`
- `docs/revision-impact-and-reinspection.md`
- `tests/create-quality.test.js`
- `tests/revision-impact-service.test.js`
- `tests/revision-impact-fixture-matrix.test.js`
- `tests/revision-lineage-revision-impact.test.js`
- `tests/lane-manifest.js`

**Create:** `tests/engineering-core-workflow-regression.test.js`와 `tests/engineering-core-runtime.test.js`. 새 제품 명령·public schema·두 번째 manifest를 추가하지 않는다.

**Generated outputs:** `output/engineering-core-refocus/` 아래에만 둔다. 원본 canonical package나 config는 수정하지 않는다. 특히 hinge-block 원본의 `export.directory`는 canonical CAD 폴더를 가리키므로, 복사만 하고 실행하는 것은 금지한다.

### Step 1 — 정답과 지원 범위 먼저 고정

- [ ] 각 입력을 ignored 작업 디렉터리에 복사한다. **어떤 실행보다 먼저 복사본의 `export.directory`와 관련 출력 설정을 해당 A/B별 `output/engineering-core-refocus/` 하위로 바꾸고, 해석한 최종 경로가 canonical 폴더를 가리키지 않는지 검사한다.** baseline A의 의도·치수·안정 ID를 테스트 oracle로 고정한다.
- [ ] plate/hinge의 원래 `product.revision = "A"`는 B 복사본에서만 `"B"`로 바꾼다. bracket처럼 revision 필드가 원본에 없는 경우, fixture에서 시험용 part/revision identity를 A/B 생성 전에 명시적으로 선언하고 synthetic test identity임을 결과에 기록한다. 원본 패키지에 실제 revision이 있었다고 소급 주장하지 않는다.
- [ ] 구현이 측정한 숫자를 읽어 정답을 역으로 생성하지 않는다. oracle은 테스트 전에 원본 입력의 명시적 요구사항으로 정한다.
- [ ] 총 6개 생성 사례를 만든다: 부품 3종 × A/B. geometry error injection은 아래와 별도 음성 검사다.

| 부품 | A | B의 허용된 설계 변경 | 검증 범위 |
|---|---|---|---|
| quality-pass-bracket | 원본 6mm 왼쪽 구멍 | 왼쪽 구멍 7mm로 변경하고 해당 명시적 요구값과 도면 intent를 함께 7mm로 변경 | 형상·STEP 구멍 검사, 도면 요구, 명시적 변경 영향 |
| plate-with-holes | 원본의 4mm 장착 구멍 4개 | `hole1`~`hole4` radius를 모두 2→2.5mm, `MOUNTING_HOLE_DIA`와 도면 `HOLE_DIA` 값을 4→5mm | 그룹 요구사항을 네 실제 구멍과 각각 연결, 도면/변경 연결 |
| hinge-block | 원본의 6mm 바닥 장착 구멍 2개 | `mount_hole_left/right` radius를 3→3.5mm, `MOUNTING_HOLE_DIA`의 두 intent와 `quality.critical_dimensions[id=cd-02].target_mm`을 6→7mm | Z축 장착 구멍은 검사하고, 그대로 둔 Y축 hinge-pin 구멍은 미지원 경계를 검증 |

위 변경은 기계적 요구값과 같은 의미를 반복한 도면 설명도 작업 복사본에서만 일치시킨다. feature/requirement ID는 바꾸지 않는다. plate의 그룹 요구 한 개를 네 구멍 중 하나만 수정하는 식으로 처리하지 않는다.

힌지의 `hinge_pin_left/right`는 `direction = [0, 1, 0]`인 반면 바닥 장착 구멍은 Z축이다. 이번 지원 범위에서는 필수 Y축 구멍이 미확인으로 남을 수 있으므로, 이 사례는 **지원/미지원 혼합 입력을 정직하게 보고하는 시험**이다. 모든 필수 항목이 확인되지 않았는데 전체 품질 PASS로 만들지 않는다. 예상한 미지원 보고를 올바르게 했다는 테스트 PASS와 부품 전체 검증 PASS는 다르게 집계한다.

실행 시점의 입력에 해당 변경을 안전하게 적용할 명시적 feature/requirement 연결이 없다면 그 사례는 `UNSUPPORTED`로 기록한다. 무관한 치수로 몰래 대체하거나 전체 성공 수에 포함하지 않는다. 이 경우 `quality-pass-bracket`의 독립 복사본으로 추가 테스트를 수행할 수 있으나 이를 다른 부품 검증으로 세지 않는다.

### Step 2 — 기존 엔진으로 경로 연결

- [ ] `node bin/fcad.js help create`, `help draw`, `help review-context`, `help compare-rev`로 실행 시점의 정확한 옵션을 읽는다. 숨은 전역 기본 경로에 결과를 쓰지 않는다.
- [ ] create → 실제 output reimport/inspect → draw → review-context → compare-rev를 기존 서비스와 CLI로 실행한다. readiness/pack/canonical regeneration은 수행하지 않는다.
- [ ] 실제 생성·도면·quality의 파일명은 output-manifest에서 읽는다. 추정한 파일 이름이나 이전 실행 파일을 가져오지 않는다.
- [ ] compare-rev에는 A/B의 실제 config와 review-pack을 함께 전달해 요구 변경과 관측 자료를 구분한다. 예시의 고정 generated-at으로 결과 결정성을 비교한다.

```bash
node bin/fcad.js compare-rev \
  output/engineering-core-refocus/bracket/A/review_pack.json \
  output/engineering-core-refocus/bracket/B/review_pack.json \
  --baseline-config output/engineering-core-refocus/bracket/A/config.toml \
  --candidate-config output/engineering-core-refocus/bracket/B/config.toml \
  --out output/engineering-core-refocus/bracket/comparison/revision_comparison.json \
  --impact-out output/engineering-core-refocus/bracket/comparison/revision_impact_report.json \
  --generated-at 2026-09-06T00:00:00Z
```

이 명령의 review_pack/config 경로는 이 테스트가 그 위치에 실제로 생성·기록한 파일에만 사용한다. 기존 출력 contract가 다른 이름을 강제하면 기록된 실제 경로로 호출하며 파일을 있다고 가정하지 않는다.

### Step 3 — 정상 수정과 잘못된 혼합을 모두 검사

- [ ] B의 새 nominal과 해당 feature가 변경 영향에 나타나는지 검사한다. 기존 입력에 실제 evidence가 없으면 가짜 evidence를 만들어 재검사 성공 사례를 꾸미지 않는다.
- [ ] A의 도면/quality를 B의 모델에 잘못 연결하는 negative fixture를 만든다. checksum/revision/linkage가 불일치하거나 판정이 불가능하다고 드러나야 한다. 이 사례를 통과시키기 위해 검증을 완화하지 않는다.
- [ ] 배열의 순서만 바꿔도 명시적 stable ID 기준 비교 결과가 같아야 한다. ID가 사라지거나 단위가 충돌하면 판단 불가로 남아야 한다.
- [ ] generated-at이 같은 반복 실행의 revision-impact JSON/Markdown을 비교한다. CAD/STEP/PDF 자체가 모든 환경에서 바이트 동일하다고 요구하지 않는다. geometry는 미리 정한 수치 기준, deterministic artifact는 명시된 정규화 기준으로 비교한다.
- [ ] 도면의 존재와 요구 의미 일치까지만 자동 검사한 경우, 시각적 레이아웃·제작 적합성까지 검증했다고 보고하지 않는다. 실제 도면을 열어 확인한 경우에만 별도로 기록한다.

### Step 4 — baseline 대 개선본 비교

이번 비교는 **동일 입력에 대한 조사 기준 구현과 개선 구현의 차이**다. 실제 측정하지 않은 “AI 단독보다 몇 배 우수” 주장은 금지한다. 유료 AI 호출이나 새 모델 벤치마크는 이번 범위에서 실행하지 않는다.

| 기록할 항목 | 기록 방법 |
|---|---|
| 실제 실행 범위 | OS, Node/Python/FreeCAD 버전, 코드 SHA, 입력 hash |
| 생성/재불러오기 | 실행 여부, 종료 코드, 관측 산출물 |
| 요구사항 검사 | PASS/FAIL/UNAVAILABLE의 실제 건수 |
| 오류 검출 | 주입한 오류별 탐지 여부와 근거 |
| 잘못된 통과 | 오류 입력이 PASS였는지 |
| 불필요한 차단 | 지원되는 정상 입력을 잘못 차단했는지 |
| 수정 부담 | 실제 수행한 수정 횟수만 기록 |
| 시간 | 실제 측정한 경우만 기록, 미측정이면 null |

새 regression test를 baseline에 적용하는 probe는 별도 임시 작업공간에서 수행한다. baseline 커밋이나 historical evidence는 수정하지 않는다. 양쪽 환경을 맞출 수 없으면 공정한 속도 비교를 하지 않는다.

### Step 5 — 실행과 해석

```bash
node tests/engineering-core-workflow-regression.test.js
node tests/revision-impact-service.test.js
node tests/revision-impact-fixture-matrix.test.js
node tests/revision-lineage-revision-impact.test.js
node bin/fcad.js check-runtime
# 다음 두 명령은 실제 FreeCAD runtime이 확인된 로컬 환경에서만 실행한다.
node tests/engineering-core-runtime.test.js
npm run test:runtime-smoke
```

workflow-regression은 mock/fixture로도 실행 가능한 계약 검사다. runtime test는 실제 FreeCAD를 호출하며 hosted fast lane에 넣지 않는다. 런타임이 없으면 후자는 NOT_RUN으로 남기고, 다른 작업을 완료한 뒤 명확한 실행 명령과 차단 원인을 보고한다.

**완료 조건:** C7/C8/C9/C12 충족. 부품별 성공/미지원/실행 불가를 구분한 결과가 있다. 실제 런타임 미실행이면 이 Task의 런타임 부분은 미완료다.

**로컬 커밋 제목:** `test: prove external-design and revision workflows on bounded parts`

---

## Task 5 — 문서·회귀·최종 읽기 전용 검토

**Modify, 필요한 설명만:** `README.md`, `docs/product-workflows.md`, `docs/command-lifecycle.md`, `docs/quality-baseline.md`.

**Create:** `docs/engineering-core-refocus-results.md`.

**Do not modify:** historical canonical artifact, 제출 자료, 다른 프로젝트, Draft UAT 후보.

### Step 1 — 기능 설명을 실제 경계에 맞추기

- [ ] README에 “외부 AI/사람이 작성한 설정을 받아 공통 엔진으로 실행·검사”한다는 경로를 설명한다. `design`이 이미 experimental인 사실을 다시 구현 성과로 계산하지 않는다.
- [ ] “모델 생성 성공 / shape 검증 / 도면 QA / 실제 inspection evidence / 제조 승인”을 구분한다.
- [ ] 새 구멍 검사의 지원 조건과 미지원 조건, shape validity 관측 규칙을 적는다.
- [ ] 기존 manifest를 유일한 명령 목록 원천으로 유지한다. 문서별로 중복된 lifecycle 목록을 만들어 관리하지 않는다.
- [ ] 실제 diff에서 사라진 프롬프트 규칙·중복 Python 호출·중복 검증 책임을 기록한다. 호출자가 남은 파일을 삭제하지 않는다.
- [ ] 기존 결과 문서의 과거 실패·PASS 기록은 소급 변경하지 않는다. 새 SHA의 새 결과를 추가한다.

### Step 2 — 최종 검사

신규 단위/워크플로 테스트를 기존 적절한 lane에 등록하고, 기존 runtime governance를 보존한다. `npm test`의 범위는 package/runner 기준으로 판단하며 모든 검사를 대신한다고 가정하지 않는다.

```bash
npm run check:source-hygiene
npm run test:node:contract
npm run test:node:integration
npm run test:snapshots
npm run test:studio-browser-smoke
npm run test:v1:acceptance
npm run test:py
node tests/canonical-package-integrity.test.js
git diff --check
```

runtime이 확인되면 Task 4의 실제 검사도 최종 코드 SHA에서 다시 수행한다. 스냅샷 갱신 명령을 오류를 숨기는 수단으로 사용하지 않는다. 의도된 변경을 검토한 snapshot만 명시적으로 갱신한다.

### Step 3 — 변경 없는 검토

- [ ] 검토 범위는 `BASE_SHA`부터 현재 결과까지의 모든 누적 변경이다. 단계별 커밋 뒤 working tree가 clean이라는 이유로 빈 `git diff`만 검토하지 않는다.
- [ ] 검토 직전과 직후 `git status --porcelain=v1`, `git diff --name-only "$BASE_SHA"`, `git diff --no-ext-diff --binary "$BASE_SHA"`의 SHA-256, 별도 staged/unstaged 상태와 untracked 신규 파일의 SHA-256을 기록한다. 파일 이름뿐 아니라 내용도 같아야 읽기 전용 검토가 유효하다.
- [ ] 검토자는 현재 diff와 테스트 결과만 근거로 C1~C14를 판정한다. 실제 독립 검토 도구가 없으면 자체 검토라고 명시한다.
- [ ] 검토 중 수정했다면 이전 검토를 재사용하지 말고 관련 테스트와 읽기 전용 검토를 다시 수행한다.
- [ ] 한 가지 문제를 원인 없이 반복 수정하지 않는다. 같은 차단 원인이 반복되면 원인/시도/남은 위험을 적고 그 범위만 중단한다. 무관한 확장을 시작하지 않는다.
- [ ] Task 0의 canonical package SHA-256 목록과 종료 시점을 비교한다. 5개 package의 바이트와 readiness 불변을 확인한다.
- [ ] 브랜치별 작은 local commit만 남긴다. `git add .` 대신 검토한 경로만 stage한다. push/PR/merge는 하지 않는다.

**완료 조건:** 충족한 C항목과 미충족 항목이 분리된 결과 문서가 있고, 실행하지 않은 검사는 NOT_RUN으로 기록돼 있다. runtime이 없거나 기존 실패가 남으면 전체 성공으로 표현하지 않는다.

**로컬 커밋 제목:** `docs: document the bounded engineering core and verified results`

---

## 4. 최종 보고 형식

Codex는 마지막 응답을 다음 순서로 작성한다.

1. 저장소, 기준 SHA, 작업 브랜치, 최종 SHA, working tree 상태.
2. 제거/축소한 AI 책임: 실제 변경 파일과 전후 차이.
3. 유지/강화한 공학 기능: 관측 유효성, 이름 독립 STEP 검사, 외부 설정 경로.
4. 테스트 명령별 결과와 로그 위치: PASS / FAIL / NOT_RUN / 환경 차단 구분.
5. 대표 부품 A/B 6사례의 실제 결과. 미지원 사례를 정상 성공 수에 포함하지 않기.
6. 오류 주입별 탐지 결과와 불필요한 차단 여부.
7. canonical package·readiness·기존 PR·다른 프로젝트의 변경 없음 확인.
8. 남은 한계와 정확한 다음 실행 명령. 확인하지 않은 성능 향상 수치를 쓰지 않기.
9. local commit 수, push/PR/merge/release 상태. 원격 작업은 수행하지 않았다고 명시.

“AI가 못 하는 기능을 만들었다”보다 **“외부에서 생성한 설계의 특정 오류를 실제 실행·관측으로 검출하고, 반복 수정에도 요구사항 연결을 유지했다”**라고 설명할 수 있는 결과를 목표로 한다.

---

## 5. 다음 버전으로 넘기는 항목

사진에서 임의 CAD를 자동 복원하는 모델, 범용 조립 간섭 검사, 범용 BREP 의미 매칭, 공차/재료 자동 승인, 새 FEM solver, SaaS 배포, 여러 모델 공급자, 로봇/비전 통합은 이번 범위에서 구현하지 않는다.

첫 확장은 Task 4에서 드러난 **가장 빈번한 실제 미지원 형상 한 가지**로 정한다. 실행 결과가 없으면 지금 미리 다음 대형 기능을 선정하지 않는다.
