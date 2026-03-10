# freecad-automation

**Engineering decision-support tooling for existing CAD/STEP files, inspection data, BOMs, and quality records.**

This repository now centers on a review workflow:

```text
CAD/STEP/FCStd + BOM + Inspection + Quality
                |
                v
         normalized engineering context
                |
                v
      FreeCAD-backed geometry intelligence
                |
                v
   inspection / quality linkage + review priorities
                |
                v
   JSON artifacts + PDF/Markdown review pack
```

The legacy TOML-driven generation flow is still available, but it is no longer the primary product story. The maintained direction is to help engineering teams read real part data, connect it to inspection and quality evidence, and produce review-ready artifacts.

For background on the earlier design-family portfolio framing, see [docs/portfolio/sensor_mount_bracket_portfolio.md](docs/portfolio/sensor_mount_bracket_portfolio.md).

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![FreeCAD](https://img.shields.io/badge/FreeCAD-0.21%2B-1565C0)
![License](https://img.shields.io/badge/License-MIT-green)

## Primary Workflows

| Workflow | Purpose | Main Output |
|---|---|---|
| `fcad ingest` | Normalize CAD + BOM + inspection + quality inputs into one engineering context | `*_context.json`, `*_ingest_log.json` |
| `fcad analyze-part` | Turn an existing part into geometry intelligence and review hotspots | `*_geometry_intelligence.json`, `*_manufacturing_hotspots.json` |
| `fcad quality-link` | Connect inspection/quality evidence to geometry-derived risk areas | linkage, outlier, hotspot, and priority JSON artifacts |
| `fcad review-pack` | Assemble a review-ready summary for engineering discussion | PDF, Markdown, and JSON review pack |
| `fcad compare-rev` | Compare two revision artifacts or engineering contexts | revision comparison JSON |

## Example Flow

```bash
# 1. Normalize source data into one context
fcad ingest \
  --model fixtures/part.step \
  --bom fixtures/bom.csv \
  --inspection fixtures/inspection.csv \
  --quality fixtures/ncr.csv \
  --out output/part_context.json

# 2. Generate geometry intelligence
fcad analyze-part output/part_context.json

# 3. Link inspection and quality evidence to geometry risk
fcad quality-link --context output/part_context.json \
  --geometry output/part_geometry_intelligence.json

# 4. Build an engineering review pack
fcad review-pack \
  --context output/part_context.json \
  --geometry output/part_geometry_intelligence.json \
  --review output/part_review_priorities.json
```

## Legacy Workflows

The following commands remain supported for existing users and generated-design workflows:

- `fcad create`
- `fcad design`
- `fcad draw`
- `fcad fem`
- `fcad tolerance`
- `fcad report`
- `fcad inspect`
- `fcad dfm`

These commands are now treated as legacy or specialized capabilities. They remain useful, but they are not the primary entry point for new users.

## Installation

### Prerequisites

- Node.js 18+
- Python 3.10+ recommended
- FreeCAD 0.21+ for model inspection and CAD-backed analysis

### Setup

```bash
git clone https://github.com/dooosp/freecad-automation.git
cd freecad-automation
npm install
npm link
```

### FreeCAD Runtime Setup

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

## CLI Reference

```text
fcad <command> [options]
```

### Primary commands

| Command | Description |
|---|---|
| `ingest` | Build normalized engineering context from model, BOM, inspection, and quality data |
| `analyze-part` | Analyze an existing CAD file or engineering context for geometry intelligence |
| `quality-link` | Link inspection and quality evidence to geometry-derived hotspots and priorities |
| `review-pack` | Generate engineering review pack artifacts |
| `compare-rev` | Compare two revision artifacts or contexts |

### Legacy / specialized commands

| Command | Description |
|---|---|
| `create <config>` | Legacy parametric model creation from TOML/JSON |
| `design "text"` | Experimental natural-language-to-TOML generation |
| `draw <config>` | Drawing generation from config |
| `fem <config>` | Structural analysis from config |
| `tolerance <config>` | Tolerance analysis |
| `report <config>` | Legacy multi-page report generation |
| `inspect <model>` | Inspect STEP/FCStd metadata |
| `validate <config>` | Validate drawing plan schema |
| `dfm <config>` | DFM manufacturability analysis |
| `serve [port]` | Legacy viewer/dev server |

## Engineering Context Model

New workflows use a shared engineering context so downstream stages can consume the same normalized inputs.

```json
{
  "part": {},
  "geometry_source": {},
  "bom": [],
  "inspection_results": [],
  "quality_issues": [],
  "manufacturing_context": {},
  "metadata": {}
}
```

Schemas live under [`schemas/`](schemas/).

## Architecture

The runtime architecture remains `Node CLI + Python runner + FreeCAD`. The main change is the product boundary and module layering.

```text
CLI / desktop / MCP adapters
            |
            v
     engineering context layer
            |
            v
  adapters -> geometry -> linkage -> decision -> reporting
            |
            v
         JSON artifacts
```

### Layer responsibilities

| Layer | Responsibility |
|---|---|
| `adapters` | CSV/JSON normalization for BOM, inspection, quality, and source metadata |
| `geometry` | FreeCAD-backed or metadata-backed geometry intelligence and hotspot detection |
| `linkage` | Match inspection and quality evidence to features, regions, or review signals |
| `decision` | Score risk, prioritize review focus areas, recommend next actions |
| `reporting` | Generate review packs and other review-facing artifacts |

Detailed direction is in [docs/vision.md](docs/vision.md), [docs/architecture-v2.md](docs/architecture-v2.md), and [docs/migration-plan.md](docs/migration-plan.md).

## Project Structure

```text
freecad-automation/
  bin/fcad.js
  lib/
  schemas/
  scripts/adapters/
  scripts/geometry/
  scripts/linkage/
  scripts/decision/
  scripts/reporting/
  src/
  tests/
```

## Testing

Runtime-independent tests for the new workflow can be run with:

```bash
python3 -m pytest tests/test_ingest.py tests/test_analyze_part.py tests/test_linkage.py tests/test_review_pack.py
```

Legacy integration coverage remains available via:

```bash
npm test
```
