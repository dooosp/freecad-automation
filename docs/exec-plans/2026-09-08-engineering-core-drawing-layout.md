# Drawing layout follow-through

Continue from local engineering-core Y-axis candidate `d13f47ee7ec8782529cebda9f2355c3dea05397f` on isolated branch `codex/engineering-core-drawing-layout-v1`. The accepted refocus plan remains the architectural constraint; this follow-through addresses observed drawing defects, without changing canonical inputs or readiness evidence.

1. Record baseline tests, runtime availability, protected hashes and refs under ignored `tmp/codex/engineering-core-drawing-layout/`.
2. Add failing tests for footer notes, coherent dimension leaders, duplicate projected baseline endpoints, and nested SVG QA. Observe failures before each minimal fix.
3. Reuse the annotation planner across actual geometry, datums and dimensions. Preserve anchors, values, IDs and tolerances. Unsupported feature anchors must remain explicit review findings, never substituted with overall extents.
4. Keep notes inside their declared region where feasible; retain all content and report overflow where it cannot fit. Never move only a dimension label away from its leader.
5. Extend existing advisory layout-readability using final SVG context. Approximate layout checks do not constitute geometry validity, readiness or human UAT.
6. Run isolated three-part A/B CAD checks and injected errors with existing quality/manifests/revision reports; inspect complete rendered sheets. Preserve known failures rather than weakening thresholds.
7. Run regression checks, compare protected state, commit bounded changes locally, and review the cumulative base-to-final patch. Document actual results and unresolved findings separately from historical evidence.

No secret access, AI API calls, remote writes, release or deployment. Original dirty checkout and PR #199/#201 branches remain untouched. Test config and all output paths must be ignored before execution. No runtime-backed claim without actual FreeCAD execution.
