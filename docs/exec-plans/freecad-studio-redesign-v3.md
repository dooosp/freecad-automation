# freecad-studio-redesign-v3

## Objective
- Redesign the five browser Studio surfaces to match the premium dark CAD/SaaS direction defined by `freecad_console_redesign.svg`.
- Preserve existing routes, locale behavior, runtime/API state, tracked-job state, and local-browser workflow behavior.

## Repo identity
- Repo basename: `freecad-automation`
- Repo root: `freecad-automation`
- Branch: `feat/freecad-studio-redesign-v3`
- Base ref: `origin/master`
- Base SHA: `30dd13d50348d7eedf35d7a84b06295395326496`

## Source of truth inspected
- `public/studio.html`
- `public/css/studio.css`
- `public/js/studio/renderers.js`
- `public/js/studio/workspaces.js`
- `public/js/studio/review-workspace.js`
- `public/js/studio/artifacts-workspace.js`
- `public/js/studio/model-workspace.js`
- `public/js/studio/drawing-workspace.js`
- `public/js/i18n/en.js`
- `public/js/i18n/ko.js`
- `freecad_console_redesign.svg` design reference asset
- local Studio reference screenshots captured during implementation

## Implementation phases
1. Preflight and tool routing
   - confirm repo identity, clean worktree state, target files, and available validation commands
   - record tool/plugin availability and fallback plan
2. Shared design system foundation
   - update shell-level tokens, gradients, chips, cards, sidebar, top bar, and empty-state styling in `public/css/studio.css`
   - extend reusable render helpers only where the current components cannot express the new layouts cleanly
3. Surface redesign
   - Console first, aligned closely to the SVG reference
   - Review, Package, Model, Drawing next using the same system
4. Polish
   - align spacing, hover/focus states, responsive behavior, and Korean copy hierarchy
   - keep state bindings and actions intact
5. Verification
   - run smallest sufficient automated checks
   - run local app and capture browser smoke evidence for all five surfaces
6. Skeptical review and handoff
   - compare plan, diff, validation evidence, and final screenshots
   - keep review read-only

## Editing boundaries
- Prefer `public/css/studio.css` plus the Studio workspace/render files.
- Avoid changing backend modules unless a UI rendering defect proves it is required.
- Do not modify unrelated existing temp/status files from other tasks.

## Expected deliverables
- redesigned shared Studio shell
- redesigned Console, Review, Package, Model, and Drawing surfaces
- updated task status, verification status, and tool evidence files
- evidence-only final handoff
