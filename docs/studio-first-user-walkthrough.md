# Studio First-User Walkthrough

Use this walkthrough when you want to understand the checked-in Studio package flow without regenerating CAD, release bundles, readiness reports, or inspection evidence.

## What Studio Shows Today

Studio is the browser UI served by `fcad serve` on `/` and `/studio`. In this repo it can show the canonical CAD packages, their readiness status, tracked job history, and read-only canonical artifact previews.

The current canonical packages are:

- `quality-pass-bracket`
- `plate-with-holes`
- `motor-mount`
- `controller-housing-eol`
- `hinge-block`

All five canonical packages remain `needs_more_evidence` with gate decision `hold_for_evidence_completion` because `inspection_evidence` is still missing.

## Start From Canonical Packages

Start with canonical packages rather than arbitrary local files. The canonical package inventory lives in [docs/examples/README.md](./examples/README.md), and each package lives under `docs/examples/<slug>/`.

Studio uses tracked/canonical package and artifact routes. Canonical package cards are read-only views of checked-in package metadata and artifacts; they are not a local-file browser and they do not import arbitrary folders from disk.

For the browser-facing local API contract behind those cards, see [Studio canonical package API](./studio-canonical-package-api.md).

From a canonical package card, inspect:

- package name and safe package identifier
- readiness status, score, gate decision, and missing inputs
- source-of-truth readiness report path
- canonical artifact references such as README, review pack, readiness report, standard-docs manifest, release manifest, release checksums, reopen notes, and the inspection evidence collection guide

## Preview Canonical Artifacts Safely

Canonical package preview uses safe package identifiers and artifact keys, not arbitrary local file paths. The route shape is based on a slug plus an artifact key, such as:

```text
/api/canonical-packages
/api/canonical-packages/<slug>/artifacts/<artifactKey>/preview
```

Canonical artifact actions are read-only. Text preview is intended for allowlisted markdown, JSON, manifest, and checksum artifacts. The preview surface renders artifact text safely and does not expose an arbitrary local file open or download route.

Previewable text artifacts include:

- package README
- `review_pack.json`
- `readiness_report.json`
- `standard_docs_manifest.json`
- `release_bundle_manifest.json`
- `release_bundle_checksums.sha256`
- `reopen-notes.md`
- inspection evidence collection guide

## Understand Release Bundle Boundaries

`release_bundle.zip` is a curated package artifact, not a text-preview artifact. It remains non-previewable in the canonical artifact preview flow and should not be treated as a browser text document.

Release bundle presence does not mean production-ready. The release bundle is useful for reviewing and transporting the package boundary, but it does not replace genuine completed inspection evidence and does not clear the readiness hold.

## Understand Readiness Status

`readiness/readiness_report.json` is the source of truth for each checked-in package. Today each package still says `needs_more_evidence` because the missing input is `inspection_evidence`.

`inspection_evidence` means genuine completed inspection evidence JSON that validates against the inspection evidence contract and is attached through the canonical flow. Generated quality, drawing, review, readiness, standard-docs, release, template, fixture, and collection-guide artifacts are not inspection evidence.

Production readiness remains held until genuine completed inspection evidence exists and the canonical review/readiness chain is deliberately refreshed.

For how DFM signals, readiness reports, release bundles, and missing inspection evidence relate to each other, see [DFM and readiness guide](./dfm-readiness-guide.md). For the final non-inspection software milestone summary, see [final non-inspection software closeout](./final-non-inspection-software-closeout.md).

## What Not To Do

- Do not create or attach inspection evidence unless you have genuine completed inspection measurements.
- Do not use generated quality, drawing, review, readiness, standard-doc, or release artifacts as `inspection_evidence`.
- Do not treat release bundles as production-readiness proof.
- Do not regenerate canonical package artifacts just to inspect the current Studio flow.
- Do not add arbitrary local file open, download, or preview routes to make a package card work.
- Do not make `release_bundle.zip` previewable as text.

## Next Steps

If you only want software/project closeout, use Studio and the docs to review canonical package cards, safe artifact preview, release boundaries, and readiness status as checked-in software deliverables. The current non-inspection closeout remains truthful without attaching inspection evidence.

If you have genuine inspection evidence later, follow the inspection evidence contract and collection guides, attach a completed real inspection evidence JSON through the canonical flow, and then deliberately refresh the review/readiness/release chain. Stage 5B remains parked until a genuine completed inspection evidence JSON exists.

## Validation And Tests

The first-user documentation smoke coverage checks that this walkthrough exists, names the five canonical packages, explains canonical package cards and safe artifact preview, preserves the `release_bundle.zip` boundary, rejects arbitrary local file open/download routes, keeps `needs_more_evidence` and `inspection_evidence` visible, avoids production-readiness claims, and preserves the Stage 5B parked boundary.
