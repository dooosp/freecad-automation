# Architecture V2

## Execution Model

The runtime architecture is intentionally unchanged:

```text
bin/fcad.js
  -> lib/runner.js
  -> scripts/*.py
  -> FreeCAD bridge
```

This refactor changes the product boundary and command taxonomy, not the
underlying Node/Python/FreeCAD stack.

## Product Boundary

The primary boundary is now review and focused engineering follow-up for
existing parts and assemblies.

```text
existing CAD or TOML config
  -> review context
  -> inspect / dfm / review
  -> bottleneck candidates
  -> fix options
  -> verification plan
  -> targeted draw / fem / tolerance / report
```

## First-Wave Contracts

This branch adds schema-level contracts for the missing middle layer:

- `feature_identity.json`
- `bottleneck_candidates.json`
- `fix_options.json`
- `verification_plan.json`

These are not a claim that the current runtime emits every artifact by default.
They exist to make the intended review boundary legible and safe to build
against incrementally.

## Command Roles

- Review core: `check-runtime`, `inspect`, `dfm`, `review`, `validate`
- Verification: `draw`, `fem`, `tolerance`, `report`
- Legacy compatibility: `create`, `design`
- Secondary utility: `serve`

## Compatibility Notes

- `create` and `design` remain available.
- No runtime-backed path is silently removed.
- `validate` retains its existing behavior and is now documented more precisely
  as a drawing-plan validator.
