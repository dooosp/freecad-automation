# Local-first v1 release-candidate checklist

This checklist prepares a candidate. It does not authorize a tag, GitHub release, deployment, canonical artifact regeneration, or evidence operation.

## Product surface

- [x] Three primary workflows are defined in README, CLI help, and Studio Start.
- [x] Default CLI help contains 12 primary rows.
- [x] Every command has one lifecycle in the shared command manifest.
- [x] `fcad help --all` preserves advanced and maintainer discoverability.
- [x] Compatibility routes remain invokable with migration guidance.
- [x] Raw result files remain CLI-only.
- [x] Studio adds no navigation tab and no raw supplier-result upload.

## Software acceptance

- [x] Review flow is fixture-backed and artifact-driven.
- [x] Revision-impact and delta inspection-plan flow preserves change IDs.
- [x] Result handoff proves exact release/plan hashes and separate reported/computed results.
- [x] Fixed-time report and artifact inventories are byte-identical across two runs.
- [x] Canonical package hashes and counts are unchanged by the acceptance lane.
- [ ] Hosted PR checks pass on the final stacked head.
- [ ] Required self-hosted macOS FreeCAD smoke is reviewed separately when run.

## Evidence and release boundary

- [x] All acceptance inputs are checksum-bound by a synthetic, non-production fixture declaration.
- [x] Acceptance emits no evidence envelope, evidence authorization, attachment, or readiness regeneration.
- [x] All five canonical packages remain held for missing inspection evidence.
- [ ] Genuine completed canonical inspection evidence exists and has completed the controlled lifecycle.
- [ ] Release publication is separately authorized.
- [ ] A release tag and GitHub release are created.

Unchecked release/evidence items are intentional blockers, not missing software automation. See [Local-first v1 readiness](../local-first-v1-readiness.md).
