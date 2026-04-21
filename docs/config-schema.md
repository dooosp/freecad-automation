# Config Schema

`freecad-automation` now treats user-facing TOML/JSON as a versioned config contract.

- Canonical version: `config_version = 1`
- Accepted inputs: `.toml` and `.json`
- Validation entrypoint: `fcad validate-config <path>`
- Migration entrypoint: `fcad migrate-config <path> [--out <file>]`

The loader applies this order:

1. Parse TOML or JSON.
2. Migrate compatibility-only fields into the canonical v1 shape.
3. Apply backward-compatible defaults for safe fields.
4. Normalize operation specs.
5. Validate against the canonical schema.
6. Emit warnings when deprecated fields are still present.

## Supported Fields

The schema stays compatibility-first at the top level, but canonical v1 coverage is now stronger in the nested sections the repository actively depends on:

| Field group | Purpose |
| --- | --- |
| `config_version` | Explicit schema version. Current value is `1`. |
| `name`, `final` | Core model identity and final body selection. |
| `shapes`, `operations` | Single-part geometry definition for create/draw/report/FEM. |
| `parts`, `assembly` | Multi-part geometry and placement for assembly/tolerance workflows. |
| `manufacturing`, `standards`, `batch_size` | Manufacturing assumptions plus rule-profile selection used by DFM/cost/readiness flows. |
| `product`, `production`, `quality` | Product/program context for production-engineering outputs, including typed `production.sites`, automation candidates, traceability, critical dimensions, quality gates, and functional test points. |
| `drawing`, `drawing_plan`, `drawing_intent` | Drawing metadata, views, notes, tolerances, revisions, feature tolerances, datums, compiled plan inputs, and optional semantic drawing intent used for report metadata. |
| `fem`, `tolerance` | Analysis-specific sections for FEM and tolerance workflows. |
| `export`, `import` | Artifact output controls and STEP-import templates. |

The checked-in sweep matrix examples are not `config_version` documents, but the same validation cleanup also tightens the typed matrix shape the runtime expects: `jobs`, `parameters`, `execution`, and `objectives`.

## Compatibility Aliases

These still load, but `fcad` will warn about them during normal command execution:

| Legacy field | Canonical field |
| --- | --- |
| missing `config_version` | add `config_version = 1` |
| top-level `material` | `manufacturing.material` |
| top-level `process` | `manufacturing.process` |
| `[[operations]].type` | `[[operations]].op` |
| `[export] step = true` and similar booleans | `[export] formats = ["step"]` |

Migration intentionally keeps compatibility-only fields in the output when removing them could break older downstream consumers. Review the `manual follow-up` section from `fcad migrate-config` before deleting those fields.

## Safe Defaults

The migration/validation layer currently applies these safe defaults when the relevant section exists:

- `config_version = 1`
- `drawing.units = "mm"`
- `export.formats = ["step"]`
- `fem.analysis_type = "static"`

## Drawing Intent

`drawing_intent` is optional semantic metadata for what a generated drawing is expected to communicate. It can describe part type, process, material, critical features, required dimensions, required notes, datum strategy, required views, drawing standard, tolerance policy, and `missing_semantics_policy`.

For this foundation layer, missing `drawing_intent` is allowed and does not affect job success, quality status, or manufacturing-readiness decisions. When present, it is preserved in `report_summary.json`; `missing_semantics_policy = "advisory"` is the default safety posture.

## Rule Profile Selection

Use `[standards] profile = "..."` when you want standards/material/process rules to come from a named profile pack:

```toml
[standards]
profile = "iso-basic"
```

Current built-in profiles:

- `ks-basic`: default fallback, preserves the legacy KS-oriented behavior
- `iso-basic`: ISO-oriented metadata plus a stricter default machining hole-edge DFM rule

If a named profile cannot be loaded, the runtime falls back to `ks-basic`.

## Real Examples

These checked-in configs are the main canonical v1 references:

1. [ks_bracket.toml](../configs/examples/ks_bracket.toml)
   Runtime-smoke-backed single-part example with drawing metadata, revisions, and export coverage.
2. [bracket_fem.toml](../configs/examples/bracket_fem.toml)
   Compact FEM-oriented config used by the runtime smoke lane and the sweep gallery.
3. [infotainment_display_bracket.toml](../configs/examples/infotainment_display_bracket.toml)
   Production-readiness example with `product`, `manufacturing`, `production`, `quality`, and `drawing`.
4. [controller_housing_eol.toml](../configs/examples/controller_housing_eol.toml)
   Electronics assembly/readiness example with typed `assembly`, `quality`, drawing feature tolerances, and standard-doc workflows.
5. [pcb_mount_plate.toml](../configs/examples/pcb_mount_plate.toml)
   Production/readiness example used by the readiness-report test/doc path.

## Upgrade Notes

- Existing sample configs continue to load because the CLI auto-migrates them to the canonical v1 shape before execution.
- Use `fcad validate-config --json` in CI when you want machine-readable pass/fail output plus counts.
- Use `fcad migrate-config` before checking in a rewritten config file; the command prints changed fields, deprecated fields, and manual follow-up items.
- If a legacy and canonical field disagree, migration preserves the canonical field and reports the mismatch as manual follow-up instead of guessing silently.
- New checked-in examples should be written as explicit canonical v1 by default: add `config_version = 1` and prefer canonical fields over compatibility aliases.
- Keep an example legacy-compatible only when its purpose is migration, backward-compatibility, or regression coverage. In those cases, document that intent in the example or the test that relies on it.
