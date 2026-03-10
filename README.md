# freecad-automation

Manufacturing-engineering-focused automation agent system for production-readiness review, manufacturability screening, process planning support, line-layout discussion, quality-risk framing, and cost/investment review.

The repository still preserves its original strengths:

- parametric 3D model generation
- engineering drawing generation
- DFM checks
- cost estimation
- PDF report generation
- config-driven workflow through Node.js CLI + Python scripts

The difference is the product framing. This repo is now positioned as a production engineering decision-support tool for automotive infotainment control units, display devices, brackets, housings, mount plates, and related subassemblies.

## Why This Matters For Production Engineering

This project is aimed at the gap between design data and production-engineering decisions.

- It helps with design-stage structure review before problems become line-stabilization issues.
- It translates geometry and manufacturing assumptions into process-plan and station-flow thinking.
- It surfaces quality gates, inspection-critical dimensions, and traceability capture points early.
- It gives a screening-level view of setup, tooling, automation candidates, and investment pressure.
- It supports discussion for domestic and overseas launch readiness without pretending to be a full factory simulation.

## Target Use Cases

- design-stage structure review for AVN, HUD, cluster, ICC, and controller/display subassemblies
- preliminary manufacturability and DFM review
- process planning support for launch and stabilization
- line-layout and station-concept discussion
- quality gate and traceability planning support
- cost/setup/investment-oriented review for production engineering decisions

## Production Engineering Use Cases

- Structure review: check housing wall thickness, connector-side clearance, fastening accessibility, mounting-boss layout, and display bracket manufacturability before tooling freeze.
- Process design support: infer a rough process sequence, key inspection points, and likely bottleneck candidates from part type and manufacturing assumptions.
- Line setup and stabilization support: review where in-line inspection, end-of-line confirmation, traceability capture, and repair containment may belong.
- Quality-risk visibility: highlight critical dimensions, quality gates, traceability label area concerns, and likely inspection-sensitive features.
- Productivity improvement support: use the review and line-plan outputs to discuss manual-labor sensitivity, automation candidates, and setup-complexity exposure.

Outputs are heuristic planning aids. They are not full production-line simulations.

## Command Surface

### Production-readiness commands

```bash
fcad review <config.toml|json>
fcad process-plan <config.toml|json>
fcad line-plan <config.toml|json>
fcad quality-risk <config.toml|json>
fcad investment-review <config.toml|json>
fcad readiness-report <config.toml|json>
```

`mfg-agent` is also installed as an alias for the same CLI.

### Review-pack commands

```bash
fcad ingest --model <file> [--bom bom.csv] [--inspection inspection.csv] [--quality quality.csv] --out <context.json>
fcad analyze-part <context.json|model.step>
fcad quality-link --context <context.json> --geometry <geometry.json>
fcad review-pack --context <context.json> --geometry <geometry.json>
fcad compare-rev <baseline.json> <candidate.json>
```

### Backward-compatible legacy commands

```bash
fcad create <config.toml|json>
fcad draw <config.toml|json>
fcad dfm <config.toml|json>
fcad report <config.toml|json>
fcad inspect <model.step|fcstd>
fcad validate <config.toml|json>
fcad fem <config.toml|json>
fcad tolerance <config.toml|json>
```

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
```

The readiness workflow produces a JSON report and a Markdown summary that bundle:

- product review
- process plan
- line-layout support pack
- quality / traceability pack
- cost / investment review
- decision summary for production engineering discussion

## Portfolio Case Study

For a checked-in example that can be reviewed without running the CLI, see:

- [infotainment-production-readiness-case.md](/Users/jangtaeho/Documents/New/freecad-automation/docs/portfolio/infotainment-production-readiness-case.md)
- [docs/examples/infotainment-display-bracket](/Users/jangtaeho/Documents/New/freecad-automation/docs/examples/infotainment-display-bracket)

This case shows `config -> review -> process-plan -> line-plan -> quality-risk -> investment-review -> readiness-report` for an infotainment display bracket scenario.

## Automotive Infotainment Example Configs

- `configs/examples/infotainment_display_bracket.toml`
- `configs/examples/controller_housing.toml`
- `configs/examples/pcb_mount_plate.toml`
- `configs/examples/display_module_support.toml`

These examples include manufacturing metadata such as:

- material and process assumptions
- cross-site launch scope
- annual volume and target cycle time placeholders
- connector clearance assumptions
- critical dimensions and quality gates
- automation-candidate notes

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
- `scripts/dfm_checker.py`: DFM manufacturability logic
- `scripts/cost_estimator.py`: cost breakdown and comparison logic
- `scripts/intent_compiler.py`: part-type inference and drawing-plan strategy
- `schemas/`: output contracts for review, process-plan, line-plan, quality-risk, investment-review, readiness-report

See [production-readiness-refactor.md](/Users/jangtaeho/Documents/New/freecad-automation/docs/production-readiness-refactor.md) for the codebase refactoring map.

## Installation

### Prerequisites

- Node.js 18+
- Python 3.10+
- FreeCAD 0.21+ only when using CAD-backed generation/inspection workflows

### Setup

```bash
git clone https://github.com/dooosp/freecad-automation.git
cd freecad-automation
npm install
npm link
```

### FreeCAD runtime

macOS:

```bash
export FREECAD_PYTHON="/Applications/FreeCAD.app/Contents/Resources/bin/FreeCADCmd"
npm run check:runtime
```

WSL -> Windows:

```bash
export FREECAD_DIR="C:\\Program Files\\FreeCAD 1.0"
npm run check:runtime
```

## Output Contracts

- [product_review.schema.json](/Users/jangtaeho/Documents/New/freecad-automation/schemas/product_review.schema.json)
- [process_plan.schema.json](/Users/jangtaeho/Documents/New/freecad-automation/schemas/process_plan.schema.json)
- [line_plan.schema.json](/Users/jangtaeho/Documents/New/freecad-automation/schemas/line_plan.schema.json)
- [quality_risk_pack.schema.json](/Users/jangtaeho/Documents/New/freecad-automation/schemas/quality_risk_pack.schema.json)
- [investment_review.schema.json](/Users/jangtaeho/Documents/New/freecad-automation/schemas/investment_review.schema.json)
- [readiness_report.schema.json](/Users/jangtaeho/Documents/New/freecad-automation/schemas/readiness_report.schema.json)

## Testing

Lightweight workflow checks:

```bash
python3 -m pytest tests/test_cli_workflow.py tests/test_manufacturing_agent_cli.py
```

Legacy coverage:

```bash
npm test
```
