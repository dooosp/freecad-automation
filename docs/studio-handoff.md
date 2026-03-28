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
- `Model`: prompt-assisted TOML drafting, example/config loading, validation, preview build, 3D viewport, model metadata, parts list, animation when motion data exists, and tracked `create` plus tracked `report` launch points.
- `Drawing`: sheet-first drawing preview, view and scale controls, BOM, QA summary, annotations, the HTTP-backed dimension-edit loop, and tracked `draw` launch with optional preview-plan preservation.
- `Review`: read-only manufacturing and readiness console driven by tracked jobs and their artifacts.
- `Artifacts`: tracked job timeline, manifest summary, browser-safe artifact open/download actions, lightweight compare against older runs, and artifact-driven re-entry into `Model`, tracked `report`, or tracked `inspect`.

## Preview Vs Tracked Run

| Mode | What it is for | Backing route(s) | Persistence |
| --- | --- | --- | --- |
| Preview | Fast local iteration inside the current workspace | `POST /api/studio/model-preview`, `POST /api/studio/drawing-preview`, `POST /api/studio/drawing-previews/:id/dimensions` | Preview assets only. No `/jobs` entry. |
| Tracked run | Operational execution that should remain visible, pollable, and reopenable | `POST /api/studio/jobs` plus `GET /jobs`, `GET /jobs/:id`, `GET /jobs/:id/artifacts` | Persisted under `/jobs` with manifest, logs, and artifact routes. |

Practical rules:

- Use preview while iterating on TOML, geometry, sheet layout, or dimensions and you do not need provenance yet.
- Use tracked runs when the output should appear in the job timeline, feed `Review`, or support artifact-driven re-entry later.
- Model preview and drawing preview stay available even while a tracked run is queued or running.
- The shell monitor polls `GET /jobs/:id` and can reopen `Artifacts` or `Review` automatically after a tracked run succeeds.

## Round-2 Execution Flow

`Model`

- `Preview Build` posts the current TOML to `POST /api/studio/model-preview`.
- `Run Tracked Create Job` posts the same TOML to `POST /api/studio/jobs` as type `create`.
- `Run Tracked Report Job` posts the current TOML plus report options to `POST /api/studio/jobs` as type `report`.

`Drawing`

- `Preview Drawing` posts the shared TOML plus drawing settings to `POST /api/studio/drawing-preview`.
- Dimension edits stay on the preview route through `POST /api/studio/drawing-previews/:id/dimensions`.
- `Run Tracked Draw Job` posts the shared TOML to `POST /api/studio/jobs` as type `draw`.
- When the tracked draw is launched from an edited preview, the server tries to preserve that preview plan. If preservation is not safe, the tracked run falls back to the current TOML and drawing settings and records the reason in `request.options.studio.preview_plan`.

`Artifacts` and `Review`

- Config-like artifacts can be reopened into `Model` without copying raw paths back into the editor.
- Config-like artifacts can launch tracked `report` reruns through `artifact_ref`.
- Model artifacts can launch tracked `inspect` through `artifact_ref`.
- Review remains read-only, but it can reopen the source config in `Model` or launch a tracked `report` from that source config artifact.

## Inspect And Report Re-entry

- `POST /api/studio/jobs` accepts `artifact_ref` for tracked re-entry.
- Tracked `inspect` requires a model-like artifact such as `.step`, `.stp`, `.stl`, `.fcstd`, or `.brep`.
- Tracked `report` requires a config-like artifact such as the effective config copy or input config copy.
- The translated tracked request records `request.options.studio.source_artifact_*` metadata so the resulting job still points back to the artifact that launched it.

## Browser-friendly artifact routes

- `GET /jobs/:id/artifacts`: list manifest-backed artifact metadata and links for a tracked job.
- `GET /artifacts/:jobId/:artifactId`: open a browser-safe artifact inline when the file type allows it.
- `GET /artifacts/:jobId/:artifactId/download`: force download for the same artifact.
- `GET /jobs/:id/artifacts/:artifactId/content`: compatibility alias for the older API-shaped artifact content route.

## Studio Route Surface

- `GET /`: preferred browser entrypoint for the studio shell
- `GET /api`: local API info page and route discovery payload
- `GET /studio`: direct studio shell route
- `POST /api/studio/validate-config`: validate current TOML before preview or tracked submission
- `POST /api/studio/model-preview`: fast model preview bridge
- `GET /api/studio/model-previews/:id/model`: browserless model preview asset route for single-part previews
- `GET /api/studio/model-previews/:id/parts/:index`: browserless per-part asset route for assembly previews
- `POST /api/studio/drawing-preview`: fast drawing preview bridge
- `POST /api/studio/drawing-previews/:id/dimensions`: preview-only drawing edit bridge
- `POST /api/studio/jobs`: studio-to-job bridge for tracked `create`, `draw`, `inspect`, and `report`
- `GET /jobs`: recent tracked jobs for shell resume and artifact timeline views
- `GET /jobs/:id`: live job status
- `GET /jobs/:id/artifacts`: manifest-backed artifact list
- `GET /artifacts/:jobId/:artifactId`: browser-safe inline artifact open
- `GET /artifacts/:jobId/:artifactId/download`: forced artifact download

## Studio vs legacy shell

The studio shell is now the preferred browser surface for `fcad serve`, but it does not try to preserve the legacy all-in-one interaction model. The studio is workspace-oriented and HTTP-first. The legacy shell remains a single websocket-driven page that couples prompt drafting, model build, drawing overlay, and streaming progress in one place.

## What still depends on legacy websocket flows

- Prompt generation progress streaming. The studio prompt path is request/response today; the legacy shell still exposes streaming chunk feedback.
- The legacy all-in-one build loop that streams binary model payloads and progress directly over websocket as a single page experience.
- The older integrated model-plus-drawing shell for contributors who still want the original overlay workflow without switching workspaces.

## Remaining gaps

- Prompt-design flow: the studio supports prompt-to-TOML drafting, but not the legacy streaming UX or richer assistant iteration controls.
- Runtime-only features: the studio directly covers validate, model preview, drawing preview, tracked jobs, artifact browsing, and artifact-driven inspect/report re-entry. It does not yet expose dedicated workspace controls for FEM, tolerance, cancellation, retries, or broader queue orchestration.
- Deferred review workflows: Review is still read-only and depends on tracked artifacts rather than live inline authoring.
- Still-legacy drawing/edit flows: the studio supports HTTP dimension edits, but the original websocket-driven all-in-one drawing flow remains the fallback for contributors who still depend on that shell.
