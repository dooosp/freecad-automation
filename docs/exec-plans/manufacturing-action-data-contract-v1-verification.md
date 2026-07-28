# Manufacturing Action Data Contract v1 Verification

## Objective

Prove that the single experimental manufacturing-action command creates a
deterministic, proof-lineage-bound, synthetic-only dataset from exact trusted
input bytes; rejects stale, unsafe, contradictory, or ungrounded inputs before
publication; atomically emits the exact eight-file output set; preserves all
canonical package bytes and legacy proof behavior; and does not change
evidence, readiness, release, or production truth.

## Pinned evidence

- Base / predecessor merge:
  `ea1ff2b722756054a9118cedb308f29e88d89077`
- Branch: `codex/manufacturing-action-data-contract-v1`
- Config SHA-256:
  `992cf687e1da65f9ac89c12bd36ad7cd2b57367deb0cc6d50a74d4c03b7a52d1`
- Robot SHA-256:
  `afa6ab4970687c062b569618c81f8661d6865cfc1324764b25dc40f3168d4368`

Pre-change canonical package aggregate hashes use SHA-256 over sorted
`shasum -a 256` records:

| Package | Files | Aggregate SHA-256 |
|---|---:|---|
| `controller-housing-eol` | 40 | `ebff7329d1cc6bf63b13efadada2f3eeb6d8c17d30f414825ad6624f5d63d76f` |
| `hinge-block` | 28 | `0abeeeb4dda860c0ce40affd00f2f0ed5755f5ad3fc42513d250aa1816a26329` |
| `motor-mount` | 28 | `152a2ea89fa1c824e53d709446a687fc3891cc80641e14a3cb62c30593b5bebd` |
| `plate-with-holes` | 28 | `cb181dd072e026b6542bf710df64e5b5ea85682e2039bd6e33897776e1ff141f` |
| `quality-pass-bracket` | 28 | `52828beffa6a0b54f03234bacb960ca0f0f7cd4b0c50d2d41eea4f2aee590ad7` |

Keep command/status evidence ignored under:

- `tmp/codex/manufacturing-action-data-contract-v1-status.md`
- `tmp/codex/manufacturing-action-data-contract-v1-tool-evidence.md`
- `tmp/codex/manufacturing-action-data-contract-v1-verification-status.md`

## Verification order

1. Re-prove root, branch, HEAD, default branch, predecessor merge, and clean
   worktree.
2. Re-hash canonical package trees and authoritative/robot inputs.
3. Run contract/schema/catalog tests.
4. Run safe-snapshot, semantic reference, timeline, boundary, and lineage
   focused tests.
5. Run deterministic service and CLI integration twice at a fixed timestamp.
6. Verify the exact output set, manifest checksums, portable paths, and absence
   of machine/user paths.
7. Run atomic rollback, output-target substitution, and source-staleness tests.
8. Run supported full repository lanes.
9. Re-hash canonical packages and compare with the pinned table.
10. Capture diff before/after each independent read-only review.

## Contract and reference matrix

Positive verification must prove:

- all seven source feature IDs are admitted and no invented feature is emitted;
- all four quality IDs are admitted from config/inspection sources;
- all six robot joint IDs exist and no fabricated pose/limit is emitted;
- ten action IDs are unique and ordered;
- every episode segment resolves to exactly one action;
- every pre/postcondition transition is allowed;
- Korean and English instruction coverage is 100%;
- confidence is null/not applicable, not fabricated;
- unresolved tool/fixture/transform/trajectory requirements remain explicit;
- output lineage identity equals the config snapshot identity;
- output parents bind exact config, review, inspection, robot, and task bytes.

Negative and adversarial cases include:

| Category | Required cases |
|---|---|
| IDs | missing/duplicate action ID; duplicate segment; unknown action, feature, quality, joint, part, tool-interface |
| Languages | missing/blank/placeholder Korean or English instruction; missing origin/review flag |
| Timeline | reversed interval; overlap; non-monotonic order; invalid transition; required action omitted |
| Identity | wrong package slug, part ID, revision, config digest; alias conflict; missing lineage |
| Parents | stale config/review/inspection parent; parent path/hash/size mismatch |
| Parsing | duplicate JSON key; BOM; invalid UTF-8; oversized/nested/control-material input |
| Paths | traversal, backslash, NUL, outside-root, symlink/hardlink input substitution |
| TOCTOU | source changed after snapshot; same-byte inode replacement before commit |
| Boundaries | attempts to set real-data, CV, LeRobot, training, evidence, readiness, release, or production flags true |
| Output | duplicate/colliding names; symlink/hardlink target; directory replacement; mid-publication interruption and rollback |

Every failure must occur before a new complete-looking dataset is visible.
Stable diagnostics must identify stage, code, JSON pointer/path, message, and
remediation without leaking absolute private paths.

## Proof lineage verification

For successful runs:

1. read `configs/examples/hinge_block.toml` through the authoritative snapshot
   helper and require selected identity/digest equality;
2. read review and inspection JSON once and parse those exact bytes;
3. require proof mode explicitly; proof-looking fields alone do not activate it;
4. require review lineage to bind the authoritative config parent;
5. require inspection lineage to bind the authoritative config and exact review
   parent;
6. bind robot/task snapshots as explicit dataset parents;
7. recheck all five snapshots immediately before atomic commit.

Mutation after validation must return a stable stale/source-changed error and
must preserve prior output bytes exactly.

## Boundary verification

The schemas, semantic validator, generated outputs, handoff, manifests,
operator docs, CLI output, and PR body must agree that:

- the timeline is synthetic and curated;
- no real video or automatic segmentation exists;
- no CV model or ML confidence exists;
- no LeRobot export exists;
- outputs are not training-ready;
- outputs are not physical inspection evidence;
- readiness is not regenerated;
- no product/production release occurred;
- human review remains required.

Fixtures, CI, generated QA, and control material must not be relabeled as real
evidence.

## Determinism and manifest checks

Run two successful generations with the same input bytes and fixed
`generated_at`. Require:

- byte-identical six domain outputs;
- byte-identical artifact/output manifests;
- stable artifact IDs and ordering;
- identical member SHA-256 and size records;
- no UUID/random timestamp in proof outputs;
- no absolute repository, user, temporary, or run-specific paths;
- each manifest checksum equals the exact published member bytes.

The domain dataset manifest is acyclic: it binds sources, action dictionary,
episode annotation, and task plan, but not itself or later validation/handoff
files. The repository artifact/output manifests remain the execution manifests.

## Atomic publication verification

Prepare every payload before publication. Verify:

- one real output directory;
- eight unique fixed direct-child targets;
- full-set success in one transaction;
- no final file before commit begins;
- rollback restores all prior finals after each injected commit index;
- interrupted journals recover safely;
- directory or target identity substitution is rejected;
- locks/journals with duplicate keys or escaped paths are rejected;
- no orphan temp/backup/journal/lock remains after catchable success/failure.

## Legacy and canonical invariants

- `--proof-lineage` is a valueless explicit flag.
- Unsupported commands still reject it.
- Existing proof-lineage tests remain unchanged and passing.
- Existing non-proof/demo behavior remains loadable.
- No file under any `docs/examples/<package>` root changes.
- Canonical readiness remains `hold_for_evidence_completion`.
- No evidence, release, or authorization record is created.

## Validation ladder

Run the smallest relevant check after each milestone, then attempt and report:

```text
node --test tests/manufacturing-action-contracts.test.js
node --test tests/manufacturing-action-dataset.test.js
node --test tests/manufacturing-action-dataset-cli.test.js
node --test tests/manufacturing-action-dataset-security.test.js
node --test tests/atomic-output-publication-security.test.js
npm run manufacturing-action-dataset:doctor -- --clean
npm run test:node:contract
npm run test:node:integration
npm run test:snapshots
npm run test:py
npm run check:source-hygiene
npm run test:v1:acceptance
npm run bootstrap:doctor -- --clean
npm run maintainer:doctor -- --clean
npm test
```

Studio browser smoke is not required unless browser-facing files change.
FreeCAD runtime smoke is not required because the core makes no runtime-backed
claim. If a listed command cannot run, record the exact reason; never relabel it
as passed.

## Review protocol

### Skeptical architecture/data-contract review

Immediately before review, record `git status --short`,
`git diff --name-only`, and `git diff --check`. The reviewer focuses on:

- invented IDs or claims;
- wrong lineage/parent binding;
- schema/semantic gaps;
- manifest cycles or stale reads;
- nondeterminism and legacy regressions;
- scope drift into Studio, cloud, external evidence, or production indexing.

Record `git diff --name-only` immediately afterward. Any list change
invalidates the review.

### Security/input-safety review

Repeat the diff capture with a separate reviewer focused on:

- parser/path/symlink/hardlink handling;
- changed-after-verification races;
- output-directory/target substitution;
- boundary overrides and partial publication;
- absolute-path leakage and unsafe error reporting.

Fix every blocking/high-confidence in-scope finding and rerun affected tests
before a final no-drift review.

## Completion gate

Use `VERIFIED_SYNTHETIC_MANUFACTURING_DATA_SLICE` only when:

1. one exact proof identity and five exact source snapshots are reconciled;
2. all six domain outputs and two execution manifests validate;
3. reference, timeline, language, lineage, boundary, safety, and atomic tests
   pass;
4. fixed-time reruns are byte-identical;
5. canonical before/after hashes are identical;
6. required repository lanes pass or an independently reproduced baseline
   exception is accurately recorded;
7. skeptical and security reviews have no unresolved finding and no diff
   drift; and
8. the Draft PR reports the exact synthetic limitations and external holds.

The final report must separately retain:

```text
HUMAN_UAT: NOT_RUN
REAL_SHOP_FLOOR_DATA: NONE
COMPUTER_VISION: NOT_IMPLEMENTED
LEROBOT_EXPORT: NOT_IMPLEMENTED / NOT_CLAIMED
AUTHORITATIVE_BASELINE: HOLD
GENUINE_INSPECTION_INPUT: HOLD
CANONICAL_READINESS: UNCHANGED / HOLD
PRODUCTION_RELEASE: NOT_PERFORMED
```

## Recorded verification result before final review

- `npm ci`: passed; 74 packages installed and zero vulnerabilities reported.
- Focused contract, deterministic service, CLI, lineage, input-safety, and
  atomic-publication suites: passed.
- Fixed-time doctor rerun: passed with exactly eight files; the aggregate
  dataset digest was identical on both runs:
  `66353343edfa030e4427d30d7cf8b62b6250d726691b7c1b59af2c37094fe595`.
- `npm run test:node:contract`: passed.
- `npm run test:node:integration`: passed.
- `npm run test:snapshots`: passed.
- `npm run test:py`: 98 passed, 1 skipped.
- `npm run test:v1:acceptance`: passed.
- `npm run bootstrap:doctor -- --clean`: passed, 6 commands and 0 failures.
- `npm run maintainer:doctor -- --clean`: passed, 10 commands and 0 failures.
- `npm test`: passed.
- `npm run check:source-hygiene`: passed with no unexpected generated files
  outside the repository allowlists.
- All five canonical package aggregate hashes and the approved config/robot
  hashes matched the pinned pre-change values.
- A skeptical contract review found and remediation closed two validation
  gaps: every action now requires at least one grounded robot-joint reference,
  and revision-lineage parents must positionally equal the canonical ordered
  source snapshots. Focused suites and `npm test` passed after both fixes.
- Browser smoke and FreeCAD runtime smoke were not run because no
  browser-facing surface changed and this command makes no runtime-backed
  geometry claim.

Independent skeptical and security re-reviews passed with no unresolved
finding and no diff-inventory drift after the two contract remediations.
Commit, push, Draft PR publication, and its CI result remain the external
closeout steps.
