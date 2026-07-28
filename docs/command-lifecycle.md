# Command lifecycle policy

`src/shared/command-manifest.js` is the machine-readable source of truth. Every dispatchable command has exactly one `lifecycle`, plus `defaultHelpVisible`, `audience`, `workflow`, `replacement`, `removalVersion`, and `safetyBoundary`. Tests require complete manifest/dispatch coverage and reject missing lifecycle metadata.

## Lifecycle meanings

| Lifecycle | Meaning |
| --- | --- |
| `stable` | Documented, bounded command contract with source-of-truth registration and contract coverage. Stable does not imply that every platform or physical process is validated. |
| `beta` | Useful engineering behavior with incomplete platform, process, or scenario coverage. |
| `experimental` | Exploratory behavior that may change and is not a primary user path. |
| `maintainer` | Governance, evidence-control, rehearsal, journal, audit, doctor, and materializer operations requiring maintainer context. |
| `compatibility` | Preserved command or alias supporting older invocations and migration. |
| `deprecated` | A preserved route with exact replacement guidance. No removal version is announced without maintainer approval. |
| `internal` | Implementation primitive kept reachable for compatibility and debugging but not presented as an ordinary product command. |

## Default guided surface

`fcad --help` shows 12 primary rows:

- Review: `check-runtime`, `create`, `draw`, `inspect`, `review-context`, `readiness-pack`, `pack`, `serve`
- Compare and plan: `compare-rev`, `inspection-plan`
- Receive results: `inspection-plan-release-record`, `inspection-result-normalize`

`fcad help <command>` shows complete usage, lifecycle, audience, workflow, runtime class, replacement metadata, and safety boundary. `fcad help --all` groups every command under stable, beta, experimental, maintainer, compatibility, deprecated-route, and internal sections. Hidden commands remain directly invokable.

## Current inventory

- Stable: the 12 default commands plus `validate-config`, `migrate-config`, and `help`.
- Beta: `fem`, `tolerance`, `report`, `dfm`, `review`, `process-plan`, `quality-risk`, `evidence-graph`, `stabilization-review`, `generate-standard-docs`, `validate`, and `analyze-part`.
- Experimental: `line-plan`, `investment-review`, `design`, and `sweep`.
- Maintainer: `closeout-package`, the evidence-readiness audit/materializer/journal family, the authoritative inspection-evidence control family, and the Stage 5B helper family.
- Compatibility: `readiness-report`; `readiness-report --review-pack` remains available, while the config-positional route is deprecated.
- Internal: `ingest`, `quality-link`, and `review-pack` orchestration primitives.

The exact list must be read from the manifest rather than duplicated into code. This document summarizes policy and user navigation only.

## Revision-lineage policy

`--proof-lineage` is an opt-in policy flag, not a lifecycle promotion. Supported
review, readiness, inspection-plan, standard-doc, and pack entrypoints carry the
effective policy and exact lineage through their artifacts and tracked jobs.
Commands without a complete authoritative-input contract reject the flag before
opening outputs; they do not silently downgrade to legacy behavior. Existing
command lifecycle, default-help visibility, and legacy invocations are
unchanged. See [revision-lineage proof mode](./revision-lineage-proof-mode.md)
for the supported chain and hold conditions.

## Compatibility and deprecation routes

- `readiness-pack --review-pack <review_pack.json>` is the canonical readiness entrypoint.
- `readiness-report --review-pack <review_pack.json>` remains compatible.
- `readiness-report <config.toml|json>` remains functional, prints an exact non-canonical warning, and points to `readiness-pack --review-pack`; no removal version is announced.
- `fcad serve` starts Studio and the Local API. `fcad serve --legacy-viewer` and `npm run serve:legacy` remain compatibility-only.
- `mfg-agent` remains an alias for `fcad`.
- Natural-language `design` remains experimental.
- Existing Stage 5B helpers and doctors remain maintainer-facing and directly invokable.
- `readiness-report --review-pack` can opt into proof mode; the config-positional compatibility route cannot.

No command is removed by lifecycle classification. Lifecycle controls default presentation and migration guidance, not dispatch reachability.
