# Revision Impact and Reinspection Planning

Revision impact is a deterministic comparison of two normalized engineering
revisions. It answers what materially changed, which stable engineering and
inspection identities are affected, whether prior inspection evidence may still
apply, and which characteristics need future reinspection.

The output is engineering decision support. It is not inspection evidence, an
evidence authorization, a readiness decision, or a release approval.

## Public workflow

`compare-rev` remains the single public comparison entrypoint. Existing calls
continue to produce the legacy `revision_comparison` artifact. Add
`--impact-out` to request the canonical impact report and its derived Markdown
view:

```bash
fcad compare-rev \
  output/baseline_review_pack.json \
  output/candidate_review_pack.json \
  --out output/revision-impact/revision_comparison.json \
  --impact-out output/revision-impact/revision_impact_report.json \
  --generated-at 2026-07-11T00:00:00Z
```

Optional authoritative context can be supplied when it is available:

```bash
fcad compare-rev \
  output/baseline_review_pack.json \
  output/candidate_review_pack.json \
  --out output/revision-impact/revision_comparison.json \
  --impact-out output/revision-impact/revision_impact_report.json \
  --impact-md-out output/revision-impact/revision_impact_report.md \
  --baseline-readiness output/baseline_readiness_report.json \
  --candidate-readiness output/candidate_readiness_report.json \
  --baseline-config output/baseline_config.toml \
  --candidate-config output/candidate_config.toml \
  --baseline-evidence-envelope output/baseline_evidence_envelope.json \
  --baseline-evidence-receipt output/baseline_attachment_receipt.json \
  --generated-at 2026-07-11T00:00:00Z
```

The command succeeds when a valid analysis requires review or reinspection.
Malformed inputs, unsafe paths, invalid bindings, or invalid output contracts
fail before revision-impact output is published.

`--generated-at` is optional for normal use. When omitted, the impact report
reuses the timestamp captured for that `compare-rev` invocation. Supply a fixed
value when proving byte-identical output.

## Canonical outputs

- `revision_impact_report.json` is the canonical machine-readable artifact.
- `revision_impact_report.md` is rendered only from the final validated JSON.
- The embedded `reinspection_plan` is future work, not a second JSON contract.
- Tracked jobs register both files under their server-selected artifact
  directory. Studio never submits an output filesystem path.

For a fixed input set and fixed `--generated-at`, both output files are
byte-identical across runs. Change IDs, evidence-assessment IDs, and plan-item
IDs are SHA-256-derived from sorted semantic inputs; timestamps, randomness,
array position, and local paths are not identity inputs.

When impact output is requested, each review pack is read and validated once.
The legacy comparison, impact report, and input entries in the artifact
manifest share that in-memory snapshot and its SHA-256, so an atomic source-file
replacement during the run cannot mix revision generations across the bundle.

CLI output is restricted to repository-approved ignored roots (`output/` or
`tmp/codex/`). The JSON, derived Markdown, legacy comparison, and its manifest
must share one safe directory. Tracked execution uses only the server-selected
job artifact root. Callers cannot widen these boundaries by naming a source,
tracked, or canonical directory as an allowed root. Existing symlink/hardlink
targets and changed parent/target identities are rejected before publication;
catchable mid-publication failures roll all prepared report files back. A
directory lock prevents concurrent publishers from mixing generations, and a
durable content-hash journal recovers a process/power interruption before the
next preflight.

## What version 1 compares

Version 1 consumes normalized existing artifacts where available:

- canonical review packs and their declared, checksum-bound source artifacts;
- readiness reports and validated configs;
- drawing intent, extracted drawing semantics, and feature catalogs;
- create-quality, drawing-quality, drawing-QA, DFM, quality-risk, and evidence
  graph context;
- explicit inspection requirements and stable characteristic IDs;
- inspection-evidence envelope metadata and immutable attachment-receipt
  metadata from the onboarding contract.

It compares explicit feature and characteristic identity, nominal values,
tolerances, datum/reference requirements, drawing requirements, material,
manufacturing process, quality gates, criticality, inspection method, and
specification/evidence bindings.

Drawing-intent requirements and explicit `inspection_requirement` linkage
records are merged only by the same stable characteristic ID. Compatible fields
are combined; conflicting normalized values are blocked as
`unable_to_determine` instead of choosing one source silently.

Extracted drawing semantics, create/drawing quality, drawing QA, DFM, quality
risk, and evidence-graph records use bounded artifact-specific projections.
Only explicit intent, requirement, rule, risk, feature, node, or edge identities
are compared. Generated observations remain advisory: their changes require
human review and are not promoted to released nominal changes or completed
inspection results. A one-sided artifact surface or changed record without
trustworthy stable identity is blocked rather than interpreted as an entity
addition or removal.

The workflow reads sanitized metadata and checksums. It does not read or publish
private raw supplier/lab bytes unless an existing separately safe adapter has
already produced an allowed normalized artifact.

## Stable identity limitations

Authoritative mapping uses explicit identifiers such as feature-catalog
`feature_id`, drawing-intent IDs, matched semantic aliases, characteristic IDs,
evidence IDs, and explicit package/revision identity.

The workflow does not use array position as engineering identity. It does not
assume that renamed IDs are the same entity, does not promote SVG text IDs or
face indexes to stable design identity, and does not attempt generalized BREP
topology or geometric-similarity matching. Sequence-generated feature IDs are
used only when their source contract declares them stable enough for the
comparison.

Evidence graphs are control/provenance context only. Nodes such as
`source:<array-index>:...` are explicitly rejected as positional identity, and
graph changes never make generated material trusted inspection evidence.

When authoritative identity is absent or conflicting, the report keeps
`unable_to_determine` visible and requires human review. It does not guess.

Package slug is not inferred from a part name or `part_id`. Revision labels are
not invented. In particular, an unspecified `quality-pass-bracket` revision is
reported as an identity gap rather than silently assigned revision A.

## Deterministic change policy

Changes use a closed taxonomy covering metadata/revision identity, feature
addition/removal/modification, nominal/tolerance/datum/drawing requirements,
material/process, quality gates, critical characteristics, inspection methods,
specification references, evidence references, and unresolved identity.

Numeric values are compared exactly after an allowlisted unit normalization.
Length units support explicit millimetre and inch representations; unsupported
or conflicting units remain unable to determine. No approximate comparison is
silently applied.

Generation timestamps, temporary output paths, and host diagnostics may be
excluded only by the versioned normalization policy. Revision, checksums,
evidence/characteristic/specification identity, material, process, nominal,
tolerance, result semantics, authorization hash, and receipt hash are never
treated as volatile.

Stable-ID record collections are normalized independently of their source
array order. Arrays that are themselves engineering values (for example an
axis, coordinate, or datum sequence) retain order and are compared as ordered
values.

## What causes reinspection

Explicitly linked prior evidence requires reinspection when an authoritative
nominal changes, a tolerance tightens, a measurement datum/reference changes,
an explicitly governed inspection method requires a repeat, or a new critical
characteristic is added. A plan item includes only values, tolerances,
specifications, and methods present in authoritative input artifacts.

Each plan item starts as `not_started`, requires a human reviewer, and records
that later evidence attachment authorization and later readiness regeneration
would be separate operations. The report never creates measured or actual
values.

## What causes human review without automatic reinspection

Human review is required for loosened tolerances, removed features or
characteristics, changed material/process for process-sensitive characteristics,
metadata/specification provenance changes, revision increments without an
engineering-content change, and evidence applicability that cannot be proven.

A loosened tolerance does not automatically accept an older result. Removing a
requirement does not delete or supersede the old evidence record.

Content changes without a revision increment, package mismatches, missing
authoritative identity, and envelope/receipt/source checksum mismatches produce a
blocked decision until a human resolves the governance or binding conflict.

## Evidence applicability is not evidence mutation

Applicability states are `unaffected`, `review_required`,
`reinspection_required`, `potentially_stale`, `unable_to_determine`, and
`not_applicable`. Every assessment records
`authoritative_evidence_state_changed: false`.

Synthetic fixtures, generated CAD/QA output, QIF-lite control XML, CI artifacts,
review/readiness reports, and release artifacts are never trusted as completed
inspection evidence. They can provide engineering context only.

The workflow reuses the inspection-evidence onboarding envelope and receipt
contracts. It does not create parallel lifecycle, authorization, checksum,
quarantine, confidentiality, provenance, package-binding, or mutation-lock
definitions.

## Safety boundaries

Every report and Studio view makes these boundaries explicit:

- No inspection evidence was attached.
- Existing evidence was not mutated.
- No evidence was superseded.
- Readiness was not regenerated.
- A reinspection plan is not completed inspection evidence.
- Human review is required before any evidence or readiness action.

The workflow also does not mark a package ready, regenerate standard documents,
publish a release, create a tag, upload artifacts, or deploy anything.

## Studio flow

Use the existing Packs comparison surface:

1. Open a tracked candidate run.
2. Choose an older tracked run as the baseline.
3. Run Compare Revisions using the two registered review-pack references.
4. Open `revision_impact_report.json` from the generated Reports group.
5. Review baseline/candidate identity, material changes, evidence applicability,
   reinspection work, unresolved mappings, source hashes, and safety boundaries.
6. Reopen the tracked impact report later from Packs or Review.

Studio supports English and Korean labels through the existing lightweight
locale mechanism. It submits artifact IDs, not local paths, and the impact
artifact has no evidence, readiness, or release re-entry authority.

## Unsupported in version 1

- generalized geometric/topological equivalence or inferred design intent;
- AI/LLM change classification;
- approximate tolerance matching outside an existing explicit policy;
- measured-value generation or checksheet/CSV export;
- evidence authorization, attachment, supersession, or custody mutation;
- readiness/standard-document/release mutation;
- live FreeCAD-backed comparison.

Because the comparison is artifact-driven, a FreeCAD runtime is not required.
