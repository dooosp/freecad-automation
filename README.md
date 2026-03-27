# FreeCAD Automation

FreeCAD Automation is a FreeCAD-backed automation pipeline for CAD generation, TechDraw drawings, inspection, FEM, reporting, and manufacturing-review artifacts.

The repository has two public layers:

- a runtime-backed CLI for CAD, TechDraw, FEM, tolerance, inspection, and reporting
- a plain-Python/Node manufacturing-review layer for DFM, process planning, readiness review, stabilization review, and review-pack artifacts

Validation snapshot:

- verified locally by maintainers on macOS with FreeCAD 1.1.x for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, and `report`
- verified in CI for runtime detection/path contracts on `ubuntu-24.04` and `macos-14`, plus Python unit/CLI coverage on `ubuntu-24.04`; hosted CI does not install or launch FreeCAD
- experimental or not yet automated for live FreeCAD execution on Windows native, WSL -> Windows FreeCAD, and Linux; those paths remain compatibility paths, not equal-maturity claims

Run `fcad check-runtime` first on any new machine and before troubleshooting a FreeCAD-backed failure.

Execution model: `bin/fcad.js -> lib/runner.js -> scripts/*.py -> scripts/_bootstrap.py -> import FreeCAD` for the runtime-backed commands. The manufacturing-review layer uses the same configs and artifacts but often runs under plain `python3` without launching FreeCAD.

## Start Here

For a first local verification:

```bash
npm install
npm link
fcad check-runtime
fcad create configs/examples/ks_bracket.toml
fcad draw configs/examples/ks_bracket.toml --bom
fcad inspect output/ks_bracket.step
```

If you are reviewing the repository on GitHub:

1. Read the [infotainment production readiness case study](./docs/portfolio/infotainment-production-readiness-case.md).
2. Open the [checked-in example artifact set](./docs/examples/infotainment-display-bracket/README.md).
3. Compare the [Korea vs Mexico stabilization example](./docs/examples/infotainment-display-bracket/stabilization-comparison.md).
4. Read the [before-vs-after improvement case](./docs/portfolio/before-after-improvement-case.md).
5. Skim the [readiness report markdown](./docs/examples/infotainment-display-bracket/readiness-report.md).
6. Inspect the [example config](./configs/examples/infotainment_display_bracket.toml) and the command classification below.

## Supported And Verified Platform Scope

### Verified locally

- macOS + `FreeCAD.app` 1.1.x: `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, `report`

### Verified in CI

- Node runtime detection, path conversion, and invocation contract tests on `ubuntu-24.04` and `macos-14`
- Python unit and CLI tests on `ubuntu-24.04`
- Hosted CI does not install or launch FreeCAD

### Experimental / not yet automated

- Windows native: explicit `FREECAD_*` overrides and invocation logic are covered, but there is no repository-owned FreeCAD runtime smoke execution
- WSL -> Windows FreeCAD: explicit bridge/path conversion logic is covered, but there is no default bridge assumption and no repository-owned runtime smoke execution
- Linux: path discovery and command assembly are covered, but there is no repository-owned FreeCAD runtime smoke execution yet

## Target Use Cases

- parametric 3D model generation from TOML configs
- engineering drawing generation through TechDraw
- model inspection, FEM, tolerance, and PDF report generation
- manufacturability screening, process-plan support, and readiness reporting
- runtime-informed launch stabilization review from supplied runtime JSON
- draft generation of production-engineering standard documents

## Production Engineering Layer

The repository also includes production-engineering workflows and infotainment-oriented examples, but those should be read as decision-support tooling layered on top of the core automation pipeline.

- Structure review: check wall thickness, connector-side clearance, fastening accessibility, and mounting-boss layout before tooling freeze.
- Process design support: infer rough process sequence, inspection points, and likely bottleneck candidates from geometry and manufacturing assumptions.
- Launch/stabilization support: compare supplied CT, FPY, rework, scrap, downtime, and changeover signals against planning assumptions.
- Quality-risk visibility: surface critical dimensions, quality gates, traceability capture points, and inspection-sensitive features.
- Standard-document support: generate draft process flow, control plan, checksheet, work instruction, and PFMEA seed artifacts.

Outputs are heuristic engineering aids. They are not full production-line simulations or a substitute for engineering sign-off.

## Codex Multi-Agent Prompt Workflow

If you want Codex to drive the legacy CAD and drawing pipeline as a small orchestrated agent team, use:

- [Workflow guide](./docs/codex-multi-agent-workflow.md)
- [Prompt pack](./prompts/multi-agent/)
- [Starter generated config](./configs/generated/cnc_motor_mount_bracket.toml)

Recommended stable starting flow:

```bash
fcad create configs/generated/cnc_motor_mount_bracket.toml
fcad draw configs/generated/cnc_motor_mount_bracket.toml --bom
fcad dfm configs/generated/cnc_motor_mount_bracket.toml --strict
fcad tolerance configs/generated/cnc_motor_mount_bracket.toml --recommend
```

This keeps Codex focused on the existing `config -> create -> draw -> dfm -> tolerance/report` loop without changing the repository runtime model.

## Command Surface

Run `fcad check-runtime` before any FreeCAD-backed command on a new machine and as the first troubleshooting step for runtime-backed failures. It prints the resolved runtime, the candidate paths that were checked, and the env-var precedence order.

### Command Classification

| Class | Commands | Runtime boundary |
| --- | --- | --- |
| Diagnostics | `check-runtime` | does not require FreeCAD to be present |
| FreeCAD-backed | `create`, `draw`, `inspect`, `fem`, `tolerance`, `report` | requires a working FreeCAD runtime |
| Plain-Python / non-FreeCAD | `dfm`, `review`, `process-plan`, `line-plan`, `quality-risk`, `investment-review`, `readiness-report`, `stabilization-review`, `generate-standard-docs`, `ingest`, `quality-link`, `review-pack`, `compare-rev`, `validate`, `serve` | runs without launching FreeCAD |
| Mixed / conditional | `analyze-part`, `design` | `analyze-part` can inspect CAD through FreeCAD when needed; `design` ends by calling `create` |

### Production-Readiness Commands

```bash
fcad review <config.toml|json>
fcad process-plan <config.toml|json>
fcad line-plan <config.toml|json>
fcad quality-risk <config.toml|json>
fcad investment-review <config.toml|json>
fcad readiness-report <config.toml|json>
fcad stabilization-review <config.toml|json> --runtime <runtime.json>
fcad generate-standard-docs <config.toml|json> [--out-dir <dir>]
```

`mfg-agent` is also installed as an alias for the same CLI.

### Review-Pack Commands

```bash
fcad ingest --model <file> [--bom bom.csv] [--inspection inspection.csv] [--quality quality.csv] --out <context.json>
fcad analyze-part <context.json|model.step>
fcad quality-link --context <context.json> --geometry <geometry.json>
fcad review-pack --context <context.json> --geometry <geometry.json>
fcad compare-rev <baseline.json> <candidate.json>
```

### Diagnostics And Runtime-Backed Commands

```bash
fcad check-runtime
fcad create <config.toml|json>
fcad draw <config.toml|json>
fcad report <config.toml|json>
fcad inspect <model.step|fcstd>
fcad fem <config.toml|json>
fcad tolerance <config.toml|json>
```

`report` is still classified as runtime-backed because it runs inside the FreeCAD bundle on macOS even when it falls back from `freecadcmd` to the bundled FreeCAD Python executable.

### Create Canonical Schema

`fcad create` accepts two canonical config styles.

- Single-part mode: top-level `shapes` plus optional top-level `operations`
- Assembly mode: top-level `parts` and `assembly` must both be present
- The operation canonical key is `op`
- `type -> op` is backward compatibility only
- Shape aliases are not supported
- Assembly part operations are not identical to single-part operations

Minimal single-part example:

```toml
name = "minimal_block"
final = "body_fillet"

[[shapes]]
id = "body"
type = "box"
length = 40
width = 20
height = 10

[[operations]]
op = "fillet"
target = "body"
radius = 1
result = "body_fillet"

[export]
formats = ["step"]
directory = "output"
```

Minimal assembly example:

```toml
name = "minimal_assembly"

[[parts]]
id = "base"
final = "base_body"
  [[parts.shapes]]
  id = "base_body"
  type = "box"
  length = 40
  width = 20
  height = 10

[[parts]]
id = "pin"
final = "pin_body"
  [[parts.shapes]]
  id = "pin_body"
  type = "cylinder"
  radius = 4
  height = 20

[assembly]
  [[assembly.parts]]
  ref = "base"
  position = [0, 0, 0]

  [[assembly.parts]]
  ref = "pin"
  position = [20, 10, 0]

[export]
formats = ["step"]
directory = "output"
per_part_stl = true
```

Notes:

- In single-part mode, the final shape defaults to the last created result unless `final` is set.
- In assembly mode, each part can define its own `final`.
- Assembly mode currently expects top-level `parts` and `assembly`; `parts` alone does not activate assembly handling.
- Assembly part operations currently follow the assembly builder's supported set and are not a drop-in match for every single-part operation.

Legacy / compatibility note:

- Existing configs that use `type` inside `[[operations]]` may still load because the normalizer maps `type -> op`.
- New configs should use `op` directly and should treat `type -> op` as compatibility-only behavior.

## Example Flow

```bash
# 1. Design-stage production engineering review
fcad review configs/examples/infotainment_display_bracket.toml \
  --out output/infotainment_display_bracket_product_review.json

# 2. Rough process planning support
fcad process-plan configs/examples/infotainment_display_bracket.toml \
  --out output/infotainment_display_bracket_process_plan.json

# 3. Consolidated production-readiness report
fcad readiness-report configs/examples/infotainment_display_bracket.toml \
  --batch 120 \
  --out output/infotainment_display_bracket_readiness_report.json

# 4. Runtime-informed launch stabilization review
fcad stabilization-review configs/examples/infotainment_display_bracket.toml \
  --runtime data/runtime_examples/display_bracket_runtime.json \
  --profile configs/profiles/site_korea_ulsan.toml \
  --out output/infotainment_display_bracket_stabilization_review.json

# 5. Draft production-engineering standard docs
fcad generate-standard-docs configs/examples/controller_housing_eol.toml \
  --out-dir output/controller_housing_standard_docs
```

The readiness workflow produces a JSON report and a Markdown summary that bundle:

- product review
- process plan
- line-layout support pack
- quality / traceability pack
- cost / investment review
- optional runtime-informed stabilization review
- decision summary for production engineering discussion

## Portfolio Case Study

For a checked-in example that can be reviewed without running the CLI, see:

- [Infotainment production readiness case](./docs/portfolio/infotainment-production-readiness-case.md)
- [Checked-in example artifact set](./docs/examples/infotainment-display-bracket/README.md)
- [Korea vs Mexico stabilization comparison](./docs/examples/infotainment-display-bracket/stabilization-comparison.md)
- [Before-vs-after improvement case](./docs/portfolio/before-after-improvement-case.md)
- [Checked-in electronics assembly + standard docs example](./docs/examples/controller-housing-eol/README.md)

This case shows `config -> review -> process-plan -> line-plan -> quality-risk -> investment-review -> readiness-report -> stabilization-review -> standard-doc drafts` for infotainment-oriented scenarios.

## Automotive Infotainment Example Configs

- `configs/examples/infotainment_display_bracket.toml`
- `configs/examples/infotainment_display_bracket_before.toml`
- `configs/examples/infotainment_display_bracket_after.toml`
- `configs/examples/controller_housing.toml`
- `configs/examples/controller_housing_eol.toml`
- `configs/examples/pcb_mount_plate.toml`
- `configs/examples/display_module_support.toml`

These examples include manufacturing metadata such as:

- material and process assumptions
- cross-site launch scope
- annual volume and target cycle time placeholders
- connector clearance assumptions
- critical dimensions and quality gates
- automation-candidate notes
- electronics assembly metadata and EOL test assumptions

Runtime/profile examples:

- `data/runtime_examples/display_bracket_runtime.json`
- `data/runtime_examples/display_bracket_runtime_mexico.json`
- `configs/profiles/site_korea_ulsan.toml`
- `configs/profiles/site_mexico_mty.toml`

## Architecture

```text
CLI (fcad / mfg-agent)
  |
  +-- legacy CAD / drawing / report commands
  +-- review-pack workflow
  +-- production-readiness workflow
          |
          +-- intent compiler
          +-- DFM checker
          +-- cost estimator
          +-- product review agent
          +-- process planning agent
          +-- line layout support agent
          +-- quality / traceability agent
          +-- cost / investment review agent
```

### Main code areas

- `bin/fcad.js`: unified CLI entrypoint
- `src/agents/`: manufacturing-engineering agent modules
- `src/workflows/readiness-report-workflow.js`: orchestrated readiness flow
- `src/workflows/standard-docs-workflow.js`: draft standard-document generation
- `scripts/dfm_checker.py`: DFM manufacturability logic
- `scripts/cost_estimator.py`: cost breakdown and comparison logic
- `scripts/intent_compiler.py`: part-type inference and drawing-plan strategy
- `schemas/`: output contracts for review, process-plan, line-plan, quality-risk, investment-review, readiness-report, stabilization-review, and standard-doc manifests

See [production-readiness-refactor.md](./docs/production-readiness-refactor.md) for the codebase refactoring map.

## Installation

### Prerequisites

- Node.js 18+
- Python 3.11+
- FreeCAD 1.1.x for the FreeCAD-backed commands

### Setup

```bash
git clone https://github.com/dooosp/freecad-automation.git
cd freecad-automation
npm install
npm link
fcad check-runtime
```

### Runtime Detection And Precedence

Resolution order for runtime-backed commands:

1. `FREECAD_PYTHON`
2. `FREECAD_BIN`
3. `FREECAD_CMD`
4. `FREECAD_APP`
5. `FREECAD_DIR` (backward-compatible install-root fallback)

If none of those overrides are set, the resolver falls back to platform detection:

- macOS: prefer `FreeCAD.app` bundle discovery from `/Applications/FreeCAD.app`, `~/Applications/FreeCAD.app`, and PATH-visible bundle/runtime executables
- Windows native: look for PATH-visible `FreeCADCmd.exe`, `freecadcmd.exe`, or `FreeCAD.exe`
- WSL: no default bridge guess is assumed; explicit Windows paths are converted with `wslpath` when available
- Linux / other POSIX: look for PATH-visible `FreeCADCmd`, `freecadcmd`, `FreeCAD`, or `freecad`

Use `fcad check-runtime` or `npm run check:runtime` as the first troubleshooting step. It shows the resolved runtime, where it came from, which candidates were checked, and which commands are blocked if no runtime is available.

Commands that directly depend on the resolved FreeCAD runtime:

- `create`
- `draw`
- `inspect`
- `fem`
- `tolerance`
- `report`

Conditional runtime usage:

- `analyze-part`: can run from existing context/model metadata without FreeCAD, but uses FreeCAD when it needs live model inspection or STEP feature detection
- `design`: generates TOML, then calls `create`

Supported inputs for `FREECAD_APP`, `FREECAD_BIN`, `FREECAD_PYTHON`, `FREECAD_CMD`, and backward-compatible `FREECAD_DIR` include:

- `/Applications/FreeCAD.app`
- `~/Applications/FreeCAD.app`
- `.../FreeCAD.app/Contents`
- `.../FreeCAD.app/Contents/Resources`
- `.../FreeCAD.app/Contents/Resources/bin`
- explicit bundle-internal executables such as `.../Contents/MacOS/FreeCAD` or `.../Contents/Resources/bin/python`

The resolver canonicalizes those forms back to one `FreeCAD.app` bundle root, then derives:

- GUI launcher: `Contents/MacOS/FreeCAD`
- headless/script runtime: bundled `freecadcmd`/`freecad` first, then bundled Python
- bundled Python: `Contents/Resources/bin/python`

Recommended macOS setup:

```bash
export FREECAD_APP="/Applications/FreeCAD.app"
fcad check-runtime
```

Explicit runtime overrides:

```bash
export FREECAD_PYTHON="/Applications/FreeCAD.app/Contents/Resources/bin/python"
export FREECAD_BIN="/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd"
fcad check-runtime
```

Windows compatibility remains available, but only through explicit configuration. `FREECAD_DIR` is still accepted for backward compatibility:

```bash
export FREECAD_DIR="C:\\Program Files\\FreeCAD 1.1"
fcad check-runtime
```

This repository does not assume a default WSL -> Windows bridge anymore. If you do use WSL with a Windows FreeCAD install, set the Windows path explicitly as above.

## Output Contracts

- [product_review.schema.json](./schemas/product_review.schema.json)
- [process_plan.schema.json](./schemas/process_plan.schema.json)
- [line_plan.schema.json](./schemas/line_plan.schema.json)
- [quality_risk_pack.schema.json](./schemas/quality_risk_pack.schema.json)
- [investment_review.schema.json](./schemas/investment_review.schema.json)
- [readiness_report.schema.json](./schemas/readiness_report.schema.json)
- [stabilization_review.schema.json](./schemas/stabilization_review.schema.json)
- [standard_docs_manifest.schema.json](./schemas/standard_docs_manifest.schema.json)

## Testing

Hosted contract checks:

```bash
npm run test:node:runtime
```

These checks cover runtime discovery, command assembly, and path conversion logic. They do not install or execute FreeCAD.

Python and CLI checks:

```bash
npm run test:py
```

`npm run test:py` shells out to `python3 -m pytest -q`, so `python3` should resolve to Python 3.11 or newer. Hosted CI currently pins Python 3.11 to match the documented minimum.

Layered integration runner:

```bash
npm test
npm run test:full
```

`npm test` now runs the staged integration runner through the existing `tests/test-runner.js` compatibility shim. Internally the cases are split into runtime, model, drawing, analysis/report, and integration modules, while `npm run test:full` adds the advanced motion/design layer on top.

## Runtime Smoke Coverage

GitHub-hosted CI currently covers:

- Node runtime-contract tests on `ubuntu-24.04` and `macos-14`
- Python unit and CLI tests on `ubuntu-24.04`

GitHub-hosted CI does not currently install or launch FreeCAD.

For a real runtime-backed smoke pass on a FreeCAD-capable machine:

```bash
npm run smoke:runtime
```

The smoke script currently exercises:

- `fcad check-runtime`
- `fcad create`
- `fcad draw --bom`
- `fcad inspect`
- `fcad fem`
- `fcad report`

For CI, the repository also includes a self-hosted macOS workflow that uses the same smoke script and requires a runner labeled for FreeCAD with FreeCAD 1.1 installed.

## Release Prep

Draft release notes for the first public release surface live at [docs/releases/v1.1.0-draft.md](./docs/releases/v1.1.0-draft.md).

If you want to run the smoke steps manually instead of the script, use:

```bash
cd /path/to/freecad-automation
export FREECAD_APP="/Applications/FreeCAD.app"
fcad check-runtime
npm run test:node:runtime
node bin/fcad.js create configs/examples/ks_bracket.toml
node bin/fcad.js draw configs/examples/ks_bracket.toml --bom
node bin/fcad.js inspect output/ks_bracket.step
node bin/fcad.js fem configs/examples/bracket_fem.toml
node bin/fcad.js report configs/examples/ks_bracket.toml
```
