# 90-second demo script — English

- Audience: recruiters, non-developers, first-time viewers
- Human UAT: `NOT_RUN`
- Screenshot/P0 state: see the [capture list](screenshots/README.md)
- Rule: describe only states actually visible in the candidate.

## 00:00–00:15 — Problem

**Screen:** Manufacturing Robotics Data card before a run.

**Say:**

“When CAD and robotics data live separately, it is hard to see how a design
feature becomes an inspection action and a quality check. This demonstration
turns one approved synthetic hinge-block profile into ten reviewable actions and
a role-based handoff.”

## 00:15–00:30 — Bounded execution

**Action:** Select `Generate dataset`.

**Say:**

“The browser cannot submit files or paths; it requests one server-owned profile.
Generation is local and offline, invokes no FreeCAD runtime or robot hardware,
uses no external or paid API, and writes only inside the tracked job.”

## 00:30–00:50 — Connected meaning

**Screen:** Success summary and ten-action timeline. Select action 6,
`probe_left_hinge_pin`.

**Say:**

“These are not isolated labels. The left hinge-pin inspection links to CAD
features, a quality characteristic, real six-axis joint identifiers, bilingual
instructions, and pre- and postconditions. `VALID SYNTHETIC DEMO` means those
references and lineage pass this synthetic contract.”

## 00:50–01:05 — Handoff and standards gap

**Screen:** Handoff and LeRobot gap panels.

**Say:**

“Design, Manufacturing, Quality, and Trust each get a distinct handoff. The
output is still a semantic annotation layer. It lacks per-frame state and
action vectors, FPS, Parquet layout, statistics, and pinned-loader validation,
so LeRobot compatibility and training readiness remain false. Missing images
or MP4 are a vision-modality gap for this inspection use case, not a universal
v3 format rule.”

## 01:05–01:22 — Trust through failure

**Action:** Enable the approved revision-mismatch option and generate again.

**Say:**

“If the approved Revision A is paired with a Revision B review, the job blocks
with `REVISION_LINEAGE_IDENTITY_MISMATCH` and publishes zero of eight files. It
does not silently accept B; it directs us to regenerate the review from the
authoritative Revision A source.”

## 01:22–01:30 — Close

**Say:**

“This proves traceable synthetic generation and fail-closed publication. It
does not prove real shop-floor data, physical inspection, CV, production
approval, or human acceptance. Human bilingual review and five-person UAT are
the next steps and are currently not run.”
