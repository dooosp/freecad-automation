# Preliminary RFQ outreach authorization

Preliminary RFQ outreach is permission to ask a bounded question. It is not permission to buy, release, manufacture, inspect, ship, attach evidence, or regenerate readiness.

## Four separate gates

Gate A permits only a non-binding request for capability, assumptions, lead time, clarification questions, and budgetary quotation. The human approves exact packet bytes, stable recipient IDs, sender identity/account, confidentiality handling, and the preliminary-outreach decision.

Gate B is vendor selection and procurement. It requires actual quotations, selected providers, budget and contingency, tax/shipping/payment treatment, and commercial authority. A Gate A record is structurally and semantically unusable for Gate B.

Gate C is technical release and inspection execution. It requires the physical-part route, released tolerances and measurement methods, material/finish/deburr/sampling requirements, engineering and quality reviewers, exact technical-package hashes, and a release-for-execution record. Gate A and B records cannot satisfy it.

Gate D uses the existing evidence review, attachment authorization, attachment receipt, readiness authorization, and readiness regeneration contracts. No earlier gate satisfies Gate D.

Dispatch is also separate from Gate A. Recording authorization creates one local control JSON file; it has no email or contact-form transport.

## Human decisions and safe defaults

The human must provide:

- `decision: approve`;
- the current full packet SHA-256;
- approved recipient IDs (or `all-8` for the packet's exact eight candidates);
- an accountable sender identity;
- the confirmed connected sending account;
- confidentiality classification or acceptance of the safe defaults.

The service may derive these defaults when `accept_safe_defaults: yes`:

- confidentiality classification `internal`;
- confidentiality notice required;
- reminders disabled;
- factual clarification replies disabled;
- budget disclosure disabled.

The timestamp, approved message/bundle hashes, counts, packet version, operation scope, and fixed prohibitions are always derived. The user does not type them.

Budget ceiling, physical-part availability, engineering reviewer, quality reviewer, vendor selection, procurement approval, and technical release approval remain explicit deferred decisions. Their absence cannot block Gate A.

## Exact binding and invalidation

Each recipient uses a stable semantic ID. Each candidate includes exact recipient ID, message ID/version, subject/body, subject/body SHA-256, attachment-bundle ID/SHA-256, and full candidate SHA-256. Attachment bundles bind ordered file paths, sizes, and SHA-256 values.

Message bodies are UTF-8 without BOM, use LF, contain no trailing spaces, and end with exactly one newline. Any recipient, subject, body, attachment, bundle membership, message version, or packet-byte change invalidates the authorization. The record stores the full packet SHA and selected candidate hashes so a later dispatcher must reverify the same bytes.

## Sender-account confirmation

A connected Gmail or mail connector may safely expose the current account address as a proposed value. The proposal is displayed in the one-response request, but it has no authority until the human confirms it for the exact packet. Multiple connected accounts require an explicit selection. With no connected account, the packet reports `sender_account_unavailable` and cannot be authorized. Passwords are never requested, Git configuration is not consulted, and GitHub noreply accounts are rejected.

## One-response approval

The maintainer records a decision from this concise text format instead of editing JSON:

```text
APPROVE PRELIMINARY RFQ OUTREACH

packet_sha256:
<exact 64-character packet SHA-256>

recipients:
all-8

sender_identity:
user:taeho-jang

sender_account:
email:<confirmed-connected-account>

confidentiality:
internal

accept_safe_defaults:
yes

decision:
approve
```

The service parses this response, verifies the packet and every selected binding, derives the immutable record, validates it against the strict schema, and creates the output with no-overwrite semantics. It neither drafts nor sends a message. A separate later dispatch operation must still verify recipient endpoints and every hash before sending.
