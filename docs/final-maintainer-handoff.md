# Final maintainer handoff

This is the final freeze handoff for the current non-inspection software/control
hardening run. It is a status note only. It does not attach inspection evidence,
mutate canonical package artifacts, regenerate readiness, publish a release, or
deploy production.

## Current verified state

- Repository: `dooosp/freecad-automation`
- Default branch: `master`
- Verified default-branch head: `7d1972f8434efbb46e1bd6af5067e3ea7c07ba43`
- Latest audited merge: PR [#163](https://github.com/dooosp/freecad-automation/pull/163), `[codex] Add release dry-run governance doctor`
- Open PR state at handoff: `gh pr list --state open --limit 50` returned no open PR rows
- GitHub branch-protection API for `master`: `Branch not protected`
- Post-merge master CI at `7d1972f8434efbb46e1bd6af5067e3ea7c07ba43`: `Automation CI (hosted fast lanes)` passed on run `27054410434`
- Post-merge master runtime smoke at `7d1972f8434efbb46e1bd6af5067e3ea7c07ba43`: `FreeCAD Runtime Smoke (self-hosted macOS)` passed on run `27054452161`
- Historical governance closeout: Stage 5B and CI governance are closed through PR #162, and release dry-run governance is closed through PR #163. No product readiness, production release, or inspection-evidence attachment is claimed from those governance checks.

## Local maintainer doctor

Run the top-level local doctor after future maintainer PR trains:

```bash
npm run maintainer:doctor -- --clean
```

It writes `output/maintainer-doctor/maintainer_doctor_report.json` in ignored
local output. The doctor runs or verifies source hygiene, the Stage 5B pipeline
doctor, the release dry-run doctor, node contract discoverability,
docs/source-of-truth guards, generated output policy, raw inbox tracking,
workflow/check-name drift, and overclaim guards. Use
`npm run test:stage5b:pipeline-doctor`, `npm run release:dry-run:doctor -- --clean`,
or `npm run check:source-hygiene` only when isolating a failed top-level gate.

For a fresh-clone first-maintainer audit, run:

```bash
npm run bootstrap:doctor -- --clean
```

It validates `npm ci`, local CLI help, source hygiene, the maintainer doctor,
release dry-run doctor, Stage 5B pipeline doctor, documented npm script names,
docs/local-state alignment, generated-output policy, raw inbox tracking, and
sensitive-data leakage guards. It writes
`output/bootstrap-doctor/bootstrap_doctor_report.json` in ignored local output
and does not publish, tag, upload, attach evidence, regenerate canonical
readiness, change GitHub settings, call production, or require secrets.

## Evidence and readiness truth

No genuine completed inspection evidence has been found or attached. All five
canonical packages remain `needs_more_evidence` with gate decision
`hold_for_evidence_completion` because `inspection_evidence` is still missing.

Quality reports, drawing outputs, DFM reports, readiness reports, review packs,
standard docs, release bundles, request packets, authorization records,
candidate gate reports, intake reports, promotion dry-run manifests, audit
manifests, audit summaries, CI/GitHub metadata, screenshots, comments, docs,
schemas, fixtures, generated CAD measurements, and ignored inbox files are not
`inspection_evidence`.

Only genuine completed physical, supplier, lab, or QA inspection records can
satisfy `inspection_evidence`, and only after later authorized validation,
review, redaction/privacy approval, package/revision mapping, attachment
authorization, canonical attachment, and regenerated readiness verification.

## Handoff decision

Stop active hardening for the current release-candidate evidence/readiness path.
The repository is ready for maintainer handoff as a non-inspection software and
control surface. Do not continue package-readiness work, mutate canonical
package artifacts, refresh readiness reports, publish release bundles as
production proof, or attach evidence until genuine completed inspection records
arrive in a separate later authorized task.

## Residuals outside repository proof

- genuine supplier/lab/QA/physical inspection records have not arrived
- redaction/privacy approval depends on future private records
- human authorization before canonical evidence attachment is still required
- GitHub required-checks, protected branch rules, repository settings, runner
  ownership, and release publication decisions remain maintainer/org settings;
  see [CI governance and maintainer checklist](./ci-governance.md)

## Next condition

Resume only when genuine completed physical, supplier, lab, or QA inspection
records arrive and a later task explicitly authorizes validation, review,
attachment, and regenerated readiness/release verification.
