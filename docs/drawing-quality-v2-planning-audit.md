# Drawing Quality v2 Planning Audit

This document audits the shipped post-v1 Drawing Quality baseline on `origin/master` after Prompt 19. It is a planning and sequencing document only. It does not change product behavior, manufacturing-readiness logic, advisory/blocking policy, or drawing generation strategy.

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
- latest runtime smoke outputs under `output/smoke/2026-04-23T07-20-10-791Z/`

## Executive Summary

The post-Prompt-19 Drawing Quality stack is shipped and end-to-end real on `master`, not just fixture scaffolding. The current baseline now generates and links `drawing_intent`, `feature_catalog`, `extracted_drawing_semantics`, `drawing_quality.semantic_quality`, advisory `drawing_quality.layout_readability`, advisory `drawing_quality.reviewer_feedback`, `drawing_planner`, report summaries, manifests, and Studio quality surfaces in one draw/report flow.

The strongest verified path today is still the original semantic-quality chain plus report/manifest linkage and Studio surfacing. Advisory layout/readability and reviewer feedback are also shipped, but their verification posture is more conservative:

- layout/readability is runtime-generated today, but most branch-specific behavior is still asserted by unit/browser fixtures rather than by explicit runtime-smoke field assertions
- reviewer feedback is runtime-proven only for the no-input path (`status: none`); linked/stale/invalid/open-item behavior is fixture-backed today
- Prompt 17 section/detail logic is shipped as a conservative foundation, but there is not yet a dedicated runtime-backed section/detail example proving that path end to end

No docs refresh was required in `README.md`, `docs/testing.md`, `docs/drawing-quality-v1.md`, or `IMPLEMENTATION_PLAN.md` to keep this audit accurate. The current repo wording is still broadly aligned with shipped behavior, so this audit adds one new planning document instead of forcing churn into baseline docs.

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

Latest runtime smoke (`output/smoke/2026-04-23T07-20-10-791Z/`) confirms:

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

Those latest smoke outputs preserve the Prompt 16 through Prompt 19 locks:

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

## Gap Register

| Gap | Category | Current evidence | Risk | Good Prompt 21+ candidate |
| --- | --- | --- | --- | --- |
| No dedicated runtime-backed section/detail example | section/detail runtime coverage gap | Prompt 17 logic is shipped and unit-tested, but current runtime smoke fixtures do not prove a section/detail path end to end | Medium | Yes |
| Layout/readability detailed branches are stronger in fixtures than in runtime assertions | layout metadata/completeness gap | latest smoke emits advisory layout findings, but runtime smoke does not assert detailed layout fields the way unit tests do | Low | Yes |
| Reviewer-feedback runtime path only proves the no-input case | reviewer feedback ingestion/UX gap | runtime smoke asserts `status = none`; linked/open/stale/invalid flows are fixture-backed only | Low | Yes |
| Some report/Studio advisory branches are payload-tested more strongly than runtime-owned | report/manifest/Studio visibility gap | report and Studio tests are good, but not every advisory state is tied to a live runtime scenario | Low | Yes |
| Conservative semantic wins beyond Prompt 16 remain narrow | semantic evidence gap | hole/envelope rules are locked; additional conservative improvements need stronger explicit source evidence before promotion | Medium | Yes |
| Runtime smoke upload workflow paths are stale relative to actual output layout | CI/workflow hygiene gap | workflow still uploads `output/runtime-smoke` while current smoke writes under `output/smoke/...` | Low | Track separately |
| Any remaining GitHub Actions Node 20 deprecation warning is operational, not semantic | CI/workflow hygiene gap | workflow files already pin Node `24`; any lingering warning is likely action-runtime hygiene rather than drawing-quality product scope | Low | Track separately |
| OCR, pixel parsing, generator rewrites, automatic GD&T/tolerance inference, reviewer automation | not-safe-yet / broad-engine gap | no conservative evidence model supports these without broader design changes | High | No |

## Recommended Next Prompt Sequence For v2

### Prompt 21: Add one runtime-backed section/detail proof path

- Goal: add one narrow example fixture/config that exercises section/detail evidence end to end through draw, extracted semantics, quality summary, planner, report summary, and Studio payloads.
- Why now: this is the biggest remaining gap between Prompt 17 shipping status and runtime-owned confidence.
- Dependencies: current Prompt 17 conservative rules and existing smoke harness.
- What must not change: loose section/detail labels must still stay non-extracted; readiness logic must stay unchanged; no broad section-cut engine work.
- Likely validation:
  - `node tests/drawing-planner.test.js`
  - `node tests/extracted-drawing-semantics.test.js`
  - `node tests/drawing-semantic-regression.test.js`
  - `node tests/runtime-smoke-cli.js`
  - `node tests/report-decision-summary.test.js`
  - `node tests/studio-quality-dashboard.test.js`
- Estimated risk: Medium

### Prompt 22: Harden structured layout metadata completeness and provenance

- Goal: make it clearer which layout/readability findings came from layout reports, QA metrics, and SVG view metadata, while preserving conservative `missing` or `partial` states when structured metadata is incomplete.
- Why now: layout/readability is already shipped and runtime-generated, so this is a low-risk confidence upgrade rather than a new product line.
- Dependencies: none beyond current Prompt 18 baseline.
- What must not change: layout/readability remains advisory-only; no new blockers; no pixel-based scoring.
- Likely validation:
  - `node tests/drawing-layout-readability.test.js`
  - `node tests/drawing-quality-summary.test.js`
  - `node tests/report-decision-summary.test.js`
  - `node tests/studio-quality-dashboard.test.js`
  - targeted runtime artifact spot-check from `node tests/runtime-smoke-cli.js`
- Estimated risk: Low

### Prompt 23: Add one runtime-backed reviewer-feedback ingestion path

- Goal: exercise a repo-local explicit reviewer-feedback JSON through draw/report/Studio once, proving that open linked feedback surfaces correctly without affecting readiness.
- Why now: Prompt 19 is shipped, but runtime ownership currently stops at `status = none`.
- Dependencies: current reviewer-feedback schema and explicit repo-root path guardrails.
- What must not change: reviewer feedback must stay advisory-only, must not satisfy missing evidence, and must not change manufacturing readiness.
- Likely validation:
  - `node tests/reviewer-feedback.test.js`
  - `node tests/drawing-quality-summary.test.js`
  - `node tests/report-decision-summary.test.js`
  - `node tests/studio-quality-dashboard.test.js`
  - one runtime smoke scenario with reviewer-feedback input
- Estimated risk: Low to Medium

### Prompt 24: Add one more conservative semantic-evidence increment

- Goal: deliver one narrow semantic-evidence improvement where the source drawing text or metadata is already explicit, without widening policy or inferring combined requirements.
- Why now: after runtime-backed section/detail and reviewer/layout confidence improves, another conservative semantic increment becomes easier to validate safely.
- Dependencies: none strict, but it is safer after Prompt 21 through Prompt 23 strengthen end-to-end observability.
- What must not change:
  - `MOUNTING_HOLE_DIA` explicit-evidence rules
  - `BASE_PLATE_ENVELOPE` remains `unknown` without explicit combined evidence
  - no OCR
  - no automatic GD&T or tolerance inference
- Likely validation:
  - `node tests/extracted-drawing-semantics.test.js`
  - `node tests/drawing-semantic-regression.test.js`
  - `node tests/drawing-quality-summary.test.js`
  - `node tests/runtime-smoke-cli.js`
- Estimated risk: Medium

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

## Suggested v2 Exit Criteria

Drawing Quality v2 should be considered conservatively complete only when all of the following are true:

- at least one runtime-backed section/detail example proves the Prompt 17 evidence rules end to end
- layout/readability provenance and completeness states are clear, conservative, and explicitly surfaced in report/Studio payloads
- reviewer-feedback ingestion is proven at least once end to end with explicit input and advisory-only outcome
- at least one additional semantic-evidence increment lands without changing readiness or widening extraction policy
- `quality_pass_bracket` still passes and stays ready for manufacturing review
- `ks_bracket` still fails and stays blocked for manufacturing review
- no advisory signal becomes a blocker
- no unknown or unsupported evidence is promoted into extracted without explicit justification
- operational CI/workflow cleanup is tracked separately from product drawing-quality scope

## Audit Conclusion

The current post-Prompt-19 baseline is strong enough to support a conservative Drawing Quality v2 plan, but not strong enough for a broad v2 feature push. The safe next move is a short prompt sequence that tightens runtime ownership of section/detail, layout/readability provenance, and reviewer-feedback ingestion before attempting any larger semantic or UX expansion.
