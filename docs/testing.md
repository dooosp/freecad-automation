# Testing And Verification

This repository now separates fast hosted checks from real FreeCAD-backed smoke verification. Run `fcad check-runtime` first on any machine that will execute the FreeCAD-backed paths.

## Test Lanes

<!-- GENERATED:lane-table:start -->
| Lane | Command | Scope | FreeCAD required |
| --- | --- | --- | --- |
| Node contract | `npm run test:node:contract` | config migration/validation, runtime path resolution, invocation assembly, structural validation, canonical package integrity | No |
| Node integration | `npm run test:node:integration` | local API/job contracts, studio bridge routes, browserless studio and legacy serve smoke, rule profiles, sweep logic, draw/report service integration | No |
| Snapshots | `npm run test:snapshots` | normalized SVG and report preview regression baselines | No |
| Python | `npm run test:py` | plain-Python and CLI-adjacent regression coverage that does not require a live FreeCAD launch | No |
| Runtime smoke | `npm run test:runtime-smoke` | real `fcad` smoke for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, and `report` using checked-in example configs | Yes |
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
| `Automation CI (hosted fast lanes)` | `test:node:contract`, `test:node:integration`, `test:snapshots`, `test:py` | No hosted FreeCAD install or launch |
| `FreeCAD Runtime Smoke (self-hosted macOS)` | `test:runtime-smoke` plus runtime-backed Python smoke regressions and the quality fixture matrix | No Linux or Windows runtime ownership claims, and no repository-owned tolerance smoke claim yet |
<!-- GENERATED:workflow-mapping:end -->

The hosted workflow is the fast PR lane and does not install or launch FreeCAD. The self-hosted workflow is the repository-owned runtime smoke source of truth for real FreeCAD-backed quality checks on pull requests, manual reruns, and the weekly schedule.

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
- example payload shape on `/api/examples`
- drawing preview and dimension-update response shapes on `/api/studio/drawing-preview` and `/api/studio/drawing-previews/:id/dimensions`, including safe preview/edit-loop references instead of raw preview-plan paths
- cancel/retry route behavior by job state
- multi-job monitor helpers, completion routing helpers, and selected-job deep-link helpers
- jobs center action eligibility and merged active/history ordering
- browserless smoke for `/`, `/api`, `/studio`, `/jobs`, `/jobs/:id`, `/api/examples`, cancel/retry routes, and browser-safe artifact open/download paths
- studio helper coverage that keeps artifact/example rendering and drawing preview copy path-free even if internal payloads remain path-bearing on disk

This is intentionally API-and-helper coverage, not runtime-backed verification. Only `npm run test:runtime-smoke` proves a live FreeCAD-backed execution path, and it should be run only when `fcad check-runtime` reports an actually available runtime on the current machine.

## Runtime Smoke Contents

`npm run test:runtime-smoke` uses checked-in examples including `configs/examples/ks_bracket.toml`, `configs/examples/quality_pass_bracket.toml`, `configs/examples/bracket_fem.toml`, `configs/examples/section_detail_runtime_probe.toml`, and `configs/examples/reviewer_feedback_runtime_probe.toml`, rewrites them into throwaway configs, and writes timestamped runtime outputs under `output/smoke/...`.

The quality fixture matrix has two explicit roles:

- `quality_pass_bracket` is the strict happy path: strict create/draw must pass and the generated report summary must keep `ready_for_manufacturing_review: true`.
- `ks_bracket` is the intentional expected-fail demo: strict create/draw must fail, and that failure counts as a passing assertion because the fixture should remain blocker-rich until intentionally changed.

The smoke lane verifies:

- `fcad check-runtime`
- `fcad create`
- `fcad draw --bom`
- `fcad inspect`
- `fcad fem`
- `fcad report`
- strict expected-fail checks for `ks_bracket` create/draw quality gates
- strict pass checks for `quality_pass_bracket` create/draw quality gates plus `Ready for manufacturing review: Yes`

The smoke harness validates the generated artifact manifests for `create`, `draw`, `fem`, and `report`, asserts that create also produced a valid `<base>_create_quality.json` plus linked output manifest entry, and checks that required artifact types exist and recorded output files are non-empty. It also writes `output/smoke/<run-id>/smoke-manifest.json`, including observed quality fixture matrix outcomes, so workflow uploads can be inspected without replaying the run.

`fcad tolerance` is still intentionally outside the repository-owned smoke lane. It succeeds locally on the checked-in assembly example, but it remains a heavier assembly-plus-Monte-Carlo runtime path and is left to deeper local validation until we can harden it for CI without destabilizing the smoke lane.

## Support Matrix

| Platform/runtime | Repository-owned verification | Notes |
| --- | --- | --- |
| macOS self-hosted with FreeCAD 1.1.x | Real runtime smoke | Source of truth for live FreeCAD execution in CI |
| macOS hosted (`macos-14`) | Node contract lane only | No hosted FreeCAD install |
| Ubuntu hosted (`ubuntu-24.04`) | Node contract, Node integration, snapshots, Python | No hosted FreeCAD install |
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
- The tolerance flow remains local/deeper-runtime coverage only; it is not part of the repository-owned smoke lane yet.
