# Revision Impact and Reinspection Planning

## Goal

Add a deterministic, artifact-driven, non-mutating revision-impact assessment to
the existing `compare-rev` entrypoint. The workflow compares a baseline review
revision with a candidate revision, classifies material engineering changes,
assesses inspection-evidence applicability, and embeds future reinspection work
in one canonical `revision_impact_report.json` plus a Markdown view derived only
from that JSON.

The report is decision support. It cannot attach or authorize evidence, mutate an
attachment receipt, supersede a record, regenerate readiness, mark a package
ready, publish a release, create a tag, upload an artifact, or deploy anything.

## Pinned task context

- repository: `freecad-automation`
- starting checkout branch/SHA: `codex/mega-studio-api-contract-fuzz-audit` at
  `32f52f8ed73419a77b309cd00c567cbb043c9c7a`
- refreshed default branch: `origin/master` at
  `aeed086176909e124e777b99811a6ec14763bec4`
- refreshed PR #171 head: `f98d16a5a585fa9df234048398e70b765a68d956`
- onboarding safety checkpoint: `69aa9eadb92e0a27a9f005493ff7f44de87fe0e6`
- onboarding feature commit after restack: `e5dd01cb075e794002ab8c168c00dd83d4b47e62`
- finalized onboarding head: `66c396c4c189f7e2c06b3f6d207e74f6b2a46980`
- task branch: `codex/revision-impact-reinspection-planning-restacked`
- task worktree: a separate sibling worktree (absolute local path is kept only
  in ignored task evidence)

The dependency chain is intentionally stacked:

```text
origin/master aeed086
  -> PR #171 f98d16a
  -> inspection-evidence onboarding e5dd01c
  -> onboarding artifact re-entry fix 66c396c
  -> revision-impact work
```

Revision impact directly depends on the inspection-evidence envelope, receipt,
privacy, parsing, and control-material contracts introduced by onboarding at
`e5dd01c`; those contracts do not exist on `origin/master` or PR #171 alone.
Revision-impact code has no demonstrated direct dependency on PR #171, but PR
#171 remains a transitive dependency of the finalized onboarding branch and the
safest pinned landing base. The original onboarding checkpoint remains
recoverable on `codex/backup-inspection-evidence-onboarding-safety-69aa9ea`.

## Architecture before this change

```text
CLI compare-rev
  -> loadCanonicalReviewPackInput (schema/AF handoff)
  -> scripts/reporting/revision_diff.py
  -> legacy revision_comparison JSON
  -> D artifact schema validation
  -> output manifest

Tracked compare-rev
  -> Local API request schema / Studio artifact-pair bridge
  -> job executor (duplicate legacy comparison assembly)
  -> review-artifact handler
  -> registered revision_comparison artifact
  -> Artifacts/Packs viewer and re-entry action
```

Existing `revision_diff.py` explains hotspot, evidence-ledger, action, confidence,
and coarse geometry-summary deltas. It does not make stable feature or
characteristic identity authoritative, assess immutable evidence applicability,
or produce a reinspection plan.

Relevant contracts and identity sources are:

- canonical D review pack and revision comparison:
  `schemas/review_pack.schema.json`, `schemas/revision_comparison.schema.json`,
  `lib/d-artifact-schema.js`
- canonical C readiness:
  `src/workflows/canonical-readiness-builders.js`,
  `src/workflows/readiness-report-workflow.js`, and C schemas
- drawing intent and stable identity: drawing-intent `required_dimensions`,
  `critical_features`, `required_notes`, and datum strategy; feature-catalog
  `feature_id`; deterministic drawing semantic aliases; extracted semantics
- quality/manufacturing context: create-quality, drawing-quality, drawing-QA,
  DFM, quality-risk, process-plan, inspection linkage, and evidence graph
- inspection onboarding boundary:
  `lib/inspection-evidence-onboarding.js`, onboarding service, envelope,
  authorization, attachment-record, and onboarding-record schemas
- canonical mutation boundary: `lib/canonical-package-mutation-lock.js`
- shared command/job metadata: `src/shared/command-manifest.js`, AF execution
  contract, handler registry, Local API schema, Studio job bridge
- browser surfaces: Artifacts/Packs compare staging, revision-comparison viewer,
  Review workspace, artifact actions, and the English/Korean locale dictionaries

## Architecture after this change

The old path remains intact. An additive impact path is introduced:

```text
compare-rev baseline candidate [legacy options]
  -> unchanged revision_comparison output
  -> when --impact-out is present:
       strict bounded input loading
       -> normalized revision context adapters
       -> stable-ID exact comparison policy
       -> evidence applicability policy
       -> embedded reinspection plan
       -> structural + semantic validation
       -> atomic revision_impact_report.json
       -> Markdown rendered from the validated JSON

tracked compare-rev / Studio artifact pair
  -> server-selected job artifact directory
  -> legacy revision_comparison + revision_impact_report JSON/Markdown
  -> registered artifacts with baseline/candidate provenance
  -> existing Artifacts/Packs surface renders the richer report
```

Domain logic lives in a focused revision-impact contract/service module, not in
the browser, job adapter, or a generic utilities directory. CLI and jobs call the
same builder and validator.

## Public entrypoint and compatibility

- Keep one public command: `fcad compare-rev`.
- Preserve the two positional review-pack inputs, `--out`, default output name,
  legacy schema, legacy exit behavior, and Python comparison path.
- Add `--impact-out <revision_impact_report.json>` and optional:
  - `--impact-md-out <revision_impact_report.md>`
  - `--baseline-readiness`, `--candidate-readiness`
  - `--baseline-config`, `--candidate-config`
  - `--baseline-evidence-envelope`, `--candidate-evidence-envelope`
  - `--baseline-evidence-receipt`, `--candidate-evidence-receipt`
  - `--generated-at <RFC3339 timestamp>`
- A successful analysis exits successfully even when review or reinspection is
  required. No strict failure mode is added in version 1.
- Tracked jobs enable the impact output in their server-generated artifact
  directory; browsers continue to submit registered artifact references rather
  than paths.

## Public artifact compatibility

- `revision_comparison` remains supported and unchanged for callers that do not
  request impact output.
- `revision_impact_report` is a new canonical artifact with schema version `1.0`.
- JSON is canonical; Markdown is a derived view and must not add facts.
- The report stores portable repo-relative or sanitized references and SHA-256
  hashes, never local absolute paths, raw private evidence bytes, private URLs,
  credentials, tokens, or machine diagnostics.
- Output manifests and tracked job manifests may register the two report files;
  no second revision-impact JSON or wrapper contract is introduced.

## Deterministic comparison policy

1. Validate bounded UTF-8 JSON before output is opened or created. Reject BOM,
   duplicate keys, invalid UTF-8, excessive size/depth, non-finite values, and
   malformed supported artifact types.
2. Require matching package/part identity and explicit baseline/candidate
   revision identifiers for authoritative revision analysis.
3. If content changes without a revision increment, emit a blocking governance
   conflict. If revision changes without normalized engineering content changes,
   emit a provenance review item rather than reinspection.
4. Normalize object key order, optional/null values, exact finite numbers,
   allowlisted units, portable artifact refs, and stable array ordering.
5. Exclude only allowlisted volatile fields such as generation timestamps,
   temporary output paths, and host diagnostics. Preserve revision, checksum,
   evidence/characteristic/specification identity, material, process, nominal,
   tolerance, result semantics, authorization hash, and receipt hash.
6. Use exact normalized comparison. Unit conversion is limited to an explicit
   deterministic allowlist; unsupported or ambiguous units produce
   `unable_to_determine`.
7. Prefer explicit feature, drawing-intent, semantic-alias, characteristic,
   evidence, package, and revision identifiers. Never use array position.
8. Do not infer rename equivalence or generalized BREP/topology similarity.
   Missing stable identity remains visible and requires human review.
9. Stable change, assessment, and plan IDs are hashes of canonical semantic
   inputs. They contain no timestamps or randomness.

## Closed change taxonomy

- `metadata_change`
- `revision_identity_change`
- `geometry_feature_added`
- `geometry_feature_removed`
- `geometry_feature_modified`
- `nominal_dimension_change`
- `tolerance_change`
- `datum_or_reference_change`
- `drawing_requirement_change`
- `material_change`
- `manufacturing_process_change`
- `quality_gate_change`
- `critical_characteristic_change`
- `inspection_method_requirement_change`
- `specification_reference_change`
- `evidence_reference_change`
- `unresolved_identity_change`

Every change carries exact source refs/hashes, before/after values, units when
known, determinability, rationale, severity, and required action.

## Evidence applicability policy

Evidence applicability is an assessment only. Allowed states are `unaffected`,
`review_required`, `reinspection_required`, `potentially_stale`,
`unable_to_determine`, and `not_applicable`.

- changed nominal value or tightened tolerance -> `reinspection_required`
- loosened tolerance -> `review_required`; never auto-accept an old result
- changed datum/reference -> `reinspection_required` when linkage is explicit,
  otherwise `unable_to_determine`
- changed inspection method -> deterministic review/reinspection according to
  explicit requirement data
- material/process change -> review all explicitly process-sensitive
  characteristics
- added critical characteristic -> `reinspection_required`
- removed feature/characteristic -> `review_required`, without deletion
- metadata-only editorial change -> `unaffected` unless identity/spec provenance
  changed
- missing stable identity -> `unable_to_determine`
- content change without revision increment or binding/hash mismatch -> blocked
  with human review
- generated, synthetic, fixture, QIF-lite control, CAD, CI, review, readiness,
  and release artifacts are never trusted inspection evidence

Every assessment states `authoritative_evidence_state_changed: false`.

## Reinspection policy

The embedded plan contains only future work. Items link stable characteristics
to related change IDs and carry authoritative nominal/tolerance/spec/method data
only when supplied by an input. Each item requires a human reviewer, later
attachment authorization, later readiness regeneration, and starts with
`execution_status: not_started`. The workflow never creates a measured value or
claims that a suggested method is approved unless an authoritative requirement
supplied it.

## Read-only and output policy

- CLI impact output is allowed only at an explicit safe non-canonical output
  target under `output/` or `tmp/codex/`; tracked jobs write only under the job
  store's explicitly trusted artifact directory. A caller-provided dirname can
  narrow but cannot widen those roots.
- Impact JSON, derived Markdown, legacy comparison, and the artifact manifest
  share one safe directory. All four are prepared, target-identity checked,
  staged, journaled, and rollback-published under one directory lock. A stale
  interrupted journal restores the prior complete set (or finalizes an already
  committed complete set) before another preflight proceeds.
- Reject traversal, NUL/backslash tricks, symlink parent/target escapes, unsafe
  hardlink aliases, canonical package review/readiness/inspection/release roots,
  and partial JSON/Markdown publication.
- JSON is written atomically after full input, structural, semantic, privacy,
  and path validation. Markdown is derived from that final validated object.
- The workflow reads sanitized onboarding envelope/receipt metadata only and
  never changes lifecycle state, custody, authorization, receipt, readiness, or
  release artifacts.

## Job, Local API, and Studio integration

- Reuse the existing `compare-rev` command/job metadata and handler; do not add a
  second public command.
- Extend the job result with server-generated `revision_impact_report.json` and
  `.md`, plus baseline/candidate lineage.
- Keep direct Local API paths repo-relative and browser flows artifact-ref only.
- Reuse the existing Artifacts/Packs compare-revision staging flow; do not add a
  primary navigation tab.
- Extend artifact recognition/viewing for impact summary, changed features,
  dimensions/tolerances, drawing/specification impact, affected inspection
  characteristics, unresolved mappings, reinspection work, source hashes, and
  visible non-mutation boundaries.
- Add English and Korean copy through the existing locale mechanism with safe
  English fallback.

## Test strategy

- focused pure-domain tests for normalization, taxonomy, revision governance,
  evidence applicability, plan generation, schema and semantic invariants
- strict-input and output-path adversarial tests, including duplicate keys,
  UTF-8, bounds, units, identity duplication, path leakage, symlink/hardlink,
  secret/private URL, partial output, and byte-identical reruns
- CLI regression proving legacy `compare-rev` output remains valid
- tracked-job, Local API, manifest, artifact viewer/action, and bilingual Studio
  tests
- focused marked fixtures covering all 18 requested scenarios; fixture evidence
  always declares `test_scope: fixture` and `production_trust: false`
- required repository lanes and canonical package immutability verification from
  the companion verification plan

## Rollout strategy

Land as reviewable stacked units:

1. PR #171.
2. Inspection-evidence onboarding (`e5dd01c`, finalized by `66c396c`).
3. Revision-impact slice A: plans, schema, pure policy/service, CLI, fixtures,
   adversarial and compatibility tests.
4. Revision-impact slice B: tracked job, Local API, artifact registration,
   Studio viewer and bilingual copy.
5. Revision-impact slice C: documentation, source-of-truth guards, final
   verification evidence.

Logical commits may represent these slices on one local branch; publication is
out of scope unless separately requested.

## Rollback strategy

- Revert revision-impact commits in reverse order.
- Because legacy `compare-rev` remains intact, removing the additive job/viewer
  registration and `--impact-out` path restores prior behavior without data
  migration.
- Generated impact reports are non-authoritative decision-support artifacts and
  require no canonical package rollback.
- Do not roll back, rewrite, or combine the onboarding/PR #171 landing units.

## Explicit non-goals

- generalized BREP/topology matching or inferred design intent
- approximate numeric equality outside an existing documented policy
- measurement generation, evidence attachment/authorization/supersession, or
  evidence lifecycle mutation
- raw private evidence upload or source-byte inspection beyond a safe existing
  metadata adapter
- canonical readiness, standard-document, release-bundle, package, tag, upload,
  deployment, or publication mutation
- a new top-level command or separate reinspection-plan JSON
- live FreeCAD/runtime geometry comparison, AI/LLM classification, CSV/checksheet
  export, or broader runtime/platform claims

## Implementation ledger

- [x] Plans and pinned architecture/dependency evidence recorded.
- [x] Schema, validator, normalized domain policy, Markdown renderer, and CLI
  integration implemented and verified.
- [x] Job/API/artifact/Studio integration implemented and verified.
- [x] Fixtures, adversarial/regression tests, and docs implemented and verified.
- [x] Required lanes, deterministic reruns, canonical hashes, and final
  read-only review evidence recorded.
