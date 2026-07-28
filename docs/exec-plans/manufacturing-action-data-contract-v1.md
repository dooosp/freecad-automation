# Manufacturing Action Data Contract v1

## Status and pinned context

- Plan state: `VERIFIED_LOCALLY_PUBLICATION_PENDING`
- Repository: `freecad-automation`
- Base: `origin/master` at
  `ea1ff2b722756054a9118cedb308f29e88d89077`
- Predecessor: PR #197, merged as
  `ea1ff2b722756054a9118cedb308f29e88d89077`
- Branch: `codex/manufacturing-action-data-contract-v1`
- Selected package: `hinge-block`
- Authoritative identity: `hinge-block` / `hinge_block` / revision `A`
- Authoritative config: `configs/examples/hinge_block.toml`
- Config SHA-256:
  `992cf687e1da65f9ac89c12bd36ad7cd2b57367deb0cc6d50a74d4c03b7a52d1`
- Robot config: `configs/examples/robot_arm_6axis.toml`
- Verification companion:
  `docs/exec-plans/manufacturing-action-data-contract-v1-verification.md`

This goal is authorized as the first post-lineage implementation slice. It is
an offline synthetic manufacturing-data and portfolio feature. It does not
alter canonical readiness, attach evidence, create a product release, claim
shop-floor data, or close the external production-proof roadmap gates.

## Goal

Add one explicit experimental command that combines the approved hinge-block
proof identity, a proof review pack, a proof inspection plan, the existing
six-axis robot config, and one curated task plan into a deterministic,
traceable synthetic manufacturing robotics dataset slice.

The command is:

```text
fcad manufacturing-action-dataset \
  --config <authoritative-config> \
  --review-pack <proof-review-pack> \
  --inspection-plan <proof-inspection-plan> \
  --robot-config <robot-config> \
  --task-plan <task-plan.json> \
  --proof-lineage \
  --generated-at <iso8601> \
  --out-dir <directory>
```

It is direct-invocation and `help --all` visible, but hidden from the default
guided help surface. Its core is plain Node and artifact-driven; it makes no
FreeCAD runtime claim.

## Factual input boundary

The checked-in `docs/examples/hinge-block/review/review_pack.json` is legacy:
its revision is null and it has no `revision_lineage`. No checked-in
`inspection_plan.json` exists. They are therefore proof-ineligible.

Acceptance and doctor rehearsals must create proof review/readiness/inspection
inputs in ignored `tmp/codex/` or `output/` directories through the existing
proof-mode builders. Nothing under `docs/examples/hinge-block` may be
regenerated or edited by this goal.

The source-established reference universe is:

- part: `hinge_block`;
- features: `base_block`, `left_ear`, `right_ear`, `hinge_pin_left`,
  `hinge_pin_right`, `mount_hole_left`, `mount_hole_right`;
- quality: `cd-01`, `cd-02`, `ftp-01`, `ftp-02`;
- robot joints: `j1_base_yaw`, `j2_shoulder_pitch`, `j3_elbow_pitch`,
  `j4_wrist_yaw`, `j5_wrist_pitch`, `j6_wrist_roll`;
- robot tool interface: `tool_flange`.

The repository does not establish a gripper, probe, fixture entity, TCP,
trajectory, joint targets, collision model, coordinate transform, or released
numeric tolerance. The task plan must not invent them. It may reference the
grounded `tool_flange` interface and must record the unresolved gripper,
probe, fixture, transform, and trajectory needs for human review.

## Outputs

The caller-selected ignored output directory contains exactly:

```text
manufacturing_action_dictionary.json
manufacturing_episode_annotation.json
manufacturing_data_validation_report.json
manufacturing_robotics_dataset_manifest.json
design_manufacturing_quality_handoff.json
design_manufacturing_quality_handoff.md
artifact-manifest.json
output-manifest.json
```

All eight files are prepared in memory and committed by one atomic output-set
transaction. No valid-looking partial dataset may be published.

## Architecture

### Contract family

Add JSON Schema 2020-12 contracts under `schemas/` for:

1. shared identity, lineage, boundary, source-snapshot, and reference fields;
2. curated manufacturing task plan;
3. manufacturing action dictionary;
4. manufacturing episode annotation;
5. manufacturing data validation report;
6. manufacturing robotics dataset manifest; and
7. design/manufacturing/quality handoff JSON.

`lib/manufacturing-action-contracts.js` owns the schema registry, AJV
validation, stable semantic diagnostics, canonical JSON serialization, and
artifact catalog. Every root schema is closed with
`additionalProperties: false`, uses schema version `1.0`, and requires a stable
artifact ID.

### Service

`src/services/manufacturing-action-dataset/manufacturing-action-dataset-service.js`
owns the bounded pipeline:

1. validate explicit proof activation and selected package path;
2. read config, review pack, inspection plan, robot config, and task plan once;
3. parse only detached snapshot bytes;
4. reconcile one authoritative lineage identity and exact parents;
5. build the action dictionary and deterministic episode timeline;
6. validate references, transitions, languages, timeline, lineage, and fixed
   synthetic boundaries;
7. build dataset manifest, validation report, and handoff views;
8. build existing artifact/output manifests from precomputed records;
9. revalidate source snapshots immediately before commit; and
10. atomically publish all eight files.

The service reuses:

- `readAuthoritativeConfigSnapshot()`;
- `readRevisionLineageFileSnapshot()`;
- `parseInspectionEvidenceJsonBytes()`;
- `assertRevisionLineageSnapshotCurrent()`;
- existing revision-lineage identity/parent agreement helpers;
- `buildArtifactManifest()` and `buildOutputManifest()`;
- `publishAtomicOutputSet()`.

No database, workflow engine, job platform, or second manifest system is
introduced.

### Narrow shared compatibility changes

- Extend `buildOutputManifest()` with validated precomputed input/output
  records so proof callers do not re-open verified paths before atomic
  publication. Existing callers keep current behavior.
- Harden the existing atomic publisher's directory identity and journal parsing
  only as required to reject ancestor substitution and duplicate-key journals.
  Preserve its public API and existing callers.

### CLI and lifecycle

`bin/fcad.js` parses the command and delegates to the service. The command is
registered in `src/shared/command-manifest.js` as:

- lifecycle: `experimental`;
- runtime: `plain-python-node`;
- audience: engineer;
- default guided help: hidden;
- Studio/job/Local API surfaces: absent;
- safety boundary: synthetic data only, no evidence/readiness/release mutation.

Exactly one new `fcad` command is added. A demo doctor is a repository-owned
script/package command that invokes the same service; it is not a second
public command.

## Data model

### Task plan

The checked-in curated input contains exactly ten ordered actions:

1. `approach_hinge_block`
2. `grasp_hinge_block`
3. `transport_to_fixture`
4. `align_mounting_interface`
5. `seat_on_fixture`
6. `probe_left_hinge_pin`
7. `probe_right_hinge_pin`
8. `inspect_hinge_ears`
9. `inspect_mounting_holes`
10. `release_and_retract`

Each step declares stable references, deterministic duration, allowed
transition, bilingual human-authored instruction, pre/postconditions,
`human_review_required`, and any unresolved requirement. The task plan does
not contain joint poses or ML confidence.

### Action dictionary

Each action includes:

- action ID and primitive;
- actor type;
- grounded tool-interface, part, feature, quality, and robot-joint refs;
- preconditions/postconditions and allowed neighbors;
- Korean/English instruction;
- `instruction_origin: human_authored`;
- `human_review_required: true`; and
- unresolved non-grounded engineering needs.

### Episode annotation

The episode is a synthetic timeline derived only from the ordered task plan.
Segments are non-overlapping, monotonic, stable-ID records. The source is
`synthetic_task_timeline`, annotation origin is `curated_task_plan`, and
confidence is null/not applicable because no model produced the labels.

### Mandatory fixed boundaries

Relevant outputs encode and validators enforce:

```text
synthetic_demo: true
real_shop_floor_data: false
automatic_video_segmentation: false
computer_vision_model_used: false
lerobot_compatible: false
training_ready: false
inspection_evidence: false
evidence_attached: false
readiness_regenerated: false
product_release: false
production_readiness: false
human_review_required: true
```

Callers cannot override these values in v1.

### Dataset manifest and validation report

The domain dataset manifest binds exact bytes for the source snapshots, action
dictionary, episode annotation, and task plan. It does not hash itself or
later validation/handoff outputs.

The validation report records:

- action and segment counts;
- unique primitive count;
- feature, joint, quality, Korean, and English coverage;
- unknown/duplicate reference counts;
- transition/timeline violations;
- lineage and boundary status; and
- overall status `blocked`, `review_required`, or `valid_synthetic_demo`.

Unresolved physical tooling/fixture/trajectory requirements require human
review but do not turn truthful synthetic data into a false physical claim.

### Handoff

The canonical JSON and derived Markdown separate:

- Design: part, features, revision, source digest;
- Manufacturing: action sequence, robot/tool-interface refs, pre/postconditions;
- Quality: characteristics and inspection-plan refs;
- Trust: exact hashes, lineage status, synthetic boundaries, and remaining
  holds.

The handoff grants no engineering, quality, inspection, readiness, or release
approval.

## Security and integrity invariants

- Every input is repo-relative, bounded, regular, non-symlink, single-link,
  strict UTF-8, and read once with no-follow semantics.
- JSON duplicate keys, BOM, unsafe nesting/control material, traversal,
  backslashes, NUL, and path escape fail closed.
- Config identity must exactly equal the approved selection and config digest.
- Review and inspection identities and exact parent references must reconcile
  with the trusted config/review snapshots.
- Robot, task, feature, quality, joint, action, and segment references are
  closed against their source universes.
- Source replacement or mutation after verification fails before publication.
- Output names are fixed direct children of one caller-selected directory under
  `output/` or `tmp/codex/`.
- Output directory/targets cannot be symlink/hardlink aliases or change after
  preflight.
- Atomic rollback restores existing outputs after catchable interruption.

## Documentation and examples

Add:

- `docs/guides/manufacturing-action-dataset.md` with operator commands, field
  mappings, boundaries, Korean/English portfolio positioning, and limitations;
- a generated schema catalog block kept in sync from the contract registry;
- `configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json`;
- `scripts/manufacturing-action-dataset-doctor.js` and one package script.

No generated dataset output is committed. No Kia, DELMIA, 3DEXPERIENCE,
LeRobot, shop-floor, training-ready, inspection-evidence, or production-ready
integration claim is made.

## Implementation phases

### Phase 1 — Plan, contracts, and grounded example

- Add this plan and companion.
- Add the schema registry, schemas, task plan, catalog sync, and contract tests.

Acceptance: valid grounded task plan passes; schema/semantic negative cases
produce stable diagnostics.

### Phase 2 — Safe service and deterministic artifacts

- Implement read-once input reconciliation and domain artifact builders.
- Add fixed boundary enforcement, validation metrics, and handoff renderers.
- Add precomputed output-manifest support and narrow atomic hardening.

Acceptance: in-memory outputs validate and two fixed-time runs are byte-identical.

### Phase 3 — CLI, manifests, atomic publication, and doctor

- Add the single experimental command and lifecycle metadata.
- Publish all eight files atomically.
- Add the repository-owned demo doctor and exact operator docs.

Acceptance: successful CLI/doctor run produces the exact output set; failures
produce no new partial set and preserve existing outputs.

### Phase 4 — Full verification, review, and Draft PR

- Run the companion verification matrix.
- Perform independent skeptical architecture/data-contract review.
- Perform separate security/input-safety review.
- Fix blocking findings and rerun affected checks.
- Commit, push, open one Draft PR, update its evidence, and repair in-scope CI.

Acceptance: internal status may become
`VERIFIED_SYNTHETIC_MANUFACTURING_DATA_SLICE`; all external holds remain.

## Implementation ledger

- [x] PR #197 merged and predecessor implementation present on `master`.
- [x] Clean isolated worktree and branch created from merged `master`.
- [x] Repository/input/command/canonical hash preflight recorded.
- [x] Execution and verification plans written before implementation.
- [x] Contract family and grounded task plan implemented.
- [x] Safe deterministic dataset service implemented.
- [x] CLI, manifests, atomic publication, doctor, and docs implemented.
- [x] Focused/full verification and canonical hash comparison passed.
- [x] Skeptical and security reviews passed without diff drift.
- [ ] Commit, push, Draft PR, and CI closeout completed.
