# Studio product readiness follow-up — 2026-09-30

The upgrade continues from `origin/master` `70cc32f` and the reviewed Studio experience commit `c19398c`. It preserves the CLI, job, route, manifest, and expert-example contracts. The [execution plan](../exec-plans/studio-product-readiness-2026-09-30.md) defines the scope.

## Recommended examples follow measured results

The guided model chooser now offers the two-hole bracket and hinge support block, with localized names, expected outputs, and the portable configuration filename. It defaults to the bracket. The full advanced chooser retains every example, including intentional failures and probes. An absent recommended catalog blocks guided continuation instead of silently selecting a failure fixture.

Fresh local checks used macOS FreeCAD 1.1.4. Each input was copied with only `export.directory` changed to an isolated ignored output folder; source configs and canonical packages were not rewritten. The commands were `fcad create <copy> --strict-quality` and `fcad draw <copy> --strict-quality --bom`.

| Candidate | Strict create | Strict draw | Guided recommendation |
| --- | --- | --- | --- |
| `quality_pass_bracket` | Exit 0 | Exit 0 | Yes, default |
| `hinge_block` | Exit 0 | Exit 0 | Yes |
| `pcb_mount_plate` | Exit 0 | Exit 1 | No; retained in advanced examples |

PCB drawing generation produced an SVG and QA score 85, but its unified drawing-quality decision was `fail`: required dimension coverage 16.67% and traceability coverage 0%, with missing `KEYWAY_W`, `STEP_DIAMETERS`, `OD1`, `OD2`, and `CHAMFER` intents. A generated drawing and a high raw QA score therefore were not treated as strict quality success. This task excludes the example from beginner recommendations; it does not modify the drawing planner or assert that the checked-in canonical package proves a fresh pass.

The accepted examples passing software checks does not certify manufactured-part tolerances, physical inspection, or manufacturing readiness. The measured command logs and full generated quality JSON stay under `tmp/codex/product-readiness/` and `output/studio-product-readiness/starters/`.

## Navigation belongs to the user

Deterministic tests reproduced result navigation after the user had chosen Home, including completion output arriving late and retry submission returning late. Submitted jobs retain automatic handoff only while their original navigation context is still current. Resumed/background jobs provide the completion notice; an already selected job refreshes its outputs without changing the user's route. Uninterrupted submitted-job handoff remains covered.

The browser verification supports an optional bounded repeat test: `STUDIO_BROWSER_SOAK_CYCLES=36 npm run test:studio-browser-smoke`. The full browser smoke passed with 36 cycles, 72 route changes, and 36 locale changes. A second run used `STUDIO_BROWSER_SOAK_INTERVAL_MS=5000`; its loop lasted 184,445 ms (3 min 4.445 sec) and also passed. Real CDP V8 used-heap snapshots were 10,152,736 → 7,685,608 bytes; they are not process RSS or a leak diagnosis. The option is disabled by default so ordinary CI stays fast. Repeated route/locale/result checks do not establish multi-hour stability or absence of all memory leaks.

## Resource measurements and human validation

[Preview measurements](2026-09-30-studio-preview-envelope.md) separate synthetic byte-volume memory probes from real FreeCAD geometry conversion. They describe the memory/latency tradeoff rather than claiming a blanket speedup.

The [new human-test packet](../design/studio-upgrade-uat-2026-09-30.md) prepares a new immutable candidate, P0 technical rehearsal, and the existing five-person criteria. Actual participants and a human bilingual meaning review are still required; automated runs and agent interaction are never counted as human outcomes. Previous Round 1 records stay unchanged.
