# Vision

`freecad-automation` should read as a toolchain for reviewing existing engineering context around parts and assemblies, then guiding focused follow-up work.

## North Star

New contributors should understand the repository like this:

`import/bootstrap -> review context -> geometry + DFM + linkage analysis -> bottleneck candidates -> fix options -> verification plan -> selective draw/FEM/tolerance/report`

Not like this:

`create -> draw -> dfm -> tolerance -> report`

## What Stays Core

- Reviewing existing CAD/config context
- Inspecting geometry and exported artifacts
- DFM and related engineering checks
- Selective verification after a bottleneck is identified
- The current Node/Python/FreeCAD runtime stack

## What Becomes Secondary

- Generation-first demos and prompt-driven creation
- Broad sweep/orchestration as the top-level story
- Viewer-led workflows

## What This First Wave Does

- Repositions the README, CLI help, and contributor guidance
- Makes runtime truth explicit with `check-runtime`
- Promotes review of existing configs to a first-class CLI path
- Adds artifact contracts for the missing middle layer

## What This First Wave Does Not Do

- Rewrite the runtime architecture
- Remove legacy commands
- Claim all review-middle artifacts are fully runtime-backed already
