"""
Tolerance analysis pipeline for assemblies.
Pipeline: load config → build parts → extract cylinders → detect pairs → analyze fits → stack-up
"""

import sys
import os
import csv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _bootstrap import (
    log,
    read_input,
    respond,
    respond_error,
    init_freecad,
    safe_filename_component,
)

try:
    config = read_input()
    model_name = config.get("name", "unnamed")
    output_stem = safe_filename_component(model_name, default="unnamed")
    log(f"Tolerance Analysis: {model_name}")

    # Guard: need assembly with parts
    if "parts" not in config or "assembly" not in config:
        respond_error("Tolerance analysis requires an assembly config with [assembly] and [[parts]] sections.")

    FreeCAD = init_freecad()
    import Part
    from _assembly import _build_single_part
    from _tolerance import (
        extract_cylinders_from_shape, detect_tolerance_pairs,
        analyze_pair, stack_up_analysis, stack_up_monte_carlo,
    )

    # Phase 1: Build each part shape (before placement)
    part_shapes = {}
    for part_def in config.get("parts", []):
        pid = part_def["id"]
        shape = _build_single_part(part_def)
        part_shapes[pid] = shape
        log(f"  Built part '{pid}'")

    # Phase 2: Extract cylinder features for each part
    part_cylinders = {}
    for pid, shape in part_shapes.items():
        cyls = extract_cylinders_from_shape(shape)
        part_cylinders[pid] = cyls
        if cyls:
            diameters = sorted(set(c["diameter"] for c in cyls))
            log(f"  {pid}: {len(cyls)} cylinder(s), diameters={diameters}")

    # Phase 3: Detect tolerance pairs from mates
    assembly_config = config.get("assembly", {})
    pairs = detect_tolerance_pairs(assembly_config, part_shapes)

    if not pairs:
        log("  No tolerance pairs found (no coaxial mates or manual pairs)")
        respond({
            "success": True,
            "pairs": [],
            "stack_up": {"chain_length": 0},
            "cylinders": {pid: cyls for pid, cyls in part_cylinders.items()},
        })

    # Phase 4: Analyze each pair
    tolerance_config = config.get("tolerance", {})
    recommend = tolerance_config.get("recommend", False)
    pair_specs = tolerance_config.get("specs", {})
    default_purpose = tolerance_config.get("purpose", None)

    pair_results = []
    for pair in pairs:
        key = f"{pair['bore_part']}/{pair['shaft_part']}"
        spec = pair_specs.get(key, None)
        purpose = default_purpose

        result = analyze_pair(pair, spec=spec, purpose=purpose)
        pair_results.append(result)
        log(f"  Pair {key} Ø{result['nominal_d']}: {result['spec']} → {result['fit_type']} ({result['clearance_min']:+.3f}~{result['clearance_max']:+.3f} mm)")

    # Phase 5: Stack-up analysis
    stack = stack_up_analysis(pair_results)
    log(f"  Stack-up: worst={stack.get('worst_case_mm', 0):.4f}, RSS={stack.get('rss_3sigma_mm', 0):.4f}, success={stack.get('success_rate_pct', 0):.1f}%")

    # Phase 5b: Monte Carlo simulation (optional)
    mc_result = None
    if tolerance_config.get("monte_carlo", False):
        mc_samples = tolerance_config.get("mc_samples", 10000)
        mc_dist = tolerance_config.get("mc_distribution", "normal")
        mc_result = stack_up_monte_carlo(pair_results, num_samples=mc_samples, distribution=mc_dist)
        log(f"  Monte Carlo ({mc_dist}, N={mc_samples}): Cpk={mc_result['cpk']}, fail={mc_result['fail_rate_pct']}%, mean={mc_result['mean_mm']:.4f}")

    # Phase 6: Export CSV (optional)
    exports = []
    export_config = config.get("export", {})
    export_dir = export_config.get("directory", ".")
    os.makedirs(export_dir, exist_ok=True)

    if tolerance_config.get("csv", False):
        csv_path = os.path.join(export_dir, f"{output_stem}_tolerance.csv")
        with open(csv_path, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow([
                "Bore Part", "Shaft Part", "Nominal D (mm)", "Spec",
                "Fit Type", "Clearance Min (mm)", "Clearance Max (mm)",
                "Hole Tolerance (mm)", "Shaft Tolerance (mm)", "Status",
            ])
            for pr in pair_results:
                writer.writerow([
                    pr["bore_part"], pr["shaft_part"], pr["nominal_d"],
                    pr["spec"], pr["fit_type"],
                    pr["clearance_min"], pr["clearance_max"],
                    pr["hole_tolerance"], pr["shaft_tolerance"],
                    pr["status"],
                ])
        file_size = os.path.getsize(csv_path)
        exports.append({"format": "csv", "path": csv_path, "size_bytes": file_size})
        log(f"  CSV exported: {csv_path}")

    response = {
        "success": True,
        "pairs": pair_results,
        "stack_up": stack,
        "cylinders": {pid: cyls for pid, cyls in part_cylinders.items()},
        "exports": exports,
    }
    if mc_result:
        response["monte_carlo"] = mc_result
    respond(response)

except Exception as e:
    import traceback
    respond_error(str(e), traceback.format_exc())
