# Studio product readiness implementation plan

> **For agentic workers:** Use the existing parallel worker assignments; root integrates, verifies, reviews, and lands the combined branch. Track progress with the checkboxes below.

**Goal:** Land the verified Studio upgrade, make the beginner example path intentional, validate navigation and preview resource behavior, and prepare a truthful human usability round.

**Architecture:** Preserve the Node CLI + Python + FreeCAD structure and existing Studio/API/manifest contracts. Add a small frontend recommendation catalog, deterministic behavior regressions, and a bounded repeatable preview measurement harness. Only repair defects reproduced by these checks.

**Tech Stack:** Existing browser ES modules, Node test/Chrome smoke harness, local FreeCAD 1.1.x.

**Spec:** User-approved follow-ups from the 2026-09-30 chat; existing [beginner UX contract](studio-beginner-ux-simplification.md), [product follow-up evidence](../audits/2026-09-26-product-followups.md), and [human session protocol](../design/studio-beginner-uat-session-kit.md).

## Global constraints

- Base is remote `master` pinned at `70cc32ff4fb5ac1c398d346a3a6e40fe02d7e080`; reviewed upgrade is commit `c19398c`.
- Preserve routes, API payloads, generated artifact names, metadata fallback, Korean/English support, execution/quality separation, and existing expert examples.
- No speculative navigation fixes, broad rewrites, new dependencies, or new AI calls.
- Human outcomes remain `NOT_RUN`/`NOT_MEASURED` until actual participant observations exist. Technical rehearsal is P0 and never contributes to human scores.
- Previous Round 1 candidate/results stay unchanged. New candidate must be immutable and clean after landing; pin and rehearse before participant sessions.
- Temporary control/measurement artifacts stay in this repository's `tmp/codex/` or ignored `output/`. No participant records are created during technical preparation.
- User authorized commit, push, PR, CI, and merge. Honor all required GitHub checks; do not bypass protection or use force push.

## Review focus

- Missing recommended example must not silently select a failure/probe fixture.
- Switching locale or opening an expert-selected example must preserve the current source/draft.
- Explicit navigation during restored job selection/background completion must remain owned by the user.
- Cache/source changes, duplicate requests, queue saturation, cancellation, and shutdown must preserve saved artifact authority and release resources.
- Technical success must not be counted as human usability, physical inspection, or production readiness.

## Task 1 — preserve the existing upgrade

- [x] Verify the exact reviewed diff hash and recorded final tests against current git state.
- [x] Commit the 18 reviewed files without temporary evidence.

## Task 2 — guided examples and Korean instructions

**Files:** `public/js/studio/examples.js`, guided portions of `workspaces.js`/`model-workspace.js`, `public/js/i18n/{en,ko}.js`, existing example/i18n/browser tests.

**Interface:** Pure helpers derive a recommended subset from the existing API catalog; default to `quality_pass_bracket` when present. Expert catalog remains intact. Verified recommended IDs: `quality_pass_bracket`, `hinge_block`. The initially considered `pcb_mount_plate` was excluded after its fresh strict draw failed (required-dimension coverage 16.67%, traceability 0%); it remains in the expert catalog.

- [x] Write failing behavioral cases for recommended order/default, absent recommendations, and expert selection preservation.
- [x] Render localized names and expected output guidance; replace the remaining scoped Drawing instructions with shared locale keys.
- [x] Verify both locales and the guided input action count in real Chrome.
- [x] Run fresh real-runtime starter generation after the performance worker releases FreeCAD.

## Task 3 — navigation and repeat-session behavior

**Files:** Shell routing/core/job-monitor only if reproduced; focused state/controller tests and `tests/studio-shell-browser-smoke.test.js`.

- [x] Reproduce or bound the refresh/user-Home/background-completion observation using deterministic delayed responses.
- [x] Test explicit user navigation versus restored selection and completion; repair only a demonstrated defect.
- [x] Exercise a bounded repeated route/reopen/locale sequence and record the count and outcomes.

## Task 4 — saved-model resource envelope

**Files:** Saved artifact preview service and focused tests if needed; `scripts/studio-preview-benchmark.js`; `docs/audits/2026-09-30-studio-preview-envelope.md`.

- [x] Measure bounded synthetic source sizes, fresh/cached conversions, duplicates/queue pressure, repeated requests, RSS, and failure recovery.
- [x] Separate real FreeCAD measurements from controlled fixture probes; keep GPU and unmeasured platforms explicit.
- [x] Regress and repair any demonstrated avoidable source-buffer allocation without changing artifact permissions, hashes, or cache semantics.
- [x] Save an executable measurement method and report exact samples/limits; do not invent a production performance guarantee.

## Task 5 — human test preparation and release

**Files:** New dated UAT round record and facilitator quick-start referring to existing task cards and scoring; root-owned status under `tmp/codex/product-readiness/`.

- [ ] Prepare the new-round instructions/blank aggregate; obtain participant availability from the user without fabricating records.
- [ ] Run final Node/browser/hygiene checks and scoped runtime validation; read-only whole-diff review with unchanged path list and hash.
- [ ] Commit scoped results; push and create/attach PR against master, wait for all required CI checks, repair failures if necessary.
- [ ] Merge only the reviewed exact head after required checks pass.
- [ ] Create a fresh post-merge worktree, verify merged tree and runtime/browser entry, pin the human candidate, and perform P0 on it.
- [ ] Run actual human sessions only when participants and observations are available; otherwise deliver the prepared frozen candidate and clearly retain pending human status.
