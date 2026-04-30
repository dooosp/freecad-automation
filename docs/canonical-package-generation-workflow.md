# Canonical package generation workflow

Use this maintainer guide when planning a future canonical package generation task. It describes the current checked-in workflow and boundaries from the repository docs, source, manifests, and tests. Do not use this guide as approval to regenerate CAD, package, readiness, standard-doc, or release artifacts.

## Purpose and boundaries

- This is a reproducibility guide for maintainers, not a generation run log.
- Generated package artifacts are not inspection evidence.
- Release bundles are package transport artifacts, not production-readiness proof.
- Stage 5B remains parked unless genuine completed inspection evidence exists and is validated in a separate evidence-gated cycle.
- A package-generation task may write artifacts; a docs-only task must not.

## Canonical package baseline

The current canonical packages are:

- `quality-pass-bracket`
- `plate-with-holes`
- `motor-mount`
- `controller-housing-eol`
- `hinge-block`

New package work should start with candidate selection and explicit approval before any generation command is run.

## Candidate selection checklist

- Choose a stable candidate slug and `docs/examples/<slug>/` directory name.
- Prefer simple geometry with a clear single-package boundary.
- Check FreeCAD runtime risk before selecting a candidate that depends on fragile geometry operations.
- Confirm drawing intent is clear enough to produce required dimensions, views, notes, and traceability.
- Confirm the package is meaningfully different from the current five canonical packages.
- Avoid candidates likely to blur generated review evidence with real inspection evidence.
- Define validation expectations before generation starts.
- Keep a fallback candidate ready when the primary candidate proves too risky for the approved scope.

## Config authoring and validation

- Source configs usually live under `configs/examples/`; promoted packages keep a package-local `docs/examples/<slug>/config.toml`.
- The package-local config can be a direct copy of a source config or a curated version with explicit drawing intent.
- Use `fcad validate-config <config.toml|json>` in a separately approved package-generation task to check user-facing config shape and migration state.
- Do not run generation commands in a docs-only workflow update.

## Future-only generation command sequence

Use these commands only in a separately approved package-generation task. They are listed here as the reproducible reference chain, not as commands to run for this guide.

```bash
fcad validate-config <config.toml>
fcad create <config.toml>
fcad draw <config.toml> --bom
fcad review-context --model <model.step> --create-quality <create_quality.json> --drawing-quality <drawing_quality.json> --drawing-qa <drawing_qa.json> --drawing-intent <drawing_intent.json> --feature-catalog <feature_catalog.json> --out <review_pack.json>
fcad readiness-pack --review-pack <review_pack.json> --out <readiness_report.json>
fcad generate-standard-docs <config.toml> --readiness-report <readiness_report.json> --out-dir <standard_docs_dir>
fcad pack --readiness <readiness_report.json> --docs-manifest <standard_docs_manifest.json> --out <release_bundle.zip>
```

Only pass `--inspection-evidence <path>` to `fcad review-context` in a separate evidence-gated task with genuine completed inspection evidence JSON that validates against the inspection evidence contract.

## Generated artifact inventory

Expected canonical package shape under `docs/examples/<slug>/`:

- `README.md`
- `config.toml`
- `cad/`
- `drawing/`
- `quality/`
- `review/review_pack.json`
- `readiness/readiness_report.json`
- `readiness/readiness_report.md`
- `standard-docs/`
- `release/release_bundle_manifest.json`
- `release/release_bundle_checksums.sha256`
- `release/release_bundle_log.json`
- `release/release_bundle.zip`
- `reopen-notes.md`

Generated CAD, drawing, quality, review, readiness, standard-doc, release, and reopen-note artifacts are package artifacts. They are not real inspection evidence.

## Review, readiness, and evidence boundary

- Generated quality, drawing, review, readiness, standard-doc, release, fixture, template, and collection-guide artifacts are not inspection evidence.
- Real inspection evidence must be external, genuine, schema-valid, and handled in a separate evidence-gated cycle.
- Keep readiness as `needs_more_evidence` with gate decision `hold_for_evidence_completion` when `inspection_evidence` is missing.
- Do not pass `--inspection-evidence` unless a separate evidence-gated task validates real evidence.
- Do not use generated CAD nominal dimensions, drawing intent, quality reports, readiness reports, review packs, fixtures, or collection guides as measured inspection evidence.

## Release bundle boundary

- `release_bundle.zip` is a package transport artifact.
- `release_bundle.zip` is not previewable, downloadable, or openable through canonical package preview.
- Do not add arbitrary local file serving to expose package artifacts.
- Do not widen Studio or API preview, download, or open routes for release bundles.
- Release bundle presence does not mean production-ready.

## Manifest and docs update checklist

- Update `docs/examples/example-library-manifest.json` only in a package-generation task that actually promotes or changes package artifacts.
- Update `docs/examples/README.md` to keep the canonical package list, artifact map, and readiness/evidence wording current.
- Update the package `README.md` with source basis, artifact inventory, readiness truth, and evidence boundaries.
- Add or update an inspection evidence collection guide only as a collection guide, not as evidence.
- Link Studio/API docs when discoverability improves without implying new routes or behavior.

## Studio/API visibility checklist

- Canonical slugs must be visible through the existing canonical package discovery contract.
- Previewable artifact keys stay allowlisted.
- Canonical previews use safe slugs plus artifact keys, not arbitrary file paths.
- `release_bundle.zip` may appear in the artifact catalog as `release_bundle`, but no preview, download, or open action should be added.
- Studio/API docs should preserve the distinction between checked-in docs packages and tracked job/artifact reopen.

## Validation checklist

Safe validation commands for a package-generation or package-doc boundary update:

```bash
node tests/canonical-package-integrity.test.js
node tests/example-library-index.test.js
node tests/example-library-manifest.test.js
node tests/example-library-package.test.js
node tests/first-user-docs-smoke.test.js
node tests/inspection-evidence-contract.test.js
node tests/readiness-inspection-evidence-contract.test.js
node tests/evidence-linkage-side-input-contract.test.js
npm run test:node:contract
npm run check:source-hygiene
git diff --check
```

Runtime or browser smoke may be used only when the approved implementation scope requires it. Do not run `fcad create`, `fcad draw`, `fcad pack`, or runtime smoke for a docs-only guide update.

## Post-merge verification checklist

- Confirm the PR merged.
- Confirm the new `master` baseline.
- Confirm post-merge CI status.
- Confirm no deploy occurred.
- Confirm Stage 5B remains parked.
- Confirm no production-readiness claim was introduced.
- Confirm the release bundle boundary is unchanged.
- Confirm no fake inspection evidence was created or attached.

## No-go stop rules

- Stop if the repo is dirty unexpectedly before implementation.
- Stop if evidence is missing, unclear, synthetic, or generated from package artifacts.
- Stop if generation would be needed but is not approved.
- Stop if route or file-serving changes would be required.
- Stop if docs imply production readiness.
- Stop if a docs-only scope would require changing CLI, API, Studio, or runtime behavior.
