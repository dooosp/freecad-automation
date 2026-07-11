# Stage 5B attachment authorization record

> **Legacy control record only:** this document does not satisfy the production `inspection_evidence_attachment_authorization` schema. The legacy direct `review-context --inspection-evidence --attachment-authorization`/ordinary-readiness sequence is disabled. Production authorization must be checksum-bound through [the onboarding contract](./inspection-evidence-contract.md).

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
or in an explicitly authorized private retention location when needed, but do
not use outside-root paths as canonical attachment or authorization refs. Any
later command/control ref used for canonical attachment must be a safe
repo-relative reviewed/redacted JSON ref. Do not copy raw supplier/lab/QA
material, private URLs, credentials, tokens, unnecessary PII, or private
machine paths into this tracked document.

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
   approved mutation scope, and completed structured reviews for redaction,
   provenance, package mapping, intake, dry-run, and audit. Authorization
   records do not attach evidence; PR comments do not attach evidence; comments
   or PR bodies alone do not satisfy readiness.
7. Exact later task boundary for attachment: name the later task, issue, PR, or
   change request that is allowed to run canonical mutation. That later task is
   the only boundary where the quarantine/validate/authorize/attach sequence may
   proceed. Attachment-bound `review-context` follows the immutable receipt;
   readiness regeneration requires a separate authorization.
8. Readiness remains held until authorized attachment occurs: confirm readiness
   remains `needs_more_evidence` / `hold_for_evidence_completion`, and
   `inspection_evidence` remains missing, until the later authorized attachment
   task completes validation, review, attachment, regeneration, and verification.

## Record Template

Fill this out in a later authorized attachment task or in a safe repo-relative
reviewed/redacted JSON control record that is safe to share. Keep raw private
retention material out of tracked docs; when canonical attachment is explicitly
authorized, use only safe repo-relative reviewed/redacted refs. Leave values as
`unknown` or `null` when they are unavailable; do not invent missing
measurements, reviewer data, provenance, or mapping.

| Field | Required entry |
| --- | --- |
| Package slug | One canonical package slug. |
| Candidate gate report ref | Ignored local-inbox path before attachment review, then a safe sanitized repo-relative reviewed/redacted control ref when canonical attachment is explicitly authorized. |
| Reviewed/redacted evidence JSON ref | Ignored local-inbox path before attachment review, then a safe sanitized repo-relative reviewed/redacted evidence JSON ref when canonical attachment is explicitly authorized. |
| Redaction/privacy reviewer | Structured `redaction_review` object with `status`, `reviewed_by`, and `reviewed_at`; status must be complete/final/closed/released/approved. |
| Provenance/reviewer traceability reviewer | Structured `provenance_review` object with `status`, `reviewed_by`, and `reviewed_at`; status must be complete/final/closed/released/approved. |
| Package/part/revision mapping reviewer | Structured `package_mapping_review` object with `status`, `reviewed_by`, and `reviewed_at`; status must be complete/final/closed/released/approved. |
| Intake report reviewed | Safe ref plus structured `intake_review`; control metadata only. |
| Promotion dry-run reviewed | Safe ref plus structured `promotion_dry_run_review`; control metadata only. |
| Audit output reviewed | Safe ref plus structured `audit_review`; control metadata only. |
| Human authorizer | Named maintainer/owner who authorizes the later attachment task. |
| Later attachment task boundary | Exact issue, PR, task, or change request allowed to run mutation. |
| Approved commands | For production onboarding: quarantine, validate, checksum-bound authorize, attach, attachment-bound `review-context`, and separately authorized readiness regeneration. This legacy record cannot authorize them by itself. |
| Readiness-held acknowledgement | Statement that readiness remains held until the later authorized attachment task completes. |

## Non-Evidence Boundary

Authorization records do not attach evidence, promote evidence, mutate canonical
package artifacts, or satisfy `inspection_evidence`.

Accepted gate reports, ignored inbox files, catalogs, schemas, dry-runs, audits,
diagnostics, PR comments, issue bodies, screenshots, release bundles, release
assets, CI/GitHub metadata, generated CAD/drawing/quality/DFM/readiness/review
artifacts, and human-typed or CAD-generated measurements are also not package
inspection evidence.

Use this record with the [Stage 5B operational runbook](./stage-5b-operational-runbook.md),
the [Stage 5B evidence request packet](./stage-5b-evidence-request-packet.md),
the [Stage 5B artifact/schema catalog](./stage-5b-artifact-schema-catalog.md),
and the [inspection evidence contract](./inspection-evidence-contract.md).
