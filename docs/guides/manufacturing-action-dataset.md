# Manufacturing Action Dataset

`manufacturing-action-dataset` is an experimental, direct-invocation CLI for
building one deterministic offline synthetic manufacturing robotics dataset.
It joins the approved hinge-block proof identity, a proof review pack, a proof
inspection plan, the checked-in six-axis robot configuration, and the curated
task plan. The command is intentionally absent from the default guided help;
use `fcad help --all` or `fcad help manufacturing-action-dataset` to inspect
its contract.

## Generate a dataset

The review pack and inspection plan must be created through the existing
proof-lineage builders in an ignored directory. The legacy checked-in
`docs/examples/hinge-block/review/review_pack.json` has no proof lineage, and
there is no checked-in proof inspection plan, so neither may be substituted as
a proof input.

```bash
fcad manufacturing-action-dataset \
  --config configs/examples/hinge_block.toml \
  --review-pack tmp/codex/<proof-run>/review_pack.json \
  --inspection-plan tmp/codex/<proof-run>/inspection_plan.json \
  --robot-config configs/examples/robot_arm_6axis.toml \
  --task-plan configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json \
  --proof-lineage \
  --generated-at 2026-07-28T00:00:00.000Z \
  --out-dir output/manufacturing-action-dataset
```

All paths are repo-relative. The output directory must be an ignored direct
descendant of `output/` or `tmp/codex/`. `--proof-lineage` is a valueless,
mandatory opt-in. `--generated-at` must be a calendar-valid UTC timestamp in
`YYYY-MM-DDTHH:mm:ssZ` form, optionally with exactly three fractional digits,
so the output is reproducible.

The command uses plain Node and detached artifact snapshots. It does not need
or launch FreeCAD, communicate with robot hardware, or call a network service.

## Input mapping

| Input | Contract role |
| --- | --- |
| `configs/examples/hinge_block.toml` | Authoritative package, part, revision, feature, and quality identity |
| Proof `review_pack.json` | Config-bound review snapshot and source lineage |
| Proof `inspection_plan.json` | Exact review/config-bound inspection control-material snapshot |
| `configs/examples/robot_arm_6axis.toml` | Grounded six-axis joint and `tool_flange` reference universe |
| Curated task plan | Ten ordered bilingual, human-authored synthetic actions and unresolved engineering needs |

The closed source universe is:

- part: `hinge_block`;
- features: `base_block`, `left_ear`, `right_ear`, `hinge_pin_left`,
  `hinge_pin_right`, `mount_hole_left`, `mount_hole_right`;
- quality characteristics: `cd-01`, `cd-02`, `ftp-01`, `ftp-02`;
- robot joints: `j1_base_yaw`, `j2_shoulder_pitch`, `j3_elbow_pitch`,
  `j4_wrist_yaw`, `j5_wrist_pitch`, `j6_wrist_roll`; and
- tool interface: `tool_flange`.

Unknown references fail validation instead of being inferred.

## Output set

One successful atomic publication contains exactly eight files:

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

The action dictionary and episode annotation are derived from the ten ordered
task-plan actions. The validation report records reference, transition,
timeline, lineage, boundary, and Korean/English coverage. The domain dataset
manifest binds the exact source, dictionary, episode, and task-plan bytes. The
handoff separates design, manufacturing, quality, and trust context. The
repository artifact and output manifests remain the execution manifests; this
feature does not introduce a second manifest system.

## Offline doctor

Run the repository-owned doctor to build temporary proof inputs with the
existing CLI builders and exercise the same dataset service end to end:

```bash
npm run manufacturing-action-dataset:doctor -- --clean
```

The default doctor root is
`output/manufacturing-action-dataset-doctor/`; proof inputs and the generated
eight-file dataset stay ignored. You may pass a different ignored child path
with `--out-dir` and a fixed UTC time with `--generated-at`.

## Trust boundary and portfolio wording

Every generated dataset retains these fixed truths: it is a synthetic demo;
real shop-floor data, automatic video segmentation, computer vision, LeRobot
compatibility, training readiness, inspection evidence, evidence attachment,
readiness regeneration, product release, and production readiness are false;
human review is required.

English positioning: “Offline synthetic manufacturing-action data contract
demonstrating traceable design/manufacturing/quality handoff and bilingual
annotation.”

Korean positioning: “설계·제조·품질 연결과 한·영 병기 주석을 보여 주는 오프라인
합성 제조 액션 데이터 계약 예제입니다. 실제 생산·검사·로봇 실행 데이터가
아니며 사람의 검토가 필요합니다.”

The repository establishes no gripper, probe, fixture entity, TCP, coordinate
transform, collision model, trajectory, joint target, released numeric
tolerance, real video, or ML confidence. Those remain explicit unresolved
requirements. Do not describe this output as Kia, DELMIA, 3DEXPERIENCE,
LeRobot, shop-floor, inspection-evidence, training-ready, or production-ready
integration.
