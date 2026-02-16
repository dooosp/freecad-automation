# freecad-automation

**Design-to-manufacturing automation pipeline for FreeCAD.**

One TOML config in, 3D model + engineering drawing + DFM analysis + cost estimate + PDF report out.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![FreeCAD](https://img.shields.io/badge/FreeCAD-0.21%2B-1565C0)
![License](https://img.shields.io/badge/License-MIT-green)

---

## What It Does

```
TOML Config ──> 3D Model ──> Drawing ──> DFM Check ──> Cost ──> PDF Report
   .toml         .step       4-view      6 checks     BOM      multi-page
                  .fcstd      SVG+GD&T    per-process  breakdown technical
```

| Capability | Description |
|---|---|
| Parametric Modeling | 7 shape primitives + boolean ops + fillet/chamfer + circular pattern |
| Engineering Drawing | 4-view projection, ISO 128 line types, GD&T automation, QA scoring |
| AI Design | Natural language description via Gemini to TOML to 3D model |
| DFM Analysis | 6 manufacturability checks across 4 process types |
| Tolerance Analysis | Fit recommendation + stack-up + Monte Carlo simulation |
| Cost Estimation | Material + machining + setup + inspection + batch discounts |
| FEM Analysis | Structural analysis with load/constraint definition |
| PDF Reports | Multi-page technical reports with drawings and analysis |
| 3D Web Viewer | Three.js viewer with WebSocket live reload |

---

## Quick Start

### Prerequisites

- **Node.js** 18+
- **FreeCAD** 0.21+ installed on Windows
- **WSL** (the CLI runs in WSL and bridges to Windows FreeCAD)

### Install

```bash
git clone https://github.com/dooosp/freecad-automation.git
cd freecad-automation
npm install
npm link  # makes 'fcad' available globally
```

### 3-Step Demo

```bash
# 1. Create a 3D model from a parametric config
fcad create configs/examples/ks_bracket.toml
# -> output/ks_bracket.step, output/ks_bracket.fcstd

# 2. Generate a 4-view engineering drawing with GD&T
fcad draw configs/examples/ks_bracket.toml
# -> output/ks_bracket_drawing.svg

# 3. Run DFM analysis against machining constraints
fcad dfm configs/examples/ks_bracket.toml
# -> DFM report with pass/fail per check
```

---

## CLI Reference

```
fcad <command> [options]
```

| Command | Description | Example |
|---|---|---|
| `create <config>` | Create 3D model (STEP + FCStd) | `fcad create configs/examples/ks_bracket.toml` |
| `design "text"` | AI-generate TOML from description, then build | `fcad design "M8 mounting bracket 120x80mm"` |
| `draw <config>` | Generate 4-view SVG drawing + BOM | `fcad draw configs/examples/ks_flange.toml` |
| `fem <config>` | Run FEM structural analysis | `fcad fem configs/examples/bracket_fem.toml` |
| `tolerance <config>` | Tolerance analysis (fit + stack-up) | `fcad tolerance configs/examples/ks_shaft.toml` |
| `report <config>` | Generate multi-page PDF report | `fcad report configs/examples/ks_bracket.toml` |
| `inspect <model>` | Inspect STEP/FCStd metadata | `fcad inspect output/ks_bracket.step` |
| `validate <config>` | Validate drawing plan schema | `fcad validate configs/examples/ks_bracket.toml` |
| `dfm <config>` | DFM manufacturability analysis | `fcad dfm configs/examples/ks_bracket.toml` |
| `serve [port]` | Start 3D viewer (default: 3000) | `fcad serve 8080` |

### Key Options

| Option | Used With | Description |
|---|---|---|
| `--override <path>` | `draw` | Merge override TOML/JSON on top of base config |
| `--bom` | `draw` | Export BOM as separate CSV file |
| `--no-score` | `draw` | Skip QA scoring |
| `--fail-under N` | `draw` | Fail if QA score < N |
| `--weights-preset P` | `draw` | QA weight profile: default, auto, flange, shaft |
| `--strict` | `validate`, `dfm` | Treat warnings as errors |
| `--process P` | `dfm` | Override process: machining, casting, sheet_metal, 3d_printing |
| `--recommend` | `tolerance` | Auto-recommend fit specifications |
| `--monte-carlo` | `tolerance`, `report` | Include Monte Carlo simulation |
| `--fem` | `report` | Include FEM analysis in report |

---

## Configuration

Parts are defined in TOML. A minimal example:

```toml
name = "ks_bracket"

[[shapes]]
id = "base_plate"
type = "box"
length = 120
width = 80
height = 8

[[shapes]]
id = "web"
type = "box"
length = 8
width = 80
height = 60
position = [0, 0, 8]

[[operations]]
type = "fuse"
base = "base_plate"
tool = "web"

[[operations]]
type = "fillet"
target = "fuse_1"
radius = 3

[drawing]
title = "KS Bracket"
scale = "1:2"

[manufacturing]
process = "machining"
material = "SS304"
```

19 example configs are included in `configs/examples/`, covering brackets, shafts, flanges, gear housings, assemblies, and mechanisms.

---

## Architecture

```
bin/fcad.js ─── CLI entry point (Node.js)
    │
    │  JSON via stdin/stdout
    ▼
scripts/*.py ── FreeCAD Python engine (46 modules, ~17,000 lines)
    │
    │  FreeCAD Python API
    ▼
FreeCAD 0.21+ ─ CAD kernel (WSL → Windows bridge)
```

### Module Overview

| Category | Modules | Purpose |
|---|---|---|
| Core | `create_model`, `_shapes`, `_bootstrap`, `_export` | Shape creation, boolean ops, model export |
| Drawing | `generate_drawing`, `_drawing_svg`, `_view_planner`, `_dim_plan`, `_annotation_planner`, `_gdt_automation`, `_gdt_symbols`, `_ks_callouts`, `postprocess_svg`, `qa_scorer` | 4-view projection, dimensioning, GD&T, QA |
| Analysis | `dfm_checker`, `fem_analysis`, `tolerance_analysis`, `_tolerance`, `_tolerance_db`, `cost_estimator` | DFM, FEM, tolerance stack-up, cost |
| AI | `intent_compiler`, `_feature_inference` | NL-to-TOML via Gemini, feature detection |
| Report | `engineering_report`, `_report_renderer`, `_report_styles` | Multi-page PDF generation |
| Utility | `svg_common`, `svg_repair`, `_svg_utils`, `inspect_model`, `plan_validator`, `step_feature_detector` | SVG processing, validation, inspection |

### JS Layer

| File | Purpose |
|---|---|
| `bin/fcad.js` | CLI dispatcher and command handlers |
| `lib/runner.js` | FreeCAD script executor (WSL to Windows bridge) |
| `lib/config-loader.js` | TOML/JSON config loading and merging |
| `lib/toml-writer.js` | Programmatic TOML modification |
| `server.js` | Express + WebSocket 3D viewer server |

---

## Project Structure

```
freecad-automation/
  bin/fcad.js            # CLI entry point
  lib/                   # Node.js utilities (config, runner, paths)
  scripts/               # 46 Python modules (FreeCAD engine)
  configs/examples/      # 19 example TOML configs
  public/                # 3D web viewer (HTML/CSS/JS)
  server.js              # Express + WebSocket server
  tests/                 # Test suite (core + full profiles)
  output/                # Generated models, drawings, reports
```

---

## Testing

```bash
# Core tests (fast, no FreeCAD required for schema/config tests)
npm test

# Full test suite (requires FreeCAD)
npm run test:full
```

CI runs via GitHub Actions (`automation-ci.yml`).

---

## Related: FreeCAD Studio

[freecad-desktop](https://github.com/dooosp/freecad-desktop) wraps this engine in a desktop GUI built with Tauri + React, providing a visual interface for config editing, live 3D preview, and one-click report generation.

---

## License

[MIT](LICENSE)
