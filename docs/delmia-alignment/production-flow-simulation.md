# Production Flow Simulation Demo

This demo adds a deterministic, auditable production-flow report that reads the bracket manufacturing context and writes summary artifacts under `output/delmia-demo/`.

## Files

- Script: [simulate_production_flow.py](../../scripts/simulate_production_flow.py)
- Input: [bracket_line_context.json](../../configs/examples/manufacturing/bracket_line_context.json)
- Output JSON: `output/delmia-demo/flow_simulation_report.json`
- Output Markdown: `output/delmia-demo/flow_simulation_summary.md`

## What The Demo Calculates

- throughput
- bottleneck work center
- WIP estimate
- utilization by work center
- cycle-time summary
- recommended improvement actions

## Heuristic Rules

- Practical cycle time is built from machine time, labor time, order-level setup share, and a small quality penalty.
- Expected OEE reduces practical capacity in a transparent way.
- Bottleneck is the work center with the largest practical cycle load.
- WIP is estimated from queue buffers and utilization ratios rather than from live event data.

## Why It Is Useful

- It gives solution consultants and manufacturing stakeholders a concrete DELMIA-style discussion artifact without implying a real simulation engine.
- It demonstrates how this repo can move from part review into line-review storytelling.
- It provides an explainable bridge between geometry/process context and production-flow discussion.

## Run It

```bash
python3 scripts/simulate_production_flow.py \
  --context configs/examples/manufacturing/bracket_line_context.json \
  --out-dir output/delmia-demo
```

## Safety Note

Present this as a DELMIA-style learning demo for digital manufacturing and production flow optimization. Do not present it as a validated factory model or an official DELMIA capability.
