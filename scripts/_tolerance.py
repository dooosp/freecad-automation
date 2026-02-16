"""
Tolerance analysis engine for FreeCAD assemblies.
Detects cylinder features, matches shaft-bore pairs from mate constraints,
computes fit characteristics, and performs tolerance stack-up analysis.
"""

import math

from _bootstrap import log
from _tolerance_db import (
    get_tolerance, get_fit, fuzzy_match_diameter,
    FIT_PRESETS, FIT_RECOMMENDATIONS, recommend_fit,
)


# ---------------------------------------------------------------------------
# Step A: Extract cylindrical features from built shapes
# ---------------------------------------------------------------------------

def extract_cylinders_from_shape(shape):
    """
    Find all cylindrical faces in a shape and extract geometry info.

    Returns list of dicts:
        face_idx: 0-based face index
        diameter: diameter in mm (fuzzy-matched to standard)
        raw_diameter: raw measured diameter
        radius: raw radius
        length: approximate cylinder length (mm)
        axis: (x, y, z) unit vector
        center: (x, y, z) center point of the cylinder face
    """
    import Part

    cylinders = []
    for i, face in enumerate(shape.Faces):
        surf = face.Surface
        if not hasattr(surf, 'Radius'):
            continue
        # Check if it's a cylinder (has Radius and Axis attributes)
        if not hasattr(surf, 'Axis'):
            continue

        radius = surf.Radius
        diameter_raw = radius * 2.0
        diameter = fuzzy_match_diameter(diameter_raw)

        # Approximate length from bounding box along axis
        axis = surf.Axis
        bb = face.BoundBox
        # Project bounding box extent onto axis
        extents = [bb.XLength, bb.YLength, bb.ZLength]
        axis_vec = (abs(axis.x), abs(axis.y), abs(axis.z))
        length = sum(e * a for e, a in zip(extents, axis_vec))

        center = face.CenterOfMass

        cylinders.append({
            "face_idx": i,
            "diameter": diameter,
            "raw_diameter": round(diameter_raw, 4),
            "radius": round(radius, 4),
            "length": round(length, 2),
            "axis": (round(axis.x, 6), round(axis.y, 6), round(axis.z, 6)),
            "center": (round(center.x, 4), round(center.y, 4), round(center.z, 4)),
        })

    return cylinders


def _group_cylinders_by_diameter(cylinders):
    """Group cylinders by their fuzzy-matched diameter."""
    groups = {}
    for cyl in cylinders:
        d = cyl["diameter"]
        if d not in groups:
            groups[d] = []
        groups[d].append(cyl)
    return groups


# ---------------------------------------------------------------------------
# Step B: Detect tolerance pairs from assembly mates
# ---------------------------------------------------------------------------

def detect_tolerance_pairs(assembly_config, part_shapes):
    """
    Detect shaft-bore tolerance pairs from coaxial mate constraints.

    For each coaxial mate, finds the cylinder faces on both parts at the
    mated location, and identifies which is the bore (larger) and which
    is the shaft (smaller or equal).

    Args:
        assembly_config: dict with 'mates' list
        part_shapes: dict of part_id → Part.Shape (after build, before placement)

    Returns list of dicts:
        part1, part2: part IDs
        mate_type: 'coaxial'
        bore_part: which part has the bore
        shaft_part: which part has the shaft
        bore_d: bore diameter (mm)
        shaft_d: shaft diameter (mm)
        bore_cyls: cylinder info list for bore part
        shaft_cyls: cylinder info list for shaft part
    """
    mates = assembly_config.get("mates", [])
    # Also check for manual tolerance pair definitions
    manual_pairs = assembly_config.get("tolerance_pairs", [])
    pairs = []

    # Auto-detect from coaxial mates
    for mate in mates:
        if mate.get("type") != "coaxial":
            continue

        p1 = mate["part1"]
        p2 = mate["part2"]

        if p1 not in part_shapes or p2 not in part_shapes:
            log(f"[TOL] Warning: mate parts {p1}/{p2} not found in shapes")
            continue

        cyls1 = extract_cylinders_from_shape(part_shapes[p1])
        cyls2 = extract_cylinders_from_shape(part_shapes[p2])

        if not cyls1 or not cyls2:
            log(f"[TOL] Warning: no cylinders found in {p1} or {p2}")
            continue

        # Find matching diameter pairs (same nominal diameter = mating pair)
        diameters1 = {c["diameter"] for c in cyls1}
        diameters2 = {c["diameter"] for c in cyls2}
        common_diameters = diameters1 & diameters2

        if common_diameters:
            # Same diameter on both parts → they mate at this diameter
            for d in sorted(common_diameters):
                c1_at_d = [c for c in cyls1 if c["diameter"] == d]
                c2_at_d = [c for c in cyls2 if c["diameter"] == d]
                # Convention: if both have same diameter, need to determine
                # which is bore and which is shaft from context.
                # Heuristic: part with the face reference containing "min" in mate
                # is more likely the bore (internal). Default: part1=bore if its
                # face ref has "min" selector.
                face1_ref = mate.get("face1", "")
                is_p1_bore = "min" in face1_ref

                pairs.append({
                    "part1": p1,
                    "part2": p2,
                    "mate_type": "coaxial",
                    "bore_part": p1 if is_p1_bore else p2,
                    "shaft_part": p2 if is_p1_bore else p1,
                    "bore_d": d,
                    "shaft_d": d,
                    "nominal_d": d,
                })
        else:
            # Different diameters → largest cylinder of each,
            # bigger one is bore, smaller is shaft
            max_d1 = max(cyls1, key=lambda c: c["diameter"])
            max_d2 = max(cyls2, key=lambda c: c["diameter"])

            if max_d1["diameter"] >= max_d2["diameter"]:
                bore_d = max_d1["diameter"]
                shaft_d = max_d2["diameter"]
                bore_part, shaft_part = p1, p2
            else:
                bore_d = max_d2["diameter"]
                shaft_d = max_d1["diameter"]
                bore_part, shaft_part = p2, p1

            pairs.append({
                "part1": p1,
                "part2": p2,
                "mate_type": "coaxial",
                "bore_part": bore_part,
                "shaft_part": shaft_part,
                "bore_d": bore_d,
                "shaft_d": shaft_d,
                "nominal_d": bore_d,
            })

    # Add manual pairs
    for mp in manual_pairs:
        pairs.append({
            "part1": mp.get("part1", ""),
            "part2": mp.get("part2", ""),
            "mate_type": mp.get("type", "manual"),
            "bore_part": mp.get("bore_part", mp.get("part1", "")),
            "shaft_part": mp.get("shaft_part", mp.get("part2", "")),
            "bore_d": mp.get("bore_d", 0),
            "shaft_d": mp.get("shaft_d", 0),
            "nominal_d": mp.get("nominal_d", mp.get("bore_d", 0)),
        })

    log(f"[TOL] Detected {len(pairs)} tolerance pair(s)")
    return pairs


# ---------------------------------------------------------------------------
# Step C: Analyze fits
# ---------------------------------------------------------------------------

def _recommend_spec(mate_type, purpose=None):
    """Recommend hole/shaft spec based on mate type and purpose."""
    if purpose and purpose in FIT_RECOMMENDATIONS:
        fit_name = FIT_RECOMMENDATIONS[purpose]
    elif mate_type == "coaxial":
        fit_name = "H7/g6"  # default for rotating shaft-bore
    else:
        fit_name = "H7/h6"  # default sliding

    preset = FIT_PRESETS.get(fit_name, {})
    return {
        "name": fit_name,
        "hole_spec": preset.get("hole", "H7"),
        "shaft_spec": preset.get("shaft", "h6"),
        "desc": preset.get("desc", ""),
    }


def analyze_pair(pair, spec=None, purpose=None):
    """
    Analyze a single tolerance pair.

    Args:
        pair: dict from detect_tolerance_pairs
        spec: explicit spec like 'H7/g6', or None for auto-recommend
        purpose: application purpose for recommendation

    Returns dict with fit analysis results.
    """
    nominal_d = pair["nominal_d"]

    if spec:
        parts = spec.split("/")
        hole_spec = parts[0]
        shaft_spec = parts[1]
        fit_name = spec
    else:
        rec = _recommend_spec(pair["mate_type"], purpose)
        hole_spec = rec["hole_spec"]
        shaft_spec = rec["shaft_spec"]
        fit_name = rec["name"]

    fit = get_fit(nominal_d, hole_spec, shaft_spec)

    h_upper, h_lower = get_tolerance(nominal_d, hole_spec)
    s_upper, s_lower = get_tolerance(nominal_d, shaft_spec)

    return {
        "bore_part": pair["bore_part"],
        "shaft_part": pair["shaft_part"],
        "nominal_d": nominal_d,
        "spec": fit_name,
        "hole_spec": hole_spec,
        "shaft_spec": shaft_spec,
        "bore_range": f"{nominal_d}{h_lower:+.3f} / {nominal_d}{h_upper:+.3f}",
        "shaft_range": f"{nominal_d}{s_lower:+.3f} / {nominal_d}{s_upper:+.3f}",
        "fit_type": fit["fit_type"],
        "clearance_min": fit["clearance_min"],
        "clearance_max": fit["clearance_max"],
        "hole_tolerance": round(h_upper - h_lower, 4),
        "shaft_tolerance": round(s_upper - s_lower, 4),
        "status": "OK",
    }


# ---------------------------------------------------------------------------
# Step D: Tolerance stack-up analysis
# ---------------------------------------------------------------------------

def stack_up_analysis(pair_results):
    """
    1D tolerance stack-up for a chain of pairs.

    Methods:
        Worst-case: sum of all tolerances (100% guaranteed)
        RSS (Root Sum Square, 3σ): statistical, ~99.73% success rate

    Args:
        pair_results: list of analyze_pair results

    Returns dict with stack-up results.
    """
    if not pair_results:
        return {"chain_length": 0}

    tolerances = []
    for pr in pair_results:
        # Total tolerance band for each pair
        t = abs(pr["clearance_max"] - pr["clearance_min"])
        tolerances.append(t)

    n = len(tolerances)
    worst_case = sum(tolerances)
    rss = math.sqrt(sum(t ** 2 for t in tolerances))

    # Mean gap and standard deviation for success rate
    mean_gaps = []
    for pr in pair_results:
        mean_gap = (pr["clearance_max"] + pr["clearance_min"]) / 2
        mean_gaps.append(mean_gap)

    total_mean_gap = sum(mean_gaps)

    # For clearance fits: positive mean gap = OK
    # Success rate based on RSS assuming normal distribution
    if rss > 0:
        # Z-score: how many sigmas away from zero interference
        # For stack-up: we want total gap > 0
        # σ = rss / 3 (since RSS is 3σ range)
        sigma = rss / 3.0
        z_score = total_mean_gap / sigma if sigma > 0 else float('inf')
        # Approximate Φ(z) using error function
        success_rate = 0.5 * (1 + math.erf(z_score / math.sqrt(2)))
        success_pct = round(success_rate * 100, 2)
    else:
        success_pct = 100.0

    return {
        "chain_length": n,
        "tolerances_mm": [round(t, 4) for t in tolerances],
        "worst_case_mm": round(worst_case, 4),
        "rss_3sigma_mm": round(rss, 4),
        "mean_gap_mm": round(total_mean_gap, 4),
        "success_rate_pct": min(success_pct, 100.0),
    }


# ---------------------------------------------------------------------------
# Step E: Monte Carlo tolerance stack-up simulation
# ---------------------------------------------------------------------------

def stack_up_monte_carlo(pair_results, num_samples=10000, distribution='normal'):
    """
    Monte Carlo simulation for tolerance stack-up analysis.

    Samples each pair's hole and shaft dimensions independently,
    computes assembly gap distribution, and derives Cpk.

    Args:
        pair_results: list of analyze_pair results
        num_samples: number of random samples (default 10000)
        distribution: 'normal' (3σ), 'uniform', or 'triangular'

    Returns dict with MC simulation results.
    """
    import numpy as np

    if not pair_results:
        return {"chain_length": 0}

    rng = np.random.default_rng(seed=42)
    gap_samples = np.zeros(num_samples)

    for pr in pair_results:
        nominal = pr["nominal_d"]
        h_tol = pr["hole_tolerance"]
        s_tol = pr["shaft_tolerance"]

        # Hole: nominal + lower_dev to nominal + upper_dev
        # From bore_range string: "20.0+0.000 / 20.0+0.021"
        h_min = nominal + (pr["clearance_min"] + pr["clearance_max"]) / 2 - h_tol / 2
        h_max = h_min + h_tol
        # Shaft: use clearance to derive bounds
        s_mean = nominal - (pr["clearance_min"] + pr["clearance_max"]) / 2 + h_tol / 2
        s_min = s_mean - s_tol / 2
        s_max = s_mean + s_tol / 2

        # Simplify: sample hole and shaft sizes, gap = hole - shaft
        h_center = (h_min + h_max) / 2
        s_center = (s_min + s_max) / 2

        if distribution == 'uniform':
            holes = rng.uniform(h_min, h_max, num_samples)
            shafts = rng.uniform(s_min, s_max, num_samples)
        elif distribution == 'triangular':
            holes = rng.triangular(h_min, h_center, h_max, num_samples)
            shafts = rng.triangular(s_min, s_center, s_max, num_samples)
        else:  # normal (3σ within tolerance band)
            h_sigma = h_tol / 6.0  # 3σ = half band
            s_sigma = s_tol / 6.0
            holes = rng.normal(h_center, max(h_sigma, 1e-9), num_samples)
            shafts = rng.normal(s_center, max(s_sigma, 1e-9), num_samples)

        gap_samples += (holes - shafts)

    # Statistics
    mean_gap = float(np.mean(gap_samples))
    std_gap = float(np.std(gap_samples))
    fail_count = int(np.sum(gap_samples < 0))
    fail_rate = round(fail_count / num_samples * 100, 3)

    # Percentiles
    pcts = np.percentile(gap_samples, [0.1, 1, 50, 99, 99.9])

    # Cpk: process capability index
    # USL = worst-case max gap, LSL = 0 (no interference)
    usl = float(np.max(gap_samples)) * 1.1  # slightly above observed max
    lsl = 0.0
    if std_gap > 0:
        cpu = (usl - mean_gap) / (3 * std_gap)
        cpl = (mean_gap - lsl) / (3 * std_gap)
        cpk = round(min(cpu, cpl), 3)
    else:
        cpk = 99.0

    # Histogram (20 bins)
    counts, edges = np.histogram(gap_samples, bins=20)

    return {
        "chain_length": len(pair_results),
        "num_samples": num_samples,
        "distribution": distribution,
        "mean_mm": round(mean_gap, 4),
        "std_mm": round(std_gap, 4),
        "fail_rate_pct": fail_rate,
        "cpk": cpk,
        "percentiles": {
            "p0_1": round(float(pcts[0]), 4),
            "p1": round(float(pcts[1]), 4),
            "p50": round(float(pcts[2]), 4),
            "p99": round(float(pcts[3]), 4),
            "p99_9": round(float(pcts[4]), 4),
        },
        "histogram": {
            "edges": [round(float(e), 4) for e in edges],
            "counts": [int(c) for c in counts],
        },
    }
