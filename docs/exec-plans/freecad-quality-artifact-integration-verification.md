# FreeCAD Quality Artifact Integration Verification

## Required Evidence
- Repo identity and default branch/tip.
- Source worktree dirty state and excluded files.
- Integration worktree clean start.
- Scoped diff after each source patch is applied.
- Static syntax checks for changed browser, CLI, manifest, and hygiene files.
- Focused tests for Recent Jobs, Quality Dashboard, report decision summary, artifact actions, job monitor, studio state, and output manifest behavior.
- Broader suites: node lite, contract, browser smoke, runtime smoke, source hygiene, diff check, and default test suite.
- Manual acceptance checks for quality wording, fail-first ordering, optional semantics, artifact viewer state, route hydration, and output namespace hygiene.
- Read-only skeptical review with diff/status captured before and after.

## Skip Classification
- Environment skips must be recorded separately from task failures.
- Task-introduced failures must be repaired before commit.
- Known or pre-existing failures must be identified with command evidence.
