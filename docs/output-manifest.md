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

For `create`, the manifest's `linked_artifacts.quality_json` field now points at the additive `<base>_create_quality.json` report when create exported model artifacts and quality evaluation ran.

## Naming

- Primary artifact present: sibling `<base>_manifest.json`
- No primary artifact: sibling to the input file using the input stem

Examples:

- `output/ks_bracket.step` -> `output/ks_bracket_manifest.json`
- `output/ks_bracket_drawing.svg` -> `output/ks_bracket_drawing_manifest.json`
- `tmp/ks_bracket.toml` for `fcad dfm tmp/ks_bracket.toml` -> `tmp/ks_bracket_manifest.json`

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
- `input`
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
    "report_pdf": null,
    "quality_json": "/repo/output/ks_bracket_drawing_quality.json"
  },
  "warnings": [],
  "errors": [],
  "status": "pass"
}
```
