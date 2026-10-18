# Audit remediation and SVG inventory — 2026-10-18

> Execution: use systematic debugging and test-driven development for behavioral fixes; use dispatching-parallel-agents for the independent report, Studio, and URL/CLI defects. Root integrates and verifies the complete branch.

## Goal and basis

Implement the user's approved 2026-10-18 audit priorities on top of master
`659405b3e36d01d21027f0c75db3f7e36ded159b`, and collect current repository SVGs
with explicit source/revision labels. Preserve October Studio behavior and all
historical artifacts. PR #203 is a reference for individual fixes, not a branch
to merge wholesale. The audit is `FreeCAD_Automation_Audit_2026-10-18.md` delivered
in the preceding session; its findings are restated below for reproducibility.

## Constraints

- Keep Node CLI / Python / FreeCAD architecture and canonical JSON contracts.
- Never accept unlinked historic quality as current-input proof.
- Do not regenerate or rewrite historical CAD, inspection evidence, or SVGs.
- No paid AI calls, physical inspection claims, main-branch push, or merge.
- This checkout is an isolated audit clone, now on a dedicated fix branch.
- User authorized implementation; no additional plan/worktree confirmation is needed.

## Tasks

1. **Report provenance** — `src/services/report/report-service.js`, relevant
   decision summary helpers and tests. Reproduce a prior-input pass being reused
   by a changed config. Compare consumed input bytes and manifest-linked quality
   file hashes; reject mismatched or unverifiable data from pass/readiness
   aggregation, expose stable diagnostics, preserve valid same-input reuse and
   Studio full-quality collection. Cover changed input, swapped quality file,
   missing/malformed provenance, and legitimate current inputs. Run focused
   report and job integration tests.
2. **Studio JSON parity and async tests** — model/drawing services, job bridge,
   API input-error handling and their tests; `tests/studio-model-parameters.test.js`.
   Reproduce JSON failures, apply only missing common-parser changes from #203,
   cover JSON/TOML normalization, invalid/unsafe inputs, edited drawing saves and
   create/draw/report submissions. Replace tick-count assumptions with observable
   completion conditions in the two audited flaky tests. Preserve revision checks.
3. **URL freshness and CLI invocation** — `scripts/_shapes.py` and matching Python
   tests; `bin/fcad.js` and relevant CLI tests. Reproduce stale URL cache and
   design-to-create string/array mismatch. Choose bounded revalidation with
   explicit failure on unavailable remote freshness (no silent stale fallback),
   retain atomic cache writes, and pass the expected argument array to create.
   Test using controlled network/runtime stubs, no paid or FreeCAD calls.
4. **Current guidance and SVG collection** — `AGENTS.md`, `README.md`,
   `docs/support-matrix.md`, current Studio guidance, package engine metadata.
   Label old task addenda/history and correct obsolete claims. Declare a Node
   version actually supported by CI. Inventory every remote branch's SVG paths
   and hashes; package current master files first, unique branch-only versions
   separately, with original paths, commits, dates, and checksums. No timestamp
   alone is evidence of regeneration or current geometry validity.

## Review focus

- Changed config at the same path must not inherit an old pass.
- A matching manifest cannot bless replaced/unrelated quality bytes.
- Missing provenance must be visible and must not assert current readiness.
- JSON source must preserve saved drawing revision and unsafe-key validation.
- SVG tests, examples, and unmerged presentation assets must not be conflated.

## Integration follow-up

Independent review additionally required rejection of failed-run quality reuse,
binding DFM's effective process/standard, and conservative display of conflicting
legacy UI records. The first full Node run also exposed a pre-existing public
API path leak under container roots; it was reproduced on the original baseline
and fixed narrowly in both existing path redactors. Verification and limits are
recorded in [the completion audit](../audits/2026-10-18-remediation.md).

## Completion checks

- [x] Focused red/green regressions recorded for each behavioral fix.
- [x] Full `npm test`, Python suite, source hygiene and whitespace checks run;
      failures/skips described honestly, FreeCAD runtime availability recorded.
- [x] Independent read-only whole-diff review, material findings resolved.
- [x] SVG originals unchanged; inventory hashes and archive contents verified.
- [x] Corrections retained on a dedicated review branch; no master merge.
- [x] Korean result report and SVG archive prepared with verification limits.

The user explicitly approved publishing the corrections and draft PR to
`dooosp/freecad-automation` on 2026-10-18 after the initial publication block.
The final handoff records the remote commit, draft PR, and downloadable files.
The user's Mac folders were not inspected or changed by this task.
