# Local-first v1 acceptance

Run the deterministic artifact-driven lane with:

```bash
npm run test:v1:acceptance
```

The lane writes only ignored output under `output/v1-acceptance/`. It removes and recreates that directory on each run, executes the three product workflows with fixed time and checksum-bound inputs, and writes `local_first_v1_acceptance_report.json`. It does not require FreeCAD.

## Flow A — Review

The lane loads a checked-in test review pack, builds a readiness report at a fixed timestamp, writes JSON and Markdown, and asserts the stable artifact contract. The fixture remains held at `needs_more_evidence`; the lane does not mutate a canonical package.

## Flow B — Revision and inspection planning

The lane runs `compare-rev` for fixed baseline/candidate fixtures, writes revision-impact JSON/Markdown and the comparison manifest, then runs `inspection-plan --scope delta`. It asserts:

- revision change IDs survive into plan reinspection items;
- the plan requires human release and is not evidence;
- result fields in the blank native template remain blank;
- no readiness operation runs in this flow;
- fixed-time comparison, impact, plan, and manifest artifacts are deterministic.

## Flow C — Result handoff

The lane creates a full fixture plan, checksum-bound human release authorization, immutable execution release record, completed native CSV, and submission metadata. `inspection-result-normalize` must produce `ready_for_quarantine_review` with exact plan/release hashes and separate reported/computed results.

The source CSV is explicitly non-production. A separate fixture declaration marks every input synthetic and non-production and binds each one by SHA-256. This preserves the production adapter’s fail-closed rejection of synthetic markers in trusted submission metadata while making the test boundary auditable.

The flow asserts that no evidence envelope, evidence authorization, evidence attachment, readiness regeneration, tag, release, or publication occurs.

## Canonical immutability and report

Before and after all flows, the lane records:

- five readiness JSON hashes;
- five readiness Markdown hashes;
- inspection-evidence, authorization, and attachment-receipt counts;
- standard-document tree hash;
- release tree hash;
- complete `docs/examples` tree hash and Git diff.

The final report includes the git SHA, workflow results, artifact paths and SHA-256 values, runtime-backed versus artifact-driven status, fixed-time determinism, synthetic fixture declaration, and evidence/readiness/release boundaries. The test runs the complete lane twice and requires byte-identical reports and artifact hash inventories.

Optional live FreeCAD runtime smoke remains a separate supported-machine check. It is not inspection evidence or production proof.
