# Coolgear top-view contract decisions

Execution baseline: FreeCAD `a4a1a3f` + plan `1ef42b2`; MVS `3ced81c`.
The normative fixed view is [profile v1](../reference-data/mvs-coolgear-profile-v1.json).
The identical producer/consumer fixture SHA-256 is
`8227681470be0754e3c1b17d5e1f4d1d3c2fd5afe947013c06172aeabe4f5045`.

- Adapter envelope remains the existing MVS `1.0.0` contract. Its three payloads
  and original manifest bytes form one snapshot; no second export manifest system.
- `coolgear-plate-top/v1`: 1520×840, mm, 10 px/mm, 5 mm margin, top-left PNG origin,
  inverted CAD Y. ROIs use hole radius + 1 mm context, not an engineering tolerance.
- Normalized bounds recover pixels using nearest integer, ties to even (the existing
  MVS model rule). Pixel regions are `[left,right) × [top,bottom)`. Independent H1
  bounds are `(310,516,370,576)` and P2 bounds `(132,132,208,208)`.
- Duplicate IDs/JSON keys, non-finite coordinates, unsupported profiles/transforms,
  identity mismatches and inconsistent payload hashes are rejected.
- `source_manifest_sha256` always hashes actual upstream output-manifest bytes.
  It never means the adapter manifest's own digest. External pinned expectations
  identify the selected source; self-consistent hashes are not authentication.
- Existing case schema `1.0.0` already has optional `freecad_adapter_binding`.
  CAD analyses, bundle inventory roles and unevaluated case summaries require
  explicit `1.1.0` schemas/readers in G3–G4; existing `1.0.0` schemas stay unchanged.
  Model `configuration_sha256` keeps its original meaning; CAD binding is separate.
- Fixture source kind is `synthetic_contract_fixture`; native exporter source kind
  is `native_freecad`. Neither indicates physical validation or manufacturing release.

G0 regenerated the unchanged R1 geometry with the current config because the old
create manifest named older config bytes. The original output and ZIPs were kept.
Execution-specific upstream digests and logs stay in `tmp/codex/freecad-mvs-baseline/`.
The new feature-delivery regression is intentionally RED until G3; contract-only
success must not be called full integration success.
