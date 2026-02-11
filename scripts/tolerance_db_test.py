"""
Pure unit test for _tolerance_db.py (no FreeCAD dependency).
Called from test-runner.js via runScript.
"""

import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _tolerance_db import get_tolerance, get_fit, fuzzy_match_diameter

try:
    # Read input (ignored, but needed for protocol)
    raw = sys.stdin.read()

    tests = {}

    # Test 1: Ø20 H7
    h_upper, h_lower = get_tolerance(20, "H7")
    tests["h7_20"] = {"upper": h_upper, "lower": h_lower}

    # Test 2: Ø20 g6
    s_upper, s_lower = get_tolerance(20, "g6")
    tests["g6_20"] = {"upper": s_upper, "lower": s_lower}

    # Test 3: H7/g6 fit at Ø20
    fit = get_fit(20, "H7", "g6")
    tests["fit_h7g6_20"] = fit

    # Test 4: H7/p6 fit at Ø20 (interference)
    fit2 = get_fit(20, "H7", "p6")
    tests["fit_h7p6_20"] = fit2

    # Test 5: Fuzzy match
    tests["fuzzy_20"] = fuzzy_match_diameter(19.998)

    print(json.dumps({"success": True, "tests": tests}), flush=True)
    sys.exit(0)

except Exception as e:
    import traceback
    print(json.dumps({"success": False, "error": str(e), "details": traceback.format_exc()}), flush=True)
    sys.exit(1)
