# Studio beginner UX simplification execution plan

- Status: Code PR 1 through Code PR 7 implemented locally; automated Code PR 7 gates pass and five-user UAT is recorded as `FOLLOW_UP_REQUIRED`
- Planning baseline: `origin/master` at `bf811e5580503db3556a0d5f61fc165aaf3ca5c9`
- Design contract: [Studio information architecture](../design/studio-information-architecture.md)

## Goal

Make Studio understandable to a first-time user by presenting three starting
goals, one guided next action at a time, a complete execution preflight, and one
primary action per result. Preserve the current backend, APIs, jobs, commands,
schemas, canonical packages, output semantics, evidence/readiness/release
behavior, preview safety, and expert capabilities.

This plan is authoritative for the frontend migration. Implementation must stop
and update the plan if it would require a backend contract change.

## Scope

In scope:

- Default and advanced frontend navigation.
- Home, create-model, imported-CAD review, run-history, result-file, and review
  presentation.
- Shared action, preflight, stepper, status, result-card, empty-state, and menu
  primitives.
- English/Korean user-outcome terminology.
- Accessibility and responsive behavior.
- Frontend tests and manual first-user validation.

Out of scope:

- Backend routes, request/response shapes, job semantics, command contracts, or
  schemas.
- New file-opening or arbitrary local-path capabilities.
- Changes to canonical package preview allowlists, evidence, readiness, release,
  or generated result content.
- A new AI provider, pricing model, API-key flow, or request-authorization model.

### Final landing-review compatibility amendment (2026-07-19)

The guided imported-CAD path keeps the existing
`POST /api/studio/import-bootstrap` JSON request and response contract, but the
browser now accepts local uploads up to an explicit 32 MiB limit. Final review
proved that the shared 5 MB JSON parser rejected raw files above roughly
3.7 MiB after base64 expansion. The narrow compatibility repair therefore:

- keeps the 5 MB parser limit for every other local API route;
- raises only the existing import-bootstrap route's parser ceiling enough for
  a 32 MiB raw upload;
- enforces the same 32 MiB decoded-file limit in the import service; and
- tells users the limit before selection and directs larger files to the
  existing project-relative path flow.

This is not a new backend route, arbitrary-path capability, schema, job type,
or generated-output contract. It is the smallest server compatibility change
needed to make the new primary upload flow work for realistic CAD files while
retaining a bounded local request size.

## Proven baseline

At task start, the repository was fetched and pinned to the exact remote default
branch:

```text
repository   dooosp/freecad-automation
remote       origin
default      master
baseline     bf811e5580503db3556a0d5f61fc165aaf3ca5c9
```

The inventory covered the shell, CSS, workspaces, renderers, model/drawing,
review, result files, job monitoring, local-first workflow code, surfaces,
state/routing, English/Korean copy, public contracts, responsive checks,
browser smoke tests, i18n tests, and accessibility behavior.

### Current complexity evidence

| Surface | Baseline evidence |
| --- | --- |
| Shell | 5 peer routes, 4 status badges, Jobs center, and Log drawer before a user chooses a goal |
| Home at 1440 px | 96 visible buttons, 2 primary-tone buttons, 9 top-level cards, 8,931 px document height |
| Home at 1024 px | 1,238 px document width in a 1,024 px viewport |
| Home at 768 px | 1,352 px document width; sidebar stacks into an 850 px-high top block |
| Home at 320 px | 499 px document width; sidebar becomes an 866 px-high top block; 37,787 px document height |
| Model | 12 visible buttons, 2 primary-tone buttons, 13 article/card surfaces, 3 disclosures |
| Drawing | 11 visible buttons, 2 primary-tone buttons, 11 article/card surfaces, 2 disclosures |
| Review, empty | 12 visible buttons with maintainer and Stage 5B actions at peer emphasis |
| Result files | Repeated Inspect/Open/Download and broad tracked follow-up actions once populated |

Read-only screenshots were captured locally at 1440, 1024, 768, and 320 px plus
the Model, Drawing, Review, and Result files views. They remain ignored and are
not part of the repository because the design contract includes structural
wireframes and no screenshot is required for runtime behavior.

## Product contract

### Default navigation

```text
Home             #start
Run history      #history
Result files     #artifacts
Advanced work ▾
```

Advanced work exposes the existing Model editing, Drawing editing, Review and
readiness, revision comparison, inspection planning, Evidence/Stage 5B, Local
API, and diagnostics/log capabilities. Direct `#model`, `#drawing`, `#review`,
`#review?job=…`, `#artifacts`, and `#artifacts?job=…` links remain supported.

### Beginner journeys and primary-action budget

| Goal | Guided sequence | Primary actions after choosing goal |
| --- | --- | ---: |
| Create a new model | Choose input → review execution summary → generate → inspect result | `Continue`, `Generate model`, `View 3D model` = 3 |
| Review existing CAD | Select STEP/FCStd → basic diagnostics → confirm assumptions → begin review → inspect result | `Check file`, `Start review`, `View review result` = 3 |
| Open previous work | Select execution → inspect summary → open primary output → optional follow-up | `Open results`, `View primary result` = 2 |

Home itself contains exactly three equal starting choices. After a goal is
selected, each visible workflow step contains at most one primary action.

### Safety and compatibility invariants

- Show `ActionSummary` before every FreeCAD execution, file creation/change,
  network request, or potentially billable operation.
- Continue to derive open/download affordances from existing capabilities.
- Do not reintroduce the private artifact `Path` field. `Copy file path` is
  conditional on an already-safe display or repository-relative value.
- Do not make release bundles previewable or downloadable when the current
  contract denies those actions.
- Do not change query parsing, job selection, action payloads, generated output,
  or canonical preview keys.
- Store experience-mode preference locally only.
- Keep execution outcome separate from quality outcome.

## Shared component contracts

The detailed semantics live in the information-architecture document. The
implementation must provide these reusable frontend primitives before migrating
individual workspace action groups:

| Primitive | Purpose |
| --- | --- |
| `createTaskStepper` | Ordered, focus-managed progress through a user goal |
| `createActionSummary` | Complete input/output/runtime/file/network/provider/cost preflight |
| `createPrimaryAction` | The single safe next action in a visible step |
| `createSecondaryAction` | Back or optional follow-up action |
| `createTertiaryAction` | Detail or advanced disclosure |
| `createOverflowMenu` / `createMenuItem` | Keyboard-operable low-frequency object actions |
| `createInlineStatus` | Runtime, blocked, warning, error, and completion state with recovery |
| `createCostAndSideEffectNotice` | Emphasis for external, cost, write, and destructive effects |
| `createResultCard` | One result outcome action plus overflow |
| `createEmptyStateWithNextAction` | Empty-state explanation and one recovery/next action |

`createButton` remains available as a compatibility adapter until every existing
workspace is migrated. New guided workflow code must not create an untyped peer
button grid.

## File-by-file implementation map

| File or area | Planned frontend change | Must preserve |
| --- | --- | --- |
| `public/studio.html` | Three core nav items, Advanced work disclosure, drawer trigger, simpler status region | Existing route targets, landmarks, locale control, log access |
| `public/css/studio.css` | Action hierarchy, stepper, summary, result card, menu, inline status, off-canvas drawer, responsive/zoom/reduced-motion rules | Current theme tokens and visible focus |
| `public/js/studio/renderers.js` | Add shared primitives and compatibility adapters | Existing renderer call sites during migration |
| `public/js/studio/workspaces.js` | Render exactly three Home choices and at most three recent runs | Existing data loading and safe action handlers |
| `public/js/studio/studio-surfaces.js` | Map the new Home and Run history surfaces using existing jobs data | No API additions |
| `public/js/studio-shell*.js` | Navigation grouping, `#history`, drawer focus, direct advanced-route reveal | Current hash parsing, selected-job links, unknown-route fallback |
| `public/js/studio/studio-state.js` | Frontend-only mode/route state if needed | Existing job-query semantics |
| `public/js/studio/model-workspace.js` | `select_input → preflight → running → result` guided state | Existing validate, preview, create, report, and viewer handlers |
| `public/js/studio/model-tracked-runs.js` | Connect guided labels/summaries to current tracked operations | Requests and job semantics |
| `public/js/studio/examples.js` | Beginner example selection presentation | Example content and loading behavior |
| `public/js/studio/drawing-workspace.js` | Optional post-model guided drawing path; advanced controls disclosed | Existing draw and viewport behavior |
| `public/js/studio/local-first-workflows.js` | Break import bootstrap into file, diagnostics, assumption, review states | Current diagnostics and correction data |
| `public/js/studio/review-workspace.js` | Decision-first summary; evidence/readiness details collapsed | Audit, intake, dry-run, and selected-job capabilities |
| `public/js/studio/artifacts-workspace.js` | Purpose grouping, one selected preview, result cards | Capability and public-detail contracts |
| `public/js/studio/artifact-actions.js` | Feed supported actions into one primary plus overflow | Safe slug/key URLs and path redaction |
| `public/js/studio/artifact-insights.js` | User-purpose labels and collapsed technical detail | Existing insight calculations |
| `public/js/studio/job-monitor.js` | Run-history rows, separate execution/quality state, overflow utilities | Polling, retry/cancel capability, job identity |
| `public/js/i18n/en.js` | Stable keys and outcome-first English copy | Locale fallback behavior |
| `public/js/i18n/ko.js` | Semantically equivalent Korean copy | Locale fallback behavior |
| `docs/openai-cost-safety.md` | Link from the new disclosure if clarification is needed; no second policy | Existing authorization and cost boundary |

No file in `server/`, command execution, schema, canonical package, evidence,
readiness, or release code is expected to change. A proposed diff that needs such
a change fails the phase gate and requires a new scoped decision.

## Phased pull-request plan

### Documentation PR — plan and terminology contract

Deliver this execution plan and the information-architecture contract only.

Gate:

- Exactly the two requested documentation files changed unless a documentation
  index is proven mandatory.
- Source hygiene and documentation checks pass.

### Code PR 1 — shared primitives and default Home navigation (complete locally)

Add the shared action/stepper/summary/status/result/menu primitives, the default
three-item navigation, Advanced work disclosure, and exactly three Home starting
choices. Keep existing workspaces reachable and route all new Home choices to
existing safe destinations. Do not implement the full guided Model or CAD-review
state machines in this PR.

Gate:

- Exactly three Home choices.
- At most one primary per new component step.
- Existing expert routes and selected-job deep links pass.
- Off-canvas drawer works at 768 and 320 px with focus return.
- No backend/API/schema diff.

Local completion evidence on 2026-07-17:

- Added the shared action, stepper, summary, status, result, empty-state, and
  accessible overflow-menu primitives while retaining `createButton`.
- Replaced the default shell with Home, Run history, and Result files plus an
  Advanced work disclosure that preserves Console, Model, Drawing, Review,
  local API, monitor, and diagnostic access.
- Added exactly three outcome-first Home choices and routed them to the existing
  safe Model, import-review Console, and Run history destinations.
- Added stable English/Korean keys, an off-canvas mobile drawer with Escape and
  focus return, four-viewport no-overflow checks, and reduced-motion behavior.
- Passed the full default Node suite, the Studio browser smoke, the new beginner
  UX contract, responsive/i18n/state/routing checks, and source-tree hygiene.
- No backend, API, schema, command, job, canonical-package, evidence, readiness,
  or release implementation changed.

### Code PR 2 — guided model creation (complete locally)

Compose existing example/config, validation, preview, create, and result actions
into `select_input`, `preflight`, `running`, and `result` frontend states. Move
view, export, animation, tracked-report, and AI setup controls into optional or
advanced disclosures.

Gate:

- Model result is inspectable within three primary actions after goal choice.
- Action summary precedes the real create operation.
- Existing create result and job payload are unchanged.

Local completion evidence on 2026-07-17:

- Added the frontend-only `select_input → preflight → running → result` model
  journey with an accessible task stepper and focus transfer between steps.
- Added example and local-file starting methods, a complete localized
  `ActionSummary`, one primary action per visible step, and a result card with
  `View 3D model` as its sole primary action.
- Reused the existing `/api/studio/validate-config` and
  `/api/studio/model-preview` request bodies unchanged; tracked create/report
  payloads and all backend contracts remain unchanged.
- Kept config editing, preview settings, tracked runs/reports, AI drafting,
  metadata, logs, view controls, and animation under `Advanced model tools`.
- Added truthful result metadata that separates completed preview execution
  from quality (`Not available for preview`) and a graceful browser fallback
  when WebGL rendering is unavailable.
- Added pure guided-state tests, static UX/i18n contracts, and a deterministic
  browser journey proving `Continue → Generate model → View 3D model` in three
  primary actions after the Home goal choice.
- Passed the full default Node suite, Studio browser smoke, source-tree hygiene,
  i18n checks, `git diff --check`, and the new guided-flow contract tests.

### Code PR 3 — guided imported-CAD review

Turn import bootstrap into file selection, basic diagnostics, assumption
confirmation, review execution, and result states. Move BOM, inspection, quality
path, confidence, path, dimension, and correction detail under contextual
disclosures.

Gate:

- Review result is inspectable within three primary actions after goal choice.
- STEP and FCStd paths retain current validation and request behavior.
- No arbitrary local-path access is added.

Local completion evidence on 2026-07-17:

- Added the frontend-only `select_file → diagnostics → confirm → running →
  result` state machine, presented as the three-step file, import-check, and
  review-result journey from the Home `Review existing CAD` goal.
- Connected local STEP/FCStd file selection and the existing project-relative
  path option to the unchanged `/api/studio/import-bootstrap` request contract;
  local files continue to use `model_upload`, while expert path input remains
  bounded by the existing project-root validation.
- Reused the existing `tracked_review_seed`, `buildImportBootstrapOptions`, and
  `review-context` tracked-job payload without backend, API, schema, command, or
  output-contract changes.
- Added complete action summaries before bootstrap file effects and review
  execution, one primary action per visible step, truthful execution/quality
  states, and an opt-in monitor handoff that keeps the guided result visible
  until the user chooses `View review result`.
- Moved BOM, inspection, quality, project path, confidence, dimensions,
  warnings, correction inputs, and supporting bootstrap files under contextual
  disclosures; comparison, readiness, package, runtime, and API controls remain
  reachable under `Advanced review intake tools`.
- Added stable English/Korean copy, pure guided-state/request-body tests, static
  UI/i18n contracts, and a real Chrome journey proving `Choose STEP or FCStd →
  Start review → View review result` in three primary actions after the Home
  goal choice.
- Passed the full default Node suite, Studio browser smoke, source-tree hygiene,
  i18n/responsive/state/job-monitor checks, `git diff --check`, and the new
  guided import contract tests.

### Code PR 4 — Run history and Result files

Build the frontend-only `#history` view from existing jobs data. Group results by
purpose, select one primary preview, and replace repeated peer actions with one
primary action plus an accessible overflow menu.

Gate:

- Execution and quality states are distinct.
- Each result card has one primary and one overflow trigger.
- Current open/download/preview denial rules remain intact.

Local completion evidence on 2026-07-17:

- Rebuilt `#history` from the existing recent-jobs payload as result cards that
  show execution and quality separately, keep `Open results` as the single
  primary action, and place only currently eligible review/retry/cancel/run-info
  actions in the accessible overflow menu.
- Rebuilt the default `#artifacts` hierarchy as result summary, one selected
  primary result, purpose-grouped supporting results, and a focused result
  viewer. Immediate results, quality/review, and technical files remain visible;
  system records and the existing package/quality/compare/manifest tools are
  collapsed by default.
- Derived View, Download, or Details exclusively from the existing artifact
  existence, capability, and safe link fields. Non-openable/non-downloadable
  release bundles gain no link, private paths are not copied into the action
  model, and all existing advanced reopen/follow-up controls remain reachable.
- Verified in real Chrome that Home → Run history → Result files reaches the
  primary result in two post-goal primary clicks, transfers focus to the result,
  gives every result/history card one primary plus one overflow trigger, keeps
  system/advanced details closed, and has no horizontal overflow at 320, 768,
  1024, or 1440 px.
- Passed the full default Node suite, Studio browser smoke, source-tree hygiene,
  i18n/responsive/beginner-UX contracts, the new result-file unit contract, and
  `git diff --check`. No backend, API, schema, command, job, canonical-package,
  evidence, readiness, or release implementation changed.

### Code PR 5 — Review summary and advanced consolidation

Put current decision, issues, recommended next step, and supporting files first.
Move readiness, evidence, Stage 5B, and gate internals into expandable expert
details. Complete the advanced-mode preference without changing permissions.

Gate:

- Every existing expert action remains reachable.
- Default beginner paths contain none of the prohibited internal terms.

Local completion evidence on 2026-07-17:

- Rebuilt the default `#review` hierarchy around current decision, issues that
  need attention, recommended next step, supporting files, and one primary
  result-files action without exposing job IDs or system vocabulary.
- Derived the plain-language decision and next step from the existing review
  cards only. Beginner copy uses the DFM, quality, and cost review signals;
  readiness, evidence, Stage 5B, gate, source-output, provenance, and maintainer
  internals remain inside `Advanced review details`.
- Preserved every existing review hook and action inside the expandable expert
  region, including source selection, review cards, artifact open/download,
  Model/report re-entry, maintainer audit, Stage 5B audit/intake/dry-run, raw
  output, and generation history.
- Added the local-only `studio_experience_mode=default|advanced` preference.
  Direct `#console`, `#model`, `#drawing`, and `#review` routes reveal Advanced
  navigation without changing the stored preference; opting in persists across
  reloads and changes neither data nor permissions.
- Added a pure review-summary contract, experience-mode state tests, static
  beginner-UX/i18n contracts, and real Chrome assertions for default-term
  exclusion, English/Korean meaning, expert-action reachability, preference
  persistence, and no horizontal overflow at 320, 768, 1024, or 1440 px.
- Passed the full default Node suite, Studio browser smoke, source-tree hygiene,
  `git diff --check`, and the existing Stage 5B safety and review-detail
  regressions. No backend, API, schema, command, job, canonical-package,
  evidence, readiness, release, preview, or permission implementation changed.

### Code PR 6 — AI preflight and cost disclosure

Move prompt-assisted design under the advanced Create-model starting method.
Display the existing provider, submitted information, local-file rule, API-key
requirement, possible cost, draft result, and explicit confirmation before the
existing API request.

Gate:

- Selecting the method sends no request.
- Only explicit confirmation sends the current request.
- AI output requires human review and validation before model generation.
- Existing OpenAI authorization and cost-safety tests remain authoritative.

Local completion evidence on 2026-07-17:

- Moved prompt-assisted design from the general advanced-tool stack into the
  third, explicitly advanced Create-model starting method. Selecting the method
  or entering a description makes no request.
- Added localized provider, submitted-description, local-file, API-key,
  possible-cost, expected-draft, network, FreeCAD, file-effect, and explicit
  confirmation disclosures before the unchanged `/api/studio/design`
  `{ description }` request.
- Added a fail-closed `AI draft → human review → local configuration validation
  → model-generation review` state contract. Returned validation metadata does
  not unlock generation; preview and tracked-run actions remain disabled until
  the editable TOML is explicitly validated, and any later edit invalidates that
  approval.
- Added re-entry and double-submit guards, preserved the description after
  request failure, kept the API key out of browser state and copy, and preserved
  the existing OpenAI provider, endpoint, authorization, request-limit, retry,
  and cost-safety contracts without backend or schema changes.
- Added pure AI-state contracts plus real-Chrome assertions for zero requests on
  selection/typing, exactly one current request after confirmation, required
  human review and validation, edit invalidation, and no horizontal overflow at
  320, 768, 1024, or 1440 px.
- Passed the default Node suite, Studio real-Chrome browser smoke, the explicit
  zero-cost OpenAI Responses client contract, source-tree hygiene, and
  `git diff --check` with all live-request environment flags unset. No live or
  billable OpenAI request was made.

### Code PR 7 — accessibility, responsive hardening, journey tests, and UAT fixes

Close keyboard, focus, live-region, reduced-motion, zoom, target-size, copy, and
four-viewport gaps. Apply only evidence-backed UAT changes that preserve this
contract.

Gate:

- Automated contract and journey matrix passes.
- Five-user UAT meets the measurable completion criteria or records a follow-up
  decision with evidence.

Local completion evidence on 2026-07-17:

- Added modal focus containment and background `inert` behavior to the narrow
  navigation drawer while preserving Escape close and trigger-focus return.
  Resizing past the drawer breakpoint closes it and removes `inert` so a mobile
  menu cannot leave the desktop workspace disabled.
- Replaced the whole-workspace live region with targeted progress, error, and
  atomic completion announcements so route rendering is not announced twice.
- Reasserted 44 by 44 CSS-pixel controls in the final narrow-screen cascade and
  verified reduced-motion computed styles plus 320, 768, 1024, and 1440 px
  no-overflow behavior.
- Converted the three beginner browser journeys to focused keyboard activation,
  added actual arrow-key overflow-menu movement, item activation, Escape close,
  and focus-return coverage, and hardened asynchronous route/3D-result focus
  against animation-frame throttling.
- Added a 2x device-scale/720 CSS-pixel reflow proxy for 200% zoom readiness.
  At initial Code PR 7 completion, actual browser UI zoom and the five-person
  study remained follow-up checks and were not represented as completed
  automation.
- Recorded the allowed evidence-backed UAT follow-up decision in
  [Studio beginner UAT follow-up](../design/studio-beginner-uat-follow-up.md).
  `UAT-01` through `UAT-03` remain `NOT_MEASURED`; no participant result was
  invented.
- Passed `npm test`, the real-Chrome Studio browser smoke, source-tree hygiene,
  the explicit OpenAI Responses client safety contract, `git diff --check`, and
  a local `npm run serve` Studio/health response check. The verification server
  was stopped afterward; no external or billable request was made.

Follow-up verification on 2026-07-17 used the real Chrome UI at `200%` and the
actual macOS reduced-motion setting. English/Korean Home content, all three
journey entries, keyboard focus/disclosures/overflow, a local model-preview
result, one visible 3D canvas, and locale-remount viewer continuity passed
without page overflow. The OS setting and Chrome zoom were restored afterward.
That follow-up also repaired evidence-backed sidebar inert/focus handoff,
idempotent completion announcements, stale delayed step focus, disabled-input
reason linkage, and expanded-viewer remount defects. The detailed boundary is
recorded in [Studio beginner UAT follow-up](../design/studio-beginner-uat-follow-up.md).
Five-person UAT and human bilingual semantic review remain incomplete.

The facilitator-ready [Studio beginner five-person UAT session kit](../design/studio-beginner-uat-session-kit.md)
now defines the fixed cohort, approved fixtures, isolated job stores, bilingual
task cards, help/prediction rules, fixed eight-opportunity per-person records,
failure oracle, content-hashed candidate freeze, privacy boundary, and aggregate
calculations. A local `P0` rehearsal validated the loopback server, ready
runtime, independent prior-work PDF seed, intentional `ks_bracket` DFM failure,
runtime-backed synthetic STEP bootstrap and tracked review, and server shutdown;
`P0` remains excluded from all human UAT metrics.

## Test migration

### New contract test

Add `tests/studio-beginner-ux-contract.test.js` to verify:

- exactly three default Home choices;
- no more than one primary per `[data-workflow-step]`, with the explicitly marked
  Home choice group as the only exception;
- no beginner-facing tracked, artifact, manifest, or Stage 5B copy;
- complete action-summary fields before runtime/write/network/cost actions;
- AI provider/cost/data disclosure before request confirmation;
- one primary action and one overflow trigger on every result card;
- Advanced work still links to all existing expert capabilities;
- semantic English/Korean key parity.

### Existing tests to migrate

| Test area | Migration |
| --- | --- |
| `tests/studio-shell-browser-smoke.test.js` | Replace the fixed `navCount === 5` assertion with three core links plus Advanced work; replace canonical-package-on-Home checks with the three journeys; verify old deep links; replace repeated Open/Download assertions with primary-plus-overflow behavior |
| `tests/studio-responsive-css.test.js` | Replace stacked-sidebar expectations at narrow widths with an off-canvas drawer contract; add no-overflow and reduced-motion rules |
| `tests/browser-i18n.test.js` | Add stable-key parity and prohibited beginner-term checks for both locales |
| `tests/studio-public-contract.test.js` | Retain stripped-path and capability assertions; add result-card presentation without weakening public data boundaries |
| Accessibility/snapshot checks | Add task-step semantics, menu keyboard behavior, focus return, live regions, disabled reason, and color-independent state |
| Node integration and current command tests | Keep unchanged as proof that action payloads, jobs, and generated results did not move |

### Browser journeys

1. `Home → Create a new model → Example → Summary → Generate → View 3D`.
2. `Home → Review existing CAD → STEP/FCStd → Import check → Start review → View result`.
3. `Home → Open previous work → Recent successful run → Open results → View primary output`.
4. Use only keyboard to open a result overflow menu, move with arrow keys,
   activate an item, close with Escape, and confirm focus returns.
5. Open every existing route and selected-job deep link in both locales.
6. Repeat structural checks at 320, 768, 1024, and 1440 px and assert
   `body.scrollWidth <= innerWidth`.
7. Verify at 200% zoom and with reduced motion enabled.

## Manual UAT plan

Recruit exactly five people who have not used Studio and score them as `P1`
through `P5`. Do not coach them on route or internal terminology. Use the
approved fixtures, environment isolation, verbatim English/Korean cards, and
scoring rules in the
[five-person UAT session kit](../design/studio-beginner-uat-session-kit.md).
Ask each participant to:

1. Generate the `quality_pass_bracket` example model and open the 3D result.
2. Find and view its drawing, then create a report after model completion.
3. Open a completed `quality_pass_bracket` report from the previous-work journey
   and view its primary result. An independent setup seed prevents Task 2 from
   becoming a prerequisite.
4. Review the approved synthetic imported-CAD fixture and open the review result.
5. Find the cause of a deliberately failed local fixture run and identify a safe
   recovery action.

Record per task:

- Primary-action clicks to the first model result.
- Completion time.
- Help requests.
- Incorrect action selections.
- Whether the participant predicts the next action correctly before clicking.
- Whether the participant can explain FreeCAD, file, network, and cost effects
  from the action summary.
- Task completion and a 1–5 ease score; optionally collect SUS for comparison
  across rounds.

Do not record private paths, tokens, user identifiers, customer files, or
operational data in screenshots or notes.

Only the fixed eight canonical opportunities in Tasks 1, 3, and 4 contribute to
`UAT-03`, so the calculation covers Create model, Open previous work, and Review
existing CAD. Five valid participant records produce an exact denominator of
`40`; `UNREACHED` opportunities remain in it, while detours never add to it.
Tasks 2 and 5 remain diagnostic follow-ups and do not create new release
thresholds. Missing prompts or fields keep the affected UAT criterion
`NOT_MEASURED` until a valid replacement record exists; do not shrink the
denominator.

## Measurable acceptance criteria

| ID | Future implementation criterion | Evidence |
| --- | --- | --- |
| UX-01 | Default Home has exactly three primary starting choices | DOM contract test |
| UX-02 | Every visible workflow step has at most one primary action | DOM contract test across routes/states |
| UX-03 | Tracked, artifact, manifest, and Stage 5B terms are absent from beginner journeys | English/Korean copy scan and browser journey |
| UX-04 | Create-model goal reaches and opens its result within three primary actions | Browser journey click counter |
| UX-05 | Each runtime/write/network/cost action is immediately preceded by a complete action summary | Action registry/DOM contract and journeys |
| UX-06 | Each result card has one primary action plus one overflow menu | DOM contract test |
| UX-07 | All baseline expert functions and supported hashes remain accessible | Route/action inventory regression test |
| UX-08 | English and Korean communicate equivalent goal, effect, status, and recovery meaning | Key parity plus bilingual review |
| UX-09 | All three beginner journeys work by keyboard; menus meet focus and Escape rules | Browser accessibility journey |
| UX-10 | 320, 768, 1024, and 1440 px have no horizontal page overflow; 200% zoom is operable | Browser matrix and manual zoom check |
| UX-11 | Canonical preview, download capability, and path-safety contracts are unchanged | Existing public-contract tests |
| UX-12 | Backend/API/schema/job/output behavior is unchanged | Diff scope plus existing Node/integration tests |
| UAT-01 | At least 4 of 5 new users complete example model generation and open the result without help | UAT record |
| UAT-02 | Median beginner model-result path is no more than three primary actions | UAT record |
| UAT-03 | At least 32 of the fixed 40 next-action predictions are correct across the three primary journeys | UAT record |

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Hiding a capability is mistaken for deleting it | Maintain an action/route inventory; test every advanced destination before each merge |
| Frontend state duplicates server job state | Use guided state only for presentation; continue deriving execution truth from current job responses |
| `#history` changes backend expectations | Build it solely from the existing jobs-center data source and hash routing |
| A generic menu breaks link/download semantics | Preserve anchors and existing URLs; the menu controls presentation and focus only |
| Copy-path exposes a private path | Omit it unless an existing safe display/repository-relative field is present; retain stripped `Path` tests |
| AI disclosure becomes a second cost policy | Render facts from the existing OpenAI safety/authorization contract and link to it |
| Translation substitutions drift | Introduce stable keys for new UX contracts and test English/Korean parity |
| Responsive drawer harms keyboard access | Specify open focus, focus containment while modal, Escape close, and trigger focus return; test at 320/768 px |
| One-primary rule is bypassed by nested cards | Enforce it against each visible workflow-step DOM boundary in CI |
| Large migration obscures regressions | Use the small PR sequence and require invariant gates at every phase |

## Rollout and fallback

- Ship each phase independently and keep `createButton` plus existing workspace
  renderers available until their replacement is verified.
- During the first code PR, new Home choices may route to existing workspaces;
  guided flows replace those views only in later PRs.
- If a phase fails an invariant, revert only its frontend composition. No data
  migration or backend rollback should be necessary.
- Do not add a feature flag backed by server state. A local default/advanced
  preference is sufficient and cannot authorize operations.

## Planning milestone (completed before Code PR 1)

- The pinned baseline and measured current-state complexity are recorded.
- The two requested documents cover personas, navigation, wireframes, journeys,
  hierarchy, terminology, preflight, results, messages, AI/cost, responsive and
  accessibility behavior, route compatibility, implementation mapping, phased
  PRs, risks, browser tests, UAT, and measurable criteria.
- The planning milestone changed only the two documentation files; subsequent
  code phases are governed by the gates above.
- `npm run check:source-hygiene`, documentation tests, and `git diff --check`
  pass.
