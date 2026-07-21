# Studio beginner UAT follow-up decision

- Decision date: 2026-07-17
- Preparation update: 2026-07-21
- Status: `FOLLOW_UP_REQUIRED`
- Scope: Studio beginner UX landed through PRs #189-#191; human Round 1 preparation
- Human-study state: `NOT_RUN`
- Actual Chrome UI 200% follow-up: `PASS` (agent-operated actual Chrome UI;
  not a human UAT substitute)
- Actual macOS reduced-motion follow-up: `PASS` (setting restored after the
  check)
- Human bilingual meaning review: `NOT_RUN`
- Human-session packet: `READY_FOR_HUMAN_SESSIONS`
- Historical technical rehearsal: `PASS` (`P0`; excluded from human UAT calculations)
- Round 1 candidate pin: `NOT_RUN`
- Round 1 candidate technical rehearsal: `NOT_RUN`
- Round 1 aggregate: [prepared, not started](studio-beginner-uat-round-1-aggregate.md)
- Release meaning: automated local readiness is evidenced; human UAT acceptance
  is not established

## Decision

Do not substitute automated journeys or agent judgment for five new human
participants. This implementation session had no recruited participants and no
supplied observation record. The Studio beginner UX release gate therefore uses
its documented alternative: record a follow-up decision with evidence.
`UAT-01`, `UAT-02`, and `UAT-03` remain unmeasured until the study below is
completed.

This record does not block local automated verification or claim a product
rollout decision. Any rollout decision that depends on beginner usability must
retain this follow-up.

## Current landed preparation evidence

PR #190 merged the reviewed Studio UX release candidate, and PR #191 merged the
mobile locale-control accessibility repair discovered during exact-merge
review. The following checks are preparation evidence for the current merged
code, not the immutable identity of the future human-round candidate:

| Ref | Evidence | Result |
| --- | --- | --- |
| PR #191 head | Hosted CI run `29805853225` | `7/7` successful |
| Merged `master` at `634e5000d5c8e44eb061051987e404b994b47788` | Hosted push run `29806058051` | Successful |
| Same merged commit | Self-hosted FreeCAD runtime run `29806232749` | Successful |

The Round 1 candidate must be resolved and frozen only after the preparation
documents land. Do not copy the snapshot SHA above into participant records as
the candidate unless the later freeze independently resolves to that exact
commit.

## Available automated evidence

| Area | Evidence | Result |
| --- | --- | --- |
| Three beginner journeys | `tests/studio-shell-browser-smoke.test.js` uses focused keyboard activation for create model, review CAD, and previous work | Pass in real local Chrome |
| Primary-action length | Create model and imported-CAD review use three primary actions; previous work uses two | Within the planned automated path bound |
| Overflow menu | Keyboard open, Arrow Up/Down movement, item activation, Escape close, and trigger focus return | Pass in real local Chrome |
| Responsive layout | 320, 768, 1024, and 1440 CSS-pixel viewport checks assert no page overflow | Pass in real local Chrome |
| Narrow controls | Representative menu, locale, Home, and primary controls are at least 44 by 44 CSS pixels | Pass in real local Chrome |
| Motion | Emulated `prefers-reduced-motion: reduce` resolves transitions and animations to the bounded reduced-motion rule | Pass in real local Chrome |
| Zoom readiness | 720 CSS-pixel viewport at 2x device scale verifies reflow and keeps all three Home choices present as an automated proxy | Automated proxy: Pass; agent-operated actual Chrome UI: Pass; human-participant diagnostic: `NOT_RUN` |
| Routes and locales | Existing routes, selected-job deep links, English, and Korean remain covered | Pass in real local Chrome |

Automation proves deterministic behavior, not comprehension, next-action
prediction, or unassisted success by a first-time person.

## Follow-up browser and operating-system verification

On 2026-07-17, an agent-operated check used the real Chrome UI zoom control at
`200%`; this was not a device-scale emulation. Chrome reported the page at an
outer width of 1,722 pixels and a CSS inner width of 861 pixels. The check
verified:

- all three Home choices in English and Korean, with no page-level horizontal
  overflow, visible text clipping, or control overlap;
- keyboard entry into all three beginner journeys, one primary action in each
  active step, visible focus treatment, and keyboard-operable disclosure and
  result overflow menus;
- a local `quality_pass_bracket.toml` model-preview run through `Continue`,
  `Generate model`, and `View 3D model`, with one visible 3D canvas;
- the expanded 3D preview remained present after switching English to Korean;
- mobile navigation focus containment, Escape return, same-route focus return,
  and Run monitor handoff without leaving its drawer inside an inert subtree.

The same session enabled the actual macOS Accessibility > Motion > Reduce
Motion setting. Chrome reported
`matchMedia('(prefers-reduced-motion: reduce)').matches === true`; relevant
drawer, choice, and workflow-step transition/animation durations resolved to
`0.00001s`. The drawer and a model route/step transition remained immediately
operable with visible focus and without horizontal overflow. The macOS setting
was restored to off and Chrome zoom was restored to `100%` afterward.

Evidence-backed remediation from this follow-up was limited to the browser
shell and guided frontend: secondary drawers now clear the modal sidebar first,
same-route closure restores focus, the skip link shares the modal inert
boundary, unchanged completion notices do not rebuild their live region,
delayed step focus is guarded against stale requests, disabled example input is
connected to its reason, and an expanded 3D preview is reinitialized after a
locale/workspace remount.

These checks establish actual browser/OS operability only. They do not measure
human comprehension or translation meaning. Five-person UAT and human
English/Korean semantic review therefore remain outstanding.

## Human-session readiness follow-up

The [five-person UAT session kit](studio-beginner-uat-session-kit.md) now fixes
the candidate preflight, per-participant job-store isolation, approved fixtures,
verbatim English/Korean task cards, fixed eight-opportunity prediction scoring,
task-level raw records, privacy boundary, aggregate calculations, and environment
restoration. After these preparation documents land, the freeze resolves a
source ref once and records a clean detached commit, Git tree, empty status,
and content fingerprint. The exact frozen candidate must pass `P0` and a human
English/Korean semantic review before `P1`. The packet also adds the
imported-CAD journey required to measure `UAT-03` while keeping the approved
cohort at exactly `P1` through `P5`.

A historical local `P0` technical rehearsal on the predecessor candidate used a
fresh isolated job store and a dedicated loopback port. `/health` reported an
available, ready FreeCAD runtime. The
checked-in `ks_bracket.toml` report seed finished with execution `succeeded`,
quality `fail`, DFM `fail` at `70`, and the expected `hole1`/`hole3` edge-distance
blockers. A separate `quality_pass_bracket.toml` report seed finished with
execution `succeeded`, a primary PDF result, and DFM `pass`; its overall quality
remained `incomplete` because create/drawing quality sidecars were intentionally
not seeded. The runtime also accepted the checked-in 32,571-byte synthetic STEP,
reported `empty_import: false`, `fail_closed: false`, and a `160 × 100 × 8`
bounding box, then completed the tracked `review-context` job. The server was
stopped and the port was confirmed closed afterward. `P0` is environment
evidence only and must never enter a human UAT numerator, denominator, median,
or completion count. The Round 1 candidate `P0` is still `NOT_RUN` and must not
inherit this predecessor result.

## Unmeasured acceptance criteria

| ID | Required result | Current state |
| --- | --- | --- |
| `UAT-01` | At least 4 of 5 new users generate an example model and open the result without help | `NOT_MEASURED` |
| `UAT-02` | Median beginner model-result path is no more than three primary actions | `NOT_MEASURED` for humans; automated path is three |
| `UAT-03` | At least 32 of the fixed 40 next-action predictions are correct across the three primary journeys | `NOT_MEASURED` |

## Safe follow-up protocol

1. After this packet lands, resolve the chosen source ref once and freeze a
   clean detached candidate. Record its commit, Git tree, empty status, and
   content fingerprint.
2. Run `P0` and the human English/Korean semantic review against that exact
   candidate. Correcting the candidate requires a new freeze and both gates
   again; a change after `P1` starts invalidates and restarts the whole round.
3. Recruit five people who have not used Studio and assign only anonymous
   participant labels `P1` through `P5`.
4. Use only the fixture mapping and isolated-session setup in the session kit.
   Do not use customer files, private paths, tokens, credentials, or operational
   data.
5. Read the five bilingual task cards without route or terminology coaching.
   Before each of the eight canonical scored actions, use the standard
   prediction prompt. Keep all eight rows per participant; unreached rows score
   zero and detours do not alter the denominator.
6. Record completion, elapsed time, primary-action count, help requests,
   incorrect selections, next-action prediction, effect-summary explanation,
   and the 1–5 ease score.
7. Repeat the no-overflow/operability check at actual browser 200% zoom and with
   the operating system reduced-motion preference enabled.
8. Calculate `UAT-01` through `UAT-03` only after all five valid records exist.
   Update only the count-based [redacted Round 1 aggregate](studio-beginner-uat-round-1-aggregate.md);
   do not commit raw recordings, participant-level rows, identifiers, quotes,
   timestamps, job IDs, or evidence references.

## Redacted aggregate boundary

The repository record is the dedicated [Round 1 aggregate](studio-beginner-uat-round-1-aggregate.md).
It contains only cohort counts, locale totals without participant mapping, a
sorted multiset of completed Task 1 action counts, fixed journey score totals,
task completion totals, and aggregated diagnostics. Per-participant rows remain
in the owner-only raw store. This avoids turning anonymous labels plus locale,
outcomes, and evidence references into a linkable participant record.

The follow-up may be closed only with the aggregate calculations, the pass/fail
decision for all three UAT criteria, and any evidence-backed copy or interaction
changes. A missing valid record or incomplete required metric keeps the status
`FOLLOW_UP_REQUIRED`; an unchanged candidate plus all three passing thresholds
and a passing bilingual gate may close it as `PASS`. A complete cohort below a
threshold closes as `FAIL`, and a candidate change requires
`INVALIDATED_RESTART_REQUIRED`.
