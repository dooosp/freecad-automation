# Local-first product workflows

FreeCAD Automation turns FreeCAD configs and existing CAD files into traceable manufacturing review, revision-impact, inspection-planning, and evidence-onboarding artifacts. The local product surface has three guided workflows. Generated analysis remains review material; it never becomes physical inspection evidence by implication.

## 1. Create or import and review

Start with a versioned config, STEP/FCStd file, or existing review artifact.

```text
config or STEP/FCStd
  -> model, drawing, or import diagnostics
  -> review_pack.json
  -> readiness_report.json
  -> package artifacts
```

Primary commands are `check-runtime`, `create`, `draw`, `inspect`, `review-context`, `readiness-pack`, `pack`, and `serve`. Model creation, TechDraw, live CAD inspection, and other runtime-backed analysis require FreeCAD. Review-context, readiness packaging from a review pack, release-bundle packaging from an existing readiness report, and Studio shell startup are artifact-driven.

The next safe action follows explicit artifacts: create or import when no model exists, run `review-context` when no review pack exists, and run `readiness-pack` only from the intended review pack. A readiness report can remain `needs_more_evidence`; packaging it does not clear its gates or publish a release.

For a separately selected canonical package, the same artifact-driven path can
opt into revision-lineage proof mode. `--proof-lineage` requires an explicit
authoritative config at review ingress and carries its package slug, part ID,
revision, config digest, and exact parent digests through readiness, inspection
planning, standard docs, packaging, and tracked re-entry. It never supplies a
missing baseline, physical result, inspection evidence, or human authority. See
[revision-lineage proof mode](./revision-lineage-proof-mode.md).

## 2. Compare revisions and plan inspection

Start with baseline and candidate review packs.

```text
baseline review pack + candidate review pack
  -> revision impact
  -> reinspection requirements
  -> full or delta inspection plan
  -> checksheet, supplier request, and blank result template
```

Use `compare-rev` and then `inspection-plan`. These commands are artifact-driven and do not require FreeCAD when their inputs already exist. Stable change IDs and reinspection items remain visible. The plan and its derivatives are generated control material, not evidence. Proof-mode revision comparison additionally requires independently authoritative baseline and candidate config/review snapshots; without that baseline the selected-package edge remains held rather than deriving history from current files.

When a plan reaches `ready_for_human_release`, the next action is external engineering/quality review. The software must not create release authorization automatically. `inspection-plan-release-record` validates an explicit human authorization against the exact plan and distributed bytes; its scope is inspection execution only.

## 3. Receive and normalize completed inspection results

Start with an exact released plan, its immutable release record, an externally completed native `plan-result-csv-v1@1.0` file, and submission metadata.

```text
human-released plan + completed native CSV
  -> deterministic normalization and reconciliation
  -> ready_for_quarantine_review at most
  -> later human review and existing quarantine workflow
```

Use `inspection-plan-release-record` for the release handoff and `inspection-result-normalize` for the returned native CSV. Raw result bytes remain CLI-only: Studio does not upload supplier files or browse arbitrary filesystem paths. Reported and computed results remain separate, exact plan/release hashes must match, and incompatible or contradictory inputs block or require review.

Normalization creates no evidence envelope, authorization, attachment, readiness regeneration, product release, or publication. `ready_for_quarantine_review` means only that the deterministic software handoff completed and a human can begin the existing controlled review path.

## Readiness and evidence boundaries

- Readiness is a review conclusion from explicit artifacts, not proof that physical inspection occurred.
- A plan, checksheet, request, blank template, release record, normalization report, generated QA result, or synthetic fixture is not inspection evidence.
- Genuine evidence requires the separate quarantine, validation, authorization, attachment, and separately authorized readiness-regeneration contracts.
- Reading help, running `check-runtime`, reading checked-in artifacts, and opening Studio are safe orientation actions. Artifact-writing and state-control commands require explicit paths and authority.
- Hosted CI proves Node, Python, browser, and artifact contracts. Real FreeCAD runtime smoke remains a separate supported-machine lane.

See [command lifecycle](./command-lifecycle.md) for the complete discoverable surface and [support matrix](./support-matrix.md) for runtime coverage.
