# Manufacturing Robotics Studio five-person UAT session kit

- Packet state: `PREPARED_NOT_STARTED`
- Technical rehearsal: `P0`, excluded from every human metric
- Scored cohort: exactly `P1`, `P2`, `P3`, `P4`, `P5`
- Human UAT: `NOT_RUN`
- Human Korean/English meaning review: `NOT_RUN`
- Public result: [Round 1 count-only aggregate](human-uat-round-1-aggregate.md)
- Raw-record schema: `schemas/manufacturing-robotics-uat-result.schema.json`
- Aggregate calculator: `scripts/manufacturing-robotics-uat-aggregate.js`

This packet prepares human evaluation; it is not a result. An agent, automated
browser, synthetic fixture, facilitator, or P0 operator cannot stand in for
P1–P5. Keep MR-UAT-01 through MR-UAT-08 `NOT_MEASURED` until one complete,
valid five-person cohort exists.

## 1. Cohort and consent boundary

- Recruit exactly five people who are new to Studio. Assign anonymous labels
  `P1`–`P5`; do not store names, emails, employers, demographic details, dates,
  times, quotes, or any other identifier in the result JSON.
- Ask for consent to retain an anonymous structured result before the session.
  If consent is refused, do not begin or create a record.
- Default to no audio, video, screen recording, photographs, or free-form notes.
- A participant may withdraw at any time. Stop, delete that raw record and any
  recording immediately, and retain no reason or outcome. Recruit a replacement
  for the same anonymous slot; never shrink the cohort.
- `P0` is a technical rehearsal only. Never include it in any numerator,
  denominator, median, locale count, or qualitative claim.
- Do not describe a synthetic calculator fixture as a person. The tracked
  fixture uses `record_origin: synthetic_test_fixture`; the production
  calculator rejects it unless the explicit test-only flag is used.

## 2. Freeze the exact candidate

Resolve the chosen source ref once, then create a clean detached worktree at
that immutable commit. Record the following in the private round administration
record, not in the public aggregate until the freeze is complete:

```sh
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
git status --porcelain=v1 -uall
```

Status must be empty. Compute a fingerprint of all tracked and non-ignored
untracked candidate files:

```sh
node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const paths = execFileSync(
  'git',
  ['ls-files', '-co', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
).split('\0').filter(Boolean).sort();
const hash = createHash('sha256');
hash.update(`HEAD\0${head}\0`);
for (const path of paths) {
  hash.update(`PATH\0${path}\0`);
  hash.update(readFileSync(path));
  hash.update('\0');
}
console.log(`candidate_tree_sha256=${hash.digest('hex')}`);
NODE
```

Before **every** P1–P5 session, require the same commit, Git tree, empty status,
and `candidate_tree_sha256`. Do not fetch, pull, edit, switch commits, or reuse a
different build during a round.

### Candidate restart rules

- Correction before P1: freeze a new candidate, rerun P0, rerun human bilingual
  meaning review, then start P1.
- Any candidate change after P1 starts: set the round to
  `INVALIDATED_RESTART_REQUIRED`; discard all five scored slots and begin a new
  round. Do not combine observations from two candidates.
- Browser/runtime observation fault, missed prediction prompt, incomplete field,
  or protocol deviation with an unchanged candidate: mark that private attempt
  invalid and collect a complete replacement under the same label, such as
  `P3-R1`. Do not aggregate the invalid attempt.
- Consent withdrawal: delete the record instead of retaining an invalid outcome;
  recruit a replacement for the anonymous slot.

## 3. Prerun gates

Both gates must pass on the exact frozen candidate before P1.

### P0 technical rehearsal

Use an isolated server job store outside the repository and verify the actual
browser flow in both locales:

1. health and runtime-independent server startup;
2. pre-run boundary statements;
3. successful approved profile and all ten actions;
4. exactly eight registered and previewable result files;
5. quality, handoff, trust, and LeRobot gap panels;
6. bounded Revision A/B mismatch with `0 / 8`;
7. safe Revision A recovery;
8. keyboard operation, visible focus, 200% zoom, reduced motion, and the required
   responsive widths;
9. server shutdown, closed port, unchanged candidate fingerprint.

P0 failure blocks P1. P0 success remains technical evidence only.

### Human Korean/English meaning review

A person qualified to judge both meanings checks the same surfaces for semantic
equivalence, including all trust negations and LeRobot gaps. The required result
is `PASS` with exactly zero material meaning errors. Keep reviewer identity and
row-level notes private. Any wording fix changes the candidate and triggers the
restart rules above.

## 4. Private raw-record storage

Create an owner-only directory outside every repository and worktree. The
example uses a private directory under the current operator's home; choose an
equivalent non-synced location if needed. Do not use `output/`, `tmp/codex/`, a
team directory, or a participant-visible path.

```sh
export MR_UAT_PRIVATE_ROOT="${HOME}/.freecad-studio-uat/manufacturing-robotics"
umask 077
install -d -m 700 "$MR_UAT_PRIVATE_ROOT"
install -d -m 700 "$MR_UAT_PRIVATE_ROOT/round-1"
install -d -m 700 "$MR_UAT_PRIVATE_ROOT/round-1/P1"
```

Use the closed schema for one structured JSON record per attempt. Set
`record_origin` to `private_human_session`. Do not add fields for names, notes,
paths, recordings, or quotes—the schema deliberately rejects them. Record an
owner and deletion date in a separate private administration record. Delete raw
material after the count aggregate is independently checked and the retention
date is reached.

## 5. Session setup and neutral introduction

- Run sessions sequentially with a new isolated job store for each attempt.
- Start from a clean browser profile at the Review workspace, with no prior demo
  job visible. Preserve the participant-selected `en` or `ko` locale.
- Keep the server terminal and private record hidden from the participant.
- Read only: “Please explore this manufacturing-robotics demonstration. I will
  ask what you expect before a few actions and what you understand afterward.
  This is the interface being evaluated, not you.”
- Do not teach the meaning of lineage, synthetic, LeRobot, or the correct path.
  A task-related hint makes “without help” false; record it consistently.

## 6. Participant journey and observable tasks

1. Find the Manufacturing Robotics Data card and explain what will be generated.
2. Run the approved profile and reach the dataset summary.
3. Explore the ten-action timeline and explain one action-to-CAD-feature link.
4. Explain why the source is synthetic rather than real shop-floor data.
5. Explain why the current output is not LeRobot training-ready.
6. Open Result files and identify that eight results belong to the completed job.
7. Run the bounded revision mismatch and explain why it blocked with `0 / 8`.
8. Use the safe Revision A recovery and return to the approved success path.

Count only primary user actions needed to reach the successful dataset summary.
Count activation of a primary button or link; do not count scrolling, focus-only
Tab presses, timeline exploration after the summary, or facilitator actions.
If the summary is never reached, store `completed_path_primary_actions: null`.

### Fixed observation rubric

Score the structured booleans from observable statements, not facilitator
impressions:

- `dataset_summary_without_help`: true only when the successful summary is
  visibly reached with no task-related help request and no task-related hint or
  intervention.
- `action_feature_link_explained`: true only when the participant identifies one
  visible action and one of its displayed CAD feature IDs and explains that the
  feature is a target/reference for that action. Naming either item alone fails.
- `synthetic_vs_real_explained`: true only when the participant says the scenario
  is curated/synthetic **and** does not represent measured shop-floor execution,
  sensor data, or physical inspection evidence.
- `lerobot_gap_explained`: true only when the participant says the output is a
  semantic layer rather than training-ready data and names at least one visible
  format/training blocker such as per-frame numeric state/action, FPS/indices,
  Parquet/metadata/statistics, or loader validation.
- `revision_mismatch_explained`: true only when the participant identifies the
  expected A versus received B conflict and says publication stopped; a generic
  “error occurred” fails.

A material bilingual error for MR-UAT-08 is a Korean/English difference that
changes an action, input/output effect, safety/trust boundary, status, negation,
or next action enough to lead a reasonable user to a different decision.
Style-only wording differences are non-material but may still be remediated.

## 7. Eight fixed next-action predictions

Immediately before each listed action, ask: “What do you expect will happen
next?” Do not reveal the oracle until the session ends.

Use this exact timing so every opportunity is observable:

1. Ask `MR-PRED-01` while the approved Generate button is still untouched.
2. After the participant answers, activate Generate. Ask `MR-PRED-02`
   immediately when the card shows the real queued/running state and before the
   summary appears. The neutral verified-result preparation handoff may remain
   visible while the answer is captured, but do not postpone this prompt until
   that handoff or ask it during pre-run.
3. After success, Action 1 starts unselected. Ask `MR-PRED-03`, then let the
   participant select Action 1. Repeat the same sequence for Action 6 and
   `MR-PRED-04`.
4. After the completed result-file task, return to the successful Review card.
   Ask `MR-PRED-06` before checking the mismatch preparation option. Confirm
   that checking it starts no job and changes no completed result. Then ask
   `MR-PRED-07` before activating the separately enabled blocked-demo button.
5. Ask `MR-PRED-08` before activating the approved Revision A recovery.

| ID | Opportunity | Correct prediction oracle |
| --- | --- | --- |
| `MR-PRED-01` | Before approved `Generate dataset` | A tracked local generation job starts; the UI shows in-progress state, not instant fabricated results. |
| `MR-PRED-02` | Before the approved job completes | The summary and ten-action timeline appear only after success. |
| `MR-PRED-03` | Before selecting action 1 | Detail changes to the approach action and its linked fields; no new dataset is generated. |
| `MR-PRED-04` | Before selecting action 6 | Detail shows the left hinge-pin probe action with its CAD/quality/robot links. |
| `MR-PRED-05` | Before opening Result files | The completed job exposes exactly eight registered files through the existing result view. |
| `MR-PRED-06` | Before enabling the mismatch option | The option is armed but does not publish or mutate a result until generation is started. |
| `MR-PRED-07` | Before generating the mismatch | The job blocks on Revision A/B identity mismatch and publishes `0 / 8`. |
| `MR-PRED-08` | Before approved Revision A recovery | A new approved-profile run is started; the blocked Revision B result is not reclassified as success. |

Score `CORRECT`, `INCORRECT`, or `UNREACHED`. `UNREACHED` scores zero and keeps
the fixed denominator. If the facilitator forgets a reached prompt, score
`FACILITATOR_MISSED`; that invalidates the attempt and requires a replacement.
Every valid person contributes exactly eight scores, for a fixed `5 × 8 = 40`.

## 8. Release criteria

| ID | Measure | Exact threshold |
| --- | --- | --- |
| `MR-UAT-01` | Dataset summary reached without participant help request or facilitator task help | at least `4 / 5` |
| `MR-UAT-02` | One action-to-CAD-feature link explained correctly | at least `4 / 5` |
| `MR-UAT-03` | Synthetic data distinguished from real shop-floor data | at least `4 / 5` |
| `MR-UAT-04` | Why the output is not LeRobot training-ready explained | at least `4 / 5` |
| `MR-UAT-05` | Revision mismatch block explained | at least `4 / 5` |
| `MR-UAT-06` | Correct fixed next-action predictions | at least `32 / 40` (`80%`) |
| `MR-UAT-07` | Median completed-summary path primary actions | `<= 4` **and** MR-UAT-01 passes |
| `MR-UAT-08` | Material Korean/English meaning errors in prerun human review | exactly `0` |

The denominator never shrinks. Missing P1–P5 records keep the round
`FOLLOW_UP_REQUIRED`, not a partial pass. A prediction that was not reached
still contributes zero to 40. MR-UAT-07 uses only completed paths for its
descriptive median, but cannot pass unless MR-UAT-01 passes.

## 9. Validate and aggregate

After five complete, consented, privacy-reviewed valid records exist, run the
calculator from the frozen repository tooling checkout. Keep input and output
paths outside the repository during review:

```sh
node scripts/manufacturing-robotics-uat-aggregate.js \
  --out "$MR_UAT_PRIVATE_ROOT/round-1/count-aggregate.json" \
  "$MR_UAT_PRIVATE_ROOT/round-1/P1/result.json" \
  "$MR_UAT_PRIVATE_ROOT/round-1/P2/result.json" \
  "$MR_UAT_PRIVATE_ROOT/round-1/P3/result.json" \
  "$MR_UAT_PRIVATE_ROOT/round-1/P4/result.json" \
  "$MR_UAT_PRIVATE_ROOT/round-1/P5/result.json"
```

Do not use `--allow-test-fixtures` for a human round. The calculator requires
exactly P1–P5, the same candidate/gates, all required fields, all eight prompts,
and the fixed denominators. Its output contains counts and candidate identity,
not participant rows, locale mappings, notes, raw paths, or attempt labels.

Have a second person compare the calculator output with the five private records
inside the private environment. Then copy **counts only** into the public
[Round 1 aggregate](human-uat-round-1-aggregate.md). Never commit raw records or
the private administration record.

## 10. Decision and remediation

- `PASS`: all MR-UAT-01..08 pass on one unchanged candidate.
- `FAIL`: the complete valid cohort exists but one or more criteria fail.
- `FOLLOW_UP_REQUIRED`: gates or any valid record/score are incomplete.
- `INVALIDATED_RESTART_REQUIRED`: candidate identity changed after freeze.

If a criterion fails, report the observed aggregate honestly. Make the smallest
change supported by observation, freeze a new candidate, repeat P0 and human
bilingual review, then run a new five-person round. Do not overwrite the initial
aggregate or combine before/after participants.
