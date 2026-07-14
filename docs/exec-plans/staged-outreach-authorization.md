# Staged preliminary outreach authorization execution plan

## Goal

Replace the preliminary RFQ approval dependency on procurement and technical-release data with a narrow Gate A contract. The implementation records an immutable, hash-bound human decision for preliminary RFQ outreach only. It must not send a message, submit a form, authorize dispatch, or satisfy any later gate.

## Baseline and isolation

- Software base: `origin/master` at `bdb1db741c0f91c4581c898cb9ebb6da3ad678e7`.
- Software branch: `codex/staged-preliminary-outreach-authorization`.
- Software worktree: isolated local checkout on `codex/staged-preliminary-outreach-authorization`.
- Private operational artifacts remain ignored in a separate local operational worktree.
- The operational worktree already contains an authorized legacy v3 single-operator record. Its bytes and status are historical evidence and must not be rewritten. A corrected pending packet therefore uses the next packet revision.
- Dispatch remains `not_started`; the implementation contains no mail or contact-form transport.

## Gate model

| Gate | Purpose | Human decisions | Explicitly not satisfied by earlier gates |
| --- | --- | --- | --- |
| A — preliminary RFQ outreach | Request capability, assumptions, lead time, and a non-binding budgetary quotation. | Exact packet, recipient set, sender identity, sender account, confidentiality/default acceptance, approve/reject decision. | Procurement, technical release, inspection execution, evidence, readiness, and dispatch. |
| B — vendor selection and procurement | Select providers and authorize commercial commitment. | Quotes, selected providers, budget/contingency, tax/shipping/payment/commercial authority. | Never satisfied by Gate A. |
| C — technical release and inspection execution | Release exact manufacturing and inspection work. | Physical route, released requirements/methods, reviewers, package hashes, execution release. | Never satisfied by Gate A or B. |
| D — evidence and readiness | Review/authorize/attach evidence and regenerate readiness. | Existing evidence, attachment, receipt, and readiness authorizations. | Never satisfied by Gate A, B, or C. |

The tested domain policy is the machine-readable gate matrix. Gate A's required human fields are deliberately limited to packet hash, recipient IDs, sender identity, sender account, confidentiality/default acceptance, and decision. Budget, physical-part availability, engineering reviewer, and quality reviewer are required only as explicit deferred markers, never as completed Gate A values.

## Implementation scope

1. Add `schemas/preliminary-rfq-outreach-authorization.schema.json` with closed objects, exact operation scope, and a constant fixed-prohibition list.
2. Add a narrow domain service that:
   - reuses canonical JSON serialization, duplicate-key-safe parsing, SHA-256 helpers, and bounded JSON validation;
   - validates packet, recipient, message, subject, body, and attachment-bundle bindings;
   - parses a concise human response instead of requiring JSON editing;
   - derives timestamps, message and attachment hashes, counts, defaults, scope, prohibitions, and deferred decisions;
   - writes a new record with exclusive-create semantics and refuses overwrite;
   - exposes an explicit gate-consumption check that accepts only Gate A.
3. Add a maintainer-only script. It is intentionally absent from `fcad --help` and contains no dispatch path.
4. Add contract and CLI tests to the existing Node contract lane.
5. Repair the ignored operational packet as a new pending revision, preserving the legacy v2/v3 packets and technical-package bytes.

## Message identity contract

- UTF-8 without BOM.
- LF line endings.
- No trailing spaces.
- Exactly one final newline in each body.
- Subject hashes cover the exact UTF-8 subject bytes.
- Body hashes cover the exact normalized body bytes.
- Attachment bundle hashes cover a deterministic object containing bundle ID and ordered exact file bindings.
- Message-candidate hashes cover recipient ID, message ID/version, exact subject/body hashes and bytes, and attachment-bundle ID/hash.
- Changing recipient, subject, body, bundle membership, attachment bytes, or packet bytes invalidates authorization.

## Sender-account boundary

Connected-mail discovery is external to the repository service. A connector may supply a proposed account, but the account has no authority until the user repeats it in the exact packet approval. Git configuration and GitHub noreply addresses are forbidden as sending-account sources. No password, credential, or token is read or stored.

## Stop conditions

- Any required operational input or technical-package binding cannot be verified.
- A requested output would overwrite an existing authorization record.
- The packet hash in the human response differs from current packet bytes.
- Any recipient/message/attachment binding fails recomputation.
- A fixed prohibition is missing or a later-gate scope is requested.
- The operational state indicates a dispatch occurred during this task.

## Completion evidence

- Targeted Gate A tests and maintainer-helper integration test pass.
- `npm test` passes, or any unrelated baseline failure is reported with evidence.
- `git diff --check` passes.
- Operational technical inventory digest and draft-file hashes remain unchanged.
- Acquisition/dispatch status and outreach log prove no send or form submission.
