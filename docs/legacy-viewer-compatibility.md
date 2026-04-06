# Legacy Viewer Compatibility Fence

`server.js` remains in this repository only as a compatibility shell for the older all-in-one websocket viewer.

## Preferred browser path

- Use `fcad serve` for the Studio-first browser path.
- `fcad serve` keeps `/` and `/studio` on the preferred Studio shell and `/api` on the local API info page.
- New browser and local API work should land on `src/server/local-api-server.js` and the Studio assets, not on `server.js`.

## Supported legacy entrypoints

- `fcad serve --legacy-viewer`
- `npm run serve:legacy`
- direct `node server.js [port]` remains available as a compatibility escape hatch, but it is not the preferred operator path

## Compatibility surface to preserve

- static asset serving for the legacy viewer shell
- `GET /api/examples`
- existing websocket message action names:
  - `build`
  - `design`
  - `draw`
  - `update_dimension`
  - `get_dimensions`

## What should not land here

- new Studio features
- new tracked-job UX
- new local API routes that belong on the `fcad serve` path
- speculative browser refactors that make the legacy shell look like the primary product surface

## Maintenance posture

- keep behavior stable for older websocket-driven workflows
- prefer wrappers, warnings, and docs updates over deeper legacy-shell refactors
- if a new browser capability is needed, add it to the Studio/local API path first and document the legacy gap honestly

## Verification notes

- `npm run test:node:integration` is the required task-level validation lane
- hosted-safe legacy smoke can confirm that the compatibility entry answers `/`, `/api/examples`, and static assets
- do not claim websocket or browser interaction unless it actually ran
