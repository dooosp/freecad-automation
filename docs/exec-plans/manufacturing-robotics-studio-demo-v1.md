# Manufacturing Robotics Studio Demo v1

## Status

- Owner: Codex
- Branch: `codex/manufacturing-robotics-studio-demo-v1`
- Base: `origin/master` at `57264a196b2f3ac5272aa8b78f0c35096a7925a0`
- Required predecessor: PR #198, merged as `57264a196b2f3ac5272aa8b78f0c35096a7925a0`
- Target internal status: `READY_FOR_HUMAN_UAT_AND_APPLICATION_DEMO`
- Human UAT and bilingual meaning review are explicitly outside this implementation phase.

## Goal

Turn the shipped CLI-only `manufacturing-action-dataset` workflow into a bounded, bilingual Studio demonstration that a first-time user can run and understand. Reuse the existing service and exact-eight-output contract through the existing Review workspace, Local API, tracked job executor, and registered artifact preview.

The demonstration must make these relationships legible without inventing evidence:

```text
approved synthetic profile
  -> exact-byte lineage inputs
  -> ten deterministic manufacturing actions
  -> CAD feature / robot joint / quality characteristic links
  -> Design / Manufacturing / Quality handoff
  -> explicit trust and LeRobot v3 gaps
```

## Non-goals and truth boundaries

- Do not add a sixth Studio surface or change existing routes.
- Do not duplicate dataset generation or validation in browser, API, or executor code.
- Do not expose arbitrary paths, uploads, revisions, hashes, output directories, or inline task/config JSON.
- Do not change canonical hinge-block packages, evidence, readiness, standard-doc, or release artifacts.
- Do not weaken proof lineage, exact-byte reads, atomic publication, or exact-eight-output behavior.
- Do not add FreeCAD, robot hardware, external/paid API, Hub, or normal-runtime network dependencies.
- Do not claim real shop-floor data, computer vision, physical inspection evidence, engineering approval, production readiness, LeRobot compatibility, exportability, or training readiness.
- Do not execute or fabricate human UAT.

## Pinned evidence

### Repository and predecessor

- Git root basename: `freecad-automation`
- Default branch: `origin/master`
- Candidate base and PR #198 merge SHA: `57264a196b2f3ac5272aa8b78f0c35096a7925a0`
- PR #198 implementation head: `3bf96b025841f485bf311046d4325e6a14b7507a`

### Approved profile source identities

The server-owned profile is `hinge-block-synthetic-inspection-v1`. Before implementation, the authoritative existing source hashes were recorded as:

| Input | Repository path | SHA-256 |
| --- | --- | --- |
| CAD config | `configs/examples/hinge_block.toml` | `992cf687e1da65f9ac89c12bd36ad7cd2b57367deb0cc6d50a74d4c03b7a52d1` |
| Robot config | `configs/examples/robot_arm_6axis.toml` | `afa6ab4970687c062b569618c81f8661d6865cfc1324764b25dc40f3168d4368` |
| Curated task plan | `configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json` | `fceb305e28f9ad6dee3dc8b460055b7dd454149e9fb38991a41feddea81f3589` |

The profile adds repository-owned proof review and inspection-plan fixtures. Their pinned bindings are verified on every run:

| Fixture | SHA-256 | Bytes |
| --- | --- | ---: |
| Revision A review pack | `edc47d89e71b4cd02a8d7e4f610e767bc835d1d5a2c5c963980b9a6af5d1383c` | 785 |
| Revision A inspection plan | `01d1514141313e7cad0b00efd66ef403c3f3d09dfb26f30dcd852200aed8264e` | 2523 |
| Revision B bounded-mismatch review pack | `cf7b52374539a53f8a54505ad9e243fb34dfc6ef8db23613c20c3064c2f44667` | 785 |

### Canonical before hashes

These aggregates are the mutation guard for the five canonical package directories:

| Package | Files | Aggregate SHA-256 |
| --- | ---: | --- |
| `controller-housing-eol` | 40 | `ebff7329d1cc6bf63b13efadada2f3eeb6d8c17d30f414825ad6624f5d63d76f` |
| `hinge-block` | 28 | `0abeeeb4dda860c0ce40affd00f2f0ed5755f5ad3fc42513d250aa1816a26329` |
| `motor-mount` | 28 | `152a2ea89fa1c824e53d709446a687fc3891cc80641e14a3cb62c30593b5bebd` |
| `plate-with-holes` | 28 | `cb181dd072e026b6542bf710df64e5b5ea85682e2039bd6e33897776e1ff141f` |
| `quality-pass-bracket` | 28 | `52828beffa6a0b54f03234bacb960ca0f0f7cd4b0c50d2d41eea4f2aee590ad7` |

## Pinned LeRobot v3 reference

Compatibility claims are bounded to the official LeRobot v0.6.0 dataset v3 documentation and released implementation at commit `30da8e687a6dfc617fcd94afc367ac7071c376ce`:

- `https://github.com/huggingface/lerobot/blob/30da8e687a6dfc617fcd94afc367ac7071c376ce/docs/source/lerobot-dataset-v3.mdx`
- `https://github.com/huggingface/lerobot/blob/30da8e687a6dfc617fcd94afc367ac7071c376ce/docs/source/porting_datasets_v3.mdx`
- `https://github.com/huggingface/lerobot/blob/30da8e687a6dfc617fcd94afc367ac7071c376ce/src/lerobot/datasets/utils.py`

The comparison is documentation-only. Runtime and tests remain offline. Current output is a semantic manufacturing annotation layer, not a LeRobot dataset. Image/video observations are a missing vision-modality capability for this inspection demo, not a universal v3 format requirement; the actual format blockers are frame-level Parquet data, indices/timestamps/FPS, metadata, statistics, numeric state/action vectors, and loader validation.

## Architecture

### Browser boundary

The only success request exposed by Studio is equivalent to:

```json
{
  "type": "manufacturing-action-dataset",
  "demo_profile": "hinge-block-synthetic-inspection-v1"
}
```

The only bounded negative request adds:

```json
{
  "trust_demo": "revision-mismatch"
}
```

Both values are closed enumerations. The Studio bridge injects the fixed proof-lineage policy. It rejects path, upload, output, config, robot, task-plan, revision, hash, and arbitrary option fields.

### Server-owned profile

A production module owns the profile registry and resolves repository-relative, fixed inputs:

- `configs/examples/hinge_block.toml`
- proof review pack for `hinge-block / hinge_block / Revision A`
- proof inspection plan linked to that review pack
- `configs/examples/robot_arm_6axis.toml`
- `configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json`
- a repository-owned Revision B review fixture used only by the bounded failure demonstration

Resolution verifies the exact SHA-256 of each source before invoking the existing service. The profile cannot be extended through request data.

### Tracked execution

```text
Review card
  -> Studio bridge schema
  -> POST /jobs
  -> job executor handler
  -> existing generateManufacturingActionDataset service
  -> job-owned artifacts directory
  -> all-or-nothing eight outputs
  -> registered artifact list and safe previews
```

The handler records effective profile identity, source hashes, proof-lineage policy, boundaries, and artifact hashes in safe job result/diagnostic metadata. Successful jobs register exactly these eight files:

1. `manufacturing_action_dictionary.json`
2. `manufacturing_episode_annotation.json`
3. `manufacturing_data_validation_report.json`
4. `manufacturing_robotics_dataset_manifest.json`
5. `design_manufacturing_quality_handoff.json`
6. `design_manufacturing_quality_handoff.md`
7. `artifact-manifest.json`
8. `output-manifest.json`

The bounded mismatch uses the same service. Its underlying identity failure is mapped only at this profile boundary to `REVISION_LINEAGE_IDENTITY_MISMATCH`, reports expected Revision A and received Revision B, publishes `0 / 8` dataset artifacts, and provides the safe regeneration action.

## Studio design

Add one `Manufacturing Robotics Data` / `제조 로봇 데이터` card in Review immediately after the beginner summary and before advanced tools. Do not add navigation or route state.

### Before run

Show the approved input identities, expected outputs, and effect summary. It must explicitly state: local/offline; no FreeCAD runtime; no robot hardware; no external or paid API; job-directory-only writes; synthetic input; no CV; no LeRobot export; human review required.

### Successful run

- A semantic ordered list renders all ten actions.
- Native buttons select an action, expose visible focus, and mark the current step semantically.
- Detail renders ID, primitive, Korean and English instructions, actor/tool, target part, CAD feature IDs, quality references, actual joint IDs, preconditions, postconditions, annotation origin, and human-review status.
- Quality summary renders counts, coverage, transition/timeline checks, lineage, boundaries, and the explicit `VALID SYNTHETIC DEMO` status.
- Handoff renders separate Design, Manufacturing, Quality, and Trust sections.
- LeRobot panel shows the exact available and missing capabilities and preserves `NOT_EXPORTABLE_YET`, `LEROBOT_COMPATIBLE: false`, and `TRAINING_READY: false`.
- Result files remain the existing destination for all eight artifacts.

### Blocked run

The optional bounded trust demonstration displays `BLOCKED`, stable reason code, expected/received identities, `0 / 8`, and the next safe action. It does not publish partial success artifacts.

### Accessibility and locale

- Reuse the existing EN/KO locale dictionaries; no Korean literals in Studio JavaScript.
- Keep one primary action per stage.
- Use native controls and screen-reader names; do not rely on color alone.
- Support keyboard operation, visible focus, 200% zoom, reduced motion, and 320/768/1024/1440 px widths without horizontal page overflow.

## Portfolio and UAT preparation

Create the bilingual portfolio pack under `docs/portfolio/manufacturing-robotics-demo/`, including the twelve requested narrative/script/interview files and actual local browser screenshots. Language must preserve all truth boundaries.

Prepare a five-person UAT session kit and count-only aggregate template. The committed aggregate must contain no participant-identifying or fabricated result data. Thresholds are MR-UAT-01 through MR-UAT-08 from the goal brief. Human bilingual review and P1-P5 execution remain explicit holds.

## Implementation phases

### Phase 1 — plan and fixture freeze

1. Record preflight, predecessor merge, source hashes, canonical hashes, and LeRobot reference.
2. Add this execution plan and its verification companion.
3. Add minimal repository-owned proof review, proof inspection, and mismatch fixtures.
4. Pin and test their exact source hashes without changing canonical packages.

### Phase 2 — safe profile and tracked job

1. Add the closed server profile registry.
2. Add command-manifest surfaces and closed Local API schema.
3. Add Studio bridge translation with fixed proof lineage.
4. Add a job executor handler that delegates to the existing dataset service.
5. Register exactly eight successful outputs and stable safe failure diagnostics.
6. Add focused profile, schema, bridge, executor, artifact, and mismatch tests.

### Phase 3 — Review demonstration

1. Add a small dedicated card/view-model module.
2. Extend the tracked submission path only for the enumerated profile and trust demo.
3. Load registered artifacts through existing safe artifact links.
4. Render pre-run, timeline, quality, handoff, trust, gaps, and blocked states.
5. Add bilingual strings, responsive styling, accessibility behavior, and Result-files classification.
6. Add focused DOM, i18n, responsive, keyboard, and request-boundary tests.

### Phase 4 — portfolio and UAT packet

1. Write the bilingual portfolio and demo scripts.
2. Write the pinned LeRobot gap analysis and trust boundaries.
3. Prepare the private-record protocol and count-only aggregate template.
4. Capture only actual P0 browser screenshots.

### Phase 5 — validation, rehearsal, review, and Draft PR

1. Run focused validations after each milestone and all required full lanes.
2. Verify deterministic output, exact hashes, no runtime/test network, and unchanged canonical aggregates.
3. Freeze a commit; rehearse from a clean detached worktree with isolated job store and loopback port.
4. Exercise success and mismatch paths in Korean and English, keyboard, 200% zoom, reduced motion, and required viewports.
5. Stop the server and prove the port closed and candidate stayed clean.
6. Run three read-only reviews with diff-name guards: product/data, security/input, accessibility/bilingual.
7. Fix blocking in-scope findings, rerun affected checks, freeze the final candidate, push once, and open one Draft PR.

## Stop conditions

Stop and report truthfully if repository identity/base becomes ambiguous, exact-eight output or proof-lineage behavior would need weakening, arbitrary browser filesystem access or a sixth surface becomes necessary, canonical artifacts require mutation, primary-source LeRobot requirements cannot be verified, real/private data or credentials are required, or a verified in-scope blocker survives repair.

## Completion contract

`READY_FOR_HUMAN_UAT_AND_APPLICATION_DEMO` is allowed only after implementation, focused and full validation, detached-worktree P0, determinism/canonical guards, screenshots, and all three guarded reviews pass. The final report must separately retain every human, evidence, compatibility, readiness, and release hold required by the goal brief.
