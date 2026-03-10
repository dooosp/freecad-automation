# Korea vs Mexico Stabilization Comparison

Runtime-informed cross-site launch planning support example for the infotainment display bracket case.

This is not a claim of plant truth. It is a portfolio-facing example of how the workflow can compare domestic and overseas ramp-up signals and support production-engineering action planning.

## Scenarios Compared

- Korea-Ulsan pilot-line example:
  - runtime file: `data/runtime_examples/display_bracket_runtime.json`
  - profile: `configs/profiles/site_korea_ulsan.toml`
- Mexico-MTY ramp-up example:
  - runtime file: `data/runtime_examples/display_bracket_runtime_mexico.json`
  - profile: `configs/profiles/site_mexico_mty.toml`

## Headline Difference

| Site | Avg FPY | Avg Downtime % | Stations Above Target CT | Highest Gap Station | Highest Gap Sec |
| --- | --- | --- | --- | --- | --- |
| Korea-Ulsan | 0.975 | 5.70 | ST20, ST30, ST40, ST60, ST70 | ST60 | 8.2 |
| Mexico-MTY | 0.961 | 8.47 | ST20, ST30, ST40, ST50, ST60, ST70 | ST60 | 11.7 |

## Station-Level Difference

| Station | Korea Gap Sec | Mexico Gap Sec | Delta Sec | Interpretation |
| --- | --- | --- | --- | --- |
| ST20 | 0.6 | 3.3 | 2.7 | Laser / blanking flow shows more restart and setup loss in Mexico. |
| ST30 | 3.6 | 6.8 | 3.2 | Forming / bending standard work is less stable in the Mexico ramp-up example. |
| ST40 | 1.8 | 4.5 | 2.7 | Feature preparation / handling loss is higher in Mexico. |
| ST60 | 8.2 | 11.7 | 3.5 | Dimensional inspection is the main shared bottleneck, worse in Mexico. |
| ST70 | 4.1 | 8.2 | 4.1 | Packaging / traceability handoff burden is materially higher in Mexico. |

## What Changed

- Mexico example uses slightly worse FPY and higher rework / scrap / downtime assumptions.
- Mexico example shows one additional station above target CT.
- The largest cross-site delta appears at:
  - ST60 dimensional inspection
  - ST70 packaging / traceability handoff
  - ST30 forming / bending

## Higher Overseas Launch Risks

- The Mexico example carries higher inspection overload risk.
- The Mexico example carries higher packaging / traceability handoff instability.
- Changeover and restart sensitivity are more visible in the Mexico example, especially at ST30 and ST60.

## Production Engineering Actions

- Keep tightened layered audits at ST30, ST60, and ST70 until the mirrored launch loss stabilizes.
- Push proven Korea standard work, fixture checks, and containment rules into the Mexico startup package before relaxing staffing assumptions.
- Treat this comparison as runtime-informed early production-engineering decision support, then validate it against actual issue logs and site ownership.
