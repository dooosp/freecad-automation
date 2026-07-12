# Inspection Execution Handoff and Result Adapter

## Status

Implementation and verification are tracked independently. No item is complete until the corresponding focused test and regression evidence are recorded in the verification plan.

## Existing architecture

`inspection_plan.json` is the canonical generated plan. It can reach `ready_for_human_release`, and its supplier checksheet, request, and blank result template are generated control material. The blank template columns are currently `plan_id`, `plan_item_id`, `package_slug`, `revision`, `characteristic_id`, `control_material_notice`, `measured_value`, `measured_unit`, `result`, `completion_status`, `final_status`, `inspector_reference`, `reviewer_reference`, and `source_file_sha256`.

Inspection evidence follows a separate immutable lifecycle: discovery, quarantine, structural validation, semantic validation, authorization, attachment, and separately authorized readiness regeneration. The evidence envelope requires lifecycle, human review, authorization, provenance/custody, and attachment fields that a returned measurement file cannot establish.

## Boundary model

Plan generation, plan release, external completion, normalization, quarantine, authorization, attachment, and readiness regeneration are distinct operations. A plan release authorizes only execution with checksum-bound plan derivatives. Normalization produces an untrusted candidate and never creates an evidence envelope. Its maximum status is `ready_for_quarantine_review`.

## Plan release contracts

The human-authored authorization schema requires the exact decision `release_for_inspection_execution`, package/revision/plan identity, SHA-256 bindings for the plan and distributed derivatives, engineering and quality reviewers, releaser, timestamps, scope, confidentiality, notes, and explicit negative trust boundaries. The release-record command validates that control input against the snapshotted bytes and emits an immutable `released_for_inspection_execution` record. Changed bytes require a new authorization and record; v1 has no revoke or supersede command.

## Adapter design

The registry is static and allowlisted. Adapter identity and version are public contract fields. Pure adapter functions receive byte snapshots and context; they do not access filesystem, clock, environment, Git, network, FreeCAD, or evidence state. The sole v1 adapter is `plan-result-csv-v1` version `1.0`, the completed form of this repository's result template—not a generic CMM, spreadsheet, QIF, supplier, machine, or laboratory adapter.

The native CSV contract uses the existing template headers. Stable matching requires both `plan_item_id` and `characteristic_id`; row position and names have no authority. UTF-8 without BOM and LF/CRLF are accepted. Duplicate/blank headers, unknown columns, width mismatch, malformed quoting, formula-leading cells, decimal commas, non-finite values, duplicates, and unsupported repeated samples fail closed.

## Input snapshots and lineage

The orchestrator reads the inspection plan, release record, completed CSV, and submission metadata once as bounded, non-symlink, non-hardlinked regular files. Parsing, hashing, reconciliation, JSON, Markdown, and manifest generation use those same immutable buffers. The release record binds the blank template checksum. Exact blank bytes, trivial/incomplete completion, generated/synthetic markers, and inconsistent template identity remain blocked. Template lineage is provenance, never trust.

## Reconciliation

The service validates package, revision, plan ID/hash, release-record ID/hash, and per-row stable identities. It retains missing and unexpected items and blocks duplicates. Raw strings and raw units are preserved. Known dimensional conversions are allowlisted (`mm`, `in`, `inch`; angular units remain within their dimension), with deterministic numeric conversion and no pre-evaluation rounding. Incompatible or ambiguous units block the row.

Reported and computed results remain separate. Numeric computation occurs only for authoritative numeric inclusive limits with compatible units. Reported pass/computed fail blocks normalization; reported fail/computed pass is `review_required`; no limits or textual/unsupported rules yield `unable_to_determine`. `not_accepted` is preserved.

## Publication

JSON, derived Markdown, and the artifact manifest share one approved ignored output directory and are published through the existing atomic multi-file publisher. Traversal, NUL, backslash syntax, symlink directories/targets, hardlinks, collisions, target replacement, concurrent writers, and unsafe recovery are rejected. No canonical package file is written.

## CLI and product surfaces

Two CLI operations are added: `inspection-plan-release-record` and `inspection-result-normalize`. Both consume explicit control files; neither fabricates approval. Raw result normalization remains CLI-only in v1 because the existing tracked inspection-plan job does not provide a reviewed server-controlled source-reference contract for this raw external file class. No browser upload, top-level Studio tab, Local API path input, evidence action, or readiness action is added.

## Tests and rollout

Focused tests cover schema semantics, byte binding, deterministic output, adapter conformance, successful/review-required/blocked reconciliation, template rejection, hostile CSV/JSON, path safety, atomic replacement, concurrent publication, and rollback. Regression lanes cover inspection planning, evidence onboarding, manifests, source hygiene, Stage 5B, doctors, and the default suites. Rollback is removal of the additive commands, schemas, services, docs, and tests; existing plan/evidence contracts are unchanged.

## Unsupported v1 cases

QIF, XLSX, macros, formula evaluation, archive expansion, URLs, vendor exports, dynamic adapters, repeated samples/SPC, point clouds, locale decimal commas, unapproved units, name-based mapping, inferred tolerances/methods, and automatic envelope creation are unsupported.
