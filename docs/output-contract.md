# Output Contract

FreeCAD Automation now emits a first-class artifact manifest for artifact-producing CLI runs, local API jobs, and parameter sweeps.

The canonical schema lives at [schemas/artifact-manifest.schema.json](../schemas/artifact-manifest.schema.json).

## Goals

- make every materialized output traceable back to the command or job that produced it
- capture config migration state, selected rule profile, runtime details, and artifact inventory in one machine-readable record
- keep CLI, API, and sweep provenance aligned instead of inventing separate shapes per surface

## Manifest Naming

- Dedicated output directory: `artifact-manifest.json`
- Single primary output file: sibling `<stem>_artifact-manifest.json`
- Local API job store: `jobs/<job-id>/artifact-manifest.json`
- Sweep aggregate run: `output/sweeps/<run>/artifact-manifest.json`
- Sweep variant: `output/sweeps/<run>/<variant>/artifact-manifest.json`

## Core Fields

Every manifest uses the same core top-level fields:

- `interface`: `cli`, `api`, or `sweep`
- `command` and `job_type`
- `status`
- `config_path`, `config_format`, `config_version`
- `migrated_from`, `migration_applied`
- `selected_profile`, `rule_profile`, `rule_packs`
- `runtime`: platform, Node path/version, Python path when known, FreeCAD runtime details when known
- `warnings`, `deprecations`
- `artifacts`: typed artifact records with `path`, `scope`, `stability`, and optional file metadata
- `timestamps`
- `app_version`, `git_commit`

## Artifact Stability

`artifacts[*].scope` and `artifacts[*].stability` define the contract surface:

- `scope = "user-facing"` and `stability = "stable"`: supported contract surface for tooling, docs, and comparisons
- `scope = "user-facing"` and `stability = "best-effort"`: useful secondary outputs that may grow or shift
- `scope = "internal"` and `stability = "internal"`: implementation detail, mainly for debugging and job-store bookkeeping

## Standard Artifact Types

Stable user-facing types currently include:

- `config.input`
- `config.effective`
- `model.<format>`
- `drawing.svg`
- `report.pdf`
- `review.*.json`
- `context.json`
- `analysis.*.json`
- `quality-link.*.json`
- `review-pack.json`
- `review-pack.markdown`
- `review-pack.pdf`
- `revision-comparison.json`
- `sweep.matrix`
- `sweep.summary.json`
- `sweep.summary.csv`
- `sweep.variant.result`
- `sweep.variant.manifest`

Best-effort user-facing types include most draw QA sidecars such as:

- `drawing.qa-report`
- `drawing.qa-issues`
- `drawing.repair-report`
- `draw.plan.toml`
- `draw.plan.json`
- `draw.traceability`
- `draw.layout-report`

Internal types include:

- `draw.run-log`
- `draw.dimension-map`
- `draw.dimension-conflicts`
- `draw.dedupe-diagnostics`

## CLI vs API vs Sweep

- CLI writes the manifest next to the artifact set it just produced.
- Local API stores the same manifest shape on the job record and persists it as `jobs/<job-id>/artifact-manifest.json`.
- `GET /jobs/:id` returns a browser-safe manifest view with local filesystem paths redacted to safe labels.
- `GET /jobs/:id/artifacts` returns the flattened artifact list derived from `job.manifest.artifacts` plus the same browser-safe manifest view.
- Sweeps emit both aggregate provenance and per-variant provenance. `summary.json` and each variant `result.json` point to their companion manifest paths.

## User-Facing Artifacts vs Job-Store Files

User-facing artifacts are the outputs listed in the manifest `artifacts` array.

Local API job-store files are different:

- `job.json`
- `request.json`
- `job.log`
- `artifact-manifest.json`

`artifact-manifest.json` is the stable provenance contract. The other job-store files are internal persistence and should not be treated as user-facing output artifacts.

Browser-visible local API payloads intentionally avoid raw local filesystem paths:

- `/jobs` and `/jobs/:id` keep logical job metadata plus redacted artifact/result/manifest data.
- `/jobs/:id/artifacts` exposes artifact identity, file name, MIME type, capabilities, and public links, but not raw artifact paths.
- `/api/examples` returns `id`, `name`, and `content` for checked-in examples without exposing checked-out file locations.
- `/api/studio/drawing-preview` and `/api/studio/drawing-previews/:id/dimensions` expose browser-safe drawing preview data with safe preview references instead of raw preview-plan or sidecar paths.

Current browser-visible contract:

- `/jobs` and `/jobs/:id`
  - `request` is sanitized public metadata only
  - `artifacts` is a flattened summary where path-bearing values are reduced to file-name-style labels
  - `manifest` and `result` are browser-safe views; absolute paths are redacted to safe labels/file names
  - `storage.files.<name>` exposes only `exists` and `size_bytes`
- `/jobs/:id/artifacts`
  - `artifacts[*]` exposes `id`, `key`, `type`, `scope`, `stability`, `file_name`, `extension`, `content_type`, `exists`, `size_bytes`, `capabilities`, and `links`
  - `manifest` is the same redacted browser-safe manifest view used on `/jobs/:id`
  - `storage` stays logical and path-free
- `/api/examples`
  - each record is exactly `{ id, name, content }`
- `/api/studio/drawing-preview` and `/api/studio/drawing-previews/:id/dimensions`
  - `preview` exposes `id`, `preview_reference`, `editable_plan_reference` when an editable plan exists, `settings`, `overview`, `validation`, `svg`, `bom`, `views`, `scale`, `qa_summary`, `annotations`, `dimensions`, `editable_plan_available`, `dimension_editing_available`, `tracked_draw_bridge_available`, and `artifact_capabilities`
  - preview-plan files, preview working directories, `logs`, `run_log`, and other path-bearing preview sidecars are not part of the browser contract

Internal executor/job-store files remain path-bearing on disk where needed:

- `request.json`
- `job.json`
- `job.log`
- `artifact-manifest.json`

Those internal files remain the source of truth for execution, retry, and artifact serving. The public API exposes routes and redacted labels, not those raw filesystem paths.

Drawing preview follows the same split: the editable preview-plan file and related sidecars remain server-side only where the dimension-edit loop and tracked-draw bridge need them, while browser-visible responses expose safe labels and availability flags instead of those filesystem paths.

## Runtime Diagnostics Contract

`fcad check-runtime --json` and `GET /health` share the same runtime diagnostics story. The local API returns that shared payload as `runtime`.

Version markers:

- `diagnostics_version`: version of the shared runtime diagnostics payload
- `api_version`: version of the local API response envelope

Shared runtime fields include:

- selected runtime details and searched candidate paths
- environment override resolution order and active values
- Python and FreeCAD version/probe details when available
- command classes and a per-command capability map
- warnings, errors, remediation, and next steps
- `support_boundary_note` when the detected path is outside the repository-owned verified macOS runtime path
