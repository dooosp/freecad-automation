# freecad-automation

**Bottleneck-first CAD review and selective verification for existing parts and assemblies.**

This repository keeps the current Node CLI + Python runner + FreeCAD execution model, but the front door is now review-first:

`import/bootstrap -> review context -> geometry + DFM + linkage analysis -> bottleneck candidates -> fix options -> verification plan -> selective draw/FEM/tolerance/report`

The older generation-first path still exists for compatibility, but it is no longer the primary product story.

## Start Here

```bash
npm install
node bin/fcad.js --help
```

If you want a global command:

```bash
npm link
fcad --help
```

`mfg-agent` remains installed as a compatibility alias for the same CLI, but `fcad` is the canonical command name in docs and examples.

### Core Review Lane

```bash
fcad check-runtime
fcad inspect output/ks_bracket.step
fcad dfm configs/examples/ks_bracket.toml
fcad review configs/examples/seatbelt_retractor.toml
```

- `check-runtime` proves whether the WSL -> Windows FreeCAD bridge is actually available.
- `inspect` and `dfm` are the main first-wave review surfaces for existing artifacts and configs.
- `review` promotes the existing Gemini-backed assembly/config review flow that was previously only exposed via `scripts/design-reviewer.js --review`.

### Selective Verification Lane

Use these only after the review context is clear:

```bash
fcad draw configs/examples/ks_bracket.toml
fcad fem configs/examples/bracket_fem.toml
fcad tolerance configs/examples/ks_shaft.toml
fcad report configs/examples/ks_bracket.toml
```

### Legacy Compatibility Lane

These commands remain available, but they are no longer the main product story for new contributors:

```bash
fcad create configs/examples/ks_bracket.toml
fcad design "M8 mounting bracket 120x80mm"
fcad serve 8080
```

## What Is Core vs Secondary

| Lane | Status | Commands |
|---|---|---|
| Review-first core | Primary | `check-runtime`, `inspect`, `dfm`, `review`, `validate` |
| Selective verification | Primary after review | `draw`, `fem`, `tolerance`, `report` |
| Optional downstream manufacturing | Secondary | `process-plan`, `quality-risk`, `readiness-pack`, `readiness-report`, `pack`, `stabilization-review`, `generate-standard-docs` |
| Legacy generation | Compatibility | `create`, `design`, generation-heavy example flows |
| Viewer/runtime utilities | Secondary | `serve` |

## Current Command Taxonomy

| Command | Role | Notes |
|---|---|---|
| `check-runtime` | Runtime truth | Reports whether the WSL/FreeCAD bridge is really present |
| `inspect <model>` | Review | Inspect existing STEP/FCStd/BREP/STL metadata |
| `dfm <config>` | Review | Run manufacturability checks against an existing config |
| `review <config>` | Review | Gemini-backed review of an existing TOML assembly/config |
| `validate <config>` | Review support | Validates generated `drawing_plan` contracts, not raw configs |
| `draw <config>` | Verification | Generate a drawing after the review bottleneck is understood |
| `fem <config>` | Verification | Focused structural follow-up |
| `tolerance <config>` | Verification | Focused tolerance and stack-up follow-up |
| `report <config>` | Verification/output | Summarize reviewed findings and selected analyses |
| `create <config>` | Legacy compatibility | Generation-first model build |
| `design "text"` | Legacy compatibility | AI-generated TOML then build |
| `serve [port]` | Secondary utility | Viewer for artifacts already produced |

## Middle-Layer Artifact Contracts

First-wave refactoring adds contracts for the missing review middle layer in [`schemas/`](./schemas):

- `feature_identity.schema.json`
- `bottleneck_candidates.schema.json`
- `fix_options.schema.json`
- `verification_plan.schema.json`

These are schema/docs contracts in this wave, not a claim that every artifact is emitted by the runtime today.

## Repository Layout

```text
freecad-automation/
  bin/                    CLI entry points and command taxonomy
  lib/                    Node runtime bridge and config helpers
  scripts/                FreeCAD/Python execution layer
  configs/examples/       Review fixtures, legacy generation demos, and assemblies
  schemas/                First-wave review artifact contracts
  docs/                   Vision, architecture, workflow, testing, refactor notes
  tests/                  Fast contracts, Python unit checks, runtime-backed integration
  public/                 Secondary viewer surfaces
```

## Testing

Use the new split documented in [`docs/testing.md`](./docs/testing.md):

```bash
npm run test:node:contract
npm run test:py
npm run test:snapshots
```

Only run runtime-backed smoke when `fcad check-runtime` says the bridge is available:

```bash
npm run test:node:integration
npm run test:runtime-smoke
npm run test:full
```

## Runtime Model

The execution stack is unchanged:

- Node CLI in [`bin/fcad.js`](./bin/fcad.js)
- Python/FreeCAD scripts in [`scripts/`](./scripts)
- WSL -> Windows FreeCAD bridge in [`lib/runner.js`](./lib/runner.js) and [`lib/paths.js`](./lib/paths.js)

This refactor does **not** introduce a new architecture outside that stack.

## Docs Map

- Vision: [`docs/vision.md`](./docs/vision.md)
- Architecture: [`docs/architecture-v2.md`](./docs/architecture-v2.md)
- Workflow: [`docs/codex-multi-agent-workflow.md`](./docs/codex-multi-agent-workflow.md)
- Testing: [`docs/testing.md`](./docs/testing.md)
- Refactor record + mismatch matrix: [`docs/production-readiness-refactor.md`](./docs/production-readiness-refactor.md)

## License

[MIT](LICENSE)
