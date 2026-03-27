# Rule Profiles

Rule profiles provide a small extension seam for manufacturing standards and rule assumptions without spreading conditionals across the codebase.

The runtime resolves one selected profile into three pack types:

- `standards` pack: report/document metadata and default standards family
- `materials` pack: material aliases and basic property assumptions
- `processes` pack: process-specific DFM rule defaults

## User Config

Select a profile from a config file:

```toml
[standards]
profile = "ks-basic"
```

If the profile is missing, the loader falls back to `ks-basic` so existing configs keep their current behavior.

## Built-In Layout

Profiles live in:

- `configs/rule-profiles/`

Packs live in:

- `configs/rule-packs/standards/`
- `configs/rule-packs/materials/`
- `configs/rule-packs/processes/`

## Profile Contract

Each profile file is intentionally small:

```json
{
  "id": "my-profile",
  "label": "My profile",
  "description": "Short description",
  "standards_pack": "my-standards",
  "material_pack": "my-materials",
  "process_pack": "my-processes"
}
```

## Pack Contracts

`standards` pack:

```json
{
  "id": "my-standards",
  "default_standard": "ISO",
  "report_metadata": {
    "profile_label": "ISO basic",
    "document_note": "How generated docs should describe the pack",
    "standards_reference": ["ISO 2768-1", "ISO 1302"]
  }
}
```

`materials` pack:

```json
{
  "id": "my-materials",
  "aliases": { "al6061-t6": "AL6061-T6" },
  "materials": {
    "AL6061-T6": {
      "family": "aluminum",
      "density_g_cm3": 2.7,
      "yield_strength_mpa": 276
    }
  }
}
```

`processes` pack:

```json
{
  "id": "my-processes",
  "dfm_constraints": {
    "machining": {
      "min_wall": 1.5,
      "hole_edge_factor": 1.0,
      "hole_spacing_factor": 1.0,
      "max_drill_ratio": 5.0
    }
  }
}
```

## Adding A New Profile

1. Add any new pack files under the matching `configs/rule-packs/*/` directory.
2. Add a profile file under `configs/rule-profiles/` that points at those packs.
3. Set `[standards] profile = "<new-id>"` in a config.
4. Add at least one focused test for the new behavior difference.

No core-logic edits should be needed when a new profile only composes existing extension points.
