"""
ISO 286 Standard Tolerance Database.
Provides IT grade tolerances, fundamental deviations, and fit calculations.
All tolerance values in micrometers (μm), converted to mm on output.
"""

import math

# --- Diameter ranges (mm) per ISO 286 ---
DIAMETER_RANGES = [
    (1, 3), (3, 6), (6, 10), (10, 18), (18, 30),
    (30, 50), (50, 80), (80, 120), (120, 180),
    (180, 250), (250, 315), (315, 400), (400, 500),
]

# --- IT grade tolerances in μm ---
IT_GRADES = {
    6:  [6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40],
    7:  [10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63],
    8:  [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97],
    9:  [25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155],
    10: [40, 48, 58, 70, 84, 100, 120, 140, 160, 185, 210, 230, 250],
    11: [60, 75, 90, 110, 130, 160, 190, 220, 250, 290, 320, 360, 400],
}

# --- Shaft fundamental deviations ---
# Letters d-h: fundamental deviation = upper deviation (es) in μm
# Lower deviation = es - IT
SHAFT_UPPER_DEV = {
    "h": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "g": [-2, -4, -5, -6, -7, -9, -10, -12, -14, -15, -17, -18, -20],
    "f": [-6, -10, -13, -16, -20, -25, -30, -36, -43, -50, -56, -62, -68],
    "e": [-14, -20, -25, -32, -40, -50, -60, -72, -85, -100, -110, -125, -135],
    "d": [-20, -30, -40, -50, -65, -80, -100, -120, -145, -170, -190, -210, -230],
}

# Letters k-s: fundamental deviation = lower deviation (ei) in μm
# Upper deviation = ei + IT
SHAFT_LOWER_DEV = {
    "k": [0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5],
    "m": [2, 4, 6, 7, 8, 9, 11, 13, 15, 17, 20, 21, 23],
    "n": [4, 8, 10, 12, 15, 17, 20, 23, 27, 31, 34, 37, 40],
    "p": [6, 12, 15, 18, 22, 26, 32, 37, 43, 50, 56, 62, 68],
    "s": [14, 19, 23, 28, 35, 43, 53, 59, 68, 79, 88, 98, 108],
}

# --- Hole fundamental deviations ---
# Letters F-H: fundamental deviation = lower deviation (EI) in μm
# Upper deviation = EI + IT
HOLE_LOWER_DEV = {
    "H": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "G": [2, 4, 5, 6, 7, 9, 10, 12, 14, 15, 17, 18, 20],
    "F": [6, 10, 13, 16, 20, 25, 30, 36, 43, 50, 56, 62, 68],
}

# Letters K-P: fundamental deviation = upper deviation (ES) in μm
# Lower deviation = ES - IT
HOLE_UPPER_DEV = {
    "K": [0, -1, -1, -1, -2, -2, -2, -3, -3, -4, -4, -4, -5],
    "N": [-4, -8, -10, -12, -15, -17, -20, -23, -27, -31, -34, -37, -40],
    "P": [-6, -12, -15, -18, -22, -26, -32, -37, -43, -50, -56, -62, -68],
}

# --- Common fit presets ---
FIT_PRESETS = {
    "H7/g6": {"hole": "H7", "shaft": "g6", "desc": "Precision clearance (rotating shaft)"},
    "H7/h6": {"hole": "H7", "shaft": "h6", "desc": "Sliding fit (location)"},
    "H7/k6": {"hole": "H7", "shaft": "k6", "desc": "Transition fit (light press)"},
    "H7/n6": {"hole": "H7", "shaft": "n6", "desc": "Light interference"},
    "H7/p6": {"hole": "H7", "shaft": "p6", "desc": "Press fit (permanent)"},
    "H8/f7": {"hole": "H8", "shaft": "f7", "desc": "Running fit"},
    "H9/d9": {"hole": "H9", "shaft": "d9", "desc": "Loose running fit"},
    "H11/d11": {"hole": "H11", "shaft": "d11", "desc": "Free clearance"},
}

# --- Recommended fits by application ---
FIT_RECOMMENDATIONS = {
    "rotating_shaft":    "H7/g6",
    "sliding":           "H7/h6",
    "location":          "H7/k6",
    "light_press":       "H7/n6",
    "press_fit":         "H7/p6",
    "bearing_housing":   "H7/k6",
    "bearing_shaft":     "H7/g6",
    "gear_on_shaft":     "H7/p6",
    "free_clearance":    "H11/d11",
}


def _get_range_index(diameter):
    """Find the diameter range index for a given nominal diameter."""
    for i, (lo, hi) in enumerate(DIAMETER_RANGES):
        if lo <= diameter <= hi:
            return i
    # Clamp to nearest range
    if diameter < DIAMETER_RANGES[0][0]:
        return 0
    return len(DIAMETER_RANGES) - 1


def fuzzy_match_diameter(measured_d, tolerance=0.05):
    """
    Snap a measured diameter to the nearest standard value.
    E.g., 19.998 → 20.0, 24.97 → 25.0
    """
    # Common standard diameters (mm)
    standards = [
        1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10,
        12, 14, 15, 16, 18, 20, 22, 24, 25, 28, 30,
        32, 35, 36, 38, 40, 42, 45, 48, 50, 55, 56,
        60, 63, 65, 70, 71, 75, 80, 85, 90, 95, 100,
        105, 110, 115, 120, 125, 130, 140, 150, 160,
        170, 180, 190, 200, 220, 250, 280, 300, 315,
        350, 400, 450, 500,
    ]
    # Also snap to nearest integer or .5
    round_half = round(measured_d * 2) / 2

    best = measured_d
    best_diff = tolerance
    for s in standards:
        diff = abs(measured_d - s)
        if diff < best_diff:
            best = s
            best_diff = diff

    # If standard snap is worse than rounding, use rounding
    if abs(measured_d - round_half) < best_diff:
        best = round_half

    return best


def _parse_spec(spec_str):
    """Parse a tolerance spec like 'H7' or 'g6' into (letter, grade)."""
    letter = ""
    grade_str = ""
    for ch in spec_str:
        if ch.isalpha():
            letter += ch
        else:
            grade_str += ch
    return letter, int(grade_str)


def get_tolerance(diameter, spec_str):
    """
    Get tolerance bounds for a given diameter and spec.

    Args:
        diameter: Nominal diameter in mm
        spec_str: e.g. 'H7', 'g6', 'p6'

    Returns:
        (upper_dev_mm, lower_dev_mm) — deviations from nominal in mm
    """
    letter, grade = _parse_spec(spec_str)
    idx = _get_range_index(diameter)

    if grade not in IT_GRADES:
        raise ValueError(f"IT grade {grade} not in database (available: {list(IT_GRADES.keys())})")

    it_val = IT_GRADES[grade][idx]  # μm

    is_hole = letter.isupper()

    if is_hole:
        if letter == "JS":
            upper = it_val / 2
            lower = -it_val / 2
        elif letter in HOLE_LOWER_DEV:
            ei = HOLE_LOWER_DEV[letter][idx]
            lower = ei
            upper = ei + it_val
        elif letter in HOLE_UPPER_DEV:
            es = HOLE_UPPER_DEV[letter][idx]
            upper = es
            lower = es - it_val
        else:
            raise ValueError(f"Hole deviation '{letter}' not in database")
    else:
        if letter == "js":
            upper = it_val / 2
            lower = -it_val / 2
        elif letter in SHAFT_UPPER_DEV:
            es = SHAFT_UPPER_DEV[letter][idx]
            upper = es
            lower = es - it_val
        elif letter in SHAFT_LOWER_DEV:
            ei = SHAFT_LOWER_DEV[letter][idx]
            lower = ei
            upper = ei + it_val
        else:
            raise ValueError(f"Shaft deviation '{letter}' not in database")

    return (upper / 1000.0, lower / 1000.0)  # μm → mm


def get_fit(diameter, hole_spec, shaft_spec):
    """
    Calculate fit characteristics for a hole-shaft pair.

    Returns dict:
        fit_type: 'clearance' | 'transition' | 'interference'
        clearance_min: minimum gap (mm), negative = interference
        clearance_max: maximum gap (mm)
        hole_upper/lower: hole deviations (mm)
        shaft_upper/lower: shaft deviations (mm)
    """
    h_upper, h_lower = get_tolerance(diameter, hole_spec)
    s_upper, s_lower = get_tolerance(diameter, shaft_spec)

    # Clearance = hole_size - shaft_size
    clearance_max = h_upper - s_lower  # biggest hole - smallest shaft
    clearance_min = h_lower - s_upper  # smallest hole - biggest shaft

    if clearance_min > 0:
        fit_type = "clearance"
    elif clearance_max < 0:
        fit_type = "interference"
    else:
        fit_type = "transition"

    return {
        "fit_type": fit_type,
        "clearance_min": round(clearance_min, 4),
        "clearance_max": round(clearance_max, 4),
        "hole_upper": round(h_upper, 4),
        "hole_lower": round(h_lower, 4),
        "shaft_upper": round(s_upper, 4),
        "shaft_lower": round(s_lower, 4),
    }


def recommend_fit(purpose="rotating_shaft"):
    """Recommend a standard fit based on application purpose."""
    fit_name = FIT_RECOMMENDATIONS.get(purpose)
    if not fit_name:
        return None
    preset = FIT_PRESETS.get(fit_name, {})
    return {"name": fit_name, **preset}
