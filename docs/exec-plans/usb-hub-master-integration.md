# USB Hub Master Integration Implementation Plan

> **실행자:** `superpowers:executing-plans`로 아래 체크박스를 순서대로 수행한다. 새 하위 작업이나 에이전트는 만들지 않는다. 이 문서는 계획이며, 실행 권한은 마지막의 한국어 시작 지시문으로 별도로 전달한다.

**Goal:** USB 허브 소프트웨어 시험에서 확인한 도면·Studio·다운로드 개선을 최신 `master`에 작은 검증 가능한 변경으로 통합한다.

**Architecture:** `master`의 Node CLI → Python runner → FreeCAD 구조와 현재 Studio 흐름을 유지한다. 이미 반영된 커밋은 제외하고, 도면 선행 수정은 순서대로 선별 이식하며, 겹치는 UI 코드는 현재 구현에 필요한 변경만 적용한다. 기존 JSON 품질·산출물 계약을 확장하는 범위를 유지한다.

**Tech Stack:** Node ES modules, Python 3.11+, FreeCAD, SVG/TechDraw, 기존 브라우저 JavaScript, Git/GitHub.

**Spec:** 이 문서의 범위·완료 조건과 [AGENTS.md](../../AGENTS.md), 소스 SHA에 고정한 [8개 확장 시험 보고서](https://github.com/dooosp/freecad-automation/blob/25fc0562fb67374ee5d2c4a1a932a4d8cd66bd40/docs/usage-trials/usb-hub-mount-extended-checks.ko.md). [실물 시험 제안](https://github.com/dooosp/freecad-automation/blob/25fc0562fb67374ee5d2c4a1a932a4d8cd66bd40/docs/usage-trials/usb-hub-mount-pilot.ko.md)은 별도 후속 범위다.

작성·확인일: 2026-09-15. 계획 상태: Git 분석, 충돌 예측, 문서 자체 검증 완료. 제품 통합은 미실행.

실행 메모 (2026-09-15): 사용자가 이 계획의 실행을 승인했다. 최초 제안 worktree의 상위 `tmp/codex` 경로가 기존 evidence 분류 규칙에 걸려, 같은 기준 SHA에서 ignored `.codex/` 아래로 worktree를 옮겼다. 해당 검사와 contract/integration/snapshots가 코드 수정 없이 통과했다. 실제 화면에서 Home `#start`와 Console `#console`를 각각 확인했다. 아래 계획 단계와 과거 계획 검증 기록은 실행 결과와 구분하며 최신 진행·검사 결과는 자신의 `tmp/codex/usb-hub-master-integration/`에 기록한다.

## 1. 범위와 보호 조건

- 현재 계획 작업: 읽기 전용 Git/코드/PR 분석, 필요한 fetch, `merge-tree`, 이 문서와 자신의 `tmp/codex/usb-hub-master-integration-plan/` 근거 작성, 문서 검증만 수행했다.
- 이후 실행 작업: 새 통합 worktree, 기준 검사, 선별 이식, 좁은 수정, 회귀 검사, 자체 읽기 전용 검토, 단계별 commit/push, 최종 draft PR까지 진행한다. 실제 merge는 최종 검토 이후 별도 승인 단계다.
- 소스 브랜치 `codex/mega-studio-api-contract-fuzz-audit`는 읽기 전용이다. 원본 소스·브랜치·서버를 변경하거나 rebase/force-push하지 않는다.
- 원본 worktree의 미추적 `docs/superpowers/`는 별도 작업이다. 읽기 전용 존재 확인 외 수정·삭제·이동·커밋·검사 약화를 하지 않는다. 제어 파일은 자신의 repo 안 `tmp/codex/`에 둔다.
- 기존 8765 사용자 서버와 8768 시험 서버, 다른 브라우저 탭은 유지한다. 실행 단계에서 자신의 새 서버·출력·탭만 소유하고 정리한다.
- 실제 브라우저는 해당 세션의 설치된 `browser:control-in-app-browser` 스킬/도구로 조작한다. standalone Playwright/CDP나 Chrome 직접 연결로 우회하지 않는다.
- 라우트, local API 연결, 오류 envelope, 경로 비공개 처리, 작업 상태, 한국어 locale, 현재 초보자/고급 흐름을 보존한다. 새 i18n·manifest 시스템이나 백엔드 재작성은 범위 밖이다.
- `artifact-manifest`/`output-manifest`, strict 옵션에서만 품질 때문에 실패하는 기본 계약, metadata fallback을 유지한다. 생성 산출물은 실측 inspection evidence가 아니다.
- `ks_bracket` 형상/도면 문제, 실물 장착, 새 QA 모델↔주석 연결 기능은 별도 후속이다. 이번 통합을 이유로 함께 고치지 않는다.
- 커밋할 Markdown에는 기기 절대 경로를 넣지 않는다. 원시 근거·머신 경로·전체 로그는 임시 근거에만 기록한다.

## 2. 고정한 Git/PR 근거

| 항목 | 2026-09-15 실제 확인 |
| --- | --- |
| repo | root basename `freecad-automation`, origin `dooosp/freecad-automation` |
| 계획 worktree | 앱이 만든 별도 worktree. `git branch --show-current`가 빈 detached HEAD, 최초 status 깨끗함 |
| 계획 HEAD / 원격 master | `57264a196b2f3ac5272aa8b78f0c35096a7925a0` |
| 소스 로컬/원격 tip | `25fc0562fb67374ee5d2c4a1a932a4d8cd66bd40` |
| 실제 원격 default | `git ls-remote --symref origin HEAD` → `refs/heads/master` |
| merge-base | `2b9c4215eceb23a9d013f48e5e47e8676fbef8ee` |
| 차이 | `git rev-list --left-right --count master...source` → `87 23`; GitHub compare도 diverged, ahead 23 / behind 87 |
| 기존 baseline | `82f7a17e267b448776c52156f6c890e836d5a58e`는 소스 이력에 포함 |
| PR 상태 | 소스 브랜치 열린 PR 없음. [#171](https://github.com/dooosp/freecad-automation/pull/171), [#169](https://github.com/dooosp/freecad-automation/pull/169), [#147](https://github.com/dooosp/freecad-automation/pull/147) 모두 MERGED |
| 환경 | 계획 시 Node `v25.8.0`, npm `11.11.0`, Git `2.53.0`; 실행 시 다시 기록 |

`git fetch --no-tags origin master codex/mega-studio-api-contract-fuzz-audit` 후 remote SHA를 재확인했다. 실행 시 움직인 ref를 이 표의 SHA인 것처럼 취급하지 않는다.

### 명령 출처와 현재 검사 범위

[package.json](../../package.json), [lane manifest](../../tests/lane-manifest.js), [Python 선택기](../../scripts/run-pytest.js), [hosted CI](../../.github/workflows/automation-ci.yml)를 읽었다.

- `npm test` = contract + integration + snapshots. Python, 실제 FreeCAD 전체 검사, 실제 브라우저는 포함하지 않는다.
- 존재하는 명령: `npm run test:node:contract`, `npm run test:node:integration`, `npm run test:snapshots`, `npm run test:py`, `npm run check:runtime`, `npm run test:runtime-smoke`, `npm run test:runtime:full`, `npm run check:source-hygiene`, `npm run serve`.
- 별도 npm build/lint/typecheck 명령은 없다. 존재하지 않는 명령을 성공 조건으로 추가하지 않는다.
- `npm run test:studio-browser-smoke`는 실제 존재하지만 내부에서 Chrome/CDP를 사용한다. 이 세션의 실제 UI 검증은 설치된 browser 도구로 수행한다. 기존 hosted CI의 해당 검사는 그대로 보존하며, 로컬 미실행을 숨기지 않는다.
- 계획 단계에서 실행한 검사는 문서 링크/경로 검사뿐이다. 기준 문서 검사 1 PASS. `npm test`, 전체 Python, FreeCAD, browser smoke의 최신 master 결과는 이번 계획으로 입증하지 않았다.

### PR #171: patch-ID만으로 누락 판정하지 않는 이유

`git cherry -v master source`는 23개 모두 `+`였으나, #171의 실제 커밋은 `6aba423`, `68e5a5a`, `f98d16a`이고 merge commit은 `c9e99859ad862ad036848077bad2cc64d5ee1739`다. PR 본문은 PR #170 이후 master로 restack했다고 기록한다. 이번 확인에서는 두 커밋의 재작성 대응이 확인됐으며, squash 누락이라고 판단하지 않았다.

`git range-diff 2b9c421..32f52f8 aeed086..68e5a5a`로 `1495586 → 6aba423`, `32f52f8 → 68e5a5a`를 대응시켰다. 이어 다음 8개 파일의 Git blob이 소스 `32f52f8`, 반영본 `68e5a5a`, 현재 master에서 **모두 동일**함을 확인했다.

- `src/services/evidence-readiness-audit/evidence-readiness-audit-service.js`
- `src/services/evidence-readiness-audit/pr170-artifact-materializer.js`
- `src/services/evidence-readiness-audit/maintainer-decision-journal-service.js`
- `src/services/jobs/execution/evidence-readiness-handlers.js`
- `src/services/inspection-evidence-intake/stage5b-repo-dirty-paths.js`
- `tests/evidence-readiness-audit.test.js`
- `tests/evidence-artifacts-materialize.test.js`
- `tests/maintainer-decision-journal.test.js`

현재 `bin/fcad.js`와 `src/shared/command-manifest.js`의 audit/journal 등록도 확인했다. #169의 head는 공통 조상이며, #147 head도 소스 조상이고 두 merge commit 모두 master 조상이다. 기존 기능을 다시 이식할 이유가 없다. 실행 시 이 회귀 검사들은 보존 대상이다.

## 3. 23커밋 분류와 이식 원장

표의 SHA는 소스 커밋이다. **선행**은 뒤 수정이 의존하는 미통합 변경, **개선**은 가져올 미통합 변경, **제외**는 현재 제품 통합에서 실행하지 않을 항목이다. 각 행은 이력 포함 여부가 아니라 파일·현재 계약·PR을 함께 판정했다. 단계별 정확한 파일과 검사 명령은 §6에 있다.

| # | 소스 SHA / 내용 | 분류 | 현재 master 근거 / 결정 | 실행 단계 |
| --- | --- | --- | --- | --- |
| 01 | `149558626edebaa6aec78bdc18602767ec648315` audit | 이미 upstream 반영 | #171의 `6aba423`, 핵심 service/handler/tests blob 동일, CLI 등록 존재 | 재이식 없음 |
| 02 | `32f52f8ed73419a77b309cd00c567cbb043c9c7a` journal | 이미 upstream 반영 | #171의 `68e5a5a`, service/test blob 동일. 추가 `f98d16a` hardening도 유지 | 재이식 없음 |
| 03 | `b68ff42959eaabf4b1276c9a8fe82e7292d039e1` missing quality | 개선 | master fallback의 상태 없는 quality가 pass로 귀결되는 분기가 남아 있음. unavailable을 실패 목록에 합치는 UI도 남음 | Q1 |
| 04 | `de174d0406557924545ebcad798af4fac4b84dfd` 비교 한계 | 개선 | schema/revision_diff 파일이 선행 기준과 동일; `comparison_scope` 없음. master revision-impact/lineage와 별개 compare-rev 계약 | Q2 |
| 05 | `7ea9cf9bddcefdb38b24ae48aa8ba06513469021` box 치수 | 선행 | intent compiler는 기준 blob과 동일, 새 test 파일 없음. runtime builder의 length/width/height 사용 | D1 |
| 06 | `17474e00dc202c880df6b9877385b2d31c701342` footprint 축 | 선행 | feature extractor / dim plan 기준 blob 동일. X/Y와 top-view 방향 수정이 #11 전제 | D2 |
| 07 | `9a89cdbfabecfd8e4f95dd6b32368a935f0f4df2` 자동 치수 근거 | 선행 | auto-dimension-coverage 모듈 없음. SVG identity와 값 검증이 #11 전제 | D3 |
| 08 | `3a442809dc41abe464228eb753df14d2853623ea` 재료 | 선행 | drawing-prep/draw-pipeline 기준 blob 동일. material precedence 및 override 순서 보정 필요 | D4 |
| 09 | `6ac8b63f5620a1250d2016328c9c12ba0db2c1b9` 짧은 메모 | 선행 | svg_repair 기준 blob 동일. #11의 wrap 후속과 한 흐름 | D5 |
| 10 | `3f72b8f597040ee3e5200bbe01a622a0e04eb846` plate plan | 선행 | plate template 없음, plan validator 기준 blob 동일. #11은 이 template을 수정 | D6 |
| 11 | `82f7a17e267b448776c52156f6c890e836d5a58e` runtime traceability | 선행 | `_drawing_traceability.py`, `current-traceability.js` 없음. 05~10 위에서 #14/#16이 사용 | D7 |
| 12 | `a8c363d2d6fcbb76e9419f5f7f1113802b2a7293` 실물 trial/handoff | 제외 | 제품 수정 없는 옛 시작 지시문/실물 제안. 현재 master에 문서 없음. 소스 SHA 링크로 후속 보존 | P1에서 링크만 |
| 13 | `b01e2bcd6200ad787f875a4cde0e7d0846047bcf` canvas/status | 선행 | workbench-presentation 없음. master의 새 guided UI와 7파일 충돌 예측. 전체 UI 교체 금지 | U1 |
| 14 | `17920304d8a9ad52b68486cf82fe680618595a89` scale/small holes | 개선 | scale evidence 검사 없음, generation/summary 기준 blob 동일. #11 필요 | D8 |
| 15 | `9b779b7c78bf37f124c00e6c9c599400d233d59d` explicit views/notes | 개선 | compiler 기준 blob 동일; D6~D7의 plan merge 규칙 위에 적용 | D9 |
| 16 | `9722bdc31d40423218675bcaaa322c821fc138d1` preview/tracked 일치 | 개선 | 서버는 부분 plan 재compile/집계 보정 미반영. master AUTO 제거 처리와 충돌하므로 둘 다 유지 | U2 |
| 17 | `6972d17c6d40db4feec2555b76770d4f9ce72094` 이력/입력 undo | 개선 | drawing-history-controller 및 test DOM 없음. 현재 master의 report UI와 결합 | U3 |
| 18 | `49ab7bb9399dda61b728cbd99b6cc9e62ad8709a` draft/stale | 개선 | studio-draft-recovery/state-controller test 없음. #13/#17 필요 | U4 |
| 19 | `4f6a2b598d416040b1ea987713add889b047f5f5` 실패/중복/cancel | 개선 | #18 request 소유권 위의 후속. master cancel/completion 안내 유지 | U5 |
| 20 | `12ebdd40916a00ef8e54390ee27e80b20d49e2cc` download/Korean PDF | 개선 | report 3파일·artifact route가 기준 blob 동일. master artifact actions/Packs 개선과 병합 | A1 |
| 21 | `e0039f2db74dc8bb2a2afa14cc1f5e45b07e0792` assembly/QA | 개선·분할 | assembly modules 없음. scene에는 master의 resolvePartIndex가 추가됨. AUTO/QA 4파일은 D10, UI/schema는 A2, pilot 문서 수정은 제외 | D10/A2 |
| 22 | `56189b5d0440d65f4d3156b3729d7b2c5de60a0d` pending remount | 개선 | source #18~19의 공유 이력 후속이며 master report syncDrawingReference와 결합 필요 | U6 |
| 23 | `25fc0562fb67374ee5d2c4a1a932a4d8cd66bd40` 1~8 보고서 | 개선·문서 | master에 없음. 과거 source 시험임을 표시해 보존하고 제외한 pilot 상대 링크는 SHA 링크로 변경 | P1 |

집계: 이미 반영 2, 선행 8, 개선 12, 제외 1. #21은 세 책임으로 분할한다. #12 제외는 실물 제안의 폐기가 아니라 이번 제품 통합 범위에서의 분리다.

## 4. 겹침·충돌과 통합 방식

공통 조상→master 변경 346파일, 두 중복 커밋 이후 후보 변경 81파일, 교집합 29파일이다. 이 집계에는 나중에 제외할 trial 문서도 포함돼 있다.

| 겹치는 파일·계약 | 보존할 master 구현 / 위험 |
| --- | --- |
| `public/css/studio.css`, `public/js/studio/model-workspace.js`, `workspaces.js` | `4f45f5e` guided 흐름, `b55b711` 결과 동작, `c455978` canonical preview 높이. 이전 고정 canvas CSS를 덮으면 접힌 결과/내비게이션/모바일 크기가 회귀할 수 있음 |
| `public/js/studio/drawing-workspace.js`, `tests/studio-drawing-workspace.test.js` | `aff14be`와 `076657d`의 첫 동작 안내, ready preview→report, `includeDrawing: true`, report 상태·포커스, `syncDrawingReference`. source history/draft 처리가 이를 지우지 않아야 함 |
| `public/js/studio/studio-shell-dom.js`, `studio-shell-core.js`, `studio-shell-workspace.js`, `studio-shell-job-monitor.js`, `renderers.js` | advanced navigation, drawer focus 복귀/trap, completion notice 중복 DOM 방지, 새로운 job/re-entry 상태와 draft 갱신이 함께 유지되어야 함 |
| `public/js/i18n/index.js`, `en.js`, `ko.js`, `tests/browser-i18n.test.js` | `f71feea` locale selector 접근성 이름과 key 기반 nav/copy 유지. source text 번역을 추가할 때 기존 키/aria 이름 손실 금지 |
| `src/server/studio-drawing-config.js`, `tests/studio-drawing-service.test.js` | master는 AUTO에서 `config.drawing.scale`을 삭제. source의 plan.views 동기화와 명시적 UI 설정 우선 규칙을 함께 적용 |
| `public/js/app/scene.js` | master `resolvePartIndex`의 단일 모델/잘못된 index 보호 + source selection/hide/material 복원 결합 |
| `public/js/studio/artifact-actions.js`, `artifacts-workspace.js`, `quality-dashboard.js`, `tests/studio-quality-dashboard.test.js` | master 결과 파일 중심 동작·inspection/revision 상태·readiness hold를 유지하며 unverified 및 다운로드만 보완 |
| `lib/config-canonical-schema.js`, `tests/config-schema-cli.test.js` | master의 OpenAI 비용 보호/AI 설정 계약을 보존하고 assembly rotation의 허용 형식만 넓힘 |
| `README.md`, `tests/af-execution-jobs.test.js`, `tests/d-artifact-schema.test.js` | master compare-rev와 revision-impact를 구분. canonical readiness 재진입 및 immutable input snapshot 검사를 삭제하지 않고 비교 한계 assertion 추가 |
| `tests/lane-manifest.js`, `tests/local-api-server.test.js`, `tests/studio-shell-browser-smoke.test.js` | master의 전체 등록 검사·새 endpoint/flow 검사를 보존하며 source 회귀만 추가 |

위 표의 축약된 파일명은 같은 행의 `public/js/studio/` 또는 `public/js/i18n/` 디렉터리에 속한다. 전체 29경로는 임시 `overlap.json`에 저장했다. 반면 도면 Python/summary/prep, 비교 schema/Python, PDF 및 artifact route의 핵심 17개 파일은 `32f52f8`와 master의 blob이 동일하다. 단순 텍스트 충돌이 적은 이 영역부터 이식한다.

### 실제 merge-tree 예측

```sh
git merge-tree --write-tree 57264a196b2f3ac5272aa8b78f0c35096a7925a0 25fc0562fb67374ee5d2c4a1a932a4d8cd66bd40
git merge-tree --write-tree --merge-base=32f52f8ed73419a77b309cd00c567cbb043c9c7a 57264a196b2f3ac5272aa8b78f0c35096a7925a0 25fc0562fb67374ee5d2c4a1a932a4d8cd66bd40
```

첫 명령은 exit 1, **21파일 content conflict**. 두 번째는 중복 audit/journal 이후의 후보 변화만 보는 분석용 기준이며 exit 1, **11파일 content conflict**:

`README.md`, `public/css/studio.css`, `public/js/app/scene.js`, `public/js/i18n/ko.js`, `public/js/studio/drawing-workspace.js`, `public/js/studio/model-workspace.js`, `public/js/studio/studio-shell-dom.js`, `public/js/studio/workspaces.js`, `src/server/studio-drawing-config.js`, `tests/af-execution-jobs.test.js`, `tests/studio-drawing-workspace.test.js`.

각 commit을 부모 기준으로 현재 master에 단독 적용하는 예측도 저장했다. #06/#10/#11/#14/#18 등의 `modify/delete`는 **소스 선행 파일이 아직 master에 없기 때문**이며 master가 실제로 삭제했다는 뜻이 아니다. 이 분석은 순차 적용 성공이나 런타임 호환성을 증명하지 않는다. 실제 인덱스·브랜치·worktree 파일을 합치지는 않았다.

### 결정

**새 master 기반 브랜치에서 선택적 cherry-pick에 해당하는 commit/hunk 이식**을 사용한다. 실제 작업은 test/제품 patch를 분리하고 `git apply --3way --index` 또는 수동 hunk 적용으로 진행한다. 이렇게 하면 검사를 먼저 재현하고, 검증·검토 뒤 새 commit을 만들 수 있다. U 단계와 #21은 현재 master 구조에 맞게 수동 통합한다. 원본 commit SHA는 새 commit 본문에 `Source-Commit:`으로 남긴다.

- 전체 merge: 이미 반영된 audit/journal을 다시 충돌시키고 관계없는 CLI/manifest 충돌을 늘리므로 채택하지 않는다.
- 기존 브랜치 rebase: 오래된 23커밋 재적용과 공유 source 이력 변경을 요구하므로 채택하지 않는다.
- 23개 일괄 cherry-pick: upstream 중복, 선행 누락, 섞인 #21, 최신 UI 손실 위험이 있어 채택하지 않는다.
- conflict가 없더라도 의미 충돌은 검사한다. `--ours`/`--theirs` 일괄 해결이나 소스의 기존 파일 전체 복사는 하지 않는다.

## 5. 실행 준비와 기준 실패 분리

### Task B0 — 새 통합 worktree와 기준 기록

- [ ] 먼저 `pwd`, root, basename, branch, HEAD, status, default, npm scripts, `AGENTS.md`를 기록한다. source 원본 worktree는 `git worktree list --porcelain`에서 그 브랜치 이름으로 식별해 읽기 전용 경계로 기록한다.
- [ ] 위 두 remote ref를 fetch하고 고정 SHA와 비교한다. master/source가 움직였으면 새 SHA의 커밋·겹침·PR 분석을 갱신한 뒤 새 기준으로 진행한다. 이전 SHA의 검사 결과를 새 기준에 재사용하지 않는다.
- [ ] 설치된 worktree 스킬의 native 지원을 우선한다. 이 계획 worktree를 보존해야 하고 native 생성 경로가 없으면 아래와 같이 **자신의 tmp 안**에 fresh worktree를 만든다. 같은 이름/경로가 이미 있으면 덮어쓰지 않고 실제 상태를 확인한다. 아래 명령은 이후 실행 단계 전용이다.

```sh
USB_PLAN_ROOT=$(git rev-parse --show-toplevel)
USB_BASE_SHA=57264a196b2f3ac5272aa8b78f0c35096a7925a0
USB_SOURCE_SHA=25fc0562fb67374ee5d2c4a1a932a4d8cd66bd40
USB_EXEC_ROOT="$USB_PLAN_ROOT/.codex/usb-hub-master-integration/freecad-automation"
git worktree add -b codex/usb-hub-master-integration "$USB_EXEC_ROOT" "$USB_BASE_SHA"
cd "$USB_EXEC_ROOT"
mkdir -p tmp/codex/usb-hub-master-integration/baseline
```

- [ ] lockfile 그대로 `npm ci --ignore-scripts --no-audit --prefer-offline`로 자신의 환경을 준비한다. Node 24 hosted 환경과 로컬 버전을 기록한다. Python은 `node scripts/run-pytest.js`가 Python 3.11+와 pytest 보유 여부를 선택한다. 예전 임시 Python 환경에 직접 `pytest`가 없었던 사실 때문에 그 경로/실행기를 재사용한다고 가정하지 않는다.
- [ ] `node scripts/run-pytest.js --version`으로 선택기 동작을 확인한다. 필요하면 자신의 tmp venv에 의존성을 설치하고 `PYTHON` 및 `PATH`를 그 환경에 맞춘다. `report-decision-pdf.test.js`와 `test_no_plan.py`는 내부에서 `python3`도 호출하므로 runner 하나의 성공만으로 동일 환경이라고 주장하지 않는다. 버전/import 오류는 제품 실패와 구분한다.
- [ ] **제품 파일 수정 전에** 다음 기준 명령 각각의 SHA, argv, 시작/종료, exit, PASS/FAIL/SKIP, 원인, 로그 경로를 `baseline/results.json`에 기록한다. 첫 실패로 상위 suite가 중단되면 미실행 lane도 따로 실행한다. shell의 마지막 `cat` 성공을 검사 exit로 기록하지 않는다.

```sh
npm test
npm run test:py
npm run check:source-hygiene
npm run check:runtime
npm run test:runtime-smoke
node scripts/run-pytest.js -q tests/test_cli_runtime.py tests/test_infotainment_draw_qa_regression.py tests/test_infotainment_hole_dia_regression.py
```

- [ ] §8의 자신의 서버에서 현재 master의 다섯 화면과 guided 모델→도면→보고서 흐름을 기준 캡처한다. runtime unavailable이면 진단을 기록하고 기하 검증을 미검증으로 둔다. 이후 런타임이 복구되면 그 환경에서 기준/통합 결과를 모두 비교한다.
- [ ] 이 문서를 통합 worktree의 같은 문서 경로로 복사하고 문서 검사를 실행한 뒤 계획 commit을 만든다. 임시 근거·기존 원시 산출물은 commit하지 않는다. B0 이전 제품 변경은 없다.

### 실패 판별 규칙

| 관찰 | 처리 |
| --- | --- |
| 같은 기준 SHA/명령/환경에서도 실패 | `baseline_failure`로 보존. 원래 FAIL을 통합 FAIL로 세지 않으며 통합 후 여전히 FAIL이면 숨기지 않음 |
| 기준에는 통과, 변경 후 실패 | 새 회귀. 첫 실패를 가장 작은 기존 test/case로 재현 → 관련 diff/입력/로그 비교 → 해당 단계만 좁게 수정 → 그 검사와 인접 계약 재검증 |
| source에서 새로 추가하는 검사 | 해당 단계에서 test/fixture와 필요한 선행을 먼저 가져와 실패를 확인. import/fixture 미존재를 기능 실패로 세지 않음. upstream에 기능이 있으면 통과 근거를 남겨 제품 변경 no-op |
| 환경/import/runtime 부재 | `environment_blocker` 또는 명시적 skip. 같은 환경에서 기준을 비교하고 안전한 환경 복구 한 번 후 재확인 |
| 원본 보호 문서 때문에 doc 검사 실패 | 원본 문제로 기록. 보호 파일/검사를 변경하지 않음. 이번 clean master 문서 검사 결과와 구분 |
| 기존 readiness provenance 불일치 | PR #176의 `75ebd37` 수정이 현재 master에 있음. 과거 실패를 현재의 알려진 FAIL로 복사하지 말고 `node tests/output-contract-cli.test.js`와 `node tests/standard-docs-readiness-artifact-identity.test.js`로 재확인 |
| `test_no_plan.py`에 입력 SVG 없음 | 입력 의존 skip. 자신의 runtime 도면을 생성한 후 그 파일을 자신의 `output/` 최상위에 한 개 복사해 해당 검사만 재실행. skip을 pass로 세지 않음 |

같은 확인된 blocker가 안전한 복구 1회 뒤에도 남으면 정확한 명령·원인·필요 입력을 보고한다. 그 blocker와 독립적인 계획 범위 작업은 계속한다. 검사 삭제, 기대값 일괄 낮춤, snapshot 무검토 갱신으로 통과시키지 않는다.

## 6. 작은 통합 단계

**모든 단계의 공통 gate** — 각 아래 단계에 적용하며 건너뛰지 않는다.

1. 지정 source commit diff와 현재 파일을 읽고, 아래 계약을 고정한다. 새 source 검사라면 test/fixture와 실제 선행이 준비된 상태에서 재현한다.
2. 수정 범위는 해당 단계의 파일 목록이다. 새 source 파일은 해당 commit에서 가져오고, 기존 파일은 현재 master 위에 필요한 diff를 적용한다. test가 먼저 이미 통과하면 기능 중복을 재평가한다.
3. 아래 명령을 실행한다. FAIL은 원인 재현 → 좁은 수정 → 해당 검사와 인접 master 검사 재실행으로 닫는다. 전체 suite를 매 단계 반복하지 않는다.
4. 읽기 전용 자체 review 직전/직후 `git diff --name-only`, `git diff --cached --name-only`, `git diff HEAD --binary`의 hash와 `git status --porcelain`을 저장한다. review 중 하나라도 바뀌면 그 review는 무효다. 테스트·수정은 freeze 전에 끝낸다.
5. blocker가 없고 diff/검사가 의도한 범위면 명시된 파일만 stage한다. `git diff --cached --check` 후 별도 commit, 본문에 해당 full source SHA와 수정 이유·검증을 남긴다. 자신의 통합 브랜치만 일반 push한다. source branch와 master에는 push하지 않는다.

검사 명령의 대상은 현재 master 또는 명시된 source commit에 존재하는 것을 확인했다. **추가**로 표기한 source test는 B0 baseline에 존재하지 않으며 해당 단계에서 추가한 뒤 실행한다. `tests/lane-manifest.js`는 항상 현재 master의 등록 목록에 추가만 하고, 기존 entry를 누락시키지 않는다.

### Task Q1 — 미실행 품질을 unverified로 표시

**선행:** B0. **출처:** `b68ff42959eaabf4b1276c9a8fe82e7292d039e1`. **방식:** 선별 patch.

**입출력·검증 계약:** 상태 없는 STEP-only/create/drawing 품질을 pass로 추정하지 않는다. not_run/not_available/missing/incomplete의 점수는 null. 필수 미실행 검사는 unavailable 영역에 남긴다.

**보존 조건:** master의 결과 파일 중심 Packs 동작, inspection/readiness hold 및 이미 실패한 품질 상태를 유지한다. source browser-smoke assertions는 보존하되 로컬 브라우저 실행은 §8 방식으로 한다.

**정확한 파일:**

- 수정: `public/js/studio/artifacts-workspace.js`
- 수정: `public/js/studio/quality-dashboard.js`
- 수정: `tests/studio-quality-dashboard.test.js`
- 수정: `tests/studio-shell-browser-smoke.test.js`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary b68ff42959eaabf4b1276c9a8fe82e7292d039e1 -- public/js/studio/artifacts-workspace.js public/js/studio/quality-dashboard.js tests/studio-quality-dashboard.test.js tests/studio-shell-browser-smoke.test.js > tmp/codex/usb-hub-master-integration/Q1.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node tests/studio-quality-dashboard.test.js
node tests/studio-artifact-viewers.test.js
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: b68ff42959eaabf4b1276c9a8fe82e7292d039e1`를 남긴다.

### Task Q2 — compare-rev의 비교 한계와 입력 경고

**선행:** Q1. **출처:** `de174d0406557924545ebcad798af4fac4b84dfd`. **방식:** README/af-execution 충돌 수동 통합.

**입출력·검증 계약:** comparison_scope에 compared_metrics/unavailable_metrics, hole_positions=not_compared, shape_equivalence=not_evaluated를 추가한다. baseline/candidate 경고를 중복 없이 출처와 함께 유지한다. 필드 없는 legacy artifact도 읽을 수 있어야 한다.

**보존 조건:** README의 최신 CLI 안내, af-execution의 canonical readiness 재진입·revision-impact assertions를 보존한다. compare-rev 결과를 shape equivalence로 승격하지 않는다.

**정확한 파일:**

- 수정: `README.md`
- 수정: `schemas/revision_comparison.schema.json`
- 수정: `scripts/reporting/revision_diff.py`
- 수정: `tests/af-execution-jobs.test.js`
- 수정: `tests/d-artifact-schema.test.js`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary de174d0406557924545ebcad798af4fac4b84dfd -- README.md schemas/revision_comparison.schema.json scripts/reporting/revision_diff.py tests/af-execution-jobs.test.js tests/d-artifact-schema.test.js > tmp/codex/usb-hub-master-integration/Q2.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node tests/d-artifact-schema.test.js
node tests/af-execution-jobs.test.js
node tests/revision-impact-contract.test.js
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: de174d0406557924545ebcad798af4fac4b84dfd`를 남긴다.

### Task D1 — box 실제 입력 치수 분류

**선행:** B0. **출처:** `7ea9cf9bddcefdb38b24ae48aa8ba06513469021`. **방식:** 선별 patch.

**입출력·검증 계약:** box builder와 같은 length/width/height를 우선하고 legacy size fallback, 25 mm 경계, cut-tool 제외를 보존한다.

**보존 조건:** 기존 shaft/flange/housing/section 분류를 바꾸지 않는다. 이 시점 test는 source D1 버전을 사용하며 D6의 plate 기대값을 미리 가져오지 않는다.

**정확한 파일:**

- 수정: `scripts/intent_compiler.py`
- 추가: `tests/test_intent_compiler.py`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 7ea9cf9bddcefdb38b24ae48aa8ba06513469021 -- scripts/intent_compiler.py tests/test_intent_compiler.py > tmp/codex/usb-hub-master-integration/D1.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node scripts/run-pytest.js -q tests/test_intent_compiler.py
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 7ea9cf9bddcefdb38b24ae48aa8ba06513469021`를 남긴다.

### Task D2 — 판 외곽 길이·너비와 뷰 축

**선행:** D1. **출처:** `17474e00dc202c880df6b9877385b2d31c701342`. **방식:** 선별 patch.

**입출력·검증 계약:** base_length=X/length, base_width=Y/width를 feature 의미로 읽는다. footprint는 XY 면적 기준이고 top view의 base_width는 수직 치수로 취급한다.

**보존 조건:** 표시 ID WIDTH/BASE_W를 새 이름으로 바꾸지 않으며 다른 feature extractor 규칙을 보존한다.

**정확한 파일:**

- 수정: `scripts/_dim_plan.py`
- 수정: `scripts/feature_extractor.py`
- 수정: `tests/test_intent_compiler.py`
- 추가: `tests/test_plate_dimension_consistency.py`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 17474e00dc202c880df6b9877385b2d31c701342 -- scripts/_dim_plan.py scripts/feature_extractor.py tests/test_intent_compiler.py tests/test_plate_dimension_consistency.py > tmp/codex/usb-hub-master-integration/D2.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node scripts/run-pytest.js -q tests/test_intent_compiler.py tests/test_plate_dimension_consistency.py
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 17474e00dc202c880df6b9877385b2d31c701342`를 남긴다.

### Task D3 — 자동 외곽 치수의 SVG 근거

**선행:** D2. **출처:** `9a89cdbfabecfd8e4f95dd6b32368a935f0f4df2`. **방식:** 선별 patch.

**입출력·검증 계약:** resolveAutoDimensionCoverage(dimensionMap, svgContent)는 실제 SVG label identity, 값, view를 확인한다. 숨김/삭제/바뀐 label과 검증되지 않은 duplicate를 성공 근거로 계산하지 않는다.

**보존 조건:** buildDrawingQualitySummary의 기존 sidecars/reason codes와 explicit strict gate를 유지한다. 새 SVG identity는 도형/표시값을 바꾸지 않아야 한다.

**정확한 파일:**

- 수정: `README.md`
- 수정: `scripts/_drawing_svg.py`
- 추가: `src/services/drawing/auto-dimension-coverage.js`
- 수정: `src/services/drawing/drawing-quality-summary.js`
- 수정: `tests/drawing-quality-summary.test.js`
- 추가: `tests/test_auto_dimension_svg_evidence.py`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 9a89cdbfabecfd8e4f95dd6b32368a935f0f4df2 -- README.md scripts/_drawing_svg.py src/services/drawing/auto-dimension-coverage.js src/services/drawing/drawing-quality-summary.js tests/drawing-quality-summary.test.js tests/test_auto_dimension_svg_evidence.py > tmp/codex/usb-hub-master-integration/D3.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node tests/drawing-quality-summary.test.js
node scripts/run-pytest.js -q tests/test_auto_dimension_svg_evidence.py
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 9a89cdbfabecfd8e4f95dd6b32368a935f0f4df2`를 남긴다.

### Task D4 — 표제란 재료·override 순서

**선행:** D3. **출처:** `3a442809dc41abe464228eb753df14d2853623ea`. **방식:** 선별 patch.

**입출력·검증 계약:** 명시 drawing.meta.material → manufacturing.material → legacy material → UNKNOWN 순서와 override 적용 후 표제란 준비를 맞춘다.

**보존 조건:** 사용자가 지정한 재료, 기존 export 경로/파일명, QA/DFM 설정 및 output manifest를 보존한다.

**정확한 파일:**

- 수정: `src/orchestration/draw-pipeline.js`
- 수정: `src/orchestration/drawing-prep.js`
- 수정: `tests/draw-pipeline-qa-config.test.js`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 3a442809dc41abe464228eb753df14d2853623ea -- src/orchestration/draw-pipeline.js src/orchestration/drawing-prep.js tests/draw-pipeline-qa-config.test.js > tmp/codex/usb-hub-master-integration/D4.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node tests/draw-pipeline-qa-config.test.js
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 3a442809dc41abe464228eb753df14d2853623ea`를 남긴다.

### Task D5 — 짧은 메모 표제란 배치

**선행:** D4. **출처:** `6ac8b63f5620a1250d2016328c9c12ba0db2c1b9`. **방식:** 선별 patch.

**입출력·검증 계약:** 짧은 notes가 표제란 경계를 넘지 않게 한다. source test의 짧은/여러 줄/기존 좌표 사례를 먼저 재현한다.

**보존 조건:** 문구·표제란 geometry·나머지 SVG repair 단계를 보존한다. D7의 긴 단어 wrap 보완이 뒤따른다.

**정확한 파일:**

- 수정: `scripts/svg_repair.py`
- 추가: `tests/test_svg_notes_placement.py`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 6ac8b63f5620a1250d2016328c9c12ba0db2c1b9 -- scripts/svg_repair.py tests/test_svg_notes_placement.py > tmp/codex/usb-hub-master-integration/D5.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node scripts/run-pytest.js -q tests/test_svg_notes_placement.py
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 6ac8b63f5620a1250d2016328c9c12ba0db2c1b9`를 남긴다.

### Task D6 — 평판 전용 계획

**선행:** D5. **출처:** `3f72b8f597040ee3e5200bbe01a622a0e04eb846`. **방식:** 선별 patch.

**입출력·검증 계약:** box+through holes인 평판에 plate template을 선택하고 불필요한 web/BORE/WALL 요구를 만들지 않는다. 명시 part_type/section 조건은 유지한다.

**보존 조건:** 기존 bracket/housing template을 덮지 않는다. docs/config-schema.md의 기존 기본값·validator 계약을 유지한다.

**정확한 파일:**

- 추가: `configs/templates/plate.toml`
- 수정: `docs/config-schema.md`
- 수정: `scripts/intent_compiler.py`
- 수정: `scripts/plan_validator.py`
- 수정: `tests/test_intent_compiler.py`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 3f72b8f597040ee3e5200bbe01a622a0e04eb846 -- configs/templates/plate.toml docs/config-schema.md scripts/intent_compiler.py scripts/plan_validator.py tests/test_intent_compiler.py > tmp/codex/usb-hub-master-integration/D6.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node scripts/run-pytest.js -q tests/test_intent_compiler.py
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 3f72b8f597040ee3e5200bbe01a622a0e04eb846`를 남긴다.

### Task D7 — baseline 82f7a17의 실측 연결·도면 보완

**선행:** D1~D6 모두. **출처:** `82f7a17e267b448776c52156f6c890e836d5a58e`. **방식:** D1~D6 이후 patch; 선행 없는 단독 적용 금지.

**입출력·검증 계약:** link_plate_runtime_dimensions는 runtime bounds/원통 face와 표시 치수를 연결한다. currentTraceability(traceability, dimensionMap, svgContent, autoRepresentations)는 최종 SVG 증거가 사라지거나 바뀌면 feature_id를 null로 만든다. 투영 중복 제거는 실제 같은 위치에만 적용하며 반대쪽 같은 거리·서로 다른 공차·가까운 별도 좌표를 유지한다.

**보존 조건:** 기본 draw는 warning-friendly이며 strict는 기존 gate로만 실패한다. notes wrap/자동 치수 확인을 추가해도 metadata를 기하 실측으로 보고하지 않는다. runtime test skip은 완료 근거가 아니다.

**정확한 파일:**

- 수정: `configs/templates/plate.toml`
- 수정: `docs/config-schema.md`
- 수정: `scripts/_dim_baseline.py`
- 수정: `scripts/_drawing_svg.py`
- 추가: `scripts/_drawing_traceability.py`
- 수정: `scripts/generate_drawing.py`
- 수정: `scripts/intent_compiler.py`
- 수정: `scripts/svg_repair.py`
- 수정: `src/services/drawing/auto-dimension-coverage.js`
- 추가: `src/services/drawing/current-traceability.js`
- 수정: `src/services/drawing/drawing-quality-summary.js`
- 수정: `tests/drawing-quality-summary.test.js`
- 수정: `tests/test_auto_dimension_svg_evidence.py`
- 추가: `tests/test_baseline_dimension_duplicates.py`
- 수정: `tests/test_intent_compiler.py`
- 추가: `tests/test_plate_runtime_traceability.py`
- 수정: `tests/test_svg_notes_placement.py`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 82f7a17e267b448776c52156f6c890e836d5a58e -- configs/templates/plate.toml docs/config-schema.md scripts/_dim_baseline.py scripts/_drawing_svg.py scripts/_drawing_traceability.py scripts/generate_drawing.py scripts/intent_compiler.py scripts/svg_repair.py src/services/drawing/auto-dimension-coverage.js src/services/drawing/current-traceability.js src/services/drawing/drawing-quality-summary.js tests/drawing-quality-summary.test.js tests/test_auto_dimension_svg_evidence.py tests/test_baseline_dimension_duplicates.py tests/test_intent_compiler.py tests/test_plate_runtime_traceability.py tests/test_svg_notes_placement.py > tmp/codex/usb-hub-master-integration/D7.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node tests/drawing-quality-summary.test.js
node scripts/run-pytest.js -q tests/test_auto_dimension_svg_evidence.py tests/test_baseline_dimension_duplicates.py tests/test_intent_compiler.py tests/test_svg_notes_placement.py
node scripts/run-pytest.js -q tests/test_plate_runtime_traceability.py
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 82f7a17e267b448776c52156f6c890e836d5a58e`를 남긴다.

### Task D8 — 실제 축척·작은 구멍 연결

**선행:** D7. **출처:** `17920304d8a9ad52b68486cf82fe680618595a89`. **방식:** 선별 patch.

**입출력·검증 계약:** 실제 SVG 축척과 표제란을 일치시키고 layout_report에 요청/실제/조정 및 explicit_scale_satisfied를 기록한다. 명시 축척 미달은 finding + explicit strict에서 실패. 작은 diameter label identity와 투영 center를 함께 검증한다.

**보존 조건:** AUTO fitting의 정상 조정을 실패로 바꾸지 않는다. 기본 exit와 기존 drawing-quality JSON 필드를 유지한다.

**정확한 파일:**

- 수정: `scripts/_dim_plan.py`
- 수정: `scripts/generate_drawing.py`
- 수정: `src/services/drawing/current-traceability.js`
- 수정: `src/services/drawing/drawing-quality-summary.js`
- 추가: `tests/drawing-scale-evidence.test.js`
- 수정: `tests/lane-manifest.js`
- 추가: `tests/test_drawing_scale_evidence.py`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 17920304d8a9ad52b68486cf82fe680618595a89 -- scripts/_dim_plan.py scripts/generate_drawing.py src/services/drawing/current-traceability.js src/services/drawing/drawing-quality-summary.js tests/drawing-scale-evidence.test.js tests/lane-manifest.js tests/test_drawing_scale_evidence.py > tmp/codex/usb-hub-master-integration/D8.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node tests/drawing-scale-evidence.test.js
node tests/drawing-quality-summary.test.js
node tests/lane-manifest.test.js
node scripts/run-pytest.js -q tests/test_drawing_scale_evidence.py tests/test_plate_dimension_consistency.py
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 17920304d8a9ad52b68486cf82fe680618595a89`를 남긴다.

### Task D9 — 명시한 views·notes와 부분 plan

**선행:** D8. **출처:** `9b779b7c78bf37f124c00e6c9c599400d233d59d`. **방식:** 선별 patch.

**입출력·검증 계약:** 계획 없음/메모만 있음/전체 계획/서로 다른 drawing.views와 drawing_plan.views 네 사례에서 명시 plan 값이 우선하고 빠진 기본값만 채운다. source tests의 명시 dimension/note/view 보존을 확인한다.

**보존 조건:** 부분 plan compile이 사용자 입력을 덮지 않으며 CLI plan 우선순위와 Studio 명시 설정 override를 구분한다.

**정확한 파일:**

- 수정: `scripts/intent_compiler.py`
- 수정: `tests/test_intent_compiler.py`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 9b779b7c78bf37f124c00e6c9c599400d233d59d -- scripts/intent_compiler.py tests/test_intent_compiler.py > tmp/codex/usb-hub-master-integration/D9.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node scripts/run-pytest.js -q tests/test_intent_compiler.py
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 9b779b7c78bf37f124c00e6c9c599400d233d59d`를 남긴다.

### Task D10 — AUTO 토큰·SVG 순서에 독립적인 QA

**선행:** D8~D9. **출처:** `e0039f2db74dc8bb2a2afa14cc1f5e45b07e0792`. **방식:** e0039f2의 아래 4파일만 분리.

**입출력·검증 계약:** is_auto_scale_hint/resolve_drawing_scale에서 auto 문자열을 fitting으로 처리한다. _dimension_values는 자동 치수가 뒤에 있어도 찾아 required presence/value comparison에 포함한다. title/notes/unrelated 숫자는 치수로 세지 않는다.

**보존 조건:** 이식 범위는 기존 QA의 SVG 값 탐색 정확도다. plan 150 + auto 142 동시 표시의 모델/주석 일치 보증 기능은 추가하지 않는다. 기존 runtime 회귀 세 파일의 assertions를 보존한다.

**정확한 파일:**

- 수정: `scripts/generate_drawing.py`
- 수정: `scripts/qa_scorer.py`
- 수정: `tests/test_drawing_scale_evidence.py`
- 수정: `tests/test_qa_signal_quality.py`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary e0039f2db74dc8bb2a2afa14cc1f5e45b07e0792 -- scripts/generate_drawing.py scripts/qa_scorer.py tests/test_drawing_scale_evidence.py tests/test_qa_signal_quality.py > tmp/codex/usb-hub-master-integration/D10.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node scripts/run-pytest.js -q tests/test_drawing_scale_evidence.py tests/test_qa_signal_quality.py
node scripts/run-pytest.js -q tests/test_cli_runtime.py tests/test_infotainment_draw_qa_regression.py tests/test_infotainment_hole_dia_regression.py
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: e0039f2db74dc8bb2a2afa14cc1f5e45b07e0792`를 남긴다.

### Task U1 — 현재 guided UI에 canvas/status 보완

**선행:** Q1, D9. **출처:** `b01e2bcd6200ad787f875a4cde0e7d0846047bcf`. **방식:** 현재 DOM/상태 구조에 수동 이식.

**입출력·검증 계약:** workbench-presentation의 model/drawing summary·badge와 입력 정보 렌더링을 공유하고 preview/build/validation 상태를 일치시킨다. CAD canvas의 사용 너비를 늘리되 접힌 결과와 모바일 레이아웃을 유지한다.

**보존 조건:** master model guided 단계·결과 inspect, canonical preview min-height, advanced drawer/focus/aria, locale key, Drawing report action/후속 포커스를 보존한다. workspaces.js/studio-shell-dom.js/studio.css 전체를 source로 교체하지 않는다.

**정확한 파일:**

- 수정: `public/css/studio.css`
- 수정: `public/js/i18n/index.js`
- 수정: `public/js/i18n/ko.js`
- 수정: `public/js/studio/drawing-workspace.js`
- 수정: `public/js/studio/model-workspace.js`
- 수정: `public/js/studio/renderers.js`
- 수정: `public/js/studio/studio-shell-dom.js`
- 추가: `public/js/studio/workbench-presentation.js`
- 수정: `public/js/studio/workspaces.js`
- 수정: `tests/browser-i18n.test.js`
- 수정: `tests/studio-drawing-workspace.test.js`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary b01e2bcd6200ad787f875a4cde0e7d0846047bcf -- public/css/studio.css public/js/i18n/index.js public/js/i18n/ko.js public/js/studio/drawing-workspace.js public/js/studio/model-workspace.js public/js/studio/renderers.js public/js/studio/studio-shell-dom.js public/js/studio/workbench-presentation.js public/js/studio/workspaces.js tests/browser-i18n.test.js tests/studio-drawing-workspace.test.js > tmp/codex/usb-hub-master-integration/U1.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node tests/studio-drawing-workspace.test.js
node tests/browser-i18n.test.js
node tests/model-guided-flow.test.js
node tests/studio-responsive-css.test.js
node tests/studio-shell-decomposition.test.js
node tests/studio-state.test.js
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: b01e2bcd6200ad787f875a4cde0e7d0846047bcf`를 남긴다.

### Task U2 — preview와 tracked draw의 동일 계획

**선행:** U1, D9~D10. **출처:** `9722bdc31d40423218675bcaaa322c821fc138d1`. **방식:** drawing workspace/config 충돌 수동 통합.

**입출력·검증 계약:** 부분 plan도 compile하고 명시 source 계획/뷰를 유지한다. buildDrawingQaRows(summary)는 plan/auto/total rendered count와 informational conflict를 구분한다. editable_plan은 유효한 양수 dimension이 있어야 true, tracked bridge는 plan_path 존재 계약을 유지한다.

**보존 조건:** applyStudioDrawingSettings의 master AUTO 삭제 처리는 유지하고 plan.views.enabled를 동기화한다. public preview path redaction과 Drawing report action을 유지한다.

**정확한 파일:**

- 수정: `public/js/i18n/ko.js`
- 수정: `public/js/studio/drawing-preview-copy.js`
- 수정: `public/js/studio/drawing-workspace.js`
- 수정: `src/orchestration/drawing-prep.js`
- 수정: `src/server/public-drawing-preview.js`
- 수정: `src/server/studio-drawing-config.js`
- 수정: `src/server/studio-drawing-service.js`
- 수정: `tests/studio-drawing-service.test.js`
- 수정: `tests/studio-drawing-workspace.test.js`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 9722bdc31d40423218675bcaaa322c821fc138d1 -- public/js/i18n/ko.js public/js/studio/drawing-preview-copy.js public/js/studio/drawing-workspace.js src/orchestration/drawing-prep.js src/server/public-drawing-preview.js src/server/studio-drawing-config.js src/server/studio-drawing-service.js tests/studio-drawing-service.test.js tests/studio-drawing-workspace.test.js > tmp/codex/usb-hub-master-integration/U2.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node tests/studio-drawing-service.test.js
node tests/studio-drawing-workspace.test.js
node tests/local-api-studio-drawing.test.js
node tests/drawing-tracked-runs.test.js
node tests/public-path-redaction.test.js
node tests/draw-pipeline-qa-config.test.js
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 9722bdc31d40423218675bcaaa322c821fc138d1`를 남긴다.

### Task U3 — 도면 undo/redo와 입력란 기본 undo

**선행:** U2. **출처:** `6972d17c6d40db4feec2555b76770d4f9ce72094`. **방식:** 선별 patch.

**입출력·검증 계약:** 142→150 edit/undo/Shift+Z, 중간 cursor remount, undo 후 새 edit가 redo branch만 제거하는 경우를 source DOM controller 검사로 재현한다. textarea/input의 Ctrl/Cmd+Z는 도면 undo가 가로채지 않는다.

**보존 조건:** 현재 report action과 입력 포커스, source replacement의 drawing reference 갱신을 유지한다. 이 단계의 source test DOM을 추가한다.

**정확한 파일:**

- 수정: `public/js/app/drawing.js`
- 수정: `public/js/i18n/ko.js`
- 수정: `public/js/studio/drawing-workspace.js`
- 추가: `tests/drawing-history-controller.test.js`
- 추가: `tests/helpers/drawing-test-dom.js`
- 수정: `tests/lane-manifest.js`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 6972d17c6d40db4feec2555b76770d4f9ce72094 -- public/js/app/drawing.js public/js/i18n/ko.js public/js/studio/drawing-workspace.js tests/drawing-history-controller.test.js tests/helpers/drawing-test-dom.js tests/lane-manifest.js > tmp/codex/usb-hub-master-integration/U3.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node tests/drawing-history-controller.test.js
node tests/studio-drawing-workspace.test.js
node tests/browser-i18n.test.js
node tests/lane-manifest.test.js
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 6972d17c6d40db4feec2555b76770d4f9ce72094`를 남긴다.

### Task U4 — 초안·요청 소유권·stale 처리

**선행:** U3. **출처:** `49ab7bb9399dda61b728cbd99b6cc9e62ad8709a`. **방식:** 현재 shared state에 수동 이식.

**입출력·검증 계약:** drawingInputSnapshot(model, settings), isDrawingPreviewStale(drawing, model), STUDIO_DRAFT_KEY=freecad.studio.input-draft.v1 계약을 이식한다. 새로운 source/settings 뒤의 old success/error는 새 결과를 덮지 못한다. 탭 복구는 입력만 복구하며 runtime/job/preview identity를 복구하지 않는다.

**보존 조건:** master guided 상태·source 교체·report handoff를 보존한다. syncDrawingReference와 공유 history 초기화의 소유자를 하나로 정리한다. locale/route remount는 같은 source draft를 유지한다.

**정확한 파일:**

- 수정: `public/js/i18n/ko.js`
- 수정: `public/js/studio/drawing-workspace.js`
- 수정: `public/js/studio/model-workspace.js`
- 추가: `public/js/studio/studio-draft-recovery.js`
- 수정: `public/js/studio/studio-shell-core.js`
- 수정: `public/js/studio/studio-shell-workspace.js`
- 수정: `public/js/studio/workbench-presentation.js`
- 수정: `tests/drawing-history-controller.test.js`
- 수정: `tests/lane-manifest.js`
- 추가: `tests/studio-draft-state-controller.test.js`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 49ab7bb9399dda61b728cbd99b6cc9e62ad8709a -- public/js/i18n/ko.js public/js/studio/drawing-workspace.js public/js/studio/model-workspace.js public/js/studio/studio-draft-recovery.js public/js/studio/studio-shell-core.js public/js/studio/studio-shell-workspace.js public/js/studio/workbench-presentation.js tests/drawing-history-controller.test.js tests/lane-manifest.js tests/studio-draft-state-controller.test.js > tmp/codex/usb-hub-master-integration/U4.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node tests/studio-draft-state-controller.test.js
node tests/drawing-history-controller.test.js
node tests/model-guided-flow.test.js
node tests/import-guided-flow.test.js
node tests/studio-local-first-workflows.test.js
node tests/studio-state.test.js
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 49ab7bb9399dda61b728cbd99b6cc9e62ad8709a`를 남긴다.

### Task U5 — 오류 복구·중복 제출·취소 상태

**선행:** U4. **출처:** `4f6a2b598d416040b1ea987713add889b047f5f5`. **방식:** 현재 model/drawing/job monitor에 수동 이식.

**입출력·검증 계약:** 음수/빈 값/TOML 오류와 통신 실패 뒤 마지막 결과·초안을 보존하고 버튼/lock을 복구한다. 같은 입력의 in-flight 반복은 차단하고 완료 뒤 재실행은 허용한다. 오래된 tracked validation이 새 source lock을 풀지 못하게 한다.

**보존 조건:** master report 제출 잠금에도 같은 source/stale 경계를 검토한다. queued cancel은 성공, running cancel 미지원은 충돌 상태와 계속 추적을 유지하며 FreeCAD를 강제 종료하지 않는다.

**정확한 파일:**

- 수정: `public/js/i18n/ko.js`
- 수정: `public/js/studio/drawing-workspace.js`
- 수정: `public/js/studio/model-workspace.js`
- 수정: `public/js/studio/studio-shell-job-monitor.js`
- 수정: `tests/studio-draft-state-controller.test.js`
- 수정: `tests/studio-job-monitor.test.js`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 4f6a2b598d416040b1ea987713add889b047f5f5 -- public/js/i18n/ko.js public/js/studio/drawing-workspace.js public/js/studio/model-workspace.js public/js/studio/studio-shell-job-monitor.js tests/studio-draft-state-controller.test.js tests/studio-job-monitor.test.js > tmp/codex/usb-hub-master-integration/U5.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node tests/studio-draft-state-controller.test.js
node tests/studio-job-monitor.test.js
node tests/job-queue-controls.test.js
node tests/job-api.test.js
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 4f6a2b598d416040b1ea987713add889b047f5f5`를 남긴다.

### Task U6 — 응답 대기 중 remount 이력

**선행:** U5. **출처:** `56189b5d0440d65f4d3156b3729d7b2c5de60a0d`. **방식:** 공유 이력과 master report lifecycle 결합.

**입출력·검증 계약:** restoreRendererHistory/publishRendererHistory로 공유 이력을 기준으로 삼는다. pending edit/undo/redo 성공·실패 후 현재 mount의 버튼/값/cursor를 갱신하고 새 draft와 replacement source를 덮지 않는다.

**보존 조건:** master syncDrawingReference/report status/focus를 보존한다. #21 이전에 수행하므로 #22의 해당 diff만 가져오며 최종 source test 파일 전체를 덮어쓰지 않는다. 이후 A2의 assembly test는 추가한다.

**정확한 파일:**

- 수정: `public/js/studio/drawing-workspace.js`
- 수정: `tests/studio-draft-state-controller.test.js`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 56189b5d0440d65f4d3156b3729d7b2c5de60a0d -- public/js/studio/drawing-workspace.js tests/studio-draft-state-controller.test.js > tmp/codex/usb-hub-master-integration/U6.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node tests/studio-draft-state-controller.test.js
node tests/drawing-history-controller.test.js
node tests/studio-drawing-workspace.test.js
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 56189b5d0440d65f4d3156b3729d7b2c5de60a0d`를 남긴다.

### Task A1 — 다운로드 의미·Unicode PDF

**선행:** Q1, U6. **출처:** `12ebdd40916a00ef8e54390ee27e80b20d49e2cc`. **방식:** 선별 patch.

**입출력·검증 계약:** open과 download를 구분하고 download는 새 탭 없이 attachment 처리한다. Unicode/공백 파일명, inline/attachment/raw 목록의 기존 route semantics를 검증한다. PDF 한글 glyph·텍스트 추출에 필요한 font/렌더링 보완을 이식한다.

**보존 조건:** master artifact actions와 Packs의 결과 요약·readiness/canonical 링크를 유지한다. 기존 artifact authorization/path safety/MIME을 보존한다. PDF 검사 skip이면 실제 PDF 성공으로 보고하지 않는다.

**정확한 파일:**

- 수정: `public/js/studio/artifact-actions.js`
- 수정: `public/js/studio/artifacts-workspace.js`
- 수정: `public/js/studio/quality-dashboard.js`
- 수정: `scripts/_report_renderer.py`
- 수정: `scripts/_report_styles.py`
- 수정: `scripts/engineering_report.py`
- 수정: `src/server/routes/local-api-artifact-routes.js`
- 수정: `tests/local-api-server.test.js`
- 수정: `tests/report-decision-pdf.test.js`
- 수정: `tests/studio-quality-dashboard.test.js`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 12ebdd40916a00ef8e54390ee27e80b20d49e2cc -- public/js/studio/artifact-actions.js public/js/studio/artifacts-workspace.js public/js/studio/quality-dashboard.js scripts/_report_renderer.py scripts/_report_styles.py scripts/engineering_report.py src/server/routes/local-api-artifact-routes.js tests/local-api-server.test.js tests/report-decision-pdf.test.js tests/studio-quality-dashboard.test.js > tmp/codex/usb-hub-master-integration/A1.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node tests/local-api-server.test.js
node tests/report-decision-pdf.test.js
node tests/studio-quality-dashboard.test.js
node tests/studio-artifact-viewers.test.js
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 12ebdd40916a00ef8e54390ee27e80b20d49e2cc`를 남긴다.

### Task A2 — 조립품 선택·숨김·불투명도·layout

**선행:** U3~U6, A1; D10과 파일 책임 분리. **출처:** `e0039f2db74dc8bb2a2afa14cc1f5e45b07e0792`. **방식:** e0039f2의 UI/schema/tests 부분만 수동 이식.

**입출력·검증 계약:** createAssemblyPartControls({element, sceneState, getParts, saved})의 build/select/sync와 updateSceneOpacity(defaultMaterial, partMeshes, value)를 이식한다. 같은 preview remount는 선택/숨김 유지, 새 preview는 초기화. 늦게 로드된 mesh에도 현재 옵션 적용. assembly rotation 형식과 한·영 Review/Packs 배치를 보완한다.

**보존 조건:** scene.js의 master resolvePartIndex index 검증, guided model result inspector, config의 OpenAI 비용 보호와 기존 matrix 형식, 작은 화면 layout을 유지한다. D10 코드와 pilot 문서를 다시 이식하지 않는다.

**정확한 파일:**

- 수정: `lib/config-canonical-schema.js`
- 수정: `public/css/studio.css`
- 수정: `public/css/style.css`
- 추가: `public/js/app/assembly-parts.js`
- 추가: `public/js/app/scene-materials.js`
- 수정: `public/js/app/scene.js`
- 수정: `public/js/i18n/en.js`
- 수정: `public/js/i18n/ko.js`
- 수정: `public/js/studio/model-workspace.js`
- 추가: `tests/assembly-parts-controller.test.js`
- 수정: `tests/config-schema-cli.test.js`
- 수정: `tests/lane-manifest.js`
- 추가: `tests/scene-materials.test.js`
- 수정: `tests/studio-draft-state-controller.test.js`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary e0039f2db74dc8bb2a2afa14cc1f5e45b07e0792 -- lib/config-canonical-schema.js public/css/studio.css public/css/style.css public/js/app/assembly-parts.js public/js/app/scene-materials.js public/js/app/scene.js public/js/i18n/en.js public/js/i18n/ko.js public/js/studio/model-workspace.js tests/assembly-parts-controller.test.js tests/config-schema-cli.test.js tests/lane-manifest.js tests/scene-materials.test.js tests/studio-draft-state-controller.test.js > tmp/codex/usb-hub-master-integration/A2.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node tests/assembly-parts-controller.test.js
node tests/scene-materials.test.js
node tests/scene-interactions.test.js
node tests/config-schema-cli.test.js
node tests/studio-draft-state-controller.test.js
node tests/studio-responsive-css.test.js
node tests/browser-i18n.test.js
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: e0039f2db74dc8bb2a2afa14cc1f5e45b07e0792`를 남긴다.

### Task P1 — 과거 시험 보고서와 통합 근거 구분

**선행:** 모든 제품 단계 및 §8 검증. **출처:** `25fc0562fb67374ee5d2c4a1a932a4d8cd66bd40`. **방식:** 문서 이식 후 링크/사실 보정.

**입출력·검증 계약:** source 보고서를 역사적 실행 근거로 가져오고 source SHA/시험 날짜를 유지한다. 끝의 pilot 상대 링크는 이 계획 상단과 같은 source SHA의 GitHub 링크로 바꾼다. 새 master 통합 결과/skip/실패와 과거 시험 수치를 구분한다.

**보존 조건:** #12 및 #21의 pilot 문서 변경은 가져오지 않는다. 실물 검증·모델/주석 연결 QA는 별도 후속으로 유지한다.

**정확한 파일:**

- 추가: `docs/usage-trials/usb-hub-mount-extended-checks.ko.md`

- [ ] 위 source diff에서 test/fixture 변경을 먼저 읽고 적용하여 위 사례를 재현한다. 선행 미존재 오류와 기능 회귀를 구분한다.
- [ ] 제품 diff를 현재 코드에 적용하고 위 보존 조건을 함께 확인한다. 소스 patch를 만드는 정확한 명령:

```sh
git show --format= --binary 25fc0562fb67374ee5d2c4a1a932a4d8cd66bd40 -- docs/usage-trials/usb-hub-mount-extended-checks.ko.md > tmp/codex/usb-hub-master-integration/P1.patch
```

전체 patch는 검토용이다. test 변경을 먼저 적용했다면 제품/문서 hunk만 이어 적용해 중복 적용을 피한다. 충돌 구간은 현재 파일을 기준으로 해결한다.

- [ ] 아래 검사를 실행하고 실패를 §5 기준으로 닫는다.

```sh
node scripts/run-pytest.js -q tests/test_manufacturing_agent_cli.py::test_markdown_docs_do_not_contain_local_paths_and_links_resolve
```

- [ ] §6 공통 freeze/review gate를 통과한 뒤 이 단계 파일만 commit/push한다. commit 본문에 `Source-Commit: 25fc0562fb67374ee5d2c4a1a932a4d8cd66bd40`를 남긴다.

## 7. 시험 입력과 원시 근거 재사용

현재 새 계획 worktree에는 기존 `output/usage-trials/usb-hub-mount/extended-checks/`와 `tmp/codex/usb-hub-8-checks/`가 없다. 원본 worktree에서는 두 경로와 item-01~08, source final report를 읽기 전용으로 확인했다. 기존 원본 16개를 현재 다시 SHA-256으로 읽어 과거 기대 hash와 모두 일치함을 확인했다. 이는 파일 보존 확인이며 시험 재실행이 아니다.

소스 보고서의 npm 통과, e0039f2 Python 172+하위 27, 생성 SVG 이후 1 PASS, native 세 파일 4 PASS, 마지막 이력 관련 62 PASS는 **그때의 소스·환경 근거**다. 새 master 통합 결과로 복사하지 않는다.

### 확인한 입력·회귀 fixture

| 입력 | 존재와 용도 |
| --- | --- |
| 원본 `output/usage-trials/usb-hub-mount/automation/rev-b/config.json` | 읽기 확인. 가정 판 142×74×4, 네 Ø5.2 구멍. export.directory는 원본 절대 경로이므로 복제본에서 반드시 바꿈 |
| 원본 `output/usage-trials/usb-hub-mount/revision-b.json` | 읽기 확인. 구멍 중심 `(12,12)`, `(12,62)`, `(120,12)`, `(120,62)`, 단위 mm. physical_measurements_available=false |
| 원본 `output/usage-trials/usb-hub-mount/shared/verify_drawings.py` | 기존 scale matrix가 참조하는 SVG 측정 helper. 실행 전 전체 내용을 읽고, 자신의 복제본이 자기 출력만 읽는지 확인 |
| 원본 `tmp/codex/usb-hub-8-checks/run-scale-matrix.py`, `run-input-matrix.py` | 읽기 확인. 6축척/4입력 생성기. 그대로 실행하면 과거 상대 output에 쓸 수 있으므로 자신의 tmp에 복제·출력 경로 수정 후 실행 |
| `configs/examples/infotainment_display_bracket_hole_dia_repro.toml` | master에 존재. native draw/HOLE_DIA 두 검사에서 사용 |
| `configs/examples/cam_follower.toml`, `configs/examples/four_bar_linkage.toml` | master에 존재. assembly/motion UI 시험. rotation 4값 형식은 A2 계약에 포함 |
| `configs/examples/quality_pass_bracket.toml`, `configs/imports/smoke_box.toml` | master에 존재. 기존 모델/도면/runtime 기준 |
| `tests/fixtures/imports/simple_bracket.step`, `small_assembly.step`, `small_assembly.fcstd` | master에 존재. 최신 import/guided 동작 보존 확인 |
| `tests/fixtures/svg/techdraw_bracket.svg`, `techdraw_assembly.svg` | master에 존재. 기존 정적 snapshot 입력, 실제 생성 결과와 구분 |

### 실행 시 원본 입력을 안전하게 복제하는 명령

아래는 실행 단계용이며, 원본에는 쓰지 않는다. 원본이 다른 머신에 없어도 기본 기존 fixture 검사와 구현은 진행할 수 있다. 기존 USB matrix의 완전 재현은 입력 부재로 표시하고, 소스 보고서의 가정값을 사용한 새 fixture라는 출처를 명시해 준비한다. 실측값을 요청하거나 추정하지 않는다.

```sh
python3 - <<'PY'
import hashlib, json, subprocess
from pathlib import Path

records = subprocess.check_output(['git', 'worktree', 'list', '--porcelain'], text=True).strip().split('\n\n')
source_roots = []
for record in records:
    fields = dict(line.split(' ', 1) for line in record.splitlines() if ' ' in line)
    if fields.get('branch') == 'refs/heads/codex/mega-studio-api-contract-fuzz-audit':
        source_roots.append(Path(fields['worktree']))
if len(source_roots) != 1:
    raise SystemExit('Source worktree input unavailable or ambiguous; record the evidence gap.')
original = source_roots[0] / 'output/usage-trials/usb-hub-mount'
target = Path('tmp/codex/usb-hub-master-integration/inputs')
target.mkdir(parents=True, exist_ok=True)
raw = (original / 'automation/rev-b/config.json').read_bytes()
config = json.loads(raw)
config['export']['directory'] = 'output/usb-hub-master-integration/base'
(target / 'usb-hub-B.json').write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
(target / 'revision-b.json').write_bytes((original / 'revision-b.json').read_bytes())
(target / 'source.json').write_text(json.dumps({
    'source_sha': '25fc0562fb67374ee5d2c4a1a932a4d8cd66bd40',
    'raw_config_sha256': hashlib.sha256(raw).hexdigest(),
    'input_kind': 'design_assumption', 'physical_measurements_available': False,
    'modified_fields': ['export.directory'],
}, indent=2) + '\n')
PY
```

복제한 입력에서 create/draw를 실행하고 모든 산출물은 `output/usb-hub-master-integration/` 아래로 보낸다. source 전체 출력, 기존 jobs DB, 과거 검증 스크립트를 통째로 실행하지 않는다. 절대 경로가 내장된 `native-model-verify.py`/`verify-downloaded-step.py`는 읽기 참고용이며 그대로 실행하지 않는다. 필요한 FreeCAD 검증은 자신의 복제본과 이번 다운로드 파일을 대상으로 작성한다.

## 8. 최종 검증과 중요한 1~8 회귀

### Task V1 — 최종 소스·Python·런타임

- [ ] 통합 HEAD에서 최종 `npm test`, `npm run test:py`, `npm run check:source-hygiene`를 실행한다. source의 과거 통과 개수를 기대 개수로 고정하지 않는다. suite가 중단되면 미실행 lane을 개별 실행해 실패 목록을 완성한다.
- [ ] `npm run check:runtime`, `npm run test:runtime-smoke`와 아래 명령을 실행해 실제 runtime 결과와 skip을 분리한다. wrapper가 runtime 경로를 찾았다는 결과만으로 생성 성공을 주장하지 않는다.

```sh
node scripts/run-pytest.js -q tests/test_plate_runtime_traceability.py
node scripts/run-pytest.js -q tests/test_cli_runtime.py tests/test_infotainment_draw_qa_regression.py tests/test_infotainment_hole_dia_regression.py
node bin/fcad.js create tmp/codex/usb-hub-master-integration/inputs/usb-hub-B.json
node bin/fcad.js draw tmp/codex/usb-hub-master-integration/inputs/usb-hub-B.json
```

- [ ] `test_no_plan`가 SVG 부재로 skip했으면 방금 생성한 자신의 SVG를 최상위 output으로 복사해 그 검사만 보완한다. 원본 체크아웃의 output을 사용하지 않는다.

```sh
cp output/usb-hub-master-integration/base/usb_hub_surrogate_B_drawing.svg output/usb_hub_integration_seed_drawing.svg
node scripts/run-pytest.js -q tests/test_no_plan.py::test_no_plan
```

- [ ] `report-decision-pdf.test.js`의 matplotlib/한글 font/Poppler 의존성과 실제 결과를 확인한다. npm 안에서 skip했으면 자신의 환경에서 보완하고 `node tests/report-decision-pdf.test.js`만 다시 실행한다. PDF 생성, 페이지 렌더링, 텍스트 추출은 별도 결과로 기록한다.
- [ ] 테스트 환경/소스/실제 산출물의 경로·hash·exit·runtime 버전·검증 유형을 `tmp/codex/usb-hub-master-integration/final/`에 기록한다. 생성 시각·job id를 제외한 형상/계약 비교와 원시 artifact hash를 구분한다.

### Task V2 — 자신의 서버와 실제 다섯 화면

실행 세션에서 먼저 설치된 browser 스킬을 읽고, 새 탭만 만든다. 아래 명령은 포트 0으로 새 빈 포트를 OS가 할당하게 한다. [serve 구현](../../bin/fcad.js)은 숫자 0을 허용하고 실제 listen 포트를 출력한다. 실제 출력 URL을 browser 도구에 넘긴다.

```sh
npm run serve -- 0 --jobs-dir output/usb-hub-master-integration/studio-jobs
```

프로세스 session/PID·실제 포트·출력 디렉터리를 기록한다. 8765/8768에는 연결/중단/설정 변경을 하지 않는다. disconnect/cancel 시험은 이 새 서버와 자기 job에 한정한다. 마무리 정리는 자기 PID/탭만 대상으로 한다.

| 화면 / 실제 route | 확인할 것 |
| --- | --- |
| Console / `#console` 및 Home / `#start` | 한·영 첫 화면, 입력 시작·recent jobs, runtime 상태, 초보자/고급 navigation 및 drawer keyboard focus |
| Review / `#review` | 비교 범위 경고, revision-impact/lineage/inspection/evidence graph와 기존 hold 경계, job 선택·재진입 |
| Packs / `#artifacts` | 현재 결과 파일 그룹, missing quality가 unverified, 실패/미실행 구분, open/download, canonical preview |
| Model / `#model` | guided 입력→생성→result inspect, stale/초안/오류 복구, assembly/단일 모델 options와 실제 export |
| Drawing / `#drawing` | preview/QA/치수 편집/이력/추적 저장, 현재 master의 도면→report action·상태·포커스 |

1280 px에서 한·영으로 실제 넘침/버튼 겹침을 측정하고 390 px에서 navigation drawer, focus, canvas/결과 영역을 확인한다. 가시 상태·DOM·screenshot을 기록하며 화면에 보이지 않는 상태를 클릭 결과인 것처럼 주장하지 않는다. 네이티브 파일 선택기를 조작할 수 없으면 파일 선택 성공을 주장하지 않고 현재 UI의 다른 입력 경로를 검증한다.

### Task V3 — 1~8 재현 표

| # | 실제 조작 / 최소 회귀 명령 | 완료 기준 |
| --- | --- | --- |
| 1 | USB B 복제 입력으로 3/4뷰 × 1:1·1:2·AUTO, 아래 matrix 생성기의 정확한 draw argv와 case별 export.directory 사용; D8의 Node/Python scale 검사 | SVG 좌표에서 실제 X/Y scale과 구멍 좌표를 측정하고 title/layout_report와 대조. 같은 source 입력에서 4뷰 1:1은 `explicit-scale-unmet`의 의도된 strict 실패, 나머지 다섯 조건은 해당 제한 없이 통과. 다른 실패를 이 예외에 포함하지 않음 |
| 2 | no-plan/notes-only/full-plan/conflicting-views 4조건; `node scripts/run-pytest.js -q tests/test_intent_compiler.py` | 명시 plan 우선, 사용자 notes 보존, 누락 기본값만 채움. CLI와 Studio 설정 우선순위가 각각 의도대로 동작 |
| 3 | 같은 부분 plan의 preview→tracked draw, WIDTH 142→150 주석; `node tests/studio-drawing-service.test.js` / `node tests/drawing-tracked-runs.test.js` | 두 결과 plan/편집값 일치, plan/auto/정보 안내/충돌 count 분리. 주석 변경을 모델 형상 변경으로 주장하지 않음 |
| 4 | 142→150, undo, Shift+Z, 입력 중 Ctrl/Cmd+Z, undo 뒤 148, 한·영/화면 전환 및 pending edit/undo/redo remount; U3/U6 검사 | 공유 이력/cursor/버튼이 추가 클릭 없이 갱신, 입력 기본 undo 유지. 별도로 모델 길이를 150/142로 생성해 실제 STEP을 비교한 결과와 주석 조작을 구분 |
| 5 | 미제출 153, 빌드 중 TOML 142→155, 예제/locale/화면 전환·새로고침; `node tests/studio-draft-state-controller.test.js` | 새 입력/포커스 보존, old reply 무시, stale 표시, 새로고침은 입력만 복구하고 재생성 안내 |
| 6 | 음수/빈 값/TOML 오류, 자기 서버 disconnect/restart, click+Enter 중복, queued/running cancel; `node tests/job-queue-controls.test.js` / `node tests/studio-job-monitor.test.js` | 실패 뒤 draft/마지막 결과·재시도 복구, 중복 job 없음. queued 성공과 running 미지원 구분, 자기 runtime 작업을 강제 중단하지 않음 |
| 7 | 한글·공백 STEP/PDF, SVG/JSON open/download; `node tests/local-api-server.test.js` / `node tests/report-decision-pdf.test.js` | 다운로드 byte/hash·파일명·disposition, 새 탭 없는 download. 실제 다운로드 STEP을 FreeCAD `Part.read`로 재열어 valid/solids/bbox/holes 확인. 실제 PDF를 Poppler로 렌더하고 Unicode 텍스트 추출 확인 |
| 8 | cam/four-bar 선택·숨김·opacity·motion play/pause/reset, 단일 판 복귀·AUTO·다섯 화면 한·영; A2 검사 + native 세 파일 | resolvePartIndex 보호와 새 controls 공존, 늦은 mesh에도 옵션 유지, 새 preview의 상태 초기화. runtime 검사와 화면 layout을 각각 증명 |

아래 명령으로 6개 실제 입력 파일과 정확한 draw argv를 생성·실행한다. basename은 source B 입력 그대로다. JSON의 exit와 §8 표를 대조하며 명령 전체가 통과했다고 뭉뚱그리지 않는다.

```sh
python3 - <<'PY'
import copy, json, subprocess
from pathlib import Path
base = json.loads(Path('tmp/codex/usb-hub-master-integration/inputs/usb-hub-B.json').read_text())
rows = []
for count in (3, 4):
    for label, scale in [('1-1', 1), ('1-2', 0.5), ('auto', None)]:
        case = f'{count}v-{label}'
        out = Path('output/usb-hub-master-integration/matrix') / case
        out.mkdir(parents=True, exist_ok=True)
        config = copy.deepcopy(base)
        config['export']['directory'] = str(out)
        views = ['front', 'top', 'right'] + (['iso'] if count == 4 else [])
        config['drawing']['views'] = views
        config.setdefault('drawing_plan', {}).setdefault('views', {})['enabled'] = views
        if scale is None:
            config['drawing'].pop('scale', None)
        else:
            config['drawing']['scale'] = scale
        path = out / 'config.json'
        path.write_text(json.dumps(config, indent=2) + '\n')
        argv = ['node', 'bin/fcad.js', 'draw', str(path), '--strict-quality']
        result = subprocess.run(argv, text=True, capture_output=True)
        record = {'case': case, 'argv': argv, 'exit': result.returncode,
                  'stdout': result.stdout, 'stderr': result.stderr}
        (out / 'command.json').write_text(json.dumps(record, indent=2) + '\n')
        rows.append({'case': case, 'exit': result.returncode})
Path('tmp/codex/usb-hub-master-integration/matrix-exits.json').write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps(rows))
PY
```

metadata인 `layout_report.scale`/quality JSON끼리 맞는 것만으로 SVG 실측을 대체하지 않는다. 복제한 기존 `auto_geometry` helper를 읽고 자신의 matrix 출력에 적용하거나, final SVG의 top-view envelope와 hole center/radius를 직접 파싱해 입력 가정값과 비교한다. 측정 허용치는 기존 neutral spec과 helper를 사용하고 제조 공차로 표현하지 않는다.

### 근거 수준과 미검증 항목

- **정적/제어된 검사:** schema, DOM controller, mock API, fixed SVG, simulated conflict/cancel. 실제 FreeCAD/UI 실행으로 보고하지 않는다.
- **실제 소프트웨어 측정:** 이번 FreeCAD 생성/re-import/shape bounds/원통면, SVG 좌표, 실제 브라우저 조작, 다운로드 byte와 PDF 렌더/추출. 가정 모델에 대한 검증이다.
- **실물:** 실제 USB 허브 모델, 길이·체결·재료·장착 안정성은 미검증. 이번 통합은 제조/장착 승인이 아니다.
- **현재 QA 한계:** AUTO에서 계획 주석 150과 자동 치수 142가 함께 있어도 과거 최종 점수는 89였다. plan→SVG 비교는 모델과 모든 주석의 일치를 보증하지 않는다. 이를 개선 후보로 기록하고 새 차단 기능으로 확장하지 않는다.
- **후속 계획 A:** 실측값과 실제 장착 요구가 들어오면 간섭/여유/체결·재료·제작 조건 검증을 별도로 계획한다.
- **후속 계획 B:** 모델 feature↔편집 주석 연결 및 불일치 QA 정책의 설계/근거/회귀를 별도로 계획한다. 기본 FreeCAD GUI 열기와 네이티브 파일 선택기는 조작 도구가 지원되는 환경에서 별도 확인한다.

## 9. 최종 review freeze, draft PR, merge 전 gate

### Task R1 — 검증된 diff만 review

- [ ] 파일·검사·artifact·입력 SHA와 기준 대비 실패 표를 정리한다. `git diff "$USB_BASE_SHA"...HEAD`에 source와 무관한 upstream 되돌림이 없는지 §4의 보존 목록과 대조한다.
- [ ] `tests/lane-manifest.js`는 master 검사와 새 회귀를 모두 포함해야 한다. `package.json`/lockfile/command-manifest/새 revision-lineage·inspection 기능을 옛 source로 되돌리지 않았는지 확인한다.
- [ ] review 전에 `git diff --name-only`, cached 목록, 전체 branch diff hash, HEAD, status를 저장한다. 이후 source·테스트·문서 수정 없이 읽기 전용 자체 검토를 수행하고 같은 값을 다시 저장한다. 어느 하나라도 달라지면 freeze가 깨진 것이므로 검증 범위를 재평가하고 review를 다시 한다.
- [ ] 각 source SHA의 이식 commit/제외 이유를 `tmp/codex/usb-hub-master-integration/integration-ledger.json`에 완성한다. #21 D10/A2/문서 제외가 빠짐없이 설명되어야 한다. #01~02를 새 제품 작업으로 보고하지 않는다.
- [ ] 필요하면 `docs/usage-trials/usb-hub-master-integration-verification.ko.md`를 새로 작성해 실제 최종 결과와 한계를 남긴다. 이 파일은 실행 단계의 신규 문서이며 아직 존재하지 않는다. 작성했다면 다시 문서 검사를 통과시킨 후 최종 freeze에 포함한다.

### Task R2 — 새 draft PR

- [ ] fetch로 master/source tip을 재확인한다. master가 전진했다면 overlap/merge-tree를 다시 계산하고 새 fresh worktree에서 **자신의 통합 commit만** 갱신 base에 선별 재적용한다. 기준 결과와 영향 검사·최종 freeze를 갱신한다. 원본 브랜치 이력 변경이나 force-push는 하지 않는다.
- [ ] 자신의 HEAD와 원격 HEAD가 일치하도록 일반 push한다. 기존 열린 PR을 조회한 뒤 없으면 새로운 **draft** PR을 만든다. 현재 계획 작업에서 이 명령들은 실행하지 않는다.

```sh
USB_INTEGRATION_BRANCH=$(git branch --show-current)
git push -u origin "$USB_INTEGRATION_BRANCH"
gh pr list --repo dooosp/freecad-automation --head "$USB_INTEGRATION_BRANCH" --state open --json number,url,headRefOid,isDraft
gh pr create --repo dooosp/freecad-automation --draft --base master --head "$USB_INTEGRATION_BRANCH" --title "Integrate USB hub drawing and Studio workflow fixes" --body-file tmp/codex/usb-hub-master-integration/pr-body.md
gh pr view --repo dooosp/freecad-automation --json number,url,state,isDraft,baseRefName,headRefOid,commits
gh pr checks
```

`pr-body.md`는 명령 전에 실제 freeze 결과로 작성한다. 문제/새 동작, 선행 포함 범위와 upstream 중복 제외, 최신 master 보존, 실제 실행한 검사와 skip/기준 실패, 1~8 증거, 가정 모델·QA 한계를 포함한다. 테스트를 실행하기 전 PASS 문구를 미리 쓰지 않는다. 기존 PR이 있으면 중복 생성하지 않고 해당 draft의 실제 head를 확인한다.

- [ ] PR head SHA = local HEAD = remote branch SHA를 확인한다. 해당 head의 hosted checks와 리뷰 상태를 읽는다. old #171/#169/#147의 과거 성공이나 이전 SHA checks를 새 PR 통과로 보지 않는다.
- [ ] hosted browser smoke가 green이어도 실제 FreeCAD나 이번 로컬 UI 결과로 대체하지 않는다. 반대로 browser 도구 smoke가 통과해도 미실행 hosted check를 성공 처리하지 않는다.

### 실행 완료 / merge 가능 조건

실행 작업은 다음 모두를 갖춘 **검토 가능한 draft PR**에서 완료 보고한다.

1. 23개 분류 원장이 모두 닫혔고 source 원본/보호 문서/기존 서버가 보존됨.
2. 현재 master 기능과 source 1~8 개선의 각 회귀가 확인됨. 새 unexplained FAIL 없음. baseline FAIL/환경 SKIP은 그대로 공개됨.
3. npm/Python/runtime/다섯 화면과 다운로드·기하·PDF의 실제 근거가 각각 존재함. 필수 runtime/browser 검증이 막혔으면 완료가 아니라 미완료/제약 상태로 보고함.
4. 최종 freeze 유효, 작업트리/원격/PR head 일치, tests/links/문서 경로 검증 완료.
5. draft PR URL, source/base/head, commit/push 상태, 남은 위험과 merge 권고를 보고함.

merge 전에는 위 조건에 더해 현재 head의 필수 CI/review, 최신 base 대비 충돌 없음, unresolved review 요청 없음, 남은 기준 실패의 수용 여부를 확인한다. 실제 merge는 사용자의 후속 승인에 따른다. merge 후 확인이 요청되면 원본 대신 새로운 worktree에서 merge SHA와 필요한 smoke를 확인한다.

## 10. 전문가 자문 판단

이번 결정에 필요한 불확실성은 upstream 재작성 대응, 실제 파일 겹침, source 선행 순서였다. PR 데이터·range-diff·blob 비교·현재 코드·merge-tree로 답할 수 있어 GPT6Pro 자문은 필요하지 않았다. 사용 가능한 도구 목록에서도 GPT6Pro advisor 기능은 확인되지 않았다. 다른 모델을 Pro로 간주하거나 자문을 보냈다고 주장하지 않는다.

실행 중 위 근거로 해결되지 않는 구체적인 통합 계약 문제가 생기면 자신의 tmp에 `advisor-brief.ko.md`를 작성해 base/source/head, 최소 재현, 상충 계약, 선택지, 결정 질문을 기록한다. 실제 Pro 도구가 없으면 미자문 상태를 명시한다. 자문 부재를 이미 가능한 가역적 작업의 중단 이유로 삼지 않는다.

## 11. 복사해서 사용할 한국어 시작 지시문

```text
freecad-automation의 USB 허브 master 통합을 실행해줘. 이 작업의 실행 계획은 docs/exec-plans/usb-hub-master-integration.md다. 문서 전체와 AGENTS.md를 먼저 읽고 superpowers:executing-plans로 단계를 수행하라. 새 하위 작업/에이전트는 만들지 않는다.

먼저 pwd, git root/basename, branch, HEAD, status, 실제 remote default, npm scripts를 증명한다. 계획 기준 master는 57264a196b2f3ac5272aa8b78f0c35096a7925a0, source는 25fc0562fb67374ee5d2c4a1a932a4d8cd66bd40, source branch는 codex/mega-studio-api-contract-fuzz-audit다. fetch 후 실제 SHA가 달라졌으면 원장·충돌 분석·기준 검사를 새 SHA로 갱신하라. 과거 source 시험 성공을 현재 통합의 성공으로 복사하지 않는다.

계획 worktree를 보존하고 최신 master 기반의 새 isolated worktree/통합 브랜치를 사용하라. 기본 이름은 codex/usb-hub-master-integration이며 충돌하는 기존 브랜치를 덮어쓰지 않는다. 원본 worktree의 소스·브랜치·docs/superpowers·8765/8768 서버와 기존 탭은 보호한다. 원본 이력 rewrite/force-push와 원본 산출물 쓰기를 하지 않는다. 제어 파일은 자신의 tmp/codex/usb-hub-master-integration/, 새 산출물은 자신의 output/usb-hub-master-integration/에 둔다.

이미 upstream에 반영된 audit/journal 두 커밋은 재이식하지 않는다. 문서의 Q1/Q2, D1~D10, U1~U6, A1/A2 순서로 선별 commit/hunk 이식하고, §8의 V1~V3 검증 후 P1 문서를 마무리한 다음 R1/R2로 진행하라. e0039f2는 도면 QA와 조립품 UI로 분리하고 실물 pilot 문서 변경은 제외한다. 최신 master의 guided UI, 도면→보고서, locale 접근성, resolvePartIndex, revision/inspection/canonical 계약을 보존하라. 소스 UI 파일 전체를 덮거나 전체 branch를 merge/rebase하지 않는다.

기준 master 검사 결과를 먼저 보관한다. 각 단계는 기존/source 회귀 재현 → 좁은 적용·수정 → 관련 재검증 → 읽기 전용 freeze/review → 명시 파일 commit/push로 완료하라. Python은 node scripts/run-pytest.js를 쓰고 지원 interpreter와 pytest를 확인한다. 원본의 보호 문서 때문에 발생했던 doc 실패를 검사 약화/문서 삭제로 없애지 않는다. 현재 master에서 이미 고쳐진 readiness provenance도 과거 실패라고 단정하지 않는다.

최종 npm/Python/runtime, 설치된 browser 스킬/도구를 통한 실제 Console/Review/Packs/Model/Drawing smoke 및 1~8 회귀를 완료하라. 자기 서버는 빈 포트와 별도 jobs 디렉터리로 시작한다. standalone Playwright/CDP로 우회하지 않는다. 입력 가정값 142×74×4 mm·네 Ø5.2와 실제 runtime 형상 측정, plan→SVG 비교, 실물 검증을 구분하라. QA 모델/주석 연결 기능이나 실물 장착 작업으로 범위를 넓히지 않는다.

이 요청은 필요한 가역적 이식·좁은 수정·검사·자기 서버·단계별 commit/push 및 검토 가능한 새 draft PR 생성을 승인한다. 이미 승인된 단계마다 확인을 반복하지 말고 자율적으로 진행하라. 실제 merge는 하지 않는다. repo/base를 증명할 수 없거나, 범위 밖 파괴적 정리가 필요하거나, 권한 차단 또는 안전한 복구 한 번 뒤 같은 확인된 blocker가 남을 때만 근거와 필요한 조치를 보고하라. 독립적인 작업은 계속한다.

GPT6Pro 자문은 현재 불필요하다는 계획 결론을 따른다. 꼭 필요한 새 불확실성이 생기면 advisor-brief.ko.md에 근거와 질문을 정리하되, 실제 도구 없이 자문했다고 하거나 다른 모델을 Pro라고 부르지 않는다.

완료 보고에는 실제 base/source/head, 23개 원장과 이식 범위, 현재 master 보존, 테스트/실제 조작/skip 및 기준 실패, 유효한 review freeze, commit/push/새 draft PR URL과 merge 전 남은 조건을 한국어로 간결하게 제시하라.
```

## 12. 계획 자체 검증 기록

- [x] repo preflight, 원격 master/source 재확인, 23개 목록, PR #171/#169/#147 및 open PR 조회.
- [x] patch-ID 결과를 PR/range-diff/8개 핵심 blob/현재 CLI 코드와 대조. 후보 핵심 17파일의 기준 동일성 확인.
- [x] 346/81/29파일 집계, 전체 21/후보 11 content conflict 및 단독 적용의 선행 누락 구분.
- [x] 실행 단계의 명령·test·fixture 존재와 source-only 파일 구분. source #21의 모든 파일을 D10/A2/문서 제외로 배정.
- [x] 요구 1~7을 이 문서의 근거 원장·단계·기준 비교·최종 gate·후속 경계·시작 지시문에 대응시켜 자체 검토.
- [x] 기기 경로·placeholder·Markdown 링크·명령 참조 검증과 문서 회귀 검사 완료. 검사 세부 결과는 계획 worktree의 `tmp/codex/usb-hub-master-integration-plan/plan-validation.json` 및 `docs-final.log`에 기록.
- [x] 현재 수행하지 않은 것: 제품 수정, 실제 cherry-pick/apply/rebase/merge, 전체 npm/Python 재실행, 새 runtime/browser 실행, commit/push/PR 생성.

임시 근거 목록: `preflight.json`, `source-log.txt`, `master-log.txt`, `commits.json`, `patch-cherry.txt`, `pr-171.json`, `pr-169.json`, `pr-147.json`, `compare.json`, `pr171-range-diff.txt`, `pr171-blob-equivalence.json`, `candidate-master-base-blobs.json`, `overlap.json`, `whole-branch-merge-tree.txt`, `candidate-merge-tree.txt`, `per-commit-merge-tree.json`, `source-added-file-presence.json`, `original-evidence-inventory.json`, `original-artifact-sha256-recheck.json`, `stages.json`, `docs-baseline.log`, `docs-final.log`, `plan-validation.json`. 이 임시 파일은 커밋하지 않는다.
