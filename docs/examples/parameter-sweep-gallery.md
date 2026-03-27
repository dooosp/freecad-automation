# Parameter Sweep Gallery

`fcad sweep` is a first-pass design-space exploration command. It expands deterministic numeric overrides from a matrix file, writes per-variant effective configs, and reuses the existing `create`, `cost`, `fem`, and `report` service paths instead of introducing a separate optimization engine.

Current v1 scope:

- numeric leaf overrides only, addressed by config paths such as `shapes[0].height` or `fem.constraints[1].magnitude`
- discrete `values = [...]` lists or inclusive `range = { start, stop, step }`
- sequential execution with structured `summary.json`, `summary.csv`, aggregate `artifact-manifest.json`, per-variant `effective-config.*`, per-variant `result.json`, and per-variant `artifact-manifest.json`
- comparative summaries for min mass, min cost, and FEM stress-threshold pass/fail when those metrics are available

Output contract:

- `artifact-manifest.json`: aggregate run provenance, selected profile, config migration state, runtime info, and the artifact inventory for the sweep output directory
- `summary.json`: aggregate result set, objective summary, per-variant metrics, artifact paths, runtime, and `manifest_path`
- `summary.csv`: spreadsheet-friendly comparison table
- `<variant>/effective-config.toml|json`: the exact config used for that run
- `<variant>/result.json`: compact per-variant metrics, artifacts, runtime, errors, and `manifest_path`
- `<variant>/artifact-manifest.json`: per-variant provenance and artifact inventory

Approximate runtime guidance:

- `create + cost` sweeps are usually the lightest path: plan for roughly 5 to 20 seconds per variant on a warm local FreeCAD workstation
- `create + cost + fem + report` sweeps are heavier: plan for roughly 20 to 90 seconds per variant depending on mesh density, FreeCAD cold start, and report rendering
- the exact measured runtime for each run is written to `summary.json` and `summary.csv`; treat the numbers above as planning estimates rather than repository-verified benchmark claims

## Example 1: KS Bracket Geometry Sweep

Input config:

- [configs/examples/ks_bracket.toml](../../configs/examples/ks_bracket.toml)

Sweep matrix:

- [configs/examples/sweeps/ks_bracket_geometry_sweep.toml](../../configs/examples/sweeps/ks_bracket_geometry_sweep.toml)

Command:

```bash
fcad sweep configs/examples/ks_bracket.toml \
  --matrix configs/examples/sweeps/ks_bracket_geometry_sweep.toml \
  --out-dir output/sweeps/ks_bracket_geometry
```

What it changes:

- `shapes[0].height`: base-plate thickness `6, 8, 10`
- `operations[7].radius`: final fillet radius `2, 4`

Expected outputs:

- `output/sweeps/ks_bracket_geometry/summary.json`
- `output/sweeps/ks_bracket_geometry/summary.csv`
- `output/sweeps/ks_bracket_geometry/artifact-manifest.json`
- `output/sweeps/ks_bracket_geometry/variant-001/effective-config.toml`
- `output/sweeps/ks_bracket_geometry/variant-001/result.json`
- `output/sweeps/ks_bracket_geometry/variant-001/artifact-manifest.json`
- per-variant CAD exports under each variant directory because `create` runs with a variant-local `export.directory`

What to compare:

- `model_volume_mm3` from the `create` result
- `estimated_mass_kg` and `unit_cost` from the reused cost estimator
- runtime per variant from the summary files

Approximate runtime:

- 6 variants total
- roughly 0.5 to 2 minutes for the full sweep on a warm workstation

## Example 2: Bracket FEM + Report Sweep

Input config:

- [configs/examples/bracket_fem.toml](../../configs/examples/bracket_fem.toml)

Sweep matrix:

- [configs/examples/sweeps/bracket_fem_load_sweep.toml](../../configs/examples/sweeps/bracket_fem_load_sweep.toml)

Command:

```bash
fcad sweep configs/examples/bracket_fem.toml \
  --matrix configs/examples/sweeps/bracket_fem_load_sweep.toml \
  --out-dir output/sweeps/bracket_fem_load
```

What it changes:

- `fem.constraints[1].magnitude`: applied force `800, 1000, 1200`
- `fem.mesh.max_element_size`: mesh size `8, 10`

Expected outputs:

- `output/sweeps/bracket_fem_load/summary.json`
- `output/sweeps/bracket_fem_load/summary.csv`
- `output/sweeps/bracket_fem_load/artifact-manifest.json`
- `output/sweeps/bracket_fem_load/variant-001/effective-config.toml`
- `output/sweeps/bracket_fem_load/variant-001/result.json`
- `output/sweeps/bracket_fem_load/variant-001/artifact-manifest.json`
- per-variant FEM exports from the existing FEM path
- per-variant report PDF paths captured under `report_pdf` in each result file

What to compare:

- `max_von_mises_mpa`
- `safety_factor`
- `stress_threshold_pass` against the matrix threshold of `180 MPa`
- `unit_cost` if you also want a quick structural-vs-cost tradeoff scan

Approximate runtime:

- 6 variants total
- roughly 2 to 9 minutes for the full sweep on a warm workstation, longer if FreeCAD cold-starts each heavy path

## Notes For External Users

- `fcad sweep` is a parameter sweep, not an optimizer. It evaluates the combinations you declare; it does not search continuously, fit surrogate models, or claim Pareto-optimality.
- If you want stable output paths for scripts or CI docs, always pass `--out-dir`.
- If you are consuming sweep outputs programmatically, read `artifact-manifest.json` first and treat the files marked `scope = "user-facing"` and `stability = "stable"` as the contract surface.
- If your matrix includes `fem` or `report`, run `fcad check-runtime` first on that machine.
- Start with small matrices. The first version is intentionally sequential and deterministic.
