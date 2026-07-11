# Revision Impact and Reinspection Planning Verification

## Objective

Prove that the additive `compare-rev` impact workflow is deterministic,
schema-valid, actionable, backward compatible, and read-only with respect to
inspection evidence, attachment receipts, readiness, standard documents, and
release artifacts.

## Baseline evidence

- Run `tests/output-contract-cli.test.js` before implementation and record its
  exact exit/output.
- The pinned onboarding base fails at line 79 with:
  `manifest should record readiness provenance for canonical docs generation`
  (`false !== true`). This is the documented pre-existing provenance-name
  mismatch. Revision-impact must not touch or mask it.
- Record the five canonical readiness JSON SHA-256 values, readiness status,
  gate decision, missing inputs, canonical inspection-evidence count, readiness
  Markdown state, release state, branch, and HEAD before validation.

## Verification order

1. Confirm repo/worktree/branch/base identity and clean dependency separation.
2. Validate the new JSON schema and semantic invariants with focused fixtures.
3. Run pure normalization, comparison, evidence-applicability, reinspection,
   renderer, and path-safety tests.
4. Run the CLI twice with a fixed `--generated-at`; compare JSON and Markdown
   bytes and hashes.
5. Run direct job/API/artifact/Studio tests and browser smoke because Studio is
   changed.
6. Run the required regression lanes and Python tests.
7. Re-run the standalone pre-existing failure and compare its exact failure.
8. Re-hash canonical packages and verify no evidence/readiness/release mutation.
9. Capture `git diff --name-only` immediately before and after skeptical
   read-only review. Any change invalidates that review.

## Focused functional cases

- unchanged revision content -> `no_material_change`, zero reinspection items,
  all mutation boundary flags false
- metadata-only -> review/unaffected policy without reinspection
- nominal dimension change -> linked change and reinspection
- tightened tolerance -> linked `tolerance_change` and reinspection
- loosened tolerance -> human review, not automatic acceptance
- changed datum -> linked reinspection or explicit unable-to-determine
- added critical characteristic -> reinspection
- removed characteristic -> review without evidence deletion
- material/process change -> process-sensitive review
- unchanged engineering content with revision increment -> provenance review
- changed content without revision increment -> blocked governance conflict
- missing revision or stable identity -> explicit blocked/review state with no
  guessed mapping
- receipt revision/checksum mismatch -> blocked human review
- unrelated characteristic -> `unaffected`
- synthetic/generated marker -> never trusted evidence

## Adversarial matrix

| Input or attack | Required result |
| --- | --- |
| duplicate JSON object key | rejected before comparison |
| UTF-8 BOM or invalid UTF-8 | rejected before output |
| oversized or excessively nested JSON | rejected before output |
| non-finite number | rejected by parser/semantic validation |
| unsupported or ambiguous unit | `unable_to_determine` or validation failure; never guessed |
| duplicate feature/characteristic/change/assessment/plan ID | rejected |
| shuffled object keys or semantic arrays | byte-identical fixed-time output |
| absolute path, traversal, NUL, backslash | rejected/redacted; never serialized |
| symlink output/input escape | rejected |
| unsafe hardlink output alias | rejected |
| private URL, token, credential, secret marker | rejected before output |
| malformed review pack/readiness/envelope/receipt | rejected before output |
| package/revision mismatch | blocked/rejected according to identity boundary |
| receipt or source checksum mismatch | blocked with human review |
| interrupted/failed write | no partial final JSON or Markdown |
| exact rerun | idempotent, byte-identical artifacts |

## Focused commands

The implementation will add direct focused tests; expected commands include:

```bash
node tests/revision-impact-contract.test.js
node tests/revision-impact-cli.test.js
node tests/revision-impact-job.test.js
node tests/revision-impact-studio.test.js
node tests/command-manifest.test.js
node tests/d-artifact-schema.test.js
node tests/job-api.test.js
node tests/studio-job-bridge.test.js
node tests/studio-artifact-viewers.test.js
node tests/studio-artifact-actions.test.js
node tests/browser-i18n.test.js
```

## Required repository validation

Run and record exact exit status for:

```bash
npm ci
git diff --check
npm run check:source-hygiene
npm run test:node:contract
npm run test:node:integration
npm run test:snapshots
npm test
npm run test:py
npm run test:stage5b:no-evidence
npm run test:stage5b:pipeline-doctor
npm run bootstrap:doctor -- --clean
npm run maintainer:doctor -- --clean
npm run test:studio-browser-smoke
node tests/output-contract-cli.test.js
```

The feature is artifact-driven and should not require FreeCAD. Do not run or
claim runtime-backed geometry validation unless implementation unexpectedly
touches runtime-backed code and a real supported runtime test is then run.

## Determinism proof

Run at least one unchanged, one tightened-tolerance, and one missing-identity
fixture. For each relevant fixed fixture, invoke `compare-rev` twice with the
same timestamp and separate safe output directories. Prove:

- JSON files are byte-identical and have equal SHA-256;
- Markdown files are byte-identical and have equal SHA-256;
- JSON validates structurally and semantically;
- Markdown contains no claims absent from JSON;
- output references contain no absolute path or private source value.

## Canonical immutability proof

Record SHA-256 before and after every required validation for:

- `docs/examples/quality-pass-bracket/readiness/readiness_report.json`
- `docs/examples/plate-with-holes/readiness/readiness_report.json`
- `docs/examples/motor-mount/readiness/readiness_report.json`
- `docs/examples/controller-housing-eol/readiness/readiness_report.json`
- `docs/examples/hinge-block/readiness/readiness_report.json`

For all five packages verify the authoritative nested fields still show:

```text
readiness_summary.status = needs_more_evidence
readiness_summary.gate_decision = hold_for_evidence_completion
process_plan.missing_inputs contains inspection_evidence
```

Also prove:

- no canonical inspection-evidence envelope, authorization, onboarding snapshot,
  or attachment receipt was added;
- no readiness Markdown changed;
- no standard document or release bundle was regenerated;
- release status/count is unchanged;
- generated revision-impact files exist only in safe ignored/test/job output
  locations.

## Regression boundaries

Directly verify existing compare-rev, stabilization-review, review pack,
readiness, evidence graph, onboarding, mutation lock, source hygiene, Stage 5B
no-evidence, doctors, canonical integrity, artifact re-entry, Local API, and
English/Korean browser contracts. Do not weaken a test to obtain a pass.

## Evidence recording

Ignored task evidence is maintained under:

- `tmp/codex/revision-impact-reinspection-planning-status.md`
- `tmp/codex/revision-impact-reinspection-planning-tool-evidence.md`
- `tmp/codex/revision-impact-reinspection-planning-verification-status.md`

Each entry records command, exit code, relevant hashes/results, remediation when
needed, and whether the evidence is pre-change, focused, regression, or final.

## Completion gate

Completion requires all acceptance cases, deterministic output, compatibility,
job/API/Studio safe-reference behavior, bilingual rendering, immutable package
proof, the unchanged standalone failure comparison, and a valid read-only final
review. Any unresolved implementation regression yields `HOLD`; unavailable
non-required external runtime checks are reported without widening claims.
