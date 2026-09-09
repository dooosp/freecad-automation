# Engineering core: explicit drawing notes and visible evidence

Continue the verified dimension-anchor candidate at BASE_SHA
`14219e8b8de5e98f4529f525b9dcb85a8d846502` in an isolated worktree.
The original refocus protection contract still applies. One implementer edits;
parallel agents inspect and review read-only.

1. Record baseline tests and protected file/ref state in ignored
   `tmp/codex/engineering-core-drawing-notes/`.
2. Use failing tests to add explicit required-note text after existing plan/basic
   note selection. Preserve existing note order, skip optional/empty requirements,
   deduplicate identical content only, and preserve wrapped content through repair.
3. Use failing tests to require visible note content in final SVG QA. Reject
   ID-only, wrong-body, hidden and conflicting-ID evidence. Reuse existing SVG
   context, material/tolerance compatibility and quality policy. Current SVG must
   supersede stale note sidecars.
4. Run the existing isolated real CAD A/B harness and final drawing-note assertions
   for bracket, plate and hinge. Actual note presence is not proof that a described
   process, physical inspection or traceability operation occurred.
5. Inspect final drawings and report retained overflow/layout limitations. Do not
   infer slot datums, modify canonical configs, change readiness/UAT, relax quality
   criteria, add frameworks, call real AI APIs or mutate remotes.
6. Review the cumulative BASE-to-final patch, recheck protected state and document
   results. Keep verified changes in small local commits.

For each implementation: failing test, observed failure, minimum fix, regression.
Runtime config copies and all output paths must be isolated before execution.
Historical document-link failures remain explicit; no fabricated old artifacts.
