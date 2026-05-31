# Support Matrix

`fcad check-runtime` is the central installation and runtime-diagnostic tool for this repository. Run it first on any new machine and before troubleshooting a FreeCAD-backed command. Use `fcad check-runtime --json` when tooling needs the same machine-readable runtime contract that `GET /health` returns.

This matrix is the public support boundary for the current release. It separates repository-owned verification from compatibility paths that still depend on user-local validation.

## Runtime Verification Matrix

| Platform / runtime path | `fcad check-runtime` detection | Repository-owned live verification | Current status | Notes |
| --- | --- | --- | --- | --- |
| macOS + `FreeCAD.app` 1.1.x | Yes | Yes | Verified for listed checks | Maintainer-local verification covers `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, narrow `tolerance --csv`, and `report`. Repository-owned runtime smoke covers `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, narrow `tolerance --csv`, and `report` on self-hosted macOS. |
| macOS hosted CI (`macos-14`) | N/A for live FreeCAD | No | Hosted-safe only | Hosted CI runs Node runtime-contract tests only. It does not install or launch FreeCAD. |
| Ubuntu hosted CI (`ubuntu-24.04`) | N/A for live FreeCAD | No | Hosted-safe only | Hosted CI runs Node contract, Node integration, snapshots, and Python lanes without installing FreeCAD; the Node contract lane includes the non-mutating Stage 5B no-evidence CLI lane and audit CLI smoke with GitHub discovery disabled. |
| Linux local with FreeCAD installed | Yes | No | Compatibility path | Runtime discovery and command assembly exist, but there is no repository-owned live runtime smoke on Linux yet. Validate locally with `fcad check-runtime` and your own smoke runs. |
| Windows native + FreeCAD 1.1 | Yes | No | Compatibility path | Use explicit `FREECAD_*` overrides if PATH discovery is insufficient. Runtime ownership is not yet backed by repository-owned live smoke. |
| WSL -> Windows FreeCAD | Yes, with explicit override | No | Compatibility path | No default bridge is assumed. Point `FREECAD_DIR`, `FREECAD_BIN`, or `FREECAD_PYTHON` at the Windows install explicitly. |

## Command Runtime Classes

`fcad check-runtime` reports these command classes directly so users can tell which work is blocked by runtime issues.

### Requires FreeCAD

- `create`
- `draw`
- `inspect`
- `fem`
- `tolerance`
- `report`

### Runs Without Launching FreeCAD

- `dfm`
- `review`
- `process-plan`
- `line-plan`
- `quality-risk`
- `investment-review`
- `readiness-pack`
- `readiness-report`
- `pack`
- `closeout-package`
- `inspection-evidence-intake`
- `inspection-evidence-promotion-dry-run`
- `stage5b-evidence-audit`
- `stabilization-review`
- `generate-standard-docs`
- `ingest`
- `quality-link`
- `review-pack`
- `review-context`
- `compare-rev`
- `validate`
- `validate-config`
- `migrate-config`
- `serve`

`review-context --context ...` stays fully plain Python / Node. `review-context --model ...` now degrades to a metadata-only review flow with low-confidence warnings when runtime-backed model inspection or STEP feature detection cannot extract usable shape metrics.

### Mixed / Conditional

- `analyze-part`: runs in plain Python mode when the context already contains model metadata, uses FreeCAD for live model inspection or STEP feature detection when available, and falls back to bounded metadata-only geometry artifacts when model inspection is unavailable or the shape is weak/invalid.
- `design`: generates config content first, then calls `create`.
- `sweep`: follows the matrix-selected service wrappers; cost-only variants can stay plain Python, while create/fem/report variants require FreeCAD.

## What Is Verified

- Maintainer-local macOS + `FreeCAD.app` 1.1.x verification exists for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, narrow `tolerance --csv`, and `report`.
- Repository-owned runtime smoke exists on self-hosted macOS for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, narrow `tolerance --csv`, and `report`.
- Hosted CI covers Node runtime/path contracts, the non-mutating Stage 5B no-evidence CLI lane and audit CLI smoke, non-runtime integration checks, snapshots, and Python tests without claiming a live FreeCAD install.

## What Is Not Yet Claimed

- No repository-owned live runtime smoke on Linux.
- No repository-owned live runtime smoke on Windows native.
- No repository-owned live runtime smoke for WSL -> Windows FreeCAD.
- No repository-owned live runtime smoke for `tolerance` on Linux, Windows native, or WSL -> Windows FreeCAD.
- No broad repository-owned tolerance-analysis maturity claim: the only repository-owned tolerance runtime coverage today is the narrow self-hosted macOS CSV smoke, not Monte Carlo or deeper tolerance validation.
- No claim that hosted CI proves FreeCAD launches successfully.

## Recommended User Flow

1. Install Node.js 18+, Python 3.11+, and FreeCAD 1.1.x if you need the FreeCAD-backed commands.
2. Run `fcad check-runtime`.
3. If the runtime is detected, run a small end-to-end command such as `fcad create <config.toml>` or `npm run test:runtime-smoke`.
4. If runtime detection fails, fix the `FREECAD_*` override or install path reported by `fcad check-runtime`, then rerun it.
5. If you only need the manufacturing-review layer, continue with the plain-Python / Node commands while FreeCAD setup is still in progress.
6. For Stage 5B evidence work, use the [Stage 5B evidence request packet](./stage-5b-evidence-request-packet.md) when asking a supplier, lab, QA reviewer, or physical inspector for real completed records, then run `fcad stage5b-evidence-audit --out-dir <dir>` to emit a non-mutating audit bundle with `intake_report.json`, `promotion_dry_run_manifest.json`, `stage5b_audit_manifest.json`, and `stage5b_audit_summary.md`. Use the [Stage 5B operational runbook](./stage-5b-operational-runbook.md) for the exact CLI/API/Studio flow. For a newly supplied JSON record, first run `node scripts/stage5b-candidate-evidence-gate.js --candidate <repo-relative-json>` to get a local accept/reject checklist; that gate is non-production, non-mutating, and never changes readiness. Use `--include-github` only for bounded public GitHub discovery; it searches non-secret issues, PR/comments, releases/assets, workflow artifact metadata, and allowlisted public links, then records machine-readable skip/download/rejection provenance. Studio Review can queue `stage5b-evidence-audit` as a tracked job with server-generated artifact output and only optional `include_github`; the browser cannot choose an arbitrary output directory. The intake adapter checks JSON contract files plus explicit CSV/TSV/Markdown/TXT inspection tables, including safety-checked allowlisted ZIP contents, while rejecting generated quality/readiness/review/release artifacts, CI summaries, GitHub metadata alone, audit/control manifests, and fixtures as final evidence. Those rejected sources do not satisfy `inspection_evidence`. The audit bundle runs `inspection-evidence-intake`, then runs `inspection-evidence-promotion-dry-run` from the produced intake report and consolidates exact outputs, searched source classes, accepted/rejected counts, GitHub status, attachment-ready count, blockers, next safe commands, and readiness-held truth. You can still run `fcad inspection-evidence-intake --out <report.json>` and `fcad inspection-evidence-promotion-dry-run --intake-report <report.json> --out <promotion_dry_run_manifest.json>` separately, or queue `inspection-evidence-promotion-dry-run` from a registered tracked `inspection-evidence.intake-report` artifact in Studio Review. When intake finds no genuine completed attachment-ready inspection evidence, the dry-run and audit manifest keep readiness at `needs_more_evidence` / `hold_for_evidence_completion`.
