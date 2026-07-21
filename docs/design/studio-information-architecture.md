# Studio information architecture

- Status: authoritative UX contract; Studio beginner UX landed through PRs #189-#191, with five-user human UAT still `FOLLOW_UP_REQUIRED`
- Baseline: `origin/master` at `bf811e5580503db3556a0d5f61fc165aaf3ca5c9`
- Audience: product, design, frontend, accessibility, QA, and maintainers

## Decision

FreeCAD Automation Studio will organize its default experience around a user's
goal, not its internal workspaces. A first-time user sees three starting choices
and progresses through `goal → execution summary → execution → result`. Existing
expert capabilities remain available through progressive disclosure and their
supported hash routes remain valid.

This contract changes presentation and frontend navigation only. It does not
change backend APIs, job semantics, commands, schemas, canonical packages,
evidence, readiness, release behavior, or generated results.

## Design principles

1. Ask for the user's goal before exposing tools.
2. Show one visible workflow step and at most one primary action in that step.
3. Explain runtime, write, network, and cost effects before the user confirms an
   operation.
4. Make the outcome the primary action; move metadata and utility actions into
   progressive disclosure.
5. Use everyday language by default and preserve expert vocabulary as secondary
   labels in advanced work.
6. Keep execution success separate from quality judgment.
7. Reveal system status only when it changes what the user can do.
8. Preserve route, preview, and path-safety boundaries.

The hierarchy follows the intent of the [Primer ActionBar](https://primer.style/product/components/action-bar/)
and [ActionMenu accessibility](https://primer.style/product/components/action-menu/accessibility/)
guidance, the [GOV.UK multiple-task](https://design-system.service.gov.uk/patterns/complete-multiple-tasks/)
and [start-button](https://design-system.service.gov.uk/components/button/)
patterns, and [Carbon button hierarchy](https://v10.carbondesignsystem.com/components/button/usage/).

## Personas

### First-time operator

- Has a model idea or an existing STEP/FCStd file.
- Understands outputs such as a 3D model, drawing, and report.
- Does not know Studio route names, tracked-job terminology, package structure,
  readiness gates, or runtime metadata.
- Needs a predictable next action, effect disclosure, and recovery guidance.

### Returning operator

- Wants to reopen a recent execution or its primary output quickly.
- Needs execution state and quality state to be visually and semantically
  distinct.
- Uses comparison, retry, download, and report actions occasionally.

### Expert maintainer

- Uses model and drawing controls, readiness/evidence views, revision comparison,
  inspection planning, local API information, and diagnostics.
- Needs stable direct links and full access to existing capabilities.
- Can switch to an advanced navigation preference stored locally.

## Current-state inventory

The baseline exposes implementation structure before task intent:

- Five peer navigation routes: Console, Review, Packs, Model, and Drawing.
- Four persistent status badges: runtime, project, connection, and job.
- Two persistent utilities: Jobs center and Log drawer.
- The Home workspace combines the workflow rail, canonical packages, guided
  workflows, quick links, recent jobs, import bootstrap, queue, decision
  packages, and runtime health.
- Model and Drawing place setup, validation, preview, tracked execution, reports,
  view controls, exports, and diagnostics into broad peer action groups.
- Result cards repeat Inspect, Open, and Download actions.
- Review exposes Stage 5B operations as peer actions even when no job is selected.
- `createButton` distinguishes only label, action, tone, disabled state, and
  attributes. There is no shared action summary, task stepper, result card, or
  accessible overflow-menu contract.

### Read-only browser baseline

The local Studio was measured at the pinned baseline. Captures were stored under
ignored local output and are intentionally not part of this change. No private
absolute path, token, user identifier, or operational data is committed.

| View | Width | Observed structure |
| --- | ---: | --- |
| Home | 1440 px | 5 nav links, 4 status badges, 2 utility buttons, 96 visible buttons, 2 primary-tone buttons, 9 top-level cards, 8,931 px page height |
| Home | 1024 px | 312 px sidebar, 1,238 px document width, 22,233 px page height; horizontal overflow |
| Home | 768 px | Sidebar becomes an 850 px-high top block, 1,352 px document width, 15,256 px page height; horizontal overflow |
| Home | 320 px | 866 px-high top navigation block, 499 px document width, 37,787 px page height; horizontal overflow |
| Model | 1440 px | 12 visible buttons, 2 primary-tone buttons, 13 article/card surfaces, 3 disclosures |
| Drawing | 1440 px | 11 visible buttons, 2 primary-tone buttons, 11 article/card surfaces, 2 disclosures |
| Review, empty | 1440 px | 12 visible buttons; maintainer audit, intake, dry-run, tabs, and related controls compete at one level |
| Result files, empty | 1440 px | 9 cards; populated cards can repeat Inspect, Open, Download, Compare, and tracked follow-up actions |

The current structural model is:

```text
Studio shell
├─ Console
├─ Review
├─ Packs
├─ Model
├─ Drawing
├─ runtime / project / connection / job
├─ Jobs center
└─ Log drawer
   └─ workspace-specific cards and action grids
```

## Target information architecture

```text
Studio
├─ Home                         #start
│  ├─ Create a new model
│  ├─ Review existing CAD
│  └─ Open previous work
├─ Run history                  #history (frontend-only view)
├─ Result files                 #artifacts
└─ Advanced work
   ├─ Model editing             #model
   ├─ Drawing editing           #drawing
   ├─ Review and readiness      #review
   ├─ Revision comparison       existing review/result capability
   ├─ Inspection planning       existing review/result capability
   ├─ Evidence / Stage 5B       #review
   ├─ Local API                 /api
   └─ Diagnostics and logs      existing log drawer
```

### Default and advanced modes

- Default mode shows Home, Run history, Result files, and a collapsed Advanced
  work disclosure.
- Advanced mode may keep the disclosure expanded and show expert secondary
  labels. It does not create different data or permissions.
- Store the preference locally, for example as
  `studio_experience_mode=default|advanced`. Do not send it to the server.
- Opening `#model`, `#drawing`, or `#review` directly must reveal the relevant
  advanced location and breadcrumb without rewriting the hash or silently
  changing the stored preference.
- Unknown hashes continue to resolve safely to Home.

## Home contract

Home asks one question and shows exactly three equal starting choices. These are
the only exception to the one-primary-per-step rule because Home is a choice
screen, not an active workflow step.

```text
┌─────────────────────────────────────────────────────────────────────┐
│ What would you like to do?                         FreeCAD ready     │
├───────────────────┬───────────────────┬─────────────────────────────┤
│ Create a new      │ Review existing   │ Open previous work          │
│ model             │ CAD               │                             │
│                   │                   │                             │
│ Needed            │ Needed            │ Needed                      │
│ Config or example │ STEP or FCStd     │ Nothing                     │
│                   │                   │                             │
│ Result            │ Result            │ Result                      │
│ 3D + quality      │ Diagnostics +     │ Existing runs and files     │
│ result            │ review result     │                             │
│                   │                   │                             │
│ FreeCAD: Yes      │ Depends on file   │ FreeCAD: No                 │
│ [Start new model] │ [Choose CAD file] │ [View run history]          │
└───────────────────┴───────────────────┴─────────────────────────────┘
```

Below the choices, Home may show at most three recent executions with a single
`Open results` action each. Canonical package details, import diagnostics,
queues, decision packets, raw runtime payloads, project root, connection
details, job IDs, logs, API paths, Stage 5B, manifests, file paths, release
bundle structure, AI prompts, view controls, and report options do not appear in
the default Home state.

Healthy runtime state is quiet text: `FreeCAD ready`. A runtime problem becomes
an inline status that explains impact and recovery while leaving unaffected
tasks available.

## Guided journeys

### Create a new model

```text
Choose input
  → Review execution summary
  → Generate model
  → Inspect results
  → Optionally create a drawing or report
```

```text
Step 1 of 4 · Choose input

How would you like to start?
(●) Start with an example
( ) Open a configuration file
( ) Advanced: Draft a configuration with AI — external API

[Continue]  Cancel
```

```text
Step 2 of 4 · Review execution summary

Action       Generate a 3D model from the selected configuration
Input        quality_pass_bracket.toml
Output       3D model, STEP, STL, quality result
FreeCAD      Yes
Files        Creates new files under the safe output location
Network      No
Cost         None
Confirmation Required

[Generate model]  Back  Advanced settings
```

```text
Step 3 of 4 · Generating model

✓ Configuration checked
✓ FreeCAD started
• Building geometry
○ Quality check

Diagnostic log ▾
```

```text
Step 4 of 4 · Model generated

Execution    Completed
Quality      Passed
Primary      3D model

[View 3D model]  Create report  Start another model
```

After choosing the Home goal, the primary-action click budget is three:
`Continue` (1), `Generate model` (2), `View 3D model` (3). Optional follow-up
actions do not affect completion of the primary goal.

### Review existing CAD

```text
Select STEP or FCStd
  → Basic diagnostics
  → Confirm assumptions
  → Begin review
  → Inspect review result
```

```text
Step 1 · Select a CAD file
[Choose STEP or FCStd]

Additional material ▾
  BOM, inspection information, quality path
```

```text
Step 2 · Import check
File          Can be read
Assumptions   3 need confirmation
Review        Ready to begin

[Start review]  Change file
```

```text
Step 3 · Review result
Current decision
Issues that need attention
Recommended next step
Supporting files ▾

[View review result]  Create report
```

After choosing the Home goal, the primary-action click budget is three:
`Choose/check file` (1), `Start review` (2), `View review result` (3). Detailed
bootstrap status, path, confidence, correction input, dimensions, and warnings
remain available in expanded details.

### Open previous work

```text
Select recent execution
  → Inspect result summary
  → Open primary output
  → Use optional follow-up actions
```

```text
Recent runs
Bracket model · Model generation · 10 minutes ago
Execution: Completed    Quality: Needs review
[Open results]  [More actions]
```

```text
Result summary
Primary result       3D model
Quality              Needs review
Other result files   4
[View 3D model]  [More actions]
```

After choosing the Home goal, the primary-action click budget is two:
`Open results` (1), `View primary result` (2).

## Task stepper contract

`createTaskStepper` renders a semantic ordered list. It accepts stable step IDs,
localized labels, state (`complete`, `current`, `upcoming`, `error`), and an
optional destination only when backward navigation is safe.

- The current item uses `aria-current="step"`.
- On a user-triggered transition, focus moves to the new step heading.
- Progress text is announced in a polite live region without repeating all
  completed steps.
- An execution error moves focus to an error summary; recovery does not discard
  valid input.
- Completed and error states use text and icons, not color alone.
- Animation respects `prefers-reduced-motion: reduce`.

## Action hierarchy

| Type | Contract | Example |
| --- | --- | --- |
| Primary | The single safe next action for the visible step | Generate model |
| Secondary | Backward navigation or optional follow-up | Create report |
| Tertiary/link | Explanation, details, or advanced disclosure | Advanced settings |
| Overflow | Low-frequency utility actions attached to an object | More actions |
| Destructive | Cancel/delete action with explicit scope and confirmation when needed | Cancel run |
| External/cost | Network or cost-bearing action; always preceded by the action summary | Draft with AI |

Rules:

- A visible `[data-workflow-step]` contains at most one primary action.
- The Home start-choice group contains exactly three primary choices and is
  marked as a choice group rather than a workflow step.
- Labels use a short verb and user outcome. Command names belong in advanced
  details only.
- A disabled control is accompanied by a visible reason and recovery action. If
  native `disabled` remains necessary, connect the reason with
  `aria-describedby`.
- Destructive actions are separated and labeled; red is never the only warning.

## Action summary contract

Every action that launches FreeCAD, writes or changes files, calls an external
service, or may incur cost requires `createActionSummary` before confirmation.
The rows are stable so users do not have to infer why information is absent.

| Field | Type and allowed meaning |
| --- | --- |
| `actionId` | Stable frontend identifier |
| `title` | Localized user-outcome label |
| `description` | What the operation does |
| `requiredInputs` | User-readable input names; `None` when empty |
| `expectedOutputs` | User-readable results; `None` when empty |
| `launchesFreeCAD` | `yes`, `no`, `conditional`, or `unknown` plus explanation |
| `fileEffects` | `none`, `create`, `change`, or `delete`; show only safe location labels |
| `networkAccess` | `yes`, `no`, or `conditional` plus purpose |
| `provider` | Existing provider name or `None`; do not invent a provider |
| `cost` | `none`, `possible`, or `unknown` plus the existing cost-policy link |
| `humanConfirmationRequired` | Boolean; true for all runtime/write/network/cost actions in the guided flows |
| `safetyNotes` | Canonical preview, path, or data-handling constraints |
| `blockedReason` | Why confirmation is unavailable |
| `recoveryAction` | The next action that resolves the blocked reason |

`createCostAndSideEffectNotice` may visually emphasize non-default effects but
does not replace the complete summary. The primary confirmation action remains
inside or immediately after the summary and has an accessible name that states
the outcome.

## Result files and actions

Group results by user purpose, not file extension or internal package structure:

1. Immediate results: 3D model, drawing, report/PDF.
2. Quality and review: model quality, drawing quality, manufacturability review.
3. Technical files: STEP, STL, BOM.
4. System records, collapsed by default: manifest, runtime fingerprint, hash,
   provenance.

```text
3D model
Generated · 2.4 MB
[View] [More actions]
```

Each `createResultCard` has exactly one primary outcome action:

- `View` when the current backend capability says the result can open.
- `Download` when it can only download.
- `Details` when neither opening nor downloading is supported.

The overflow menu contains only supported secondary actions: Download, Open in
new window, File information, and Hash/provenance. `Copy file path` appears only
when the existing backend already provides a browser-safe display or
repository-relative path. The redesign must not expose the intentionally
stripped private path field or add arbitrary local filesystem access. Release
bundles that are not previewable/downloadable remain so.

### Overflow-menu behavior

- Trigger name: `More actions for <result name>`.
- Trigger uses `aria-haspopup="menu"`, `aria-expanded`, and `aria-controls`.
- Opening moves focus to the first enabled item.
- Arrow Down/Up move between enabled items; Home/End move to first/last.
- Enter or Space activates the focused item.
- Escape closes the menu and returns focus to its trigger.
- Tab or Shift+Tab closes the menu and continues normal document focus order.
- Clicking outside closes the menu. Only one menu may be open.
- Use `role="menu"` and `role="menuitem"`; retain anchors for real download and
  new-window navigation behavior.
- Separate destructive actions with a labeled group. Do not rely on color.

## Run history

History rows prioritize a user-supplied configuration/name, run type, relative
time, and result. Job IDs and command metadata move to details.

Execution state and quality state are separate:

```text
Execution: Completed | Failed | Running | Cancelled
Quality:   Passed | Needs review | Not available
```

The row primary action is `Open results`. Compare, retry, and cancel move to
the overflow menu and appear only when currently supported.

## Status and message rules

| Situation | Pattern | Required content |
| --- | --- | --- |
| Healthy runtime | Compact inline text | `FreeCAD ready`; no payload or persistent badge wall |
| Runtime unavailable | Inline warning | What is unavailable, what still works, and a recovery action |
| Blocked action | Inline status beside action | Reason, preserved input, and recovery action |
| Running | Step progress | Current human-readable stage; diagnostics collapsed |
| Execution failure | Error summary | Failed operation, impact, safe retry/recovery, diagnostic disclosure |
| Execution complete | Completion summary | Primary result and next action |
| Quality concern | Separate warning | Quality judgment, issues, and recommended next step; never label execution failed merely because quality needs review |

Messages use plain language, remain in the DOM until resolved or dismissed, are
announced once through the appropriate live region, and never encode state by
color alone.

## Terminology migration

| Current/internal | Default English | Default Korean | Advanced secondary label |
| --- | --- | --- | --- |
| Console | Home | 홈 | Start console / 시작 콘솔 |
| Model | Create model | 모델 만들기 | Model workspace / 모델 작업 영역 |
| Drawing | Create drawing | 도면 만들기 | Drawing workspace / 도면 작업 영역 |
| Review | Review results | 검토 결과 | Review |
| Packs | Result files | 결과 파일 | Packages / 패키지 |
| Jobs center | Run history | 실행 내역 | Job center / 작업 센터 |
| Studio log | Diagnostic log | 진단 로그 | Activity log / 활동 로그 |
| Run tracked create job | Generate model | 모델 생성 | Tracked create |
| Run tracked report job | Create report | 보고서 만들기 | Tracked report |
| Submit tracked review-context | Start review | 검토 시작 | Tracked review context |
| Build | Create preview | 미리보기 만들기 | Build |
| Inspect | Details | 세부 정보 | Inspect |
| Compare | Compare with previous result | 이전 결과와 비교 | Compare |
| Artifact | Result file | 결과 파일 | Artifact |
| Manifest | File information | 파일 정보 | Manifest |
| Readiness | Preparation status | 준비 상태 | Readiness |
| Import bootstrap | Import check | 가져오기 확인 | Import bootstrap |
| Release bundle | Shareable result bundle | 공유용 결과 묶음 | Release bundle |
| Evidence | Inspection evidence | 검사 근거 | Evidence |

English and Korean must have equivalent meaning, effect, and risk disclosure.
Future implementation should use stable i18n keys for the new contracts instead
of extending phrase-only substitutions. Internal terms may appear only in an
advanced label, details region, diagnostic log, or explicit migration test.

## AI and external-cost boundary

Prompt-assisted design moves under the advanced starting methods for Create a
new model. Its label is `Draft a configuration with AI — external API` / `AI로
설정 초안 만들기 — 외부 API`.

Before the existing request is sent, show:

```text
Provider             OpenAI API
Submitted            The design description entered here
Local files sent     No
API key required     Yes
Cost                 Possible, based on API usage
Expected result      A TOML draft that requires review
Confirmation         [Create AI draft]
```

The sequence is `AI draft → human review → configuration validation → model
generation`. Selecting AI never sends a request. The explicit confirmation
does. Reuse the existing OpenAI request authorization and
`docs/openai-cost-safety.md`; do not add a second pricing, provider, key, or
authorization model. This design does not change the current API endpoint.

## Responsive behavior

| Width | Contract |
| ---: | --- |
| 1440 px | Fixed 240–272 px sidebar; three equal Home choices; content uses available width without horizontal scrolling |
| 1024 px | Compact 216–240 px sidebar; keep three equal choices only while each meets its minimum readable width; otherwise use a single-column flow; no overflow |
| 768 px | Off-canvas navigation drawer; one-column task flow; sidebar must not become a tall top block; selected preview only |
| 320 px | Same drawer and stacked flow; controls and menu targets at least 44×44 CSS px; no horizontal scrolling |

At every target width, `document.body.scrollWidth <= window.innerWidth`. The
layout must remain usable at 200% zoom. Long Korean and English copy wraps
without clipping. Preview surfaces show one selected result instead of a grid
of competing canvases.

## Accessibility requirements

- Keyboard-only completion for all three beginner journeys.
- Logical heading structure, landmarks, and skip navigation.
- Visible focus on every interactive control.
- Task-step focus movement and overflow-menu focus return as specified above.
- Status and validation relationships use `aria-describedby` and live regions
  without duplicate announcements.
- Labels include action target and outcome; icon-only controls have explicit
  names.
- Minimum target size is 44×44 CSS px on narrow layouts.
- State, quality, warning, and destructive meaning never depend on color alone.
- Motion respects reduced-motion preferences.
- Content remains ordered and operable at 200% zoom and at all four target
  widths.

## Route and deep-link compatibility

| Existing route | Future behavior |
| --- | --- |
| `#start` | Default Home; remains the fallback for an empty or unknown route |
| `#review` | Advanced Review and readiness |
| `#review?job=<id>` | Open the selected review job unchanged |
| `#artifacts` | Default Result files |
| `#artifacts?job=<id>` | Open the selected result set unchanged |
| `#model` | Advanced Model editing and Create-model journey destination |
| `#drawing` | Advanced Drawing editing and optional follow-up destination |
| `/api` | Advanced Local API link |
| `#history` | New frontend-only Run history view backed by existing jobs data; no API addition |

The shell may update labels and grouping, but it must not change job selection,
query parsing, canonical preview allowlists, download capability checks, or
path redaction.

## Shared frontend primitives

The first implementation should establish:

- `createTaskStepper`
- `createActionSummary`
- `createPrimaryAction`
- `createSecondaryAction`
- `createTertiaryAction` or one strict action-variant factory
- `createOverflowMenu`
- `createMenuItem`
- `createInlineStatus`
- `createCostAndSideEffectNotice`
- `createResultCard`
- `createEmptyStateWithNextAction`

`createButton` may remain as a compatibility adapter while workspaces migrate.
The primitives are presentation-only and call existing action handlers.

## Objectively testable contract

1. Default Home contains exactly three starting choices.
2. Every active workflow step contains at most one primary action.
3. Default beginner journeys do not display tracked, artifact, manifest, or
   Stage 5B terminology.
4. After choosing Create a new model, model generation and result inspection
   require no more than three primary actions.
5. Action summary is visible before every runtime, file-write, network, or
   cost-bearing operation.
6. Each result card contains one primary action and one overflow trigger.
7. Existing expert capabilities and supported deep links remain accessible.
8. English and Korean communicate equivalent outcomes and effects.
9. The three journeys are keyboard operable.
10. Layouts at 320, 768, 1024, and 1440 px have no horizontal page overflow.
11. Canonical preview and path-safety boundaries are unchanged.
12. No backend contract change is required.
