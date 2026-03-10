# Product Vision

## Direction

`freecad-automation` is moving from generation-first CAD automation toward engineering decision support for existing parts and assemblies.

The primary user is no longer someone starting from a TOML part definition. The primary user is an engineer reviewing an existing CAD model together with BOM, inspection, and quality evidence.

## Primary Value

The system should help answer practical review questions such as:

- What geometry characteristics deserve engineering attention?
- Which inspection failures align with likely geometry or process risk?
- Which defect patterns recur around the same feature classes?
- What should the next design, manufacturing, or inspection action be?

## Core Artifacts

The product should produce machine-readable artifacts first:

- normalized engineering context
- geometry intelligence
- manufacturing/review hotspots
- inspection linkage
- quality linkage
- review priorities
- recommended actions

Human-readable review packs are downstream outputs, not the system of record.

## Scope Boundaries

- Preserve the existing Node CLI + Python runner + FreeCAD architecture.
- Keep legacy generation flows working for existing users.
- Prefer additive modules over large rewrites.
- Treat linkage and decision outputs as review guidance, not engineering truth.
- Favor auditable heuristics and evidence fields over opaque scoring.

## Outcome

A new user should understand the repository as a toolchain for analyzing real engineering context around existing parts, not as a text-to-shape demo.
