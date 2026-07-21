# Studio beginner UAT Round 1 aggregate

- Record state: `PREPARED_NOT_STARTED`
- Overall decision: `FOLLOW_UP_REQUIRED`
- Human five-person study: `NOT_RUN`
- Human English/Korean semantic review: `NOT_RUN`
- Session protocol: [Studio beginner five-person UAT session kit](studio-beginner-uat-session-kit.md)
- Decision record: [Studio beginner UAT follow-up](studio-beginner-uat-follow-up.md)

This is the only repository record for Round 1 human results. It starts empty
and must contain cohort-level counts or sorted multisets only. Keep all
participant-level observations in the owner-only raw store defined by the
session protocol.

## Frozen candidate identity

Complete this block only after the preparation documents land and the selected
source ref has been resolved exactly once. The candidate must be a clean,
detached worktree. Do not fetch, update, or edit it between `P0` and the end of
the five scored sessions.

| Field | Round value |
| --- | --- |
| Candidate pin | `NOT_RUN` |
| Source ref | — |
| Resolved commit | — |
| Git tree (`HEAD^{tree}`) | — |
| Clean `git status --porcelain=v1 -uall` | `NOT_RUN` |
| `candidate_tree_sha256` baseline | — |
| Exact identity verified before scored sessions | `NOT_MEASURED` / 5 |
| Candidate unchanged through the round | `NOT_MEASURED` |

The resolved commit, Git tree, empty status, and content fingerprint must match
before every participant. Any mismatch changes the round state to
`INVALIDATED_RESTART_REQUIRED`; do not publish partial results as a completed
cohort.

## Prerun gates

| Gate | Required result | Current state |
| --- | --- | --- |
| Frozen-candidate technical rehearsal (`P0`) | Runtime and all protocol fixtures pass on the exact candidate | `NOT_RUN` |
| Human English/Korean semantic review | Equivalent meaning with no unresolved finding | `NOT_RUN` |
| Scored cohort | Exactly five complete, valid human records | `NOT_RUN` |

The bilingual review happens before the first scored session. A correction
requires a new candidate freeze and a new `P0`; once a scored session begins,
it also requires restarting the five-person round.

## Anonymous cohort totals

| Aggregate | Value |
| --- | ---: |
| Complete valid records | 0 / 5 |
| English-locale records | 0 / 5 |
| Korean-locale records | 0 / 5 |

Locale totals must sum to five when the cohort is complete. Do not map a locale
or any result back to a participant label.

## Release criteria

| ID | Aggregate evidence | Threshold | Current state |
| --- | --- | --- | --- |
| `UAT-01` | Task 1 result opened with zero task-help requests and zero facilitator task-help interventions | At least `4/5` | `NOT_MEASURED` |
| `UAT-02` | Median of the sorted completed Task 1 primary-action counts; report completed-path `n` | `<= 3`, and `UAT-01` must pass | `NOT_MEASURED` |
| `UAT-03` | Correct canonical next-action predictions | At least `32/40` | `NOT_MEASURED` |

### UAT-01 aggregate

| Measure | Value |
| --- | ---: |
| Qualifying Task 1 successes | — / 5 |

A success requires a visibly open Task 1 3D result, zero participant
task-related help requests, and zero facilitator task-help interventions. The
denominator remains exactly five.

### UAT-02 aggregate

| Measure | Value |
| --- | --- |
| Completed Task 1 action-count multiset, sorted | `[]` |
| Completed-path count (`n`) | 0 |
| Median | `N/A` |
| Dependency on `UAT-01` | `NOT_MEASURED` |

Use completed Task 1 paths only. For odd `n`, take the middle sorted value; for
even `n`, use the arithmetic mean of the two middle values. With no completed
path, the median is `N/A`. Even when the descriptive median is `<= 3`, this
criterion is `FAIL_DEPENDENCY` if a complete cohort fails `UAT-01`.

### UAT-03 aggregate

| Journey | Correct | Fixed denominator |
| --- | ---: | ---: |
| Task 1 | — | 15 |
| Task 3 | — | 10 |
| Task 4 | — | 15 |
| Total | — | 40 |

Score `CORRECT` as one. Score `INCORRECT` and `UNREACHED` as zero without
reducing the denominator. A `FACILITATOR_MISSED` prompt or browser/runtime
observation fault invalidates that attempt and requires a replacement under the
same private participant label. Never shrink the fixed `15 + 10 + 15 = 40`
denominator.

A missing valid record or required score keeps the relevant metric
`NOT_MEASURED` rather than creating a smaller cohort or denominator.

## Task completion totals

| Task | Completed records |
| --- | ---: |
| Task 1 - model and 3D result | — / 5 |
| Task 2 - drawing and report | — / 5 |
| Task 3 - previous work | — / 5 |
| Task 4 - CAD review | — / 5 |
| Task 5 - failure diagnosis | — / 5 |

## Aggregate diagnostics

These diagnostics may trigger remediation but do not add release thresholds.
Enter totals only; do not include participant rows, quotes, or notes.

| Diagnostic | Aggregate result |
| --- | --- |
| FreeCAD effects explained correctly | `NOT_MEASURED` |
| File effects explained correctly | `NOT_MEASURED` |
| Network effects explained correctly | `NOT_MEASURED` |
| Cost effects explained correctly | `NOT_MEASURED` |
| Actual Chrome 200% sessions operable | `NOT_MEASURED` / 5 |
| OS reduced-motion sessions operable | `NOT_MEASURED` / 5 |
| Browser zoom restored | `NOT_MEASURED` / 5 |
| OS reduced-motion setting restored | `NOT_MEASURED` / 5 |

## Bilingual review aggregate

| Aggregate | Value |
| --- | --- |
| Status | `NOT_RUN` |
| Non-identifying qualification category | — |
| Surfaces checked | — |
| Critical findings | — |
| Major findings | — |
| Minor findings | — |
| Unresolved findings | — |

Do not include reviewer identity, row-level translations, quotes, timestamps,
or private evidence references.

## Publication boundary

Do not add any of the following to this file:

- participant-level rows or locale-to-participant mappings;
- names, contact details, employer details, facilitator or reviewer identity;
- session dates or times, job IDs, private paths, raw-record references, or
  hashes of raw records;
- recordings, screenshots of participants, quotes, free-form notes, exclusion
  or withdrawal reasons;
- customer files, credentials, tokens, or operational data.

## Decision transition

- Keep `FOLLOW_UP_REQUIRED` while any prerequisite, valid record, or required
  score is incomplete.
- Set `PASS` only when `UAT-01`, `UAT-02`, and `UAT-03` all pass, the candidate
  remained unchanged, and the bilingual review passed.
- Set `FAIL` when the complete valid cohort is below any threshold.
- Set `INVALIDATED_RESTART_REQUIRED` when the candidate identity changes after
  the freeze; start a new round rather than combining observations.
