# Stage 5B operational runbook

Use this runbook when maintainers need to run, review, diagnose, or explain the Stage 5B inspection-evidence automation chain from the CLI, tracked API, or Studio Review.

Current truth: no genuine completed inspection evidence has been found or attached. Canonical packages remain `needs_more_evidence` with gate decision `hold_for_evidence_completion` until a real physical, supplier, lab, or QA inspection record is validated and deliberately attached.

Hard evidence rule: Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.

## Quick CLI Path

Run these from the repository root. Use `fcad` when the package bin is on PATH, or `node bin/fcad.js` from a checkout.

```bash
mkdir -p output/stage5b-runbook
fcad inspection-evidence-intake [--package <canonical-package-slug>] [--include-github] --out output/stage5b-runbook/inspection-evidence-intake-report.json
fcad inspection-evidence-promotion-dry-run --intake-report output/stage5b-runbook/inspection-evidence-intake-report.json --out output/stage5b-runbook/promotion_dry_run_manifest.json
fcad stage5b-evidence-audit --out-dir output/stage5b-runbook-audit [--include-github]
```

Expected no-evidence result:

- `inspection-evidence-intake` reports `Genuine evidence found: no`, `accepted_candidate_count: 0`, and `attachment_ready_candidate_count: 0`.
- `inspection-evidence-promotion-dry-run` reports `promotion_can_run: false`, `canonical_artifacts_mutated: false`, and no canonical next command.
- `stage5b-evidence-audit` reports `Genuine evidence found: no`, `Promotion can run: no`, and `Readiness remains held: yes`.

## Candidate Acceptance Gate

Before maintainers put a newly supplied JSON record into the Stage 5B intake/dry-run review path, run the local non-production candidate gate:

```bash
node scripts/stage5b-candidate-evidence-gate.js --candidate <repo-relative-json> --out output/stage5b-candidate-gate/report.json
```

The gate only decides whether the supplied record is eligible for Stage 5B intake review. It is a checklist/control surface, not a promotion command. It does not run `review-context`, attach evidence, regenerate readiness, update standard docs, package a release bundle, or change canonical package state.

The report must show `eligible_for_stage5b_intake_review: true` before the record enters intake/dry-run review. It still does not prove readiness. The checklist requires:

- completed physical, supplier, lab, or QA inspection origin
- source/provenance and reviewer traceability
- package or part plus revision mapping
- inspection date, completed status, and pass/fail/partial result fields
- safe repo-relative attachment/provenance paths with no credentials, private URLs, absolute paths, `output/`, or `tmp/codex/`
- explicit rejection reasons when any requirement fails

The gate fails closed for generated/control artifacts, diagnostics, schemas, fixtures, intake reports, promotion dry-run manifests, audit outputs, GitHub/CI metadata, screenshots, templates, guides, comments, PR bodies, docs artifacts, release bundles, and CAD-generated, simulated, inferred, or synthetic measurements. Fixtures used by tests are control/non-evidence examples only and must not be promoted or described as genuine package evidence.

## Audit Outputs

`fcad stage5b-evidence-audit --out-dir <dir>` writes these control artifacts:

- `intake_report.json`
- `promotion_dry_run_manifest.json`
- `stage5b_audit_manifest.json`
- `stage5b_audit_summary.md`

The corresponding tracked artifact types are:

- `inspection-evidence.intake-report`
- `inspection-evidence.promotion-dry-run-manifest`
- `stage5b.evidence-audit-manifest`
- `stage5b.evidence-audit-summary`

These artifacts are review/control outputs only. They summarize searched source classes, accepted and rejected counts, GitHub skip/download metadata when enabled, blockers, attachment readiness, future commands, and canonical readiness-held truth. They do not attach evidence, regenerate readiness, update standard docs, package a release bundle, or make a production-readiness claim.

## API And Tracked Job Path

Start the local API and Studio shell:

```bash
npm run serve
```

Queue the same Stage 5B jobs through the tracked API:

```bash
curl -X POST http://127.0.0.1:3000/jobs \
  -H 'content-type: application/json' \
  -d '{"type":"inspection-evidence-intake","options":{"include_github":false}}'

curl -X POST http://127.0.0.1:3000/jobs \
  -H 'content-type: application/json' \
  -d '{"type":"stage5b-evidence-audit","options":{"include_github":false}}'

curl -X POST http://127.0.0.1:3000/jobs \
  -H 'content-type: application/json' \
  -d '{"type":"inspection-evidence-promotion-dry-run","intake_report_path":"output/stage5b-runbook-audit/intake_report.json"}'
```

Queue through the Studio bridge route when testing browser-facing payloads:

```bash
curl -X POST http://127.0.0.1:3000/api/studio/jobs \
  -H 'content-type: application/json' \
  -d '{"type":"stage5b-evidence-audit","options":{"include_github":false}}'

curl -X POST http://127.0.0.1:3000/api/studio/jobs \
  -H 'content-type: application/json' \
  -d '{"type":"inspection-evidence-intake","options":{"include_github":false}}'

curl -X POST http://127.0.0.1:3000/api/studio/jobs \
  -H 'content-type: application/json' \
  -d '{"type":"inspection-evidence-promotion-dry-run","artifact_ref":{"job_id":"<intake-job-id>","artifact_id":"<intake-artifact-id>"}}'
```

Use `GET /jobs`, `GET /jobs/<job-id>`, and `GET /jobs/<job-id>/artifacts` to review status and registered artifacts. The browser-visible request metadata and artifact previews are sanitized; Studio opens registered job artifacts by job id and artifact id, not arbitrary local file paths.

## Studio Review Path

1. Run `npm run serve`.
2. Open `http://127.0.0.1:3000/` or `http://127.0.0.1:3000/studio`.
3. Open the Review workspace.
4. Queue `stage5b-evidence-audit` first when you need the full non-mutating chain.
5. Queue `inspection-evidence-intake` when you want to inspect intake by itself.
6. Queue `inspection-evidence-promotion-dry-run` only from a registered `inspection-evidence.intake-report` artifact.
7. Open the completed job in Review and preview the registered intake report, promotion dry-run manifest, audit manifest, and audit summary through tracked artifact routes.

The Review cards should show the same no-evidence truth: no genuine evidence found, no promotion can run, attachment-ready count is `0`, and readiness remains `needs_more_evidence / hold_for_evidence_completion`.

## Promotion Dry-Run Meaning

`inspection-evidence-promotion-dry-run` is a planning/control step. It reads an intake report and describes what a future promotion would do only if a genuine-valid, high-confidence, attachment-ready candidate exists.

When no valid candidate exists, the manifest must say promotion cannot run. It must not run `review-context`, attach evidence, mutate canonical package artifacts, regenerate readiness reports, update standard docs, or package release bundles.

When genuine evidence exists later, the dry-run should list the future command chain and mutation boundaries:

- `review-context --inspection-evidence <PATH_TO_COMPLETED_REAL_JSON>`
- `readiness-pack`
- `generate-standard-docs`
- `pack`

Run that future chain only in a separate evidence-gated task after the evidence record has been validated and reviewed.

## Diagnostics Meaning

Validation diagnostics explain malformed Stage 5B control artifacts or unsafe inputs. CLI commands can write `validation_diagnostics.json` beside a failed output path. Tracked API and Studio jobs can expose sanitized diagnostics and, for Stage 5B validation failures, a `stage5b.validation-diagnostics` artifact.

Diagnostics are not evidence. They do not request human-entered measurements, attach package evidence, or change readiness.

## What Never Counts As Inspection Evidence

These sources do not satisfy `inspection_evidence`:

- diagnostics
- schemas
- fixtures
- generated CAD, drawing, quality, DFM, readiness, review, standard-doc, release, or manifest artifacts
- CI metadata and CI summaries
- screenshots
- intake reports
- promotion dry-run manifests
- audit manifests and audit summaries
- GitHub metadata, comments, PR bodies, issue bodies, workflow metadata, release bundles, and release assets by themselves
- templates
- collection guides
- Studio cards or tracked job metadata
- human-typed, inferred, simulated, synthetic, CAD-generated, or guessed measurements

Do not fabricate, infer, simulate, CAD-generate, or promote measurements. Use `null` or an explicit unavailable state when evidence is unavailable.

## Future Genuine-Evidence Path

For a future real evidence task:

1. Collect a completed physical, supplier, lab, or QA inspection record outside the generated/control artifact chain.
2. Serialize it to the inspection evidence JSON contract with explicit provenance and measured feature records.
3. Run `node scripts/stage5b-candidate-evidence-gate.js --candidate <repo-relative-json>` and review the checklist. Rejections stop the record before intake/dry-run review.
4. Run `fcad inspection-evidence-intake --out <report.json>` to classify and plan attachment.
5. Run `fcad inspection-evidence-promotion-dry-run --intake-report <report.json> --out <promotion_dry_run_manifest.json>` and review blockers, match confidence, mutation boundaries, and rollback guidance.
6. Attach only when the dry-run is attachment-ready and the task explicitly authorizes canonical mutation.
7. Refresh `review-context --inspection-evidence`, `readiness-pack`, `generate-standard-docs`, and `pack` in that separate authorized task.

Until that happens, the readiness truth remains unchanged.

## Validation Commands

Use these checks after runbook, docs, command-surface, or source-of-truth changes:

```bash
git status --short
git diff --check
node tests/stage5b-candidate-evidence-gate.test.js
node tests/first-user-docs-smoke.test.js
node tests/stage5b-source-of-truth-guard.test.js
node tests/stage5b-evidence-audit-cli-smoke.test.js
npm run test:stage5b:no-evidence
npm run test:node:contract
npm test
```

Use `npm test` before merging or when the change risk extends beyond docs/source-of-truth assertions. Do not claim runtime-backed FreeCAD validation unless `fcad check-runtime` and a real runtime-backed command or runtime smoke lane actually ran.
