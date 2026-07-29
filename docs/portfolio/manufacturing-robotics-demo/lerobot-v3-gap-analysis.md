# LeRobot Dataset v3 gap analysis

- Comparison status: `DOCUMENTATION_ONLY`
- Current export status: `NOT_EXPORTABLE_YET`
- `LEROBOT_COMPATIBLE`: `false`
- `TRAINING_READY`: `false`
- Reference release: LeRobot `v0.6.0`
- Immutable reference commit: `30da8e687a6dfc617fcd94afc367ac7071c376ce`

This comparison is pinned to the released implementation and official source
documentation, not to a moving branch:

- [Dataset v3 source documentation](https://github.com/huggingface/lerobot/blob/30da8e687a6dfc617fcd94afc367ac7071c376ce/docs/source/lerobot-dataset-v3.mdx)
- [v3 porting documentation](https://github.com/huggingface/lerobot/blob/30da8e687a6dfc617fcd94afc367ac7071c376ce/docs/source/porting_datasets_v3.mdx)
- [Released dataset utilities](https://github.com/huggingface/lerobot/blob/30da8e687a6dfc617fcd94afc367ac7071c376ce/src/lerobot/datasets/utils.py)
- [Released constants](https://github.com/huggingface/lerobot/blob/30da8e687a6dfc617fcd94afc367ac7071c376ce/src/lerobot/utils/constants.py)
- [Released dataset writer](https://github.com/huggingface/lerobot/blob/30da8e687a6dfc617fcd94afc367ac7071c376ce/src/lerobot/datasets/dataset_writer.py)

Where prose and released code differ, this document uses the v0.6.0 released
code as the format authority. In particular, the released v3 layout uses
`meta/tasks.parquet`; an older `meta/tasks.jsonl` reference must not be copied
into an implementation contract.

## What the current demo already has

| Available semantic capability | Current evidence |
| --- | --- |
| Ordered action vocabulary | Ten stable action IDs and primitives |
| Episode-like segmentation | Ten contiguous semantic time segments in milliseconds |
| Bilingual task meaning | Korean and English human-review-required instructions |
| Robot/CAD/quality linkage | Joint, feature, tool, and quality-characteristic IDs |
| Provenance | Source snapshots, hashes, revision lineage, annotation origin |
| Validation/handoff | Closed schema, reference/timeline checks, manifests, role handoff |

These are useful source semantics for a future converter. They are not proof
that a LeRobot loader can open the output.

## Format blockers

| Missing capability | Why it blocks a v3 compatibility claim |
| --- | --- |
| Frame-level Parquet data | Current episode annotation is semantic JSON, not v3 frame tables under the required chunk/file layout. |
| Frame indices and timestamps | Millisecond segment bounds do not supply a row for each frame with dataset/episode/frame indices and synchronized timestamps. |
| Positive sampling FPS | The demo has segment durations but no declared, enforced frame sampling rate. |
| `meta/info.json` feature schema and counters | Current manifests describe this package, not the v3 repository paths, features, counts, and chunk metadata expected by LeRobot. |
| `meta/tasks.parquet` and episode metadata | Current task/action dictionaries are not the released v3 task and episode metadata tables. |
| Statistics | Required per-feature dataset/episode statistics are not produced. |
| Numeric `observation.state` and `action` vectors | Semantic joint IDs and text instructions are not sampled robot state/action tensors. |
| Finalized Parquet/chunk offsets | No v3 writer finalization, chunk boundaries, file offsets, or dataset-level indexes exist. |
| Loader validation | No output has been opened and validated by the pinned LeRobot v0.6.0 loader. |

## Vision modality gap, not a universal format rule

This inspection scenario would benefit from synchronized camera observations
for visible surface/feature review. The current demo has no images, video,
camera calibration, or automatic segmentation. That is a **vision-modality
gap for this use case**, not a universal v3 format requirement. It is not
correct to say that every LeRobot Dataset v3
must contain image files or MP4 video. The universal blockers for this output
are the missing frame tables, indices/timestamps/FPS, metadata, statistics,
numeric state/action data, finalization, and loader validation listed above.

## Bounded path toward a future adapter

1. Define a separate converter input contract that consumes the current
   semantic artifacts without changing them.
2. Add real or explicitly synthetic sampled numeric robot states/actions with
   an auditable FPS and timestamp policy.
3. If vision is in scope, add synchronized camera frames plus calibration and
   consent/data-governance controls; do not fabricate them from annotations.
4. Map features, tasks, episodes, indices, chunk paths, and statistics to the
   pinned v3 writer contract.
5. Finalize the dataset and test it with the exact pinned v0.6.0 loader in an
   isolated compatibility lane.
6. Keep `lerobot_compatible: false` and `training_ready: false` until those
   checks pass on actual exported bytes and the evidence is reviewed.

## 한국어 결론

현재 결과는 LeRobot 데이터셋이 아니라 설계·제조·품질의 관계를 설명하는
합성 의미 주석 계층이다. 미래 변환기의 좋은 입력 후보일 수는 있지만,
프레임 단위 수치 데이터와 v3 메타데이터, 통계, writer/loader 검증이 없으므로
호환 또는 학습 준비 상태로 표현하면 안 된다.
