# Final maintainer handoff

This is the final freeze handoff for the current non-inspection software/control
hardening run. It is a status note only. It does not attach inspection evidence,
mutate canonical package artifacts, regenerate readiness, publish a release, or
deploy production.

## Audit basis for this handoff update

- Repository: `dooosp/freecad-automation`
- Default branch: `master`
- Audited default-branch head before this handoff update: `735e991d40d33b69987a4ddd52db810791e968d3`
- Latest audited prior merge: PR [#165](https://github.com/dooosp/freecad-automation/pull/165), `Add first-maintainer bootstrap doctor`
- Open PR state at handoff: `gh pr list --state open --limit 50` returned no open PR rows
- GitHub branch-protection API for `master`: `Branch not protected`
- Post-merge master CI at `735e991d40d33b69987a4ddd52db810791e968d3`: `Automation CI (hosted fast lanes)` passed on run `27058839538`
- Post-merge master runtime smoke at `735e991d40d33b69987a4ddd52db810791e968d3`: `FreeCAD Runtime Smoke (self-hosted macOS)` passed on run `27058885140`
- Historical governance closeout: Stage 5B and CI governance are closed through PR #162, release dry-run governance is closed through PR #163, maintainer doctor is closed through PR #164, and bootstrap doctor is closed through PR #165. No product readiness, production release, or inspection-evidence attachment is claimed from those governance checks.

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

## Maintenance-mode command sets

Weekly default-branch drift check:

```bash
git fetch origin master
git status --short --branch
npm run bootstrap:doctor -- --clean
```

Before release publication review:

```bash
npm run check:source-hygiene
npm run maintainer:doctor -- --clean
npm run release:dry-run:doctor -- --clean
npm run test:stage5b:pipeline-doctor
npm run test:node:contract
npm test
```

On a FreeCAD-capable maintainer or self-hosted runtime machine, add:

```bash
fcad check-runtime
npm run test:runtime-smoke
```

When genuine completed inspection evidence arrives, keep raw files in the
ignored local inbox and run only the non-mutating review chain until a separate
explicit attachment/regeneration task is authorized:

```bash
fcad stage5b-evidence-source-kit --package <canonical-package-slug>
fcad stage5b-evidence-source-preflight --package <canonical-package-slug> --source local/stage5b-candidate-evidence-inbox/<canonical-package-slug>/received-inspection-evidence.json --out local/stage5b-candidate-evidence-inbox/<canonical-package-slug>/source-preflight-report.json
fcad stage5b-evidence-review-dry-run --package <canonical-package-slug> --source local/stage5b-candidate-evidence-inbox/<canonical-package-slug>/received-inspection-evidence.json --out-dir output/stage5b-review-dry-run
node scripts/stage5b-candidate-evidence-gate.js --candidate <repo-relative-reviewed-json> --out output/stage5b-candidate-gate-report.json
fcad stage5b-evidence-attachment-controller --review-manifest output/stage5b-review-dry-run/stage5b_evidence_review_dry_run_manifest.json --authorization-record <repo-relative-authorization-record.json> --out-dir output/stage5b-attachment-controller --dry-run
fcad stage5b-evidence-audit --out-dir output/stage5b-evidence-audit
```

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

## Stop conditions

Stop and hand back to a human maintainer before any evidence attachment,
readiness regeneration, release publication, production call, secret-bearing
operation, or destructive git operation.

- Evidence: stop if a candidate is not a completed physical/supplier/lab/QA
  record, lacks provenance/reviewer/package/revision mapping, exposes private
  URLs, PII, tokens, secrets, absolute paths, screenshots, CI artifacts, or
  supplier/lab/QA raw originals in tracked output, or would require fabricating
  or typing measured values.
- Release publication: stop before creating tags, publishing a GitHub release,
  uploading artifacts, npm publishing, or treating a dry-run bundle as
  production/readiness proof.
- Production: stop before any production endpoint, deployment, database,
  secret store, telemetry/log pull, or customer/private system access.
- Secrets and private data: stop if the next step would commit raw inbox files,
  private URLs, tokens, credentials, PII, local host paths, or unredacted
  supplier/lab/QA material.
- Destructive git: stop before `git reset --hard`, `git clean`, branch deletion,
  force-push, branch-protection bypass, or any cleanup outside the scoped
  maintenance files.

## Next condition

Resume only when genuine completed physical, supplier, lab, or QA inspection
records arrive and a later task explicitly authorizes validation, review,
attachment, and regenerated readiness/release verification.
