# Support Matrix

`fcad check-runtime` is the central installation and runtime-diagnostic tool for this repository. Run it first on any new machine and before troubleshooting a FreeCAD-backed command.

This matrix is the public support boundary for the current release. It separates repository-owned verification from compatibility paths that still depend on user-local validation.

## Runtime Verification Matrix

| Platform / runtime path | `fcad check-runtime` detection | Repository-owned live verification | Current status | Notes |
| --- | --- | --- | --- | --- |
| macOS + `FreeCAD.app` 1.1.x | Yes | Yes | Verified | Maintainer-local verification covers `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, and `report`. Repository-owned runtime smoke covers `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, and `report` on self-hosted macOS. |
| macOS hosted CI (`macos-14`) | N/A for live FreeCAD | No | Hosted-safe only | Hosted CI runs Node runtime-contract tests only. It does not install or launch FreeCAD. |
| Ubuntu hosted CI (`ubuntu-24.04`) | N/A for live FreeCAD | No | Hosted-safe only | Hosted CI runs Node contract, Node integration, snapshots, and Python lanes without installing FreeCAD. |
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
- `readiness-report`
- `stabilization-review`
- `generate-standard-docs`
- `ingest`
- `quality-link`
- `review-pack`
- `compare-rev`
- `validate`
- `validate-config`
- `migrate-config`
- `serve`

### Mixed / Conditional

- `analyze-part`: runs in plain Python mode when the context already contains model metadata, but uses FreeCAD for live model inspection or STEP feature detection.
- `design`: generates config content first, then calls `create`.
- `sweep`: follows the matrix-selected service wrappers; cost-only variants can stay plain Python, while create/fem/report variants require FreeCAD.

## What Is Verified

- Maintainer-local macOS + `FreeCAD.app` 1.1.x verification exists for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, and `report`.
- Repository-owned runtime smoke exists on self-hosted macOS for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, and `report`.
- Hosted CI covers Node runtime/path contracts, non-runtime integration checks, snapshots, and Python tests without claiming a live FreeCAD install.

## What Is Not Yet Claimed

- No repository-owned live runtime smoke on Linux.
- No repository-owned live runtime smoke on Windows native.
- No repository-owned live runtime smoke for WSL -> Windows FreeCAD.
- No repository-owned live runtime smoke for `tolerance`; keep that assembly-plus-Monte-Carlo path as local/deeper validation until it is hardened enough for CI.
- No claim that hosted CI proves FreeCAD launches successfully.

## Recommended User Flow

1. Install Node.js 18+, Python 3.11+, and FreeCAD 1.1.x if you need the FreeCAD-backed commands.
2. Run `fcad check-runtime`.
3. If the runtime is detected, run a small end-to-end command such as `fcad create <config.toml>` or `npm run test:runtime-smoke`.
4. If runtime detection fails, fix the `FREECAD_*` override or install path reported by `fcad check-runtime`, then rerun it.
5. If you only need the manufacturing-review layer, continue with the plain-Python / Node commands while FreeCAD setup is still in progress.
