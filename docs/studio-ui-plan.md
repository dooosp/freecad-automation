# Studio UI Plan

This planning note is now complemented by the contributor handoff in [docs/studio-handoff.md](./studio-handoff.md). Treat the handoff as the source of truth for the current round-2 execution model and route surface.

This thread adds a parallel browser shell called `FreeCAD Automation Studio` without deleting the legacy viewer.

## File map

- `public/studio.html`
  - top-level shell with app bar, left workspace navigation, workspace host, and log drawer
- `public/css/studio.css`
  - design tokens plus shared shell primitives such as cards, badges, empty states, split panes, section headers, and the log drawer
- `public/js/studio-shell.js`
  - small app shell controller for hash routing, top-bar status placeholders, keyboard navigation, and log-drawer state
- `public/js/studio/job-monitor.js`
  - shared helper module for recent-job ordering, monitor transitions, and completion routing
- `public/js/studio/renderers.js`
  - reusable DOM render helpers for cards, lists, badges, empty states, split panes, metrics, flow rails, and logs
- `public/js/studio/workspaces.js`
  - structural workspace definitions for `Start`, `Model`, `Drawing`, `Review`, and `Artifacts`
- `public/js/studio/artifact-actions.js`
  - artifact classification and workspace re-entry helpers shared by `Artifacts`, `Review`, and the studio job bridge

## Serve model

- `npm run serve:legacy` and `fcad serve --legacy-viewer` continue to use the existing browser shell from `server.js`
- `fcad serve` now sends browser requests on `/` into the studio shell and keeps the API info page on `/api`
- the studio shell remains directly reachable at `/studio`
- preview bridges live under `/api/studio/*`, tracked job state lives under `/jobs`, and browser-safe artifact opens live under `/artifacts/*`

## Workspace responsibilities

- `Start`
  - system posture, guided entry points, migration status, and pipeline framing
- `Model`
  - prompt design, examples, TOML editing, 3D canvas, model metadata, parts list, animation, and tracked create/report launch points
- `Drawing`
  - drawing plan controls, SVG canvas, BOM, dimension-edit loop, and tracked draw launch
- `Review`
  - design review, DFM, readiness, stabilization, and release guidance driven by tracked artifacts
- `Artifacts`
  - exports, manifests, reports, job output traceability, and artifact-driven re-entry into other workspaces

## Current round-2 posture

- preview and tracked paths are intentionally separated in `Model` and `Drawing`
- tracked jobs are monitored through `/jobs` instead of websocket-only progress
- artifact-driven re-entry is available for config-like and model-like artifacts
- no cancellation or retry controls yet
- no goal to replicate the legacy all-in-one websocket UX inside the studio shell

## Structural decisions for later threads

- hash routing keeps the shell plain HTML/CSS/JavaScript and avoids introducing a new build chain
- layout primitives are reusable so later feature migration can happen workspace-by-workspace instead of reopening the shell architecture
- status and activity live above navigation chrome so runtime and job posture remain visible regardless of workspace
