# DFM and readiness guide

Use this guide to read the current non-inspection CAD project closeout without improving readiness by implication. The project can close the software/documentation package path while production readiness remains held for real inspection evidence.

For the final non-inspection software milestone summary, see [final non-inspection software closeout](./final-non-inspection-software-closeout.md).

## What DFM signals mean

DFM signals are review and manufacturability signals. They can identify risk, review topics, and next engineering questions such as thin-wall risk, tool access, drill ratio, edge treatment, complexity, or fixturing sensitivity.

DFM signals and DFM reports are not inspection evidence. A DFM warning does not mean physical inspection passed or failed, and a DFM report, when present, does not prove measured conformance. Missing DFM reports may be documented as coverage gaps, but they do not authorize fabricated evidence.

## What readiness reports mean

Readiness reports are the source of truth for status, score, gate decision, and missing inputs. For the checked-in canonical packages, read `docs/examples/<slug>/readiness/readiness_report.json` before interpreting downstream standard docs or release bundles.

`needs_more_evidence` is not a package failure. It means the current package has useful review evidence but is still missing required evidence for the readiness gate.

`hold_for_evidence_completion` means production readiness remains held until the missing inputs are supplied through the canonical flow.

## What release bundles do and do not prove

Release bundles are curated package artifacts. They collect the checked-in package boundary for review and transport.

Release bundle presence does not mean production-ready. A release bundle does not replace `inspection_evidence`, does not clear the readiness hold, and does not prove measured physical conformance.

## Why packages still need inspection evidence

Quality and drawing evidence is review evidence. Generated review, readiness, standard-doc, and release artifacts are also review/package artifacts. They are not physical inspection evidence.

Only genuine completed inspection evidence JSON that validates against the inspection evidence contract and is attached through the canonical flow can satisfy `inspection_evidence`.

Do not fabricate measured values. Do not infer measured values from CAD nominal dimensions. CAD dimensions, drawing intent, DFM findings, quality summaries, readiness reports, and release bundles can guide inspection planning, but they do not create measured inspection results.

## Current canonical package status

| Package slug | Readiness status | Score | Gate decision | Missing input | DFM/report note | Non-inspection closeout interpretation |
| --- | --- | ---: | --- | --- | --- | --- |
| `quality-pass-bracket` | `needs_more_evidence` | 61 | `hold_for_evidence_completion` | `inspection_evidence` | No checked-in package DFM report is used as review-pack side input; readiness/review signals include manufacturability review topics. | Software/package closeout can proceed; production readiness remains held for genuine inspection evidence. |
| `plate-with-holes` | `needs_more_evidence` | 61 | `hold_for_evidence_completion` | `inspection_evidence` | No checked-in package DFM report is used as review-pack side input; readiness/review signals include manufacturability review topics. | Software/package closeout can proceed; production readiness remains held for genuine inspection evidence. |
| `motor-mount` | `needs_more_evidence` | 55 | `hold_for_evidence_completion` | `inspection_evidence` | DFM remains warning-only in the package README; no checked-in package DFM report is used as review-pack side input. | Software/package closeout can proceed; production readiness remains held for genuine inspection evidence. |
| `controller-housing-eol` | `needs_more_evidence` | 52 | `hold_for_evidence_completion` | `inspection_evidence` | DFM remains warning-only in the package README; no checked-in package DFM report is used as review-pack side input. | Software/package closeout can proceed; production readiness remains held for genuine inspection evidence. |

## What is allowed during non-inspection closeout

- Clarify documentation about DFM, readiness, release bundles, and missing inspection evidence.
- Add docs smoke coverage that protects the readiness boundary.
- Review checked-in package artifacts without regenerating them.
- Describe DFM warnings as review topics or coverage gaps.
- Keep readiness scores, reports, generated package artifacts, and release bundles unchanged.

## What must wait for Stage 5B

Stage 5B remains parked until genuine completed inspection evidence exists.

The following must wait for that evidence:

- creating `docs/examples/<slug>/inspection/inspection_evidence.json`
- attaching inspection evidence through `review-context --inspection-evidence`
- regenerating review packs, readiness reports, standard docs, or release bundles because inspection evidence was added
- changing readiness scores or clearing `hold_for_evidence_completion`
- making production-readiness claims

## Validation and tests

Docs smoke coverage should keep the guide visible and protect the main boundaries:

- DFM signals and reports are review evidence, not inspection evidence.
- Readiness reports remain the source of truth.
- Release bundle presence does not mean production-ready.
- `needs_more_evidence`, `hold_for_evidence_completion`, and `inspection_evidence` remain visible.
- Stage 5B remains parked until genuine completed inspection evidence exists.
