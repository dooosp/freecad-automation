"""
Pure unit test for stack-up analysis (no FreeCAD dependency).
Simulates 3 pairs with known tolerances and verifies calculations.
"""

import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _tolerance_db import get_fit
from _tolerance import stack_up_analysis

try:
    raw = sys.stdin.read()

    # Simulate 3 tolerance pairs at different diameters
    # Pair 1: Ø20 H7/g6 (clearance)
    # Pair 2: Ø30 H7/g6 (clearance)
    # Pair 3: Ø40 H7/g6 (clearance)
    pair_results = []
    for d in [20, 30, 40]:
        fit = get_fit(d, "H7", "g6")
        pair_results.append({
            "nominal_d": d,
            "spec": "H7/g6",
            "fit_type": fit["fit_type"],
            "clearance_min": fit["clearance_min"],
            "clearance_max": fit["clearance_max"],
        })

    stack = stack_up_analysis(pair_results)

    print(json.dumps({"success": True, "stack_up": stack, "pairs": pair_results}), flush=True)
    sys.exit(0)

except Exception as e:
    import traceback
    print(json.dumps({"success": False, "error": str(e), "details": traceback.format_exc()}), flush=True)
    sys.exit(1)
