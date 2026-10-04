# Studio Workflow Completion Implementation Plan

> Agentic execution: implement and verify the four approved stages in order. Keep each milestone independently reviewable; record transient evidence under `tmp/codex/studio-workflow/`.

**Goal:** Complete quality reporting, reopen saved drawings for editing, export print-scale vector drawing PDFs, and edit supported model dimensions through Studio.

**Architecture:** Extend the existing Node job orchestration, registered artifact contracts, Python/FreeCAD renderer, and shared Studio state. Machine-readable artifacts remain canonical. Reuse proven runtime and manifest helpers; preserve generic CLI/report behavior and existing outputs.

**Tech stack:** Node ESM/Express, browser JavaScript with shared EN/KO locale, FreeCAD Python with bundled Qt SVG/PDF support.

**Spec:** User-approved sequence in this conversation, refined below against the existing implementation.

## Scope and constraints

1. An explicit full-quality report runs model creation and export reinspection, Drawing QA, and DFM from the same immutable input and job directory before rendering the report. Quality failures remain failures even when files are produced; execution failures are not disguised as quality success. Ordinary report requests retain their behavior.
2. Reopening a saved drawing uses a public artifact reference, verified same-job config/plan snapshots and fresh preview identity. Original saved artifacts remain immutable. Accepted values and settings resume; the previous browser session's undo stack is not reconstructed.
3. A separate drawing PDF preserves the SVG sheet's physical page size, scale, and vector content. The existing report PDF remains a reduced review reproduction. Existing filenames remain; a drawing PDF is additive.
4. A guarded parameter editor changes actual supported template geometry and matching declared dimensional intent. Start with the bracket plate dimensions/hole diameters and hinge hole diameters. Unknown or structurally altered configurations retain the TOML workflow. Stale previews and quality associations must be invalidated after accepted model changes.

No arbitrary filesystem paths in browser reentry. Keep registered SHA/size checks and detached bytes. Preserve warning-friendly default exit behavior, shared locales, routes, JSON artifacts and output-manifest/artifact-manifest contracts. No external paid provider or new runtime package is needed. Original checkout and frozen proof worktrees remain intact.

## Stage 1 — Full quality report

**Files:** `src/services/jobs/job-executor.js`, `src/shared/artifact-surface.js`, `public/js/studio/drawing-workspace.js`, shared locale files, executor/controller tests.

**Interface:** `options.full_quality: true` on `type: report` requests; invalid types/non-report usage rejected. Full mode uses existing `executeCreate` with STEP/STL exports, `executeDraw`, runtime DFM and report service. Return additive `create_result`; existing report artifact collector also registers its model/quality artifacts. Explicit caller DFM results cannot substitute for the fresh full-mode check.

- [x] Add failing full-mode pass/fail/stale-input/invalid-option/legacy regression cases.
- [x] Implement isolated current-run pipeline and Drawing action copy/payload.
- [x] Verify focused executor, report summary, API and UI tests.
- [x] Run actual FreeCAD on a supported example, inspect the canonical summary and PDF, and checkpoint the milestone.

## Stage 2 — Resume saved Drawing

**Files:** drawing service and local Studio routes, job coordinator/store integration, Studio artifact actions/workspace and Drawing state, route/service/UI tests.

**Interface:** `POST /api/studio/drawing-preview/from-artifact` with only `{artifact_ref:{job_id,artifact_id}}`. Public drawing SVG/plan selects a same-job artifact group. Resolve the final drawn effective config and plan using registered IDs and `readVerifiedArtifactSnapshot().readDetachedBytes()`. Return public preview plus safe canonical authoring config and selected settings/source IDs. Create a fresh preview ID/revision; never mutate the source job.

- [x] Reproduce absence of saved-plan resume and add tamper/missing/ambiguous-sibling tests.
- [x] Implement verified snapshot adapter and fresh preview restoration.
- [x] Add localized saved-result action and guarded shared-state handoff.
- [x] Verify save → browser/server restart → resume → edit → save, and unchanged original artifact digests.

## Stage 3 — Print-scale drawing PDF

**Files:** narrow Python SVG-to-PDF helper/script, tracked Drawing orchestration, artifact descriptors/collectors and result labels, Python/Node/UI tests.

**Interface:** additive `<name>_drawing.pdf` registered as `drawing.pdf`, derived from the final generated SVG. Use SVG physical millimetres and bounded supported page sizes with Qt PDF vector painting (nominal page box tolerance ≤0.2 mm for Qt integer-point rounding; verify physical line scale independently); reject unresolvable physical dimensions or external SVG resources. Keep report PDF reproduction behavior and filename intact.

- [x] Add failing exact-page-size/vector-content/source-containment tests.
- [x] Implement isolated export with explicit failure reporting and artifact registration.
- [x] Expose separate print-PDF action with EN/KO labels.
- [x] Verify real PDF page dimensions, vector output, visible dimensions and source scale on actual FreeCAD output.

## Stage 4 — Actual model parameter editing

**Files:** a small parameter-profile helper, Model authoring/rendering/state integration and shared locale, profile/controller/browser tests.

**Interface:** recognized bracket parameters: length, width, thickness, left/right hole diameter; hinge parameters: paired pin and mounting-hole diameter. Recognition checks topology, stable feature IDs/types/operations and consistent declarations, not filenames alone. Update dependent tool heights/intents/known quality targets on a cloned config. Validate the complete candidate before replacing the draft. Numeric errors and unsupported configurations are non-mutating.

- [x] Add failing structural-recognition, bounds, geometry/intent synchronization and stale-state tests.
- [x] Implement parameter edits and guarded numeric form using existing config serialization/validation.
- [x] Invalidate old transient model/Drawing requests, previews and quality association; keep saved jobs.
- [x] Verify actual changed FreeCAD dimensions/export geometry, regenerated Drawing/report, and unsupported-config fallback.

## Review focus and final verification

- Changes during an in-flight preview/edit/save must not lose accepted annotations or apply stale responses.
- Forged, missing, changed or ambiguous artifact inputs must not gain authority through reentry.
- Full-quality execution must not reuse old same-name evidence or caller-supplied passing DFM results.
- PDF physical size and vector output must be checked independently of its scale label.
- Geometry edits must update all mapped dependencies and invalidate stale evidence without silently rewriting unsupported designs.

After all milestones are stable, freeze changes, run `npm test`, `npm run test:py`, source hygiene and browser smoke, then perform independent read-only review with before/after diff lists and file hashes. Repair confirmed findings, land through normal CI and PR checks, and verify the merged tree in a fresh worktree with real FreeCAD and browser workflows.
