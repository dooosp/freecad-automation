# Stage 5B evidence request packet

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

Use safe repo-relative paths for candidate JSON and provenance references, for
example:

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
- intake reports, promotion dry-run manifests, and audit outputs
- generated examples
- generated packets, templates, and collection guides
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
canonical mutation through `review-context --inspection-evidence`,
`readiness-pack`, `generate-standard-docs`, and `pack`.
