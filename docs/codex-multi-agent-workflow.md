# Codex Multi-Agent Workflow

This repository already exposes the right CLI surface for a layered Codex workflow:

- `fcad create`
- `fcad design`
- `fcad draw`
- `fcad validate`
- `fcad dfm`
- `fcad tolerance`
- `fcad report`

The prompt pack in [`prompts/multi-agent/`](../prompts/multi-agent/) turns that existing structure into a practical orchestration pattern instead of adding a new runtime.

## Agent split

- `orchestrator.prompt.txt`
  Decides order, keeps edits small, and routes work between subagents.
- `spec-writer.prompt.txt`
  Converts natural language or partial requirements into TOML under `configs/generated/`.
- `cad-builder.prompt.txt`
  Runs or prepares `fcad create` and only uses `fcad design` when TOML does not exist yet.
- `drawing-reviewer.prompt.txt`
  Owns `fcad draw` first, then `fcad validate` when a drawing plan exists.
- `manufacturing-reviewer.prompt.txt`
  Owns `fcad dfm` and `fcad tolerance`.
- `report-writer.prompt.txt`
  Summarizes artifacts, open risks, and exact next commands.

## Recommended execution order

For CAD-oriented requests, keep the default path simple:

```bash
fcad create configs/generated/cnc_motor_mount_bracket.toml
fcad draw configs/generated/cnc_motor_mount_bracket.toml --bom
fcad dfm configs/generated/cnc_motor_mount_bracket.toml --strict
fcad tolerance configs/generated/cnc_motor_mount_bracket.toml --recommend
```

Use `fcad design "..."` only when the request starts from natural language and there is no stable TOML yet.

## Generated example

This repo now includes a generated starting config:

- `configs/generated/cnc_motor_mount_bracket.toml`

It is intentionally simple:

- base plate
- one vertical support web
- one reinforcing rib
- four mounting holes
- drawing metadata
- manufacturing metadata for machining in AL6061-T6

## How to use in Codex

1. Paste [`prompts/multi-agent/orchestrator.prompt.txt`](../prompts/multi-agent/orchestrator.prompt.txt) into the main Codex session.
2. Keep the subagent prompts in the same folder available for narrower follow-up tasks.
3. Start with one of the examples in [`prompts/multi-agent/example-requests.md`](../prompts/multi-agent/example-requests.md).
4. Prefer adapting an existing example or the generated bracket before using `fcad design`.

## Notes

- `fcad validate` is normally meaningful after `fcad draw`, because validation expects a drawing plan.
- `configs/generated/` is the default home for Codex-authored TOML files.
- `output/` remains the default destination for generated artifacts.

## Known limitations

- The current `create` exporter accepts `step` cleanly for this example; do not assume `fcstd` export is available.
- The current `draw` flow can still emit plan-time warnings such as `notes.general is empty` and `Plan dims skipped ... _collect_auto_dim_values`, even when the SVG and QA outputs are generated successfully.
