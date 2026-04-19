# Demo Script: freecad-automation As A DELMIA-Adjacent Prototype

Use this talk track for a 10 to 15 minute customer-facing or enablement-facing walkthrough. Keep the disclaimer explicit: this is an open-source DELMIA-adjacent learning prototype, not an official DELMIA integration.

## Suggested Flow

1. Introduce the repo
   - `freecad-automation` started as a FreeCAD-backed automation project.
   - The portfolio story now extends into manufacturing review, process planning, quality linkage, and readiness-style outputs.

2. Show the manufacturing context
   - Open [configs/examples/manufacturing/bracket_line_context.json](/Users/jangtaeho/Documents/codex-worktrees/delmia-manufacturing-dx-prototype/freecad-automation/configs/examples/manufacturing/bracket_line_context.json).
   - Explain plant, line, work centers, routing, BOM, inspection, quality, and planning sections.

3. Show production-flow review
   - Run the flow simulation script.
   - Explain throughput, bottleneck, WIP, and improvement actions as deterministic planning guidance.

4. Show inspection-to-manufacturing review
   - Run the linkage script.
   - Explain how inspection findings map back to operations and CAD feature references.

5. Close carefully
   - Emphasize that this is a portfolio prototype for manufacturing DX conversations.
   - State that official DELMIA or 3DEXPERIENCE integration would require a different technical and commercial scope.

## Objection Handling

- `Is this connected to DELMIA?`
  - No. It is DELMIA-adjacent in concepts and vocabulary, not an official integration.
- `Is this a real simulation?`
  - No. It is a deterministic planning demo that keeps the assumptions transparent.
- `Why is this still useful?`
  - It makes the digital manufacturing story concrete, auditable, and easy to discuss with engineering, solution, and partner teams.
