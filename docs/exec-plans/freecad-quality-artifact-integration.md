# FreeCAD Quality Artifact Integration

## Goal
- Integrate completed quality artifact UI fixes and generated artifact output hygiene fixes into a clean branch from `origin/master`.

## Strategy
- Treat `/Users/jangtaeho/freecad-automation` and `/Users/jangtaeho/worktrees/freecad-automation-generated-artifact-output-hygiene` as read-only source worktrees.
- Apply only task-scoped diffs to `/Users/jangtaeho/worktrees/freecad-automation-quality-artifact-integrated`.
- Exclude generated demo artifacts, `configs/examples/*_manifest.json`, repo-root `demo_*`, `output/*`, and temporary status files from commits.
- Validate syntax, focused tests, broader suites, runtime smoke, source hygiene, and final diff state before local commit.

## Scope
- Recent Jobs quality decision display.
- Quality Dashboard fail-first layout.
- Required vs optional check/artifact semantics.
- Artifact inspector job-switch reset and direct route hydration.
- Generated artifact output namespace hygiene.
- Focused tests, docs, and source tree hygiene checks.

## Non-Negotiables
- No push, PR creation, deploy, or external writes.
- Keep job execution status separate from quality decision status.
- Optional missing artifacts must not block manufacturing review.
- Artifact viewer state must be scoped by active job.
- Generated verification artifacts must stay under `output/`.
