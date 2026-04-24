# Drawing Quality v2 Planning Audit

This document originally audited the shipped post-v1 Drawing Quality baseline on `origin/master` after Prompt 19. It now also records the local remediation-candidate evidence for Prompt 21 through Prompt 24 on candidate HEAD `9f779cdc90bff6a2cbc879ec5ab3126022c2233b`.

The base locked `master` / `origin/master` reference for this remediation line remains `7288dd9439fe07054d72c16243e1fd12457c1e70`. The remediation candidate is not documented here as merged to `master`, pushed, or PR-verified. Final release or merge still requires branch publication and hosted GitHub checks.

Audit baseline:

- starting commit: `58c67167c3142d151e1a8e498b48894fd4b52dcc`
- Prompt 19 title: `Add reviewer feedback advisory loop foundation`
- Prompt 18 merge commit present: `30ca6069cc27a35170a03e6377519e86971ca9ac`
- Prompt 18 implementation commit present: `45ea74e44c245a05ab1e24ef23c940d88caa41cf`
- validation worktree: `docs/drawing-quality-v2-planning-audit`
- validation snapshot date: `2026-04-23`

Primary evidence used for this audit:

- repo docs and shipped code on `origin/master`
- `npm test`
- `npm run check:runtime`
- `node tests/runtime-smoke-cli.js`
- `npm run test:runtime-smoke`
- targeted drawing/report/Studio tests
- latest runtime smoke outputs under timestamped `output/smoke/...` directories

## Executive Summary

The post-Prompt-19 Drawing Quality stack is shipped and end-to-end real on `master`, not just fixture scaffolding. The current baseline now generates and links `drawing_intent`, `feature_catalog`, `extracted_drawing_semantics`, `drawing_quality.semantic_quality`, advisory `drawing_quality.layout_readability`, advisory `drawing_quality.reviewer_feedback`, `drawing_planner`, report summaries, manifests, and Studio quality surfaces in one draw/report flow.

In the original post-Prompt-19 audit, the strongest verified path was the semantic-quality chain plus report/manifest linkage and Studio surfacing. Before the remediation candidate, advisory layout/readability, reviewer feedback, and section/detail had these conservative evidence gaps:

- layout/readability was runtime-generated, but most branch-specific behavior was asserted by unit/browser fixtures rather than by explicit runtime-smoke field assertions
- reviewer feedback was runtime-proven only for the no-input path (`status: none`), while linked/stale/invalid/open-item behavior was fixture-backed
- Prompt 17 section/detail logic was shipped as a conservative foundation, but lacked a dedicated runtime-backed section/detail example proving that path end to end

Prompt 21 through Prompt 24 are now proved on the remediation candidate by the runtime smoke, focused unit tests, manifest/path guards, and static semantic guards listed below. This remains candidate/remediation evidence only until the branch is pushed or opened as a PR and hosted GitHub checks pass.

## Current Verified Baseline After Prompt 19

The current shipped workflow is:

`drawing_intent`
-> `feature_catalog`
-> drawing generation
-> `extracted_drawing_semantics`
-> `drawing_quality.semantic_quality`
-> advisory `drawing_quality.layout_readability`
-> advisory `drawing_quality.reviewer_feedback`
-> `drawing_planner` suggested actions
-> output/report/artifact manifests
-> Studio Quality Dashboard
-> manufacturing readiness decision

What is already shipped and verified:

- `draw-pipeline` writes `drawing_intent`, `feature_catalog`, `extracted_drawing_semantics`, `drawing_quality`, and `drawing_planner` before report generation.
- `drawing_quality.semantic_quality` compares required intent against conservative extracted evidence and keeps advisory vs blocking separate unless explicit enforcement is introduced.
- `drawing_quality.layout_readability` is generated from structured QA/layout metadata and remains advisory-only.
- `drawing_quality.reviewer_feedback` is loaded from explicit JSON only, remains traceable, and remains advisory-only.
- `drawing_planner` is refined first by extracted-coverage findings, then by layout/readability findings, then by reviewer feedback findings.
- `report_summary` links drawing-quality evidence, extracted-semantics evidence, and reviewer-feedback summary state.
- output manifests link planner, extracted-semantics, quality, drawing intent, and feature catalog artifacts.
- Studio quality surfaces consume report/drawing artifacts and expose semantic-quality evidence plus advisory suggested-action groups.
- manufacturing readiness still depends on required Geometry / Drawing / DFM surfaces rather than advisory semantic/layout/reviewer signals.

Current remediation-candidate runtime smoke under timestamped `output/smoke/...` directories confirms:

- `quality_pass_bracket`
  - `drawing_quality.status = pass`
  - `report_summary.overall_status = pass`
  - `report_summary.ready_for_manufacturing_review = true`
  - `reviewer_feedback.status = none`
  - `reviewer_feedback.unresolved_count = 0`
  - `layout_readability.status = warning`
  - advisory layout findings did not block pass/readiness
  - extracted required-dimension missing count remained `0`
  - planner suggested-action details remained empty
- `ks_bracket`
  - `drawing_quality.status = fail`
  - `report_summary.overall_status = fail`
  - `report_summary.ready_for_manufacturing_review = false`
  - `reviewer_feedback.status = none`
  - `reviewer_feedback.unresolved_count = 0`
  - `layout_readability.status = warning`
  - `MOUNTING_HOLE_DIA` remained `extracted`
  - `BASE_PLATE_ENVELOPE` remained `unknown`
  - planner suggested-action details remained advisory-only
- `section_detail_runtime_probe`
  - runtime-backed section and detail views are generated and linked through drawing-quality/report artifacts
  - structured section/detail provenance is required; loose labels alone still do not extract
- `reviewer_feedback_runtime_probe`
  - `reviewer_feedback.status = available`
  - open linked reviewer feedback remains advisory-only and manifest-linked
  - reviewer feedback does not satisfy missing required evidence or change readiness

Those smoke outputs preserve the Prompt 16 through Prompt 24 locks:

- `MOUNTING_HOLE_DIA` is not regressed out of the allowed explicit-evidence path
- `BASE_PLATE_ENVELOPE` is not promoted beyond `unknown`
- advisory layout/readability findings do not become blockers
- reviewer feedback does not change readiness and does not satisfy missing required evidence

## Current Workflow Map

| Stage | Shipped source | Output or surfaced location | Current verification posture |
| --- | --- | --- | --- |
| `drawing_intent` | `lib/drawing-intent.js` | `<base>_drawing_intent.json` | runtime smoke + unit/report linkage |
| `feature_catalog` | `lib/feature-catalog.js` | `<base>_feature_catalog.json` | runtime smoke + unit/report linkage |
| drawing generation | `src/orchestration/draw-pipeline.js` | `<base>_drawing.svg`, `<base>_drawing_qa.json` | runtime smoke |
| `extracted_drawing_semantics` | `src/services/drawing/extracted-drawing-semantics.js` | `<base>_extracted_drawing_semantics.json` | runtime smoke + fixture regression |
| `drawing_quality.semantic_quality` | `src/services/drawing/drawing-quality-summary.js` | `<base>_drawing_quality.json` | runtime smoke + fixture regression |
| advisory `layout_readability` | `src/services/drawing/layout-readability.js` | `<base>_drawing_quality.json` | runtime-generated + fixture/browser asserted |
| advisory `reviewer_feedback` | `src/services/drawing/reviewer-feedback.js` | `<base>_drawing_quality.json` | runtime no-input path + fixture/browser asserted |
| `drawing_planner` | `src/services/drawing/drawing-planner.js` | `<base>_drawing_planner.json` | runtime smoke + fixture regression |
| report summary | `src/services/report/decision-report-summary.js` | `<base>_report_summary.json` | runtime smoke + unit asserted |
| manifests | `lib/output-manifest.js` | draw/report/output manifests | runtime smoke + unit asserted |
| Studio Quality Dashboard | `public/js/studio/quality-dashboard.js` | browser | browserless + browser smoke, fixture-backed payloads |
| manufacturing readiness | report decision summary | report + Studio | runtime smoke |

## Coverage Map

### Runtime-Smoke-Backed

These surfaces are currently proven by real FreeCAD-backed smoke on macOS and by the latest runtime outputs:

- draw/report end-to-end artifact emission for both `quality_pass_bracket` and `ks_bracket`
- `drawing_intent`, `feature_catalog`, `extracted_drawing_semantics`, `drawing_quality`, `drawing_planner`, draw manifest, report summary, and report manifest linkage
- pass/fail separation between `quality_pass_bracket` and `ks_bracket`
- manufacturing readiness outcomes:
  - `quality_pass_bracket -> ready_for_manufacturing_review = true`
  - `ks_bracket -> ready_for_manufacturing_review = false`
- Prompt 16 conservative hole/envelope behavior in generated outputs
- reviewer-feedback absence path:
  - no reviewer-feedback input
  - `status = none`
  - `unresolved_count = 0`
- layout/readability artifact generation:
  - latest smoke outputs contain advisory layout findings
  - those findings do not override pass/fail/readiness

### Fixture-Backed Or Unit-Backed

These areas are shipped, but their strongest proof today is still unit, fixture, or browser smoke rather than dedicated runtime smoke assertions:

- linked/partial/stale/invalid reviewer feedback ingestion and matching
- section/detail-view recommendation generation and conservative extraction rules
- exact layout/readability scoring branches such as `missing_layout_metadata`, `view_crowding`, and `title_block_clearance`
- report-summary shaping for layout/readability and reviewer-feedback summaries
- Studio rendering of extracted-evidence groups, suggested-action groups, and reviewer-feedback-linked payloads
- planner refinement branches driven by extracted-coverage unknowns, layout findings, and reviewer feedback

### Studio-Surfaced

Studio coverage is real and useful, but it is mostly payload-driven verification rather than runtime-smoke ownership of every advisory branch:

- `tests/studio-quality-dashboard.test.js`
- `tests/studio-shell-browser-smoke.test.js`

Current Studio proof includes:

- `Ready Yes` for pass cases and `Ready No` for fail cases
- extracted-semantics coverage summaries and evidence links
- grouped suggested actions
- required gate blockers remaining visible when readiness is false
- route switching and stale-state clearing

### Manifest-And-Report-Linked

These are already well integrated and should be treated as part of the stable shipped baseline:

- draw manifest links planner, extracted semantics, drawing intent, feature catalog, and quality JSON
- report summary references drawing intent, feature catalog, and extracted drawing semantics
- report summary carries `semantic_quality`, `layout_readability`, and `reviewer_feedback` surface summaries
- output manifests keep generated artifacts under `output/`

## Conservative Rules That Remain Non-Negotiable

- no OCR
- no PDF pixel parsing
- no screenshot parsing
- no rendered image pixel scoring
- no automatic GD&T inference
- no automatic tolerance inference
- no reviewer-feedback-driven evidence promotion
- no readiness-logic changes
- no widening of pass/fail thresholds
- no promotion of unknown, unsupported, ambiguous, or low-confidence evidence into extracted
- no use of reviewer feedback to satisfy missing required evidence
- no conversion of advisory layout/readability or reviewer feedback into blockers
- `quality_pass_bracket` must remain `Quality passed` and `ready_for_manufacturing_review = true`
- `ks_bracket` must remain `Quality failed` and `ready_for_manufacturing_review = false`
- Prompt 16 locks stay intact:
  - `MOUNTING_HOLE_DIA` only under explicit evidence rules
  - `BASE_PLATE_ENVELOPE` stays `unknown` until explicit combined evidence exists
- Prompt 17 locks stay intact:
  - loose section/detail labels alone are not enough
  - distinct region/group plus readable identity evidence is required
- Prompt 18 locks stay intact:
  - layout/readability is advisory-only
  - missing metadata stays conservative (`unknown`, `partial`, `not_evaluated`, `unsupported`)
- Prompt 19 locks stay intact:
  - reviewer feedback is explicit, traceable, and advisory-only
  - reviewer feedback does not change manufacturing readiness

## Remediation Candidate Register

| Item | Category | Current remediation-candidate evidence | Status |
| --- | --- | --- | --- |
| Prompt 21 section/detail runtime proof | section/detail runtime coverage | `section_detail_runtime_probe` now runs through runtime smoke and proves structured section/detail view evidence end to end through draw, extracted semantics, quality summary, planner, report summary, and manifests. Loose section/detail labels alone still do not extract. | Proved on candidate |
| Prompt 22 layout provenance/completeness | layout metadata/completeness | `drawing_quality.layout_readability` now carries advisory-only provenance/completeness metadata including source kind, source artifact/ref, evidence state, completeness state, and per-source completeness. Missing, partial, or unsupported metadata remains conservative and does not affect readiness. | Proved on candidate |
| Prompt 23 reviewer-feedback ingestion | reviewer feedback ingestion/UX | `reviewer_feedback_runtime_probe` now proves explicit repo-local reviewer-feedback JSON ingestion with linked/open feedback. The feedback is manifest-linked, path-safe, advisory-only, and does not satisfy missing evidence or change manufacturing readiness. | Proved on candidate |
| Prompt 24 material semantic increment | semantic evidence | The new Prompt 24 increment is limited to explicit SVG title-block `MATERIAL` label/value pair evidence. Pre-existing explicit SVG material note text remains allowed only when the SVG text has raw text, source, and provenance, and is not inferred from config/defaults/reviewer/layout/QA/model/OCR/pixels. | Proved on candidate |
| Checklist 9 artifact/manifest path guard | artifact/manifest remediation | Latest candidate path guard reports `BAD_PATH_REFS=0`, `MISSING_REFS=0`, `OPTIONAL_UNAVAILABLE_WITH_PATH=0`, and `REQUIRED_UNAVAILABLE=0`. | Proved on candidate |
| Runtime smoke upload workflow paths | CI/workflow hygiene | Runtime smoke writes under `output/smoke/...`. Any workflow upload-path cleanup remains operational follow-up, not drawing-quality product status. | Track separately |
| GitHub Actions runtime deprecation warnings | CI/workflow hygiene | Any remaining action-runtime warning is operational cleanup, not semantic Drawing Quality scope. | Track separately |
| OCR, pixel parsing, generator rewrites, automatic GD&T/tolerance inference, reviewer automation | not-safe-yet / broad-engine gap | No conservative evidence model supports these without broader design changes, and the remediation candidate does not add them. | Not in scope |

## Prompt 21 Through Prompt 24 Candidate Status

### Prompt 21: Runtime-backed section/detail proof path

- Candidate status: complete on candidate HEAD `9f779cdc90bff6a2cbc879ec5ab3126022c2233b`.
- Evidence: `section_detail_runtime_probe` is included in `node tests/runtime-smoke-cli.js` and emits runtime-backed section/detail views, extracted evidence, drawing quality, report summary, and manifests.
- Preserved locks: loose section/detail labels alone are not extracted; extraction still requires structured region/group provenance; readiness logic is unchanged.
- Validation evidence:
  - `node tests/drawing-planner.test.js`
  - `node tests/extracted-drawing-semantics.test.js`
  - `node tests/drawing-semantic-regression.test.js`
  - `node tests/runtime-smoke-cli.js`
  - `node tests/report-decision-summary.test.js`
  - `node tests/studio-quality-dashboard.test.js`

### Prompt 22: Structured layout metadata completeness and provenance

- Candidate status: complete on candidate HEAD `9f779cdc90bff6a2cbc879ec5ab3126022c2233b`.
- Evidence: `drawing_quality.layout_readability` exposes advisory-only provenance and completeness fields for layout report, QA metrics, and SVG view metadata.
- Preserved locks: layout/readability remains advisory-only, does not become a blocker, does not change readiness, and does not use pixel-based scoring.
- Validation evidence:
  - `node tests/drawing-layout-readability.test.js`
  - `node tests/drawing-quality-summary.test.js`
  - `node tests/report-decision-summary.test.js`
  - `node tests/studio-quality-dashboard.test.js`
  - `node tests/runtime-smoke-cli.js`

### Prompt 23: Runtime-backed reviewer-feedback ingestion path

- Candidate status: complete on candidate HEAD `9f779cdc90bff6a2cbc879ec5ab3126022c2233b`.
- Evidence: `reviewer_feedback_runtime_probe` proves explicit repo-local reviewer-feedback JSON ingestion with `status = available`, one linked/open item, and manifest-linked advisory evidence.
- Preserved locks: reviewer feedback remains path-safe and advisory-only; it does not satisfy missing required evidence, does not promote feedback into extracted evidence, and does not change manufacturing readiness.
- Validation evidence:
  - `node tests/reviewer-feedback.test.js`
  - `node tests/drawing-quality-summary.test.js`
  - `node tests/report-decision-summary.test.js`
  - `node tests/studio-quality-dashboard.test.js`
  - `node tests/runtime-smoke-cli.js`

### Prompt 24: Conservative material semantic-evidence increment

- Candidate status: complete on candidate HEAD `9f779cdc90bff6a2cbc879ec5ab3126022c2233b`.
- Evidence: material extraction is limited to explicit SVG evidence. The new Prompt 24 increment is title-block `MATERIAL` label/value pair extraction.
- Scope adjudication: pre-existing explicit SVG material note text remains allowed only when explicit SVG text carries raw/source/provenance and matches the required material evidence. Material is not inferred from config/defaults/reviewer/layout/QA/model/OCR/pixels.
- Preserved locks:
  - `MOUNTING_HOLE_DIA` remains extracted only under explicit SVG raw/provenance/source evidence.
  - `BASE_PLATE_ENVELOPE` remains `unknown` without explicit combined length-and-width evidence.
  - no OCR
  - no automatic GD&T or tolerance inference
- Validation evidence:
  - `node tests/extracted-drawing-semantics.test.js`
  - `node tests/drawing-semantic-regression.test.js`
  - `node tests/drawing-quality-summary.test.js`
  - `node tests/runtime-smoke-cli.js`

### Separate Operational Follow-Ups

These should not be mixed into semantic drawing-quality prompts:

- fix runtime-smoke artifact upload paths in `.github/workflows/freecad-runtime-smoke.yml` so they match the actual `output/smoke/...` layout
- audit any remaining GitHub Actions runtime deprecation warnings separately from drawing-quality product work

## Explicit Do-Not-Do-Yet List

- do not rewrite the drawing generator
- do not implement a broad layout optimizer
- do not implement a full section-cut or detail-view engine
- do not change manufacturing readiness logic
- do not turn layout/readability or reviewer feedback into blockers
- do not add OCR
- do not parse PDF pixels
- do not parse screenshots
- do not score rendered image pixels
- do not infer tolerances automatically
- do not infer GD&T automatically
- do not automate reviewer messaging, issue filing, or external notifications
- do not use broad engine prompts to paper over narrow evidence gaps

## v2 Exit Criteria

The local remediation candidate satisfies the conservative v2 exit criteria listed below. This is candidate evidence only; final release or merge still requires branch push or PR creation and hosted GitHub checks.

- `section_detail_runtime_probe` proves the Prompt 17 evidence rules end to end
- layout/readability provenance and completeness states are clear, conservative, advisory-only, and explicitly surfaced in report/Studio payloads
- `reviewer_feedback_runtime_probe` proves explicit input ingestion with linked/open feedback and advisory-only outcome
- the Prompt 24 material increment lands without changing readiness or widening extraction policy beyond explicit SVG material label/value evidence
- `quality_pass_bracket` still passes and stays ready for manufacturing review
- `ks_bracket` still fails and stays blocked for manufacturing review
- `MOUNTING_HOLE_DIA` remains extracted from explicit SVG evidence
- `BASE_PLATE_ENVELOPE` remains unknown without explicit combined evidence
- no advisory signal becomes a blocker
- no unknown or unsupported evidence is promoted into extracted without explicit justification
- no OCR, PDF pixel parsing, screenshot parsing, rendered image pixel scoring, or computer vision is introduced
- automatic GD&T and tolerance inference remain disabled
- artifact path guard remains clean with `BAD_PATH_REFS=0`, `MISSING_REFS=0`, `OPTIONAL_UNAVAILABLE_WITH_PATH=0`, and `REQUIRED_UNAVAILABLE=0`
- operational CI/workflow cleanup is tracked separately from product drawing-quality scope

## Audit Conclusion

The current remediation candidate closes the Prompt 21 through Prompt 24 evidence gaps without weakening the Drawing Quality locks. It remains a local candidate until branch publication and hosted GitHub checks complete. Operational cleanup items, including runtime-smoke artifact upload paths and any Actions runtime deprecation warning, remain separate from product/semantic Drawing Quality status.
