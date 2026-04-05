# Local API Server Route Modularization

## Mission
Split `src/server/local-api-server.js` into route modules and focused helpers for jobs, artifacts, studio preview routes, landing/static delivery, and shared response helpers while keeping the public local-API contract stable.

## Scope
- Browser/API surfaces:
  - `/`
  - `/studio`
  - `/api`
  - `/health`
  - `/jobs*`
  - `/artifacts*`
  - `/api/studio*`
- Support surfaces:
  - static asset delivery
  - landing payload shaping
  - artifact response shaping
  - server boot composition

## Global Non-Negotiables
- Keep `createLocalApiServer` as the stable entrypoint.
- Preserve current route paths, payload shapes, status codes, and redaction behavior.
- Extract static asset registry and landing payload helpers.
- Do not widen into CLI runtime changes.
- Keep English fallback behavior and existing lightweight browser locale behavior intact on touched surfaces.

## Key Files To Inspect First
- `src/server/local-api-server.js`
- `src/server/local-api-contract.js`
- `src/server/local-api-schemas.js`
- `src/server/studio-job-bridge.js`
- `src/server/public-drawing-preview.js`
- `src/server/public-job-request.js`
- tests touching `createLocalApiServer`, `/jobs*`, `/artifacts*`, and `/api/studio*`

## Repo Identity Constraints
- The detected git root basename must be `freecad-automation`.
- All task control files must live under that same git root.
- If the original checkout is dirty, move to a clean task worktree before creating control files or implementation changes.

## Working Method
- Search the repo before editing.
- Keep diffs scoped, minimal, and reviewable.
- Preserve behavior outside the stated scope.
- Update `tmp/codex/local-api-server-modularization-status.md` after each phase.
- Run the smallest relevant validation after each milestone.
- Run the full validation command set before finalization.

## Branch
- `refactor/local-api-modules`

## Acceptance Criteria
- `createLocalApiServer` still constructs the same public server contract.
- Route registration is modularized into focused files by surface area.
- Shared response helpers, artifact shaping helpers, landing payload helpers, and static asset registry are extracted.
- Public route paths, response shapes, redaction behavior, and status codes remain stable.
- Touched contract and integration validations pass, or any remaining gap is explicitly reported.

## Phase -1 Repo Identity Preflight
- Print and record:
  - `pwd`
  - `git rev-parse --show-toplevel`
  - `git branch --show-current`
  - local/worktree mode
- Verify the git root basename is `freecad-automation`.
- Verify the key files are inside that root.
- Capture and record:
  - `git status --short`
  - `git diff --name-only`
- If the first checkout is dirty, stop there and continue only from a clean task worktree.

## Phase 0 Discovery
- Read `AGENTS.md`, this execution plan, and the related server files and tests.
- Map responsibilities currently mixed into `src/server/local-api-server.js`:
  - response helpers and schema assertions
  - landing payload and HTML/text rendering
  - static asset delivery
  - health/examples/profile routes
  - studio preview and tracked-job routes
  - jobs and artifact routes
  - server boot and lifecycle wiring
- Identify stable helper boundaries without changing behavior yet.
- Record discovery findings and intended module boundaries in the status file.
- Run a smallest relevant baseline validation for the untouched current behavior if needed to de-risk the refactor.

## Phase 1 Foundation
- Create shared helpers for:
  - error/response assertions
  - landing payload and response rendering
  - static asset registry
  - artifact/public shaping and redaction helpers as needed
  - job response shaping helpers as needed
- Keep exports additive and compatibility-safe.
- Update the status file with files changed, validations, and any repair notes.
- Run the smallest relevant validation that exercises foundational helpers.

## Phase 2 Primary Surfaces
- Extract focused route modules for:
  - landing/static delivery
  - studio preview and tracked routes
  - jobs and artifacts
- Keep route paths, content types, status codes, and payloads identical.
- Keep `/` Studio-first for browser HTML callers and preserve `/api` as the info page.
- Preserve preview-versus-tracked separation and artifact response semantics.
- Update the status file.
- Run the smallest relevant validation for the touched primary surfaces.

## Phase 3 Secondary/Operational Surfaces
- Extract or finalize operational routes and server composition:
  - `/health`
  - `/api/examples`
  - `/api/config/profiles`
  - JSON error handling
  - terminal internal-error handling
  - server close/dispose composition
- Minimize remaining orchestration in `src/server/local-api-server.js`.
- Update the status file.
- Run the smallest relevant validation for these operational paths.

## Phase 4 Audit/Remediation
- Audit actual changed files and route behavior against this plan.
- Check for accidental contract drift:
  - route strings
  - response schema kinds
  - artifact content headers
  - redaction behavior
  - Studio-first landing behavior
- Repair only verified gaps, keeping the diff narrow.
- Update the status file with findings and repairs.
- Run the most targeted validation needed after remediation.

## Phase 5 Finalize
- Run:
  - `npm run test:node:contract`
  - `npm run test:node:integration`
- Update the status file with final validations and remaining risks.
- Prepare for verification-plan audit and read-only final review.

## Validation Commands
- `npm run test:node:contract`
- `npm run test:node:integration`

## Manual Smoke Checks
- Open `/`, `/api`, `/studio`, `/jobs`, and a browser-safe artifact open/download path if runnable.
- If a real runtime is not used, keep verification terminology hosted-safe and do not claim browser interaction.

## Final Report Format
- Include:
  1. summary
  2. changed files grouped by surface
  3. validations run
  4. pre-existing diff notes
  5. leftovers
  6. commit hashes/messages
  7. push status
  8. remaining risks
