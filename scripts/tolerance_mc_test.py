"""
Monte Carlo tolerance stack-up test.
Pure Python + numpy — no FreeCAD dependency.
"""
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _tolerance import stack_up_monte_carlo

# Simulate 3 pairs (all H7/g6 at different diameters)
# These mimic analyze_pair() output structure
pair_results = [
    {
        "nominal_d": 20, "spec": "H7/g6",
        "hole_tolerance": 0.021, "shaft_tolerance": 0.013,
        "clearance_min": 0.007, "clearance_max": 0.041,
        "fit_type": "clearance",
    },
    {
        "nominal_d": 30, "spec": "H7/g6",
        "hole_tolerance": 0.021, "shaft_tolerance": 0.013,
        "clearance_min": 0.007, "clearance_max": 0.041,
        "fit_type": "clearance",
    },
    {
        "nominal_d": 40, "spec": "H7/g6",
        "hole_tolerance": 0.025, "shaft_tolerance": 0.016,
        "clearance_min": 0.009, "clearance_max": 0.050,
        "fit_type": "clearance",
    },
]

errors = []

for dist in ['normal', 'uniform', 'triangular']:
    mc = stack_up_monte_carlo(pair_results, num_samples=10000, distribution=dist)

    # Basic structure checks
    if mc["chain_length"] != 3:
        errors.append(f"{dist}: chain_length={mc['chain_length']}, expected 3")
    if mc["num_samples"] != 10000:
        errors.append(f"{dist}: num_samples={mc['num_samples']}, expected 10000")
    if mc["distribution"] != dist:
        errors.append(f"{dist}: distribution={mc['distribution']}, expected {dist}")

    # Mean gap should be positive for clearance fits
    if mc["mean_mm"] <= 0:
        errors.append(f"{dist}: mean_mm={mc['mean_mm']}, expected > 0")

    # Fail rate should be low for clearance fits
    if mc["fail_rate_pct"] > 5:
        errors.append(f"{dist}: fail_rate={mc['fail_rate_pct']}%, expected < 5%")

    # Cpk should be reasonable
    if mc["cpk"] < 0.5:
        errors.append(f"{dist}: cpk={mc['cpk']}, expected >= 0.5")

    # Histogram: 20 bins, 21 edges
    if len(mc["histogram"]["counts"]) != 20:
        errors.append(f"{dist}: hist bins={len(mc['histogram']['counts'])}, expected 20")
    if len(mc["histogram"]["edges"]) != 21:
        errors.append(f"{dist}: hist edges={len(mc['histogram']['edges'])}, expected 21")

    # Percentiles should be in order
    p = mc["percentiles"]
    if not (p["p0_1"] <= p["p1"] <= p["p50"] <= p["p99"] <= p["p99_9"]):
        errors.append(f"{dist}: percentiles not in order: {p}")

    # Sum of histogram counts should equal num_samples
    total = sum(mc["histogram"]["counts"])
    if total != 10000:
        errors.append(f"{dist}: hist total={total}, expected 10000")

if errors:
    print(json.dumps({"success": False, "errors": errors}))
    sys.exit(1)
else:
    # Return last MC result for inspection
    print(json.dumps({"success": True, "mc_result": mc}))
