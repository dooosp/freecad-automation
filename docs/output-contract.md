# Output Contract

FreeCAD Automation now emits a first-class artifact manifest for artifact-producing CLI runs, local API jobs, parameter sweeps, and stdout-oriented commands when `--manifest-out <path>` is supplied.

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

- `manifest_version` and `schema_version`: explicit stability/version markers for the manifest contract
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

`schema_version` remains for backward compatibility with earlier tooling. New tooling should key on `manifest_version`.

## Artifact Stability

`artifacts[*].scope` and `artifacts[*].stability` define the contract surface:

- `scope = "user-facing"` and `stability = "stable"`: supported contract surface for tooling, docs, and comparisons
- `scope = "user-facing"` and `stability = "best-effort"`: useful secondary outputs that may grow or shift
- `scope = "internal"` and `stability = "internal"`: implementation detail, mainly for debugging and job-store bookkeeping

## Standard Artifact Types

Stable user-facing types currently include:

- `config.input`
- `config.effective`
- `model.input`
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
- Stdout-oriented CLI commands such as `inspect`, `fem`, `tolerance`, and `dfm` keep their current stdout output by default, but can emit a manifest explicitly with `--manifest-out <path>`.
- Local API stores the same manifest shape on the job record and persists it as `jobs/<job-id>/artifact-manifest.json`.
- `GET /jobs/:id` returns `job.manifest`.
- `GET /jobs/:id/artifacts` returns the flattened artifact list derived from `job.manifest.artifacts` plus the same `manifest` object.
- Sweeps emit both aggregate provenance and per-variant provenance. `summary.json` and each variant `result.json` point to their companion manifest paths.

## User-Facing Artifacts vs Job-Store Files

User-facing artifacts are the outputs listed in the manifest `artifacts` array.

Local API job-store files are different:

- `job.json`
- `request.json`
- `job.log`
- `artifact-manifest.json`

`artifact-manifest.json` is the stable provenance contract. The other job-store files are internal persistence and should not be treated as user-facing output artifacts.

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
