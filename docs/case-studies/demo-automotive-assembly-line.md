# Demo Case Study: Automotive Assembly Line

## Industry

Automotive brackets and display-mount subassemblies for an EV interior program.

## Business Problem

The line has repeated launch pressure, inconsistent drill-cell performance, and late visibility into dimensional issues that become expensive rework during final inspection.

## Data Sources

- Bracket CAD/config example
- Manufacturing context JSON
- Inspection records JSON
- Routing and work-center assumptions
- Supplier watchlist for tooling and packaging inputs

## Virtual Twin / Simulation Angle

The DELMIA-adjacent story is a virtual-twin-style review of the line before operators change staffing, fixtures, or inspection strategy. The prototype does not simulate the plant in real time, but it does show how line assumptions can be made reviewable in one digital context.

## AI Opportunity

- Prioritize which work center needs attention first
- Link inspection findings back to routing steps faster
- Summarize process-change discussion points for manufacturing engineering reviews

## Expected KPI Impact

- Throughput stability
- Lower WIP ahead of the drilling cell
- Faster root-cause triage for hole-diameter issues
- Lower rework carried into final inspection

## How This Repo Can Demonstrate A Simplified Version

- Manufacturing context: `configs/examples/manufacturing/bracket_line_context.json`
- Flow demo: `scripts/simulate_production_flow.py`
- Inspection linkage demo: `scripts/link_inspection_to_manufacturing.py`
- Supporting docs: `docs/delmia-alignment/`

## Safe Positioning

This is a demo scenario for portfolio discussion only. It is not a real customer claim and not an official DELMIA deployment.
