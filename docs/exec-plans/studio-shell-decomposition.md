# Studio shell decomposition

## Mission
Split `public/js/studio-shell.js` into a stable browser entry facade plus smaller focused modules so browser-side failures have a narrower blast radius while keeping current Studio behavior stable.

## Scope
- `/studio` boot flow
- route and hash synchronization
- shell chrome badges and drawers
- recent jobs and tracked-job monitor control
- workspace mounting and orchestration
- completion notices
- locale-triggered rerender hooks

## Global non-negotiables
- Keep `public/js/studio-shell.js` as the browser entrypoint.
- Preserve existing route and deep-link shape.
- Preserve DOM ids and `data-action` hooks.
- Preserve current API calls and tracked-job behavior.
- Keep user-visible behavior stable.
- Do not widen scope into workspace feature rewrites.
- Do not update snapshot baselines unless behavior intentionally changed and reviewed.

## Key files to inspect first
- `public/js/studio-shell.js`
- `public/js/studio/studio-state.js`
- `public/js/studio/job-monitor.js`
- `public/js/studio/jobs-client.js`
- `public/js/studio/workspaces.js`
- `public/js/studio/jobs-center.js`
- `public/studio.html`

## Repo identity constraints
- Expected repo basename: `freecad-automation`
- Required branch: `refactor/studio-shell-split`
- Preferred clean worktree:
  - `/Users/jangtaeho/Documents/New/worktrees/studio-shell-decomposition/freecad-automation`
- All task control files for this task must live inside the detected repo root.
- Stop on repo identity mismatch, nested-repo ambiguity, or unexpected pre-existing dirty state.

## Working method
For each phase:
1. read the relevant files and nearby helpers
2. use repo search before editing
3. implement the smallest coherent slice
4. run the smallest safe validation for touched areas
5. update `tmp/codex/studio-shell-decomposition-status.md`
6. repair failures before continuing

## Branch
- `refactor/studio-shell-split`

## Acceptance criteria
- `public/js/studio-shell.js` becomes a thin stable facade that boots the decomposed shell.
- Shell responsibilities are narrowed into focused modules for:
  - shell core
  - state or store
  - route synchronization
  - job-monitor control
  - workspace orchestration
  - DOM binding
- `/studio` route and deep-link behavior remain compatible.
- Recent jobs, chrome drawers, tracked-job monitor wiring, completion notices, and locale rerender hooks continue to work through the new boundaries.
- Touched validations pass or any blocked gaps are clearly reported.

## Phase -1 repo identity preflight
- print and record:
  - `pwd`
  - `git rev-parse --show-toplevel`
  - `git branch --show-current`
  - local vs worktree mode when available
- verify the repo root basename is `freecad-automation`
- verify the key files live inside the same repo root
- verify control files for this task will live only under that root
- capture clean-tree preflight snapshots:
  - `git status --short`
  - `git diff --name-only`
- if the main checkout is dirty and worktrees are available, create a clean task worktree and continue there

## Phase 0 discovery
- map the current `studio-shell.js` responsibility clusters and coupling points
- identify state ownership, route syncing, monitor control, workspace mounting, drawer toggles, and locale rerender hooks
- use repo search to find shell exports, event listeners, DOM selectors, and callers that constrain safe boundaries
- record the proposed module split and the smallest targeted validations

## Phase 1 foundation
- create the control-plane-safe module layout under `public/js/studio/` or a nearby focused shell namespace
- extract shared state and shell boot helpers first
- keep `public/js/studio-shell.js` as the stable entry facade
- preserve import order and runtime boot semantics

## Phase 2 primary surfaces
- extract route synchronization, DOM binding, workspace orchestration, and shell chrome control into focused modules
- preserve deep-link shape, selected-workspace behavior, recent jobs wiring, and completion notice behavior
- keep DOM ids, `data-action` hooks, and public browser behavior unchanged

## Phase 3 secondary and operational surfaces
- extract job-monitor control and locale-triggered rerender hooks into narrower modules
- align jobs center, tracked-job refresh, drawer updates, and rerender subscriptions with the new boundaries
- preserve operational behavior and error handling

## Phase 4 audit and remediation
- audit `public/js/studio-shell.js` for leftover heavy logic that should now delegate
- search for coupling regressions, duplicated state writes, or broken imports on touched surfaces
- fix only verified safe issues

## Phase 5 finalize
- run the strongest safe validation set for touched areas
- execute the verification and remediation plan in `docs/exec-plans/studio-shell-decomposition-verification.md`
- perform the read-only final review with before and after diff snapshots
- summarize changes, validations, leftovers, and risks

## Validation commands
- smallest relevant validations after each phase
- final full validation set:
  - `npm run test:node:integration && npm run test:snapshots`

## Manual smoke checks
- Open `/studio`
- switch major workspaces
- open and close jobs and log drawers
- exercise a selected-job deep link
- confirm completion notice plus locale rerender still work if runnable

## Final report format
Include:
1. summary
2. changed files grouped by surface
3. validations run
4. pre-existing diff notes
5. leftovers
6. commit hashes and messages if commits were made
7. push status
8. remaining risks
