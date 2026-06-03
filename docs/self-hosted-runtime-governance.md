# Self-hosted runtime governance

The `FreeCAD Runtime Smoke (self-hosted macOS)` workflow is the repository-owned live FreeCAD smoke lane. It is intentionally narrower and more governed than the hosted lanes because it executes repository code on a self-hosted macOS runner with a local FreeCAD install.

## Trigger policy

- Pull request runtime smoke is triggered by `workflow_run` after `Automation CI (hosted fast lanes)` completes successfully.
- The self-hosted job does not subscribe directly to `pull_request` events.
- Workflow-run PR smoke is limited to heads from `dooosp/freecad-automation`; forked PRs are skipped before a self-hosted runner is assigned.
- Workflow-run execution is also limited to the runtime-owner actor `dooosp`.
- Push-triggered workflow-run smoke is limited to successful hosted CI runs on `master`.
- `workflow_dispatch` is reserved for maintainer/runtime-owner checks of `master` by `dooosp`. For PR branch reruns, rerun hosted CI and let `workflow_run` start the self-hosted lane after success, or run the smoke locally on a disposable FreeCAD-capable host.
- The weekly schedule runs the default-branch workflow as recurring runtime drift detection.

The workflow deliberately has no path filter. Hosted lanes should prove the broad PR safety baseline before the runtime lane consumes scarce self-hosted capacity, and runtime drift can come from code, config, dependency, or workflow changes.

## Runner and token controls

- Runner labels are `self-hosted`, `macOS`, `freecad`, and `freecad-automation-runtime`; the runner must be maintained as a dedicated FreeCAD smoke host for this repository.
- The job uses the protected `freecad-runtime-smoke` environment so repository settings can require runtime-owner approval before self-hosted execution.
- Workflow permissions are limited to `contents: read`.
- `actions/checkout` uses the completed hosted workflow's `head_sha` for workflow-run events and `github.sha` for manual or scheduled runs.
- Checkout keeps `persist-credentials: false`; the runtime job does not need write credentials.
- JavaScript actions are pinned to full commit SHAs with nearby source-tag provenance comments.
- Node dependencies install with `npm ci --ignore-scripts --no-audit --prefer-offline`.
- Concurrency is scoped by event and head branch or ref, with stale runs canceled before newer runtime smoke starts.

## Output and evidence boundary

Runtime smoke writes temporary outputs under `output/smoke/...`, diagnostics under `.ci/`, and pytest state under `.pytest_cache`. Those paths are ignored local or CI temp material. The workflow uploads the `.ci/` diagnostics and `output/smoke/...` smoke outputs with 14-day retention for debugging only, then removes diagnostics, smoke outputs, and pytest state from the self-hosted workspace.

The uploaded JSON runtime contract is path-redacted. Text diagnostics and smoke manifests are still temporary CI metadata, not evidence records or package inputs.

Runtime smoke outputs, CI diagnostics, workflow metadata, screenshots, logs, manifests, CAD-generated measurements, and uploaded artifacts are not `inspection_evidence`, release artifacts, package artifacts, readiness data, or supplier/lab/QA records. Only genuine completed physical/supplier/lab/QA inspection records can satisfy `inspection_evidence` after later authorized validation, review, and attachment.

Canonical packages remain `needs_more_evidence` / `hold_for_evidence_completion` until a real inspection record is validated and attached through the Stage 5B evidence-gated flow.

## Operator checklist

1. Confirm `Automation CI (hosted fast lanes)` is green for the target SHA.
2. Confirm PR runtime smoke is same-repository through `workflow_run`, or confirm manual/scheduled execution is on `master`.
3. Confirm no forked PR code will be checked out on the self-hosted runner.
4. Confirm no workflow change requests broader permissions, unpinned actions, persisted checkout credentials, secret usage, or generated artifact promotion.
5. Treat uploaded runtime diagnostics as temporary CI metadata only.
