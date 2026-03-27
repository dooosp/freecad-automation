# Infotainment Production Readiness Case

## Problem Statement

An automotive infotainment display bracket may look simple in CAD, but production engineering risk appears early when the design is translated into:

- manufacturability constraints
- connector-side access
- fastening accessibility
- inspection strategy
- traceability flow
- launch-site standardization

This case study shows how the repository can convert one infotainment bracket config into a production-readiness discussion artifact instead of only a CAD artifact.

## Why This Matters For Production Engineering

For a production engineer supporting AVN, HUD, cluster, or controller/display programs, the design-phase question is not only "Can this be modeled?" It is also:

- Will this geometry create line-side access issues?
- Which dimensions are inspection-critical?
- Where should traceability be captured?
- Which stations are likely to become launch bottlenecks?
- Does the part suggest higher fixture / tooling / automation pressure?
- What should be challenged before line setup is frozen?

This project turns those questions into rule-based, interview-friendly decision-support outputs.

## Example Input

Scenario:

- Part: infotainment display bracket
- Product context: SDV cockpit platform
- Process assumption: sheet metal
- Launch scope: Korea + Mexico
- Annual volume assumption: 180,000
- Key concerns: bend height, mounting hole pitch, connector-side clearance, traceability label area

Source config:

- [infotainment_display_bracket.toml](../../configs/examples/infotainment_display_bracket.toml)

## Command Sequence

```bash
fcad review configs/examples/infotainment_display_bracket.toml \
  --out docs/examples/infotainment-display-bracket/review.json

fcad process-plan configs/examples/infotainment_display_bracket.toml \
  --out docs/examples/infotainment-display-bracket/process-plan.json

fcad line-plan configs/examples/infotainment_display_bracket.toml \
  --runtime data/runtime_examples/display_bracket_runtime.json \
  --profile configs/profiles/site_korea_ulsan.toml \
  --out docs/examples/infotainment-display-bracket/line-plan.json

fcad quality-risk configs/examples/infotainment_display_bracket.toml \
  --out docs/examples/infotainment-display-bracket/quality-risk.json

fcad investment-review configs/examples/infotainment_display_bracket.toml \
  --out docs/examples/infotainment-display-bracket/investment-review.json

fcad readiness-report configs/examples/infotainment_display_bracket.toml \
  --out docs/examples/infotainment-display-bracket/readiness-report.json

fcad stabilization-review configs/examples/infotainment_display_bracket.toml \
  --runtime data/runtime_examples/display_bracket_runtime.json \
  --profile configs/profiles/site_korea_ulsan.toml \
  --out docs/examples/infotainment-display-bracket/stabilization-review.json
```

## Checked-In Artifact Set

- [review.json](../examples/infotainment-display-bracket/review.json)
- [process-plan.json](../examples/infotainment-display-bracket/process-plan.json)
- [line-plan.json](../examples/infotainment-display-bracket/line-plan.json)
- [quality-risk.json](../examples/infotainment-display-bracket/quality-risk.json)
- [investment-review.json](../examples/infotainment-display-bracket/investment-review.json)
- [readiness-report.json](../examples/infotainment-display-bracket/readiness-report.json)
- [readiness-report.md](../examples/infotainment-display-bracket/readiness-report.md)
- [stabilization-review.json](../examples/infotainment-display-bracket/stabilization-review.json)

## Key Findings

### 1. Product Review

- Part type classified as `bracket`
- DFM score: `65`
- Main design-stage risks:
  - thin wall / intersection risk at base-to-leg joins
  - connector-side clearance pressure for line-side assembly and inspection
  - missing edge-conditioning signal for launch robustness

Interpretation:
This is exactly the kind of early structure-review output a production engineer can take back to design before tooling and station assumptions harden.

### 2. Process Plan

- Heuristic flow: incoming material -> blanking / laser cut -> forming / bending -> pierce / hardware prep -> deburr / clean -> dimensional inspection -> subassembly / packaging -> fixture load / unload consideration -> EOL electrical test -> functional fit confirmation
- Critical inspection features:
  - mounting hole pitch
  - bend height
- Automation candidates surfaced:
  - auto screw presentation
  - vision-assisted bend-angle check
  - inline barcode traceability

Interpretation:
The process-plan output is not pretending to be a formal routing. It is useful because it converts geometry and manufacturing assumptions into a reviewable launch sequence.

### 3. Line Plan

- Suggested in-line inspection station: `ST60`
- Suggested end-of-line functional confirmation: `ST90` / `ST100`
- Suggested traceability capture points:
  - incoming material handoff
  - dimensional inspection
  - subassembly / packaging
- Bottleneck candidates:
  - forming / bending under launch conditions
  - dimensional inspection under launch conditions
  - subassembly / packaging under launch conditions
- Recommended offline containment / rework station

Interpretation:
This is closer to real production-engineering thinking because it talks about inspection split, traceability capture, repair routing, and operator-skill sensitivity rather than only listing process steps.

### 4. Quality / Traceability

- Critical dimensions:
  - mounting hole pitch
  - bend height
- Traceability focus:
  - tray and lot identification
  - revision + supplier lot + operator linkage
- Quality gates defined for:
  - incoming blank verification
  - bend and hole pattern verification

Interpretation:
This connects the design review to line stabilization and SDV-style traceability thinking.

### 5. Investment Review

- Investment pressure: `high`
- Manual-labor sensitivity: `high`
- Likely equipment / tooling needs:
  - blanking / laser fixture set
  - bend-angle control tooling
  - vision or gauging interface for automation-candidate stations
- Main cost drivers:
  - process cost
  - setup cost
  - DFM penalty exposure

Interpretation:
The output does not claim a real capex estimate. It does something more honest and useful at this stage: it signals where fixture, gauge, and automation attention is likely to be needed.

### 6. Launch Stabilization Review

- Runtime input: actual CT, FPY, rework, scrap, downtime, and changeover indicators from the Korea-Ulsan pilot line profile
- Highest CT gap station: `ST60`
- Stations above target CT: `ST20`, `ST30`, `ST40`, `ST60`, `ST70`
- Main launch-instability signals:
  - in-line dimensional inspection overload
  - forming / bending instability
  - packaging handoff and traceability burden
- Improvement direction:
  - rebalance manual work
  - tighten launch issue containment
  - reduce downtime from fixture/debug/retry loss

Interpretation:
This moves the workflow beyond concept-level line planning. It becomes something a candidate can credibly describe as launch stabilization support rather than only heuristic station brainstorming.

## Final Readiness Conclusion

- Readiness status: `needs_risk_reduction`
- Readiness score: `62`

Meaning:

- The part remains useful for pilot-line planning discussion, but runtime-informed launch data now shows enough instability to keep risk-reduction work open.
- Runtime-informed review still shows CT instability at several launch stations.
- The main pre-launch challenges are structure robustness, connector-side access, inspection loading, and line-side standardization.

## What This Demonstrates About The Candidate

This case is useful in a portfolio because it demonstrates that the candidate can:

- translate design data into production-engineering questions
- think beyond CAD generation toward line setup and launch risk
- connect manufacturability, inspection, traceability, and line support
- extend the same workflow into runtime-informed launch stabilization review
- discuss automation and investment pressure without overclaiming precision
- produce decision-support artifacts that are readable by design, quality, and manufacturing stakeholders

## Honest Scope

This workflow is still heuristic.

- It does not simulate a real factory.
- It does not produce a real capex model.
- It does not replace time study, PFMEA, control-plan ownership, or detailed site validation.

Its value is earlier than that: it helps surface production-engineering concerns while the design and planning conversation is still flexible.
