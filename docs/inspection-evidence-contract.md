# Inspection Evidence Onboarding Contract

Inspection evidence is a genuine completed physical, supplier, lab, or QA
record for an inspected part or released drawing. Repository-generated CAD,
drawings, quality reports, readiness reports, CI output, QIF-lite control XML,
surrogates, examples, and test fixtures are not inspection evidence.

This repository now implements the software contract for onboarding such a
record. It still contains no genuine completed inspection record for any of the
five canonical packages. All five packages remain `needs_more_evidence` with
`hold_for_evidence_completion`.

## Authoritative schemas

- [`inspection-evidence-envelope.schema.json`](../schemas/inspection-evidence-envelope.schema.json)
- [`inspection-evidence-onboarding-record.schema.json`](../schemas/inspection-evidence-onboarding-record.schema.json)
- [`inspection-evidence-authorization.schema.json`](../schemas/inspection-evidence-authorization.schema.json)
- [`inspection-evidence-attachment-record.schema.json`](../schemas/inspection-evidence-attachment-record.schema.json)
- [`inspection-evidence-readiness-authorization.schema.json`](../schemas/inspection-evidence-readiness-authorization.schema.json)

The older [`inspection-evidence.schema.json`](../schemas/inspection-evidence.schema.json)
remains a compatibility/discovery shape. It is not sufficient for production
attachment because it does not, by itself, prove quarantine, checksum continuity,
authoritative revision, explicit authorization, or immutable attachment.

QIF-lite import is a narrow discovery adapter for inspection-shaped XML supplied
by a real physical, supplier, lab, or QA source. It is not a complete QIF
implementation and does not make XML attachment-ready; production onboarding v1
deliberately accepts only the bounded JSON and CSV containers described below.

For a newly supplied JSON record, maintainers may run the local
`stage5b-candidate-evidence-gate` before intake. Its accept decision means only
that the record may enter later authorized intake review. The candidate gate,
request packet, and Stage 5B attachment authorization record remain control
metadata: they do not attach evidence, satisfy readiness, or bypass the
onboarding quarantine, validation, and checksum-bound authorization chain.

## Minimum authoritative envelope

The final envelope records:

- package slug and authoritative package revision;
- inspected part, drawing, assembly, or lot identifier and revision. The schema
  can represent all four; v1 production attachment deliberately accepts only
  `identifier_type: part` exactly matching the canonical `config.toml` `name`.
  Authoritative drawing/assembly/lot mappings are not implemented;
- source organization and physical/supplier/lab/QA source type;
- inspection method, final status, completion timestamp, and overall result;
- inspector identity reference;
- reviewer identity, approval decision, and review timestamp;
- authorization id, authorizer reference, authorization timestamp, operation
  scope, authorization ref, and authorization checksum;
- measured characteristics with ids, values, units, results, and specification
  references;
- source document sanitized filename, media type, byte size, and SHA-256;
- immutable provenance and checksum-bound custody events;
- attachment request and canonical attachment timestamps;
- confidentiality and redaction classification; and
- a mandatory `synthetic` boundary. Production semantic validation requires
  `synthetic: false`; marked fixtures may validate structurally but are always
  rejected for production use.

The envelope never needs an absolute source path, private URL, token, credential,
authorization header, or unnecessary personal data. Privacy-preserving identity
references are allowed when they resolve through an authorized external system.

## State machine

```text
discovered -> quarantined
quarantined -> structurally_valid | rejected
structurally_valid -> semantically_valid | rejected
semantically_valid -> awaiting_authorization | rejected
awaiting_authorization -> authorized | rejected
authorized -> attached | rejected | superseded
attached -> superseded
rejected -> superseded
```

Every transition binds the unchanged source checksum, timestamp, actor reference,
and stable reason code. No operation can skip quarantine, validation, or
authorization. `rejected` cannot re-enter the flow; corrected bytes receive a new
content-addressed record. Supersession preserves the prior record rather than
overwriting it.

## Production operations

### 1. Quarantine

```bash
fcad inspection-evidence-quarantine \
  --candidate <received-source> \
  --envelope <candidate-envelope.json> \
  --package <canonical-slug> \
  --revision <authoritative-revision> \
  --actor <identity-ref>
```

The command reads regular non-symlink files with size limits, writes
content-addressed bytes only under ignored
`local/inspection-evidence-quarantine/`, and records sanitized basenames and
hashes. Copying a file into `docs/examples/` does not quarantine or authorize it.
Generated/control/synthetic/unsupported content becomes `rejected`, never
canonical evidence. Exact-byte copies of tracked repository artifacts are
rejected by tracked-file fingerprint even after rename. Ignored local inbox
files remain untrusted candidates and may enter quarantine; residence in the
inbox is never evidence status.

### 2. Validate

```bash
fcad inspection-evidence-validate \
  --record local/inspection-evidence-quarantine/<package>/<id>/onboarding-record.json \
  --actor <reviewer-ref>
```

Validation re-hashes the source and envelope, strictly checks the source
container, validates envelope structure, verifies physical/supplier/lab/QA
semantics, checks inspector/reviewer provenance, confidentiality, package and
authoritative revision equality, measured units/specification refs, and rejects
private paths/secrets/bypass fields. Success stops at `awaiting_authorization`
and prints the exact validated-record SHA-256 needed by authorization.

### 3. Authorize

```bash
fcad inspection-evidence-authorize \
  --record <onboarding-record.json> \
  --authorization <attachment-authorization.json> \
  --actor <authorizer-ref>
```

The separate authorization must bind the candidate checksum, candidate-envelope
checksum, validated ledger checksum, evidence id, package slug, package revision,
reviewer, distinct authorizer, confidentiality review, and `attach` operation.
The authorization reviewer timestamp must exactly match the quarantine ledger's
`semantically_valid` transition, so review cannot predate quarantine or be
replayed from an unrelated source review.
`force`, `override`, `exception`, waiver, and decision-journal claims cannot
bypass a required gate. Authorization metadata is not inspection evidence.

### 4. Attach

```bash
fcad inspection-evidence-attach \
  --record <onboarding-record.json> \
  --actor <same-authorizer-ref>
```

Attachment re-verifies every hash and the configured package revision, then uses
create-only writes for:

- `docs/examples/<package>/inspection/inspection_evidence.json`
- `docs/examples/<package>/inspection/inspection_evidence_candidate_authorized.json`
- `docs/examples/<package>/inspection/inspection_evidence_authorization.json`
- `docs/examples/<package>/inspection/inspection_evidence_onboarding.json`
- `docs/examples/<package>/inspection/inspection_evidence_attachment.json`

The candidate-envelope copy preserves the exact authorization-bound input bytes;
the attached envelope must validate as its exact allowlisted lifecycle transform.
The onboarding JSON is the immutable authorized-state snapshot; the last file is
the immutable trust anchor. It contains the source checksum,
candidate-envelope checksum, authorization id/hash, package revision, attachment
timestamp, immutable authorized-ledger snapshot hash, and resulting canonical
envelope/authorization hashes. Repeating the same fully bound attachment returns
the existing receipt; a conflicting source, revision, envelope, evidence id, or
authorization fails closed. The `superseded` state is represented but no
supersession command is implemented in this first version. Attachment records
the readiness JSON and Markdown hashes before and after and requires both to be
identical.
Before canonical writes, attachment creates an immutable ignored local recovery
plan bound to the actor, source/envelope/authorization/snapshot hashes,
attachment timestamp, and pre-attachment readiness hash. A retry after process
interruption may reuse only byte-identical partial canonical files; conflicts
fail closed.

The original received JSON/CSV bytes are not copied into the canonical package.
They remain in ignored quarantine or in the authorized supplier/lab/QA source
system; canonical files retain their checksum and sanitized external origin
reference. Immutable retention, access control, and backup for the original
record are operator responsibilities and an external production dependency.

`review-context --inspection-evidence` now requires the canonical authorization
and `--evidence-attachment-record`. It verifies the complete attachment chain
before ingest or any output write. A path-only evidence/auth pair fails closed.

### 5. Regenerate readiness separately

Regular `readiness-pack` rejects review packs that claim `inspection_evidence`.
After `review-context` has produced an attachment-bound canonical review pack, a
second human authorization must bind the attachment-record hash, review-pack
hash, current readiness JSON and Markdown hashes, package/revision, and canonical
readiness output path:

```bash
fcad inspection-evidence-regenerate-readiness \
  --attachment-record docs/examples/<package>/inspection/inspection_evidence_attachment.json \
  --authorization <readiness-authorization.json> \
  --review-pack docs/examples/<package>/review/review_pack.json \
  --out docs/examples/<package>/readiness/readiness_report.json
```

Regeneration before attachment, with a forged review-pack ledger/result summary,
or with stale hashes fails before readiness output is written. The command
re-verifies under an exclusive local mutation lock immediately before replacing
the two readiness artifacts. Attachment and every regular canonical-readiness
writer use that same package lock. Once an attachment receipt exists, regular
`readiness-pack` and legacy `readiness-report` writers fail closed for that
canonical target; only this separately authorized operation may replace it.
Both the requested JSON path and its derived Markdown path are checked for
canonical symlink, directory-alias, and hardlink identity. Regular writers use
temporary-file rename replacement so an output alias is never followed into a
canonical readiness inode.
Authorization timestamps more than five minutes in
the future are rejected as clock-chronology anomalies. Attached evidence with an overall failure or any
failed/not-accepted characteristic remains an explicit readiness hold; attachment
preserves the record but does not convert a nonconformance into readiness.

## Format support

Production control contracts and the authoritative envelope are strict JSON;
all JSON and CSV inputs require valid UTF-8 decoding without replacement
characters. Envelope, authorization, ledger, receipt, and readiness-control JSON
must use the deterministic two-space encoding with one trailing newline; duplicate
object keys are rejected before schema validation. This prevents last-key-wins
ambiguity in decisions, checksums, and synthetic/control markers.
The quarantined source document may currently be:

- JSON, parsed only for container integrity;
- CSV, checked for balanced quotes, unique/non-empty headers, row-width
  consistency, and row limits.

The onboarding flow never infers measurements from these containers. Existing
JSON/CSV/TSV/Markdown/TXT discovery adapters remain discovery aids only and
cannot authorize or attach records.

Deliberately unsupported for production onboarding are QIF/QIF 2.x/3.x,
QIF-lite, arbitrary XML, PDF, TSV/Markdown/TXT normalization, spreadsheets,
images, archives, CAD/FCStd/STEP/STL/BREP, drawings/SVG, CI artifacts, and
release bundles. The generated QIF-lite file is a repository control artifact,
not a QIF adapter and not evidence. A new adapter requires a genuine sample
requirement, bounded parser, validation corpus, and explicit contract update.

## Existing Stage 5B helpers

See the [Stage 5B artifact/schema catalog](./stage-5b-artifact-schema-catalog.md)
for the legacy discovery/control artifacts and their non-evidence boundaries.

`inspection-evidence-intake`, source preflight, candidate gate, review dry-run,
promotion dry-run, audit, attachment-controller, surrogate validation, and the
pipeline doctor remain discovery/review/control helpers. They never authorize or
attach evidence. A high-confidence discovery result is only eligible for
quarantine review; `attachment_ready` remains false and no direct canonical
command is emitted.

`fcad inspection-evidence-intake --out <report.json>` may inspect legacy JSON
records and CSV, TSV, or Markdown tables for discovery. That normalization does not infer or generate measurement values and never crosses the production trust
boundary. Tracked Studio/API intake reports are discovery/review artifacts only.
Report preview is limited to registered tracked job artifacts, never arbitrary
local paths. The marked fixture is not package readiness evidence. The guide is not readiness evidence; collection guides remain non-canonical worksheets.

The legacy acquisition helpers keep raw or private supplier/lab/QA records only
under ignored `local/stage5b-candidate-evidence-inbox/`. Private URLs, PII,
credentials, and raw records must not enter tracked control artifacts. Moving a
file from that inbox does not authorize or attach it; production receipt begins
again at the content-addressed quarantine boundary.

Optional public discovery remains bounded to HTTPS URLs on the explicit GitHub/GitHubusercontent host allowlist. A downloaded file remains an untrusted
candidate: host allowlisting is not provenance, authorization, or attachment.

## Current external dependencies

Software capability is implemented, but production readiness still needs real
completed inspection records, authoritative released inspection plans and
tolerances, source-organization confirmation, inspector/reviewer/authorizer
references, privacy/redaction decisions, operator-controlled immutable retention
of original source bytes, and authoritative package revision propagation.
`quality-pass-bracket` has no configured product revision today, so
its semantic gate fails closed. The other four configs declare revisions, while
their checked-in review/readiness artifacts still carry `revision: null`; that
upstream revision propagation must be resolved before a real readiness change.

Package-specific measurement requirements remain in
[`inspection-evidence-collection/`](inspection-evidence-collection/). Those
guides, nominal dimensions, and tolerance hints are control material—not
measurements and not a released inspection plan.
