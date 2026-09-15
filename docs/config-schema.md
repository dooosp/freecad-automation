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

## Automatic Drawing Plans

Without an explicit `drawing_plan.part_type`, the intent compiler selects a drawing template from the input shapes and operations. A single horizontal box with canonical `length`, `width`, and `height`, where `0 < height < min(length, width, 25)` mm, uses the `plate` template when its only operations are a sequential chain of cylinder cuts ending at `final`. When `final` is omitted, the runtime selects the last inserted shape/result; replacing a shape in place does not move it to the end. In-place plate cuts therefore need an explicit `final` pointing to that plate. The body and holes must have no rotation, and the cylinders must use the default positive Z direction. Existing assembly, section-view, fused-bracket, and six-or-more-hole bushing-plate rules take precedence.

The flat-plate plan requires `WIDTH`, `HEIGHT`, `THK`, `HOLE_DIA`, and `BASE_W`. It does not invent a `WEB_H` requirement. Its thickness label sits to the right of the side view, clear of datum C on the left. It reuses the previous bracket QA weight preset; the remaining quality gates still apply. Other geometry and legacy `size` inputs retain the existing classification rules. This is input-based template selection, not proof of valid geometry or manufacturing suitability.

An explicit `drawing_plan.part_type = "bracket"` continues to select the bracket template with its required `WEB_H`. User `dim_intents` still patch the selected template by ID, including additional requirements and explicit values; automatic classification does not remove them.

### Flat-plate drawing evidence

For the supported horizontal single-box/cylinder-cut recipe, `fcad draw` links required linear dimensions to the final FreeCAD body's measured bounds. Runtime evidence eligibility also accepts this same recipe with six or more holes, while preserving its existing automatic `bushing_plate` template classification. Set `drawing_plan.part_type = "plate"` explicitly when the flat-plate template is appropriate, as in [the USB hub reference example](../configs/examples/usb_hub_reference_mount.json).

The top-view mounting-hole diameter requires every configured hole to match one complete, full-height cylindrical face. An unscoped diameter intent still requires a common diameter across all holes. For mixed diameters, each required `mounting_hole_diameter` intent can declare a nonempty, unique `member_feature_ids` array naming its cylindrical cut tools:

```json
{
  "id": "PANEL_HOLE_DIA",
  "feature": "mounting_hole_diameter",
  "view": "top",
  "style": "diameter",
  "required": true,
  "value_mm": 5.5,
  "member_feature_ids": ["hole_P1", "hole_P2", "hole_P3", "hole_P4"]
}
```

Each selected member must exist in the measured hole set and match the declared diameter. Evidence contains only that group's face references and centers. The rendered diameter label must have a unique projected anchor inside the selected group. A group that excludes the renderer's anchor stays unresolved; this selector does not relocate labels or support arbitrary same-diameter subgroups. Unscoped mixed sizes, missing holes, open edge notches, invalid groups, wrong values, and ambiguous geometry remain unverified. Face references in `<name>_traceability.json` identify this run's topology; they are not stable revision identifiers.

A deduplicated automatic label counts as displayed only when its unique ID, value, view, and category match the final SVG; hole labels also need matching projected centers. Runtime links require that current annotation evidence as well. Unknown features and unsupported geometry do not gain links from equal numeric values. Metadata rounding can leave high-precision dimensions unverified.

The quality summary separates successful duplicate suppression and cross-view redundancy (`informational_conflict_count`) from actionable `conflict_count`. The original conflict sidecar remains intact. Repeated baseline coordinates with the same tolerance produce one label; different coordinates and tolerances remain separate.

Short notes retain their existing placement. Longer notes use two columns inside the title block. If the available space is exceeded, the SVG shows an omission count and drawing quality fails; the full notes remain in the drawing plan. Default draw still writes artifacts with warnings, while `--strict-quality` returns a nonzero exit code for blocking failures. A drawing-quality pass covers the configured checks, not manufacturing approval or every advisory planner recommendation.

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
