# Revision-lineage proof mode

Revision-lineage proof mode is an explicit, local traceability policy for the
internal review-to-package chain. It binds one declared package slug, part ID,
engineering revision, authoritative config digest, and exact parent bytes. It
is the repository portion of the G-01 foundation. It is not product release,
inspection evidence, production readiness, or completion of the roadmap's
external-packet Phase 1 criteria.

## First selected package

The first bounded rehearsal is pinned by a separate authority decision:

| Field | Authoritative value |
| --- | --- |
| Package directory | `docs/examples/hinge-block` |
| Package slug | `hinge-block` |
| Part ID | `hinge_block` |
| Revision | `A` |
| Authoritative source config | `configs/examples/hinge_block.toml` |
| Generated config descendant | `docs/examples/hinge-block/config.toml` |

The source config and package-local config are separate allowlist entries. The
package-local file remains a direct byte copy of the source config. No other
canonical package path is authorized by this selection.

## Contract

Every proof artifact carries the same normalized identity and digest-bearing
parent references:

```json
{
  "revision_lineage": {
    "schema_version": "1.0",
    "mode": "proof",
    "identity": {
      "package_slug": "hinge-block",
      "part_id": "hinge_block",
      "revision": "A",
      "config_sha256": "<64 lowercase hex characters>"
    },
    "parents": [
      {
        "artifact_type": "config",
        "role": "authoritative_config",
        "path": "configs/examples/hinge_block.toml",
        "sha256": "<same authoritative config digest>"
      }
    ]
  }
}
```

Emitted parent references may also contain the measured `size_bytes`. Each child
names and hashes its exact immediate inputs, such as the review
pack consumed by readiness or the readiness report consumed by standard docs
and packaging.

Proof mode rejects missing, blank, inferred, defaulted, conflicting, malformed,
or stale identity. `config.name` is a legacy alias and must equal
`product.part_id` for this first package. A path or filename is only a locator;
it never supplies engineering identity.

## Activation and supported chain

Activation is explicit at every boundary:

- CLI: the valueless `--proof-lineage` flag
- tracked jobs: `options.proof_lineage: true`
- internal services: `requireAuthoritativeLineage: true`

The supported internal chain is:

```text
authoritative config
  -> review-context
  -> readiness-pack (or readiness-report --review-pack)
  -> inspection-plan
  -> generate-standard-docs
  -> pack
  -> tracked job / Local API / Studio / AF re-entry
```

A representative artifact-only rehearsal is:

```bash
fcad review-context \
  --context <engineering_context.json> \
  --config configs/examples/hinge_block.toml \
  --part-id hinge_block \
  --revision A \
  --proof-lineage \
  --out <review_pack.json>

fcad readiness-pack \
  --review-pack <review_pack.json> \
  --proof-lineage \
  --out <readiness_report.json>

fcad inspection-plan \
  --review-pack <review_pack.json> \
  --readiness <readiness_report.json> \
  --config configs/examples/hinge_block.toml \
  --scope full \
  --proof-lineage \
  --generated-at <iso8601> \
  --out <inspection_plan.json>

fcad generate-standard-docs configs/examples/hinge_block.toml \
  --readiness-report <readiness_report.json> \
  --proof-lineage \
  --generated-at <iso8601> \
  --out-dir <standard_docs_dir>

fcad pack \
  --readiness <readiness_report.json> \
  --docs-manifest <standard_docs_dir/standard_docs_manifest.json> \
  --proof-lineage \
  --generated-at <iso8601> \
  --out <release_bundle.zip>
```

Proof review requires an exact config input; `--part-id` and `--revision` can
only confirm it. Proof readiness rejects the config-positional compatibility
route. Proof standard-doc generation never reconstructs or silently substitutes
a config. Proof packaging revalidates readiness, optional docs, every lineage
parent, checksum metadata, and fixed-name ZIP members before atomic publication.

Standalone `ingest`, standalone `review-pack`, `process-plan`, and
`stabilization-review` are proof-ineligible. They reject explicit proof
activation instead of silently running a legacy path. Selected-package
`compare-rev` also remains unavailable until an independent authoritative
baseline config and review snapshot are supplied; tests use clearly marked
fixtures to exercise the two-sided service contract.

## Manifests, jobs, and re-entry

Successful proof artifact/output manifests retain both:

```json
{
  "effective_policy": { "proof_lineage": true },
  "revision_lineage": { "schema_version": "1.0", "mode": "proof" }
}
```

A failed proof run retains the effective policy and error evidence but need not
claim lineage that was never established. Proof manifest locators are portable
and omit private runtime executable paths. Legacy manifests keep their existing
shape and path behavior.

Tracked jobs persist the artifact SHA-256, size, and effective proof policy.
Local API, Studio bridge, and AF re-entry accept proof continuation only from a
registered binding and re-hash the current bytes before use. Moving, renaming,
or giving a legacy file a proof-looking marker does not make it proof eligible.
Bundle re-entry verifies the manifest, checksums, ZIP member bytes, identity,
and source digest before selecting canonical inputs.

## Compatibility and authority boundaries

Without explicit activation, existing commands, routes, filenames, nullable
historical artifacts, and warning-oriented behavior remain unchanged. Proof
fields never auto-activate the policy.

The selected package may remain `needs_more_evidence` with
`hold_for_evidence_completion`. Proof validation grants no engineering or
quality decision. The real revision-impact edge is
`HOLD_FOR_AUTHORITATIVE_BASELINE`; the real release/result/evidence chain is
`HOLD_FOR_GENUINE_INPUT`. Inspection-plan release, completed result handling,
evidence attachment, and readiness regeneration keep their existing separate
human authorization and exact-byte custody controls.

See [local-first product workflows](./product-workflows.md),
[command lifecycle](./command-lifecycle.md),
[canonical package generation](./canonical-package-generation-workflow.md),
and [output manifests](./output-manifest.md) for adjacent contracts.
