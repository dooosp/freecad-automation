# Stage 5E quality hardening status

This document summarizes the Stage 5E quality hardening work represented by PRs [#102](https://github.com/dooosp/freecad-automation/pull/102), [#103](https://github.com/dooosp/freecad-automation/pull/103), [#104](https://github.com/dooosp/freecad-automation/pull/104), [#105](https://github.com/dooosp/freecad-automation/pull/105), [#106](https://github.com/dooosp/freecad-automation/pull/106), and [#107](https://github.com/dooosp/freecad-automation/pull/107).

Stage 5E is a quality, runtime-claim, and evidence-boundary hardening slice. It improves fixture-scoped STEP reimport checks, documents the source split between generated-shape and STEP reimport evidence, makes unavailable STEP geometry explicit, adds narrow tolerance CSV runtime smoke coverage, adds a source-of-truth drift guard for command/test/runtime docs, and rejects generated artifacts at the `inspection_evidence` contract boundary. It does not change production-readiness status, unlock Stage 5B, attach inspection evidence, or broaden repository-owned runtime claims beyond the evidence listed here.

## Repository evidence

| Field | Evidence |
| --- | --- |
| Repository | `freecad-automation` |
| Status document base branch | `master` |
| Status document base commit | `4bbcef0bb12b6eab3c8b5bda90baa8b1bd23a98c` |
| Default branch | `origin/master` |
| Stage 5E PR state | PRs #102, #103, #104, #105, #106, and #107 are merged into `master` |
| Latest Stage 5E merge | PR #107, merge commit `4bbcef0bb12b6eab3c8b5bda90baa8b1bd23a98c` |

Available local validation commands from `package.json` include `npm test`, `npm run test:node:contract`, `npm run test:node:integration`, `npm run test:snapshots`, `npm run test:py`, `npm run test:studio-browser-smoke`, `npm run test:runtime-smoke`, `npm run check:runtime`, and `npm run serve`.

## PR summary

| PR | Status | Merge commit | Scope | Boundary kept |
| --- | --- | --- | --- | --- |
| [#102](https://github.com/dooosp/freecad-automation/pull/102) | Merged | `e9db5ec2352749987767214b0f663c3e39a40131` | Added fixture-scoped STEP reimport-backed hole diameter and center checks for the canonical quality fixtures. | Did not generalize CAD feature recognition, replace generated-shape checks, or add schema fields. |
| [#103](https://github.com/dooosp/freecad-automation/pull/103) | Merged | `412c1d3a880d9669f7fa98b82b3194751ca533b5` | Clarified docs and docs-smoke assertions for `generated_shape_geometry` versus `reimported_step_geometry`. | Kept STEP reimport evidence as round-trip evidence for the exported STEP, not as a replacement source for generated-shape checks or inspection evidence. |
| [#104](https://github.com/dooosp/freecad-automation/pull/104) | Merged | `0d635089aa8069663755f9edcce60c677066ba2d` | Hardened negative paths so failed or missing fixture-scoped STEP reimport geometry is reported explicitly as unavailable blocking evidence. | Did not silently omit missing STEP geometry and did not synthesize measurements from config intent. |
| [#105](https://github.com/dooosp/freecad-automation/pull/105) | Merged | `6bd7aaf1da92331213a2f4d960dbae4c5147b6a9` | Added narrow `fcad tolerance --recommend --csv` runtime smoke coverage using `configs/examples/ptu_assembly_mates.toml`, plus manifest and docs wording updates. | Did not claim Linux or Windows runtime ownership, broad tolerance-analysis maturity, or Monte Carlo acceptance coverage. |
| [#106](https://github.com/dooosp/freecad-automation/pull/106) | Merged | `580bedadd99647d7721bda2d7723197c57f04bfa` | Added `tests/source-of-truth-drift.test.js` and wired it into the Node contract lane so package scripts, command classifications, support-matrix command lists, and runtime-smoke wording stay aligned with shared manifests. | Did not add runtime execution, change CLI command behavior, or replace the existing package/test manifests. |
| [#107](https://github.com/dooosp/freecad-automation/pull/107) | Merged | `4bbcef0bb12b6eab3c8b5bda90baa8b1bd23a98c` | Hardened the inspection evidence validator and tests so generated artifact types and generated artifact paths are rejected even when shaped like inspection evidence. | Did not promote generated CAD, drawing, readiness, release, manifest, runtime-smoke, or package artifacts into `inspection_evidence`. |

All six PRs reported green hosted lanes. Each PR also reported a successful `Self-hosted macOS FreeCAD smoke` check in GitHub Actions.

## STEP reimport validation status

Stage 5E keeps two evidence sources separate:

- `generated_shape_geometry`: measurements captured from the FreeCAD shape generated before export.
- `reimported_step_geometry`: measurements captured only after the exported STEP file is re-imported.

The fixture-scoped STEP hole validation is limited to the explicit quality fixtures:

- `quality_pass_bracket`
- `quality_fail_wrong_hole_diameter`
- `quality_fail_wrong_hole_center`

The hardening now covers positive and negative paths:

- Passing fixture reimports can add STEP-backed hole diameter and center measurements with `reimported_step_geometry_check` provenance.
- Failed STEP reimport does not create fake STEP measurements.
- Missing cylindrical hole geometry after STEP reimport is reported as unavailable evidence and blocks strict quality for eligible fixtures.
- Generic hole configs remain generated-shape-only unless they match the explicit fixture scope.

This validates exported STEP round-trip evidence for the fixture scope. It does not prove generalized feature recognition, and it does not make STEP reimport data a source of package `inspection_evidence`.

## Tolerance smoke coverage

PR #105 added repository-owned tolerance runtime smoke coverage to the self-hosted macOS FreeCAD smoke lane. The coverage is intentionally narrow:

- command path: `fcad tolerance --recommend --csv`
- fixture: `configs/examples/ptu_assembly_mates.toml`
- expected output: generated tolerance CSV
- manifest checks: artifact manifest, output manifest, smoke-manifest bookkeeping, and non-empty recorded output
- runtime ownership: self-hosted macOS with FreeCAD 1.1.x

Current non-claims remain explicit:

- no repository-owned live tolerance smoke on Linux
- no repository-owned live tolerance smoke on Windows native
- no repository-owned live tolerance smoke for WSL to Windows FreeCAD
- no broad repository-owned tolerance-analysis maturity claim
- no Monte Carlo-specific acceptance coverage claim

## Source-of-truth drift guard

PR #106 added a contract-lane drift guard for command and validation wording that is easy to overstate in docs:

- `package.json` script entries must stay aligned with `tests/lane-manifest.js`.
- README command classifications must stay aligned with `src/shared/command-manifest.js`.
- `docs/support-matrix.md` FreeCAD-backed, plain-Python, and mixed command lists must stay aligned with the shared command manifest.
- README and `docs/testing.md` must continue to describe `npm test` as the default Node suite, not as a runtime-domain shim.
- README, `docs/testing.md`, and `docs/support-matrix.md` must keep the narrow runtime-smoke command claims visible while stating that hosted CI does not install or launch FreeCAD.

This guard protects docs and test-lane source-of-truth wording. It does not make hosted CI runtime-backed, add new runtime ownership, or replace the existing shared manifests.

## Inspection evidence boundary hardening

PR #107 moved the generated-artifact boundary into the inspection evidence validator itself. The validator now rejects generated artifact identities through `artifact_type` or `type`, and rejects generated artifact paths through `source_ref` or `source_file`.

Rejected generated evidence includes create quality, drawing quality, drawing QA, drawing intent, extracted drawing semantics, feature catalogs, DFM reports, tolerance reports, runtime-smoke outputs, readiness reports, review packs, standard-doc manifests, release bundles, package manifests, artifact manifests, and output manifests.

The contract remains intentionally narrow:

- genuine completed inspection evidence must validate against the inspection evidence schema and include real measured feature records with explicit result semantics.
- source references must be safe repo-relative paths outside `output/` and `tmp/codex/`.
- generated artifacts remain useful review evidence, package context, runtime evidence, or release context, but they do not satisfy `inspection_evidence`.

## Remaining non-inspection risks

The main remaining risks are documentation, manifest, runtime-claim, and UI wording drifting away from the machine-readable contracts. None of these risks changes the current inspection-evidence boundary.

| Risk | Current protection | Residual gap |
| --- | --- | --- |
| STEP evidence source drift | README wording, first-user docs smoke assertions, create-quality unit coverage, and Studio quality dashboard tests distinguish generated-shape and STEP reimport rows. | Future docs or UI copy could collapse the distinction unless new text stays covered by docs smoke or model tests. |
| Unavailable evidence drift | Create-quality tests assert unavailable status/source/provenance and blocking behavior for missing STEP geometry. | Future compatibility wrappers could accidentally turn missing geometry into warnings or inferred values. |
| Runtime claim drift | `docs/testing.md`, `docs/support-matrix.md`, README, runtime smoke harness wording, and `tests/source-of-truth-drift.test.js` limit runtime claims to actual hosted-safe lanes plus the narrow self-hosted macOS runtime smoke lane. | Future release notes, support docs, or command manifests could still overstate Linux, Windows, WSL, or Monte Carlo coverage unless they are tied back to the shared manifests and smoke evidence. |
| Manifest source drift | Runtime smoke checks artifact manifests, output manifests, and smoke-manifest bookkeeping for tolerance outputs. | New tolerance output modes could bypass manifest coverage unless added to the smoke harness. |
| Package readiness drift | Existing closeout docs keep generated quality, drawing, readiness, standard-doc, release, fixture, and collection-guide artifacts outside `inspection_evidence`. The inspection evidence validator now rejects generated artifact identities and generated artifact paths directly. | Any future package promotion must continue to require genuine completed inspection evidence through the canonical evidence-gated path. |

## Evidence-boundary protections

Stage 5E preserves these boundaries:

- Generated CAD, drawing, quality, review, readiness, standard-doc, release, fixture, collection-guide, runtime-smoke, artifact-manifest, and output-manifest artifacts are not package `inspection_evidence`.
- STEP reimport evidence is CAD export round-trip evidence, not physical inspection evidence.
- Unavailable geometry is represented as unavailable provenance, not inferred measurement data.
- Runtime-backed wording is reserved for checks that actually launch or exercise a real FreeCAD runtime.
- Hosted CI remains hosted-safe unless a live FreeCAD runtime is actually present and used.
- The self-hosted macOS smoke lane is the repository-owned runtime source of truth for the listed FreeCAD-backed checks, including narrow tolerance CSV smoke.
- Shared command and lane manifests are the source of truth for command classifications and documented default test coverage.

## Validation recorded by the PRs

Across PRs #102-#107, the recorded validation included:

- `node tests/create-quality.test.js`
- `node tests/quality-fixture-matrix.test.js`
- `node tests/first-user-docs-smoke.test.js`
- `node tests/source-of-truth-drift.test.js`
- `node tests/inspection-evidence-contract.test.js`
- `node tests/lane-manifest.test.js`
- `node --check tests/runtime-smoke-cli.js`
- `npm run test:node:contract`
- `npm test`
- `npm run test:runtime-smoke`
- `git diff --check`
- live `node bin/fcad.js check-runtime` and `node bin/fcad.js create configs/examples/quality_pass_bracket.toml --strict-quality` evidence reported in PR #102

This status document is a docs-only summary. It does not add new runtime validation, regenerate artifacts, change CLI behavior, change schemas, or modify Studio behavior.

## Stage 5E status

Stage 5E quality hardening is merged through PR #107. The software is better guarded against STEP evidence ambiguity, silent unavailable geometry, tolerance support overclaims, command/test source-of-truth drift, and generated-artifact inspection evidence leakage.

Production readiness remains held. Stage 5B remains parked until genuine completed inspection evidence exists, validates against the inspection evidence contract, and is attached through the explicit evidence-gated flow.
