# Stage 5B attachment authorization record

This record is control metadata, not `inspection_evidence`. It documents the
future human authorization required before any genuine completed inspection
record is attached to a canonical package. It does not attach evidence, promote
evidence, satisfy readiness, mutate canonical artifacts, or replace the
inspection-evidence JSON contract.

Current truth: no genuine completed inspection evidence has been found or
attached. Canonical packages remain `needs_more_evidence` with gate decision
`hold_for_evidence_completion` until a genuine completed physical, supplier,
lab, or QA inspection record is validated, reviewed, authorized, deliberately
attached, and the downstream package artifacts are refreshed in a later task.

Hard evidence rule: Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.

Use this record only after the candidate gate report says
`summary.eligible_for_stage5b_intake_review: true` and
`decision.result: accept`. Keep raw/private records in the ignored local inbox
or another explicitly authorized private control location; do not copy raw
supplier/lab/QA material, private URLs, credentials, tokens, unnecessary PII,
or private machine paths into this tracked document.

## Authorization Checklist

Use this concise checklist at the future moment immediately before a later task
is allowed to attach a reviewed/redacted genuine inspection record.

1. Accepted candidate gate report: confirm the accepted candidate gate report is
   schema-valid, kept with the candidate in
   `local/stage5b-candidate-evidence-inbox/<package-slug>/` or another
   explicitly authorized local control path, and still says
   `summary.eligible_for_stage5b_intake_review: true` plus
   `decision.result: accept`.
2. Redaction/privacy review complete: confirm private URLs, credentials, tokens,
   authorization headers, unnecessary PII, customer secrets, private machine
   paths, and raw supplier/lab/QA material have been removed or summarized
   before any tracked output or public review.
3. Provenance/reviewer traceability confirmed: confirm the candidate carries
   inspector, reviewer/approver, source reference, and traceability refs without
   relying on a PR body, comment, screenshot, release asset, generated report,
   or human-typed replacement value.
4. Package/part/revision mapping confirmed: confirm the package slug, inspected
   part, drawing or package revision, and measured feature refs map to one
   package without guessing.
5. Intake/dry-run/audit outputs reviewed: confirm maintainers reviewed the
   non-mutating `inspection-evidence-intake`,
   `inspection-evidence-promotion-dry-run`, and `stage5b-evidence-audit`
   outputs for attachment readiness, blockers, match confidence, mutation
   boundaries, rollback guidance, and unchanged readiness truth.
6. Explicit human authorization before attachment: record the human authorizer,
   authorization timestamp, package slug, reviewed/redacted evidence JSON path,
   and approved mutation scope. Authorization records do not attach evidence;
   PR comments do not attach evidence; comments or PR bodies alone do not
   satisfy readiness.
7. Exact later task boundary for attachment: name the later task, issue, PR, or
   change request that is allowed to run canonical mutation. That later task is
   the only boundary where `review-context --inspection-evidence`,
   `readiness-pack`, `generate-standard-docs`, and `pack` may be run against the
   reviewed/redacted record.
8. Readiness remains held until authorized attachment occurs: confirm readiness
   remains `needs_more_evidence` / `hold_for_evidence_completion`, and
   `inspection_evidence` remains missing, until the later authorized attachment
   task completes validation, review, attachment, regeneration, and verification.

## Record Template

Fill this out in a later authorized attachment task or in a private control
record that is safe to share. Leave values as `unknown` or `null` when they are
unavailable; do not invent missing measurements, reviewer data, provenance, or
mapping.

| Field | Required entry |
| --- | --- |
| Package slug | One canonical package slug. |
| Candidate gate report ref | Safe repo-relative or private-control ref to the accepted report. |
| Reviewed/redacted evidence JSON ref | Safe repo-relative or private-control ref to the reviewed JSON contract record. |
| Redaction/privacy reviewer | Human reviewer and timestamp, or `unknown` if unavailable. |
| Provenance/reviewer traceability reviewer | Human reviewer and timestamp, or `unknown` if unavailable. |
| Package/part/revision mapping reviewer | Human reviewer and timestamp, or `unknown` if unavailable. |
| Intake report reviewed | Safe ref plus result summary; control metadata only. |
| Promotion dry-run reviewed | Safe ref plus attachment-ready/blocker summary; control metadata only. |
| Audit output reviewed | Safe ref plus readiness-held summary; control metadata only. |
| Human authorizer | Named maintainer/owner who authorizes the later attachment task. |
| Later attachment task boundary | Exact issue, PR, task, or change request allowed to run mutation. |
| Approved commands | Explicit command boundary, usually `review-context --inspection-evidence`, `readiness-pack`, `generate-standard-docs`, and `pack`. |
| Readiness-held acknowledgement | Statement that readiness remains held until the later authorized attachment task completes. |

## Non-Evidence Boundary

Authorization records do not attach evidence, promote evidence, mutate canonical
package artifacts, or satisfy `inspection_evidence`.

Accepted gate reports, ignored inbox files, catalogs, schemas, dry-runs, audits,
diagnostics, PR comments, issue bodies, screenshots, release bundles, generated
CAD/drawing/quality/DFM/readiness/review artifacts, and human-typed or
CAD-generated measurements are also not package inspection evidence.

Use this record with the [Stage 5B operational runbook](./stage-5b-operational-runbook.md),
the [Stage 5B evidence request packet](./stage-5b-evidence-request-packet.md),
the [Stage 5B artifact/schema catalog](./stage-5b-artifact-schema-catalog.md),
and the [inspection evidence contract](./inspection-evidence-contract.md).
