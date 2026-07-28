# Support Matrix

`fcad check-runtime` is the central installation and runtime-diagnostic tool for this repository. Run it first on any new machine and before troubleshooting a FreeCAD-backed command. Use `fcad check-runtime --json` when tooling needs the same machine-readable runtime contract that `GET /health` returns, and add `--redact-paths` for CI uploads or other diagnostics that should avoid absolute host paths.

### Runtime fingerprint

Use `fcad check-runtime --fingerprint-out <runtime_fingerprint.json>` only when you need a local reproducibility snapshot of the repository branch/SHA, dirty-state flag, platform, FreeCAD status/version, and command coverage reported by this diagnostic surface.

The runtime fingerprint records local execution context and FreeCAD/runtime capability. It is reproducibility evidence only; it is not physical inspection evidence and does not clear production readiness.

This matrix is the public support boundary for the current release. It separates repository-owned verification from compatibility paths that still depend on user-local validation.

## Product and lifecycle alignment

Runtime support and command lifecycle are separate dimensions. A command can be stable while remaining supported only on the listed runtime path, and a beta or maintainer command can run without FreeCAD. The shared manifest is authoritative for both dimensions.

- `fcad --help` exposes 12 stable primary rows across review, compare/plan, and receive-results workflows.
- `fcad help --all` keeps beta, experimental, maintainer, compatibility, deprecated-route, and internal commands discoverable.
- `readiness-report --review-pack` remains compatible; `readiness-report <config>` remains available with a precise deprecation warning and `readiness-pack --review-pack` replacement.
- `serve --legacy-viewer` and the `mfg-agent` alias remain compatibility routes.
- Raw completed result files remain CLI-only under `inspection-result-normalize`; no browser upload or arbitrary Local API source path is supported.

See [command lifecycle](./command-lifecycle.md) and [product workflows](./product-workflows.md).

## Runtime Verification Matrix

| Platform / runtime path | `fcad check-runtime` detection | Repository-owned live verification | Current status | Notes |
| --- | --- | --- | --- | --- |
| macOS + `FreeCAD.app` 1.1.x | Yes | Yes | Covered for listed checks | Maintainer-local checks cover `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, narrow `tolerance --csv`, and `report`. Repository-owned runtime smoke covers `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, narrow `tolerance --csv`, and `report` on self-hosted macOS; PR smoke is sequenced after successful hosted CI for same-repository heads. |
| macOS hosted CI (`macos-14`) | N/A for live FreeCAD | No | Hosted-safe only | Hosted CI runs Node runtime-contract tests only. It does not install or launch FreeCAD. |
| Ubuntu hosted CI (`ubuntu-24.04`) | N/A for live FreeCAD | No | Hosted-safe only | Hosted CI runs Node contract, Node integration, snapshots, Studio browser smoke, and Python lanes without installing FreeCAD; the Node contract lane includes the non-mutating Stage 5B no-evidence CLI lane, audit CLI smoke with GitHub discovery disabled, source acquisition/preflight guard, and surrogate inspection validation guard. |
| Linux local with FreeCAD installed | Yes | No | Compatibility path | Runtime discovery and command assembly exist, but there is no repository-owned live runtime smoke on Linux yet. Validate locally with `fcad check-runtime` and your own smoke runs. |
| Windows native + FreeCAD 1.1 | Yes | No | Compatibility path | Use explicit `FREECAD_*` overrides if PATH discovery is insufficient. Runtime ownership is not yet backed by repository-owned live smoke. |
| WSL -> Windows FreeCAD | Yes, with explicit override | No | Compatibility path | No default bridge is assumed. Point `FREECAD_DIR`, `FREECAD_BIN`, or `FREECAD_PYTHON` at the Windows install explicitly. |

## Command Runtime Classes

`fcad check-runtime` reports these command classes directly so users can tell which work is blocked by runtime issues.

### Requires FreeCAD

- `create`
- `draw`
- `inspect`
- `fem`
- `tolerance`
- `report`

### Runs Without Launching FreeCAD

- `dfm`
- `review`
- `process-plan`
- `line-plan`
- `quality-risk`
- `investment-review`
- `readiness-pack`
- `readiness-report`
- `pack`
- `closeout-package`
- `evidence-graph`
- `evidence-readiness-audit`
- `evidence-artifacts-materialize`
- `maintainer-decision-journal`
- `inspection-evidence-intake`
- `inspection-evidence-quarantine`
- `inspection-evidence-validate`
- `inspection-evidence-authorize`
- `inspection-evidence-attach`
- `inspection-evidence-regenerate-readiness`
- `inspection-evidence-promotion-dry-run`
- `inspection-plan`
- `manufacturing-action-dataset`
- `inspection-plan-release-record`
- `inspection-result-normalize`
- `stage5b-evidence-audit`
- `stage5b-evidence-source-kit`
- `stage5b-evidence-source-preflight`
- `stage5b-evidence-review-dry-run`
- `stage5b-evidence-attachment-controller`
- `stage5b-evidence-pipeline-doctor`
- `stage5b-surrogate-inspection-validation`
- `stabilization-review`
- `generate-standard-docs`
- `ingest`
- `quality-link`
- `review-pack`
- `review-context`
- `compare-rev`
- `validate`
- `validate-config`
- `migrate-config`
- `serve`

`review-context --context ...` stays fully plain Python / Node. `review-context --model ...` now degrades to a metadata-only review flow with low-confidence warnings when runtime-backed model inspection or STEP feature detection cannot extract usable shape metrics.

### Mixed / Conditional

- `analyze-part`: runs in plain Python mode when the context already contains model metadata, uses FreeCAD for live model inspection or STEP feature detection when available, and falls back to bounded metadata-only geometry artifacts when model inspection is unavailable or the shape is weak/invalid.
- `design`: generates config content first, then calls `create`.
- `sweep`: follows the matrix-selected service wrappers; cost-only variants can stay plain Python, while create/fem/report variants require FreeCAD.

## What Is Covered

- Maintainer-local macOS + `FreeCAD.app` 1.1.x checks exist for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, narrow `tolerance --csv`, and `report`.
- Repository-owned runtime smoke exists on self-hosted macOS for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, narrow `tolerance --csv`, and `report`; PR smoke is sequenced after successful hosted CI for same-repository heads.
- Hosted CI covers Node runtime/path contracts, the non-mutating Stage 5B no-evidence CLI lane, audit CLI smoke, source acquisition/preflight guard, attachment-controller guard, surrogate inspection validation guard, non-runtime integration checks, snapshots, and Python tests without claiming a live FreeCAD install.

## What Is Not Yet Claimed

- No repository-owned live runtime smoke on Linux.
- No repository-owned live runtime smoke on Windows native.
- No repository-owned live runtime smoke for WSL -> Windows FreeCAD.
- No repository-owned live runtime smoke for `tolerance` on Linux, Windows native, or WSL -> Windows FreeCAD.
- No broad repository-owned tolerance-analysis maturity claim: the only repository-owned tolerance runtime coverage today is the narrow self-hosted macOS CSV smoke, not Monte Carlo or deeper tolerance validation.
- No claim that hosted CI proves FreeCAD launches successfully.

## Recommended User Flow

1. Install Node.js 18+, Python 3.11+, and FreeCAD 1.1.x if you need the FreeCAD-backed commands.
2. Run `fcad check-runtime`.
3. If the runtime is detected, run a small end-to-end command such as `fcad create <config.toml>` or `npm run test:runtime-smoke`.
4. If runtime detection fails, fix the `FREECAD_*` override or install path reported by `fcad check-runtime`, then rerun it.
5. If you only need the manufacturing-review layer, continue with the plain-Python / Node commands while FreeCAD setup is still in progress.
6. For maintainer readiness review, run `fcad evidence-readiness-audit --out-dir output/evidence-readiness-audit --clean` to summarize canonical packages and held-readiness truth without attachment or regeneration. Existing Stage 5B source-kit, preflight, review-dry-run, controller, audit, surrogate, and Studio surfaces are discovery/control aids only. A genuine received record must enter the production contract through `inspection-evidence-quarantine`, `inspection-evidence-validate`, checksum-bound `inspection-evidence-authorize`, and idempotent `inspection-evidence-attach`. `review-context` then requires the immutable attachment record, and readiness requires a distinct `inspection-evidence-regenerate-readiness` authorization. QIF-lite, generated artifacts, CI output, and synthetic fixtures remain non-evidence regardless of rename or copy. See the [inspection evidence onboarding contract](./inspection-evidence-contract.md) and [verification plan](./exec-plans/inspection-evidence-onboarding-verification.md).

The optional legacy discovery audit may inspect HTTPS GitHub/GitHubusercontent allowlisted public links; downloaded material remains untrusted discovery input and must still enter quarantine. The safe non-production chain remains `source-kit -> source-preflight -> review-dry-run -> attachment-controller -> pipeline-doctor -> later explicit real attachment/regeneration goal`. Only genuine completed physical/supplier/lab/QA inspection records can satisfy `inspection_evidence`. The five canonical packages remain `needs_more_evidence` with `hold_for_evidence_completion`, and `inspection_evidence` remains missing until the separate authorized attachment and readiness-regeneration operations have both completed.
