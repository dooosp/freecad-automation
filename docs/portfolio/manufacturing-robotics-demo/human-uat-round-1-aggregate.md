# Manufacturing Robotics Studio UAT — Round 1 aggregate

- Record state: `PREPARED_NOT_STARTED`
- Overall decision: `FOLLOW_UP_REQUIRED`
- Human UAT: `NOT_RUN`
- P0 technical rehearsal: `NOT_RUN`
- Human Korean/English meaning review: `NOT_RUN`
- Protocol: [five-person session kit](human-uat-session-kit.md)

This is the only repository record for Round 1. It intentionally starts empty.
Enter cohort-level counts or sorted count multisets only after exactly five valid
private human records have been aggregated. Never add participant rows, locale
mapping, quotes, notes, dates/times, job IDs, private paths, or raw hashes.

## Frozen candidate

| Field | Round 1 value |
| --- | --- |
| Source ref | — |
| Resolved commit | — |
| Git tree (`HEAD^{tree}`) | — |
| Clean status at freeze | `NOT_MEASURED` |
| `candidate_tree_sha256` | — |
| Exact identity before all five sessions | `NOT_MEASURED` / 5 |
| Candidate unchanged through round | `NOT_MEASURED` |

Do not prefill candidate values from a development worktree. A mismatch after
freeze changes the decision to `INVALIDATED_RESTART_REQUIRED` and requires a
new round.

## Prerun gates

| Gate | Required | Current |
| --- | --- | --- |
| P0 on exact frozen candidate | `PASS` | `NOT_RUN` |
| Human Korean/English meaning review | `PASS` | `NOT_RUN` |
| Material meaning errors | exactly `0` | `NOT_MEASURED` |

P0 is excluded from every human metric. Automated locale tests do not replace
the human meaning review.

## Anonymous cohort counts

| Aggregate | Value |
| --- | ---: |
| Complete valid private human records | 0 / 5 |
| English-locale records | 0 / 5 |
| Korean-locale records | 0 / 5 |

English and Korean counts must sum to five when complete. Do not publish which
anonymous label used which locale.

## Release criteria

| ID | Aggregate evidence | Threshold | Current state |
| --- | --- | --- | --- |
| `MR-UAT-01` | Dataset summary reached without help | at least `4 / 5` | `NOT_MEASURED` |
| `MR-UAT-02` | Action-to-CAD-feature link explained | at least `4 / 5` | `NOT_MEASURED` |
| `MR-UAT-03` | Synthetic vs real shop-floor data distinguished | at least `4 / 5` | `NOT_MEASURED` |
| `MR-UAT-04` | Not-LeRobot-training-ready reason explained | at least `4 / 5` | `NOT_MEASURED` |
| `MR-UAT-05` | Revision mismatch block explained | at least `4 / 5` | `NOT_MEASURED` |
| `MR-UAT-06` | Fixed next-action predictions correct | at least `32 / 40` | `NOT_MEASURED` |
| `MR-UAT-07` | Completed-path median primary actions | `<= 4` and MR-UAT-01 passes | `NOT_MEASURED` |
| `MR-UAT-08` | Material Korean/English meaning errors | exactly `0` | `NOT_MEASURED` |

### MR-UAT-01 through MR-UAT-05 counts

| ID | Qualifying count | Fixed denominator |
| --- | ---: | ---: |
| `MR-UAT-01` | — | 5 |
| `MR-UAT-02` | — | 5 |
| `MR-UAT-03` | — | 5 |
| `MR-UAT-04` | — | 5 |
| `MR-UAT-05` | — | 5 |

### MR-UAT-06 prediction count

| Measure | Value |
| --- | ---: |
| Correct | — / 40 |
| Percent | — |

`INCORRECT` and `UNREACHED` score zero without shrinking 40. A
`FACILITATOR_MISSED` prompt invalidates the attempt and requires a replacement.

### MR-UAT-07 path count

| Measure | Value |
| --- | --- |
| Sorted completed-path primary-action counts | `[]` |
| Completed-path count (`n`) | 0 |
| Median | `N/A` |
| MR-UAT-01 dependency | `NOT_MEASURED` |

Only completed paths enter the descriptive median. If no path completes, the
median is `N/A`. The criterion cannot pass unless MR-UAT-01 also passes.

### MR-UAT-08 bilingual count

| Measure | Value |
| --- | --- |
| Review status | `NOT_RUN` |
| Material meaning errors | `NOT_MEASURED` |

## Non-release diagnostics

These counts may guide remediation but do not add or replace thresholds.

| Diagnostic | Current |
| --- | ---: |
| Keyboard-operable sessions | `NOT_MEASURED` / 5 |
| 200% zoom-operable sessions | `NOT_MEASURED` / 5 |
| Reduced-motion-operable sessions | `NOT_MEASURED` / 5 |

## Publication boundary

This file must remain count-only. Do not add:

- participant or attempt labels, participant rows, or locale-to-person mapping;
- names, contact/employer/demographic details, reviewer/facilitator identity;
- dates, times, quotes, free-form notes, exclusion/withdrawal reasons;
- job IDs, recordings, screenshots of participants, raw paths, or raw hashes;
- customer files, credentials, operational data, or actual inspection evidence.

## Decision transition

- Keep `FOLLOW_UP_REQUIRED` while a gate, valid P1–P5 record, or score is missing.
- Set `PASS` only when all eight criteria pass on one unchanged candidate.
- Set `FAIL` when a complete valid cohort exists and any criterion fails.
- Set `INVALIDATED_RESTART_REQUIRED` if candidate identity changes; do not merge
  observations from different candidates.
- Preserve a failed aggregate as evidence. Any remediation uses a new candidate
  and a separately labeled round.
