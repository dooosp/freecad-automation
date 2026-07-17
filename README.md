# FreeCAD Automation

FreeCAD Automation turns FreeCAD configs and existing CAD files into traceable manufacturing review, revision-impact, inspection-planning, and evidence-onboarding artifacts. It is for engineers and reviewers who need a local, auditable path from design input to reviewable outputs without treating generated analysis as physical inspection evidence.

## Choose a workflow

| Goal | Start with | Primary commands | Result |
| --- | --- | --- | --- |
| Create or import and review a design | config, STEP, FCStd, or an existing review artifact | `check-runtime`, `create`, `draw`, `inspect`, `review-context`, `readiness-pack`, `pack`, `serve` | model/drawing or import diagnostics, review pack, readiness report, and package artifacts |
| Compare revisions and plan inspection | baseline and candidate review packs | `compare-rev`, `inspection-plan` | revision impact, reinspection requirements, inspection plan, checksheet, request, and blank result template |
| Receive and normalize completed inspection results | a human-released plan plus an externally completed native CSV | `inspection-plan-release-record`, `inspection-result-normalize` | checksum-bound execution release and an untrusted result normalization no higher than `ready_for_quarantine_review` |

Run `fcad --help` for this guided surface, `fcad help <command>` for one complete contract, and `fcad help --all` for beta, experimental, maintainer, compatibility, deprecated-route, and internal commands. The authoritative workflow guide is [docs/product-workflows.md](./docs/product-workflows.md), and every public command lifecycle is defined in [docs/command-lifecycle.md](./docs/command-lifecycle.md) from the shared command manifest.

Commands that create, draw, inspect live CAD, run FEM/tolerance, or generate runtime-backed reports need a working FreeCAD runtime; `fcad check-runtime` is the safe first check. Review-pack, revision-impact, inspection-plan, release-record, and result-normalization operations are artifact-driven and do not launch FreeCAD.

Readiness is a software review decision derived from explicit artifacts. `needs_more_evidence` and `hold_for_evidence_completion` remain correct while genuine inspection evidence is missing. Plans, release records, blank templates, normalization reports, generated CAD/drawing/QA values, CI output, and synthetic fixtures are not inspection evidence.

Safe read-only orientation includes `fcad --help`, `fcad help --all`, `fcad check-runtime`, reading checked-in package artifacts, and opening Studio. Commands that write review, readiness, standard-document, release-bundle, evidence, authorization, or attachment outputs should be run only with an explicit output path and the authority required by that command contract.

The implementation still has two runtime layers:

- a runtime-backed CLI for CAD, TechDraw, FEM, tolerance, inspection, and reporting
- a plain-Python/Node manufacturing-review layer for DFM, process planning, readiness review, revision impact, inspection planning, and result handoff

Validation snapshot:

- maintainer-local macOS checks cover FreeCAD 1.1.x for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, narrow `tolerance --csv`, and `report`
- hosted CI runs source hygiene plus explicit fast lanes: `check:source-hygiene`, `test:node:contract`, `test:node:integration`, `test:snapshots`, `test:studio-browser-smoke`, and `test:py`; hosted CI does not install or launch FreeCAD
- repository-owned runtime CI is the `FreeCAD Runtime Smoke (self-hosted macOS)` workflow for real `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, narrow `tolerance --csv`, and `report`; PR runtime smoke runs only after hosted fast lanes pass for a same-repository head
- experimental or not yet automated for live FreeCAD execution on Windows native, WSL -> Windows FreeCAD, and Linux; those paths remain compatibility paths, not equal-maturity claims

Run `fcad check-runtime` first on any new machine and before troubleshooting a FreeCAD-backed failure.

Execution model: `bin/fcad.js -> lib/runner.js -> scripts/*.py -> scripts/_bootstrap.py -> import FreeCAD` for the runtime-backed commands. The manufacturing-review layer uses the same configs and artifacts but often runs under plain `python3` without launching FreeCAD.

Config lifecycle:

- user-facing configs are now treated as `config_version = 1`
- unversioned configs still load, but `fcad` emits deprecation warnings when legacy fields are detected
- new checked-in examples should be explicit canonical v1 unless they intentionally exist as compatibility fixtures
- `fcad validate-config <path>` validates user-facing config shape and migration state
- `fcad migrate-config <path> [--out <file>]` writes a versioned config plus a change summary
- supported config fields, compatibility aliases, and real example references are documented in [docs/config-schema.md](./docs/config-schema.md)

## Start Here

For a first local verification:

```bash
npm ci
npm link
fcad check-runtime
npm run test:node:contract
npm run test:node:integration
npm run test:snapshots
npm run test:runtime-smoke
```

If you are reviewing the repository on GitHub:

1. Start with the [project closeout status](./docs/project-closeout-status.md) and the [canonical example library](./docs/examples/README.md) for the current CAD publish/review package route.
2. Pick one of the five canonical packages and read its package README plus `readiness/readiness_report.json`; that JSON is the readiness source of truth for standard docs and release packaging.
3. Read the current status honestly: all five canonical packages are `needs_more_evidence` with gate decision `hold_for_evidence_completion` because `inspection_evidence` remains missing.
4. Treat linked quality/drawing evidence as review evidence only. It can close `quality_evidence`, but quality/drawing evidence does not satisfy `inspection_evidence`.
5. Inspect the package artifacts in place: `review/review_pack.json`, `readiness/readiness_report.json`, `standard-docs/`, `release/`, and any package `reopen-notes.md` or deterministic reopen fixture.
6. Use Studio for read-only canonical package cards, allowlisted artifact preview, and tracked job/artifact reopen. The checked-in canonical packages remain docs-package artifacts, not arbitrary local file imports.
7. For Stage 5B evidence acquisition and review, use the [Stage 5B evidence request packet](./docs/stage-5b-evidence-request-packet.md) when asking a supplier, lab, QA reviewer, or physical inspector for real completed records. Prepare the ignored local inbox with `fcad stage5b-evidence-source-kit --package <package-slug>`, then place received records only under `local/stage5b-candidate-evidence-inbox/<package-slug>/`. Run `fcad stage5b-evidence-source-preflight --package <package-slug> --source local/stage5b-candidate-evidence-inbox/<package-slug>/received-inspection-evidence.json --out local/stage5b-candidate-evidence-inbox/<package-slug>/source-preflight-report.json` to verify the file exists, is ignored, is not tracked, has completed-inspection fields, and has no PII, private URLs, absolute paths, tokens, secrets, screenshots, CI artifacts, docs examples, templates, fixtures, CAD/generated values, readiness reports, or surrogate artifacts. Source preflight is acquisition/preflight only: `ready_for_stage5b_review` does not attach evidence, promote evidence, regenerate canonical readiness, or mark packages ready. After source preflight, run `fcad stage5b-evidence-review-dry-run --package <package-slug> --source local/stage5b-candidate-evidence-inbox/<package-slug>/received-inspection-evidence.json --out-dir output/stage5b-review-dry-run` to chain preflight, redaction planning, review-scoped candidate preparation, candidate gate, intake/dry-run/audit planning, and readiness-held reporting without attaching evidence. Use `--fixture` only for ignored synthetic non-evidence orchestration tests. Before any future canonical mutation, use the [Stage 5B attachment authorization record](./docs/stage-5b-attachment-authorization-record.md) as control metadata to confirm the accepted real candidate gate report, redaction/privacy review, provenance/reviewer traceability, package/part/revision mapping, intake/dry-run/audit review, explicit human authorization, exact later task boundary, and readiness-held truth. Then run `fcad stage5b-evidence-attachment-controller --review-manifest output/stage5b-review-dry-run/stage5b_evidence_review_dry_run_manifest.json --authorization-record <authorization-record.json> --out-dir output/stage5b-attachment-controller --dry-run` to write one fail-closed attachment-control manifest with pass/hold gates, exact blockers, next commands, evidence boundaries, and readiness-held status. The controller still does not attach evidence, promote evidence, regenerate canonical readiness, or mark packages ready. Then run `fcad stage5b-evidence-audit --out-dir <dir>` only when authorized to write a non-mutating audit bundle containing `intake_report.json`, `promotion_dry_run_manifest.json`, `stage5b_audit_manifest.json`, and `stage5b_audit_summary.md`. Add `--include-github` only when you want bounded public GitHub discovery across issues, PR/comments, releases/assets, workflow artifact metadata, and HTTPS GitHub/GitHubusercontent allowlisted public links referenced from repo docs or GitHub discussion surfaces. Studio Review can queue the same audit as a tracked local `stage5b-evidence-audit` job through `/api/studio/jobs`; the browser may only choose `include_github`, while the server creates the job artifact output directory and registers the intake report, promotion dry-run manifest, audit manifest, and markdown summary for tracked artifact preview. Studio can run `inspection-evidence-intake` as a tracked local job; the report is registered as an `inspection-evidence.intake-report` artifact and intake reports are discovery/review artifacts only. Studio Review can also queue `inspection-evidence-promotion-dry-run` from the latest or selected tracked intake report artifact. Intake can validate JSON contract files, explicit CSV/TSV/Markdown inspection tables, and TXT inspection tables, including allowlisted files found inside safety-checked ZIPs, but those candidates remain discovery-only and must enter quarantine with an authoritative envelope; direct `review-context` attachment is disabled. For the lower-level chain, `fcad inspection-evidence-intake --out <report.json>` still emits the standalone intake report. The audit bundle runs intake first, runs `fcad inspection-evidence-promotion-dry-run --intake-report <dir>/intake_report.json --out <dir>/promotion_dry_run_manifest.json` from that produced report, and consolidates searched source classes, accepted/rejected counts, GitHub skips, blockers, next safe commands, and canonical readiness-held truth. If the report finds no genuine validated attachment-ready evidence, the dry-run and audit manifest must say no promotion can run and readiness remains held. Do not ask a human to type measurement values. Do not treat synthetic fixtures or generated CAD/drawing/readiness outputs as package inspection evidence. Ignored inbox files, source preflight reports, review dry-run manifests, attachment-control manifests, candidate gate reports, authorization records, request packets, docs, diagnostics, schemas, intake/dry-run/audit outputs, screenshots, comments, PR bodies, release bundles, CAD-generated measurements, CI/GitHub metadata, generated examples, and collection guides are also not package inspection evidence.

The production attachment contract is now stricter than those legacy discovery/dry-run helpers: a discovered candidate must pass `inspection-evidence-quarantine`, `inspection-evidence-validate`, a checksum-bound `inspection-evidence-authorize`, and `inspection-evidence-attach`. `review-context` then requires the immutable `--evidence-attachment-record`, and readiness requires a second authorization through `inspection-evidence-regenerate-readiness`. The legacy placeholder `--inspection-evidence <PATH_TO_COMPLETED_REAL_JSON>` is never sufficient by itself and must not point at a raw candidate. Read the [authoritative onboarding contract](./docs/inspection-evidence-contract.md). Discovery never emits an attachment-ready candidate or direct canonical command.

Do not use `tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json` as package evidence. It and every fixture under `tests/fixtures/inspection-evidence-onboarding/` are synthetic test material; copying or renaming them never makes them package evidence.

When no genuine completed record exists but maintainers need to prove automation readiness, run the CLI-only surrogate lane with `fcad stage5b-surrogate-inspection-validation --out-dir <dir> [--package <canonical-package-slug>]`. It writes synthetic/surrogate/non-evidence records from repo-local specs only, validates parser/redaction/mapping/gate/audit behavior, and must still report `Inspection evidence attached: no` and `Canonical readiness remains held: yes`. Surrogate validation artifacts, synthetic pipeline fixtures, generated CAD/spec/docs/CI values, and similar values are not package inspection evidence and cannot unlock readiness.

For the complete fixture-only Stage 5B wiring check, use `fcad stage5b-evidence-pipeline-doctor --package <package-slug> --out-dir output/stage5b-evidence-pipeline-doctor`. The safe chain is source-kit -> source-preflight -> review-dry-run -> attachment-controller -> pipeline-doctor -> later explicit real attachment/regeneration goal. The doctor runs only repo-local fixture/surrogate/non-evidence inputs, writes ignored `output/` control artifacts, expects the attachment controller to fail closed, and keeps canonical readiness at `needs_more_evidence` / `hold_for_evidence_completion`. Only genuine completed physical/supplier/lab/QA inspection records can satisfy `inspection_evidence`; after one is received, start a separate explicit real evidence attachment/regeneration goal.

To assess what must be reviewed or reinspected after a design change, use the additive `fcad compare-rev ... --impact-out output/revision-impact/revision_impact_report.json` workflow. It compares stable normalized engineering identities, assesses existing evidence applicability without mutating evidence, and embeds future reinspection work without regenerating readiness. Read [Revision Impact and Reinspection Planning](./docs/revision-impact-and-reinspection.md) for the deterministic policy, supported inputs, Studio flow, and explicit safety boundaries.

For the browser path, read the [Studio first-user walkthrough](./docs/studio-first-user-walkthrough.md). It explains canonical package cards, safe artifact preview, release bundle boundaries, and why readiness remains held until genuine `inspection_evidence` exists. For maintainer operation of the CLI/API/Studio Stage 5B chain, read the [Stage 5B operational runbook](./docs/stage-5b-operational-runbook.md). For supplier/lab/QA request wording before the candidate gate, use the [Stage 5B evidence request packet](./docs/stage-5b-evidence-request-packet.md). For future human sign-off metadata before canonical attachment, use the [Stage 5B attachment authorization record](./docs/stage-5b-attachment-authorization-record.md). For CI required-check names, self-hosted smoke boundaries, branch-protection expectations, source hygiene, and release-publication guidance, read the [CI governance note](./docs/ci-governance.md). For maintainer planning around future package generation, read the [canonical package generation workflow](./docs/canonical-package-generation-workflow.md). For DFM and readiness boundaries, read the [DFM and readiness guide](./docs/dfm-readiness-guide.md). For the final non-inspection software milestone summary, read the [final non-inspection software closeout](./docs/final-non-inspection-software-closeout.md). For the final maintainer freeze handoff, read the [final maintainer handoff](./docs/final-maintainer-handoff.md). For the Stage 5B automation summary, read the [Stage 5B automation closeout status](./docs/stage-5b-automation-closeout-status.md). For the release-candidate closeout and gap truth after PR #153, read the [release candidate closeout gap ledger](./docs/release-candidate-closeout-gap-ledger.md). For the Stage 5D feature expansion summary, read the [Stage 5D feature expansion closeout](./docs/stage-5d-feature-expansion-closeout.md). For the Stage 5E quality hardening summary, read the [Stage 5E quality hardening status](./docs/stage-5e-quality-hardening-status.md).

## First-user CLI recipe: inspect a canonical package

Use this recipe when you want to inspect checked-in canonical package artifacts without regenerating anything. The canonical package index is [`docs/examples/README.md`](./docs/examples/README.md); the example below uses `quality-pass-bracket`.

```bash
ls docs/examples/quality-pass-bracket
cat docs/examples/quality-pass-bracket/readiness/readiness_report.json
cat docs/examples/quality-pass-bracket/review/review_pack.json
ls docs/examples/quality-pass-bracket/standard-docs
ls docs/examples/quality-pass-bracket/release
```

`readiness/readiness_report.json` is the source of truth for the checked-in package. Today the status remains `needs_more_evidence`, the gate decision remains `hold_for_evidence_completion`, and `inspection_evidence` is still missing. Linked quality/drawing evidence is review evidence only; quality/drawing evidence does not satisfy `inspection_evidence`.

Regenerate later only when you are intentionally updating package artifacts, or when completed real inspection evidence exists and you are deliberately refreshing the review/readiness chain. These commands write new artifacts, so do not run them just to inspect the checked-in package:

```bash
fcad review-context \
  --model docs/examples/quality-pass-bracket/cad/quality_pass_bracket.step \
  --create-quality docs/examples/quality-pass-bracket/quality/quality_pass_bracket_create_quality.json \
  --drawing-quality docs/examples/quality-pass-bracket/quality/quality_pass_bracket_drawing_quality.json \
  --drawing-qa docs/examples/quality-pass-bracket/quality/quality_pass_bracket_drawing_qa.json \
  --drawing-intent docs/examples/quality-pass-bracket/drawing/quality_pass_bracket_drawing_intent.json \
  --feature-catalog docs/examples/quality-pass-bracket/drawing/quality_pass_bracket_feature_catalog.json \
  --inspection-evidence docs/examples/<package>/inspection/inspection_evidence.json \
  --attachment-authorization docs/examples/<package>/inspection/inspection_evidence_authorization.json \
  --evidence-attachment-record docs/examples/<package>/inspection/inspection_evidence_attachment.json \
  --part-id <INSPECTED_SUBJECT_IDENTIFIER> \
  --revision <AUTHORITATIVE_PACKAGE_REVISION> \
  --out docs/examples/<package>/review/review_pack.json
fcad inspection-evidence-regenerate-readiness \
  --attachment-record docs/examples/<package>/inspection/inspection_evidence_attachment.json \
  --authorization <READINESS_AUTHORIZATION_JSON> \
  --review-pack docs/examples/<package>/review/review_pack.json \
  --out docs/examples/<package>/readiness/readiness_report.json
fcad generate-standard-docs docs/examples/quality-pass-bracket/config.toml --readiness-report <UPDATED_READINESS_REPORT_JSON> --out-dir <UPDATED_STANDARD_DOCS_DIR>
fcad pack --readiness <UPDATED_READINESS_REPORT_JSON> --out <UPDATED_RELEASE_BUNDLE_ZIP>
```

Only use the three canonical inspection inputs after the quarantine, validation,
authorization, and attachment operations have created and verified them. A raw
or copied JSON plus an authorization file is insufficient. Do not use fixtures,
collection guides, ignored inbox paths, symlinks, generated CAD/drawing/quality,
readiness, release, screenshot, CI, QIF-lite, or review artifacts as evidence.

Studio supports read-only canonical package cards and allowlisted artifact preview through the local API. Tracked job/artifact reopen remains separate, and checked-in canonical package discovery is not arbitrary local file import.

Older portfolio and case-study material is still useful after the canonical route is clear:

- [Infotainment production readiness case study](./docs/portfolio/infotainment-production-readiness-case.md)
- [Checked-in infotainment example artifact set](./docs/examples/infotainment-display-bracket/README.md)
- [Parameter sweep gallery](./docs/examples/parameter-sweep-gallery.md)
- [Korea vs Mexico stabilization example](./docs/examples/infotainment-display-bracket/stabilization-comparison.md)
- [Before-vs-after improvement case](./docs/portfolio/before-after-improvement-case.md)

## Test Lanes

- `npm run test:node:contract`: fast hosted-safe Node contracts for config/runtime path/invocation boundaries plus the non-mutating Stage 5B no-evidence/audit/surrogate/source-preflight CLI smoke
- `npm run test:stage5b:no-evidence`: focused local non-production CLI lane for the Stage 5B no-evidence path across source preflight, review dry-run orchestration, intake, promotion dry-run, audit, surrogate inspection validation, and the fixture-only pipeline doctor
- `npm run test:stage5b:pipeline-doctor`: focused fixture-only guard for `stage5b-evidence-pipeline-doctor`
- `npm run test:node:integration`: fast hosted-safe Node integration checks for local API/studio bridge routes, browserless studio and legacy serve smoke, sweep, draw/report service wiring, and rule profiles
- `npm run test:snapshots`: normalized SVG/report snapshot regressions
- `npm run test:studio-browser-smoke`: Chrome/CDP Studio browser smoke for shell routing, canonical package cards, safe preview, and release bundle non-action boundaries without FreeCAD runtime execution; it runs locally and in the hosted Automation CI Studio browser smoke lane
- `npm run test:v1:acceptance`: deterministic synthetic non-production acceptance for review, revision/inspection planning, and CLI-only result normalization with fixed-time artifact hashes and canonical immutability checks
- `npm run test:py`: Python 3.11+ lane for non-runtime Python and CLI-adjacent regressions
- `npm run test:runtime-smoke`: real FreeCAD-backed smoke for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, narrow `tolerance --csv`, and `report`

Deeper runtime-backed suites are available as `npm run test:runtime:model`, `test:runtime:drawing`, `test:runtime:analysis`, `test:runtime:report`, `test:runtime:integration`, and `test:runtime:full`.

Full details, workflow mapping, and local commands live in [docs/testing.md](./docs/testing.md).
Exact hosted check names, branch-protection expectations, self-hosted runtime smoke governance, and release-publication boundaries live in [docs/ci-governance.md](./docs/ci-governance.md).

For a top-level maintainer handoff check after the recent PR train, run `npm run maintainer:doctor -- --clean`. It runs or verifies the evidence/readiness maintainer audit, including PR #170 evidence graph/runtime fingerprint/QIF-lite coverage, records a local maintainer decision journal hold entry, checks source hygiene, the Stage 5B pipeline doctor, the release dry-run doctor, node contract discoverability, docs/source-of-truth guards, generated output policy, raw inbox tracking, workflow/check-name drift, and overclaim guards. It writes `output/maintainer-doctor/maintainer_doctor_report.json`; the report is local ignored output and records that Stage 5B remains held, no real evidence is attached, release publication has not happened, CI governance docs are present, and runtime smoke is hosted/self-hosted guidance rather than production proof.

For a fresh-clone maintainer bootstrap audit, run `npm run bootstrap:doctor -- --clean`. It validates `npm ci`, local CLI help, source hygiene, the maintainer doctor, the release dry-run doctor, the Stage 5B pipeline doctor, documented npm script names, docs/local-state alignment, generated-output policy, raw inbox tracking, and sensitive-data leakage guards. It writes `output/bootstrap-doctor/bootstrap_doctor_report.json` plus local ignored nested doctor outputs; it does not publish, tag, upload artifacts, attach evidence, regenerate canonical readiness, change GitHub settings, call production, or require secrets.

`Maintainer Doctors (hosted schedule)` is the manual/weekly governance check
that runs the established local-only doctors on a hosted runner. It is not
release approval, production observation, evidence attachment, or readiness
proof, and it does not upload doctor reports as CI artifacts.

For a release-bundle rehearsal that stays local and ignored, run `npm run release:dry-run:doctor` followed by `npm run check:source-hygiene`. The doctor writes only under `output/release-dry-run-doctor/`; it does not create tags, publish a GitHub release, upload artifacts, attach evidence, regenerate canonical readiness, or mutate checked-in package artifacts. The dry-run also writes a package-scoped `evidence_readiness_audit.json`, a `maintainer_decision_journal.json` hold record, PR #170 artifact coverage counts, and a local `release_bundle_artifact-manifest.json` in ignored output as CLI provenance; do not commit or upload them.

## Quality Fixtures

The repository now keeps two explicit quality fixtures with different purposes:

- [`configs/examples/ks_bracket.toml`](./configs/examples/ks_bracket.toml): intentional fail-demo for geometry, drawing-quality, and DFM blockers. Use it when you want to prove the gates still catch real issues. Its strict create/draw paths are expected to fail, and its report should stay `Ready for manufacturing review: No`.
- [`configs/examples/quality_pass_bracket.toml`](./configs/examples/quality_pass_bracket.toml): strict-pass happy path for the current quality stack. Use it when you want to prove create quality, drawing quality, DFM, and report readiness can all pass without weakening the gates.

Treat `ks_bracket` as the blocker-rich example and `quality_pass_bracket` as the clean regression target; they are not interchangeable.

## Supported And Runtime Coverage Scope

- maintainer-local coverage path: macOS + `FreeCAD.app` 1.1.x for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, narrow `tolerance --csv`, and `report`
- repository-owned runtime CI path: self-hosted macOS smoke for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, narrow `tolerance --csv`, and `report`, sequenced after hosted fast lanes for same-repository PR heads
- hosted CI path: Node contract, Node integration, snapshots, Studio browser smoke, and Python lanes without installing or launching FreeCAD
- compatibility paths only today: Windows native, WSL -> Windows FreeCAD, and Linux runtime execution

## Target Use Cases

- parametric 3D model generation from TOML configs
- engineering drawing generation through TechDraw
- model inspection, FEM, tolerance, and PDF report generation
- manufacturability screening, process-plan support, and readiness reporting
- runtime-informed launch stabilization review from supplied runtime JSON
- draft generation of production-engineering standard documents

## Production Engineering Layer

The repository also includes production-engineering workflows and infotainment-oriented examples, but those should be read as decision-support tooling layered on top of the core automation pipeline.

- Structure review: check wall thickness, connector-side clearance, fastening accessibility, and mounting-boss layout before tooling freeze.
- Process design support: infer rough process sequence, inspection points, and likely bottleneck candidates from geometry and manufacturing assumptions.
- Launch/stabilization support: compare supplied CT, FPY, rework, scrap, downtime, and changeover signals against planning assumptions.
- Quality-risk visibility: surface critical dimensions, quality gates, traceability capture points, and inspection-sensitive features.
- Standard-document support: generate draft process flow, control plan, checksheet, work instruction, and PFMEA seed artifacts.

Outputs are heuristic engineering aids. They are not full production-line simulations or a substitute for engineering sign-off.

## DELMIA-Adjacent Manufacturing DX Prototype

This repository can also be presented as a DELMIA-adjacent manufacturing DX portfolio prototype for digital manufacturing, virtual twin review, MES/APS/SCM-aligned context modeling, and AI-assisted manufacturing review guidance.

- It stays additive to the existing FreeCAD + manufacturing-review stack.
- It does **not** claim official DELMIA or 3DEXPERIENCE API integration.
- New portfolio-facing materials live under:
  - [`docs/delmia-alignment/`](./docs/delmia-alignment/)
  - [`docs/training/`](./docs/training/)
  - [`docs/research/`](./docs/research/)
  - [`docs/case-studies/`](./docs/case-studies/)
  - [`configs/examples/manufacturing/`](./configs/examples/manufacturing/)

The intent is to show how the repo's existing review, process-planning, line-planning, quality-linkage, and readiness artifacts can be reframed for manufacturing DX conversations without overclaiming product integration.

## Codex Multi-Agent Prompt Workflow

If you want Codex to drive the legacy CAD and drawing pipeline as a small orchestrated agent team, use:

- [Workflow guide](./docs/codex-multi-agent-workflow.md)
- [Prompt pack](./prompts/multi-agent/)
- [Starter generated config](./configs/generated/cnc_motor_mount_bracket.toml)

Recommended stable starting flow:

```bash
fcad create configs/generated/cnc_motor_mount_bracket.toml
fcad draw configs/generated/cnc_motor_mount_bracket.toml --bom
fcad dfm configs/generated/cnc_motor_mount_bracket.toml --strict
fcad tolerance configs/generated/cnc_motor_mount_bracket.toml --recommend
```

This keeps Codex focused on the existing `config -> create -> draw -> dfm -> tolerance/report` loop without changing the repository runtime model.

## Command Surface

Run `fcad check-runtime` before any FreeCAD-backed command on a new machine and as the first troubleshooting step for runtime-backed failures. It prints searched candidate paths, the selected runtime, active env overrides, detected FreeCAD/Python details, command classes, and remediation guidance. Add `--json` when a tool needs the same machine-readable runtime contract that the local API exposes from `GET /health`, or `--fingerprint-out <runtime_fingerprint.json>` when a local reproducibility snapshot is needed.

### Command Classification

| Class | Commands | Runtime boundary |
| --- | --- | --- |
| Diagnostics | `check-runtime` | does not require FreeCAD to be present |
| FreeCAD-backed | `create`, `draw`, `inspect`, `fem`, `tolerance`, `report` | requires a working FreeCAD runtime |
| Plain-Python / non-FreeCAD | `dfm`, `review`, `process-plan`, `line-plan`, `quality-risk`, `investment-review`, `readiness-pack`, `readiness-report`, `pack`, `closeout-package`, `evidence-graph`, `evidence-readiness-audit`, `evidence-artifacts-materialize`, `maintainer-decision-journal`, `inspection-evidence-intake`, `inspection-evidence-quarantine`, `inspection-evidence-validate`, `inspection-evidence-authorize`, `inspection-evidence-attach`, `inspection-evidence-regenerate-readiness`, `inspection-evidence-promotion-dry-run`, `inspection-plan`, `inspection-plan-release-record`, `inspection-result-normalize`, `stage5b-evidence-audit`, `stage5b-evidence-review-dry-run`, `stage5b-evidence-attachment-controller`, `stage5b-evidence-pipeline-doctor`, `stage5b-evidence-source-kit`, `stage5b-evidence-source-preflight`, `stage5b-surrogate-inspection-validation`, `stabilization-review`, `generate-standard-docs`, `ingest`, `quality-link`, `review-pack`, `review-context`, `compare-rev`, `validate`, `validate-config`, `migrate-config`, `serve` | runs without launching FreeCAD; canonical readiness packaging consumes `review_pack.json`, while inspection evidence uses checksum-bound plan release, untrusted result normalization, quarantine, and separately authorized attachment/readiness boundaries so ordinary readiness packaging remains held on unverified claims |
| Mixed / conditional | `analyze-part`, `design`, `sweep` | `analyze-part` can inspect CAD through FreeCAD when needed; `design` ends by calling `create`; `sweep` stays inside the existing `create` / `cost` / `fem` / `report` service wrappers selected by the matrix file |

### Production-Readiness Commands

```bash
fcad review <config.toml|json>
fcad process-plan <config.toml|json>
fcad process-plan --review-pack <review_pack.json>
fcad line-plan <config.toml|json>
fcad quality-risk <config.toml|json>
fcad quality-risk --review-pack <review_pack.json>
fcad investment-review <config.toml|json>
fcad readiness-pack --review-pack <review_pack.json> --out <readiness_report.json>
fcad readiness-report --review-pack <review_pack.json>
fcad readiness-report <config.toml|json>   # legacy compatibility / non-canonical
fcad pack --readiness <readiness_report.json> --out <release_bundle.zip>
fcad closeout-package <canonical-package-slug> --mode software-demo --out-dir output
fcad evidence-graph --package <canonical-package-slug> --review-pack <review_pack.json> --readiness <readiness_report.json> --out <evidence_graph.json>
fcad evidence-readiness-audit --out-dir output/evidence-readiness-audit --clean
fcad evidence-artifacts-materialize [--package <canonical-package-slug>] [--generated-at <iso8601>] [--dry-run] [--force]
fcad maintainer-decision-journal [--audit <evidence_readiness_audit.json>] [--decision hold|proceed|exception_requested|exception_approved] [--out-dir output/maintainer-decision-journal]
fcad inspection-evidence-intake [--package <canonical-package-slug>] [--include-github] --out output/inspection-evidence-intake-report.json
fcad inspection-evidence-promotion-dry-run --intake-report output/inspection-evidence-intake-report.json --out output/promotion_dry_run_manifest.json
fcad stage5b-evidence-audit --out-dir output/stage5b-evidence-audit [--include-github]
fcad stage5b-evidence-source-kit [--package <canonical-package-slug>]
fcad stage5b-evidence-source-preflight [--package <canonical-package-slug>] [--source <raw-source.json|csv|tsv>] [--out <report.json>]
fcad stage5b-evidence-review-dry-run --package <canonical-package-slug> [--source <raw-source.json|csv|tsv>] --out-dir output/stage5b-review-dry-run [--fixture]
fcad stage5b-evidence-attachment-controller --review-manifest output/stage5b-review-dry-run/stage5b_evidence_review_dry_run_manifest.json --authorization-record <path-or-url> --out-dir output/stage5b-attachment-controller [--dry-run]
fcad stage5b-evidence-pipeline-doctor [--package <canonical-package-slug>] [--out-dir output/stage5b-evidence-pipeline-doctor]
fcad stage5b-surrogate-inspection-validation --out-dir output/stage5b-surrogate-inspection-validation [--package <canonical-package-slug>]
fcad stabilization-review <config.toml|json> --runtime <runtime.json>
fcad stabilization-review <baseline_readiness_report.json> <candidate_readiness_report.json>
fcad generate-standard-docs <config.toml|json> --readiness-report <readiness_report.json> [--out-dir <dir>]
```

### Evidence graph

The evidence graph is a read-only review artifact. It links package, review, generated quality, inspection, and readiness artifacts, but it does not attach evidence, regenerate readiness, or mutate canonical package files.

Use `readiness-pack --review-pack ...` or `readiness-report --review-pack ...` for canonical C output. `readiness-report <config>` remains available only as a legacy compatibility route and should not be treated as canonical D-backed readiness provenance.

`stage5b-evidence-source-kit`, `stage5b-evidence-source-preflight`, `stage5b-evidence-review-dry-run`, and `stage5b-evidence-attachment-controller` are local CLI acquisition/review/control helpers, not Studio/API jobs and not attachment paths. They write ignored inbox or review-control materials and classify/plan raw source review while keeping evidence unattached and canonical readiness held.

`stage5b-evidence-pipeline-doctor` is a CLI-only fixture diagnostic, not a Studio/API job and not an attachment path. It proves the safe chain source-kit -> source-preflight -> review-dry-run -> attachment-controller -> pipeline-doctor -> later explicit real attachment/regeneration goal while also running surrogate/non-evidence guards and command/schema/docs/npm/CI/readiness drift checks.

`stage5b-surrogate-inspection-validation` is a local CLI proof lane, not a Studio/API job and not a real evidence intake path. It generates labeled synthetic/surrogate/non-evidence inspection-shaped records from repo-local specs, proves they are accepted only by the surrogate schema, and proves canonical attachment/candidate gates still reject them.

`mfg-agent` is also installed as an alias for the same CLI.

### Review-Pack Commands

```bash
fcad ingest --model <file> [--bom bom.csv] [--inspection inspection.csv] [--quality quality.csv] --out <context.json>
fcad analyze-part <context.json|model.step>
fcad quality-link --context <context.json> --geometry <geometry.json>
fcad review-pack --context <context.json> --geometry <geometry.json>
fcad review-context --model <file> [--bom bom.csv] [--inspection inspection.csv] [--quality quality.csv] [--create-quality create_quality.json] [--drawing-quality drawing_quality.json] [--drawing-qa drawing_qa.json] [--drawing-intent drawing_intent.json] [--feature-catalog feature_catalog.json] [--dfm-report dfm_report.json] [--inspection-evidence inspection_evidence.json --attachment-authorization authorization_record.json --evidence-attachment-record attachment_record.json --part-id <inspected-id> --revision <package-revision>] --out <review_pack.json>
fcad compare-rev <baseline.json> <candidate.json>
```

`review-context` accepts explicit package-side quality/design inputs as before.
For `--inspection-evidence`, it now requires the canonical checksum-bound
authorization and immutable attachment record created by the onboarding flow,
requires explicit part/revision equality, and validates the full chain before
writing any pipeline output. Generated side inputs
never satisfy `inspection_evidence`. Ordinary `readiness-pack` rejects an
inspection-evidence claim; only the separately authorized regeneration command
may consume the verified attachment-bound review pack.

### Imported CAD Bootstrap Lane

Imported STEP / FCStd intake is a bootstrap lane, not reverse-CAD magic.

- Preferred browser entry: Studio on `/` or `/studio`, using the Start workspace import bootstrap gate.
- Local API preview route: `POST /api/studio/import-bootstrap`
- Public goal: bring an existing STEP or FCStd into the review loop safely, quickly, and honestly
- Draft bootstrap artifacts: `import_diagnostics.json`, `bootstrap_summary.json`, `draft_config.toml`, `engineering_context.json`, `geometry_intelligence.json`, `bootstrap_warnings.json`, and `confidence_map.json`
- Canonical downstream lineage remains unchanged: `review-context -> review_pack.json -> readiness-pack/readiness-report --review-pack -> readiness_report.json -> generate-standard-docs -> standard_docs_manifest.json` and `readiness_report.json -> pack -> release_bundle_manifest.json` plus `release_bundle.zip`.

Low-confidence import findings stay visible as warnings and review-needed evidence. The bootstrap gate is designed to capture assumptions, allow human correction, and then hand off into the existing canonical review/readiness flow without inventing a parallel product surface.

### Diagnostics And Runtime-Backed Commands

```bash
fcad check-runtime
fcad check-runtime --json
fcad check-runtime --fingerprint-out <runtime_fingerprint.json>
fcad create <config.toml|json> [--strict-quality]
fcad draw <config.toml|json> [--bom] [--strict-quality] [--fail-under <number>]
fcad report <config.toml|json>
fcad inspect <model.step|fcstd> [--manifest-out <path>]
fcad fem <config.toml|json> [--manifest-out <path>]
fcad tolerance <config.toml|json> [--manifest-out <path>]
fcad dfm <config.toml|json> [--manifest-out <path>]
fcad sweep <config.toml|json> --matrix <matrix.toml|json> [--out-dir <dir>]
```

`report` is still classified as runtime-backed because it runs inside the FreeCAD bundle on macOS even when it falls back from `freecadcmd` to the bundled FreeCAD Python executable.

`--manifest-out <path>` is the provenance escape hatch for stdout-heavy commands. It keeps the default human-readable stdout intact while letting tooling capture a stable manifest alongside `inspect`, `fem`, `tolerance`, or `dfm`.

Major runtime and analysis commands now also emit an additive output manifest named `<base>_manifest.json`. When a command writes a primary artifact, the output manifest is written beside it. When a command is stdout-first and has no primary artifact, the manifest is written beside the input file by default. The legacy `artifact-manifest` contract remains available where already documented, including `--manifest-out`.

`fcad create` also emits an additive `<base>_create_quality.json` report when it exports model artifacts. The create output manifest links that report through `linked_artifacts.quality_json`, and `--strict-quality` exits non-zero only when the quality report finds blocking export issues.

Inside the create-quality report, `generated_shape_geometry` marks measurements captured from the FreeCAD shape that `fcad create` generated before export. `reimported_step_geometry` marks measurements captured only after the exported STEP file is re-imported, so it is STEP round-trip evidence for the exported file, not a replacement source for generated-shape checks. When STEP re-import geometry is unavailable, create-quality records an explicit unavailable STEP geometry state instead of fake measurements; that provenance is separate from package `inspection_evidence`.

`fcad draw` also writes an additive `<base>_drawing_quality.json` summary beside the existing draw sidecars. It aggregates required-dimension coverage, conflict counts, layout overlap signals, BOM consistency, and traceability coverage into one status block. Default draw still completes with warnings, while `--strict-quality` exits non-zero when blocking draw-quality issues remain.

`fcad report` now also writes an additive `<base>_report_summary.json` beside the PDF. The summary keeps the first-page executive decision fields machine-readable:

- `overall_status`: `pass | warning | fail | incomplete`
- `overall_score` when enough scored inputs exist
- `ready_for_manufacturing_review`: `true | false | null`
- `top_risks`
- `recommended_actions`
- `inputs_consumed`
- `artifacts_referenced`
- `blocking_issues`
- `warnings`
- `missing_optional_artifacts`

The PDF first page now mirrors those fields as an executive decision summary. It is intentionally honest about partial data:

- missing create/drawing/DFM decision inputs downgrade readiness to `unknown` / `incomplete`
- missing optional FEM or tolerance artifacts stay visible as `not_run` / `not_available`, never pass
- known upstream create-quality, drawing-quality, or DFM failures are surfaced as blockers instead of being silently repaired by the report step

Representative first-page fields:

```text
Status: FAIL
Score: 78.5
Ready for manufacturing review: No
Top risks: Generated model shape is invalid.; Missing required drawing dimensions: HOLE_DIA.; DFM critical findings: 1.
Recommended actions: Repair the generated model geometry before proceeding to manufacturing review.; Add or map the missing required dimension intent(s): HOLE_DIA.; Increase wall thickness around the drilled feature.
```

`fcad dfm` now keeps the legacy `checks`, `summary`, and `score` fields while also emitting an additive `issues` array for actionable findings. Each non-pass issue can include:

- `rule_id` / `rule_name`
- `severity`: `critical | major | minor | info`
- `status`: `fail | warning | skipped`
- `part_id` / `part_name` and `feature_id` / `feature_type` when known
- `actual_value`, `required_value`, `delta`, and matching units when measurable
- `process`, `material`, `manufacturability_impact`, `suggested_fix`, `confidence`, and `evidence`

Representative actionable DFM issue:

```json
{
  "rule_id": "DFM-01",
  "rule_name": "Minimum wall thickness",
  "severity": "critical",
  "status": "fail",
  "part_name": "thin_wall_part",
  "feature_id": "hole1",
  "feature_type": "hole",
  "actual_value": 0.5,
  "actual_unit": "mm",
  "required_value": 1.5,
  "required_unit": "mm",
  "delta": -1.0,
  "process": "machining",
  "material": "unknown",
  "manufacturability_impact": "Thin walls can distort, chatter, or break during manufacturing and reduce part robustness.",
  "suggested_fix": "Increase wall thickness by at least 1.0 mm by moving hole 'hole1' inward 1.0 mm, reducing its diameter by 2.0 mm, or switching to a process/material profile that supports the current 0.5 mm wall.",
  "confidence": "high",
  "evidence": {
    "measurement": "wall_thickness",
    "hole_id": "hole1",
    "wall_mm": 0.5,
    "threshold_mm": 1.5
  }
}
```

Severity guidance:

- `critical`: likely blocker for the selected manufacturing path
- `major`: manufacturable only with meaningful redesign, process change, or closer review
- `minor`: quality-of-manufacture or robustness improvement recommended
- `info`: context or confidence warning that should be reviewed but is not a direct blocker

See [docs/output-manifest.md](./docs/output-manifest.md) for the unified output-manifest fields, naming rules, and example JSON.

### Parameter Sweep

`fcad sweep` is the initial design-space exploration workflow. It does not create a separate optimization path. Instead, it expands deterministic numeric overrides and executes each variant through the existing service wrappers already used by the CLI.

Current sweep scope:

- numeric leaf overrides only, addressed by paths like `shapes[0].height` or `fem.constraints[1].magnitude`
- discrete `values = [...]` lists or inclusive `range = { start, stop, step }`
- sequential execution with per-variant `effective-config.*` and `result.json`
- aggregate `summary.json` and `summary.csv`
- objective summary for min mass, min cost, and FEM stress-threshold pass/fail when those metrics exist

Worked examples:

- [docs/examples/parameter-sweep-gallery.md](./docs/examples/parameter-sweep-gallery.md)
- [configs/examples/sweeps/ks_bracket_geometry_sweep.toml](./configs/examples/sweeps/ks_bracket_geometry_sweep.toml)
- [configs/examples/sweeps/bracket_fem_load_sweep.toml](./configs/examples/sweeps/bracket_fem_load_sweep.toml)

Example:

```bash
fcad sweep configs/examples/ks_bracket.toml \
  --matrix configs/examples/sweeps/ks_bracket_geometry_sweep.toml \
  --out-dir output/sweeps/ks_bracket_geometry
```

The summary files capture exact per-variant runtime. Treat any time estimates in docs as planning guidance, not repository-verified benchmark claims.

### Config Validation And Migration

```bash
fcad validate-config configs/examples/ks_bracket.toml
fcad validate-config configs/examples/ks_bracket.toml --strict
fcad validate-config configs/examples/ks_bracket.toml --json
fcad migrate-config configs/examples/ks_bracket.toml
fcad migrate-config configs/examples/ks_bracket.toml --out output/ks_bracket.v1.toml
```

`validate-config` checks the user-facing config, reports deprecated fields, and exits non-zero on schema errors. `--strict` also fails when warnings remain.

`migrate-config` writes a versioned config file and prints:

- changed fields applied automatically
- deprecated fields still present for compatibility
- manual follow-up when the migration intentionally keeps a legacy field to avoid breaking older flows

Legacy compatibility warnings currently cover:

- missing `config_version`
- top-level `material` and `process`
- `[[operations]].type` instead of `op`
- legacy `[export] step = true` / `stl = true` flags instead of `formats = [...]`

Upgrade notes:

- canonical v1 keeps `manufacturing.process` and `manufacturing.material` as the preferred home for manufacturing metadata
- legacy top-level `process` and `material` still load today, but migration intentionally keeps them only as compatibility fields
- existing sample configs remain valid inputs because `fcad` auto-migrates them before command execution
- new checked-in examples should default to explicit `config_version = 1` plus canonical fields; use legacy-compatible examples only when they are intentionally covering migration/regression behavior
- use `fcad migrate-config` if you want to check in an explicit v1 config file after reviewing the reported manual follow-up items

The older `fcad validate <plan-file>` command is unchanged and still validates `drawing_plan` artifacts rather than user configs.

### Local API

`fcad serve` now starts a local/dev-first HTTP API backed by the real Node CLI service layer and the existing Python/FreeCAD runtime path. It also makes `FreeCAD Automation Studio` the preferred browser UI on `/`, keeps the direct studio route at `/studio`, and exposes the API info page at `/api`.

```bash
fcad serve
fcad serve 3100
fcad serve 3100 --jobs-dir output/jobs-dev
```

Startup behavior:

- binds to `127.0.0.1` only
- defaults to port `3000`
- stores jobs under `output/jobs` unless `--jobs-dir` is provided
- keeps the existing CLI/runtime execution path: `POST /jobs` schedules work through the same service layer used by the CLI, including `create`, `draw`, `inspect`, `report`, `review-context`, `compare-rev`, `readiness-pack`, `stabilization-review`, `generate-standard-docs`, `pack`, `evidence-readiness-audit`, `inspection-evidence-intake`, `inspection-evidence-promotion-dry-run`, and `stage5b-evidence-audit`
- browser requests to `GET /` now land in `FreeCAD Automation Studio`
- `GET /api` returns the local API info page in HTML, JSON, or plain text depending on `Accept`
- `GET /studio` remains the direct `FreeCAD Automation Studio` route
- if `localhost` resolves to a different listener on your machine, use `http://127.0.0.1:<port>` explicitly

Studio execution model:

- `Preview`: fast request/response work for Model and Drawing. Preview routes are scratch-safe, keep the current workspace state local, and do not create `/jobs` history.
- `Tracked run`: `POST /api/studio/jobs` queues `create`, `draw`, `inspect`, `report`, `review-context`, `compare-rev`, `readiness-pack`, `stabilization-review`, `generate-standard-docs`, `pack`, `evidence-readiness-audit`, `inspection-evidence-intake`, `inspection-evidence-promotion-dry-run`, and `stage5b-evidence-audit` into `/jobs`. Studio `review-context` submissions are source-path based (`context_path` or `model_path`, with optional BOM/inspection/quality/package-evidence/compare paths), not config TOML or generic artifact-ref submissions.
- `Artifact re-entry`: `Artifacts` and `Review` can reopen config artifacts in `Model`, rerun tracked `report` from config-like artifacts, rerun tracked `inspect` from model artifacts, continue `readiness-pack` from canonical `review_pack.json` or `release_bundle.zip`, continue `generate-standard-docs` from canonical readiness inputs or release bundles, continue `pack` from canonical readiness inputs or release bundles, queue `inspection-evidence-promotion-dry-run` from a registered `inspection-evidence.intake-report` artifact, and stage `compare-rev` or `stabilization-review` from selected baseline/candidate canonical artifacts when both sides are present.
- Tracked API/Studio `create` and `draw` jobs write generated outputs under the tracked job artifact directory, regardless of a config-provided export directory. Direct `inspect` accepts only safe repo-relative model paths; Studio inspect re-entry uses a registered `artifact_ref`.
- Browser-visible preview payloads are path-redacted too: tracked job payloads, artifact payloads, example payloads, and drawing preview responses all avoid raw filesystem paths.

AF5 publish/reopen contract:

- `review-context` writes canonical `review_pack.json`.
- `readiness-pack` or `readiness-report --review-pack` consumes `review_pack.json` and writes canonical `readiness_report.json`.
- `generate-standard-docs` consumes `readiness_report.json` plus matching config lineage and writes `standard_docs_manifest.json` with generated document outputs.
- `pack` consumes `readiness_report.json`, optionally `standard_docs_manifest.json`, and writes `release_bundle_manifest.json`, `release_bundle_log.json`, `release_bundle_checksums.sha256`, and `release_bundle.zip`.
- Studio re-entry is tracked job/artifact re-entry through `/jobs`, `/jobs/:id/artifacts`, safe artifact routes, and selected-job deep links. Arbitrary local release-bundle or artifact import into the Package/Artifacts workspace is not part of this contract today; use tracked artifacts or the separate imported-CAD bootstrap lane.

Phase-3 tracked execution model:

| Concern | Public/browser-facing contract | Internal execution contract |
| --- | --- | --- |
| Job request metadata | `GET /jobs` and `GET /jobs/:id` return sanitized request metadata only. Artifact-driven runs expose safe fields such as `artifact_ref`, `source_job_id`, `source_artifact_id`, `source_artifact_type`, and `source_label`. Absolute execution paths are stripped or reduced before they reach the browser. | The raw executor request still persists in each job directory as `request.json` and remains available to the executor, retry flow, and job-store internals. |
| Queue controls | `capabilities.cancellation_supported`, `capabilities.retry_supported`, `links.cancel`, and `links.retry` tell the studio when to show queue actions. | The queue stays in-process and dev-local. There is no distributed worker, forced kill path, or hidden retry daemon. |
| Monitor scope | The shell resumes and polls every queued/running job it knows about, not just a single active run. The jobs badge summarizes active counts, and the jobs center merges monitored jobs with recent history. | Polling still happens one job at a time through `GET /jobs/:id`, and completion routing is derived from persisted artifacts plus the tracked completion action. |

Queue control behavior:

| Job state | `POST /jobs/:id/cancel` | `POST /jobs/:id/retry` |
| --- | --- | --- |
| `queued` | Cancels deterministically before execution starts. Returns `200` with the cancelled job record. | Rejected with `409`. Queued jobs are not retry sources. |
| `running` | Rejected with `409` unless the active executor explicitly reports safe cooperative cancellation support. This phase does not add a forced kill path. | Rejected with `409`. Running jobs are not retry sources. |
| `succeeded` | Rejected with `409`. Terminal successful jobs are immutable history. | Rejected with `409`. Successful jobs are not retry sources. |
| `failed` | Rejected with `409`. Failed jobs stay inspectable as-is. | Accepted. Returns `202` with a new queued job cloned from the original persisted request and `retried_from_job_id` pointing at the source job. |
| `cancelled` | Rejected with `409`. Cancelled jobs stay inspectable as-is. | Accepted. Returns `202` with a new queued job cloned from the original persisted request and `retried_from_job_id` pointing at the source job. |

Jobs center and completion behavior:

- The shell resumes all queued/running jobs returned by `GET /jobs`, then keeps them in a multi-job monitor backed by `GET /jobs/:id`.
- The jobs center surfaces narrow quick actions only: `Open Artifacts`, `Open Review` when the job is reviewable, `Cancel` when `capabilities.cancellation_supported` is true, and `Retry` when `capabilities.retry_supported` is true.
- Completion routing is artifact-aware: `create` and `draw` finish into `Artifacts`; `report` prefers `Review` only when review-ready outputs exist; `inspect` prefers `Review` only when review-family results exist or the completion source family is already review-oriented.
- If a job settles while other jobs are still active, the shell stays on the current workspace and shows a completion notice with deep-link actions instead of forcing a route jump.
- Selected-job deep links are `#artifacts?job=<job-id>` and `#review?job=<job-id>`. Search-param fallback `?job=<job-id>` is accepted when those workspaces reopen directly, but unsupported routes ignore selected-job scope.

Endpoints:

- `GET /`
- `GET /api`
- `GET /health`
- `GET /studio`
- `GET /api/examples`
- `GET /api/canonical-packages`
- `GET /api/canonical-packages/:slug/artifacts/:artifactKey/preview`
- `POST /api/studio/validate-config`
- `POST /api/studio/model-preview`
- `GET /api/studio/model-previews/:id/model`
- `GET /api/studio/model-previews/:id/parts/:index`
- `POST /api/studio/drawing-preview`
- `POST /api/studio/drawing-previews/:id/dimensions`
- `POST /api/studio/jobs`
- `POST /jobs`
- `GET /jobs`
- `GET /jobs/:id`
- `POST /jobs/:id/cancel`
- `POST /jobs/:id/retry`
- `GET /jobs/:id/artifacts`
- `GET /jobs/:id/artifacts/:artifactId/content`
- `GET /artifacts/:jobId/:artifactId`
- `GET /artifacts/:jobId/:artifactId/download`

Supported job types:

- `POST /jobs`: `create`, `draw`, `inspect`, `report`, `review-context`, `compare-rev`, `readiness-pack`, `stabilization-review`, `generate-standard-docs`, `pack`, `evidence-readiness-audit`, `inspection-evidence-intake`, `inspection-evidence-promotion-dry-run`, `stage5b-evidence-audit`
- `POST /api/studio/jobs`: `create`, `draw`, `inspect`, `report`, `review-context`, `compare-rev`, `readiness-pack`, `stabilization-review`, `generate-standard-docs`, `pack`, `evidence-readiness-audit`, `inspection-evidence-intake`, `inspection-evidence-promotion-dry-run`, `stage5b-evidence-audit`
- Studio `review-context` accepts source-file path fields that the local API can resolve (`context_path` or `model_path`, with optional `bom_path`, `inspection_path`, `quality_path`, `create_quality_path`, `drawing_quality_path`, `drawing_qa_path`, `drawing_intent_path`, `feature_catalog_path`, `dfm_report_path`, and `compare_to_path`). Package evidence paths are normalized into review-pack source refs when safe; they do not imply arbitrary local artifact import or inspection evidence. It does not accept `config_toml`, `artifact_ref`, or arbitrary local artifact import on that path.

Endpoint usage:

- `GET /` is the preferred browser entrypoint for the studio shell; JSON and text callers can still use `/` directly
- `GET /api` returns the local API info page and route discovery payload
- `GET /health` returns API liveness plus the same shared runtime diagnostics contract used by `fcad check-runtime --json`
- `GET /api/examples` returns an enveloped `{ api_version, ok: true, examples: [...] }` payload of checked-in example TOML records without repository checkout paths
- `GET /api/canonical-packages` returns the read-only Studio canonical package cards for the five checked-in docs packages: package refs, readiness truth, artifact catalog, evidence-boundary copy, and Studio-boundary copy
- `GET /api/canonical-packages/:slug/artifacts/:artifactKey/preview` returns allowlisted text previews by safe package slug plus artifact key; it does not accept arbitrary local file paths
- `POST /api/studio/model-preview` validates the current TOML and returns preview-only model assets for the Model workspace
- `POST /api/studio/drawing-preview` returns the fast sheet-first drawing preview; `POST /api/studio/drawing-previews/:id/dimensions` preserves the HTTP edit loop for dimension changes while keeping preview-plan files server-side only
- `POST /api/studio/jobs` is the studio bridge route: Model and Drawing submit tracked jobs here, imported-CAD handoff can queue source-path `review-context`, Stage 5B audit/intake/promotion dry-run can queue without browser-provided output paths, and Studio-safe tracked continuation also covers inspect/report re-entry plus compare, readiness, stabilization, docs, and pack jobs from supported artifact references; canonical readiness-backed `generate-standard-docs` can rehydrate a config-like input automatically when the tracked lineage no longer carries a config copy
- `POST /jobs` accepts a JSON job request and returns `202 Accepted` with the queued job record for `create`, `draw`, `inspect`, `report`, `review-context`, `compare-rev`, `readiness-pack`, `stabilization-review`, `generate-standard-docs`, `pack`, `evidence-readiness-audit`, `inspection-evidence-intake`, `inspection-evidence-promotion-dry-run`, and `stage5b-evidence-audit`; direct inspect accepts a safe repo-relative model `file_path` or a registered `artifact_ref`, promotion dry-run accepts only a registered intake artifact reference from Studio or a safe repo-relative `intake_report_path`, evidence/readiness audit jobs accept only server-generated artifact output plus optional package selection, and Stage 5B audit jobs accept only server-generated artifact output plus optional `include_github`
- `GET /jobs` returns recent tracked jobs for shell resume and artifact timeline views
- `GET /jobs/:id` returns the latest status, sanitized browser-visible request metadata, redacted result/manifest summaries, status history, and logical storage metadata
- `POST /jobs/:id/cancel` deterministically cancels a queued job before the executor claims it; running-job cancellation returns a clear conflict unless the active executor explicitly supports safe cooperative stop
- `POST /jobs/:id/retry` creates a new queued tracked job from the original persisted internal request only after the request passes the current job validator, and only when the source job is already `failed` or `cancelled`
- `GET /jobs/:id/artifacts` returns the flattened public artifact list plus redacted manifest data and logical storage file metadata
- `GET /jobs/:id/artifacts/:artifactId/content` is the compatibility alias for older API-shaped artifact opens
- `GET /artifacts/:jobId/:artifactId` opens user-facing browser-safe artifact content inline when supported; HTML artifacts are not served inline
- `GET /artifacts/:jobId/:artifactId/download` forces a download for user-facing artifacts

Request examples:

```bash
curl http://127.0.0.1:3000/health

curl -X POST http://127.0.0.1:3000/jobs \
  -H 'content-type: application/json' \
  -d '{
    "type": "create",
    "config_path": "configs/examples/ks_bracket.toml"
  }'

curl -X POST http://127.0.0.1:3000/jobs \
  -H 'content-type: application/json' \
  -d '{
    "type": "draw",
    "config": {
      "config_version": 1,
      "name": "api_bracket",
      "shapes": [
        { "id": "body", "type": "box", "length": 40, "width": 20, "height": 8 }
      ],
      "drawing": { "views": ["front", "top", "right", "iso"] },
      "export": { "formats": ["step"], "directory": "output" }
    }
  }'

curl -X POST http://127.0.0.1:3000/jobs \
  -H 'content-type: application/json' \
  -d '{
    "type": "review-context",
    "model_path": "output/example.step"
  }'

curl http://127.0.0.1:3000/jobs/<job-id>

curl -X POST http://127.0.0.1:3000/jobs/<job-id>/cancel

curl -X POST http://127.0.0.1:3000/jobs/<job-id>/retry

curl http://127.0.0.1:3000/jobs/<job-id>/artifacts

curl http://127.0.0.1:3000/artifacts/<job-id>/<artifact-id>

curl http://127.0.0.1:3000/api/canonical-packages

curl http://127.0.0.1:3000/api/canonical-packages/hinge-block/artifacts/readiness_report/preview
```

For the canonical package route contract, artifact key allowlist, release bundle boundary, and readiness/evidence boundary, see the [Studio canonical package API](./docs/studio-canonical-package-api.md).

Studio bridge examples:

```bash
curl -X POST http://127.0.0.1:3000/api/studio/model-preview \
  -H 'content-type: application/json' \
  -d '{
    "config_toml": "name = \"preview_bracket\"\n[[shapes]]\nid = \"body\"\ntype = \"box\"\nlength = 40\nwidth = 20\nheight = 8\n"
  }'

curl -X POST http://127.0.0.1:3000/api/studio/jobs \
  -H 'content-type: application/json' \
  -d '{
    "type": "review-context",
    "context_path": "output/imports/<session-id>/artifacts/engineering_context.json",
    "model_path": "output/imports/<session-id>/source/simple_bracket.step"
  }'

curl -X POST http://127.0.0.1:3000/api/studio/jobs \
  -H 'content-type: application/json' \
  -d '{
    "type": "report",
    "artifact_ref": {
      "job_id": "<job-id>",
      "artifact_id": "<config-artifact-id>"
    }
  }'

curl -X POST http://127.0.0.1:3000/api/studio/jobs \
  -H 'content-type: application/json' \
  -d '{
    "type": "pack",
    "artifact_ref": {
      "job_id": "<job-id>",
      "artifact_id": "<readiness-or-release-bundle-artifact-id>"
    }
  }'

curl -X POST http://127.0.0.1:3000/api/studio/jobs \
  -H 'content-type: application/json' \
  -d '{
    "type": "compare-rev",
    "baseline_artifact_ref": {
      "job_id": "<baseline-job-id>",
      "artifact_id": "<baseline-review-pack-artifact-id>"
    },
    "candidate_artifact_ref": {
      "job_id": "<candidate-job-id>",
      "artifact_id": "<candidate-review-pack-artifact-id>"
    }
  }'
```

The job store is filesystem-backed under `output/jobs` by default. Each job directory persists:

- request payload
- status transitions
- log output
- effective config when applicable
- artifact files and the manifest used by the executor/job store internally

Response notes:

- JSON API endpoints return JSON; browser-facing routes may return HTML, plain text, redirects, or artifact bytes depending on the route and `Accept`
- success responses always include `ok: true`
- error responses always include `ok: false` and `error.code` plus `error.messages`
- job responses sanitize `request` before returning it to the browser: tracked artifact re-entry exposes safe metadata such as `artifact_ref`, `source_job_id`, `source_artifact_id`, `source_artifact_type`, and `source_label` instead of raw `file_path`, `config_path`, or `source_artifact_path`
- the raw execution request still persists internally in `request.json` for the executor and job-store flows; public job responses are intentionally not a byte-for-byte echo of that internal file
- job responses include `retried_from_job_id`, `capabilities.cancellation_supported`, `capabilities.retry_supported`, and `links.cancel` / `links.retry` so the studio can surface narrow queue controls without guessing
- job responses include a `storage` block with logical file metadata only: `storage.files.<name>.exists` and `storage.files.<name>.size_bytes`. Browser-visible responses do not include `storage.root` or per-file `path` fields.
- artifact list responses include `links.open`, `links.download`, and the compatibility alias in `links.api`; only artifacts with `scope: "user-facing"` are browser-openable or downloadable, while internal input/control artifacts remain reference-only for tracked reruns
- public manifest/result/artifact summaries keep stable browser-facing labels only. When internal values were absolute paths, the browser-visible payload reduces them to file names such as `effective-config.json` or `job.log`.
- `/api/examples` returns checked-in example records as `{ api_version, ok: true, examples: [{ id, name, content }] }` and intentionally does not expose repository checkout paths
- drawing preview responses expose safe provenance fields such as `preview_reference` and `editable_plan_reference` plus availability booleans and artifact capabilities; they do not expose `plan_path`, preview working directories, or other raw preview sidecar paths
- successful cancel/retry actions return `ok: true`, an `action` block that names the operation and outcome, and the current job record for the cancelled or newly retried job

Browser-visible local API payload shape:

- `GET /jobs` and `GET /jobs/:id`
  - `request`: sanitized public metadata only
  - `artifacts`: flattened artifact summary with file-name-style values instead of raw filesystem paths
  - `manifest` and `result`: browser-safe summaries; any absolute path-like values are redacted to safe labels/file names
  - `storage`: `{ files: { job, request, log, manifest } }` records with `exists` and `size_bytes` only
- `GET /jobs/:id/artifacts`
  - `artifacts[*]`: `id`, `key`, `type`, `scope`, `stability`, `file_name`, `extension`, `content_type`, `exists`, `size_bytes`, `capabilities`, and `links`
  - `manifest`: the same redacted browser-safe manifest view used on the job detail route
  - `storage`: logical file metadata only; no public filesystem paths
- `GET /api/examples`
  - `{ api_version, ok: true, examples: [{ id, name, content }] }` for checked-in example TOML records
- `GET /api/canonical-packages`
  - `packages[*]`: safe `slug`, package refs, readiness status/score/gate/missing inputs, `artifact_catalog`, `evidence_boundary`, `studio_boundary`, `collection_guide_path`, and `inspection_evidence_path`
  - checked-in packages remain read-only docs packages; the response is not an arbitrary local folder listing
- `GET /api/canonical-packages/:slug/artifacts/:artifactKey/preview`
  - supported text-preview keys: `readme`, `review_pack`, `readiness_report`, `standard_docs_manifest`, `release_manifest`, `release_checksums`, `reopen_notes`, and `collection_guide`
  - response: `slug`, `artifact_key`, repo-relative `path`, `content_kind`, `content_type`, `size_bytes`, `truncated`, `content`, and `warnings`
  - `release_bundle.zip` appears as the `release_bundle` package artifact, but it is not text-previewable and this canonical route does not add preview, download, or open access for the ZIP
  - release bundle presence does not mean production-ready, generated package artifacts do not satisfy `inspection_evidence`, and Stage 5B remains parked until genuine completed inspection evidence exists
- `POST /api/studio/drawing-preview` and `POST /api/studio/drawing-previews/:id/dimensions`
  - `preview`: browser-safe drawing preview data including `id`, `preview_reference`, `editable_plan_reference` when an editable plan exists, `settings`, `overview`, `validation`, `svg`, `bom`, `views`, `scale`, `qa_summary`, `annotations`, `dimensions`, `editable_plan_available`, `dimension_editing_available`, `tracked_draw_bridge_available`, and `artifact_capabilities`
  - server-only preview sidecars such as `plan_path`, preview working directories, `run_log`, and other path-bearing preview files stay internal
  - internal preview-plan files remain available server-side where the HTTP dimension-edit loop and tracked-draw preservation need them

Internal executor/job-store payload shape:

- `request.json`, `job.json`, `job.log`, and `artifact-manifest.json` remain path-bearing on disk where the executor and retry flow need them
- artifact open/download routes resolve server-side against registered tracked artifacts only, and they reject internal-scope artifacts even when those internal artifacts can still be used as `artifact_ref` inputs for supported tracked reruns

Current limitations:

- this API is local/dev-first and does not add authentication
- jobs run in-process; there is no distributed queue, retry worker, or database
- queued-job cancellation is supported; running-job cancellation is intentionally rejected unless the active executor can stop work cooperatively and report that honestly
- retry is intentionally narrow and only supported from `failed` or `cancelled` jobs
- `job.log` is best-effort and primarily captures orchestration events and stderr surfaced from underlying scripts
- `GET /jobs/:id/artifacts` reports public artifact metadata and links, but it does not inline artifact contents inside the listing response
- `POST /jobs` and `POST /api/studio/jobs` do not expose every CLI path. Studio `review-context` is supported for local API source-path handoff, but the browser UI still avoids a broad arbitrary-file importer and does not try to mirror every shell workflow.
- preview smoke and legacy serve smoke are browserless HTTP checks only; they do not claim real browser automation or websocket interaction

Studio and legacy shell guide:

- [Studio UI handoff](./docs/studio-handoff.md)
- [Studio UI redesign draft](./docs/releases/studio-ui-redesign-draft.md)

Legacy note:

- `fcad serve --legacy-viewer` still starts the older browser demo shell from `server.js`
- `npm run serve:legacy` continues to point at that older shell
- `fcad serve` now opens the studio shell at `/`, keeps `/studio` as the direct studio route, and moves the API landing page to `/api`
- prompt streaming and the original all-in-one websocket viewer loop still live on the legacy path
- if you need the working all-in-one browser demo, use the legacy viewer commands above until the remaining websocket-only flows are migrated

Prompt-driven design review and prompt-to-TOML generation use the OpenAI
Responses API. Set `OPENAI_API_KEY` in the environment, `.env.local`, or `.env`;
the default model is `gpt-5.6-sol` and can be overridden with `OPENAI_MODEL`.
The API is called only after an explicit design/review action. Each action makes
one request by default, sends `store: false`, uses low reasoning effort, and caps
output at `12000` tokens unless `OPENAI_MAX_OUTPUT_TOKENS` is set. Automatic
repair requests stay disabled unless `OPENAI_ALLOW_REPAIR_RETRY=1` is explicitly
set. Repository tests never make a billable OpenAI request unless a maintainer
also opts in with `OPENAI_LIVE_TESTS=1`. The retractor demo likewise skips its
optional AI review unless `OPENAI_DEMO_REVIEW=1` is explicitly set.

FAQ:

- If the browser opens `/`, that is now the preferred studio shell. Open `/api` for the API info page or use `fcad serve --legacy-viewer` for the older browser demo UI.

### Create Canonical Schema

`fcad create` accepts two canonical config styles.

- Single-part mode: top-level `shapes` plus optional top-level `operations`
- Assembly mode: top-level `parts` and `assembly` must both be present
- The operation canonical key is `op`
- `type -> op` is backward compatibility only
- Shape aliases are not supported
- Assembly part operations are not identical to single-part operations

Minimal single-part example:

```toml
config_version = 1
name = "minimal_block"
final = "body_fillet"

[[shapes]]
id = "body"
type = "box"
length = 40
width = 20
height = 10

[[operations]]
op = "fillet"
target = "body"
radius = 1
result = "body_fillet"

[export]
formats = ["step"]
directory = "output"
```

Minimal assembly example:

```toml
config_version = 1
name = "minimal_assembly"

[[parts]]
id = "base"
final = "base_body"
  [[parts.shapes]]
  id = "base_body"
  type = "box"
  length = 40
  width = 20
  height = 10

[[parts]]
id = "pin"
final = "pin_body"
  [[parts.shapes]]
  id = "pin_body"
  type = "cylinder"
  radius = 4
  height = 20

[assembly]
  [[assembly.parts]]
  ref = "base"
  position = [0, 0, 0]

  [[assembly.parts]]
  ref = "pin"
  position = [20, 10, 0]

[export]
formats = ["step"]
directory = "output"
per_part_stl = true
```

Notes:

- In single-part mode, the final shape defaults to the last created result unless `final` is set.
- In assembly mode, each part can define its own `final`.
- Assembly mode currently expects top-level `parts` and `assembly`; `parts` alone does not activate assembly handling.
- Assembly part operations currently follow the assembly builder's supported set and are not a drop-in match for every single-part operation.
- When `create` exports STEP/STL/BREP artifacts, it also writes `<base>_create_quality.json` with generated-model geometry, STEP/BREP re-import checks, STL mesh checks, thresholds, warnings, and blocking issues.
- Create-quality evidence separates `generated_shape_geometry` measurements from the in-memory generated FreeCAD shape and `reimported_step_geometry` measurements from the exported STEP after re-import; STEP re-import evidence proves the exported file round-trips, not that every generated-shape check came from STEP. Unavailable STEP geometry is reported as explicit unavailable provenance, not inferred or synthetic measurement evidence, and remains separate from `inspection_evidence`.
- `--strict-quality` keeps the exported files but fails the command if the quality report status is `fail`.

Legacy / compatibility note:

- Existing configs that use `type` inside `[[operations]]` may still load because the normalizer maps `type -> op`.
- New configs should use `op` directly and should treat `type -> op` as compatibility-only behavior.

Real example configs:

- [controller_housing.toml](./configs/examples/controller_housing.toml): production-readiness single-part model with manufacturing, quality, drawing, and export sections
- [bracket_fem.toml](./configs/examples/bracket_fem.toml): compact FEM-oriented single-part config
- [ptu_assembly_mates.toml](./configs/examples/ptu_assembly_mates.toml): assembly config for mates/tolerance-style workflows

## Snapshot Regression

Normalized snapshot baselines now live under:

- `tests/fixtures/snapshots/svg/` for TechDraw SVG outputs
- `tests/fixtures/snapshots/report/` for lightweight readiness-report preview snapshots

Use the standard test:

```bash
npm run test:snapshots
```

Update baselines intentionally:

```bash
UPDATE_SNAPSHOTS=1 npm run test:snapshots
# or
npm run test:snapshots:update
```

Snapshot updates are expected when you intentionally change drawing geometry, annotations, report wording, section order, or the representative fixtures themselves.

Snapshot updates are not expected for timestamp churn, runtime-specific absolute paths, UUID-like run IDs, or generated metadata that should normalize away. If a test fails only because of that kind of volatility, fix the normalizer instead of refreshing the baseline.

Review workflow:

1. Run `npm run test:snapshots`.
2. Inspect diffs under `tests/fixtures/snapshots/svg/` and `tests/fixtures/snapshots/report/`.
3. Compare the changed baseline against the source fixture under `tests/fixtures/svg/` or `tests/fixtures/report/`.
4. Regenerate with `npm run test:snapshots:update` only after confirming the change is intentional.

The snapshot normalizers strip volatile timestamps, random SVG IDs, absolute paths, UUID-like run IDs, and similar generated metadata while preserving meaningful geometry and structural content changes.

Follow-on design notes for standards/material rule packs and parameter sweep live in [docs/standards-and-sweep-roadmap.md](./docs/standards-and-sweep-roadmap.md).

## Example Flow

```bash
# 1. Design-stage production engineering review
fcad review configs/examples/infotainment_display_bracket.toml \
  --out output/infotainment_display_bracket_product_review.json

# 2. Rough process planning support
fcad process-plan configs/examples/infotainment_display_bracket.toml \
  --out output/infotainment_display_bracket_process_plan.json

# 3. Consolidated production-readiness report
fcad readiness-report --review-pack output/infotainment_display_bracket_review_pack.json \
  --out output/infotainment_display_bracket_readiness_report.json

# 4. Runtime-informed launch stabilization review
fcad stabilization-review configs/examples/infotainment_display_bracket.toml \
  --runtime data/runtime_examples/display_bracket_runtime.json \
  --profile configs/profiles/site_korea_ulsan.toml \
  --out output/infotainment_display_bracket_stabilization_review.json

# 5. Canonical readiness packaging from review_pack.json
fcad readiness-pack --review-pack output/infotainment_display_bracket_review_pack.json \
  --out output/infotainment_display_bracket_readiness_report.json

# 6. Draft production-engineering standard docs from an explicit readiness artifact
fcad generate-standard-docs configs/examples/controller_housing_eol.toml \
  --readiness-report output/controller_housing_readiness_report.json \
  --out-dir output/controller_housing_standard_docs

# 7. Draft production-engineering standard docs from canonical readiness JSON
fcad generate-standard-docs <matching_config.toml|json> \
  --readiness-report <readiness_report.json> \
  --out-dir output/standard_docs

# 8. Portable release bundle from canonical readiness JSON
fcad pack --readiness output/controller_housing_readiness_report.json \
  --docs-manifest output/controller_housing_standard_docs/standard_docs_manifest.json \
  --out output/controller_housing_release_bundle.zip
```

The canonical readiness workflow produces a JSON report and a Markdown summary that bundle:

- product review
- process plan
- line-layout support pack
- quality / traceability pack
- cost / investment review
- optional runtime-informed stabilization review
- decision summary for production engineering discussion

`readiness_report.json` is the canonical C artifact for this flow. Markdown, standard-doc manifests, and release-bundle packaging derive from that JSON contract instead of becoming the primary source of truth. The older `readiness-report <config>` route remains in the CLI as legacy compatibility and should not be used to describe canonical D-backed provenance. `generate-standard-docs` must consume canonical readiness JSON directly and requires the supplied config and readiness lineage to describe the same part/revision before it will render downstream docs.

## Portfolio Case Study

For a checked-in example that can be reviewed without running the CLI, see:

- [Canonical example library](./docs/examples/README.md)
- [Quality Pass Bracket Software/Demo Case Study](./docs/portfolio/quality-pass-bracket-software-demo-case.md): readiness held on missing `inspection_evidence`; production-ready: no; preserves the release bundle boundary and keeps CAD-derived reference material separate from inspection evidence.
- [Plate With Holes Software/Demo Case Study](./docs/portfolio/plate-with-holes-software-demo-case.md): readiness held on missing `inspection_evidence`; production-ready: no; release bundle is transport/review material, not readiness proof.
- [Infotainment production readiness case](./docs/portfolio/infotainment-production-readiness-case.md)
- [Checked-in example artifact set](./docs/examples/infotainment-display-bracket/README.md)
- [Korea vs Mexico stabilization comparison](./docs/examples/infotainment-display-bracket/stabilization-comparison.md)
- [Before-vs-after improvement case](./docs/portfolio/before-after-improvement-case.md)
- [Checked-in electronics assembly + standard docs example](./docs/examples/controller-housing-eol/README.md)

The infotainment-oriented case-study material documents the older config-driven readiness workflow. The canonical C packaging path on current master is `review_pack.json -> readiness-pack/readiness-report --review-pack -> readiness_report.json -> standard docs / release bundle`.

## Automotive Infotainment Example Configs

- `configs/examples/infotainment_display_bracket.toml`
- `configs/examples/infotainment_display_bracket_before.toml`
- `configs/examples/infotainment_display_bracket_after.toml`
- `configs/examples/controller_housing.toml`
- `configs/examples/controller_housing_eol.toml`
- `configs/examples/pcb_mount_plate.toml`
- `configs/examples/display_module_support.toml`

These examples include manufacturing metadata such as:

- material and process assumptions
- cross-site launch scope
- annual volume and target cycle time placeholders
- connector clearance assumptions
- critical dimensions and quality gates
- automation-candidate notes
- electronics assembly metadata and EOL test assumptions

Runtime/profile examples:

- `data/runtime_examples/display_bracket_runtime.json`
- `data/runtime_examples/display_bracket_runtime_mexico.json`
- `configs/profiles/site_korea_ulsan.toml`
- `configs/profiles/site_mexico_mty.toml`

## Architecture

The [authoritative system blueprint](./docs/architecture/README.md) is the single architecture navigation entry point. It covers the current local product, trust and authorization boundaries, canonical artifact/state models, and the additive path through the first genuine production proof. The compact diagram below remains a legacy code-area orientation.

```text
CLI (fcad / mfg-agent)
  |
  +-- legacy CAD / drawing / report commands
  +-- review-pack workflow
  +-- production-readiness workflow
          |
          +-- intent compiler
          +-- DFM checker
          +-- cost estimator
          +-- product review agent
          +-- process planning agent
          +-- line layout support agent
          +-- quality / traceability agent
          +-- cost / investment review agent
```

### Main code areas

- `bin/fcad.js`: unified CLI entrypoint
- `src/workflows/canonical-readiness-builders.js`: canonical D-backed C readiness packaging helpers
- `src/agents/`: manufacturing-engineering agent modules
- `src/workflows/readiness-report-workflow.js`: legacy config-driven readiness compatibility flow
- `src/workflows/standard-docs-workflow.js`: draft standard-document generation
- `scripts/dfm_checker.py`: DFM manufacturability logic
- `scripts/cost_estimator.py`: cost breakdown and comparison logic
- `scripts/intent_compiler.py`: part-type inference and drawing-plan strategy
- `schemas/`: output contracts for review, process-plan, line-plan, quality-risk, investment-review, readiness-report, stabilization-review, and standard-doc manifests

See the [authoritative system blueprint](./docs/architecture/README.md) for the whole-system reference and [production-readiness-refactor.md](./docs/production-readiness-refactor.md) for the codebase refactoring map.

## Installation

### Prerequisites

- Node.js 18+
- Python 3.11+
- FreeCAD 1.1.x for the FreeCAD-backed commands

### Setup

```bash
git clone https://github.com/dooosp/freecad-automation.git
cd freecad-automation
npm install
npm link
fcad check-runtime
```

### Runtime Detection And Precedence

Resolution order for runtime-backed commands:

1. `FREECAD_PYTHON`
2. `FREECAD_BIN`
3. `FREECAD_CMD`
4. `FREECAD_APP`
5. `FREECAD_DIR` (backward-compatible install-root fallback)

If none of those overrides are set, the resolver falls back to platform detection:

- macOS: prefer `FreeCAD.app` bundle discovery from `/Applications/FreeCAD.app`, `~/Applications/FreeCAD.app`, and PATH-visible bundle/runtime executables
- Windows native: look for PATH-visible `FreeCADCmd.exe`, `freecadcmd.exe`, or `FreeCAD.exe`
- WSL: no default bridge guess is assumed; explicit Windows paths are converted with `wslpath` when available
- Linux / other POSIX: look for PATH-visible `FreeCADCmd`, `freecadcmd`, `FreeCAD`, or `freecad`

Use `fcad check-runtime` or `npm run check:runtime` as the first troubleshooting step. It shows the resolved runtime, where it came from, which candidates were checked, and which commands are blocked if no runtime is available.

Commands that directly depend on the resolved FreeCAD runtime:

- `create`
- `draw`
- `inspect`
- `fem`
- `tolerance`
- `report`

Conditional runtime usage:

- `analyze-part`: can run from existing context/model metadata without FreeCAD, but uses FreeCAD when it needs live model inspection or STEP feature detection
- `design`: generates TOML, then calls `create`

Supported inputs for `FREECAD_APP`, `FREECAD_BIN`, `FREECAD_PYTHON`, `FREECAD_CMD`, and backward-compatible `FREECAD_DIR` include:

- `/Applications/FreeCAD.app`
- `~/Applications/FreeCAD.app`
- `.../FreeCAD.app/Contents`
- `.../FreeCAD.app/Contents/Resources`
- `.../FreeCAD.app/Contents/Resources/bin`
- explicit bundle-internal executables such as `.../Contents/MacOS/FreeCAD` or `.../Contents/Resources/bin/python`

The resolver canonicalizes those forms back to one `FreeCAD.app` bundle root, then derives:

- GUI launcher: `Contents/MacOS/FreeCAD`
- headless/script runtime: bundled `freecadcmd`/`freecad` first, then bundled Python
- bundled Python: `Contents/Resources/bin/python`

Recommended macOS setup:

```bash
export FREECAD_APP="/Applications/FreeCAD.app"
fcad check-runtime
```

Explicit runtime overrides:

```bash
export FREECAD_PYTHON="/Applications/FreeCAD.app/Contents/Resources/bin/python"
export FREECAD_BIN="/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd"
fcad check-runtime
```

Windows compatibility remains available, but only through explicit configuration. `FREECAD_DIR` is still accepted for backward compatibility:

```bash
export FREECAD_DIR="C:\\Program Files\\FreeCAD 1.1"
fcad check-runtime
```

This repository does not assume a default WSL -> Windows bridge anymore. If you do use WSL with a Windows FreeCAD install, set the Windows path explicitly as above.

## Output Contracts

- [product_review.schema.json](./schemas/product_review.schema.json)
- [process_plan.schema.json](./schemas/process_plan.schema.json)
- [line_plan.schema.json](./schemas/line_plan.schema.json)
- [quality_risk.schema.json](./schemas/quality_risk.schema.json)
- [investment_review.schema.json](./schemas/investment_review.schema.json)
- [readiness_report.schema.json](./schemas/readiness_report.schema.json)
- [stabilization_review.schema.json](./schemas/stabilization_review.schema.json)
- [docs_manifest.schema.json](./schemas/docs_manifest.schema.json)
- [release_bundle_manifest.schema.json](./schemas/release_bundle_manifest.schema.json)

Legacy compatibility aliases remain available at `quality_risk_pack.schema.json` and `standard_docs_manifest.schema.json`.

## Testing

Hosted-safe Node checks:

```bash
npm run test:node:contract
npm run test:node:integration
npm run test:snapshots
```

These checks cover runtime discovery, command assembly, path conversion logic, hosted-safe integration wiring, and snapshots. They do not install or execute FreeCAD.

Python and CLI checks:

```bash
npm run test:py
```

`npm run test:py` uses `node scripts/run-pytest.js -q tests` with the runtime-backed regressions excluded, so the selected Python interpreter should resolve to Python 3.11 or newer. Hosted CI currently pins Python 3.11 to match the documented minimum.

Default hosted-safe Node suite:

```bash
npm test
```

`npm test` runs `node scripts/run-test-suite.js default-node`, which expands to `test:node:contract`, `test:node:integration`, and `test:snapshots` through `tests/lane-manifest.js`.

## Runtime Smoke Coverage

GitHub-hosted CI currently covers:

- `check:source-hygiene` on `ubuntu-24.04`
- `test:node:contract` on `ubuntu-24.04` and `macos-14`
- `test:node:integration` on `ubuntu-24.04`
- `test:snapshots` on `ubuntu-24.04`
- `test:studio-browser-smoke` on `ubuntu-24.04`
- `test:py` on `ubuntu-24.04`

GitHub-hosted CI does not currently install or launch FreeCAD.

For a real runtime-backed smoke pass on a FreeCAD-capable machine:

```bash
npm run smoke:runtime
```

The smoke script currently exercises:

- `fcad check-runtime`
- `fcad create`
- `fcad draw --bom`
- `fcad inspect`
- `fcad fem`
- `fcad tolerance --recommend --csv`
- `fcad report`

For CI, the repository also includes a self-hosted macOS workflow that uses the same smoke script and requires a runner labeled for FreeCAD with FreeCAD 1.1 installed. PR smoke is triggered only after `Automation CI (hosted fast lanes)` succeeds for a same-repository head; forks do not run on the self-hosted runner. The tolerance coverage is intentionally narrow: it proves the checked-in PTU assembly can run through CSV export and manifest checks on that self-hosted macOS lane, without claiming Linux/Windows runtime coverage or broader Monte Carlo maturity. Runtime workflow governance details live in [docs/self-hosted-runtime-governance.md](./docs/self-hosted-runtime-governance.md).

## Release Prep

Draft release notes for the first public release surface live at [docs/releases/v1.1.0-draft.md](./docs/releases/v1.1.0-draft.md).

If you want to run the smoke steps manually instead of the script, use:

```bash
cd /path/to/freecad-automation
export FREECAD_APP="/Applications/FreeCAD.app"
fcad check-runtime
npm run test:node:contract
node bin/fcad.js create configs/examples/ks_bracket.toml
node bin/fcad.js draw configs/examples/ks_bracket.toml --bom
node bin/fcad.js inspect output/ks_bracket.step
node bin/fcad.js fem configs/examples/bracket_fem.toml
node bin/fcad.js tolerance configs/examples/ptu_assembly_mates.toml --recommend --csv
node bin/fcad.js report configs/examples/ks_bracket.toml
```
