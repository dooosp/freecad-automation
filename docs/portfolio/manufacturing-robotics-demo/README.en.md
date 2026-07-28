# Manufacturing Robotics Data Studio demo

- Document state: `PREPARED_FOR_P0`
- Approved profile: `hinge-block-synthetic-inspection-v1`
- Human UAT: `NOT_RUN`
- Human Korean/English meaning review: `NOT_RUN`
- LeRobot compatible: `FALSE`
- Training ready: `FALSE`

This demo connects a synthetic hinge-block design and inspection plan to a
reviewable manufacturing-robotics action dataset. From the existing Review
workspace, a user runs one approved profile, inspects how ten actions reference
CAD features, robot joints, and quality characteristics, and then reviews the
Design / Manufacturing / Quality handoff and its trust boundaries.

A successful run publishes all eight files atomically inside its job directory:

1. `manufacturing_action_dictionary.json`
2. `manufacturing_episode_annotation.json`
3. `manufacturing_data_validation_report.json`
4. `manufacturing_robotics_dataset_manifest.json`
5. `design_manufacturing_quality_handoff.json`
6. `design_manufacturing_quality_handoff.md`
7. `artifact-manifest.json`
8. `output-manifest.json`

The optional Revision B mismatch demonstration publishes no partial result. It
reports `REVISION_LINEAGE_IDENTITY_MISMATCH`, contrasts approved Revision A with
received Revision B, and stops at `0 / 8`. Its safe next action is to regenerate
the review artifact from the authoritative Revision A config.

## The 90-second idea

- Inputs are fixed, repository-owned synthetic fixtures; the browser cannot
  inject paths, hashes, or inline control documents.
- Generation is local and offline. It does not invoke FreeCAD, robot hardware,
  an external API, or a paid API.
- The result is a semantic annotation layer, not sensor measurements, physical
  inspection evidence, or computer-vision output.
- The result is not a LeRobot Dataset v3 export and is not claimed to be usable
  for training.
- Human review remains required. P0 technical rehearsal and P1–P5 human UAT are
  not evidence in this pack until they are actually completed.

## Document map

| Read | Question answered |
| --- | --- |
| [한국어 개요](README.ko.md) | Where is the Korean version? |
| [Problem and solution](problem-and-solution.md) | What problem does the demonstration make understandable? |
| [Architecture](architecture.md) | What boundaries connect the browser request to eight files? |
| [Talent evidence map](kia-talent-evidence-map.md) | What personal portfolio capabilities does the work evidence? |
| [Trust boundaries](trust-boundaries.md) | What is demonstrated, and what remains explicitly unproven? |
| [LeRobot v3 gap analysis](lerobot-v3-gap-analysis.md) | Why are compatibility and training readiness false? |
| [Korean 90-second script](demo-script-90sec.ko.md) / [English script](demo-script-90sec.en.md) | How should the short demonstration run? |
| [Korean 6-minute script](demo-script-6min.ko.md) | How should the architecture and decisions be explained? |
| [Korean interview Q&A](interview-questions.ko.md) / [English interview Q&A](interview-questions.en.md) | How can design choices be discussed without overclaiming? |
| [Human UAT session kit](human-uat-session-kit.md) | How are P0 and P1–P5 kept separate? |
| [Empty Round 1 aggregate](human-uat-round-1-aggregate.md) | Where can publishable counts be recorded? |
| [Screenshot capture list](screenshots/README.md) | Which actual browser evidence is still required? |

## Evidence boundary

Repository evidence covers fixed inputs, ten deterministic actions, schema and
lineage checks, atomic eight-file publication, and an intentional revision
mismatch block. It does not establish real shop-floor data, CV recognition,
physical inspection, an official Kia project, official DELMIA or
3DEXPERIENCE integration, engineering approval, production readiness, or a
production release.
