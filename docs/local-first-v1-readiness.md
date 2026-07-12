# Local-first v1 readiness

## Assessment

### Software-ready

The local product contract is implemented around three workflows: create/import and review, compare revisions and plan inspection, and receive/normalize completed native results. CLI lifecycle/help, Studio guidance, and deterministic artifact-driven acceptance are covered by repository tests. Final readiness still depends on the exact validation and PR evidence recorded for the final stacked head; passing software acceptance does not prove physical inspection or platform parity.

### Evidence-held

All five canonical packages remain `needs_more_evidence` with `hold_for_evidence_completion`, and genuine canonical `inspection_evidence` remains missing. Acceptance inputs are synthetic, non-production, checksum-bound software fixtures. No fixture, generated QA result, plan, release record, or normalization report can satisfy inspection evidence.

### Release-not-published

No Local-first v1 tag, GitHub release, deployment, canonical release regeneration, or artifact upload is authorized or performed by this work. Draft PRs are review units only.

## Capability status

| Area | Assessment |
| --- | --- |
| Primary workflows | Implemented in README, default help, and Studio Console |
| Command lifecycle | Complete in the shared manifest; 12 default rows, full `help --all` inventory |
| Result handoff | CLI-only raw source; maximum `ready_for_quarantine_review` |
| Artifact-driven acceptance | Implemented with fixed time, SHA-256 inventory, and canonical immutability checks |
| Hosted CI | Must be confirmed from final PR checks |
| Live FreeCAD runtime | Separate self-hosted macOS boundary; not required by artifact acceptance |
| Canonical evidence | Held; genuine completed inspection evidence missing |
| Publication | Not published |

## Known external dependencies and blockers

- Genuine completed physical, supplier, lab, or QA inspection records require external collection and human review.
- Evidence authorization, attachment, and readiness regeneration require separate explicit authority.
- Linux, Windows native, and WSL runtime paths remain compatibility paths.
- A release requires successful PR review/checks and separate publication authorization.

## Non-goals retained

The candidate adds no generic CMM claim, vendor adapter, QIF/XLSX/PDF/image/archive parser, generalized BREP matching, AI acceptance decision, browser supplier-file upload, new Studio tab, new Stage 5B doctor, tag, release, deployment, or production artifact upload.

## Optional post-v1 expansions

Future work may add a separately reviewed server-controlled source-reference architecture, genuine-sample vendor adapters, broader runtime validation, or release automation. None is required to preserve the current Local-first software contract.
