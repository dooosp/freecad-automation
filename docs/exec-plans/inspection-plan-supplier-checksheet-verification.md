# Inspection Plan and Supplier Checksheet Verification

## Objective

Prove deterministic planning, field-level authority, safe blank derived
documents, revision-impact linkage, output publication safety, integration
compatibility, and zero mutation of evidence/readiness/standard-doc/release
state.

## Focused verification

- schema plus semantic validation for complete, incomplete, conflicting,
  unsupported-unit, missing-identity/revision, duplicate-ID, and fabricated
  result fixtures
- full scope produces all supported explicit requirements
- delta scope requires a matching revision-impact report and preserves exact
  change IDs without changing evidence state
- standard-doc drafts and DFM suggestions never become authoritative
- fixed-time double generation yields byte-identical JSON, checksheet, request,
  template, and manifest source hashes
- atomic input replacement cannot mix source generations
- CSV quoting, CR/LF, duplicate headers, malformed CSV, and typed formula
  injection protection
- output traversal, NUL, absolute path, symlink, hardlink, target replacement,
  concurrent/partial publication, and interrupted recovery
- private URL, secret/token marker, raw supplier data, measured values, evidence,
  readiness, and release claims are rejected

## Integration verification

Run direct inspection-plan contract/service/CLI/job/API/Studio tests, then:

```bash
node tests/output-contract-cli.test.js
git diff --check
npm run check:source-hygiene
npm run test:node:contract
npm run test:node:integration
npm run test:snapshots
npm test
npm run test:py
npm run test:stage5b:no-evidence
npm run test:stage5b:pipeline-doctor
npm run bootstrap:doctor -- --clean
npm run maintainer:doctor -- --clean
npm run test:studio-browser-smoke
```

## Canonical immutability

Before and after validation record SHA-256 for the five canonical readiness JSON
and Markdown pairs, standard-doc tree, and release tree. Record canonical
inspection-evidence, authorization, and attachment-receipt counts. Confirm all
five packages remain `needs_more_evidence`, `hold_for_evidence_completion`, with
`inspection_evidence` missing. `git diff --name-only -- docs/examples` must be
empty.

## Completion gate

All focused and repository checks must pass, or the final status is `HOLD` with
the exact verified blocker. A read-only skeptical review must capture identical
`git diff --name-only` before and after review.

