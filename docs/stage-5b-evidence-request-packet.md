# Stage 5B evidence request packet

> **Authoritative v1 supersession:** this packet collects source material only. The legacy direct `review-context --inspection-evidence --attachment-authorization` plus ordinary `readiness-pack` sequence is disabled. Use [the quarantine-first onboarding contract](./inspection-evidence-contract.md) for any production attachment.

This packet is a request/checklist control document for suppliers, labs, QA
reviewers, and physical inspectors. It is not `inspection_evidence`, does not
attach evidence, and does not change readiness.

Current truth: no genuine completed inspection evidence has been found or
attached. Canonical packages remain `needs_more_evidence` with gate decision
`hold_for_evidence_completion` until a real completed record is validated,
reviewed, and deliberately attached in a later authorized task.

Hard evidence rule: Only genuine completed physical/supplier/lab/QA inspection
records can satisfy `inspection_evidence`.

## What To Send

Send the completed inspection record before maintainers run the candidate
evidence gate. Accepted origins are limited to:

- physical inspection of the part
- supplier inspection report
- lab inspection report
- QA inspection or first article inspection

Acceptable record examples include a CMM report, manual caliper check,
go/no-go gauge record, first article inspection, supplier QA report, or lab
measurement report. The record must contain measured feature results from the
inspection source. Do not infer, simulate, CAD-generate, or type replacement
measurements into a generated template.

## Required Fields

Provide these fields in the supplied JSON candidate or in the completed source
record that maintainers serialize to JSON:

| Need | Expected content |
| --- | --- |
| Package or part mapping | `package_id` and/or `inspected_part` matching the package being reviewed. |
| Revision mapping | `part_revision`, `drawing_revision`, `package_revision`, `inspected_revision`, or `revision`. |
| Inspection date | `inspected_at` or `inspection_date` from the completed inspection. |
| Completion status | `inspection_status`, `status`, `completion_status`, or `record_status` showing completed, final, closed, released, or approved. |
| Overall result | `overall_result` as `pass`, `fail`, or `partial`. |
| Inspector and reviewer | `inspector` or `inspection_author`, plus `reviewed_by`, `approved_by`, `qa_reviewer`, `reviewer`, or explicit traceability refs. |
| Provenance | `source_ref` or `source_file` identifying the completed record without secrets. |
| Feature evidence | `measured_features` with feature id, requirement/drawing ref when available, measurement method, units, measured value, tolerances when available, and feature result. |

Use `unknown` or `null` only when a field is genuinely unavailable and the
contract permits it. Do not invent missing package, feature, revision, or
measurement values.

## Attachment And Redaction Rules

Local-only inbox convention for maintainers: stage newly received JSON records
and candidate gate reports under:

```text
local/stage5b-candidate-evidence-inbox/<package-slug>/
```

Example local staging paths:

```text
local/stage5b-candidate-evidence-inbox/<package-slug>/received-inspection-evidence.json
local/stage5b-candidate-evidence-inbox/<package-slug>/candidate-gate-report.json
```

The inbox is ignored by git. Do not commit raw records, secrets, private URLs,
PII, or supplier/lab/QA records from this local staging area. The inbox is only
for pre-intake review; it is not a canonical attachment location and is not
`inspection_evidence`.

Use safe repo-relative paths for candidate JSON and provenance references. In a
later explicitly authorized attachment task, a reviewed/redacted contract record
may use a canonical package path such as:

```text
docs/examples/<package-slug>/inspection/inspection_evidence.json
```

Paths must not be absolute paths, contain `..`, use backslashes, point outside
the repository, point into `output/` or `tmp/codex/`, or include private local
machine details. Redact tokens, credentials, private URLs, customer secrets,
personal data that is not needed for traceability, and authorization headers
before handing the record to maintainers.

Attachments may be reviewed as source material, but only the validated
inspection-evidence JSON record can enter the Stage 5B intake/review path.

## Candidate Gate Command

After a completed record is supplied and serialized as a repo-relative JSON
candidate, maintainers run:

```bash
node scripts/stage5b-candidate-evidence-gate.js --candidate <repo-relative-json> --out <report.json>
```

The gate is non-production and non-mutating. It emits an accept/reject checklist
for intake review eligibility only. It does not run `review-context`, attach
evidence, regenerate readiness, update standard docs, package release bundles,
or change canonical package state.

## Candidate Gate Report Contract

The candidate gate report is a control artifact with schema
`schemas/stage5b-candidate-gate-report.schema.json`. Reviewers should read these
fields together:

The [Stage 5B artifact/schema catalog](./stage-5b-artifact-schema-catalog.md)
also lists this report with its producer, schema path, local/private preview
boundary, non-evidence status, and unchanged-readiness effect. Schema
discoverability does not make the report evidence. The
[Stage 5B attachment authorization record](./stage-5b-attachment-authorization-record.md)
documents the later human authorization metadata required before canonical
attachment; that record is control metadata, not `inspection_evidence`.

| Field | Meaning |
| --- | --- |
| `candidate.path` and `candidate.source_ref` | Sanitized candidate path/source metadata for the supplied record. |
| `summary.eligible_for_stage5b_intake_review` | `true` only when the record is eligible for a later authorized Stage 5B intake review. |
| `decision.result` | `accept` or `reject`; accept is not evidence attachment or promotion. |
| `checklist[]` | Pass/fail checklist items grouped by schema, origin, traceability, mapping, date/status/result, and evidence-boundary requirements. |
| `rejections[]` and `summary.rejection_codes` | Machine-readable rejection reasons that explain why a candidate cannot enter intake review. |
| `path_safety` | Safe repo-relative path, redaction, absolute-path, traversal, `output/`, `tmp/codex/`, private-machine-path, token, and credential boundaries. |
| `readiness_unchanged` | Canonical package readiness remains `needs_more_evidence` / `hold_for_evidence_completion`, with `inspection_evidence` still missing. |
| `non_evidence_boundary` | Generated/control artifacts, candidate gate reports, readiness reports, review packs, release bundles, screenshots, CI/GitHub metadata, and CAD-generated measurements are not inspection evidence. |

The report also records `report_contract.passing_report_means` as “eligible for
later Stage 5B intake review only” and lists what a passing report does not
mean: no evidence is attached, no evidence is promoted, readiness is not
satisfied, and canonical artifacts are not mutated.

## Rejection Meanings

Common rejection groups mean:

| Rejection area | Meaning |
| --- | --- |
| Schema or JSON shape | The candidate is not a valid inspection evidence JSON contract record. |
| Origin/status | The record is not clearly completed physical, supplier, lab, or QA inspection evidence. |
| Traceability | Inspector, reviewer, provenance, or traceability fields are missing or unsafe. |
| Package/part/revision mapping | The record cannot be mapped to the package, part, and revision without guessing. |
| Date/result | The inspection date, completed status, or pass/fail/partial result is missing. |
| Path safety/redaction | A path escapes the repo, uses `output/` or `tmp/codex/`, leaks credentials, or is not safely redacted. |
| Non-evidence boundary | The candidate is a generated/control artifact, documentation artifact, template, fixture, metadata, screenshot, release bundle, or CAD-generated measurement. |

## What Never Counts

Reject these as `inspection_evidence`, even if they contain inspection-shaped
fields:

- diagnostics
- schemas
- fixtures
- ignored inbox files and candidate gate reports
- attachment authorization records
- intake reports, promotion dry-run manifests, and audit outputs
- generated examples
- request packets, generated packets, templates, and collection guides
- screenshots
- comments, PR bodies, issue bodies, and review comments
- docs and generated documentation artifacts
- release bundles and release assets
- CAD outputs, CAD-generated measurements, drawing outputs, readiness reports,
  review packs, quality reports, DFM reports, and manifests
- CI/GitHub metadata, workflow metadata, check-run metadata, and GitHub links by
  themselves

## After Candidate Acceptance

If the gate report says `eligible_for_stage5b_intake_review: true`, the next
step is maintainer review through the Stage 5B intake and promotion dry-run
path:

```bash
fcad inspection-evidence-intake --out <report.json>
fcad inspection-evidence-promotion-dry-run --intake-report <report.json> --out <promotion_dry_run_manifest.json>
```

Acceptance by the candidate gate only means the record may enter intake/dry-run
review. It does not prove readiness, attach evidence, mutate canonical package
artifacts, or authorize promotion. A later task must explicitly approve any
canonical mutation through quarantine, validation, checksum-bound attachment authorization, immutable attachment, attachment-bound `review-context`, and a separate readiness-regeneration authorization.

Before that later mutation task, maintainers must complete or reference the
[Stage 5B attachment authorization record](./stage-5b-attachment-authorization-record.md).
It records accepted gate report review, redaction/privacy review, provenance/
reviewer traceability, package/part/revision mapping, intake/dry-run/audit
review, human authorization, exact later task boundary, and readiness-held
truth. The authorization record itself does not attach evidence, promote
evidence, satisfy readiness, or mutate canonical artifacts.

The authorization record checklist must state:

- accepted candidate gate report
- redaction/privacy review complete
- provenance/reviewer traceability confirmed
- package/part/revision mapping confirmed
- intake/dry-run/audit outputs reviewed
- explicit human authorization before attachment
- exact later task boundary for attachment
- readiness remains held until authorized attachment occurs

## Pre-Attachment Review Checklist

Use this concise checklist before any later authorized intake review for an
accepted candidate gate report. Passing the checklist still does not attach
evidence, promote evidence, satisfy readiness, or change package state.

1. Accepted gate report: confirm both
   `summary.eligible_for_stage5b_intake_review: true` and
   `decision.result: accept` in the candidate gate report.
2. Provenance and reviewer traceability: confirm inspector, reviewer/approver,
   source reference, and traceability refs are present and safely redacted.
3. Package / part / revision mapping: confirm package slug, inspected part,
   drawing/package revision, and feature refs map to the intended package without
   guessing.
4. Redaction and privacy review: remove tokens, credentials, authorization
   headers, private URLs, unnecessary PII, customer secrets, private machine
   paths, and raw supplier/lab/QA material before any tracked output or public
   review.
5. Path safety: use safe repo-relative paths only; reject absolute paths,
   backslashes, traversal, `output/`, `tmp/codex/`, and paths outside the repo.
6. Next intake, dry-run, and audit commands: only when a later task authorizes
   review, use the non-mutating command path:

   ```bash
   fcad inspection-evidence-intake --out <report.json>
   fcad inspection-evidence-promotion-dry-run --intake-report <report.json> --out <promotion_dry_run_manifest.json>
   fcad stage5b-evidence-audit --out-dir <dir>
   ```
7. Attachment authorization record: complete or reference the
   [Stage 5B attachment authorization record](./stage-5b-attachment-authorization-record.md)
   as control metadata before canonical mutation. Confirm the accepted gate
   report, redaction/privacy review, provenance/reviewer traceability,
   package/part/revision mapping, intake/dry-run/audit output review, explicit
   human authorization before attachment, exact later task boundary for
   attachment, and readiness remains held until authorized attachment occurs.
8. Authorization before attachment: do not bypass `inspection-evidence-quarantine`,
   `inspection-evidence-validate`, `inspection-evidence-authorize`, or
   `inspection-evidence-attach`. Attachment-bound `review-context` comes only
   after the immutable receipt, and readiness regeneration needs a second
   checksum-bound authorization.
9. Exact later attachment task boundary: name the later task, issue, PR, or
   change request allowed to run the authoritative quarantine-first onboarding sequence; PR
   comments, authorization records, gate reports, inbox files, catalogs,
   schemas, dry-runs, and audits do not attach evidence or expand that boundary
   by themselves.
10. Readiness-held truth: readiness remains `needs_more_evidence` /
   `hold_for_evidence_completion`, and `inspection_evidence` remains missing
   until genuine completed evidence is validated, reviewed, and deliberately
   attached.
