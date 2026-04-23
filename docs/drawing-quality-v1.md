# Drawing Quality v1

Drawing Quality v1 is the verified drawing-quality workflow shipped on `master` at commit `9b27d8612bd2c48f2fc4331b1ccfab591f4f388b` after PR #45.

This document is the baseline reference for the v1 workflow, evidence model, runtime expectations, and known limitations. It documents shipped behavior only. It does not add new product scope, change manufacturing-readiness logic, or promote advisory semantic gaps into blockers.

## Overview

The v1 workflow is:

1. `drawing_intent`
2. `feature_catalog`
3. drawing generation
4. `extracted_drawing_semantics`
5. `drawing_quality.semantic_quality`
6. advisory `drawing_quality.layout_readability`
7. advisory `drawing_quality.reviewer_feedback`
8. `drawing_planner` suggested actions
9. output, report, and artifact manifests
10. Studio Quality Dashboard
11. manufacturing readiness decision
12. semantic, runtime, and browser regression coverage

## Workflow

| Stage | Source of truth | Output artifact |
| --- | --- | --- |
| `drawing_intent` | `lib/drawing-intent.js`, `schemas/drawing-intent.schema.json` | `<base>_drawing_intent.json` |
| `feature_catalog` | `lib/feature-catalog.js`, `schemas/feature-catalog.schema.json` | `<base>_feature_catalog.json` |
| drawing generation | `bin/fcad.js`, `src/orchestration/draw-pipeline.js` | `<base>_drawing.svg`, `<base>_drawing_qa.json` |
| `extracted_drawing_semantics` | `src/services/drawing/extracted-drawing-semantics.js`, `schemas/extracted-drawing-semantics.schema.json` | `<base>_extracted_drawing_semantics.json` |
| `drawing_quality.semantic_quality` | `src/services/drawing/drawing-quality-summary.js` | `<base>_drawing_quality.json` |
| `drawing_quality.layout_readability` | `src/services/drawing/layout-readability.js` | `<base>_drawing_quality.json` |
| `drawing_quality.reviewer_feedback` | `src/services/drawing/reviewer-feedback.js`, `schemas/reviewer-feedback.schema.json` | `<base>_drawing_quality.json` |
| `drawing_planner` | `src/services/drawing/drawing-planner.js` | `<base>_drawing_planner.json` |
| `report_summary` | `src/services/report/decision-report-summary.js`, `schemas/report-summary.schema.json` | `<base>_report_summary.json` |
| output manifests | `lib/output-manifest.js`, `bin/fcad.js`, `src/services/jobs/job-executor.js` | `<base>_drawing_manifest.json`, `<base>_report_manifest.json`, `*_artifact-manifest.json` |
| Studio Quality Dashboard | `public/js/studio/quality-dashboard.js`, `public/js/studio/artifacts-workspace.js`, `public/js/studio/studio-shell-job-monitor.js` | browser-visible quality evidence |

## Artifacts

Drawing Quality v1 expects these additive drawing-side artifacts when the workflow runs successfully enough to emit draw/report evidence:

- `drawing_intent.json`
- `feature_catalog.json`
- `drawing.svg`
- `drawing_qa.json`
- `drawing_quality.json`
- `drawing_planner.json`
- `extracted_drawing_semantics.json`
- `drawing_manifest.json`
- `report_summary.json`
- `report_manifest.json`

Generated artifacts remain under `output/`.

## Readiness Rules

- Manufacturing readiness is still decided by required Geometry, Drawing, and DFM gates.
- Job execution success does not automatically mean quality pass.
- Quality pass does not automatically mean every advisory semantic gap is resolved.
- Extracted drawing semantics are visible evidence, not an automatic override of required gates.
- Unknown, unsupported, or low-confidence extracted evidence must not be promoted into confirmed extracted evidence.
- Reviewer feedback remains explicit, traceable, and advisory-only.
- Reviewer feedback must not satisfy missing required evidence or change manufacturing readiness.
- Required vs optional remains separate from advisory vs blocking.

## Required Vs Advisory Semantics

- Extracted-semantics gaps are advisory by default.
- Advisory semantic gaps must not become manufacturing blockers unless an explicit enforceable policy is introduced.
- Optional or advisory semantics must not be shown as blockers when required gates fail.
- Unknown dimensions or notes remain unknown when evidence is insufficient.
- The separation between execution success, drawing-quality result, and manufacturing readiness must remain intact.

## Verified v1 Regression Outcome

Audit validation was run from a fresh worktree on `origin/master` at commit `9b27d8612bd2c48f2fc4331b1ccfab591f4f388b`.

Commands run:

- `npm ci`
- `npm test`
- `npm run check:runtime`
- `npm run test:runtime-smoke`
- `node tests/runtime-smoke-cli.js`
- `node tests/drawing-semantic-regression.test.js`
- `node tests/extracted-drawing-semantics.test.js`
- `node tests/drawing-quality-summary.test.js`
- `node tests/drawing-planner.test.js`
- `node tests/output-manifest.test.js`
- `node tests/report-decision-summary.test.js`
- `node tests/studio-quality-dashboard.test.js`
- `node tests/studio-shell-browser-smoke.test.js`
- `node scripts/check-source-tree-hygiene.js`
- `git diff --check`

All of the above passed. Runtime smoke evidence was captured under `output/smoke/2026-04-22T11-30-40-150Z/`.

## Bracket Evidence

### `quality_pass_bracket`

- `overall_status = pass`
- `ready_for_manufacturing_review = true`
- extracted semantics status `available`
- extracted coverage confirmed `2 / 2` required dimensions, `1 / 1` required notes, `2 / 2` required views
- draw manifest linked `drawing_intent_json`, `feature_catalog_json`, `extracted_drawing_semantics_json`, `planner_json`, and `quality_json`
- report manifest linked `report_summary_json`, `feature_catalog_json`, and `extracted_drawing_semantics_json`
- Studio smoke showed `Quality passed`, `Ready Yes`, and no extracted-evidence-derived planner warnings

### `ks_bracket`

- `overall_status = fail`
- `ready_for_manufacturing_review = false`
- known strict create-quality failure remained expected because the generated model shape is invalid
- known strict drawing-quality failure remained expected because required dimension coverage, conflict count, traceability coverage, and critical QA gates still fail
- extracted semantics status `partial`
- extracted coverage confirmed `1 / 3` required dimensions, `2 / 2` required notes, `4 / 4` required views
- unknown dimensions remained unknown instead of being promoted into extracted
- Studio smoke showed `Quality failed`, `Ready No`, grouped advisory actions, and required gate blockers remaining visible

## Fixture Coverage

`tests/drawing-semantic-regression.test.js` passed for:

- `quality_pass_bracket`
- `ks_bracket`
- `note_semantics_plate`
- `slot_hole_pattern_semantics_case`
- `unsupported_semantics_case`

These fixtures cover:

- clean extracted-semantic pass behavior
- fail-state preservation with advisory extracted evidence
- note extraction
- slot and hole-pattern semantic extraction
- unsupported semantic handling that remains conservative

## Runtime Smoke Coverage

The maintained runtime smoke path proves:

- `fcad check-runtime`
- `fcad create`
- `fcad draw --bom`
- `fcad inspect`
- `fcad fem`
- `fcad report`

The smoke manifest captured both the fail-first `ks_bracket` path and the pass path for `quality_pass_bracket`. Expected strict failures for `ks_bracket` remained expected failures rather than regressions.

## Studio Coverage

Studio coverage is verified by `tests/studio-quality-dashboard.test.js` and `tests/studio-shell-browser-smoke.test.js`.

The verified v1 Studio behavior is:

- pass-case readiness copy shows `Ready Yes`
- fail-case readiness copy shows `Ready No`
- extracted semantics are surfaced with evidence links
- grouped planner suggestions remain advisory by default
- required gate blockers remain visible when readiness is false
- job switching clears stale extracted semantics, planner state, drawing-quality state, SVG preview, PDF preview, and JSON preview state

## Known Limitations

- no OCR
- no PDF pixel parsing
- no screenshot-based semantic extraction
- no automatic GD&T inference
- no automatic tolerance inference beyond explicit generated or extracted evidence
- no automatic learning, config mutation, or evidence promotion from reviewer feedback
- unknown, unsupported, and low-confidence evidence remains conservative
- remaining `ks_bracket` dimension unknowns such as `MOUNTING_HOLE_DIA` and `BASE_PLATE_ENVELOPE` are intentional until stronger feature and dimension evidence exists

## Post-v1 Roadmap

Safe near-term improvements:

- improve aliases and label matching for already-generated drawing text
- add more fixture-backed regression cases for conservative unknown and unsupported evidence
- add more manifest and report-summary linkage assertions

Generation quality improvements:

- improve title-block and note consistency where the source config already contains required semantics
- reduce unmatched extracted text through more stable SVG labeling
- improve traceability emission quality without weakening pass/fail thresholds

Layout, view, and dimension planner improvements:

- improve section and detail-view recommendations for holes, slots, and thickness-critical features
- improve dimension placement readability so SVG text extraction remains reliable
- keep planner grouping readable for larger drawings while preserving advisory semantics

Reviewer feedback loop:

- capture reviewed false positives and false negatives as golden fixtures
- promote new aliases or labels only after fixture-backed validation
- keep manufacturing-readiness logic unchanged unless a future task explicitly changes policy and validation scope

## PR Chain

| PR | Verified addition |
| --- | --- |
| #36 | Added `drawing_intent`, `feature_catalog`, semantic quality summary, planner, report-summary wiring, manifest linkage, and initial Studio quality surfaces. |
| #37 | Added post-merge runtime smoke coverage for the drawing semantic quality stack. |
| #38 | Added `extracted_drawing_semantics` generation, schema, draw-pipeline wiring, report exposure, and output-manifest support. |
| #39 | Added extracted-semantics comparison against required intent inside semantic quality and report summary. |
| #40 | Added Studio extracted-semantics coverage and evidence display. |
| #41 | Refined planner suggested actions from extracted coverage while keeping them advisory by default. |
| #42 | Grouped planner suggested actions in Studio. |
| #43 | Improved conservative drawing note coverage in generation. |
| #44 | Expanded golden semantic fixtures. |
| #45 | Hardened manufacturing-review semantic artifact linkage. |
