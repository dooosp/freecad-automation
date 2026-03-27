# Testing And Verification

This repository now separates fast hosted checks from real FreeCAD-backed smoke verification. Run `fcad check-runtime` first on any machine that will execute the FreeCAD-backed paths.

## Test Lanes

| Lane | Command | Scope | FreeCAD required |
| --- | --- | --- | --- |
| Node contract | `npm run test:node:contract` | config migration/validation, runtime path resolution, invocation assembly, structural validation | No |
| Node integration | `npm run test:node:integration` | local API/job contracts, rule profiles, sweep logic, draw/report service integration | No |
| Snapshots | `npm run test:snapshots` | normalized SVG and report preview regression baselines | No |
| Python | `npm run test:py` | plain-Python and CLI-adjacent regression coverage that does not require a live FreeCAD launch | No |
| Runtime smoke | `npm run test:runtime-smoke` | real `fcad` smoke for `check-runtime`, `create`, `draw --bom`, `inspect`, and `report` using checked-in example configs | Yes |

Runtime domain checks remain available for deeper local verification:

- `npm run test:runtime:model`
- `npm run test:runtime:drawing`
- `npm run test:runtime:analysis`
- `npm run test:runtime:report`
- `npm run test:runtime:integration`
- `npm run test:runtime:full`

The runtime domain runner uses the same FreeCAD-backed script path as the CLI and will fail early if you request runtime-backed layers without a detectable runtime.

## Workflow Mapping

| Workflow | What it runs | What it does not claim |
| --- | --- | --- |
| `Automation CI (hosted fast lanes)` | `test:node:contract`, `test:node:integration`, `test:snapshots`, `test:py` | No hosted FreeCAD install or launch |
| `FreeCAD Runtime Smoke (self-hosted macOS)` | `test:runtime-smoke` plus runtime-backed Python smoke regressions | No Linux or Windows runtime ownership claims |

The hosted workflow is the fast PR lane. The self-hosted workflow is scheduled/manual and is the repository-owned runtime smoke source of truth.

## Runtime Smoke Contents

`npm run test:runtime-smoke` uses the checked-in `configs/examples/ks_bracket.toml` example and rewrites it into a throwaway output directory under `output/runtime-smoke/`.

The smoke lane verifies:

- `fcad check-runtime`
- `fcad create`
- `fcad draw --bom`
- `fcad inspect`
- `fcad report`

Artifacts are written under `output/runtime-smoke/` plus the generated report PDF in `output/`. The smoke script also writes `output/runtime-smoke/smoke-manifest.json` to make artifact uploads easier to inspect.

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

```bash
npm run test:node:contract
npm run test:node:integration
npm run test:snapshots
```

Python lane:

```bash
npm run test:py
```

This lane requires Python 3.11+ and the helper script will prefer `python3.13`, `python3.12`, `python3.11`, then `python3`.

Real runtime smoke:

```bash
fcad check-runtime
npm run test:runtime-smoke
```

Deeper runtime-backed suites:

```bash
npm run test:runtime:model
npm run test:runtime:drawing
npm run test:runtime:analysis
npm run test:runtime:report
npm run test:runtime:integration
```

## Known Limitations

- Hosted CI does not prove that FreeCAD launches successfully on Linux or macOS.
- Windows and WSL support are still contract-tested compatibility paths, not runtime-smoke-covered platforms.
- The Python lane intentionally excludes runtime-backed smoke regressions so the default hosted lane stays fast and honest.
