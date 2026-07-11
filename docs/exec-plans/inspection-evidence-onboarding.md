# Inspection Evidence Onboarding

## Goal

Add the first production-safe contract for receiving, quarantining, validating,
reviewing, authorizing, and attaching genuine physical, supplier, lab, or QA
inspection records. Generated repository artifacts, CI output, QIF-lite control
XML, synthetic fixtures, and copied or renamed non-evidence must remain unable
to satisfy `inspection_evidence`.

This task implements software capability only. It does not create real
inspection records, attach evidence to a current canonical package, regenerate
canonical readiness, change a package from hold to ready, or publish a release.

## Pinned task context

- repository: `freecad-automation`
- task branch: `codex/inspection-evidence-onboarding`
- pinned starting commit: `32f52f8ed73419a77b309cd00c567cbb043c9c7a`
- default branch observed during preflight: `origin/master`
- isolated worktree: a local sibling worktree (absolute machine path retained only in ignored verification notes)

The task starts from the active evidence/readiness foundation rather than the
older default-branch tip. No merge, tag, push, upload, release, or production
readiness mutation is in scope.

## Planned scope

- define a versioned authoritative inspection-evidence envelope schema
- define checksum-bound authorization and immutable attachment-record schemas
- implement an explicit lifecycle with the states:
  - `discovered`
  - `quarantined`
  - `structurally_valid`
  - `semantically_valid`
  - `awaiting_authorization`
  - `authorized`
  - `attached`
  - `rejected`
  - `superseded`
- add quarantine-first CLI/service operations that persist only sanitized,
  repo-relative control references and content hashes
- require structural validation, semantic validation, package/revision matching,
  source checksum continuity, reviewer identity, and explicit scoped human
  authorization before attachment
- add an idempotent attachment operation that writes an authoritative envelope
  plus immutable receipt without regenerating readiness
- add a separately authorized readiness-regeneration gate that refuses to run
  before a verified attachment receipt exists
- harden canonical readiness recognition so a self-asserted review-pack ledger
  record cannot replace the attachment receipt/hash chain
- preserve existing discovery, dry-run, audit, review-context, and readiness
  commands where compatibility is safe
- add marked synthetic fixtures for parser and rejection tests only
- document exact remaining real-world evidence for all five canonical packages

## Authoritative evidence envelope

The final envelope must bind all of the following without private machine paths,
credentials, tokens, or raw secret URLs:

- package slug and authoritative package revision
- inspected part or drawing identifier and inspected revision
- source organization and source type (`physical`, `supplier`, `lab`, or `qa`)
- inspection method and final/completed inspection status
- inspection completion timestamp
- inspector identity reference or an authorized privacy-preserving identity ref
- reviewer identity, review timestamp, and review decision
- explicit authorization id, authorizer identity, timestamp, operation scope,
  authorization-record checksum, and bound source checksum
- measured characteristics with stable ids, measured values, units, results,
  and specification/drawing references
- source document filename, media type, byte size, and SHA-256 checksum
- immutable provenance/custody events using portable references only
- quarantine receipt timestamp and canonical attachment timestamp
- confidentiality classification and explicit redaction metadata
- a mandatory `synthetic: false` production boundary

An authorization record is control metadata and cannot satisfy
`inspection_evidence` by itself.

## Lifecycle and transition rules

The state ledger is append-only. Every transition binds the candidate SHA-256,
the previous state, the next state, a timestamp, an actor/reference, and a reason
code. Allowed transitions are:

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

There is no transition that skips quarantine, validation, or authorization.
Repeated attachment of the same package revision, source checksum, candidate
envelope checksum, and authorization id returns the existing receipt without
rewriting artifacts. A different binding fails closed. This first version
represents `superseded` in the state contract but deliberately provides no
supersession command; replacement remains unavailable until a separately
authorized supersession contract is implemented and verified.

## Operation boundaries

1. **Quarantine** copies a regular, non-symlink candidate into the ignored local
   quarantine, records a sanitized receipt, and never writes a canonical package.
2. **Validate** checks the envelope/source shape, content class, completion,
   measurements, privacy markers, package identity, authoritative revision, and
   checksum continuity. Validation cannot authorize or attach.
3. **Authorize** accepts only a separate schema-valid, human-scoped record bound
   to the exact ledger hash, candidate checksum, envelope checksum, package slug,
   and package revision. Exceptions cannot bypass a failed required gate.
4. **Attach** re-verifies every bound hash and state, uses coordinated
   create-only writes with rollback, preserves an immutable authorized-ledger
   snapshot as a canonical hash-bound artifact, and does not run readiness. An
   interrupted retry may reuse only byte-identical canonical files from the same
   immutable recovery plan; any conflict fails closed.
5. **Regenerate readiness** is a separate operation with separate authorization.
   It requires a verified attachment receipt and matching canonical artifact
   hashes before any downstream readiness command may run. Attachment, the
   authorized regeneration command, and all regular canonical-readiness writers
   share one package mutation lock; regular writers are blocked after attachment.

## Supported and unsupported formats

- The production onboarding envelope and control records are deterministic JSON
  with strict, fatal UTF-8 decoding; duplicate object keys and noncanonical
  control encodings are rejected before schema validation.
- JSON and CSV source documents may be integrity-checked as source containers.
  Measurements are never inferred from either container.
- Existing JSON/table discovery adapters remain discovery aids, not automatic
  authorization or attachment adapters.
- QIF-lite XML generated by this repository is control output and is rejected.
- Full QIF, QIF 2.x/3.x, QIF-lite, arbitrary XML, PDF, spreadsheets, images,
  CAD, drawings, archives, and CI artifacts are deliberately unsupported until
  genuine sample requirements justify a narrow adapter and validation corpus.

## Security and privacy constraints

- fail closed on malformed JSON/CSV, unsupported XML, generated/control content,
  incomplete inspections, missing inspector/reviewer/authorizer provenance,
  package/revision mismatch, checksum drift, duplicate conflicts, traversal,
  symlinks, and unauthorized exception fields
- reject CAD/drawing/quality/readiness/review/release/manifest/CI artifacts by
  path, media type, extension, artifact markers, and known content fingerprints
- detect synthetic fixture markers from content, not only path, so renaming or
  copying a fixture does not remove its non-evidence classification
- never persist the original absolute source path, home directory, secret URL,
  token, authorization header, or unnecessary personal data
- cap candidate size and parse depth/row counts before parsing
- use create-only canonical writes with rollback and never overwrite a
  conflicting attachment
- serialize attachment and every canonical readiness JSON/Markdown writer under
  one package lock; block regular readiness writers after attachment
- inspect both readiness output paths by real path and filesystem identity,
  reject symlink/hardlink aliases, and replace files by atomic rename
- keep quarantine and task-control outputs ignored and outside canonical package
  evidence directories

## Canonical package constraints

All five packages must remain `needs_more_evidence` with
`hold_for_evidence_completion` during this task. Checked-in generated artifacts
currently carry `revision: null`; `quality-pass-bracket` also lacks an
authoritative configured product revision. Production authorization therefore
must fail closed when a package revision cannot be proved, rather than infer a
revision from filenames or geometry.

## Progress evidence

Keep non-versioned task evidence under:

- `tmp/codex/inspection-evidence-onboarding-status.md`
- `tmp/codex/inspection-evidence-onboarding-tool-evidence.md`
- `tmp/codex/inspection-evidence-onboarding-verification-status.md`
- `tmp/codex/repo-preflight.json`
