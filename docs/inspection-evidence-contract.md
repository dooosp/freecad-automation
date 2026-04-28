# Inspection Evidence Contract

Inspection evidence means a genuine manufacturing or QA inspection record for a physical or supplier-inspected part. Examples include CMM reports, manual caliper checks, go/no-go gauge records, first article inspection, and supplier inspection reports.

The minimal contract lives in [`../schemas/inspection-evidence.schema.json`](../schemas/inspection-evidence.schema.json). It requires an `inspection_evidence` type, an inspected part or package, an inspection date/time, a source type, a safe source reference, and measured feature records with explicit result semantics.

Generated CAD quality, drawing quality, drawing QA, drawing intent, feature catalog, DFM, readiness, and review-pack artifacts remain useful review evidence, but they are not inspection evidence by themselves. Readiness reports `inspection_evidence` as present only when `review_pack.json` includes the explicit validated `inspection_evidence` ledger/source record written by `review-context`.

`fcad review-context --inspection-evidence <path>` accepts only JSON that validates against this contract. When valid, the file is recorded as an explicit review-pack evidence ledger/source record with a portable source ref. Readiness can recognize that explicit record as `inspection_evidence` coverage; generated quality and drawing artifacts still fail if passed as inspection evidence.

A non-canonical fixture lives at [`../tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json`](../tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json) for schema and validator tests only. It demonstrates the contract shape but is not package readiness evidence, and canonical packages remain `needs_more_evidence` until genuine inspection evidence is added to those packages.

For `quality-pass-bracket`, a non-canonical collection guide is available at [`inspection-evidence-collection/quality-pass-bracket.md`](inspection-evidence-collection/quality-pass-bracket.md). The guide is not readiness evidence; completed evidence must still be attached through `review-context --inspection-evidence` in a later Stage 5B flow.
