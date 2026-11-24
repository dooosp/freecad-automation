# Retrofit check v0.1

`fcad retrofit-check` is an experimental local CLI for geometric review of replacement parts. It reads the STEP solids in FreeCAD, measures each supplied placement, and writes one JSON report for the case. Threads, fastener selection and strength, electrical and optical performance, and physical installation need separate review.

## Run

```sh
node bin/fcad.js check-runtime --json
node bin/fcad.js retrofit-check path/to/case.json --out output/fit-report.json
```

Use a new output path for each run. The CLI prints the saved report path after publishing the complete file. A case with `blocked` or `needs_input` candidates exits successfully. Malformed JSON, unsupported units, an unreadable STEP file, and a failed FreeCAD operation exit nonzero and leave the requested new path empty. An existing report path produces a nonzero exit and preserves that report.

Create a sample with a fresh directory and run it twice from the repository root.

```sh
mkdir -p output/retrofit-check-demo
run_dir=$(mktemp -d "$PWD/output/retrofit-check-demo/run.XXXXXX")
node --input-type=module -e '
  import { runScript } from "./lib/runner.js";
  await runScript("retrofit_check_demo.py", { output_directory: process.argv[1] });
' "$run_dir/inputs"
node bin/fcad.js retrofit-check "$run_dir/inputs/case.json" --out "$run_dir/first.json"
node bin/fcad.js retrofit-check "$run_dir/inputs/case.json" --out "$run_dir/second.json"
cmp "$run_dir/first.json" "$run_dir/second.json"
```

## Case JSON

All coordinates use the order `[x, y, z]` in millimeters. The fixed STEP already uses the common mounting coordinates. Each candidate STEP uses that orientation in its own coordinates. A translation adds to the candidate shape, its mounting face and holes, and its connector box. The mounting planes are parallel to XY, with the fixed plate facing +Z and the candidate facing −Z. Each STEP supplies one solid.

| Object | Fields |
| --- | --- |
| Case | `case_id`, `units` set to `"mm"`, `mount_plate`, `obstacles`, `requirements`, and a nonempty `candidates` array |
| Mount plate | `step_file`, `mount_plane`, `holes` |
| Candidate | Unique `id`, the same fields as the mount plate, plus `translation_mm`, `hole_pairs`, `connector_box` and optional `adapter` |
| Mount plane | Local `z_mm` and outward `normal` |
| Hole hint | Unique `id`, local `center_mm` and local `axis`. Supply a hint for each intended fastener in the placement. |
| Hole pair | `base_hole` and `candidate_hole` refer to the declared hint IDs. Pair each declared hole exactly once. |
| Axis-aligned box | `min_mm` and `max_mm`, with positive extent on every axis. Connector boxes use candidate-local coordinates. Obstacle boxes use common coordinates and add a unique `id`. Use `[]` when the placement has no declared obstacles. |
| Adapter | `bounds` is a box in common coordinates. Its Z extent is the plate thickness. `translation_mm` is the full candidate displacement with the plate installed. |
| Requirements | `max_hole_offset_mm`, `min_hole_diameter_mm`, `min_connector_clearance_mm`, `min_adapter_hole_web_mm`, `min_adapter_edge_web_mm`. The last two apply when the adapter is evaluated. |

STEP paths resolve relative to `case.json` or can be absolute. The report includes SHA-256 fingerprints of the case and each loaded STEP. Supply the candidate translation explicitly even for zero displacement.

## What the report measures

- FreeCAD measures the axis intersection and diameter at a resolved mounting face. Hints guide identification within 0.10 mm in XY. They do not supply the reported dimensions. The supported topology is a plain circular cylindrical through bore with a complete ring on each end and a clear axial passage. Stepped, threaded, blind or ambiguous geometry may need simpler STEP data or additional evidence.
- In a specified placement the report compares hole centers in common XY, measures the plane gap and face contact area, and computes solid intersection volumes for the candidate, fixed plate, adapter when present, and declared obstacles. Auditable tolerances appear separately from the geometric requirements.
- Connector clearance is the minimum distance from the translated connector box to the declared obstacle boxes. Positive connector intersection gets its own reason code. A confirmed empty obstacle list produces no numerical minimum. Missing geometry that prevents a clearance measurement produces a null result.
- When the only direct failure is hole offset and an adapter is supplied, the CLI uses the two measured hole patterns and diameters to drill a rectangular plate in memory. It checks the minimum web between all holes and to any plate edge, both mounting interfaces, body interference, and the installed connector clearance.
- A candidate report carries the direct assessment, the adapter assessment when performed, and reason codes. `direct_mount` and `adapter_candidate` describe the supplied placements. `blocked` means all supplied placements in scope fail a known requirement. `needs_input` gives the missing or ambiguous inputs that can change the result.

## Review the supplied placement

From the demo block above, read `first.json` in this order.

1. Match `source_case.sha256`, `mount_plate.step.sha256` and each `candidate_model.step.sha256` to the input files. Confirm the FreeCAD version, units, requirements and numerical tolerances. The CLI hashes and imports the same STEP snapshot.
2. Check each candidate's `status`, `reason_codes` and `needed_inputs`. In D, supply the candidate-local envelope at `candidates[D].connector_box` before rerunning. Obtain fixed obstacle bounds from the installation layout. Omit unknown bounds to expose missing evidence. Use an empty array only for a known obstacle-free layout.
3. Pick the mating faces and fastener bores from the STEP in its source orientation. Record the outward normals and local Z heights, give each intended bore a local center/axis hint and pair IDs explicitly. Read measured source coordinates under `candidate_model.holes`. For B the local hole at [32, 32, 0] appears at [32, 32, 4] in the direct placement and sits over the plate at Z=10 in the adapter placement. Each translation is measured from the source STEP position.
4. Inspect `direct.hole_pairs`, `mount_interfaces`, `intersections` and `clearance` together. In C the measured clearance is 2 mm against a 5 mm requirement. For B, read both adapter interfaces and the clearance after installation. The plate's hole centers are reported on its lower face at Z=4.

To export the exact evaluated solid for candidate B and inspect the installed coordinates, continue in the same shell after the demo.

```sh
node bin/fcad.js retrofit-check "$run_dir/inputs/case.json" --out "$run_dir/review.json" --export-adapter B &&
node bin/fcad.js inspect "$run_dir/review.adapter.step"
```

Only a qualified `adapter_candidate` can be selected. The STEP is saved beside the new JSON using the report stem. FreeCAD reimports the staged STEP and checks its solid, volume and placement. The CLI verifies the file digest and publishes the report last. Its `candidates[].adapter.review_step` records the filename and SHA-256 of the exported bytes. Existing output paths cause an error. Use the default JSON-only invocation when comparing reports byte-for-byte. STEP writers can include export-time header metadata.

Use `fcad help --all` to find this experimental command. The stable review sequence starts with `check-runtime`, then `create` or `inspect`, followed by `draw` for a configured part. A downstream drawing of the adapter needs an explicit drawing configuration and dimension references. The STEP can be opened directly for geometric review.
