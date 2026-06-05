# Testing And Verification

This repository now separates fast hosted checks from real FreeCAD-backed smoke verification. Run `fcad check-runtime` first on any machine that will execute the FreeCAD-backed paths.

## Test Lanes

<!-- GENERATED:lane-table:start -->
| Lane | Command | Scope | FreeCAD required |
| --- | --- | --- | --- |
| Node contract | `npm run test:node:contract` | config migration/validation, runtime path resolution, invocation assembly, structural validation, canonical package integrity, and Stage 5B no-evidence/audit/surrogate/source-preflight CLI smoke | No |
| Stage 5B no-evidence | `npm run test:stage5b:no-evidence` | local non-production CLI lane for source acquisition preflight, evidence review dry-run orchestration, inspection-evidence-intake, inspection-evidence-promotion-dry-run, stage5b-evidence-audit, and stage5b-surrogate-inspection-validation proving no genuine evidence is promoted | No |
| Node integration | `npm run test:node:integration` | local API/job contracts, studio bridge routes, browserless studio and legacy serve smoke, rule profiles, sweep logic, draw/report service integration | No |
| Snapshots | `npm run test:snapshots` | normalized SVG and report preview regression baselines | No |
| Studio browser smoke | `npm run test:studio-browser-smoke` | real Chrome/CDP Studio browser smoke for shell routing, canonical package cards, safe preview, release bundle non-action boundary, and route readiness without FreeCAD runtime execution | No |
| Python | `npm run test:py` | plain-Python and CLI-adjacent regression coverage that does not require a live FreeCAD launch | No |
| Runtime smoke | `npm run test:runtime-smoke` | real `fcad` smoke for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, narrow `tolerance --csv`, and `report` using checked-in example configs | Yes |
<!-- GENERATED:lane-table:end -->

Runtime domain checks remain available for deeper local verification:

- `npm run test:runtime:model`
- `npm run test:runtime:drawing`
- `npm run test:runtime:analysis`
- `npm run test:runtime:report`
- `npm run test:runtime:integration`
- `npm run test:runtime:full`

The runtime domain runner uses the same FreeCAD-backed script path as the CLI and will fail early if you request runtime-backed layers without a detectable runtime.

## Workflow Mapping

<!-- GENERATED:workflow-mapping:start -->
| Workflow | What it runs | What it does not claim |
| --- | --- | --- |
| `Automation CI (hosted fast lanes)` | `test:node:contract`, `test:node:integration`, `test:snapshots`, `test:studio-browser-smoke`, `test:py` | No hosted FreeCAD install or launch |
| `FreeCAD Runtime Smoke (self-hosted macOS)` | `test:runtime-smoke` plus runtime-backed Python smoke regressions, the quality fixture matrix, and a narrow tolerance CSV smoke | No Linux or Windows runtime ownership claims, and no broad tolerance or Monte Carlo maturity claim |
<!-- GENERATED:workflow-mapping:end -->

The hosted workflow is the fast PR lane and does not install or launch FreeCAD. Its Node contract lane also runs the non-mutating Stage 5B no-evidence CLI lane, audit CLI smoke with GitHub discovery disabled, surrogate inspection validation guard, and source acquisition/preflight guard. The self-hosted workflow is the repository-owned runtime smoke source of truth for the listed real FreeCAD-backed checks, but PR runtime smoke is sequenced by `workflow_run` after `Automation CI (hosted fast lanes)` succeeds and is limited to same-repository heads. Manual dispatch and the weekly schedule are explicit maintainer/runtime-owner checks on `master`; PR branch reruns should come from rerunning hosted CI or from local disposable runtime smoke. CI captures a path-redacted `fcad check-runtime --json --redact-paths` contract for debugging only. See [self-hosted runtime governance](./self-hosted-runtime-governance.md).

`npm run test:studio-browser-smoke` is a Chrome-capable Studio lane that runs locally and as a hosted Automation CI job. It proves real browser rendering for the covered Studio routes without claiming a FreeCAD runtime launch.

## GitHub Actions Node24 Runtime

The GitHub-hosted and self-hosted workflows opt JavaScript actions into the Node24 action runtime with `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"` and pin Node24-backed action majors to immutable commit SHAs with adjacent source-tag provenance comments:

- `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd` from `actions/checkout@v6`
- `actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` from `actions/setup-node@v6`
- `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` from `actions/upload-artifact@v7`
- `actions/setup-python@a309ff8b426b58ec0e2a45f0f869d46889d02405` from `actions/setup-python@v6`

This is separate from the project runtime. The workflow steps still set `node-version: "24"` for repository commands, while the action pins and `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` cover the JavaScript action runtime transition.

Self-hosted FreeCAD smoke runners must run a current GitHub Actions runner with Node24 action support. Use runner `v2.328.0` or newer, keep macOS above `13.4`, and do not set `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true` unless temporarily diagnosing an upstream action-runtime regression.

Manual verification for issue #31:

```bash
gh workflow run automation-ci.yml --ref <branch-or-sha>
gh workflow run freecad-runtime-smoke.yml --ref master
gh run view <run-id> --json conclusion,jobs
gh api repos/dooosp/freecad-automation/check-runs/<job-id>/annotations
```

The acceptance check is not just green jobs: hosted fast lanes must pass before any PR self-hosted runtime smoke, and the self-hosted runtime smoke must pass with no Node20 action-runtime deprecation annotations.

## Docs Smoke Coverage

`node tests/first-user-docs-smoke.test.js` checks the first-user package documentation path, including the Studio walkthrough for canonical package cards, safe artifact preview, release bundle boundaries, the Stage 5B inspection evidence audit/intake Studio/API review surface, the Stage 5B operational runbook, the Stage 5B evidence request packet, the Stage 5B attachment authorization record, the Stage 5B artifact/schema catalog, the Stage 5B automation closeout status, the release-candidate closeout gap ledger, the canonical package generation workflow guide, the DFM/readiness guide, the final non-inspection software closeout report, the Stage 5D feature expansion closeout, and the current `needs_more_evidence` / `hold_for_evidence_completion` / `inspection_evidence` readiness hold.

`npm run test:stage5b:no-evidence` is the focused local non-production lane for maintainers who only need to prove the documented CLI path. It runs `stage5b-evidence-source-kit`, `stage5b-evidence-source-preflight`, `stage5b-evidence-review-dry-run`, `inspection-evidence-intake`, `inspection-evidence-promotion-dry-run`, `stage5b-evidence-audit`, and `stage5b-surrogate-inspection-validation` in ignored `local/` and `output/` paths, verifies that valid-shaped local sources are only ready for later review and not attached, verifies that the review dry-run manifest preserves source status, redaction findings, candidate-gate rejection, audit planning, and readiness-held truth, verifies that no genuine evidence is found or promoted by the no-evidence chain, verifies that surrogate records are accepted only by the surrogate lane, and hashes tracked canonical package artifacts before and after the run.

`node tests/stage5b-evidence-source-kit.test.js` checks the acquisition/preflight helper for `local/stage5b-candidate-evidence-inbox/`: it creates ignored package-scoped inbox materials, writes JSON and CSV templates, accepts valid-shaped local JSON/CSV only as `ready_for_stage5b_review`, returns `READY_FOR_SOURCE` when a source is missing, rejects surrogate/synthetic/generated/CAD/docs/CI/readiness artifacts as real evidence, detects unsafe private data with redaction guidance, rejects tracked source files, and proves canonical readiness remains held. `node tests/stage5b-candidate-evidence-gate.test.js` checks the later local non-production candidate acceptance gate and the ignored local inbox guard for `local/stage5b-candidate-evidence-inbox/`. The gate accepts only JSON records with completed physical/supplier/lab/QA origin, provenance, reviewer traceability, package/part/revision mapping, inspection date/status/result fields, safe paths, and explicit rejection reasons; it rejects generated/control artifacts, diagnostics, schemas, fixtures, ignored inbox files as final evidence, candidate gate reports, intake/dry-run/audit outputs, GitHub/CI metadata, screenshots, templates, guides, comments, PR bodies, docs artifacts, release bundles, and CAD-generated measurements without attaching evidence or changing readiness. The docs guard also checks that maintainer instructions do not tell users to commit raw records, secrets, private URLs, PII, or supplier/lab/QA records.

`node tests/stage5b-source-of-truth-guard.test.js` locks the Stage 5B command, tracked-job, artifact-type, operational-runbook, Review card, authorization-record, and evidence-boundary wording surfaces together so `inspection-evidence-intake`, `inspection-evidence-promotion-dry-run`, and `stage5b-evidence-audit` cannot drift between manifests, docs, local API schemas, the executor, Studio bridge/client code, and Review cards. It also guards the Pre-Attachment Review Checklist so accepted gate reports require provenance/reviewer traceability, package/part/revision mapping, redaction/privacy review, path safety, next intake/dry-run/audit commands, the Stage 5B attachment authorization record, explicit authorization before attachment, exact later task boundary for attachment, and readiness-held truth before any later authorized attachment task. `node tests/stage5b-evidence-review-dry-run.test.js` validates the CLI-only review dry-run bridge: missing sources return `READY_FOR_SOURCE`, unsafe/generated/surrogate/docs/CI/readiness inputs are rejected before downstream work, ignored fixture mode exercises the orchestration without attachment, review-scoped candidate material is rejected by canonical gates, readiness remains held, and raw inbox markers are not copied into tracked outputs. `node tests/stage5b-surrogate-inspection-validation.test.js` validates the CLI-only surrogate lane: generated representative values are labeled synthetic/surrogate/non-evidence, accepted only by the surrogate artifact schema, rejected by canonical attachment/candidate gates, and unable to mutate canonical examples or readiness. `node tests/stage5b-artifact-catalog.test.js` guards the [Stage 5B artifact/schema catalog](./stage-5b-artifact-schema-catalog.md), including each control output's producer, schema or contract, location pattern, preview boundary, control/private status, non-evidence status, and readiness effect. `node tests/stage5b-artifact-contracts.test.js` validates generated `intake_report.json`, `promotion_dry_run_manifest.json`, `stage5b_audit_manifest.json`, and `stage5b_audit_summary.md` against the public Stage 5B schemas plus semantic guards for path safety, readiness-held truth, malformed attachment plans, generated-artifact leakage, and fake promotion overclaim. Together with the no-evidence CLI lane, they protect the no-genuine-evidence truth: source preflight, review dry-run manifests, candidate acceptance, inbox placement, surrogate validation artifacts, synthetic pipeline fixtures, authorization records, catalog entries, schemas, reports, dry-runs, audits, diagnostics, schemas, fixtures, intake reports, promotion dry-run manifests, audit manifests, generated artifacts, screenshots, CI summaries, templates, collection guides, GitHub metadata, comments, PR bodies, docs, and release bundles do not attach evidence or satisfy `inspection_evidence`, so canonical package readiness remains `needs_more_evidence` / `hold_for_evidence_completion` until genuine completed inspection evidence exists.

## Verification Wording

Use the following terms consistently in contributor notes and PR verification blocks:

- `hosted-safe` or `browserless`: route, contract, or service checks that do not claim a live browser session and do not claim a live FreeCAD launch
- `legacy HTTP smoke`: `serve:legacy` answered over HTTP and served static assets, but no websocket interaction or browser UI behavior was exercised
- `runtime-backed`: only use this wording when a real FreeCAD-backed command or runtime smoke lane actually ran
- `artifact re-entry`: a studio flow that starts from an existing tracked artifact reference rather than from a fresh pasted config

## Phase-3 tracked execution coverage

The hosted-safe Node lanes now cover the phase-3 tracked execution model without claiming a real browser session:

- request sanitization for public job payloads versus persisted internal executor requests
- public storage metadata redaction on `/jobs`, `/jobs/:id`, and `/jobs/:id/artifacts`
- browser-visible manifest/result redaction where internal values would otherwise contain absolute paths
- public artifact list shape on `/jobs/:id/artifacts`
- enveloped example payload shape on `/api/examples`
- drawing preview and dimension-update response shapes on `/api/studio/drawing-preview` and `/api/studio/drawing-previews/:id/dimensions`, including safe preview/edit-loop references instead of raw preview-plan paths
- cancel/retry route behavior by job state
- multi-job monitor helpers, completion routing helpers, and selected-job deep-link helpers
- jobs center action eligibility and merged active/history ordering
- browserless smoke for `/`, `/api`, `/studio`, `/jobs`, `/jobs/:id`, `/api/examples`, cancel/retry routes, browser-safe artifact open/download paths, and reference-only handling for internal tracked artifacts
- studio helper coverage that keeps artifact/example rendering and drawing preview copy path-free even if internal payloads remain path-bearing on disk

This is intentionally API-and-helper coverage, not runtime-backed verification. Only `npm run test:runtime-smoke` proves a live FreeCAD-backed execution path, and it should be run only when `fcad check-runtime` reports an actually available runtime on the current machine.

## Runtime Smoke Contents

`npm run test:runtime-smoke` uses checked-in examples including `configs/examples/ks_bracket.toml`, `configs/examples/quality_pass_bracket.toml`, `configs/examples/bracket_fem.toml`, `configs/examples/ptu_assembly_mates.toml`, `configs/examples/section_detail_runtime_probe.toml`, and `configs/examples/reviewer_feedback_runtime_probe.toml`, rewrites them into throwaway configs, and writes timestamped runtime outputs under `output/smoke/...`.

The quality fixture matrix has two explicit roles:

- `quality_pass_bracket` is the strict happy path: strict create/draw must pass and the generated report summary must keep `ready_for_manufacturing_review: true`.
- `ks_bracket` is the intentional expected-fail demo: strict create/draw must fail, and that failure counts as a passing assertion because the fixture should remain blocker-rich until intentionally changed.

The smoke lane verifies:

- `fcad check-runtime`
- `fcad create`
- `fcad draw --bom`
- `fcad inspect`
- `fcad fem`
- `fcad tolerance --recommend --csv`
- `fcad report`
- strict expected-fail checks for `ks_bracket` create/draw quality gates
- strict pass checks for `quality_pass_bracket` create/draw quality gates plus `Ready for manufacturing review: Yes`

The smoke harness validates the generated artifact manifests for `create`, `draw`, `fem`, `tolerance`, and `report`, asserts that create also produced a valid `<base>_create_quality.json` plus linked output manifest entry, and checks that required artifact types exist and recorded output files are non-empty. It also writes `output/smoke/<run-id>/smoke-manifest.json`, including observed quality fixture matrix outcomes and explicit non-evidence/no-readiness-effect boundary metadata, so workflow uploads can be inspected without replaying the run.

The `fcad tolerance` coverage is intentionally narrow: the self-hosted macOS lane runs the checked-in PTU assembly through recommendation plus CSV export and manifest checks. It does not claim Linux or Windows runtime coverage, and it does not claim deeper Monte Carlo tolerance-analysis maturity.

## Support Matrix

| Platform/runtime | Repository-owned verification | Notes |
| --- | --- | --- |
| macOS self-hosted with FreeCAD 1.1.x | Real runtime smoke | Source of truth for the listed live FreeCAD checks in CI, including narrow tolerance CSV smoke; PR smoke runs only after hosted CI succeeds for a same-repository head |
| macOS hosted (`macos-14`) | Node contract lane only | No hosted FreeCAD install |
| Ubuntu hosted (`ubuntu-24.04`) | Node contract, Node integration, snapshots, Studio browser smoke, Python | No hosted FreeCAD install |
| Linux local with FreeCAD | Local-only runtime smoke if you provide a working runtime | Not a repository-owned CI claim |
| Windows native / WSL -> Windows FreeCAD | Invocation/path contracts only | No repository-owned runtime smoke today |

## Local Commands

Fast local verification:

<!-- GENERATED:fast-local:start -->
```bash
npm run test:node:contract
npm run test:node:integration
npm run test:snapshots
```
<!-- GENERATED:fast-local:end -->

Python lane:

<!-- GENERATED:python-local:start -->
```bash
npm run test:py
```
<!-- GENERATED:python-local:end -->

This lane requires Python 3.11+ and the helper script will prefer an explicit `PYTHON` / `PYTHON3`, then the active `setup-python` interpreter when available, then `python3`, `python`, and finally versioned `python3.x` commands. It also requires that the selected interpreter can import `pytest`.

The Python lane is also the main hosted-safe coverage source for DFM issue enrichment. `tests/test_dfm.py` verifies that actionable DFM findings keep legacy `checks` compatibility while adding `issues`, severity counts, measurable `actual/required/delta` fields, and null-safe handling when exact feature-location data is unavailable.

The hosted-safe Node lanes now also cover the decision-ready report upgrade:

- `tests/report-decision-summary.test.js` validates report readiness logic, summary schema compliance, and missing-artifact truthfulness
- `tests/report-service-summary.test.js` validates that `createReportService()` writes `<base>_report_summary.json` and passes executive-summary payloads into the Python renderer input
- `tests/report-decision-pdf.test.js` attempts a partial-data PDF smoke, but it exits early with a skip message when the local `python3` environment cannot import `matplotlib`

Treat that PDF smoke exactly like runtime-backed verification: if the renderer dependency is unavailable, record it as environment-unavailable rather than claiming the PDF path was verified.

Real runtime smoke:

<!-- GENERATED:runtime-smoke-local:start -->
```bash
fcad check-runtime
npm run test:runtime-smoke
```
<!-- GENERATED:runtime-smoke-local:end -->

Deeper runtime-backed suites:

<!-- GENERATED:runtime-domain-local:start -->
```bash
npm run test:runtime:model
npm run test:runtime:drawing
npm run test:runtime:analysis
npm run test:runtime:report
npm run test:runtime:integration
npm run test:runtime:full
```
<!-- GENERATED:runtime-domain-local:end -->

## Known Limitations

- Hosted CI does not prove that FreeCAD launches successfully on Linux or macOS.
- Browserless studio and legacy serve smoke do not prove client-side rendering or websocket behavior.
- Windows and WSL support are still contract-tested compatibility paths, not runtime-smoke-covered platforms.
- The Python lane intentionally excludes runtime-backed smoke regressions so the default hosted lane stays fast and honest.
- Tolerance coverage is limited to the narrow self-hosted macOS CSV smoke; deeper Monte Carlo and other platform runtime paths remain local/deeper validation.
