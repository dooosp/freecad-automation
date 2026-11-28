# Output Manifest

FreeCAD Automation now emits an additive output manifest for the core `fcad` artifact flows:

- `create`
- `draw`
- `dfm`
- `fem`
- `tolerance`
- `report`
- `inspect`

This output manifest is separate from the existing `artifact-manifest` contract. The goal is narrower and more direct: make it easy to answer which input produced which outputs, under which runtime and git state, and with which warnings or failures.

Revision-lineage proof flows extend the existing manifest contracts rather than
introducing another manifest type. A successful proof manifest includes
`effective_policy.proof_lineage: true` and the validated `revision_lineage`.
A failed proof run retains the effective policy and error evidence without
claiming lineage that was not established. Proof-mode locators are portable and
omit private runtime executable paths; legacy manifest behavior is unchanged.
See [revision-lineage proof mode](./revision-lineage-proof-mode.md).

For `create`, the manifest's `linked_artifacts.quality_json` field now points at the additive `<base>_create_quality.json` report when create exported model artifacts and quality evaluation ran. The same file is included in `outputs` as `model.create-quality-json`, with its SHA-256 and byte size.

## Naming

- Primary artifact present: sibling `<base>_manifest.json`
- No primary artifact: sibling to the input file using the input stem

Examples:

- `output/ks_bracket.step` -> `output/ks_bracket_manifest.json`
- `output/ks_bracket_drawing.svg` -> `output/ks_bracket_drawing_manifest.json`
- `tmp/ks_bracket.toml` for `fcad dfm tmp/ks_bracket.toml` -> `output/ks_bracket_manifest.json`

## Why it helps

- keeps input -> output traceability in one small JSON file
- records hashes and sizes for produced files without requiring FreeCAD for helper-unit tests
- captures repo branch, HEAD SHA, dirty-at-start, Node/runtime context, and command args
- preserves failure evidence by recording partial outputs and error summaries when a run fails after writing files

## Core shape

The manifest includes:

- `schema_version`
- `run_id`
- `command`
- `command_args`
- `input` (a receipt of the bytes loaded by create/draw, when captured by the config loader)
- optional `effective_input` (source receipts, typed configuration snapshots, and the applied recipe)
- `repo`
- `runtime`
- `timings`
- `outputs`
- `linked_artifacts`
- `warnings`
- `errors`
- `status`

## Example

```json
{
  "schema_version": "1.0",
  "run_id": "4f4d8e6f-4f11-42fd-b552-a5de01d0789d",
  "command": "draw",
  "command_args": [
    "configs/examples/ks_bracket.toml",
    "--bom"
  ],
  "input": {
    "path": "/repo/configs/examples/ks_bracket.toml",
    "sha256": "5a9d...c2",
    "size_bytes": 1432
  },
  "repo": {
    "root": "/repo",
    "branch": "feat/output-manifest-foundation",
    "head_sha": "75acc9fd656f0462c5d3f80467da097a9fe04a77",
    "dirty_at_start": false
  },
  "runtime": {
    "node_version": "v25.8.0",
    "platform": "darwin",
    "freecad_available": true,
    "freecad_executable_detected": true,
    "freecad_probe_status": "usable",
    "freecad_status": "ready",
    "freecad_version": "1.1.0"
  },
  "timings": {
    "started_at": "2026-04-20T00:00:00.000Z",
    "finished_at": "2026-04-20T00:00:03.250Z",
    "duration_ms": 3250
  },
  "outputs": [
    {
      "path": "/repo/output/ks_bracket_drawing.svg",
      "kind": "drawing.svg",
      "exists": true,
      "size_bytes": 68421,
      "sha256": "0cb6...1e"
    }
  ],
  "linked_artifacts": {
    "qa_json": "/repo/output/ks_bracket_drawing_qa.json",
    "run_log_json": "/repo/output/ks_bracket_run_log.json",
    "traceability_json": "/repo/output/ks_bracket_traceability.json",
    "planner_json": "/repo/output/ks_bracket_drawing_planner.json",
    "report_pdf": null,
    "quality_json": "/repo/output/ks_bracket_drawing_quality.json"
  },
  "warnings": [],
  "errors": [],
  "status": "pass"
}
```


## Report evidence applicability

`fcad report` verifies the current raw input, the normalized supplied config, and the consumed create/draw evidence against the existing producer manifests. Relocated copies are accepted when their bytes match the unique typed output records. Verification covers create quality, drawing quality, SVG, and extracted semantics when present or referenced. Report-only `export.directory` routing may differ in memory. Legacy proof requires identical raw input; effective-input proof can bind a separately merged report config as described below. Producer failures or errors cannot authorize passing evidence.

The report exposes per-surface `evidence_provenance` with status, reason codes, input digests, and output checks. Known input/output mismatches make the report `fail`; missing or unverifiable proof makes it `incomplete`. Both set `ready_for_manufacturing_review=false` and remove the overall score. Existing quality failures remain failures. PDF and JSON use the same verified evidence snapshot.

Legacy create manifests without the quality digest need a fresh `create` run before that evidence can support PASS. Manifests without `effective_input` still require an identical raw input and support only the config path plus `--strict-quality` and `--bom`; modifiers without proof yield `producer-arguments-unverified`.

New create manifests include `model.effective-config-json`, the normalized configuration passed to model creation. New draw manifests include `drawing.authored-config-json` (after override, before generated drawing defaults/plan) and `drawing.effective-config-json` (the exact generator input, also reused for QA). These snapshots are ordinary hashed output records in the existing manifest. `effective_input.sources` records loader-time config/override receipts and direct compiler, selected template, QA scorer, and postprocessor dependencies. The recipe records BOM, plan compilation outcome, QA weight preset, and processing options.

For example, after `fcad draw base8.json --override override10.json --weights-preset bracket --bom`, run `create` and `report` on the fully merged authored 10 mm config, using the matching model/drawing artifacts. Report separately checks that source + override reproduces the authored snapshot, that the current report config equals that snapshot, and that replaying the existing drawing compiler/defaults reproduces the runtime snapshot. It never applies the producer override to the report config. A report or create config that still specifies 8 mm is rejected.

The drawing service's `preset` option is distinct from CLI `--weights-preset`. The former merges `configs/overrides/presets/<name>.toml`; the latter selects QA weights. For direct service calls, pass `loadConfigSnapshot: loadConfigWithDiagnostics` (and the base `configPath`, or matching `sourceInputs` when supplying an in-memory config) to capture source receipts. The service returns the two snapshot paths and `effective_input` for the existing `buildOutputManifest` helper. For `draw-service-v1`, serialize `command_args` as exactly the one absolute consumed config path; API options belong in the complete typed recipe and their source receipts. Extra serialized modifiers are unverified. Missing/wrong-type recipe fields are rejected before determining which receipts are required. Explicit `qa:false` is valid metadata but keeps report readiness unknown (`producer-qa-not-run`), even if a scored quality sidecar exists. `postprocess:false` alone does not imply missing QA. Custom loaders without receipts remain usable but cannot establish current-input applicability.

Copied artifacts remain valid when their local bytes match the typed output records. Referenced source/override/preset/dependency files must still be readable and unchanged: missing files yield unknown; changed bytes fail. This is an auditable local input/content binding, not a signature or exhaustive software/runtime attestation. Unsupported external plan recipes and failed compiler replay remain unknown. Report uses ordinary Python for deterministic compiler replay; it does not rerun FreeCAD geometry checks.

Runtime configuration snapshots record the Node call into the generator runner, before its platform-specific path translation. Relative override arguments use the producer's recorded working directory. These records do not establish runtime validation on another operating system.

Report generation retains its ordinary exit behavior: successfully writing a failed or incomplete review report returns exit zero. Its output manifest records `warning` with the decision reasons, rather than PASS. Inspect the report summary for the quality decision. These checks do not attach inspection evidence or change canonical manufacturing readiness.
