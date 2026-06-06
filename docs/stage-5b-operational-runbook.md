# Stage 5B operational runbook

Use this runbook when maintainers need to run, review, diagnose, or explain the Stage 5B inspection-evidence automation chain from the CLI, tracked API, or Studio Review.

Current truth: no genuine completed inspection evidence has been found or attached. Canonical packages remain `needs_more_evidence` with gate decision `hold_for_evidence_completion` until a real physical, supplier, lab, or QA inspection record is validated and deliberately attached.

Hard evidence rule: Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.

For repo-wide maintainer handoff after a PR train, start with
`npm run maintainer:doctor -- --clean`. It writes
`output/maintainer-doctor/maintainer_doctor_report.json` and verifies source
hygiene, the Stage 5B pipeline doctor, release dry-run governance, node contract
discoverability, docs/source-of-truth guards, generated output policy, raw inbox
tracking, workflow/check-name drift, and overclaim guards. Use the Stage 5B
commands below only to isolate or operate the Stage 5B portion of that top-level
report.

## Quick CLI Path

Run these from the repository root. Use `fcad` when the package bin is on PATH, or `node bin/fcad.js` from a checkout.

```bash
mkdir -p output/stage5b-runbook
fcad stage5b-evidence-source-kit [--package <canonical-package-slug>]
fcad stage5b-evidence-source-preflight [--package <canonical-package-slug>] [--source local/stage5b-candidate-evidence-inbox/<package-slug>/<received-record.json|csv|tsv>] [--out local/stage5b-candidate-evidence-inbox/<package-slug>/source-preflight-report.json]
fcad stage5b-evidence-review-dry-run --package <canonical-package-slug> --source local/stage5b-candidate-evidence-inbox/<package-slug>/<received-record.json|csv|tsv> --out-dir output/stage5b-review-dry-run
fcad stage5b-evidence-attachment-controller --review-manifest output/stage5b-review-dry-run/stage5b_evidence_review_dry_run_manifest.json --authorization-record <safe-authorization-record.json> --out-dir output/stage5b-attachment-controller --dry-run
fcad inspection-evidence-intake [--package <canonical-package-slug>] [--include-github] --out output/stage5b-runbook/inspection-evidence-intake-report.json
fcad inspection-evidence-promotion-dry-run --intake-report output/stage5b-runbook/inspection-evidence-intake-report.json --out output/stage5b-runbook/promotion_dry_run_manifest.json
fcad stage5b-evidence-audit --out-dir output/stage5b-runbook-audit [--include-github]
fcad stage5b-surrogate-inspection-validation --out-dir output/stage5b-runbook-surrogate [--package <canonical-package-slug>]
fcad stage5b-evidence-pipeline-doctor --package <canonical-package-slug> --out-dir output/stage5b-evidence-pipeline-doctor
```

Expected no-evidence result:

- `stage5b-evidence-source-kit` creates ignored package-scoped inbox folders and templates, reports `Acquisition/preflight only: yes`, `Inspection evidence attached: no`, and `Canonical readiness regenerated: no`.
- `stage5b-evidence-source-preflight` reports `READY_FOR_SOURCE` when no source exists, or classifies a supplied source as `ready_for_stage5b_review`, `needs_more_source_detail`, or `unsafe_or_not_evidence` without attaching evidence.
- `stage5b-evidence-review-dry-run` writes an ignored review manifest plus local preflight, review-candidate, candidate-gate, and audit control outputs. It does not attach evidence, promote evidence, regenerate canonical readiness, or mark packages ready. Use `--fixture` only for synthetic ignored local-inbox orchestration tests labeled non-evidence.
- `stage5b-evidence-attachment-controller` writes one ignored `stage5b_evidence_attachment_control_manifest.json` with pass/hold gates, exact blockers, next commands, evidence boundaries, and readiness-held truth. It accepts only the review dry-run manifest plus a scoped authorization record, rejects missing or unsafe prerequisites, and still does not attach evidence, promote evidence, regenerate readiness, or mark packages ready.
- `inspection-evidence-intake` reports `Genuine candidate found: no`, `Inspection evidence attached: no`, `accepted_candidate_count: 0`, and `attachment_ready_candidate_count: 0`.
- `inspection-evidence-promotion-dry-run` reports `promotion_can_run: false`, `canonical_artifacts_mutated: false`, and no canonical next command.
- `stage5b-evidence-audit` reports `Genuine candidate found: no`, `Inspection evidence attached: no`, `Promotion can run: no`, and `Readiness remains held: yes`.
- `stage5b-surrogate-inspection-validation` reports `Inspection evidence attached: no` and `Canonical readiness remains held: yes` while validating parser, redaction, mapping, gate rejection, audit reporting, and readiness messaging with synthetic/surrogate/non-evidence records only.
- `stage5b-evidence-pipeline-doctor` runs a complete fixture-only diagnostic of source-kit -> source-preflight -> review-dry-run -> attachment-controller -> pipeline-doctor -> later explicit real attachment/regeneration goal. It also runs surrogate/generated/docs/CI/readiness/CAD non-evidence guards, checks command/schema/catalog/docs/npm/CI drift, expects the attachment controller to fail closed, and writes one ignored manifest while keeping canonical readiness at `needs_more_evidence` / `hold_for_evidence_completion`.

## Surrogate Automation-Readiness Lane

Use `fcad stage5b-surrogate-inspection-validation --out-dir <dir> [--package <canonical-package-slug>]` when no genuine completed physical/supplier/lab/QA record exists and maintainers still need to prove the Stage 5B automation path can run. The command writes `surrogate_inspection_validation.json` and a nested canonical no-evidence audit bundle under the requested ignored output directory.

This lane uses repo-local public examples, drawing intent, feature catalogs, and readiness metadata only. Representative values are labeled with `SURROGATE_NON_EVIDENCE:` and the generated inspection-shaped records are marked synthetic, surrogate, non-evidence, and ineligible for canonical evidence. The lane validates:

- parser compatibility with the inspection-evidence shape
- redaction/path-safety checks
- package mapping from canonical package slugs
- candidate gate rejection as real evidence
- attachable-evidence rejection as real evidence
- audit reporting and readiness-held messaging

This lane never receives raw supplier/lab/QA/private files and never attaches evidence. Surrogate records must remain rejected by `validateAttachableInspectionEvidence`, the candidate gate, intake classification, and readiness logic. Canonical packages remain `needs_more_evidence` / `hold_for_evidence_completion` until a later explicitly authorized task attaches genuine completed evidence.

## Pipeline Doctor

Use `fcad stage5b-evidence-pipeline-doctor --package <canonical-package-slug> --out-dir output/stage5b-evidence-pipeline-doctor` when maintainers need one safe end-to-end diagnostic that proves the no-real-evidence Stage 5B pipeline is still wired. The doctor uses only repo-local fixture/surrogate/non-evidence inputs, writes only ignored `output/` control artifacts plus ignored local-inbox fixtures, and never attaches evidence, promotes evidence, regenerates canonical readiness, or marks a package ready.

The doctor validates the safe chain source-kit -> source-preflight -> review-dry-run -> attachment-controller -> pipeline-doctor -> later explicit real attachment/regeneration goal. It runs the surrogate lane, rejects surrogate/generated/docs/CI/readiness/CAD inputs as canonical evidence, checks schemas, the artifact catalog, README/runbook/support/testing docs, npm scripts, CI workflows, raw inbox tracking, output tracking, and all canonical readiness reports. Only genuine completed physical/supplier/lab/QA inspection records can satisfy `inspection_evidence`; after one is received, start a separate explicit real evidence attachment/regeneration goal.

## Candidate Acceptance Gate

When maintainers need to request real records from a supplier, lab, QA reviewer,
or physical inspector, start with the [Stage 5B evidence request packet](./stage-5b-evidence-request-packet.md).
The packet states the accepted origins, required mapping/date/status/result/
reviewer/provenance fields, path-safety and redaction rules, rejection meanings,
and post-acceptance review path. It is a control document, not evidence.

## Local-Only Candidate Inbox

Use one repo-relative local-only inbox for newly received records before source
preflight, candidate gate, intake, or dry-run review:

```text
local/stage5b-candidate-evidence-inbox/<package-slug>/
```

Typical local paths are:

```text
local/stage5b-candidate-evidence-inbox/<package-slug>/received-inspection-evidence.json
local/stage5b-candidate-evidence-inbox/<package-slug>/received-inspection-evidence.csv
local/stage5b-candidate-evidence-inbox/<package-slug>/source-preflight-report.json
local/stage5b-candidate-evidence-inbox/<package-slug>/candidate-gate-report.json
```

This inbox is intentionally ignored by git. It is only a staging area for
private supplier/lab/QA/physical-inspection material and local gate reports.
Do not commit raw records, secrets, private URLs, PII, or supplier/lab/QA
records from the inbox. The inbox itself is not canonical package evidence, and
files inside it are not `inspection_evidence`.

Create the package-scoped inbox, checklist, and JSON/CSV templates with:

```bash
fcad stage5b-evidence-source-kit --package <package-slug>
```

Then place the received source file under that ignored inbox and run:

```bash
fcad stage5b-evidence-source-preflight \
  --package <package-slug> \
  --source local/stage5b-candidate-evidence-inbox/<package-slug>/<received-record.json|csv|tsv> \
  --out local/stage5b-candidate-evidence-inbox/<package-slug>/source-preflight-report.json
```

The source preflight report checks that the raw source path exists, is ignored by
git, is not tracked, and contains package/part/revision mapping, inspection
date, origin type, completed status, feature IDs, units, measured values,
tolerances, per-feature result, overall result, and reviewer/approver
traceability. It also flags PII, private URLs, absolute local paths, tokens,
secrets, supplier-private originals, screenshots, CI artifacts, docs examples,
templates, fixtures, CAD/generated values, readiness reports, and surrogate
artifacts. The classification is only `ready_for_stage5b_review`,
`needs_more_source_detail`, or `unsafe_or_not_evidence`; even a ready report is
acquisition/preflight only and does not attach evidence, regenerate readiness,
or mark a canonical package ready.

Safe local flow:

1. Receive a completed physical, supplier, lab, or QA inspection record.
2. Run `fcad stage5b-evidence-source-kit --package <package-slug>`.
3. Place the received candidate JSON or CSV/TSV under the ignored local inbox.
4. Run `fcad stage5b-evidence-source-preflight --package <package-slug> --source <repo-relative-source> --out <local-inbox-report.json>`.
5. If preflight is not `ready_for_stage5b_review`, repair/redact/replace the source before continuing.
6. Run `fcad stage5b-evidence-review-dry-run --package <package-slug> --source <repo-relative-source> --out-dir output/stage5b-review-dry-run`.
7. Review `stage5b_evidence_review_dry_run_manifest.json`, especially source status, redaction findings, package mapping, candidate-gate rejection for review-scoped material, nested audit outputs, blockers, and the next authorization step.
8. Complete or reference a safe Stage 5B attachment authorization record that scopes the review manifest, source preflight, review candidate, package, redaction/provenance/mapping reviews, audit review, human authorizer, exact later attachment task boundary, and readiness-held truth.
9. Run `fcad stage5b-evidence-attachment-controller --review-manifest <review-manifest.json> --authorization-record <authorization-record.json> --out-dir output/stage5b-attachment-controller --dry-run`.
10. If the controller reports `hold_for_attachment_controller_blockers`, repair the exact blockers and rerun source-kit/preflight/review-dry-run/controller as needed.
11. Optionally run `fcad stage5b-evidence-pipeline-doctor --package <package-slug> --out-dir output/stage5b-evidence-pipeline-doctor` for the fixture-only regression guard.
12. Run the real candidate gate, intake, promotion dry-run, audit, attachment, or readiness regeneration later only if a separate task explicitly authorizes that review or mutation path. Later authorized attachment still needs validation, review, and deliberate `review-context --inspection-evidence --attachment-authorization` mutation outside this controller task.

For test-only orchestration validation without a real source, use:

```bash
fcad stage5b-evidence-review-dry-run \
  --package <package-slug> \
  --source local/stage5b-candidate-evidence-inbox/<package-slug>/synthetic-review-fixture.json \
  --out-dir output/stage5b-review-dry-run-fixture \
  --fixture
```

`--fixture` creates a synthetic ignored local-inbox source and labels the manifest as non-evidence. It proves orchestration behavior only; it does not produce a candidate that can satisfy canonical inspection evidence.

Before maintainers put a newly supplied JSON record into the Stage 5B intake/dry-run review path, run the local non-production candidate gate:

```bash
node scripts/stage5b-candidate-evidence-gate.js --candidate <repo-relative-json> --out local/stage5b-candidate-evidence-inbox/<package-slug>/candidate-gate-report.json
```

The gate only decides whether the supplied record is eligible for Stage 5B intake review. It is a checklist/control surface, not a promotion command. It does not run `review-context`, attach evidence, regenerate readiness, update standard docs, package a release bundle, or change canonical package state.

The report must show `eligible_for_stage5b_intake_review: true` before the record enters intake/dry-run review. It still does not prove readiness. The checklist requires:

- completed physical, supplier, lab, or QA inspection origin
- source/provenance and reviewer traceability
- package or part plus revision mapping
- inspection date, completed status, and pass/fail/partial result fields
- safe repo-relative attachment/provenance paths with no credentials, private URLs, absolute paths, `output/`, or `tmp/codex/`
- explicit rejection reasons when any requirement fails

The report contract is schema-backed by
`schemas/stage5b-candidate-gate-report.schema.json`. Reviewers should interpret
`decision.result: accept` and
`summary.eligible_for_stage5b_intake_review: true` as “eligible for later Stage
5B intake review only.” The report must also carry candidate path/source
metadata, `path_safety` redaction notes, `readiness_unchanged` fields, and
`non_evidence_boundary` fields proving that no evidence was attached or
promoted, no readiness was satisfied, and no canonical package artifacts were
mutated.

The gate fails closed for generated/control artifacts, diagnostics, schemas, fixtures, intake reports, promotion dry-run manifests, audit outputs, attachment authorization records, GitHub/CI metadata, screenshots, templates, guides, comments, PR bodies, docs artifacts, release bundles, and CAD-generated, simulated, inferred, or synthetic measurements. Fixtures used by tests are control/non-evidence examples only and must not be promoted or described as genuine package evidence.

## Pre-Attachment Review Checklist

Use this checklist only after a candidate gate report says
`summary.eligible_for_stage5b_intake_review: true` and
`decision.result: accept`. Passing this checklist authorizes intake review only;
it does not attach evidence, promote evidence, satisfy readiness, or mutate
canonical artifacts.

1. Accepted gate report: keep the accepted candidate gate report with the record
   under the ignored local inbox, and verify the report is schema-valid and
   non-mutating. Private retention copies can stay outside the repository when
   needed, but any later command/control ref used for canonical attachment must
   be a safe repo-relative reviewed/redacted ref.
2. Provenance and reviewer traceability: verify the candidate carries inspector,
   reviewer/approver, source reference, and traceability refs without relying on
   a PR body, comment, screenshot, release asset, generated report, or human-typed
   replacement value.
3. Package / part / revision mapping: confirm the package slug, inspected part,
   drawing or package revision, and measured feature refs map to one package
   without guessing.
4. Redaction and privacy review: remove or summarize private URLs, credentials,
   tokens, authorization headers, unnecessary PII, customer secrets, private
   machine paths, and raw supplier/lab/QA material before any tracked output or
   public review.
5. Path safety: use only safe repo-relative paths for control artifacts and
   future reviewed JSON; reject absolute paths, backslashes, traversal, `output/`,
   `tmp/codex/`, and any path outside the repository.
6. Next intake, dry-run, and audit commands: if a later task explicitly
   authorizes review, use the non-mutating command path:

   ```bash
   fcad inspection-evidence-intake --out <report.json>
   fcad inspection-evidence-promotion-dry-run --intake-report <report.json> --out <promotion_dry_run_manifest.json>
   fcad stage5b-evidence-audit --out-dir <dir>
   ```
7. Attachment authorization record: before any canonical mutation, complete or
   reference the [Stage 5B attachment authorization record](./stage-5b-attachment-authorization-record.md)
   as control metadata. It must confirm the accepted gate report, redaction/
   privacy review, provenance/reviewer traceability, package/part/revision
   mapping, intake/dry-run/audit review, human authorizer, and exact later task
   boundary. The record itself is not `inspection_evidence`.
8. Authorization before attachment: do not run `review-context
   --inspection-evidence`, `readiness-pack`, `generate-standard-docs`, or `pack`
   until a separate later task explicitly authorizes canonical mutation after
   validation and review.
9. Exact later attachment task boundary: name the later task, issue, PR, or
   change request that may run canonical mutation; no intake report, dry-run,
   audit, authorization record, or PR comment can expand that boundary by
   itself.
10. Readiness-held truth: until that later attachment task completes, readiness
   remains `needs_more_evidence` / `hold_for_evidence_completion`, and
   `inspection_evidence` remains missing.

## Attachment Authorization Record

Use the [Stage 5B attachment authorization record](./stage-5b-attachment-authorization-record.md)
at the future moment before any genuine inspection record is attached. It is
control metadata, not `inspection_evidence`, and records whether these
authorization prerequisites are complete:

- accepted candidate gate report
- redaction/privacy review complete
- provenance/reviewer traceability confirmed
- package/part/revision mapping confirmed
- intake/dry-run/audit outputs reviewed
- explicit human authorization before attachment
- exact later task boundary for attachment
- readiness remains held until authorized attachment occurs

Authorization records do not attach evidence, promote evidence, satisfy
readiness, or mutate canonical package artifacts. PR comments do not attach
evidence. The only later mutation boundary is an explicitly authorized task that
runs `review-context --inspection-evidence --attachment-authorization`, then refreshes readiness, standard
docs, and release packaging with verified outputs.

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

## Artifact/Schema Catalog

Use the [Stage 5B artifact/schema catalog](./stage-5b-artifact-schema-catalog.md)
when you need the concise map of each control output's producer, schema or
contract, location pattern, preview boundary, control/private status,
`inspection_evidence` status, and readiness effect. The catalog makes the
candidate gate report schema discoverable as
`schemas/stage5b-candidate-gate-report.schema.json`, while preserving that the
report is only a non-production control artifact and is never evidence.

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

- `review-context --inspection-evidence <PATH_TO_COMPLETED_REAL_JSON> --attachment-authorization <AUTHORIZATION_RECORD_JSON>`
- `readiness-pack`
- `generate-standard-docs`
- `pack`

Run that future chain only in a separate evidence-gated task after the evidence record has been validated, reviewed, and explicitly authorized in the Stage 5B authorization control record.

## Diagnostics Meaning

Validation diagnostics explain malformed Stage 5B control artifacts or unsafe inputs. CLI commands can write `validation_diagnostics.json` beside a failed output path. Tracked API and Studio jobs can expose sanitized diagnostics and, for Stage 5B validation failures, a `stage5b.validation-diagnostics` artifact.

Diagnostics are not evidence. They do not request human-entered measurements, attach package evidence, or change readiness.

## What Never Counts As Inspection Evidence

These sources do not satisfy `inspection_evidence`:

- diagnostics
- schemas
- fixtures
- ignored inbox files
- candidate gate reports
- attachment authorization records
- request packets
- docs and documentation artifacts
- generated CAD, drawing, quality, DFM, readiness, review, standard-doc, release, or manifest artifacts
- CAD measurements
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
2. Run `fcad stage5b-evidence-source-kit --package <package-slug>`.
3. Place the received source in `local/stage5b-candidate-evidence-inbox/<package-slug>/` without committing the raw/private file.
4. Run `fcad stage5b-evidence-source-preflight --package <package-slug> --source <repo-relative-source> --out <local-inbox-report.json>` and repair/redact/replace any `needs_more_source_detail` or `unsafe_or_not_evidence` result.
5. Serialize a reviewed/redacted JSON contract with explicit provenance and measured feature records for later candidate gate review.
6. Run `node scripts/stage5b-candidate-evidence-gate.js --candidate <repo-relative-json>` and review the checklist. Rejections stop the record before intake/dry-run review.
7. Run `fcad stage5b-evidence-review-dry-run --package <package-slug> --source <repo-relative-source> --out-dir <ignored-dir>` to produce the review manifest without copying raw evidence.
8. Complete or reference the Stage 5B attachment authorization record as control metadata only.
9. Run `fcad stage5b-evidence-attachment-controller --review-manifest <review-manifest.json> --authorization-record <authorization-record.json> --out-dir <ignored-dir> --dry-run`; any hold blocker stops the future attachment attempt.
10. Run `fcad inspection-evidence-intake --out <report.json>` only if the task explicitly authorizes intake review.
11. Run `fcad inspection-evidence-promotion-dry-run --intake-report <report.json> --out <promotion_dry_run_manifest.json>` and review blockers, match confidence, mutation boundaries, and rollback guidance.
12. Attach only when the controller and dry-run are attachment-ready and the separate later task explicitly authorizes canonical mutation.
13. Refresh `review-context --inspection-evidence --attachment-authorization`, `readiness-pack`, `generate-standard-docs`, and `pack` in that separate authorized task.

Until that happens, the readiness truth remains unchanged.

## Validation Commands

Use these checks after runbook, docs, command-surface, or source-of-truth changes:

```bash
git status --short
git diff --check
node tests/stage5b-candidate-evidence-gate.test.js
node tests/stage5b-evidence-source-kit.test.js
node tests/stage5b-evidence-attachment-controller.test.js
node tests/first-user-docs-smoke.test.js
node tests/stage5b-source-of-truth-guard.test.js
node tests/stage5b-artifact-catalog.test.js
node tests/stage5b-artifact-contracts.test.js
node tests/stage5b-surrogate-inspection-validation.test.js
node tests/stage5b-evidence-audit-cli-smoke.test.js
npm run test:stage5b:no-evidence
npm run test:node:contract
npm test
```

Use `npm test` before merging or when the change risk extends beyond docs/source-of-truth assertions. Do not claim runtime-backed FreeCAD validation unless `fcad check-runtime` and a real runtime-backed command or runtime smoke lane actually ran.
