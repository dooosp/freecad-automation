# Manufacturing Context Demo

This surface introduces a practical manufacturing context JSON contract for DELMIA-adjacent learning demos. It is intentionally simpler than an enterprise manufacturing data model and is **not** an official DELMIA integration.

## Files

- Schema: [manufacturing-context.schema.json](../../schemas/manufacturing-context.schema.json)
- Example context: [bracket_line_context.json](../../configs/examples/manufacturing/bracket_line_context.json)
- Example inspection set: [bracket_inspection_records.json](../../configs/examples/manufacturing/bracket_inspection_records.json)

## Why This Exists

- To give the repo one beginner-friendly context file that blends plant, line, work-center, routing, BOM, inspection, quality, planning, MES, APS, and SCM language.
- To anchor portfolio demos in auditable sample data instead of hand-wavy slides.
- To make it easier to explain how existing review and readiness artifacts could sit inside a broader digital manufacturing story.

## Key Model Sections

- `plant`: where the work happens and how the site is described.
- `product`: which CAD and BOM references the line is built around.
- `production_line`: takt, shifts, line scope, and active order framing.
- `work_centers`: station-level process assumptions such as OEE, queue buffer, labor, and MES tags.
- `routing`: the deterministic sequence used by the flow and quality demos.
- `bom_references`: lightweight SCM-facing material context.
- `inspection_records` and `quality_issues`: the traceability anchor for review guidance.
- `planning_data`: APS-style assumptions such as frozen horizon, overtime limits, and constrained supply.

## Suggested Portfolio Talking Points

- MES framing: routing history, quality-gate capture, and work-center tags.
- APS framing: rate assumptions, bottleneck identification, and constrained material notes.
- SCM framing: supplier watchlists, packaging inputs, and lead-time visibility.
- Virtual twin framing: one JSON context connecting part, process, line, and quality evidence for scenario review.

## What This File Does Not Do

- It does not replace ERP, MES, APS, or SCM master data.
- It does not define a real plant simulation engine.
- It does not provide a governed enterprise digital thread.
- It does not claim DELMIA or 3DEXPERIENCE compatibility beyond conceptual adjacency.
