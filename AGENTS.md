# AGENTS.md

## Repo Identity

- Repo basename: `freecad-automation`
- Primary story: bottleneck-first CAD review for existing parts and assemblies
- Execution stack: Node CLI + Python runner + FreeCAD bridge
- Legacy generation flows stay available for compatibility

## Preferred Command Order

For new work, prefer:

1. `fcad check-runtime`
2. `fcad inspect ...` or `fcad review ...`
3. `fcad dfm ...`
4. selective `draw` / `fem` / `tolerance` / `report`

Treat `create`, `design`, and broad generation-first demos as secondary unless the task is explicitly about legacy compatibility.

## Runtime Truth

- Do not claim FreeCAD-backed smoke passed unless `fcad check-runtime` proved the bridge is available and the command actually ran.
- `validate` is for generated `drawing_plan` contracts, not generic raw-config validation.
- Prefer review/context/docs/contracts changes before widening runtime behavior.

## Validation Split

Fast lanes:

- `npm run test:node:contract`
- `npm run test:node:integration`
- `npm run test:py`
- `npm run test:snapshots`

Runtime-backed lanes:

- `npm run test:runtime-smoke`
- `npm run test:full`

Only run runtime-backed lanes when the environment is actually ready.

## Refactor Guardrails

- Keep repo identity, workflow clarity, and command-surface clarity ahead of broad engine rewrites.
- Preserve the existing stack and working legacy commands.
- Prefer additive docs, contracts, aliases, and help improvements over file moves.
