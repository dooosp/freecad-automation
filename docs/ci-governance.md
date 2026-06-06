# CI governance and maintainer checklist

This note is the maintainer-facing source of truth for CI/check/runbook parity.
It documents repository expectations only. It does not change GitHub branch
protection, repository settings, runner ownership, release publication, or any
production endpoint.

Audit evidence on 2026-06-06:

- repository: `dooosp/freecad-automation`
- default branch: `master`
- audited default-branch head: `7d1972f8434efbb46e1bd6af5067e3ea7c07ba43`
- active workflows: `Automation CI (hosted fast lanes)` and `FreeCAD Runtime Smoke (self-hosted macOS)`
- GitHub branch-protection API for `master`: `Branch not protected`
- open pull requests: none from `gh pr list --state open --limit 50`
- PR #163 merged at `7d1972f8434efbb46e1bd6af5067e3ea7c07ba43`
- latest audited `Automation CI (hosted fast lanes)` run on that head: success, run `27054410434`
- latest audited `FreeCAD Runtime Smoke (self-hosted macOS)` run on that head: success, run `27054452161`

## PR hosted checks

`Automation CI (hosted fast lanes)` is the required hosted PR lane. It runs on
`pull_request`, `workflow_dispatch`, and pushes to `master`. It does not install
or launch FreeCAD.

Maintainers should treat these check run names as the hosted PR checklist and,
if branch protection is enabled later, as the recommended required hosted status
checks:

| Check run name | Workflow job | Command |
| --- | --- | --- |
| `Source hygiene guard` | `source-hygiene` | `npm run check:source-hygiene` |
| `Node contract lane (ubuntu-24.04)` | `node-contract` matrix | `npm run test:node:contract` |
| `Node contract lane (macos-14)` | `node-contract` matrix | `npm run test:node:contract` |
| `Node integration lane` | `node-integration` | `npm run test:node:integration` |
| `Snapshot lane` | `snapshots` | `npm run test:snapshots` |
| `Studio browser smoke lane` | `studio-browser-smoke` | `npm run test:studio-browser-smoke` |
| `Python lane` | `python` | `npm run test:py` |

Local parity command for those hosted checks:

```bash
npm run check:source-hygiene
npm run test:ci:hosted
```

`npm test` is still the default local Node subset. It expands through
`tests/lane-manifest.js` to `test:node:contract`, `test:node:integration`, and
`test:snapshots`; it is not the full hosted checklist.

## Maintainer handoff doctor

After a maintainer PR train or before handing the repository back to humans,
run the single local doctor:

```bash
npm run maintainer:doctor -- --clean
```

It writes `output/maintainer-doctor/maintainer_doctor_report.json` in ignored
local output. The doctor runs or verifies source hygiene, the Stage 5B pipeline
doctor, the release dry-run doctor, node contract discoverability,
docs/source-of-truth guards, generated output policy, raw inbox tracking,
workflow/check-name drift, and readiness/release/evidence overclaim guards.
The report records the current truth: Stage 5B is still held, no genuine
inspection evidence is attached, release publication has not happened, CI
governance docs are present, and runtime smoke remains hosted/self-hosted or
maintainer-local guidance rather than production proof.

For a fresh-clone first-maintainer audit, run:

```bash
npm run bootstrap:doctor -- --clean
```

It validates `npm ci`, local CLI help, source hygiene, the maintainer doctor,
the release dry-run doctor, the Stage 5B pipeline doctor, documented npm script
names, docs/local-state alignment, generated-output policy, raw inbox tracking,
and sensitive-data leakage guards. It writes
`output/bootstrap-doctor/bootstrap_doctor_report.json` in ignored local output
and must not publish, tag, upload, attach evidence, regenerate canonical
readiness, change GitHub settings, call production, or require secrets.

Use lower-level commands only when isolating a failed maintainer-doctor gate:
`npm run test:stage5b:pipeline-doctor` for Stage 5B fixture pipeline drift,
`npm run release:dry-run:doctor -- --clean` for release-bundle rehearsal drift,
and `npm run check:source-hygiene` for generated output/source tree policy.

## Self-hosted runtime smoke

`FreeCAD Runtime Smoke (self-hosted macOS)` is the repository-owned live FreeCAD
smoke lane. It is not a direct `pull_request` workflow. It starts from
`workflow_run` after `Automation CI (hosted fast lanes)` succeeds, plus
`workflow_dispatch` and the weekly schedule for default-branch/runtime-owner
checks.

The self-hosted job name is `Self-hosted macOS FreeCAD smoke`. It requires the
runner labels `self-hosted`, `macOS`, `freecad`, and
`freecad-automation-runtime`, and uses the protected environment
`freecad-runtime-smoke`.

PR runtime smoke is limited to same-repository heads and the runtime owner actor
`dooosp`. Manual and scheduled runtime smoke are `master` checks by `dooosp`.
Forked PR code must not be checked out on the self-hosted runner. If a PR branch
needs a rerun, rerun hosted CI and let `workflow_run` sequence the runtime lane,
or run `npm run test:runtime-smoke` locally on a disposable FreeCAD-capable
machine after `fcad check-runtime` succeeds.

Post-merge expectation for `master`:

1. `Automation CI (hosted fast lanes)` succeeds on the merge commit.
2. `FreeCAD Runtime Smoke (self-hosted macOS)` succeeds from the hosted
   `workflow_run` on the same merge commit, or maintainers record why the runtime
   lane was intentionally skipped or blocked.

## Stage 5B placement

Stage 5B and CI governance are closed through PR #162, and release dry-run
governance is closed through PR #163. Do not add new Stage 5B machinery unless
real drift is proven.

Use `npm run test:stage5b:pipeline-doctor` only when Stage 5B docs, scripts,
schemas, or runbook surfaces are touched, or when maintainers explicitly need
the fixture-only source-kit -> source-preflight -> review-dry-run ->
attachment-controller -> pipeline-doctor regression guard. The doctor is a
non-production, non-evidence diagnostic; it must not attach evidence, promote
evidence, regenerate canonical readiness, or mark packages ready.

## Source hygiene and generated artifacts

`npm run check:source-hygiene` is both a hosted check and a local maintainer
guard. It rejects generated artifacts outside `output/`, expected fixtures, and
curated package-artifact allowlists.

Keep generated or local-only material in ignored paths:

- `output/`
- `.ci/`
- `tmp/codex/`
- `local/stage5b-candidate-evidence-inbox/`

Do not commit raw supplier/lab/QA/private records, secrets, private URLs, PII,
local inbox files, runtime smoke outputs, CI diagnostics, screenshots, release
publication artifacts, or regenerated canonical readiness unless a later task
explicitly authorizes that scoped mutation.

Release bundle dry-runs must write only ignored output, normally under
`output/release-dry-run-doctor/`, and must be followed by
`npm run check:source-hygiene` before any commit.

## Release publication boundary

Release publication remains a human maintainer decision. Before tagging or
publishing a GitHub release, confirm the exact `master` commit, the hosted PR or
post-merge checks above, the relevant self-hosted runtime smoke or local
runtime-smoke evidence, and the release checklist in
[`docs/releases/v1.1.0-checklist.md`](./releases/v1.1.0-checklist.md).

For a non-publishing local release-bundle rehearsal, run:

```bash
npm run release:dry-run:doctor
npm run check:source-hygiene
```

The doctor only runs `fcad pack` against a checked-in canonical package into an
ignored `output/` directory and writes a local doctor report there. It must not
create tags, publish a GitHub release, upload artifacts, attach evidence,
regenerate canonical readiness, or mutate checked-in package artifacts.

Do not treat GitHub releases, release bundles, CI artifacts, comments,
screenshots, or workflow metadata as inspection evidence or production-readiness
proof.
