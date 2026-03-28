# Studio UI Handoff

`FreeCAD Automation Studio` is now the preferred browser UI on the non-legacy `fcad serve` path. The legacy viewer remains intentionally reachable for workflows that still depend on the old websocket shell.

## Browser modes

| Mode | How to start | Browser entry | Notes |
| --- | --- | --- | --- |
| Studio shell | `fcad serve` | `/` or `/studio` | Preferred browser UI. Root browser requests land in the studio shell. |
| Local API info | `fcad serve` | `/api` | Human-readable API info page plus JSON/text discovery for the local API contract. |
| Legacy viewer | `fcad serve --legacy-viewer` or `npm run serve:legacy` | `/` | Existing all-in-one websocket viewer shell. Escape hatch while migration finishes. |

## Startup commands

```bash
fcad serve
fcad serve 3100
fcad serve 3100 --jobs-dir output/jobs-dev
fcad serve 3100 --legacy-viewer
npm run serve:legacy
```

## Studio workspaces

- `Start`: runtime posture, route shortcuts, example-first entry points, and recent-job re-entry.
- `Model`: prompt-assisted TOML drafting, example/config loading, validation, preview build, 3D viewport, model metadata, parts list, and animation when motion data exists.
- `Drawing`: sheet-first drawing preview, view and scale controls, BOM, QA summary, annotations, and the HTTP-backed dimension-edit loop.
- `Review`: read-only manufacturing and readiness console driven by tracked jobs and their artifacts.
- `Artifacts`: tracked job timeline, manifest summary, browser-safe artifact open/download actions, and lightweight compare against older runs.

## Browser-friendly artifact routes

- `GET /jobs/:id/artifacts`: list manifest-backed artifact metadata and links for a tracked job.
- `GET /artifacts/:jobId/:artifactId`: open a browser-safe artifact inline when the file type allows it.
- `GET /artifacts/:jobId/:artifactId/download`: force download for the same artifact.
- `GET /jobs/:id/artifacts/:artifactId/content`: compatibility alias for the older API-shaped artifact content route.

## Studio vs legacy shell

The studio shell is now the preferred browser surface for `fcad serve`, but it does not try to preserve the legacy all-in-one interaction model. The studio is workspace-oriented and HTTP-first. The legacy shell remains a single websocket-driven page that couples prompt drafting, model build, drawing overlay, and streaming progress in one place.

## What still depends on legacy websocket flows

- Prompt generation progress streaming. The studio prompt path is request/response today; the legacy shell still exposes streaming chunk feedback.
- The legacy all-in-one build loop that streams binary model payloads and progress directly over websocket as a single page experience.
- The older integrated model-plus-drawing shell for contributors who still want the original overlay workflow without switching workspaces.

## Remaining gaps

- Prompt-design flow: the studio supports prompt-to-TOML drafting, but not the legacy streaming UX or richer assistant iteration controls.
- Runtime-only features: the studio directly covers validate, model preview, drawing preview, tracked jobs, and artifact browsing. It does not yet expose dedicated workspace controls for full inspect, FEM, tolerance, report, or queue orchestration flows.
- Deferred review workflows: Review is still read-only and depends on tracked artifacts that were generated elsewhere.
- Still-legacy drawing/edit flows: the studio supports HTTP dimension edits, but the original websocket-driven all-in-one drawing flow remains the fallback for contributors who still depend on that shell.
