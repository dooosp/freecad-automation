# Production Readiness Refactor

## Positioning

This repository should still be presented publicly as a FreeCAD-backed automation pipeline. The manufacturing-engineering decision-support workflows are a second public layer built on top of the same CAD/DFM/reporting core, not a replacement for that positioning.

## Reuse Map

| Existing module | Reused as | Notes |
|---|---|---|
| `scripts/dfm_checker.py` | manufacturability/risk signal core | Preserved and surfaced through `review` and `readiness-report` |
| `scripts/cost_estimator.py` | cost/investment screening engine | Preserved and wrapped by `investment-review` |
| `scripts/intent_compiler.py` | product-type + drawing-plan inference | Reused for early process-plan heuristics |
| `fcad ingest/analyze-part/quality-link/review-pack` | detailed review-pack workflow | Preserved for evidence-driven geometry review |
| `create/draw/report/inspect/validate` | legacy/specialized CAD capability | Preserved for backward compatibility |

## Target Architecture

```text
bin/fcad.js
  -> existing CAD / review-pack commands
  -> production-readiness commands

src/agents/
  product-review-agent.js
  process-planning-agent.js
  line-layout-agent.js
  quality-traceability-agent.js
  cost-investment-agent.js

src/workflows/
  readiness-report-workflow.js

scripts/
  dfm_checker.py
  cost_estimator.py
  intent_compiler.py
```

## New Command Surface

- `fcad review <config>`
- `fcad process-plan <config>`
- `fcad line-plan <config>`
- `fcad quality-risk <config>`
- `fcad investment-review <config>`
- `fcad readiness-report <config>`

These commands are heuristic planning aids. They are intended for design review, process review, and portfolio storytelling, not full factory simulation.

## Output Contracts

- [product_review.schema.json](../schemas/product_review.schema.json)
- [process_plan.schema.json](../schemas/process_plan.schema.json)
- [line_plan.schema.json](../schemas/line_plan.schema.json)
- [quality_risk_pack.schema.json](../schemas/quality_risk_pack.schema.json)
- [investment_review.schema.json](../schemas/investment_review.schema.json)
- [readiness_report.schema.json](../schemas/readiness_report.schema.json)

## Constraints

- The workflow remains rule-based.
- Process, line, and investment outputs are preliminary decision-support artifacts.
- Existing CAD generation/drawing/report features remain intact rather than being rewritten.
