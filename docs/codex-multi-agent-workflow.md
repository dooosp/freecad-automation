# Codex Multi-Agent Workflow

Use this repository as a review-first system unless a task explicitly targets
legacy generation compatibility.

## Canonical Workflow

1. Prove runtime state with `fcad check-runtime`.
2. Build review context from the existing artifact or config:
   - `fcad inspect ...`
   - `fcad dfm ...`
   - `fcad review ...` for Gemini-backed TOML review
3. Capture or update the middle-layer artifacts:
   - feature identity
   - bottleneck candidates
   - fix options
   - verification plan
4. Run only the targeted follow-up command that answers the current question:
   - `draw`
   - `fem`
   - `tolerance`
   - `report`

## Non-Canonical Workflow

Do not default to:

1. `create`
2. `draw`
3. `dfm`
4. `tolerance`
5. `report`

That legacy path still exists, but it is not the front door for new work.

## Current-State Notes

- `review` is now first-class in the CLI, but it is still backed by the
  existing Gemini review script.
- The new middle-layer artifacts are contract-first in this wave.
- `validate` is useful after draw-plan generation, not as a general raw-config
  gate.
