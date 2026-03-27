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

The schema is intentionally permissive in deep nested sections so existing workflows keep working, but the canonical v1 field groups are:

| Field group | Purpose |
| --- | --- |
| `config_version` | Explicit schema version. Current value is `1`. |
| `name`, `final` | Core model identity and final body selection. |
| `shapes`, `operations` | Single-part geometry definition for create/draw/report/FEM. |
| `parts`, `assembly` | Multi-part geometry and placement for assembly/tolerance workflows. |
| `manufacturing`, `standards`, `batch_size` | Manufacturing assumptions plus rule-profile selection used by DFM/cost/readiness flows. |
| `product`, `production`, `quality` | Product/program context for production-engineering outputs. |
| `drawing`, `drawing_plan` | Drawing metadata, views, notes, tolerances, and plan artifacts. |
| `fem`, `tolerance` | Analysis-specific sections for FEM and tolerance workflows. |
| `export`, `import` | Artifact output controls and STEP-import templates. |

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

These checked-in configs exercise the canonical schema surface:

1. [controller_housing.toml](../configs/examples/controller_housing.toml)
   Single-part production-readiness config with `product`, `manufacturing`, `production`, `quality`, `drawing`, and `export`.
2. [bracket_fem.toml](../configs/examples/bracket_fem.toml)
   Compact single-part config focused on `shapes`, `operations`, `fem`, and `export`.
3. [ptu_assembly_mates.toml](../configs/examples/ptu_assembly_mates.toml)
   Assembly config using `parts` plus `assembly` for placement/mates.

## Upgrade Notes

- Existing sample configs continue to load because the CLI auto-migrates them to the canonical v1 shape before execution.
- Use `fcad validate-config --json` in CI when you want machine-readable pass/fail output plus counts.
- Use `fcad migrate-config` before checking in a rewritten config file; the command prints changed fields, deprecated fields, and manual follow-up items.
- If a legacy and canonical field disagree, migration preserves the canonical field and reports the mismatch as manual follow-up instead of guessing silently.
