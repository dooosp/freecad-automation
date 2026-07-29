# Manufacturing Robotics Studio Demo v1 Verification

## Purpose

Verify that the Studio demonstration is understandable and portfolio-ready while remaining a closed, deterministic wrapper around the existing manufacturing-action service. Passing this plan does not constitute human acceptance, engineering approval, real-data validation, LeRobot compatibility, readiness, or release approval.

## Immutable verification context

- Base and PR #198 merge SHA: `57264a196b2f3ac5272aa8b78f0c35096a7925a0`
- Branch: `codex/manufacturing-robotics-studio-demo-v1`
- Approved profile: `hinge-block-synthetic-inspection-v1`
- Success artifact count: exactly 8
- Bounded failure code: `REVISION_LINEAGE_IDENTITY_MISMATCH`
- LeRobot v0.6.0 reference commit: `30da8e687a6dfc617fcd94afc367ac7071c376ce`
- Normal runtime and tests: network-free
- FreeCAD runtime smoke: not required unless this branch introduces a new FreeCAD-backed claim

Preflight/source/canonical hash values are defined in the companion execution plan and `tmp/codex/repo-preflight.json`.

## Evidence discipline

- Log commands and outcomes under `tmp/codex/manufacturing-robotics-studio-demo-v1-tool-evidence.md`.
- Log milestone and final state under the matching status and verification-status files.
- Keep all temporary job stores, browser profiles, logs, and rehearsal artifacts under `tmp/codex/`.
- Do not commit temporary evidence or raw UAT records.
- Do not claim a check unless it ran.
- For each read-only review, capture `git diff --name-only` immediately before and after; any change invalidates that review.

## Gate 1 — repository and predecessor

Verify:

1. `pwd` and `git rev-parse --show-toplevel` resolve to the isolated worktree.
2. root basename is `freecad-automation`.
3. branch is `codex/manufacturing-robotics-studio-demo-v1`.
4. base ancestry includes `57264a196b2f3ac5272aa8b78f0c35096a7925a0`.
5. PR #198 is merged and its CLI service, schemas, tests, and doctor are present.
6. worktree was clean before intentional edits.
7. required npm scripts and Python lanes are discoverable.

## Gate 2 — profile fixtures and input boundary

### Fixture assertions

- Revision A review and inspection fixtures are repository-owned, minimal, synthetic, and mutually lineage-consistent.
- Revision B mismatch fixture is repository-owned and differs only as needed for the bounded identity failure.
- Inspection lineage points to the colocated Revision A review fixture.
- The registry verifies exact configured SHA-256 values for config, review, inspection, robot, and task inputs before generation.
- Mutating any byte in an isolated fixture copy fails closed before publication.

### Request assertions

Accept only:

- success profile request;
- success profile plus `trust_demo: revision-mismatch`;
- fixed server-injected proof-lineage policy where internal schema requires it.

Reject at schema/bridge boundaries:

- unknown profile or trust demo;
- arbitrary path/output/upload/config/robot/task/revision/hash fields;
- inline JSON task data;
- unknown nested options;
- attempts to turn proof lineage off;
- malformed, duplicate, or unexpected fields according to existing parsing guarantees.

Confirm the browser POST body contains no repository or local filesystem path.

## Gate 3 — successful tracked job

Run through the real job executor with an isolated job store. Verify:

1. job reaches the normal successful terminal state;
2. the existing service is invoked once with the resolved profile;
3. output stays inside the job-owned artifact directory;
4. exactly eight expected filenames exist and are registered;
5. no stale or ninth file is registered;
6. manifests describe the same eight outputs according to their existing contract;
7. each artifact hash matches its final bytes;
8. result/diagnostic metadata records profile ID, five source hashes, proof policy, boundaries, and artifact hashes without leaking absolute paths;
9. public job response and artifact previews expose only safe fields/links;
10. no FreeCAD, hardware, paid API, Hub, or network operation occurs.

Validate the rendered domain data includes ten ordered actions and expected feature, joint, quality, bilingual, origin, human-review, lineage, and boundary information without invented confidence or observations.

## Gate 4 — bounded mismatch

Run the real tracked job using the enumerated mismatch case. Verify:

- terminal state is failed/blocked, never successful;
- public stable reason is `REVISION_LINEAGE_IDENTITY_MISMATCH`;
- expected identity is `hinge-block / hinge_block / Revision A`;
- received identity is `hinge-block / hinge_block / Revision B`;
- safe next action says to regenerate the review artifact from authoritative Revision A;
- registered successful dataset artifacts are exactly `0 / 8`;
- no partial dataset output directory survives service failure;
- canonical and success-profile fixtures remain byte-identical;
- generic product behavior and underlying service contracts are not weakened.

## Gate 5 — determinism and canonical immutability

### Determinism

Run the profile twice in separate isolated job stores with the same fixed generation metadata. Compare:

- all eight output filenames;
- source identities/hashes;
- artifact content hashes;
- action order and IDs;
- quality metrics;
- boundary fields.

Any intentional job-specific field must be excluded only through an existing documented manifest convention, not by weakening hash assertions.

Run `npm run manufacturing-action-dataset:doctor -- --clean` and retain its deterministic result.

### Canonical guard

Recompute the five canonical directory file counts and aggregate hashes with the same deterministic procedure used at preflight. Every after value must exactly match the companion plan's before value. Also verify the three existing config/robot/task source hashes remain unchanged.

## Gate 6 — Studio behavior

### Structure and submission

- Existing surface/nav/route count and beginner journeys remain unchanged.
- Card appears in Review after the beginner summary and before advanced tools.
- One primary action is visible at each stage.
- Submission uses only the approved profile and optional bounded trust demo.
- Successful artifact links use the existing registered-artifact client path.

### Pre-run content

In both English and Korean, verify explicit statements for workflow purpose, approved inputs, expected outputs, offline/local operation, no FreeCAD, no robot hardware, no external/paid API, job-directory-only writes, synthetic source, no CV, no LeRobot export, and required human review.

### Success content

- Timeline has exactly ten ordered, selectable actions.
- Selection shows every required action detail field.
- Quality summary includes all required counts, coverage, timeline/transition, lineage, boundary, and overall fields.
- Handoff has Design, Manufacturing, Quality, and Trust sections.
- LeRobot panel lists the six available areas and all required format/training gaps. It distinguishes frame-level Parquet/FPS/index/metadata/statistics/loader blockers from the image/MP4 vision-modality gap rather than claiming that video is universally mandatory.
- Status remains `NOT_EXPORTABLE_YET`; compatible and training-ready remain false.
- Result files identify and preview all eight registered artifacts safely.

### Failure content

Mismatch view displays semantic `BLOCKED` status, stable code, expected/received identity, `0 / 8`, and safe next action. Status cannot depend on color alone.

## Gate 7 — accessibility, locale, and responsive behavior

Use automated DOM/CSS checks and real browser smoke for both locales:

- all static text uses the existing locale mechanism;
- EN and KO have the same required keys and no Studio JavaScript Korean literal bypass;
- native timeline controls are reachable and operable by keyboard;
- selected/current semantics and screen-reader names are present;
- focus is visibly distinguishable;
- status has text and semantic context, not color alone;
- touch targets meet the repository pattern;
- widths 320, 768, 1024, and 1440 have no horizontal page overflow;
- 200% browser zoom preserves content and operability;
- reduced-motion preference suppresses nonessential motion;
- artifact/detail content wraps instead of forcing page overflow.

Capture actual screenshots for pre-run, successful timeline/handoff, trust/LeRobot gap, and blocked mismatch states as available in both locale coverage, then place selected truthful captures in the portfolio screenshots directory.

## Gate 8 — portfolio and UAT packet

Verify all twelve required portfolio documents exist, cross-link correctly, cite the pinned official LeRobot reference, and use only allowed positioning. Search for and reject prohibited claims including official Kia project, official DELMIA/3DEXPERIENCE integration, LeRobot compatible, training ready, CV recognition, real shop-floor validation, physical evidence, and production readiness unless they appear solely as explicit negations.

Verify the UAT kit:

- defines P1-P5 session roles/tasks without invented participants;
- contains MR-UAT-01 through MR-UAT-08 and exact thresholds;
- instructs private storage of raw records;
- commits only a count-based empty aggregate template;
- marks bilingual review and human acceptance as not run;
- includes candidate replacement/restart rules.

## Focused validation

Run after the corresponding milestone:

- profile registry/source hash tests;
- Local API request schema tests;
- Studio bridge translation and rejection tests;
- public job response safety tests;
- handler/executor/store success and mismatch tests;
- artifact registration/preview tests;
- manufacturing card/view-model tests;
- Studio jobs-client tests;
- Result-files tests;
- browser i18n tests;
- Studio responsive CSS tests;
- accessibility and browser smoke tests.

## Full validation lanes

Run from the candidate commit:

```text
npm test
npm run test:node:contract
npm run test:node:integration
npm run test:snapshots
npm run test:py
npm run check:source-hygiene
npm run test:v1:acceptance
npm run test:studio-browser-smoke
npm run manufacturing-action-dataset:doctor -- --clean
npm run bootstrap:doctor -- --clean
npm run maintainer:doctor -- --clean
```

If a named command differs on the merged branch, use the repository's discovered equivalent and record the exact command. A failure must be classified as introduced, pre-existing, or environmental with evidence; introduced in-scope failures block completion.

## P0 detached candidate rehearsal

1. Commit the fully validated implementation and record candidate SHA plus content fingerprint.
2. Create a clean detached worktree from that exact SHA.
3. Install/reuse dependencies without changing tracked files.
4. configure an isolated job store below detached `tmp/codex/` and a dedicated available loopback port;
5. start the real server and verify its health endpoint;
6. execute the successful browser path, wait for tracked completion, inspect all eight artifacts, and record hashes/lineage;
7. execute the bounded mismatch path and confirm zero registered success artifacts;
8. exercise English/Korean, keyboard controls, required viewports, 200% zoom, and reduced motion;
9. capture actual browser evidence;
10. stop the server and prove the loopback port is closed;
11. prove detached HEAD, candidate fingerprint, tracked diff, and worktree cleanliness are unchanged.

No edits are allowed in the detached candidate. Any required repair returns to the branch, creates a new commit, reruns affected lanes, and freezes a new candidate.

## Guarded read-only reviews

Perform in order on the final candidate:

1. skeptical product/data review: contract preservation, semantic accuracy, no fabricated claims, useful first-time flow;
2. security/input-boundary review: closed profile, path/output denial, safe public metadata, atomic failure, no network/secrets;
3. accessibility/bilingual review: locale parity, meaning preservation, keyboard/screen-reader/focus/status/responsive behavior.

For each review:

```text
record git diff --name-only before
perform read-only inspection
record git diff --name-only after
require exact equality
```

Fix every blocking in-scope finding on the branch, rerun affected validation and all invalidated reviews, then freeze a new final candidate.

## Completion evidence

Completion requires all gates to pass and the final report to state separately:

```text
HUMAN_UAT: NOT_RUN
HUMAN_BILINGUAL_REVIEW: NOT_RUN
REAL_SHOP_FLOOR_DATA: NONE
COMPUTER_VISION: NOT_IMPLEMENTED
LEROBOT_EXPORT: NOT_IMPLEMENTED
LEROBOT_COMPATIBLE: FALSE
TRAINING_READY: FALSE
AUTHORITATIVE_BASELINE: HOLD
GENUINE_INSPECTION_INPUT: HOLD
CANONICAL_READINESS: UNCHANGED / HOLD
PRODUCTION_RELEASE: NOT_PERFORMED
```

Only then may the internal status be `READY_FOR_HUMAN_UAT_AND_APPLICATION_DEMO`. The single next human action is bilingual meaning review followed by the prepared P1-P5 sessions; neither is performed by Codex.
