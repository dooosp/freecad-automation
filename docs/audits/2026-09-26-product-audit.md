# FreeCAD Automation product audit — 2026-09-26

Follow-up update: the requested saved identity/file-grouping, authorized saved 3D viewer, and nonblocking runtime-health work is documented in [the follow-up report](2026-09-26-product-followups.md). The findings ledger reflects those later dispositions. The audit narrative and measurements below retain their original historical scope.

## 1. Product outcome and scope

The real Studio can create and display a model, produce a drawing, import CAD, run a structured review, and reopen saved work. Before repair, successful-looking flows concealed missing geometry, missing quality checks, lost review summaries, and clipped PDF advice. **12 findings were repaired in separate commits. Six entries remain deferred or partially mitigated**, including one navigation hypothesis. This is an audit of representative product journeys and their implementation boundaries, not an exhaustive certification of every command or CAD input.

All personas are **AGENT-OPERATED USER SIMULATIONS**, not human UAT. No physical inspection was performed, paid AI request sent, production-readiness approval granted, or master merge made. Generated geometry stays distinct from physical evidence.

The [findings ledger](2026-09-26-product-audit-findings.json) records each finding's scenario, priority, user/engineering impact, reproduction, evidence, related code, cause, confidence basis, fix, regression requirement, performance implications, and disposition. The [measurement record](2026-09-26-product-audit-measurements.json) preserves the numerical samples. Raw logs, screenshots, input copies and runtime outputs remain locally under `tmp/codex/product-audit/`; they are ignored and not committed.

## 2. Baseline and preservation

- Repository identity: `https://github.com/dooosp/freecad-automation.git`; default branch `origin/master`.
- Audited baseline: `4dba0d32fe1b10f2266f27501165e56df9f943af`, pinned from remote master into the managed `product-user-audit` worktree.
- Original checkout: `codex/mega-studio-api-contract-fuzz-audit` at `25fc0562fb67374ee5d2c4a1a932a4d8cd66bd40`. Its existing untracked portfolio and superpowers documents were preserved.
- Local master remained `f02713d2b0168319384ad7935bdc4fad93451595`; audit branch is `codex/product-user-audit`.
- Environment: macOS arm64, Node 25.8.0, npm 11.11.0, actual FreeCAD 1.1.3. `npm ci` installed the repository's 74 packages. No separate build, lint, or typecheck script exists; source hygiene is available.
- Before source inspection or production edits: startup README/help, visible UI journeys, isolated job stores, baseline `npm test`, timing samples, failure probes, and a findings ledger were completed. White-box inspection followed these observations.

Baseline CI was read, not triggered: [hosted Automation CI](https://github.com/dooosp/freecad-automation/actions/runs/34969772312), [self-hosted runtime](https://github.com/dooosp/freecad-automation/actions/runs/36136406137), and [maintainer doctors](https://github.com/dooosp/freecad-automation/actions/runs/35613544621) succeeded on the pinned baseline. These are not audit-branch CI results. The audit branch is local and unpushed.

## 3. Persona journeys and before/after behavior

Sessions A/B/D used separate server origins and empty job stores. C used a separate origin with B's persisted completed work, as a returning operator would. No implementation/test code was used to discover the initial paths. Agent timing includes observation, thought and tool transport; it is not a human usability benchmark.

| Persona and expected path | Baseline observation | Verified repeat |
| --- | --- | --- |
| A, beginner: Home → default model → 3D → drawing → history | 8 primary actions, 62.784 s observation wall time. The real `belt_drive` viewport and drawing worked; history was empty. The temporary/persistent distinction and quality availability were unclear. | The four-action model preview still works. The result now explains its temporary nature and offers Save result to history. Saving takes three additional actions (menu, Save, existing tracked-run confirmation). Actual saved `belt_drive` now has quality JSON and history status. Drawing again reports QA 81/100, 20 automatic dimensions, 0 conflicts. |
| B, CAD engineer: Home → choose STEP → check → review | 7 primary actions plus locale change, 48.146 s to results. Runtime was ready, but body count was 0 and detector output absent. Review showed generic advice despite a detailed JSON pack. | Real STEP extraction reports one body, six cylindrical faces, and 160 × 100 × 8 mm geometry. A new structured review displays three hotspot titles and its actual recommended next action. Missing physical evidence is not supplied or invented. |
| C, returning operator: Home → history → result | Two actions to reopen the result list, 24.898 s including observation. Saved review survived a new server; name `review_pack_context` was vague. Primary PDF action showed generic metadata. | Saved jobs survive restart; PDF has a direct permitted Open PDF action. HTTP bytes and local PDF render are valid. This app's embedded PDF reader displayed a plugin failure, so successful in-browser PDF rendering is **not claimed**. Saved STEP still lacks a dedicated 3D viewer. |
| D, error-prone: bad input → visible error → change/correct input | Invalid TOML and TXT were rejected and recoverable. Corrupt STEP was misleadingly called readable/ready while geometry inspection failed. Refresh preserved the completed review. | Corrupt input now explicitly shows metadata-only/unverified geometry, with review remaining conservative. Missing-runtime generation is disabled. Oversized upload and HTML-like filename handling remain safe in the tested cases. |

Post-fix repetitions establish completion and corrected decisions, not a statistical improvement in human error rate or comprehension. The recorded 33.779 s repeat segment covers Continue → preview → saved default-model result only, so it is not directly comparable with A's longer baseline journey. Full repeat-journey timing was NOT MEASURED.

Evidence: `audit-journal.md`, `persona-a-*`, `persona-b-*`, `persona-c-*`, `persona-d-*`, `regression-a-*`, `regression-b-*`, `tracked-quality-*-after.*`.

## 4. UX, accessibility, and responsive findings

Home and Review were actually measured at 1440, 1024, 768 and 390 px; document scroll width equaled client width. Model and Drawing were used at 390 px; normal desktop was 1280 × 720. Early screenshots labeled `c-results-*` did not receive the requested size and are excluded; verified `d-home-*` and `d-review-*` measurements replace them.

Keyboard Tab/Shift-Tab/Enter navigation, skip link, mobile menu, model flow and drawer return focus were exercised. A strict 320px browser assertion caught a toggle at y = −0.375 px after closing a drawer; explicit scroll restoration fixed it without weakening containment checks. The browser smoke also verifies 44px mobile targets and emulates reduced motion, asserting zero-duration transitions/animations. Actual OS reduced-motion interaction and actual 200% browser zoom were not measured; the attempted in-app zoom shortcut did not change viewport or DPR. No screen-reader or human comprehension study occurred.

Fixed UX defects: false empty error alerts, absent save entry point, misleading import truth, generic large-JSON review summaries, indirect PDF opening, lost drawer focus, and inaccessible create-quality detail. Korean/English UI keys are preserved; generated engineering messages remain source text. Raw examples, several legacy English strings, vague history names and coarse file categories remain visible (UX-06/07).

## 5. Reliability and recovery

| Scenario | Actual result and limit |
| --- | --- |
| Invalid TOML | Visible parser line reference; input retained for correction. |
| Unsupported TXT | Rejected; Change file clears the old failure. |
| Damaged STEP | Geometry fails; metadata fallback explicitly labeled after repair. No geometry pass asserted. |
| Runtime absent | Isolated server launched with an intentionally nonexistent runtime path; UI reports unavailable and disables generation. No machine setting changed. |
| Oversize upload | A 33,554,433-byte file (32 MiB + 1) was rejected at the visible local upload boundary. |
| Failed job/retry | Actual corrupt inspect failed; retry accepted with a distinct job ID. Unchanged damaged input is not expected to become valid. |
| Three simultaneous creates | Three 202 responses, all three completed; isolated artifacts retained. |
| Cancel/retry while running | 409 with an explicit unsupported state. The queued jobs were claimed before cancellation arrived; **successful real queued cancellation was not observed**. Automated queue-control tests pass. |
| Refresh / restart | Active review recovered after refresh; completed job history and artifacts survived server restart. |
| Stale reference / partial output | Unknown job/artifact returned 404. Temporarily moving an audit-owned STEP produced 404; `finally` restored it and the same route returned 200 with 23,587 bytes. |
| Failed preview | STL inline-open capability rejects access; supported download remains separate. PDF bytes were valid but this embedded browser reader failed. |

No destructive fuzzing, runtime process kill during an active model, long soak, or large multi-user workload was performed. One refresh/Home transition returned to artifacts while other runs finished; root cause was not isolated (UX-10 hypothesis). An old tab also needed a fresh tab to reopen quality detail after repeated reloads and cross-tab locale changes; the fresh tab then switched the same cached artifact KO → EN → KO successfully. This lifecycle observation remains unisolated. No data loss was observed in these probes.

## 6. Performance baseline and comparison

All values below are milliseconds. CLI operations used a three-run bracket fixture with STEP/STL/BREP outputs; runtime and server processes were fresh, but OS filesystem caches were not cleared. HTTP endpoints have 21 samples. p95 uses nearest rank; with n=3 it is merely the maximum. No performance target was invented.

| Operation | n | Before median | Before p95 | Before min–max | After median | After p95 | After min–max | Failures before/after |
| --- | ---: | ---: | ---: | --- | ---: | ---: | --- | ---: |
| server-start-to-health | 3 | 1011.673 | 1021.023 | 925.017–1021.023 | 891.923 | 913.612 | 875.312–913.612 | 0 / 0 |
| studio-http | 21 | 1.802 | 9.716 | 1.022–12.140 | 1.352 | 3.631 | 1.023–3.780 | 0 / 0 |
| health-http | 21 | 53.813 | 104.495 | 50.347–109.903 | 49.650 | 50.278 | 48.646–51.434 | 0 / 0 |
| empty-jobs-http | 21 | 0.578 | 5.488 | 0.426–6.429 | 0.600 | 5.004 | 0.425–5.512 | 0 / 0 |
| runtime-probe | 3 | 836.817 | 941.335 | 724.287–941.335 | 724.535 | 725.206 | 721.379–725.206 | 0 / 0 |
| create | 3 | 2118.689 | 2153.194 | 1944.396–2153.194 | 1795.244 | 1951.266 | 1762.500–1951.266 | 0 / 0 |
| inspect | 3 | 1199.233 | 1201.351 | 1001.573–1201.351 | 996.660 | 999.363 | 994.274–999.363 | 0 / 0 |
| draw | 3 | 1574.254 | 1812.008 | 1472.528–1812.008 | 1368.573 | 1374.901 | 1362.626–1374.901 | 0 / 0 |
| report | 3 | 1903.995 | 2016.753 | 1859.384–2016.753 | 1643.206 | 1645.846 | 1635.688–1645.846 | 0 / 0 |

Lower after-run CLI times are observed samples, **not evidence of a causal speedup**: the machine/cache/load conditions were not controlled experimentally. Report was measured after drawing, so it is not a fully cold report pipeline.

Additional measurements:

- Warm browser reload → visible primary action: 117 / 247 / 383 ms; median 247 ms. Includes tool transport; not LCP.
- Warm Home → history → first saved result summary: 279 / 379 / 335 ms; median 335 ms, n=3, two primary actions each, no failures. Includes browser transport on a shared host while Node tests ran; no baseline-equivalent speedup claim.
- Baseline file-check click → assumptions: STEP 594 / 601 / 645 ms, FCStd 529 / 534 / 531 ms. Baseline STEP used the broken metadata fallback, so it is not quality-equivalent to the repaired extraction path.
- Tracked create immediately around ENG-02: before median 422.562 ms (417.171–425.378), after 872.381 ms (824.193–1320.259), n=3 each, 0 failures, 50ms polling resolution. New real STEP/STL reimports explain additional work; this is not a regression hidden by removing checks.
- Three-job loading: before median 2.903 ms / p95 3.218, after 3.954 / 5.816; 21 samples each. New job payloads include quality evidence and are larger.
- Authorized STEP artifact HTTP open: before median 1.020 ms / p95 1.194, after 1.060 / 1.977, 21 samples each; 32,571-byte fixture. This is byte retrieval, not 3D-render completion. A preliminary STL inline-open probe returned the expected 403 and was excluded from STEP timings.
- CLI baseline CPU user+system ranges: runtime probe 0.92–1.10 s, create 2.13–2.29 s, inspect 1.23–1.40 s, draw 1.67–1.82 s, report 1.96–2.12 s. Maximum reported RSS respectively 155.81 / 159.69 / 156.78 / 164.08 / 160.27 MiB. `/usr/bin/time -l` is not a simultaneous process-tree memory measurement.
- Per measured create/draw output folder: 27 files, 439,902 bytes before and 441,554 after (includes config/sidecars and run metadata). The report command also writes its report to the repository's ignored output location; that PDF is outside this folder count.

PERF-01: health requests call synchronous runtime diagnostics on the Node request path, explaining substantial warm request cost compared with job lists. Async/coalesced probing requires explicit freshness and unavailable-runtime tests; a speculative cache was not added. Saved 3D-render latency, true cache-cold startup, stable tail percentiles, GPU/combined process memory and long-workload performance are NOT MEASURED.

## 7. Security and privacy findings

SEC-01: untrusted Host reached `/health` (200), and a direct HTTP request with an external Origin could submit a job (202). The repair checks loopback authority/listening port and exact same-origin before routing/body parsing; the same probes now return 403. Local CLI calls without Origin and same-origin Studio still work. Browser CORS previously lacked ACAO; a real cross-site browser data read or DNS-rebinding exploit was not demonstrated. Final severity is P2, reduced from the provisional baseline P1 for this evidence limit.

SEC-02: embedded absolute paths in draft TOML escaped public request/bootstrap redaction. Existing shared redaction now handles nested strings without mutating persisted execution input. A real import/review and final `/jobs` response have no leaked absolute checkout path strings in the tested fields.

Absolute and parent-traversal inspect requests return 400; raw local-file and unknown artifact/canonical routes return 404. A filename containing `<img src=audit-marker>` rendered as text with no injected image. A forged inspection-evidence status was rejected. Authorized raw artifacts remain explicit local downloads; this audit does not claim to redact every path from every canonical user-exported file. No credential stores were read, no secrets published, and no evidence/readiness/path boundaries weakened. This was a public product-surface audit, not an exhaustive native parser or repository-wide security certification.

## 8. Engineering findings

Confirmed problems included runtime entrypoint mismatch, discarded measured geometry, CLI/Studio quality divergence, JSON truncation before parsing, incomplete PDF rendering, CSS hidden-state override, and missing browser authority checks. Changes reuse the existing Node → Python → FreeCAD architecture, quality generator, shared manifests, locale mechanism and artifact capabilities.

The baseline `workspaces.js` (3,795 lines) and artifact workspace (2,753 lines) are maintenance risks. Source-regex checks passed while real runtime/semantic flows failed. New checks exercise real HTTP JSON, actual runtime invocation, rendered labels, persisted artifacts and failure separation. Broad module decomposition, dead-code removal, and a new manifest/i18n system were not justified. No claim is made that all deprecated code is unused.

## 9. Implemented changes and commits

| Commit | Reviewable change |
| --- | --- |
| `e811d14` | Local Host/Origin boundary and embedded public-path redaction. |
| `f442bcc` | STEP detector execution under FreeCADCmd while preserving inert module import. |
| `c2bd29f` | Measured STEP geometry handoff and truthful import labels. |
| `3cd6ca4` | Complete JSON parsing and canonical actionable review summary. |
| `927d5ba` | Visible save entry point, truthful preview copy, hidden-alert fix, direct PDF action. |
| `bcf79de` | Drawer focus restored within the viewport; valid runtime import fixture corrected. |
| `007e260` | Complete wrapped/paginated review PDF in both existing renderers. |
| `8c2d4ab` | FCStd/fallback body counts and inspected metadata retained. |
| `95a81d0` | Saved model jobs reuse actual create round-trip quality, manifests, and independent quality status. |
| `2544802` | Quality artifact detail shows actual blocking issues and reimport status in EN/KO. |

Create defaults remain warning-friendly: the wrong-hole fixture completes generation while reporting quality failure for generated/reimported 8 mm versus expected 6 mm. Manufacturing readiness remains Unknown/held; geometry checks cannot satisfy physical evidence. Existing saved runs without quality artifacts are not retroactively assigned a pass.

## 10. Deferred work and reasons

| ID | Priority | Remaining work / reason to keep separate |
| --- | --- | --- |
| UX-09 | P2 | Dedicated saved-model 3D reopen. It needs an authorized tracked-artifact conversion/viewer lifecycle; broadening inline preview permissions is not a substitute. |
| PERF-01 | P2 | Remove repeated synchronous health probing with safe freshness semantics and measured concurrency behavior. |
| UX-06 | P3 | Verified part/revision names and semantic result types; filename text currently misclassifies some TOML/STL as Quality results. Preserve filenames and provenance while improving labels. |
| UX-07 | P3 | Curate beginner examples and finish legacy Korean copy. Keep failure/probe fixtures available to tests and experts. |
| ENG-01 | P3 | Incremental decomposition and behavioral coverage. New regressions mitigate changed boundaries; a broad rewrite is deferred. |
| UX-10 | P3 / hypothesis | Isolate refresh/selection/completion navigation ownership before changing behavior. |

## 11. Verification results

| Executed check | Exact result / coverage |
| --- | --- |
| Baseline `npm test` | PASS: 143 named check programs across contract/integration/snapshot lanes. |
| Final `npm test` | PASS: 148 named check programs (121 contract, 25 integration, 2 snapshot). `npm-test-final.log`. |
| Final `npm run test:studio-browser-smoke` | PASS. `browser-smoke-final.log`; real CDP browser, both locales, responsive/focus/reduced-motion checks. |
| `npm run test:py` | 179 passed, 2 skipped, 27 subtests passed, 57.48 s. |
| `npm run test:runtime:full` | 289 passed, 0 failed; two paid OpenAI tests explicitly skipped. |
| `npm run test:runtime-smoke` | PASS: CLI runtime, real STEP import handoff, local API runtime, repeat export. |
| `node scripts/run-pytest.js -q tests/test_cli_runtime.py tests/test_infotainment_draw_qa_regression.py tests/test_infotainment_hole_dia_regression.py` | 4 passed, 8.88 s. |
| `npm run test:v1:acceptance` | PASS, including synthetic non-production evidence boundaries. |
| `npm run check:source-hygiene` | PASS; generated files stay in allowed ignored output/fixture locations. |
| Late targeted checks | Real tracked-create pass/fail and authorized JSON, artifact surface, jobs-center status, import metadata, artifact viewers, large JSON, quality dashboard, both locales: PASS. |
| PDF validation | Fallback pagination test passes; Matplotlib test skipped in selected pytest interpreter, then separately executed successfully with FreeCAD's bundled Python/Matplotlib. Nine-page stress text preserves its final evidence marker; both pages of the actual repaired report visually inspected. |

The broad runtime/Python suites ran during remediation. Late FCStd mapping, tracked-create wiring and the quality viewer received their respective targeted real-runtime/UI checks; final Node/browser runs cover the final source. They are not presented as a second full runtime execution at the final commit. Intermediate red tests and failed browser assertions were retained and repaired; no tests were deleted, safety assertions weakened, or snapshot baselines blindly updated.

## 12. Remaining NOT MEASURED areas

Human UAT/comprehension/accessibility studies; screen-reader use; actual 200% zoom; OS-level reduced-motion interaction; true OS-cache-cold performance; browser LCP and GPU cost; reproducible full-journey post-fix timing; a successful real queued cancellation; destructive/crash recovery; long soak or many-job load; native CAD parser exploit resistance; a real DNS-rebinding browser exploit; cross-platform Windows/Linux runtime behavior; Unicode/CJK PDF font behavior; paid AI flows; physical inspection and manufacturing readiness.

The in-app PDF plugin failure is an observed limitation, not an unmeasured success. CDP reduced-motion emulation did run. Attempted viewport captures that did not resize are excluded from evidence.

## 13. Review and Git state

Read-only source review covered the baseline-to-final code, including the final viewer delta committed as `25448020ce0240fee657c5fd6a6e18381caf74a1`. No blocking introduced defect was found. Before/after `git diff --name-only`, base-relative changed paths and porcelain status matched byte-for-byte (`cmp` exit 0). The notes and paired captures are in `tmp/codex/product-audit/read-only-review.md` and `final-review-before-*` / `final-review-after-*`. This is a recommendation for human review of the scoped repairs, not merge approval.

No push, PR creation or master merge. Code changes are isolated in `codex/product-user-audit`; ignored evidence remains in the managed worktree. The original checkout and its untracked files are preserved. No external collaborator was messaged. Audit servers on ports 3317–3321 were stopped after checking their jobs were terminal. The final Studio remains available at `http://127.0.0.1:3323/` with its local persisted audit jobs; unrelated processes were left alone.

## 14. Remaining product risks

Metadata-only imports are useful but do not establish valid geometry. CAD heuristics and quality checks remain guidance, not certified engineering truth. Saved model navigation still requires an external CAD reader for full STEP inspection. Some result labels and untranslated legacy instructions can confuse new users. A passed generated-model check does not establish physical inspection, tolerance compliance in a manufactured part, or production readiness.

## 15. Recommended next smallest work

First improve saved-result identification: use already verified source part/revision metadata, and classify files from manifest type/extension before filename substring. Add a two-part history/reopen regression in both locales. This is smaller than introducing a saved-model viewer and directly addresses the remaining returning-operator confusion. Then implement the authorized 3D reopen flow, and measure async/coalesced runtime health probing with unavailable-runtime transitions.
