# Revision Lineage Hardening Verification

## Execution result

- Internal repository verification: `PASS`
- Final skeptical read-only review: `PASS`
- External status: `HOLD_FOR_AUTHORITATIVE_BASELINE` and
  `HOLD_FOR_GENUINE_INPUT`; canonical readiness remains
  `hold_for_evidence_completion`
- Scope claim: verified internal G-01 foundation only, not completion of the
  roadmap's full Phase 1 external-packet criteria

## Objective

Prove that opt-in revision-lineage hardening binds one selected canonical
package to an explicit package slug, part ID, revision, authoritative config
digest, and exact parent bytes across the available internal chain. Verify
conditional revision-impact and downstream release/result/evidence contracts
with bounded fixtures when authoritative baseline or genuine inputs do not
exist. Prove at the same time that legacy/demo workflows remain compatible,
unrelated canonical packages remain byte-identical, and no evidence, readiness,
authorization, release, or publication claim is invented.

This is the required verification companion to
`docs/exec-plans/revision-lineage-hardening.md`. It was executed on
`codex/revision-lineage-hardening` from implementation base
`44d1d6bb64d36f3cb89714c1469a606a7f3c24a9`; ignored command evidence is kept
under `tmp/codex/`. The bounded canonical mutation is limited to the approved
source config and its byte-identical package-local descendant.

## Evidence locations

Keep task evidence ignored and local:

- `tmp/codex/revision-lineage-hardening-status.md`
- `tmp/codex/revision-lineage-hardening-tool-evidence.md`
- `tmp/codex/revision-lineage-hardening-verification-status.md`

Each entry records the command, exact base/HEAD, exit code, relevant hashes,
whether the result is pre-change/focused/regression/final, and any remediation.
Do not commit machine paths, credentials, private result bytes, or human
authorization material.

## Pinned preflight

Before implementation:

1. Prove repository root basename `freecad-automation`, branch, HEAD, default
   branch, and exact approved base.
2. Use a clean isolated worktree when the implementation base or branch differs.
3. Record available build, test, lint, typecheck, doctor, browser, and runtime
   commands from repository sources.
4. Record the selected package, exact tracked `config.toml`, and separately
   approved authoritative `package_slug`, `part_id`, and `revision`. The
   selection must authorize that source-config edit. If any is missing, stop
   with `HOLD` before edits.
5. Record `git status --porcelain=v1 -uall` and a deterministic path/SHA-256
   inventory for every tracked file under all five canonical package roots.
6. Pin an explicit selected-package write allowlist with two sections: the one
   authoritative source config and the generated descendant paths. Treat every
   other canonical path as denied.
7. Require `product.part_id === config.name` for the first proof. A non-equal
   part mapping stops for a separate compatibility design.
8. Record separately authoritative baseline config/review snapshots when
   selected-package revision impact is in scope; otherwise record
   `HOLD_FOR_AUTHORITATIVE_BASELINE` for that edge.
9. Run the relevant baseline tests and retain exact failures; do not silently
   relabel a baseline failure as task-related or weaken it to obtain a pass.

The historical planning base was
`9a54abb808b6844bd4efd35dec26e3907af9ab62`. The executed implementation pinned
its own approved base,
`44d1d6bb64d36f3cb89714c1469a606a7f3c24a9`, rather than assuming the planning
SHA remained current.

## Verification order

1. Verify pinned repository, worktree, package-selection, and allowlist state.
2. Hash all canonical package trees and record current evidence/readiness/release
   state.
3. Validate the shared identity contract and proof-mode activation boundary.
4. Exercise the pinned `review-context` CLI/job ingress, review → readiness
   propagation, and read-once source binding.
5. Exercise selected-package revision impact only with separately authoritative
   baseline/candidate inputs; otherwise verify its hold and use fixtures for the
   two-sided contract. Exercise the inspection plan on all available parents.
6. Exercise release/result and evidence authorization/attachment/readiness
   continuity with bounded fixtures, without unauthorized canonical mutation.
7. Exercise jobs, Local API, Studio/AF re-entry, manifests, and bundle checks.
8. Run fixed-time deterministic generation twice in ignored outputs.
9. If and only if separately authorized, regenerate the selected-package
   allowlist and verify all other canonical bytes are unchanged.
10. Run focused tests, repository regressions, doctors, and conditional
    browser/runtime checks.
11. Re-hash canonical packages and compare authority/readiness/release state.
12. Capture `git diff --name-only` immediately before and after skeptical
    read-only review. Any difference invalidates the review.

## Contract acceptance cases

### Selected-package internal rehearsal

For the selected package, demonstrate:

- the config explicitly contains the approved package slug, part ID, and
  non-null revision;
- the authorized source config is the only manually edited canonical file, and
  `product.part_id` equals the legacy `config.name` alias;
- the config bytes are read once and the recorded SHA-256 matches those bytes;
- `review-context --config ... --proof-lineage` and the equivalent job
  `config_path`/`options.proof_lineage` produce the same identity contract;
- review top-level and nested identity agree with the config;
- readiness identity agrees with review and binds the exact review digest;
- the inspection plan reconciles config, review, readiness, every available
  optional parent, and item identity/digests;
- tracked jobs, Local API, AF/Studio re-entry, manifests, standard docs, and
  bundles retain and revalidate the same identity and source digests.

The selected-package rehearsal may still end in
`needs_more_evidence` / `hold_for_evidence_completion`. Command success is not a
passing inspection, product release, or production-readiness claim.

### Conditional revision-impact rehearsal

When separately authoritative baseline inputs exist, demonstrate that baseline
and candidate have explicit identities/digests, share package slug and part ID,
and remain independent snapshots. The report subject and any delta plan bind
the candidate identity and exact report digest.

When they do not exist, require `HOLD_FOR_AUTHORITATIVE_BASELINE` for the
selected package. Use marked fixtures to verify the two-sided code contract;
never create baseline history from current descendants or filenames.

### Fixture-only controlled downstream contracts

Using clearly marked synthetic/non-production fixtures in ignored/test output,
prove release record, submission metadata, normalized result, evidence
envelope, attachment authorization/receipt, and readiness authorization retain
their existing exact bindings plus the new lineage checks. Do not create these
records for the selected canonical package merely to complete verification.

If genuine, separately authorized inputs already exist, they require their own
approved operational plan. Their absence is `HOLD_FOR_GENUINE_INPUT` for the
real downstream chain, not failure of this bounded internal implementation.

### Legacy compatibility

Demonstrate that callers without explicit proof activation retain current:

- public command names, options, routes, output filenames, and exit behavior;
- nullable historical artifact loadability;
- blocked/review-required behavior for missing identity;
- config-positional readiness compatibility guidance;
- artifact-manifest/output-manifest separation;
- English/Korean browser behavior and tracked-job state handling when touched.

Also prove that a legacy artifact cannot become proof-eligible merely because
it is moved, renamed, registered, bundled, or given a proof-looking marker.

## Adversarial identity matrix

| Case | Required proof-mode result |
| --- | --- |
| revision missing, `null`, empty, or whitespace | Reject before output |
| revision is object/array/non-string | Reject structurally or semantically |
| revision supplied only by default `"A"` | Reject as `defaulted_identity` |
| revision inferred from filename/path | Reject as `inferred_identity` |
| package slug or part ID missing | Reject before output |
| `product.part_id` differs from legacy `config.name` | Reject proof mode pending a separately designed mapping |
| directory slug differs from declared package slug | Reject; never normalize one into the other |
| top-level and nested review identity disagree | Reject before downstream use |
| one identity alias is present and another is missing | Reject in proof mode |
| baseline/candidate package or part differs | Block authoritative revision comparison |
| authoritative baseline is absent | Record conditional hold; never synthesize baseline history |
| content changes without revision change | Block as governance conflict |
| revision changes without engineering delta | Preserve provenance-review behavior; do not invent reinspection |
| config changes after validation | Reject stale snapshot; publish nothing |
| parent path is unchanged but bytes differ | Reject digest mismatch |
| inspection-plan item revision differs from package revision | Reject before plan publication/release |
| authorization binds an older plan/result/evidence hash | Reject as stale authorization |
| package/subject revision differs in evidence envelope | Reject before attachment |
| readiness authorization binds an older review/attachment | Reject before readiness write |
| legacy nullable artifact enters proof mode | Reject as proof-ineligible; keep legacy loadability |

Each negative case must assert a stable reason code, unchanged final outputs,
and no partial canonical write.

## Adversarial parser, path, and re-entry matrix

| Input or attack | Required result |
| --- | --- |
| duplicate JSON/TOML key | Rejected before semantic use |
| UTF-8 BOM, invalid UTF-8, excessive size/depth | Rejected before output |
| non-finite or malformed value | Rejected without coercion |
| absolute path, traversal, NUL, or backslash trick | Rejected/redacted; never serialized as trusted identity |
| symlink input/output escape | Rejected |
| unsafe hardlink output alias | Rejected |
| file replaced between validation and use | Rejected by read-once snapshot or final identity check |
| registered artifact bytes replaced after job metadata creation | Re-entry rejected |
| AF target marker or filename spoofed | Re-entry rejected without trusted identity and digest |
| bundle manifest altered | Bundle/re-entry rejected |
| bundle checksum file altered | Bundle/re-entry rejected |
| fixed-name ZIP member differs from bound digest | Bundle/re-entry rejected |
| shuffled object keys/semantic arrays | Fixed-time canonical output remains byte-identical |
| interrupted publication | Prior complete set restored or no final output |

## Focused test commands

The implementation should add focused tests with commands such as:

```bash
node tests/revision-lineage-contract.test.js
node tests/revision-lineage-propagation.test.js
node tests/revision-lineage-reentry.test.js
node tests/revision-lineage-cli-integration.test.js
```

Extend and run the relevant existing tests for:

- config schema and normalization;
- D review and C readiness contracts/builders;
- revision-impact contract, semantic service, fixture matrix, output safety,
  CLI integration, and tracked jobs;
- inspection-plan adversarial, release, result-normalization, and evidence
  onboarding/attachment/readiness contracts;
- AF execution, job store/executor, Local API, Studio bridge, artifact actions,
  artifact/output manifests, release bundles, and canonical package integrity.

Do not weaken fixtures, replace exact negative assertions with snapshots, or
remove legacy compatibility coverage to make proof tests pass.

## Required repository validation

Run and record exact exit status for the applicable commands:

```bash
npm ci
git diff --check
npm run check:source-hygiene
npm run test:node:contract
npm run test:node:integration
npm run test:snapshots
npm test
npm run test:v1:acceptance
npm run test:py
npm run test:stage5b:no-evidence
npm run test:stage5b:pipeline-doctor
npm run bootstrap:doctor -- --clean
npm run maintainer:doctor -- --clean
```

Run `npm run test:studio-browser-smoke` when Studio/browser code changes. Run a
real FreeCAD runtime lane only when runtime-backed code changes or the final
claim depends on FreeCAD. This feature is otherwise artifact-driven; do not
claim runtime validation merely because hosted artifact tests passed.

## Determinism and read-once proof

With a fixed timestamp and identical selected-package inputs, run each relevant
generator twice into separate ignored directories. Prove:

- corresponding canonical JSON and derived views are byte-identical;
- SHA-256 and size records agree with actual bytes;
- outputs contain no absolute path, private value, token, or machine-specific
  source locator;
- a source changed between runs changes the appropriate child digest and makes
  the prior authorization/reference stale;
- an atomic source replacement during one operation cannot mix two generations
  across review, readiness, impact, plan, or manifest outputs;
- proof-mode staged-set failure leaves the prior complete review/bundle set or
  no final set; fixture-only authorization/receipt tests make no canonical
  write.

## Canonical package immutability and bounded curation

Before and after every validation milestone, compare the complete path/SHA-256
inventory for:

- `docs/examples/quality-pass-bracket/`
- `docs/examples/plate-with-holes/`
- `docs/examples/motor-mount/`
- `docs/examples/controller-housing-eol/`
- `docs/examples/hinge-block/`

Before separately authorized curation, all five must remain byte-identical. For
the curation slice:

- only the one separately authorized source `config.toml` and the selected
  package's explicit derived-file allowlist may change;
- all other files in that package and all files in the other four packages must
  remain byte-identical;
- the source config identity declaration is the sole manual canonical edit;
  generated files must come from normal deterministic generators, not manual
  JSON editing;
- all descendant hashes/manifests must update coherently;
- no genuine evidence, measurement, external reference, human authorization,
  readiness pass, release, or publication may be fabricated;
- existing hold/missing-evidence truth must remain unless separately authorized
  real inputs justify a change.

Any unexpected canonical delta yields `HOLD` and invalidates the verification.

## Authority and lifecycle invariants

Record before and after counts/hashes/status for inspection-plan release
records, evidence envelopes, onboarding ledgers, attachment authorizations and
receipts, readiness authorizations/reports, standard documents, and release
bundles. Prove:

- attachment does not regenerate readiness;
- readiness regeneration has its own exact attachment/review authorization;
- inspection release is not product release;
- result normalization is not evidence attachment;
- proof-lineage validation grants no human decision or external authority;
- unavailable real evidence keeps the selected package held rather than being
  replaced by fixtures, generated QA, CI output, or copied metadata.

## Final skeptical review

Immediately before read-only review, record:

```bash
git status --short
git diff --name-only
git diff --check
```

The reviewer must focus on wrong-revision binding, stale digest use, alias
conflicts, legacy regressions, partial writes, unauthorized canonical mutation,
and overclaimed evidence/readiness/release state. Immediately after the review,
record `git diff --name-only` again. The two lists must match exactly; otherwise
the review is invalid and must be rerun.

## Completion gate

Mark implementation verification `PASS` only when:

1. one separately selected package has one explicit authoritative package slug,
   part ID, revision, config digest, and authorized source-config path;
2. every available internal parent-child edge agrees on identity and exact
   bytes; unavailable baseline/genuine/external edges have explicit holds;
3. all negative identity, stale-authorization, parser/path, re-entry, and
   partial-write cases fail closed with stable reasons;
4. legacy/demo behavior remains compatible and proof mode remains explicit;
5. deterministic reruns are byte-identical;
6. canonical changes are limited to the approved source config and generated
   selected-package allowlist, and the other four package trees are
   byte-identical;
7. fixture-only downstream checks pass without creating selected-package
   release/result/evidence/authorization records;
8. evidence, readiness, authorization, release, and publication truth is
   unchanged unless separately authorized real inputs require otherwise;
9. required repository checks pass or any baseline exception is independently
   reproduced and documented;
10. the final skeptical read-only review is valid and has no unresolved finding;
11. the result is reported as the internal G-01 foundation, not completion of
    the roadmap's full Phase 1 external-packet criteria.

If any condition is unmet, record `HOLD`, preserve the evidence, and stop. Do
not broaden scope or weaken a contract to manufacture completion.
