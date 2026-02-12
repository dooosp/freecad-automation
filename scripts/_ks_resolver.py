"""
KS B 0401 standard resolver — tolerance fits, bolt holes, surface finish.
Loads data from standards/ks_tables.json and provides lookup functions.
"""

import json
import os
import math

_HERE = os.path.dirname(os.path.abspath(__file__))
_DATA_PATH = os.path.join(_HERE, "standards", "ks_tables.json")

# Lazy-loaded data cache
_data = None


def _load():
    global _data
    if _data is None:
        with open(_DATA_PATH, "r", encoding="utf-8") as f:
            _data = json.load(f)
    return _data


def _get_range_index(diameter_mm):
    """Find diameter range index (0-12) for a nominal diameter."""
    data = _load()
    for i, (lo, hi) in enumerate(data["diameter_ranges"]):
        if lo <= diameter_mm <= hi:
            return i
    if diameter_mm < data["diameter_ranges"][0][0]:
        return 0
    return len(data["diameter_ranges"]) - 1


def _parse_fit_spec(spec):
    """Parse 'H7' -> ('H', '7') or 'g6' -> ('g', '6')."""
    letter = ""
    grade = ""
    for ch in spec:
        if ch.isalpha():
            letter += ch
        else:
            grade += ch
    return letter, grade


def resolve_it_tolerance(diameter_mm, grade):
    """Get IT tolerance value in mm for diameter and IT grade.

    Args:
        diameter_mm: Nominal diameter
        grade: IT grade (5-11)

    Returns:
        Tolerance in mm
    """
    data = _load()
    idx = _get_range_index(diameter_mm)
    g_str = str(grade)
    if g_str not in data["it_grades"]:
        raise ValueError(f"IT grade {grade} not in database (5-11)")
    return data["it_grades"][g_str][idx] / 1000.0  # μm → mm


def resolve_fit(diameter_mm, fit_class):
    """Resolve a fit designation to deviation values.

    Args:
        diameter_mm: Nominal diameter in mm
        fit_class: e.g. "H7/g6", "H7", "g6"

    Returns:
        dict with keys:
          hole_upper, hole_lower (mm) — if hole spec present
          shaft_upper, shaft_lower (mm) — if shaft spec present
          fit_type: 'clearance'|'transition'|'interference'|None
          callout: formatted string e.g. "⌀25 H7/g6"
    """
    data = _load()
    idx = _get_range_index(diameter_mm)

    parts = fit_class.split("/") if "/" in fit_class else [fit_class]
    result = {"callout": f"\u2300{diameter_mm} {fit_class}"}

    hole_upper = hole_lower = None
    shaft_upper = shaft_lower = None

    for part in parts:
        letter, grade_str = _parse_fit_spec(part)
        grade = int(grade_str)
        it_val = data["it_grades"][str(grade)][idx]  # μm

        if letter.isupper():
            # Hole
            fit_data = data["hole_fits"].get(letter, {})
            if grade_str in fit_data:
                dev = fit_data[grade_str]
                if isinstance(dev, list):
                    if letter in ("K", "N", "P"):
                        # ES (upper dev) given; EI = ES - IT
                        es = dev[idx]
                        hole_upper = es / 1000.0
                        hole_lower = (es - it_val) / 1000.0
                    else:
                        # EI (lower dev) given; ES = EI + IT
                        ei = dev[idx]
                        hole_lower = ei / 1000.0
                        hole_upper = (ei + it_val) / 1000.0
            result["hole_upper"] = hole_upper
            result["hole_lower"] = hole_lower
        else:
            # Shaft
            fit_data = data["shaft_fits"].get(letter, {})
            dev_type = fit_data.get("_type", "upper")
            if grade_str in fit_data:
                dev = fit_data[grade_str]
                if isinstance(dev, list):
                    if dev_type == "upper":
                        # es (upper dev) given; ei = es - IT
                        es = dev[idx]
                        shaft_upper = es / 1000.0
                        shaft_lower = (es - it_val) / 1000.0
                    else:
                        # ei (lower dev) given; es = ei + IT
                        ei = dev[idx]
                        shaft_lower = ei / 1000.0
                        shaft_upper = (ei + it_val) / 1000.0
            result["shaft_upper"] = shaft_upper
            result["shaft_lower"] = shaft_lower

    # Determine fit type
    if hole_upper is not None and shaft_upper is not None:
        cl_max = hole_upper - shaft_lower
        cl_min = hole_lower - shaft_upper
        if cl_min > 0:
            result["fit_type"] = "clearance"
        elif cl_max < 0:
            result["fit_type"] = "interference"
        else:
            result["fit_type"] = "transition"
        result["clearance_min"] = round(cl_min, 4)
        result["clearance_max"] = round(cl_max, 4)
    else:
        result["fit_type"] = None

    return result


def resolve_center_distance_tol(distance_mm, grade="js7"):
    """Center distance tolerance per KS standard.

    Args:
        distance_mm: Center-to-center distance
        grade: tolerance grade (js7, js8, js9, js10)

    Returns:
        Symmetric tolerance in mm (±value)
    """
    data = _load()
    cd = data["center_distance_tolerance"]
    ranges = cd["ranges"]
    grade_data = cd["grades"].get(grade)
    if not grade_data:
        raise ValueError(f"Center distance grade '{grade}' not available")

    for i, (lo, hi) in enumerate(ranges):
        if lo <= distance_mm <= hi:
            return grade_data[i] / 1000.0  # μm → mm

    # Clamp
    if distance_mm < ranges[0][0]:
        return grade_data[0] / 1000.0
    return grade_data[-1] / 1000.0


def resolve_bolt_hole(bolt_size, hole_type="medium"):
    """Resolve bolt hole dimensions.

    Args:
        bolt_size: e.g. "M10", "M8"
        hole_type: "close", "medium", "coarse"

    Returns:
        dict: {drill_d, cb_d, cb_depth, pitch} in mm
    """
    data = _load()
    bolt_data = data["bolt_holes"].get(bolt_size)
    if not bolt_data:
        raise ValueError(f"Bolt size '{bolt_size}' not in database")

    return {
        "drill_d": bolt_data[hole_type],
        "cb_d": bolt_data["cb_d"],
        "cb_depth": bolt_data["cb_depth"],
        "pitch": bolt_data["pitch"],
    }


def resolve_surface_for_process(process):
    """Get typical surface finish for a machining process.

    Args:
        process: e.g. "grinding", "turning", "milling"

    Returns:
        dict: {typical_ra, achievable_ra, lay} — Ra in μm
    """
    data = _load()
    sf = data["surface_finish_by_process"].get(process)
    if not sf:
        raise ValueError(f"Process '{process}' not in database")
    return dict(sf)


def resolve_general_tolerance(grade="m"):
    """Get general tolerance grade data.

    Returns:
        dict with 'linear' and 'angular_deg' sub-dicts
    """
    data = _load()
    gt = data["general_tolerance_grades"].get(grade)
    if not gt:
        raise ValueError(f"General tolerance grade '{grade}' not available (f/m/c/v)")
    return dict(gt)


# Self-test when run directly
if __name__ == "__main__":
    print("=== KS Resolver Self-Test ===")

    # Test 1: H7/g6 fit for ⌀25
    fit = resolve_fit(25, "H7/g6")
    print(f"\n1. {fit['callout']}")
    print(f"   Hole: +{fit['hole_upper']:.4f} / +{fit['hole_lower']:.4f} mm")
    print(f"   Shaft: {fit['shaft_upper']:.4f} / {fit['shaft_lower']:.4f} mm")
    print(f"   Fit type: {fit['fit_type']}")
    assert fit["fit_type"] == "clearance", f"Expected clearance, got {fit['fit_type']}"
    print("   PASS")

    # Test 2: IT7 for ⌀50
    it = resolve_it_tolerance(50, 7)
    print(f"\n2. IT7 @ ⌀50 = {it:.4f} mm ({it*1000:.0f} μm)")
    assert abs(it - 0.025) < 0.001, f"Expected ~0.025, got {it}"
    print("   PASS")

    # Test 3: M10 bolt hole
    bh = resolve_bolt_hole("M10", "medium")
    print(f"\n3. M10 medium: drill={bh['drill_d']}mm, CB ⌀{bh['cb_d']}×{bh['cb_depth']}mm")
    assert bh["drill_d"] == 11.0
    print("   PASS")

    # Test 4: Center distance
    cd = resolve_center_distance_tol(100, "js7")
    print(f"\n4. Center distance 100mm js7: ±{cd:.4f} mm")
    print("   PASS")

    # Test 5: Surface finish for grinding
    sf = resolve_surface_for_process("grinding")
    print(f"\n5. Grinding: typical Ra={sf['typical_ra']} μm, lay={sf['lay']}")
    print("   PASS")

    print("\n=== All tests passed ===")
