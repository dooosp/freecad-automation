# Studio UI Redesign Draft

## Summary

- `fcad serve` now opens `FreeCAD Automation Studio` as the preferred browser UI on the non-legacy path.
- The older viewer remains available through `fcad serve --legacy-viewer` and `npm run serve:legacy`.
- Studio navigation is now split into `Start`, `Model`, `Drawing`, `Review`, and `Artifacts` workspaces.
- Preview routes stay separate from tracked runs: model and drawing previews are scratch-safe, while tracked jobs persist through `/jobs`.
- Browser-safe artifact links now have dedicated open and download routes, and tracked `inspect` / `report` can start from artifact references.
- Phase-3 hardening makes tracked execution more operational: public job payloads are sanitized, queue controls are capability-driven, the shell can monitor multiple active jobs, and completion handoff can deep-link into the selected job context.

## Migration note

- If you previously opened `fcad serve` at `/` expecting the API info page, use `/api` for that view now.
- If you previously relied on the all-in-one websocket viewer, switch to `fcad serve --legacy-viewer` until the remaining runtime-only and streaming interactions are fully migrated.
- The preferred contributor path for future browser work is the studio shell served by `src/server/local-api-server.js`, not the legacy `server.js` viewer.
- The current route surface for phase 3 is documented in [docs/studio-handoff.md](../studio-handoff.md), including preview bridges, tracked-job bridges, cancel/retry controls, selected-job deep links, completion handoff rules, and legacy escape hatches.
