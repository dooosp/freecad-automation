# FreeCAD Automation

FreeCAD Automation is a FreeCAD-backed automation pipeline for CAD generation, TechDraw drawings, inspection, FEM, reporting, and manufacturing-review artifacts.

The repository has two public layers:

- a runtime-backed CLI for CAD, TechDraw, FEM, tolerance, inspection, and reporting
- a plain-Python/Node manufacturing-review layer for DFM, process planning, readiness review, stabilization review, and review-pack artifacts

Validation snapshot:

- verified locally by maintainers on macOS with FreeCAD 1.1.x for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, and `report`
- verified in hosted CI through explicit fast lanes: `test:node:contract`, `test:node:integration`, `test:snapshots`, and `test:py`; hosted CI does not install or launch FreeCAD
- verified in repository-owned runtime CI through the `FreeCAD Runtime Smoke (self-hosted macOS)` workflow for real `check-runtime`, `create`, `draw --bom`, `inspect`, and `report`
- experimental or not yet automated for live FreeCAD execution on Windows native, WSL -> Windows FreeCAD, and Linux; those paths remain compatibility paths, not equal-maturity claims

Run `fcad check-runtime` first on any new machine and before troubleshooting a FreeCAD-backed failure.

Execution model: `bin/fcad.js -> lib/runner.js -> scripts/*.py -> scripts/_bootstrap.py -> import FreeCAD` for the runtime-backed commands. The manufacturing-review layer uses the same configs and artifacts but often runs under plain `python3` without launching FreeCAD.

Config lifecycle:

- user-facing configs are now treated as `config_version = 1`
- unversioned configs still load, but `fcad` emits deprecation warnings when legacy fields are detected
- `fcad validate-config <path>` validates user-facing config shape and migration state
- `fcad migrate-config <path> [--out <file>]` writes a versioned config plus a change summary
- supported config fields, compatibility aliases, and real example references are documented in [docs/config-schema.md](./docs/config-schema.md)

## Start Here

For a first local verification:

```bash
npm install
npm link
fcad check-runtime
npm run test:node:contract
npm run test:node:integration
npm run test:snapshots
npm run test:runtime-smoke
```

If you are reviewing the repository on GitHub:

1. Read the [infotainment production readiness case study](./docs/portfolio/infotainment-production-readiness-case.md).
2. Open the [checked-in example artifact set](./docs/examples/infotainment-display-bracket/README.md).
3. Review the [parameter sweep gallery](./docs/examples/parameter-sweep-gallery.md).
4. Compare the [Korea vs Mexico stabilization example](./docs/examples/infotainment-display-bracket/stabilization-comparison.md).
5. Read the [before-vs-after improvement case](./docs/portfolio/before-after-improvement-case.md).
6. Skim the [readiness report markdown](./docs/examples/infotainment-display-bracket/readiness-report.md).
7. Inspect the [example config](./configs/examples/infotainment_display_bracket.toml) and the command classification below.

## Test Lanes

- `npm run test:node:contract`: fast hosted-safe Node contracts for config/runtime path/invocation boundaries
- `npm run test:node:integration`: fast hosted-safe Node integration checks for API, sweep, draw/report service wiring, and rule profiles
- `npm run test:snapshots`: normalized SVG/report snapshot regressions
- `npm run test:py`: Python 3.11+ lane for non-runtime Python and CLI-adjacent regressions
- `npm run test:runtime-smoke`: real FreeCAD-backed smoke for `check-runtime`, `create`, `draw --bom`, `inspect`, and `report`

Deeper runtime-backed suites are available as `npm run test:runtime:model`, `test:runtime:drawing`, `test:runtime:analysis`, `test:runtime:report`, `test:runtime:integration`, and `test:runtime:full`.

Full details, workflow mapping, and local commands live in [docs/testing.md](./docs/testing.md).

## Supported And Verified Platform Scope

- verified maintainer path: macOS + `FreeCAD.app` 1.1.x for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, and `report`
- verified repository-owned runtime CI path: self-hosted macOS smoke for `check-runtime`, `create`, `draw --bom`, `inspect`, and `report`
- verified hosted CI path: Node contract, Node integration, snapshots, and Python lanes without installing or launching FreeCAD
- compatibility paths only today: Windows native, WSL -> Windows FreeCAD, and Linux runtime execution

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

Run `fcad check-runtime` before any FreeCAD-backed command on a new machine and as the first troubleshooting step for runtime-backed failures. It prints searched candidate paths, the selected runtime, active env overrides, detected FreeCAD/Python details, command classes, and remediation guidance.

### Command Classification

| Class | Commands | Runtime boundary |
| --- | --- | --- |
| Diagnostics | `check-runtime` | does not require FreeCAD to be present |
| FreeCAD-backed | `create`, `draw`, `inspect`, `fem`, `tolerance`, `report` | requires a working FreeCAD runtime |
| Plain-Python / non-FreeCAD | `dfm`, `review`, `process-plan`, `line-plan`, `quality-risk`, `investment-review`, `readiness-report`, `stabilization-review`, `generate-standard-docs`, `ingest`, `quality-link`, `review-pack`, `compare-rev`, `validate`, `validate-config`, `migrate-config`, `serve` | runs without launching FreeCAD |
| Mixed / conditional | `analyze-part`, `design`, `sweep` | `analyze-part` can inspect CAD through FreeCAD when needed; `design` ends by calling `create`; `sweep` stays inside the existing `create` / `cost` / `fem` / `report` service wrappers selected by the matrix file |

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
fcad sweep <config.toml|json> --matrix <matrix.toml|json> [--out-dir <dir>]
```

`report` is still classified as runtime-backed because it runs inside the FreeCAD bundle on macOS even when it falls back from `freecadcmd` to the bundled FreeCAD Python executable.

### Parameter Sweep

`fcad sweep` is the initial design-space exploration workflow. It does not create a separate optimization path. Instead, it expands deterministic numeric overrides and executes each variant through the existing service wrappers already used by the CLI.

Current sweep scope:

- numeric leaf overrides only, addressed by paths like `shapes[0].height` or `fem.constraints[1].magnitude`
- discrete `values = [...]` lists or inclusive `range = { start, stop, step }`
- sequential execution with per-variant `effective-config.*` and `result.json`
- aggregate `summary.json` and `summary.csv`
- objective summary for min mass, min cost, and FEM stress-threshold pass/fail when those metrics exist

Worked examples:

- [docs/examples/parameter-sweep-gallery.md](./docs/examples/parameter-sweep-gallery.md)
- [configs/examples/sweeps/ks_bracket_geometry_sweep.toml](./configs/examples/sweeps/ks_bracket_geometry_sweep.toml)
- [configs/examples/sweeps/bracket_fem_load_sweep.toml](./configs/examples/sweeps/bracket_fem_load_sweep.toml)

Example:

```bash
fcad sweep configs/examples/ks_bracket.toml \
  --matrix configs/examples/sweeps/ks_bracket_geometry_sweep.toml \
  --out-dir output/sweeps/ks_bracket_geometry
```

The summary files capture exact per-variant runtime. Treat any time estimates in docs as planning guidance, not repository-verified benchmark claims.

### Config Validation And Migration

```bash
fcad validate-config configs/examples/ks_bracket.toml
fcad validate-config configs/examples/ks_bracket.toml --strict
fcad validate-config configs/examples/ks_bracket.toml --json
fcad migrate-config configs/examples/ks_bracket.toml
fcad migrate-config configs/examples/ks_bracket.toml --out output/ks_bracket.v1.toml
```

`validate-config` checks the user-facing config, reports deprecated fields, and exits non-zero on schema errors. `--strict` also fails when warnings remain.

`migrate-config` writes a versioned config file and prints:

- changed fields applied automatically
- deprecated fields still present for compatibility
- manual follow-up when the migration intentionally keeps a legacy field to avoid breaking older flows

Legacy compatibility warnings currently cover:

- missing `config_version`
- top-level `material` and `process`
- `[[operations]].type` instead of `op`
- legacy `[export] step = true` / `stl = true` flags instead of `formats = [...]`

Upgrade notes:

- canonical v1 keeps `manufacturing.process` and `manufacturing.material` as the preferred home for manufacturing metadata
- legacy top-level `process` and `material` still load today, but migration intentionally keeps them only as compatibility fields
- existing sample configs remain valid inputs because `fcad` auto-migrates them before command execution
- use `fcad migrate-config` if you want to check in an explicit v1 config file after reviewing the reported manual follow-up items

The older `fcad validate <plan-file>` command is unchanged and still validates `drawing_plan` artifacts rather than user configs.

### Local API

`fcad serve` now starts a local/dev-first HTTP API backed by the real Node CLI service layer and the existing Python/FreeCAD runtime path.

```bash
fcad serve
fcad serve 3100
fcad serve 3100 --jobs-dir output/jobs-dev
```

Startup behavior:

- binds to `127.0.0.1` only
- defaults to port `3000`
- stores jobs under `output/jobs` unless `--jobs-dir` is provided
- keeps the existing CLI/runtime execution path: `POST /jobs` schedules work through the same service layer used by `fcad create`, `fcad draw`, `fcad inspect`, and `fcad report`

Endpoints:

- `GET /health`
- `POST /jobs`
- `GET /jobs/:id`
- `GET /jobs/:id/artifacts`

Supported job types:

- `create`
- `draw`
- `inspect`
- `report`

Endpoint usage:

- `GET /health` returns API liveness plus detected FreeCAD runtime details
- `POST /jobs` accepts a JSON job request and returns `202 Accepted` with the queued job record
- `GET /jobs/:id` returns the latest status, request, diagnostics, result, status history, and storage metadata
- `GET /jobs/:id/artifacts` returns the flattened known artifact list plus persisted storage file metadata

Request examples:

```bash
curl http://127.0.0.1:3000/health

curl -X POST http://127.0.0.1:3000/jobs \
  -H 'content-type: application/json' \
  -d '{
    "type": "create",
    "config_path": "configs/examples/ks_bracket.toml"
  }'

curl -X POST http://127.0.0.1:3000/jobs \
  -H 'content-type: application/json' \
  -d '{
    "type": "draw",
    "config": {
      "config_version": 1,
      "name": "api_bracket",
      "shapes": [
        { "id": "body", "type": "box", "length": 40, "width": 20, "height": 8 }
      ],
      "drawing": { "views": ["front", "top", "right", "iso"] },
      "export": { "formats": ["step"], "directory": "output" }
    }
  }'

curl http://127.0.0.1:3000/jobs/<job-id>

curl http://127.0.0.1:3000/jobs/<job-id>/artifacts
```

The job store is filesystem-backed under `output/jobs` by default. Each job directory persists:

- request payload
- status transitions
- log output
- effective config when applicable
- artifact paths surfaced through `GET /jobs/:id/artifacts`

Response notes:

- all endpoints return JSON
- success responses always include `ok: true`
- error responses always include `ok: false` and `error.code` plus `error.messages`
- job responses include a `storage` block with absolute paths and file existence/size for `job.json`, `request.json`, and `job.log`

Current limitations:

- this API is local/dev-first and does not add authentication
- jobs run in-process; there is no distributed queue, retry worker, or database
- `job.log` is best-effort and primarily captures orchestration events and stderr surfaced from underlying scripts
- `GET /jobs/:id/artifacts` reports known output paths; it does not stream artifact contents
- `POST /jobs` currently exposes only the execution paths for `create`, `draw`, `inspect`, and `report`

Legacy note:

- `fcad serve --legacy-viewer` still starts the older browser demo shell from `server.js`
- `npm run serve:legacy` continues to point at that older shell

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
config_version = 1
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
config_version = 1
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

Real example configs:

- [controller_housing.toml](./configs/examples/controller_housing.toml): production-readiness single-part model with manufacturing, quality, drawing, and export sections
- [bracket_fem.toml](./configs/examples/bracket_fem.toml): compact FEM-oriented single-part config
- [ptu_assembly_mates.toml](./configs/examples/ptu_assembly_mates.toml): assembly config for mates/tolerance-style workflows

## Snapshot Regression

Normalized snapshot baselines now live under:

- `tests/fixtures/snapshots/svg/` for TechDraw SVG outputs
- `tests/fixtures/snapshots/report/` for lightweight readiness-report preview snapshots

Use the standard test:

```bash
npm run test:snapshots
```

Update baselines intentionally:

```bash
UPDATE_SNAPSHOTS=1 npm run test:snapshots
# or
npm run test:snapshots:update
```

Snapshot updates are expected when you intentionally change drawing geometry, annotations, report wording, section order, or the representative fixtures themselves.

Snapshot updates are not expected for timestamp churn, runtime-specific absolute paths, UUID-like run IDs, or generated metadata that should normalize away. If a test fails only because of that kind of volatility, fix the normalizer instead of refreshing the baseline.

Review workflow:

1. Run `npm run test:snapshots`.
2. Inspect diffs under `tests/fixtures/snapshots/svg/` and `tests/fixtures/snapshots/report/`.
3. Compare the changed baseline against the source fixture under `tests/fixtures/svg/` or `tests/fixtures/report/`.
4. Regenerate with `npm run test:snapshots:update` only after confirming the change is intentional.

The snapshot normalizers strip volatile timestamps, random SVG IDs, absolute paths, UUID-like run IDs, and similar generated metadata while preserving meaningful geometry and structural content changes.

Follow-on design notes for standards/material rule packs and parameter sweep live in [docs/standards-and-sweep-roadmap.md](./docs/standards-and-sweep-roadmap.md).

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

Fast hosted-safe Node lanes:

```bash
npm test
# or run the lanes separately
npm run test:node:contract
npm run test:node:integration
npm run test:snapshots
```

`npm test` runs the three hosted-safe Node lanes defined in `package.json`: runtime/config contracts, non-runtime integration coverage, and normalized SVG/report snapshots. These lanes do not install or launch FreeCAD.

Python lane:

```bash
npm run test:py
```

`npm run test:py` requires Python 3.11 or newer and matches the hosted `Automation CI (hosted fast lanes)` workflow's Python step.

Real runtime smoke:

```bash
fcad check-runtime
npm run test:runtime-smoke
# alias: npm run smoke:runtime
```

`npm run test:runtime-smoke` is the real FreeCAD-backed smoke lane for `check-runtime`, `create`, `draw --bom`, `inspect`, and `report`. The repository-owned CI version runs through the `FreeCAD Runtime Smoke (self-hosted macOS)` workflow. Full lane mapping and deeper runtime suites live in [docs/testing.md](./docs/testing.md).

## Release Prep

Draft release notes for the first public release surface live at [docs/releases/v1.1.0-draft.md](./docs/releases/v1.1.0-draft.md).

If you want to run the smoke steps manually instead of the script, use:

```bash
cd /path/to/freecad-automation
export FREECAD_APP="/Applications/FreeCAD.app"
fcad check-runtime
npm run test:node:contract
node bin/fcad.js create configs/examples/ks_bracket.toml
node bin/fcad.js draw configs/examples/ks_bracket.toml --bom
node bin/fcad.js inspect output/ks_bracket.step
node bin/fcad.js fem configs/examples/bracket_fem.toml
node bin/fcad.js report configs/examples/ks_bracket.toml
```
