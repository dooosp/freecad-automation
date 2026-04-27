# Reopen Notes

This package is a curated file package with a deterministic Studio reopen test fixture.

The fixture represents the package as a tracked Studio job/artifact set and proves these canonical artifact routes:

- Review: `review/review_pack.json`
- Package / Artifacts: `readiness/readiness_report.json`, `standard-docs/standard_docs_manifest.json`, `release/release_bundle_manifest.json`, and `release/release_bundle.zip`
- Model: `cad/pcb_mount_plate.step` and `cad/pcb_mount_plate.stl`
- Drawing: `drawing/pcb_mount_plate_drawing.svg`

The fixture uses deterministic artifact IDs generated inside the repo test harness. It does not use arbitrary local imports, checked-in job IDs, absolute package paths, task notes, or ignored generated-output directories as the reopen source of truth.
