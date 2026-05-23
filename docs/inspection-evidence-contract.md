# Inspection Evidence Contract

Inspection evidence means a genuine manufacturing or QA inspection record for a physical or supplier-inspected part. Examples include CMM reports, manual caliper checks, go/no-go gauge records, first article inspection, and supplier inspection reports.

The minimal contract lives in [`../schemas/inspection-evidence.schema.json`](../schemas/inspection-evidence.schema.json). It requires an `inspection_evidence` type, an inspected part or package, an inspection date/time, a source type, a safe source reference, and measured feature records with explicit result semantics.

Generated CAD quality, drawing quality, drawing QA, drawing intent, feature catalog, DFM, readiness, and review-pack artifacts remain useful review evidence, but they are not inspection evidence by themselves. Readiness reports `inspection_evidence` as present only when `review_pack.json` includes the explicit validated `inspection_evidence` ledger/source record written by `review-context`.

`fcad review-context --inspection-evidence <path>` accepts only JSON that validates against this contract. When valid, the file is recorded as an explicit review-pack evidence ledger/source record with a portable source ref. Readiness can recognize that explicit record as `inspection_evidence` coverage; generated quality and drawing artifacts still fail if passed as inspection evidence.

`fcad inspection-evidence-intake [--package <slug>] --out <report.json>` searches the allowed non-secret checkout sources and emits a machine-readable discovery/intake report. It classifies candidates as `genuine_valid`, `invalid_generated`, `invalid_schema`, `invalid_provenance`, or `no_candidate`. The command does not ask for human-entered measurements; if no genuine completed record is found, canonical packages stay `needs_more_evidence` / `hold_for_evidence_completion`.

The intake adapters can validate JSON contract files and row-oriented CSV, TSV, or Markdown tables with explicit inspection-evidence columns. Table normalization maps only values already present in the source rows, such as `source_type`, `inspected_part`, `inspected_at`, `units`, `overall_result`, `feature_id`, `measured_value`, `result`, and `measurement_method`; it does not infer or generate measurement values. A table candidate must still normalize to the JSON schema, carry safe repo-local provenance, and pass the same canonical package provenance gate. `review-context` remains a JSON-contract attachment path, so accepted table candidates must be serialized to `inspection_evidence.json` before canonical attachment.

Generated quality, DFM, readiness, review, standard-doc, release, manifest, and drawing artifacts are rejected even when they use CSV, TSV, Markdown, or inspection-shaped fields. Fixtures may prove parser behavior in tests, but they are rejected as canonical package evidence.

Tracked Studio/API intake reports are discovery/review artifacts only. They can help maintainers inspect searched source classes, accepted/rejected counts, rejection classes, and package readiness, but they are not package readiness evidence. Report preview is limited to registered tracked job artifacts; the browser supplies a job id and artifact id, not an arbitrary local file path.

A non-canonical fixture lives at [`../tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json`](../tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json) for schema and validator tests only. It demonstrates the contract shape but is not package readiness evidence, and canonical packages remain `needs_more_evidence` until genuine inspection evidence is added to those packages.

For each canonical package, including `quality-pass-bracket` and `hinge-block`, a non-canonical collection guide is available under [`inspection-evidence-collection/`](inspection-evidence-collection/). The guide is not readiness evidence; completed evidence must still be attached through `review-context --inspection-evidence` in a later Stage 5B flow.
