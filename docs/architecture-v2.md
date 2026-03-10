# Architecture V2

## Intent

Architecture V2 keeps the current execution model while changing the product boundary from generation pipelines to engineering-context analysis.

```text
Node CLI / desktop / MCP
          |
          v
  engineering context ingestion
          |
          v
 adapters -> geometry -> linkage -> decision -> reporting
          |
          v
     JSON and review artifacts
```

## Runtime

- Node remains the user-facing CLI and orchestration layer.
- Python remains the execution layer for data normalization, geometry analysis, and report generation.
- FreeCAD remains the CAD kernel for STEP/FCStd inspection and CAD-backed analysis.

## Layers

### adapters

Purpose:

- load BOM, inspection, and quality source files
- normalize column variance into a stable internal model
- capture provenance and ingest diagnostics

Key modules:

- `scripts/adapters/common.py`
- `scripts/adapters/load_bom.py`
- `scripts/adapters/load_inspection.py`
- `scripts/adapters/load_quality.py`

### geometry

Purpose:

- inspect existing CAD files
- derive shape metrics and heuristic feature signals
- emit geometry intelligence and hotspot artifacts

Key modules:

- `scripts/analyze_part.py`
- `scripts/geometry/shape_metrics.py`
- `scripts/geometry/feature_extract.py`
- `scripts/geometry/hotspot_detector.py`

### linkage

Purpose:

- connect inspection results to likely dimensions, feature classes, or regions
- connect quality issues to likely geometry-driven hotspots
- surface uncertainty explicitly

Key modules:

- `scripts/linkage/map_inspection.py`
- `scripts/linkage/inspection_metrics.py`
- `scripts/linkage/map_quality.py`
- `scripts/linkage/quality_patterns.py`

### decision

Purpose:

- score combined evidence conservatively
- rank review priorities
- suggest next actions with rationale

Key modules:

- `scripts/decision/risk_scorer.py`
- `scripts/decision/review_prioritizer.py`
- `scripts/decision/recommend_actions.py`

### reporting

Purpose:

- package JSON artifacts into review-ready deliverables
- generate PDF and Markdown review summaries
- preserve traceability back to evidence artifacts

Key modules:

- `scripts/reporting/review_pack.py`
- `scripts/reporting/review_templates.py`

## Compatibility

- `create`, `design`, `draw`, `report`, `dfm`, `fem`, and tolerance flows remain available.
- Legacy generation code is preserved, but new product work should not depend on generation-first assumptions.
- New workflows should emit JSON artifacts so desktop, MCP, or downstream services can consume them directly.
