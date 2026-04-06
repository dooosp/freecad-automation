# Legacy Viewer Isolation

## Mission
Isolate `server.js` as a compatibility-only legacy viewer surface, make that legacy status explicit in code and docs, reduce drift against the local-API entrypoint, and prevent new feature work from landing there accidentally.

## Scope
- `server.js`
- `package.json` serve commands
- docs that mention legacy serve flows
- compatibility wrappers or documentation files needed to keep `serve:legacy` available without encouraging new development there

## Global Non-Negotiables
- Preserve `npm run serve:legacy` startup behavior unless a compatibility wrapper is clearly safer.
- Do not break existing websocket message actions:
  - `build`
  - `design`
  - `draw`
  - `update_dimension`
  - `get_dimensions`
- Do not add new legacy features.
- Make compatibility-only intent obvious in code and docs.
- Preserve behavior outside the stated scope.

## Key Files To Inspect First
- `server.js`
- `package.json`
- `docs/testing.md`
- `README.md`
- any docs files that mention serve flows or browser entrypoints
- any compatibility wrappers introduced by this task

## Repo Identity Constraints
- Print and record:
  - `pwd`
  - `git rev-parse --show-toplevel`
  - `git branch --show-current`
  - local vs worktree mode when available
- Verify the detected git root is the intended implementation repo.
- Verify the git root basename is `freecad-automation`.
- Verify the key files live under that same git root or would reasonably be created there.
- Keep all control files for this task inside that git repo root.

## Working Method
- Use repo search before editing.
- Keep diffs small, scoped, and reviewable.
- Prefer clarity, wrappers, comments, and docs updates over behavior rewrites.
- Keep identifiers and route paths stable unless a compatibility wrapper is clearly safer.
- Update `tmp/codex/legacy-viewer-isolation-status.md` after each phase.
- Run the smallest relevant validation after each milestone.
- Repair failures before moving to the next phase.

## Branch
- `refactor/legacy-viewer-fence`

## Acceptance Criteria
- `server.js` is explicitly labeled and structured as a compatibility-only legacy viewer entrypoint.
- `npm run serve:legacy` remains available.
- Current legacy websocket actions keep working by code path and naming.
- Primary docs and serve guidance point new work toward the local API or Studio-first surfaces instead of the legacy viewer.
- Legacy references that remain are clearly framed as compatibility or classic mode.
- Touched validations pass or gaps are clearly documented.

## Phase -1 Repo Identity Preflight
- Confirm repo identity and basename match before creating or editing files.
- Confirm key files exist in the target repo.
- Record local vs worktree mode.
- Stop immediately if repo identity fails.

## Phase 0 Discovery
- Read `AGENTS.md`.
- Read this execution plan.
- Inspect `server.js`, `package.json`, `docs/testing.md`, `README.md`, and any serve-flow docs.
- Search for legacy serve references and legacy viewer positioning.
- Record current entrypoints, scripts, docs references, and any drift against the local API entrypoint.
- Update the status file with discovery findings and the first validation snapshot.

## Phase 1 Foundation
- Introduce the minimum code or wrapper structure needed to make legacy compatibility intent explicit.
- Add guardrail comments or documentation at the legacy entrypoint so future feature work is directed elsewhere.
- Keep startup behavior for `serve:legacy` stable.
- Run the smallest relevant validation and update the status file.

## Phase 2 Primary Surfaces
- Update `server.js` and `package.json` serve commands or wrappers as needed.
- Make the legacy status explicit in browser-facing or operator-facing copy where appropriate.
- Reduce drift against the local API entrypoint without changing supported legacy behavior.
- Run the smallest relevant validation and update the status file.

## Phase 3 Secondary/Operational Surfaces
- Update `README.md`, `docs/testing.md`, and any serve-flow documentation that encourages use of the legacy viewer.
- Reframe remaining legacy paths as compatibility or classic mode.
- Keep operational instructions accurate for maintainers who still need `serve:legacy`.
- Run the smallest relevant validation and update the status file.

## Phase 4 Audit/Remediation
- Audit touched files for lingering peer-primary positioning of the legacy viewer.
- Search for newly introduced wording drift or unsupported feature framing.
- Fix only verified gaps that are safe and in scope.
- Run the task validation set and update the status file.

## Phase 5 Finalize
- Read the verification plan.
- Confirm status-file claims match the actual repo state.
- Capture remaining legacy references that intentionally remain and why.
- Prepare the final implementation report without editing during the final read-only review.

## Validation Commands
- `npm run test:node:integration`

## Manual Smoke Checks
- Run the legacy server entry if possible.
- Verify `/api/examples` responds if the runtime is available.
- Verify static asset serving responds if the runtime is available.
- Avoid claiming websocket or browser interaction unless it was actually exercised.

## Final Report Format
1. summary
2. changed files grouped by surface
3. validations run
4. pre-existing diff notes
5. leftovers
6. commit hashes/messages
7. push status
8. remaining risks
