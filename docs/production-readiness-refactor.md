# Production Readiness Refactor

This document records the first-wave bottleneck-CAD reframe in the current checkout.

## Mismatch Matrix

| Surface | Current story | Desired story | Action | Rationale | Risk | Implementation now vs later |
|---|---|---|---|---|---|---|
| `README.md` | Design-to-manufacturing pipeline, generation-first | Review-first for existing parts and assemblies | Rewritten around review lanes, selective verification, and legacy compatibility | New contributors should understand repo purpose in under 2 minutes | Low | Now |
| `bin/fcad.js --help` | Mixed broad pipeline and legacy-first examples | Explicit review-first taxonomy | Reordered help, added `check-runtime`, exposed `review`, clarified `validate` | Help is part of the product surface | Low | Now |
| `lib/paths.js` / help path | Help crashed when `wslpath` was missing | Help must work without runtime | Deferred WSL resolution until command execution | Command discovery must not depend on FreeCAD availability | Low | Now |
| `package.json` | Generic automation description, ambiguous test surface | Review-first description with split validation lanes | Updated description and script taxonomy | Command-surface clarity | Low | Now |
| `AGENTS.md` | Missing | Repo-local contributor guidance | Added repo-level guidance | Reduce contributor ambiguity | Low | Now |
| `docs/` tree | Missing | Vision, architecture, workflow, testing, refactor record | Added focused docs set | Requested repo-story alignment cannot live only in README | Low | Now |
| `configs/examples/` | Mixed demos with no classification | Review fixtures vs legacy generation demos | Added example classification notes | Examples shape contributor expectations | Low | Now |
| Middle-layer artifacts | Implicit or absent | Named contracts between detection and reporting | Added schema stubs in `schemas/` | Makes missing review layer legible without runtime rewrite | Low | Now |
| `mfg-agent` package/bin surface | Compatibility alias already points to the same CLI | Keep `fcad` as the canonical command identity | Document alias status without promoting it in help/docs | Prevent command-name drift while preserving compatibility | Low | Now |
| Import/bootstrap and downstream manufacturing lane | Not first-class in this checkout | Present as follow-up taxonomy only | Documented as deferred/not implemented | Avoid speculative runtime work | Medium | Later |

## Keep / Deprecate / Add / Reorder

- Keep: `inspect`, `dfm`, `draw`, `fem`, `tolerance`, `report`, existing Node/Python/FreeCAD stack
- Deprecate: generation-first repo story as the default front door
- Add: `check-runtime`, first-class `review`, schema contracts for middle-layer artifacts, repo-local guidance docs
- Reorder: help text, README, and testing guidance so review comes first, selective verification second, legacy generation third

## Deferred Follow-Up

- Runtime-backed emission of the new middle-layer artifacts
- A true `import/bootstrap` command if the repo grows stronger existing-CAD ingest surfaces
- Optional downstream manufacturing lanes beyond the current DFM/report features
