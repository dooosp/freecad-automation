# Staged preliminary outreach authorization verification plan

## Contract verification

Run the focused test directly and through the Node contract lane:

```sh
node tests/preliminary-rfq-outreach-authorization.test.js
npm run test:node:contract
```

The focused suite must prove:

- Gate A succeeds without budget, physical-part status, engineering reviewer, quality reviewer, technical release, evidence authorization, or readiness authorization.
- The strict schema rejects extra properties and any removal/reordering/substitution of fixed prohibitions.
- A valid Gate A record cannot be consumed as Gate B, C, or D authorization.
- `all-8` and explicit recipient subsets resolve only against stable packet recipient IDs.
- duplicate recipient IDs, unknown IDs, hash mismatch, malformed canonical JSON, duplicate JSON keys, warning omissions, and stale message/attachment hashes fail closed.
- sender identity and sender account are human inputs; GitHub noreply accounts fail.
- timestamps, approved message hashes, approved bundle hashes, maximum message count, packet version, operation scope, safe defaults, and deferred decisions are derived.
- immutable output uses exclusive creation and cannot overwrite an existing record.
- the maintainer helper writes only the authorization record and has no mail/form dispatch capability.

## Repository verification

```sh
npm test
npm run check:source-hygiene
git diff --check
git status --short
```

No FreeCAD runtime claim is needed because this task changes an authorization/control contract, not geometry or drawing execution.

## Operational verification

Before and after private packet repair, capture:

```sh
git status --short --branch
git diff --name-only -- docs/examples
shasum -a 256 output/genuine-inspection-acquisition/technical-package-draft/*
shasum -a 256 output/genuine-inspection-acquisition/technical_package_manifest.json
```

Verify all of the following:

- legacy packet v2 SHA remains `9f6fb57ea4b5090adcf0ae00035e1e4b450c1cf11a09c51a35bf8cf6a9d71829`;
- legacy authorized v3 and its authorization record remain byte-identical;
- technical inventory digest remains `c8140dd9533d551e3ff8337983b555db4c1f28d368428bbcc382600885fb856d`;
- the corrected packet is pending a new human decision;
- all eight stable recipient IDs, warning lines, unresolved requirements, subjects, messages, and bundle hashes recompute;
- the one-response request proposes the connected account but states that confirmation is required;
- no authorization record is created for the corrected packet without an exact user response;
- dispatch remains `not_started`, messages sent remain `0`, and contact forms submitted remain `0`.

## Skeptical read-only review

Immediately before review, capture `git diff --name-only`. Re-read the schema, service, helper, tests, and docs; rerun focused validation; then capture `git diff --name-only` again. If the file list changes during review, the review is invalid and must be repeated.
