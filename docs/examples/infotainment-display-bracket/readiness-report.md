# Production Readiness Report: infotainment_display_bracket

- Status: needs_risk_reduction
- Composite score: 62
- Gate decision: hold_before_line_commitment

## Executive Summary

- Overall risk level: high
- Top issues: Wall thickness 0.0mm < min 0.5mm at intersection 'base_plate'/'vertical_leg'; Wall thickness 0.0mm < min 0.5mm at intersection 'base_plate'/'side_tab'; Connector keep-out assumption is tight for line-side assembly and inspection; ST30 forming  /  bending: Actual CT is 3.6s above target.; ST60 dimensional inspection: Actual CT is 8.2s above target.
- Recommended actions: Increase wall to >= 0.5mm; Add fillet (R >= 0.5mm) or chamfer to internal corners; Review ribbing, bend relief, or local reinforcement before pilot tooling freeze.; Reserve additional probe and hand-tool clearance or define dedicated access tooling.; Separate in-line dimensional checks from end-of-line release logic.
- Likely bottlenecks: ST30 forming  /  bending: actual CT gap 3.6s, confidence high.; ST60 dimensional inspection: actual CT gap 8.2s, confidence high.; ST70 subassembly  /  packaging: actual CT gap 4.1s, confidence high.; ST40 pierce  /  tapping  /  hardware insertion: actual CT gap 1.8s, confidence medium.

## Product Review

- Part type: bracket
- DFM score: 65
- Primary risks: Wall thickness 0.0mm < min 0.5mm at intersection 'base_plate'/'vertical_leg'; Wall thickness 0.0mm < min 0.5mm at intersection 'base_plate'/'side_tab'; No fillet or chamfer operations found — internal corners may cause stress concentration; Thin wall candidate may reduce process stability during launch

## Process Planning

- Flow steps: 11
- Automation candidates: auto screw presentation, vision-assisted bend-angle check, inline barcode traceability

## Line Layout

- Stations: 11
- Target cycle time: 36 s
- Inline inspection stations: ST60
- End-of-line inspection stations: ST90, ST100, ST110
- Runtime-informed stations above target: ST20, ST30, ST40, ST60, ST70

## Quality / Traceability

- Critical dimensions: 2
- Quality gates: 2

## Launch Stabilization

- Runtime basis: runtime_informed
- Top bottlenecks: ST30 forming  /  bending: Actual CT is 3.6s above target.; ST60 dimensional inspection: Actual CT is 8.2s above target.; ST70 subassembly  /  packaging: Actual CT is 4.1s above target.; ST40 pierce  /  tapping  /  hardware insertion: Actual CT is 1.8s above target.
- Launch instability signals: Actual CT is 3.6s above target.; Downtime 7.4% is above the site guardrail.; FPY 0.968 is below the site target 0.980.; Rework rate 0.023 exceeds the launch target.; Changeover time 510s is above the site guardrail.; Actual CT is 8.2s above target.


## Cost / Investment

- Unit cost: 131165
- Total cost: 15739802

## Decision Summary

- Go signals: Critical dimensions and quality gates are explicitly identified.; Cost and process comparison data is available for screening-level investment review.
- Hold points: DFM score remains below the preferred pilot-line threshold.; Runtime-informed review still shows CT instability at one or more launch stations.
- Next actions: Confirm PFMEA/control-plan ownership for launch site rollout.; Review line-side inspection concept against connector access and fastening assumptions.; Rebalance manual content or split the work across launch staffing until the cycle stabilizes.; Use this output as an early decision-support artifact, then refine with real line data.
