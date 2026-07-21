# Studio beginner five-person UAT session kit

- Packet state: `READY_FOR_HUMAN_SESSIONS`
- Human evidence state: `NOT_RUN`
- Scored cohort: exactly `P1` through `P5`
- Technical rehearsal: `P0`, excluded from every UAT calculation
- Source plan: [Studio beginner UX simplification](../exec-plans/studio-beginner-ux-simplification.md)
- Decision record: [Studio beginner UAT follow-up](studio-beginner-uat-follow-up.md)
- Public result record: [Studio beginner UAT Round 1 aggregate](studio-beginner-uat-round-1-aggregate.md)

This packet makes the five-person study repeatable. It does not contain a
participant result and does not authorize an automated agent to stand in for a
person. Keep `UAT-01`, `UAT-02`, and `UAT-03` as `NOT_MEASURED` until all five
human records are complete.

## Cohort and evidence boundary

- Recruit exactly five people who have not used Studio. Assign only `P1`
  through `P5`; do not record names, email addresses, employer details, or
  other identifiers.
- Use `P0` only for facilitator rehearsal. Never include `P0`, an agent, or an
  extra participant in the scored cohort.
- If a session must be replaced, record the exclusion reason before reviewing
  outcomes, start a fresh session with the same participant label plus a
  revision suffix, and retain both records until the aggregate is approved.
  This retention rule does not apply when consent is refused or withdrawn.
- Do not change the frozen candidate during the five scored sessions. Any
  candidate change invalidates the round and requires a new freeze, preflight,
  bilingual review, and five-person round.
- Default to no audio, video, or screen recording. If recording is necessary,
  obtain explicit consent and keep the recording outside the repository.
- Anonymous-note consent is required before timing begins. If consent is not
  given, do not start or retain a participant record. A participant may
  withdraw consent at any time. On withdrawal, stop the session, exclude all of
  its outcomes from every numerator and denominator, and delete its raw notes,
  recordings, and isolated job store as soon as practical. Retain only a
  minimal non-identifying marker that the participant label was withdrawn; do
  not retain a reason or outcome.
- Keep raw notes, recordings, and participant job stores in an OS-private
  directory outside the repository with owner-only access. Do not use
  `tmp/codex/`, `output/`, or another worktree path for raw human material.
  Commit only the redacted aggregate. Record a retention/deletion date before
  the first session and delete raw material after the aggregate has been
  checked and that date is reached.

## Approved local fixtures

| Purpose | Fixture | Expected role |
| --- | --- | --- |
| Beginner model, drawing, and report | `configs/examples/quality_pass_bracket.toml` | Beginner example; its seeded report executes successfully and its DFM surface passes |
| Imported-CAD review | `docs/examples/quality-pass-bracket/cad/quality_pass_bracket.step` | Runtime-validated synthetic local STEP input |
| Needs-attention run | `configs/examples/ks_bracket.toml` | Intentional DFM failure demonstration |

Do not substitute customer files, private paths, credentials, production data,
or operational evidence. The AI prompt flow is outside this study. If a
participant reaches its final network confirmation, stop before confirmation
and record the navigation as an incorrect selection and a safety intervention.

## Freeze and preflight the candidate

Freeze the Round 1 candidate only after this preparation packet and its
aggregate record have landed. In an administration checkout, resolve the
chosen source ref exactly once (normally `origin/master`) and record both the
source ref and the returned immutable commit. Create a clean, detached
worktree at that commit. Do not fetch, pull, switch commits, or edit files in
that candidate worktree between `P0` and the end of `P5`.

From the detached candidate worktree, record these outputs once for the round:

```sh
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
git status --porcelain=v1 -uall
node bin/fcad.js check-runtime
```

`git status --porcelain=v1 -uall` must be empty at the freeze. Record the
resolved commit, Git tree, empty status, and runtime result in the private round
administration record. A branch name is not a candidate identity.

Also generate a content fingerprint for every tracked or non-ignored untracked
file in the candidate. This detects edits to files that were already dirty when
the round began, which a repeated `git status` snapshot cannot detect:

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

Save the first `candidate_tree_sha256` as the private round baseline. You must
require an exact match before every participant. Also require the resolved commit,
Git tree, and empty status. Stop immediately if any value changes. A correction
before `P1` requires a new freeze and new `P0`; a correction after `P1` starts
invalidates the round and requires replacement observations for all five
participant labels. Raw UAT records remain outside the repository and
therefore do not alter the candidate fingerprint.

The runtime preflight must report `Status: ready`. Record the operating system,
Chrome version, display scale, initial browser zoom, initial reduced-motion
preference, and participant-selected locale.

Run the technical `P0` rehearsal and the human English/Korean semantic review
against this exact frozen candidate before `P1`. Both gates must pass. Keep the
detailed bilingual review outside the repository; publish only its status and
non-identifying qualification category in the aggregate. If either gate causes
a candidate correction, refreeze and repeat both gates before recruiting or
observing a scored participant.

## Start one isolated participant session

Run sessions sequentially. Replace `P1` with the current participant label and
use a new directory for every retry; never reuse another participant's job
store. The following creates an owner-only private root outside the repository.

```sh
set -e
export UAT_PRIVATE_ROOT="$HOME/.freecad-studio-uat"
umask 077
install -d -m 700 "$UAT_PRIVATE_ROOT"
install -d -m 700 "$UAT_PRIVATE_ROOT/round-1"
install -d -m 700 "$UAT_PRIVATE_ROOT/round-1/P1"
install -d -m 700 "$UAT_PRIVATE_ROOT/round-1/P1/jobs"
node --input-type=module <<'NODE'
import { statSync } from 'node:fs';

const root = process.env.UAT_PRIVATE_ROOT;
const expectedUid = process.getuid?.();
if (!root || !Number.isInteger(expectedUid)) {
  throw new Error('Cannot verify the private UAT directory owner.');
}
for (const path of [root, `${root}/round-1`, `${root}/round-1/P1`, `${root}/round-1/P1/jobs`]) {
  const stat = statSync(path);
  if (stat.uid !== expectedUid || (stat.mode & 0o777) !== 0o700) {
    throw new Error('A private UAT directory is not owned by the current user with mode 0700.');
  }
}
console.log('Private UAT directories verified: current owner, mode 0700.');
NODE
node bin/fcad.js serve 3100 --jobs-dir "$UAT_PRIVATE_ROOT/round-1/P1/jobs"
```

In a second terminal, require both the HTTP request and the runtime check to
succeed:

```sh
curl --fail --silent http://127.0.0.1:3100/health
```

The response must have `ok: true`, `runtime.available: true`, and
`runtime.status: "ready"`. Keep the server terminal visible to the facilitator,
not the participant.

### Seed independent previous-work and needs-attention runs

Run this once after the participant server starts and before opening the
participant browser. It creates an independent completed report for Task 3 and
the intentional failure for Task 5. It uses only checked-in fixtures, makes no
external request, waits longer than the backend's 180-second report timeout,
plus its preceding 60-second DFM budget, and fails closed unless both oracles
match. The prior-work report may have an
`incomplete` quality decision because create/drawing quality sidecars are not
seeded; Task 3 requires only successful execution and its primary PDF result.

```sh
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';

const baseUrl = 'http://127.0.0.1:3100';
const terminal = new Set(['succeeded', 'failed', 'cancelled']);

async function submitReport(configPath) {
  const configToml = await readFile(configPath, 'utf8');
  const response = await fetch(`${baseUrl}/api/studio/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'report',
      config_toml: configToml,
      options: {
        include_drawing: true,
        include_tolerance: true,
        include_dfm: true,
        include_cost: false,
      },
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.job?.id) throw new Error(JSON.stringify(payload));
  return payload.job.id;
}

async function waitForJob(jobId, label) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/jobs/${jobId}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(payload));
    const job = payload.job || payload;
    if (terminal.has(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} timed out after 300 seconds.`);
}

const priorWorkJob = await waitForJob(
  await submitReport('configs/examples/quality_pass_bracket.toml'),
  'Prior-work report seed',
);
const priorSummary = priorWorkJob.result?.report_summary
  || priorWorkJob.result?.decision_summary;
if (
  priorWorkJob.status !== 'succeeded'
  || !priorWorkJob.result?.path?.endsWith('.pdf')
  || priorSummary?.surfaces?.dfm?.status !== 'pass'
) {
  throw new Error('The prior-work report seed did not match its oracle.');
}

const needsAttentionJob = await waitForJob(
  await submitReport('configs/examples/ks_bracket.toml'),
  'Needs-attention report seed',
);
const needsAttentionSummary = needsAttentionJob.result?.report_summary
  || needsAttentionJob.result?.decision_summary;
if (
  needsAttentionJob.status !== 'succeeded'
  || needsAttentionSummary?.overall_status !== 'fail'
  || needsAttentionSummary?.surfaces?.dfm?.status !== 'fail'
  || needsAttentionSummary?.surfaces?.dfm?.score !== 70
) {
  throw new Error('The intentional needs-attention seed did not match its oracle.');
}

console.log(JSON.stringify({
  prior_work: {
    job_id: priorWorkJob.id,
    execution: priorWorkJob.status,
    primary_result: priorWorkJob.result.path,
    dfm_status: priorSummary.surfaces.dfm.status,
  },
  needs_attention: {
    job_id: needsAttentionJob.id,
    execution: needsAttentionJob.status,
    quality: needsAttentionSummary.overall_status,
    dfm_status: needsAttentionSummary.surfaces.dfm.status,
    dfm_score: needsAttentionSummary.surfaces.dfm.score,
  },
}, null, 2));
NODE
```

Record both printed job IDs only in the raw participant record. Do not put them
in the redacted aggregate.

### Prepare the browser

1. Open a fresh Chrome Guest profile or an otherwise new, empty browser profile.
2. Open `http://127.0.0.1:3100/studio/#start`.
3. Confirm browser zoom is `100%` and set the participant's chosen English or
   Korean locale. Do not open a task route for them.
4. Place `docs/examples/quality-pass-bracket/cad/quality_pass_bracket.step` in
   the file chooser only when Task 4 begins. Do not expose the repository path
   in participant notes.
5. Explain that the study evaluates the interface, not the participant, and
   that they may stop or withdraw note consent at any time. Obtain anonymous-
   note consent before reading Task 1. If consent is refused, do not begin.

## Facilitator script and scoring rules

Read only the task card for the current task. Do not name a route, control,
internal term, or next step. A verbatim repeat of the current task is allowed.

Immediately before each of the eight canonical actions in Tasks 1, 3, and 4,
ask:

> What do you think will happen if you choose that action?

Record the prediction before activation. Do not correct it until the task ends.
Each canonical action has exactly one scored row per participant, even if the
action is never reached. Retries, alternate actions, and detours may be retained
as qualitative notes but do not add rows or change the denominator.

Each task has a ten-minute limit. Start timing after reading the task and stop
when the completion boundary is reached or the participant stops. A browser or
runtime crash pauses timing; navigation confusion does not.

### Definitions

- `completed`: the task's named result is visibly open before timeout.
- `without help`: completed with zero task-related help requests and zero
  navigation, terminology, or next-step guidance from the facilitator.
- `help request`: any request for task-related direction or interpretation,
  whether or not the facilitator answers it.
- `permitted intervention`: accessibility accommodation established before
  timing, verbatim task repetition, or recovery from a browser/runtime fault.
  Record it, but it is not task help.
- `incorrect selection`: activation of a control that starts the wrong goal,
  operation, or result. Opening a disclosure or menu to inspect choices is not
  incorrect until a wrong action is activated.
- `primary-action count`: primary actions after the Home goal choice and before
  the named result opens. The Home choice itself is excluded. Count alternate
  primary actions if the participant takes another route.
- `CORRECT`: the prediction's user-visible next state or outcome matches the
  oracle below. Exact product wording is not required.
- `INCORRECT`: the participant reaches the canonical action and predicts a
  different outcome.
- `UNREACHED`: the participant does not reach the canonical action before that
  task ends or times out. It contributes zero to the numerator but remains in
  the fixed denominator.
- `FACILITATOR_MISSED`: the participant reaches the canonical action but the
  facilitator did not capture a prediction first. A browser/runtime fault that
  prevents valid observation has the same invalid-session effect. Do not score
  either as participant error: exclude the attempt and repeat that participant
  label with a revision suffix before calculating `UAT-03`.

### Prediction oracle for `UAT-03`

Only these eight canonical opportunities contribute to the numerator. With
five valid participant records, the denominator is always `8 × 5 = 40`.

| Journey | Action | Correct outcome concept |
| --- | --- | --- |
| Task 1 - Create model | Continue | Shows the execution/effect summary before running |
| Task 1 - Create model | Generate model | Runs local model generation and reaches a result |
| Task 1 - Create model | View 3D model | Opens the generated model in the 3D result view |
| Task 3 - Previous work | Open results | Opens the selected run's result-file summary |
| Task 3 - Previous work | View primary result | Opens the run's primary output |
| Task 4 - Review CAD | Check file | Checks the selected CAD file and shows diagnostics/assumptions |
| Task 4 - Review CAD | Start review | Starts the review and reaches a review result |
| Task 4 - Review CAD | View review result | Opens the completed review result |

Predictions during Tasks 2 and 5, alternate routes, retries, and detours may be
retained as qualitative notes but must not enter the `UAT-03` calculation.

## Verbatim bilingual task cards

Use one language consistently for a participant. A bilingual human reviewer
must separately approve the semantic equivalence of these cards and the product
copy; key parity or agent review is not sufficient.

### Task 1 - Create and inspect a model

English:

> Using the `quality_pass_bracket` example in Studio, create a model and open its 3D result.

Korean:

> Studio의 `quality_pass_bracket` 예제를 사용해 모델을 만들고 3D 결과를 여세요.

Completion boundary: the generated 3D result is visibly open. Record the three
expected primary-action opportunities and every detour.

### Task 2 - Find the drawing and create a report

English:

> From the model you just created, find and view its drawing, then create a report for that model.

Korean:

> 방금 만든 모델에서 도면을 찾아 확인한 다음, 그 모델의 보고서를 만드세요.

Completion boundary: a drawing has been visibly opened and the tracked report
finishes with a result available. Record drawing and report completion
separately; this task has no new numeric release threshold.

### Task 3 - Reopen previous work

English:

> Using Studio's previous-work area, open a completed `quality_pass_bracket` report and view its primary result.

Korean:

> Studio의 이전 작업 영역에서 완료된 `quality_pass_bracket` 보고서를 열고 주요 결과를 확인하세요.

Completion boundary: the primary result of a completed `quality_pass_bracket`
report is visibly open. The independent setup seed remains available even if
Task 2 was not completed, so Task 2 is not a prerequisite for Task 3.

### Task 4 - Review an existing CAD file

At task start, make the approved synthetic STEP file available in the file
chooser without naming the route or controls.

English:

> Review the provided CAD file and open the review result.

Korean:

> 제공된 CAD 파일을 검토하고 검토 결과를 여세요.

Completion boundary: the imported-CAD review result is visibly open.

### Task 5 - Diagnose a needs-attention run

English:

> Open the prepared `ks_bracket` run that needs attention. Explain why it is not ready and identify a safe recovery action.

Korean:

> 주의가 필요한 준비된 `ks_bracket` 실행을 여세요. 준비되지 않은 이유를 설명하고 안전한 복구 방법을 찾으세요.

Completion boundary: the participant distinguishes successful execution from a
failed quality decision, identifies at least one DFM edge-distance blocker, and
states a matching safe recovery action.

Failure oracle:

- execution: `succeeded`;
- report quality: `fail`;
- DFM: `fail`, score `70`;
- blocker: `hole1` and `hole3` edge distance is `3.5 mm`, below required
  `9.0 mm`;
- accepted recovery: move the affected hole at least `5.5 mm` farther inward so
  the final edge distance reaches `9.0 mm`, or widen the local flange to reach
  that clearance, then rerun the relevant quality/DFM checks.

Missing create/drawing-quality inputs may be reported as additional readiness
gaps, but they do not replace the required DFM diagnosis.

## Per-participant raw record template

Copy this section to the owner-only private root outside the repository. Keep
every field; use `MISSING` rather than guessing. If consent is refused or later
withdrawn, follow the deletion/exclusion rule above instead of completing this
template.

```markdown
# Studio beginner UAT raw record - P_

- Round:
- Participant label: P_
- New to Studio: YES / NO
- Consent to anonymous notes: YES / NO
- Recording used: NO / YES with separate consent reference
- Date/time and timezone:
- Facilitator label:
- Candidate source ref:
- Candidate resolved commit:
- Candidate Git tree:
- Candidate clean status matches round baseline: YES / NO
- Candidate tree SHA-256 matches round baseline: YES / NO; value:
- Facilitation packet commit:
- OS and version:
- Chrome version:
- Display scale:
- Initial zoom:
- Initial reduced-motion preference:
- Locale: en / ko
- Isolated job-store label:
- Prior-work report seed job ID:
- Intentional failure seed job ID:

| Task | Completed | Time | Primary actions | Help requests | Facilitator task-help interventions | Incorrect selections | Predictions correct/total | Ease 1-5 | Redacted notes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 Model + 3D | Pending | - | - | - | - | - | -/- | - | - |
| 2 Drawing + report | Pending | - | - | - | - | - | qualitative | - | Drawing: -; report: - |
| 3 Previous work | Pending | - | - | - | - | - | -/- | - | - |
| 4 CAD review | Pending | - | - | - | - | - | -/- | - | - |
| 5 Failure diagnosis | Pending | - | - | - | - | - | qualitative | - | Cause: -; recovery: - |

## Fixed UAT-03 prediction record

Enter exactly one terminal score in every row: `CORRECT`, `INCORRECT`,
`UNREACHED`, or `FACILITATOR_MISSED`. Detour predictions belong only in notes.
If any row is `FACILITATOR_MISSED`, this attempt is invalid for `UAT-03` and
must be repeated; never silently reduce the denominator.

| Canonical opportunity | Reached | Prediction summary | Observed outcome concept | Score | Notes |
| --- | --- | --- | --- | --- | --- |
| T1-A1 Continue | YES / NO | - | Effect summary | Pending | - |
| T1-A2 Generate model | YES / NO | - | Local generation/result | Pending | - |
| T1-A3 View 3D model | YES / NO | - | 3D result view | Pending | - |
| T3-A1 Open results | YES / NO | - | Result-file summary | Pending | - |
| T3-A2 View primary result | YES / NO | - | Primary output | Pending | - |
| T4-A1 Check file | YES / NO | - | Diagnostics/assumptions | Pending | - |
| T4-A2 Start review | YES / NO | - | Tracked review/result | Pending | - |
| T4-A3 View review result | YES / NO | - | Review result view | Pending | - |

## Action-summary comprehension

| Checkpoint | FreeCAD effect correct | File effect correct | Network effect correct | Cost effect correct | Notes |
| --- | --- | --- | --- | --- | --- |
| Task 1 generation summary | Pending | Pending | Pending | Pending | - |
| Task 2 report summary | Pending | Pending | Pending | Pending | - |
| Task 4 review summary | Pending | Pending | Pending | Pending | - |

## Accessibility follow-up

- Actual Chrome 200%: PASS / FAIL / NOT_RUN
- At 200%, no horizontal page overflow: YES / NO / NOT_RUN
- At 200%, active task remains keyboard-operable: YES / NO / NOT_RUN
- OS reduced motion enabled and detected by Chrome: YES / NO / NOT_RUN
- With reduced motion, active task remains operable: YES / NO / NOT_RUN
- Browser zoom restored: YES / NO
- OS reduced-motion setting restored: YES / NO

## Participant summary

- Task 1 result opened without help: YES / NO
- Task 1 completed-path primary actions: number / NOT_COMPLETED
- Eight canonical predictions correct/8:
- All required fields complete: YES / NO
- Sensitive-data review complete: YES / NO
```

## Human bilingual meaning review template

Before `P1`, a person proficient in both English and Korean must inspect both
locales in the exact frozen candidate. Review Home goals, the three journey
steps, each action summary, execution versus quality status, errors, and
recovery guidance.

| Surface/key | English meaning | Korean meaning | Equivalent | Severity if not | Recommended correction |
| --- | --- | --- | --- | --- | --- |
| Pending | - | - | Pending | - | - |

Keep this row-level review in the private round record. In the public aggregate,
record only the review status, number of surfaces checked, finding counts by
severity, and a non-identifying qualification category such as “professional
working proficiency in both languages.” Do not include reviewer identity,
quotes, timestamps, or private evidence references. Do not mark `UX-08`
complete unless all reviewed rows are equivalent. Any correction requires a
new candidate freeze and re-review; if `P1` has started, invalidate and restart
the round.

## Aggregate calculations

Calculate only after `P1` through `P5` have complete records.

- `UAT-01 numerator` = participants who complete Task 1, open the 3D result,
  make zero task-related help requests, and receive zero task-help
  interventions. Pass at `4/5` or `5/5`.
- `UAT-02` = median Task 1 primary-action count among completed Task 1 paths.
  Sort completed-path counts from low to high. For an odd count, use the middle
  value; for an even count, use the arithmetic mean of the two middle values.
  Report the completed-path denominator and the sorted multiset. With no
  completed paths, report `N/A`. It may pass at `<= 3` only if `UAT-01` also
  passes. When the cohort is complete but `UAT-01` fails, record `UAT-02` as
  `FAIL_DEPENDENCY` even if the descriptive median is `<= 3`.
- `UAT-03 numerator` = rows scored `CORRECT` across the eight canonical
  opportunities for each of `P1` through `P5`.
- `UAT-03 denominator` = exactly `40` (`8` canonical opportunities × `5`
  participants). `INCORRECT` and `UNREACHED` rows remain in the denominator and
  add zero to the numerator. Preserve the fixed journey subtotals: Task 1 is
  `/15`, Task 3 is `/10`, and Task 4 is `/15`. Pass at `32/40` or better.
- A missing valid participant record or required score keeps the relevant
  metric `NOT_MEASURED`; never silently shrink a denominator. A
  `FACILITATOR_MISSED` row or browser/runtime observation fault invalidates that
  attempt and requires a replacement under the same anonymous label. A
  consent-withdrawn attempt is deleted and excluded under the cohort rule;
  recruit a replacement under the same anonymous label so the final valid
  cohort remains five.

Report Tasks 2 and 5 completion rates, action-summary comprehension, ease
scores, 200% operability, and reduced-motion operability as diagnostic evidence.
They can trigger remediation but do not create new release thresholds beyond
the approved `UAT-01` through `UAT-03` criteria.

## End and restore each session

1. Stop the server with `Ctrl-C` and confirm the participant port no longer
   answers `/health`.
2. Close the fresh browser profile so its local Studio preference is not reused.
3. Restore browser zoom and the operating-system reduced-motion setting to their
   recorded initial values.
4. Preserve the isolated job store until the redacted aggregate is verified;
   keep it in the owner-only private root and do not reuse it for another
   participant. Delete it immediately instead if consent is withdrawn.
5. Review notes for private paths, tokens, identifiers, customer data, or
   operational data before they leave the raw store.

The round remains `FOLLOW_UP_REQUIRED` while any required observation is
incomplete. It may close as `PASS` only when all three UAT thresholds pass, the
candidate stayed unchanged, and the bilingual gate passed. A complete cohort
below a threshold closes as `FAIL`. Any candidate change closes the attempt as
`INVALIDATED_RESTART_REQUIRED` and starts a new round. The aggregate, the three
UAT calculations, human bilingual review, and any evidence-backed remediation
must all be complete before the follow-up decision changes.
