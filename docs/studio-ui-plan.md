# Studio UI Plan

This planning note is now complemented by the contributor handoff in [docs/studio-handoff.md](./studio-handoff.md).

This thread adds a parallel browser shell called `FreeCAD Automation Studio` without deleting the legacy viewer.

## File map

- `public/studio.html`
  - top-level shell with app bar, left workspace navigation, workspace host, and log drawer
- `public/css/studio.css`
  - design tokens plus shared shell primitives such as cards, badges, empty states, split panes, section headers, and the log drawer
- `public/js/studio-shell.js`
  - small app shell controller for hash routing, top-bar status placeholders, keyboard navigation, and log-drawer state
- `public/js/studio/renderers.js`
  - reusable DOM render helpers for cards, lists, badges, empty states, split panes, metrics, flow rails, and logs
- `public/js/studio/workspaces.js`
  - structural workspace definitions for `Start`, `Model`, `Drawing`, `Review`, and `Artifacts`

## Serve model

- `npm run serve:legacy` and `fcad serve --legacy-viewer` continue to use the existing browser shell from `server.js`
- `fcad serve` keeps the local API landing page at `/`
- the future-facing studio shell is exposed in parallel at `/studio`
- the studio shell can also be served statically by the legacy server as `/studio.html`

## Workspace responsibilities

- `Start`
  - system posture, guided entry points, migration status, and pipeline framing
- `Model`
  - prompt design, examples, TOML editing, 3D canvas, model metadata, parts list, and animation
- `Drawing`
  - drawing plan controls, SVG canvas, BOM, and dimension-edit loop
- `Review`
  - design review, DFM, readiness, stabilization, and release guidance
- `Artifacts`
  - exports, manifests, reports, and job output traceability

## Intentionally stubbed in this pass

- no job submission or cancellation controls
- no live model, drawing, or review data panes yet
- no editor migration from the legacy page yet
- only light read-only status hydration from existing local API endpoints when available

## Structural decisions for later threads

- hash routing keeps the shell plain HTML/CSS/JavaScript and avoids introducing a new build chain
- layout primitives are reusable so later feature migration can happen workspace-by-workspace instead of reopening the shell architecture
- status and activity live above navigation chrome so runtime and job posture remain visible regardless of workspace
