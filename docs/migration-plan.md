# Migration Plan

## Objective

Shift `freecad-automation` from generation-first CAD automation to engineering-context analysis while preserving the existing runtime and legacy commands.

## Sequence

1. Reposition documentation and CLI help around engineering decision support.
2. Introduce shared engineering context schemas and ingest flow.
3. Add geometry intelligence for existing CAD/STEP/FCStd inputs.
4. Add inspection/quality linkage and review decision logic.
5. Add review-pack reporting and fixture coverage.

## Rules

- Prefer additive refactors.
- Keep `create` and `design` functional but de-emphasized.
- Keep module boundaries explicit: `adapters`, `geometry`, `linkage`, `decision`, `reporting`.
- Emit machine-readable JSON artifacts at every stage.
