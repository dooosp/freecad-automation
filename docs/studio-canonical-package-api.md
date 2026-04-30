# Studio canonical package API

Use these local API routes when you want to inspect checked-in Studio canonical package metadata and allowlisted text artifacts without regenerating CAD, readiness, standard-doc, or release outputs.

## Routes

```text
GET /api/canonical-packages
GET /api/canonical-packages/<slug>/artifacts/<artifactKey>/preview
```

`GET /api/canonical-packages` returns the five canonical package cards that Studio renders today:

- `quality-pass-bracket`
- `plate-with-holes`
- `motor-mount`
- `controller-housing-eol`
- `hinge-block`

Each package record includes a safe `slug`, package and README refs, readiness status, score, gate decision, missing inputs, an `artifact_catalog`, evidence-boundary copy, Studio-boundary copy, and `inspection_evidence_path`. The checked-in packages are read-only docs packages for discovery; this route is not an arbitrary local folder importer.

`GET /api/canonical-packages/<slug>/artifacts/<artifactKey>/preview` returns text content only for an allowlisted package artifact key. The route uses the canonical package slug plus the artifact key, not a path supplied by the browser.

Previewable artifact keys are:

- `readme`
- `review_pack`
- `readiness_report`
- `standard_docs_manifest`
- `release_manifest`
- `release_checksums`
- `reopen_notes`
- `collection_guide`

The preview response includes `slug`, `artifact_key`, repo-relative `path`, `content_kind`, `content_type`, `size_bytes`, `truncated`, `content`, and `warnings`. Browser-visible paths stay repo-relative and path-safe.

## Release Bundle Boundary

`release_bundle.zip` is listed in the package artifact catalog as `release_bundle`, but it is a package transport artifact only. It is intentionally not text-previewable through the canonical package preview route, and the canonical package API does not add a preview, download, or open route for it.

The canonical package preview route can preview `release_bundle_manifest.json` and `release_bundle_checksums.sha256`; those text artifacts describe the bundle boundary. They do not make the ZIP browser-openable or production-ready.

## Evidence And Readiness Boundary

All five canonical packages remain `needs_more_evidence` with gate decision `hold_for_evidence_completion` until genuine completed `inspection_evidence` is attached through the canonical evidence flow.

Generated quality, drawing, review, readiness, standard-doc, release, fixture, template, and collection-guide artifacts are not inspection evidence. They can support review and package inspection, but they do not satisfy the missing `inspection_evidence` input.

Stage 5B remains parked until a genuine completed inspection evidence JSON exists. Do not create, infer, simulate, or attach inspection evidence from generated package artifacts.

## Examples

```bash
curl http://127.0.0.1:3000/api/canonical-packages

curl http://127.0.0.1:3000/api/canonical-packages/hinge-block/artifacts/readiness_report/preview

curl http://127.0.0.1:3000/api/canonical-packages/hinge-block/artifacts/release_manifest/preview
```

If a package slug or artifact key is unknown, the API returns a structured error. If the key is known but not text-previewable, such as `release_bundle`, the API returns an unsupported-preview error instead of exposing the ZIP.
