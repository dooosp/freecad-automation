# Product audit follow-ups — 2026-09-26

The three requested follow-ups were implemented in the agreed order on `codex/product-user-audit`, continuing from `ac685943cdeea69ebb14474b4031278e0c2f20ae`. This is an **AGENT-OPERATED USER SIMULATION**, not human UAT or physical inspection. No paid AI requests, push, PR, or merge were performed.

## Changes and evidence

| Change | Result | Commit |
| --- | --- | --- |
| Saved identity and file grouping | History and result summaries prefer recorded part identity and revision, with existing locale fallback. Explicit part identity stays cohesive across lineage/source records. TOML/config and STL files keep their technical meaning even when their filename contains `quality`, `inspection`, or `manifest`. | `92200c0` |
| Saved CAD reopening | View result opens the selected saved STEP/STP/BREP/BRP as a native-derived STL mesh; existing STL displays directly. Rotate, zoom, Fit, EN/KO, another saved part, and server restart were exercised in Studio. | `0f388c0` |
| Nonblocking runtime health | Native diagnostics run in a reusable worker. Only concurrent requests share a pending probe; completed diagnostics are never reused. Path discovery and probes run again; worker failures/timeouts return 503. Successfully diagnosed runtime absence still returns the existing unavailable status. | `e07ee86` |

The saved identity regression renders two distinct part/revision records in both locales. Real UI checks reopened the persisted wrong-hole bracket, imported bracket review, and belt-drive jobs. Revision display was verified with synthetic recorded metadata; no new physical revision was asserted.

The browser suite caught an omitted `runtime.fingerprint` type after file classification changed. A failing behavioral regression was added, the type classification was corrected in `0f388c0`, and the unchanged browser assertion passed. Generic labels for some legacy review sidecars remain; filenames are visible. UX-06 is therefore partially mitigated as a broader audit finding, while the requested part/revision and TOML/STL scope is complete.

## Saved-model contract and boundaries

`POST /artifacts/:jobId/:artifactId/model-preview` is available only for registered, existing, downloadable, user-facing CAD files within the existing artifact authority. Optional `capabilities.can_preview_model` and `links.model_preview` advertise it. Existing raw open/download capabilities and filenames remain unchanged.

STEP/BREP conversion reads a snapshot of the selected source bytes. It does not regenerate from a config or select another file with a similar name. The derived mesh cache is keyed by job, artifact and SHA-256; source changes invalidate it and changes during conversion reject the response. Each request still checks artifact authority. In-flight identical conversions coalesce; at most six completed meshes are retained, each at most 32 MiB. Temporary conversion files are removed. Switching selection or unmounting cancels the browser request, discards stale responses, and disposes graphics.

Tests cover two job identities, non-public/unsupported files, unknown/deleted artifacts, cross-job symlinks, hostile Origin, same-size source replacement, conversion failure/retry, size limit and shutdown. Live API tests converted a real saved STEP; native STP/BREP/BRP checks also produced complete nonempty binary STL and preserved their sources. Two saved STEP shapes and an STL were inspected in the actual browser. All original CAD/config/quality hashes in the selected belt-drive job were unchanged after a preview request.

A separate server with an intentionally missing runtime displayed a clear STEP-preview failure and offered the existing download fallback. The existing saved STL still rendered there. A fresh Studio tab reopened saved STEP after the main server restarted. The main server remains at `http://127.0.0.1:3323/`; the temporary unavailable-runtime server was stopped.

## Health performance and freshness

The worker preserves the existing diagnostic schema, redaction and non-evidence status. It shares the process environment and rediscovers runtime paths for each new probe. Worker reuse does not imply result caching. Crashes, normal unexpected exit, timeout, disposal and unavailable → available → unavailable override transitions are covered; a failed worker is replaced on the next request. Async injected diagnostics also preserve the existing server test seam. CLI diagnostics remain unchanged. The implementation uses the documented [Node worker environment-sharing behavior](https://nodejs.org/api/worker_threads.html#worker_threadsshare_env).

| Local measurement, milliseconds | Before median / p95 | After median / p95 | Samples |
| --- | ---: | ---: | ---: |
| Warm `/health` | 54.442 / 57.096 | 96.279 / 110.674 | 20 each |
| Idle `/jobs` | 9.666 / 14.678 | 10.460 / 14.817 | 20 each |
| `/jobs` during eight concurrent `/health` requests | 432.254 / 442.851 | 11.246 / 12.540 | 8 bursts each |

The improvement is server responsiveness during diagnosis. Standalone health latency increased in these samples; no faster-health claim is made. Fresh path discovery/probing still has a cost. Samples were local, with background verification work present, and eight-sample p95 is just the maximum. These are observations, not stable production benchmarks. Full samples are in [the follow-up measurement record](2026-09-26-product-followups-measurements.json).

A second controlled comparison ran after our verification processes finished, using the same current server/job store with either the prior synchronous diagnostic factory or the new default worker. Median job-list latency during eight health requests was 887.593 → 19.782 ms; standalone health was 74.006 → 117.068 ms. Both measurements show the same responsiveness improvement and standalone-probe cost. OS/app background activity was not controlled. Raw samples and the exact method are retained in the measurement record.

One already-cached saved STEP request plus subsequent source-hash verification took 5.397 ms and returned 264,884 bytes / 5,296 triangles; this is not isolated HTTP latency. Single native conversion checks took 395.314 ms for STP, 367.879 ms for BREP and 367.725 ms for BRP. These are separate inputs and cache states, not a before/after speedup or a latency distribution.

## Verification

| Executed check | Result |
| --- | --- |
| `npm test` after the preview change | PASS: contract, integration and snapshot lanes. |
| Final `npm test` | PASS: 154 named check programs (127 contract, 25 integration, 2 snapshot). |
| Final `npm run test:studio-browser-smoke` | PASS: real browser regression suite, both locales and existing responsive/focus assertions. |
| `node tests/local-api.integration.test.js` | PASS with real FreeCAD 1.1.3; health schema and saved STEP mesh bytes verified. |
| Runtime-health parity, public-path redaction, local API access, serve CLI, lane manifest | PASS. |
| New preview authority/cache/lifecycle and health async/worker tests | PASS; registered in the default Node suite. |
| `npm run check:source-hygiene` and `git diff --check` | PASS. |
| Actual Studio interaction | PASS for saved STEP/STL, two shapes, EN/KO, drag/scroll/Fit, server restart, and missing-runtime fallback. |

Behavioral red logs include wrong result labels, missing preview capability/native route, shutdown race and async health response. A stale-response mutation made the viewer regression fail before restoring the guard. Logs and screenshots remain ignored under `tmp/codex/product-followups/`. No assertion was weakened or snapshot baseline regenerated to hide failures.

The earlier audit's full Python/289-case runtime results are historical; they were not rerun for these scoped follow-ups. The new Python converter ran through real FreeCAD checks. Large-model/GPU memory, long soak, Windows/Linux execution, screen-reader use and human UAT remain unmeasured. Worker crash tests use synthetic fixtures; actual FreeCAD was not killed during a user's modeling job. The saved viewer is a mesh inspection surface and does not certify geometry quality or manufacturing readiness.

## Review and state

Read-only reviews captured `git diff --name-only` immediately before and after and compared equal. Health review also compared porcelain status including untracked implementation files. No blocking introduced issue was identified. Review evidence is under `tmp/codex/product-followups/*review*`.

Original checkout, master and remote-tracking master remain preserved. The follow-ups are local commits on the existing audit branch. Remaining audit areas include beginner-example/legacy-copy curation (UX-07), incremental modularization (ENG-01), and the unisolated navigation lifecycle hypothesis (UX-10). They are outside these three requested follow-ups.
