# Revision Lineage Hardening

## Status and pinned context

- Plan state: `PLAN_ONLY`
- Implementation state: `NOT_STARTED`
- Repository: `freecad-automation`
- Planning base: `origin/master` at
  `9a54abb808b6844bd4efd35dec26e3907af9ab62`
- Planning branch: `codex/revision-lineage-hardening-plan`
- Roadmap target: the internal repository portion of G-01 in
  `docs/architecture/target-architecture-and-roadmap.md`; this plan does not
  close the roadmap's full Phase 1 external-packet exit criteria
- Verification companion:
  `docs/exec-plans/revision-lineage-hardening-verification.md`

This planning change authorizes no implementation, canonical-package
regeneration, evidence mutation, human authorization, release, publication, or
production-readiness claim. It does not move or modify the frozen Studio UAT
candidate at `3b2752e76e13e9f3cfa37d9edfb32a80b5b8b80d`.

## Goal

Add an explicit, opt-in production-proof lineage mode for one separately
selected canonical package. The mode makes one declared package slug, part ID,
revision, and exact authoritative config digest agree across the available
internal review, readiness, revision-impact, inspection-planning, manifest,
job, re-entry, and bundle chain. Downstream release/result/evidence code is
hardened with fixture-only contract tests unless genuine, separately authorized
inputs already exist.

Proof mode must reject missing, null, blank, inferred, silently defaulted,
conflicting, or stale identity. It must preserve the current legacy/demo
behavior for callers that do not opt in, including loadability of nullable
historical artifacts and the current blocked/hold outcomes for incomplete
identity.

The result is the internal G-01 foundation, not completion of the roadmap's
Phase 1, a new workflow platform, or a production-proof index. Phase 1 remains
open until authoritative baseline history and external packets also agree. The
index remains deferred until real pilot fields and external records exist.

## Why this is the next technical gap

The architecture gap register identifies revision propagation as G-01 because
canonical configs can declare a revision while their review/readiness
descendants remain unknown. The current repository also contains these specific
weak points:

- `lib/config-canonical-schema.js` leaves `product` optional and unconstrained,
  while canonical examples use `product.revision` inconsistently and
  `quality-pass-bracket` declares no revision.
- `src/agents/common.js` can supply revision `"A"` when one is absent, and the
  ingestion adapters in `scripts/ingest_context.py` and
  `scripts/adapters/common.py` can derive identity from filenames.
- `schemas/review_pack.schema.json` and
  `schemas/d_artifact_common.schema.json` permit independent top-level and
  nested identity values without a cross-field equality rule.
- `src/workflows/canonical-readiness-builders.js` treats some identity conflicts
  only when both sides are present, so missing-versus-present identity can pass
  farther than proof mode should allow.
- `src/services/revision-impact/revision-impact-service.js` does not consume the
  canonical config vocabulary consistently; it can miss `product.revision` and
  `product.part_id`.
- `src/services/inspection-plan/inspection-plan-service.js` snapshots several
  inputs but does not reconcile one authoritative identity and parent-digest
  chain across all of them.
- AF execution, job storage, Local API resolution, Studio bridging, and bundle
  re-entry authenticate artifact shape/markers more strongly than they retain
  and revalidate the exact source bytes.
- Existing inspection-plan release, result normalization, and evidence
  onboarding already contain strong exact-hash bindings. The hardening work
  must connect to those controls without weakening or duplicating them.

## Architecture before the change

```text
config product.revision (optional)
  -> review identity (top-level and nested, independently nullable)
  -> readiness identity (nullable compatibility surface)
  -> revision impact / inspection plan (partial reconciliation)
  -> release / result / evidence controls (stronger local bindings)
  -> jobs / API / Studio / bundles (artifact marker and path oriented re-entry)
```

Identity aliases, filenames, paths, artifact markers, and digests currently
carry different pieces of meaning. No single semantic gate proves that every
child belongs to the same declared engineering revision and exact parent bytes.

## Architecture after the change

```text
separately selected canonical package
  -> explicit authoritative config identity + config SHA-256
  -> shared normalized lineage contract
  -> review pack + exact config parent
  -> readiness + exact review parent
  -> [when an authoritative baseline exists]
       revision impact + exact baseline/candidate parents
  -> inspection plan + reconciled available parents
  -> fixture-verified existing release/result/evidence exact-byte controls
  -> digest-preserving jobs / API / re-entry / bundle validation
```

Each arrow is a tested semantic equality and digest-binding boundary. A path or
filename is only a locator. It is never engineering identity or proof that the
bytes have not changed.

## Authoritative identity contract

Proof mode normalizes one identity object:

```json
{
  "package_slug": "explicit-stable-slug",
  "part_id": "explicit-part-number-or-id",
  "revision": "explicit-engineering-revision",
  "config_sha256": "64-lowercase-hex-characters"
}
```

The implementation must obey all of the following:

1. A human separately selects exactly one canonical package for the first
   implementation rehearsal. This plan does not select it.
2. The same decision explicitly authorizes editing that package's exact tracked
   `config.toml` as the authoritative source. The source-config path and the
   derived descendants are separate entries in the selected-package allowlist.
3. The selected config explicitly declares `product.package_slug`,
   `product.part_id`, and `product.revision`. `part_id` is the repository
   artifact vocabulary for the roadmap's part-number concept.
4. In proof mode, `product.part_id` is authoritative. The top-level
   `config.name` remains the legacy alias and must equal `product.part_id` for
   the first proof. The current onboarding reader migrates to the explicit
   field in proof mode and may fall back to `config.name` only in legacy mode.
   A desired non-equal mapping is a stop condition requiring a separate design.
5. The package directory slug, declared package slug, part ID, and revision are
   compared; none is derived from another.
6. The authoritative config is read once, validated, hashed, and reused from
   that exact snapshot for the operation. Validation and later use cannot read
   different generations of the file.
7. Engineering revision and artifact SHA-256 are separate required facts. One
   can never substitute for or be derived from the other.
8. Existing duplicate identity fields remain compatible, but proof mode
   requires top-level, nested, and alias values to agree exactly after bounded
   normalization.
9. Every proof child retains its own artifact type/schema version, normalized
   identity, and digest-bearing references to the exact trusted parents used to
   create it.
10. Parent bytes are re-hashed at trust boundaries. A matching path with changed
   bytes is stale input and must fail before output publication.
11. Stable reason codes distinguish missing, inferred, defaulted, conflicting,
   malformed, stale-parent, digest-mismatch, and unsupported-legacy cases.
12. A proof-lineage failure cannot be downgraded to a warning by a renderer,
    tracked-job adapter, API bridge, or browser surface.

The shared normalized shape should live in one focused pure contract module,
for example `lib/revision-lineage-contract.js`. Existing artifact schemas may
gain optional additive lineage/source-reference fields where digest binding is
missing. Do not introduce a third manifest system or a generic wrapper artifact
around every existing JSON document.

### Two-sided revision-impact authority

The selected package identity is the candidate/current side. Authoritative
revision impact additionally requires a separately supplied immutable baseline
config and review snapshot with its own explicit package slug, part ID,
revision, and digests. Baseline and candidate must share package slug and part
ID, while each revision remains explicit. Do not reconstruct a baseline from a
filename, current descendant, or copied revision string.

When the baseline exists, the revision-impact report's subject and any
downstream delta inspection plan bind the candidate side plus the exact report
digest. When it does not exist, selected-package revision-impact rehearsal is
`HOLD_FOR_AUTHORITATIVE_BASELINE`; fixture tests still validate the two-sided
code contract, and a full-scope inspection plan may validate the other
available identity edges without claiming the roadmap Phase 1 exit.

## Activation and compatibility boundary

Proof behavior must be explicit. Pin these representations:

- CLI: the valueless flag `--proof-lineage`, accepted only when its parsed value
  is strictly `true`;
- tracked jobs: `options.proof_lineage: true`, validated as a boolean and only
  on supported job types;
- internal services: `requireAuthoritativeLineage: true`.

The proof gate composes with the existing `strictReentry: true` behavior; it
does not rename, overload, or weaken that gate. Every command option allowlist,
closed job schema, executor, result, and manifest must explicitly carry the
effective policy so a continuation cannot silently downgrade it.

Never activate proof mode from a directory name, filename, package path,
artifact marker, schema version, or the mere presence of a lineage field.
Browser/job requests that need proof validation must carry the explicit policy
through the request contract; there is no hidden auto-upgrade.

The first proof-capable review ingress is pinned to `review-context`:

- CLI adds `--config <config.toml|json> --proof-lineage`;
- the `review-context` job branch adds `config_path` plus
  `options.proof_lineage: true`;
- the executor passes `authoritativeConfigPath` and
  `requireAuthoritativeLineage: true` to the pipeline;
- existing `--part-id` and `--revision` remain legacy inputs, but in proof mode
  they may only agree with the config and can never replace it;
- Studio continues to reject inline `config_toml` and arbitrary browser paths.
  A proof continuation may use only a server-resolved safe `config_path` whose
  digest is retained in job metadata; otherwise the proof action is unavailable
  rather than silently downgraded.

The older standalone `review-pack` and `ingest` producers remain proof-ineligible
until they gain the same authoritative config snapshot contract.

| Boundary | Existing entrypoints | Required proof behavior |
| --- | --- | --- |
| Review production | `review-context`; standalone `review-pack`/`ingest` remain proof-ineligible | Require `--config`/`config_path` plus explicit proof policy; reject conflicting caller identity; emit agreeing top-level/nested identity and config digest |
| Readiness | `readiness-pack`, `readiness-report --review-pack` | Require exact review identity/digest and propagate it; missing-versus-present identity fails before publication |
| Revision assessment | `compare-rev --impact-out` | Require independently authoritative baseline/candidate inputs, consume `config.product.*`, and bind the candidate as report/downstream subject |
| Inspection planning | `inspection-plan` | Reconcile config, review, readiness, revision-impact, requirements, and item identity/digests rather than merely snapshotting them |
| Controlled release/results | `inspection-plan-release-record`, `inspection-result-normalize` | Preserve existing exact-byte authority and add negative coverage for cross-stage package/part/revision/digest disagreement |
| Evidence lifecycle | `inspection-evidence-*` authorization, attachment, and readiness regeneration paths | Preserve independent human gates; reject upstream lineage disagreement and stale authorizations without inventing evidence or authority |
| Docs and bundles | `generate-standard-docs`, `pack` | Validate proof identity and parent digests before deriving views or selecting bundle members |
| Re-entry | AF execution, tracked jobs, Local API, Studio bridge | Carry artifact SHA-256 and explicit proof policy end to end; re-hash registered bytes before use |

Legacy behavior remains the default:

- existing public command names, routes, output filenames, and default exit
  behavior remain unchanged;
- historical nullable artifacts remain loadable and explicitly proof-ineligible;
- legacy revision-impact flows may continue to emit blocked reports for missing
  identity;
- the config-positional readiness compatibility route remains available but is
  never proof-eligible;
- filename inference and the revision `"A"` fallback may remain only in clearly
  legacy/advisory paths and can never satisfy proof mode;
- artifact-manifest and output-manifest remain separate, complementary
  contracts as documented in `docs/output-manifest.md`;
- `evidence-graph` and `stabilization-review` validate proof identity when
  explicitly activated but never auto-upgrade legacy artifacts;
- no sixth Studio surface, remote service, database, hosted control plane, or
  automatic release authority is added.

## Implementation phases

### Phase 0 — Pinned preflight and authority decision

- Start from a clean worktree at the separately approved implementation base.
- Record branch, HEAD, default branch, available validation commands, and the
  pre-change hashes of all five canonical package trees.
- Require a separate explicit choice of one package plus its authoritative
  package slug, part ID, revision, and exact tracked config path.
- Authorize one declarative source-config edit that adds the explicit identity.
  Require `product.part_id === config.name` for the first proof.
- Record a selected-package allowlist containing the exact source config and a
  separate derived-descendant list; record the other-four-package denylist in
  ignored task evidence.
- If revision-impact rehearsal is requested, separately require authoritative
  baseline config/review snapshots and their exact digests. Otherwise record
  the conditional baseline hold.
- Stop before code or canonical edits if the package or any identity field is
  unresolved.

Acceptance: one unambiguous candidate identity triple and exact editable config
source are authorized without inference, copying from descendants, or inventing
history. Revision impact additionally has a real baseline or an explicit hold.

### Phase 1 — Shared contract and fail-closed activation

- Add the pure normalized identity/parent-reference contract and stable reason
  codes.
- Extend config validation additively with typed optional product identity
  fields; make them mandatory only at the proof semantic gate.
- Add the pinned CLI/job/internal activation policy and reject unsupported
  combinations before opening outputs.
- Implement read-once bounded UTF-8 parsing, duplicate-key rejection, SHA-256,
  origin metadata, and parent snapshot reuse.
- Add focused positive, negative, compatibility, and deterministic tests.

Acceptance: the contract rejects null, blank, inferred, defaulted, malformed,
conflicting, and stale identity while legacy fixtures retain their current
behavior.

### Phase 2 — Review and readiness propagation

- Add the pinned `review-context --config ... --proof-lineage` CLI ingress and
  `review-context` job `config_path`/`options.proof_lineage` contract.
- Bind review production to the authoritative config snapshot and digest.
- Keep standalone `review-pack`/`ingest` outputs proof-ineligible.
- Require agreement between top-level and nested review identity.
- Bind readiness to the exact review bytes and normalized identity.
- Publish proof-mode review JSON/Markdown/PDF/manifest as one staged, locked,
  journaled set with rollback/recovery and failure-injection coverage.
- Preserve the canonical review-backed readiness path and the explicitly
  non-canonical config compatibility path.
- Prove direct CLI and tracked-job parity where both surfaces exist.

Acceptance: a proof review and readiness pair agree on package, part, revision,
config digest, and exact parent references; mismatch produces no partial final
artifact.

### Phase 3 — Revision impact and inspection planning

- Correct revision-impact config adapters to consume `config.product.*`.
- Require independent authoritative baseline and candidate identity/digests;
  retain part identity in both report sides and require exact package/part
  lineage before material comparison.
- Bind the report subject and delta inspection plan to the candidate side.
- In proof mode, fail before publication on missing/conflicting identity; keep
  legacy blocked-artifact behavior intact.
- Reconcile every supplied inspection-plan input semantically and by digest.
- Require plan package and item identity to agree with the authoritative chain.
- Preserve the existing plan release service's exact plan/distributed-file
  bindings.

Acceptance: revision impact and inspection planning cannot bind a changed,
wrong-package, wrong-part, wrong-revision, or stale parent. Without an
authoritative baseline, the selected-package revision-impact edge remains an
explicit hold and is not simulated from current files.

### Phase 4 — Result, evidence, and authorization continuity

- Exercise authorization → release record → submission metadata → normalized
  result → candidate envelope → attachment → readiness-regeneration links as
  one fixture-only adversarial matrix in ignored/test outputs.
- Add missing cross-document package/part/revision/digest equality checks.
- Preserve immutable custody events, separately scoped human authorizations,
  create-only receipts, and readiness-not-mutated-at-attachment behavior.
- Keep unsupported/legacy evidence visible but proof-ineligible.
- Do not require or create selected-package release/result/evidence records for
  implementation completion. If genuine separately authorized inputs do not
  exist, record the real downstream chain as `HOLD_FOR_GENUINE_INPUT`.

Acceptance: fixture tests prove that mutation of any bound identity or digest
invalidates the relevant authorization and stops before canonical write. The
selected canonical package remains held unless genuine authority/input exists;
no software path fabricates a human decision or measurement.

### Phase 5 — Jobs, API, re-entry, manifests, and bundles

- Retain artifact digest and proof policy through job flattening, job storage,
  Local API artifact resolution, Studio bridging, and AF execution.
- Re-hash trusted registered bytes immediately before proof re-entry.
- Verify bundle manifest and checksum bindings before selecting fixed-name ZIP
  entries.
- Reuse the proof-mode staged-set pattern for the multi-file bundle output
  group. Prepare all files, lock the destination, identity-check targets,
  journal the transaction, commit the complete set, and recover or roll back on
  injected interruption. Preserve legacy output behavior outside proof mode.
- Extend existing manifest metadata only where needed; keep manifest roles
  distinct and preserve current public paths and browser locale/state behavior.
- Do not add a new Studio surface. Run browser validation if Studio code changes.

Acceptance: filename/type spoofing, replaced registered bytes, stale job
metadata, or tampered bundle members cannot re-enter the proof chain. Failure
injection cannot expose a mixed proof-mode review or bundle set.

### Phase 6 — Selected-package rehearsal and bounded curation

- Make the separately authorized declarative identity edit only in the exact
  selected `config.toml`. This is the sole manually edited canonical source.
- First generate all available descendants into ignored output with a fixed
  timestamp.
- Validate the bounded internal chain and deterministic rerun before any tracked
  descendant write.
- Regenerate only the explicit derived-file allowlist through normal generators;
  never hand-edit generated JSON.
- Update descendant hashes/manifests coherently in one reviewed change.
- Require the other four canonical package trees to remain byte-identical.
- Preserve `needs_more_evidence` / `hold_for_evidence_completion` whenever real
  evidence or external/human authority is absent.
- Preserve explicit holds for a missing authoritative baseline and missing
  genuine downstream inputs; do not manufacture either to make the rehearsal
  look complete.

Acceptance: one selected package has non-null, consistent internal lineage on
the available edges without changing factual evidence, readiness, or release
claims. The config edit and generated descendants are the only allowlisted
changes; every other canonical byte is unchanged. The roadmap's full Phase 1
remains open until the conditional baseline/external edges exist.

### Phase 7 — Documentation and final audit

- Update identity, lifecycle, re-entry, command, and compatibility docs from
  actual implemented behavior.
- Run the companion verification plan and record exact evidence under
  `tmp/codex/`.
- Capture `git diff --name-only` immediately before and after the final
  skeptical read-only review. Any change invalidates the review.

Acceptance: code, tests, schemas, generated artifacts, and docs describe the
same bounded proof-mode behavior and no stronger production claim.

## Test strategy

Add focused suites such as:

- `tests/revision-lineage-contract.test.js`
- `tests/revision-lineage-propagation.test.js`
- `tests/revision-lineage-reentry.test.js`
- `tests/revision-lineage-cli-integration.test.js`

Extend existing readiness, revision-impact, inspection-plan, release,
normalization, evidence-onboarding, AF execution/job, manifest, bundle,
canonical-package-integrity, Local API, and Studio bridge tests. The minimum
adversarial matrix is defined by the verification companion and includes:

- null, blank, whitespace, object-valued, defaulted, and filename-inferred
  revision;
- top-level/nested/alias contradictions and missing-versus-present identity;
- package slug, part ID, revision, or digest conflict across every parent-child
  edge;
- config or parent mutation between validation and use;
- stale authorization, replaced registered artifact, and tampered bundle
  manifest/checksum/member;
- duplicate keys, BOM/invalid UTF-8, bounds, traversal, symlink, and hardlink
  cases;
- legacy nullable artifacts remaining loadable but proof-ineligible;
- fixed-time byte-identical reruns and no partial canonical writes.

## Landing strategy

Land implementation as independently reviewable units after this plan is
approved and the Phase 0 authority decision is complete:

1. Shared contract, activation policy, and negative tests.
2. Review/readiness propagation and revision-impact/inspection-plan binding.
3. Fixture-only result/evidence continuity plus job/API/re-entry/manifest,
   bundle, and staged-set hardening.
4. Selected-package deterministic regeneration, docs, and final verification.

Do not combine human package selection, broad canonical regeneration, and all
runtime changes into one unreviewable change. Every slice must preserve legacy
tests and leave canonical packages untouched unless that slice has the explicit
selected source-config and derived-file allowlist.

## Rollback strategy

- Revert implementation slices in reverse dependency order.
- Keep proof mode opt-in so removing its activation and additive metadata
  restores prior default behavior without migrating historical artifacts.
- If selected-package curation must be reverted, revert the reviewed source
  config declaration and only its allowlisted descendants plus coherent
  manifest/hash updates.
- Never rewrite or delete immutable release, evidence, authorization, or receipt
  records as rollback.
- A lineage conflict after a real authorization is a hold condition, not
  permission to edit the bound record.

## Stop conditions

Stop and report `HOLD` when any of the following is true:

- no package or explicit authoritative package/part/revision triple has been
  separately selected;
- config sources disagree or the part-number-to-`part_id` mapping is unresolved;
- completion requires filename inference, revision `"A"` fallback, copied
  descendant strings, or hand-edited generated artifacts;
- a baseline revision, physical result, inspection evidence, external record,
  or human authorization would need to be invented;
- a trusted source hash changes between validation and use;
- the implementation would globally invalidate legacy/demo artifacts, replace
  a manifest system, change public routes, or add approval authority;
- canonical files outside the selected source-config and derived allowlist
  change;
- evidence, readiness, release, or publication state would change without its
  existing separately scoped authority;
- a baseline failure cannot be distinguished from a task regression;
- required permissions or destructive cleanup outside task scope are needed.

Unavailable FreeCAD blocks only runtime-backed claims. It does not justify
skipping artifact-only lineage validation or weakening the stop conditions.

## Implementation ledger

- [x] Planning base and architecture evidence recorded.
- [x] Main plan and verification companion drafted.
- [ ] First proof package, source config, and authoritative identity separately
  selected and authorized.
- [ ] Shared proof-lineage contract implemented.
- [ ] Cross-artifact propagation and stale-binding rejection implemented.
- [ ] Jobs/API/re-entry/bundle continuity implemented.
- [ ] Selected-package source config and descendants deterministically curated.
- [ ] Companion verification completed with a valid final read-only review.
