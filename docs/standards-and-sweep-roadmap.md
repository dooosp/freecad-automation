# Standards / Rule Packs And Parameter Sweep Roadmap

This roadmap now tracks the remaining work after the initial sweep workflow shipped. The repository already has a first `fcad sweep` command; future work should extend it without collapsing the current Node CLI -> Python/FreeCAD runtime boundary.

## 1. Standards / Material Rule Packs

### Goal

Make standards-aware checks and defaults pluggable instead of hard-coding them into individual scripts or prompt text.

### Proposed shape

- `configs/rule-packs/<pack-name>.json` or `.toml`
- `scripts/standards/registry.json` remains the package-level index
- `fcad validate-config` and `fcad draw/report` resolve a pack by:
  - explicit config reference
  - shop profile default
  - global default fallback

### Suggested pack contents

- standard family (`KS`, `ISO`, `ASME`, internal)
- material classes and aliases
- drawing defaults:
  - tolerance tables
  - surface-finish defaults
  - note templates
- manufacturing rules:
  - process/material compatibility
  - DFM thresholds by material/process
  - report wording / compliance blocks

### Minimal implementation plan

1. Add a pack registry loader in Node.
2. Allow `config.rules.pack = "<name>"`.
3. Thread the resolved pack into:
   - config validation
   - drawing generation inputs
   - DFM / report services
4. Add at least one checked-in pack beyond current KS-centric defaults.
5. Snapshot the generated notes/callouts for one pack-aware drawing example.

### Why it is not in this PR

- it touches both config semantics and multiple Python outputs
- it needs at least one credible pack design, not a placeholder enum
- it would make this PR too broad once combined with the new API and migration work

## 2. Parameter Sweep

### Current shipped slice

The repository now supports:

- `fcad sweep <config.toml|json> --matrix <file> [--out-dir <dir>]`
- deterministic numeric leaf overrides addressed by config paths such as `shapes[0].height`
- discrete values and inclusive `range = { start, stop, step }` expansion
- sequential execution through the existing `create`, `cost`, `fem`, and `report` service wrappers
- per-variant `effective-config.*` and `result.json`
- aggregate `summary.json` and `summary.csv`
- simple objective summaries for min mass, min cost, and FEM stress-threshold pass/fail when those metrics are available

This is intentionally a sweep, not a true optimizer.

### Current output shape

- new API job type later: `sweep`
- output directory contract:
  - `output/sweeps/<run-id>/summary.json`
  - `output/sweeps/<run-id>/summary.csv`
  - per-variant effective config
  - per-variant result/artifact summary
  - aggregate comparison table

### Supported matrix formats

```json
{
  "name": "bracket-hole-and-thickness-sweep",
  "parameters": {
    "shapes[0].height": [6, 8, 10],
    "fem.constraints[1].magnitude": {
      "range": { "start": 800, "stop": 1200, "step": 200 }
    }
  },
  "jobs": ["create", "cost", "fem", "report"],
  "objectives": {
    "stress_threshold_mpa": 180
  }
}
```

TOML matrices are also supported and are usually easier to read for longer examples.

### Next execution-model upgrades

- Node expands the matrix and writes effective configs.
- Each variant executes through the same service wrappers already used by CLI/API jobs.
- Results are stored as files first, not a database.
- Concurrency should be bounded and opt-in.

### Benchmark outputs already available

- runtime per variant
- success/failure and error summary
- artifact paths
- geometry/cost/FEM metrics extracted from variant results when available

### Future extensions

- add `draw` as an optional sweep job once the per-variant artifact story is equally clean there
- add bounded concurrency and resumable manifests
- expose sweep through the local API job model
- support richer objective ranking and tradeoff filters without claiming optimization
- add benchmark snapshots from a controlled workstation once those numbers are source-backed and repeatable
