#!/usr/bin/env python3
"""DFM (Design for Manufacturability) Checker.

Reads enriched config JSON from stdin, analyzes features
against manufacturing constraints, outputs DFM report JSON.

Checks:
  DFM-01  Minimum wall thickness
  DFM-02  Hole-to-edge minimum distance
  DFM-03  Hole-to-hole minimum spacing
  DFM-04  Missing fillet/chamfer on internal corners
  DFM-05  Drill depth-to-diameter ratio
  DFM-06  Undercut detection

Usage:
    cat enriched_config.json | python3 scripts/dfm_checker.py
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))


# ---------------------------------------------------------------------------
# Manufacturing constraint tables by process type
# ---------------------------------------------------------------------------

PROCESS_CONSTRAINTS = {
    "machining": {
        "min_wall": 1.5,
        "hole_edge_factor": 1.0,      # edge dist >= 1x diameter
        "hole_spacing_factor": 1.0,    # hole gap >= 1x smaller dia
        "max_drill_ratio": 5.0,
    },
    "casting": {
        "min_wall": 3.0,
        "hole_edge_factor": 2.0,
        "hole_spacing_factor": 1.5,
        "max_drill_ratio": 3.0,
    },
    "sheet_metal": {
        "min_wall": 0.5,
        "hole_edge_factor": 1.0,
        "hole_spacing_factor": 1.0,
        "max_drill_ratio": 10.0,
    },
    "3d_printing": {
        "min_wall": 0.8,
        "hole_edge_factor": 0.5,
        "hole_spacing_factor": 0.5,
        "max_drill_ratio": 20.0,
    },
}


# ---------------------------------------------------------------------------
# DFMCheck result class
# ---------------------------------------------------------------------------

class DFMCheck:
    """Single DFM check result."""

    def __init__(self, code, severity, message, feature=None, recommendation=None):
        self.code = code
        self.severity = severity  # "error" | "warning" | "info"
        self.message = message
        self.feature = feature
        self.recommendation = recommendation

    def to_dict(self):
        return {k: v for k, v in self.__dict__.items() if v is not None}


# ---------------------------------------------------------------------------
# Feature extraction utilities
# ---------------------------------------------------------------------------

def _get_cut_tool_ids(config):
    """Return set of shape IDs used as cut tools."""
    cut_tools = set()
    for op in config.get("operations", []):
        if op.get("op") == "cut":
            cut_tools.add(op.get("tool", ""))
    return cut_tools


def _extract_holes(config):
    """Return list of cut cylinders (holes/bores) with position info."""
    cut_tools = _get_cut_tool_ids(config)
    holes = []
    for s in config.get("shapes", []):
        if s.get("type") == "cylinder" and s.get("id") in cut_tools:
            pos = s.get("position", [0, 0, 0])
            holes.append({
                "id": s.get("id", ""),
                "radius": s.get("radius", 0),
                "diameter": s.get("radius", 0) * 2,
                "height": s.get("height", 0),
                "x": pos[0] if len(pos) > 0 else 0,
                "y": pos[1] if len(pos) > 1 else 0,
                "z": pos[2] if len(pos) > 2 else 0,
            })
    return holes


def _extract_bodies(config):
    """Return list of non-cut cylinders and boxes (solid bodies)."""
    cut_tools = _get_cut_tool_ids(config)
    bodies = []
    for s in config.get("shapes", []):
        sid = s.get("id", "")
        if sid in cut_tools:
            continue
        stype = s.get("type", "")
        pos = s.get("position", [0, 0, 0])
        entry = {
            "id": sid,
            "type": stype,
            "x": pos[0] if len(pos) > 0 else 0,
            "y": pos[1] if len(pos) > 1 else 0,
            "z": pos[2] if len(pos) > 2 else 0,
        }
        if stype == "cylinder":
            entry["radius"] = s.get("radius", 0)
            entry["height"] = s.get("height", 0)
        elif stype == "box":
            entry["width"] = s.get("width", 0)
            entry["depth"] = s.get("depth", 0)
            entry["height"] = s.get("height", 0)
        bodies.append(entry)
    return bodies


def _extract_cut_boxes(config):
    """Return list of cut boxes (cavities/slots)."""
    cut_tools = _get_cut_tool_ids(config)
    boxes = []
    for s in config.get("shapes", []):
        if s.get("type") == "box" and s.get("id") in cut_tools:
            pos = s.get("position", [0, 0, 0])
            boxes.append({
                "id": s.get("id", ""),
                "width": s.get("width", 0),
                "depth": s.get("depth", 0),
                "height": s.get("height", 0),
                "x": pos[0] if len(pos) > 0 else 0,
                "y": pos[1] if len(pos) > 1 else 0,
                "z": pos[2] if len(pos) > 2 else 0,
            })
    return boxes


def _analyze_box_walls(bodies, holes, cut_boxes):
    """Analyze wall thickness for box bodies.

    Returns list of (wall_mm, feature_desc, feature_type) tuples.
    Checks:
      - Box outer wall to nearest hole edge
      - Box-to-cut-box cavity wall thickness
      - L-bracket intersection (two orthogonal boxes sharing an edge)
    """
    results = []
    box_bodies = [b for b in bodies if b["type"] == "box"]

    for body in box_bodies:
        bx, by, bz = body["x"], body["y"], body["z"]
        bw, bd, bh = body["width"], body["depth"], body["height"]

        # Box wall to nearest hole edge (XY plane projection)
        for hole in holes:
            hx, hy = hole["x"], hole["y"]
            hr = hole["radius"]
            # Distance from hole center to nearest box face (XY)
            dx = max(hx - (bx + bw), bx - hx, 0)
            dy = max(hy - (by + bd), by - hy, 0)
            if dx == 0 and dy == 0:
                # Hole is inside box bounds — check distance to each face
                walls = [
                    hx - bx - hr,           # left face
                    (bx + bw) - hx - hr,    # right face
                    hy - by - hr,           # front face
                    (by + bd) - hy - hr,    # back face
                ]
                for w in walls:
                    if w >= 0:
                        results.append((w, f"box '{body['id']}' wall near hole '{hole['id']}'", "box_wall"))

        # Box-to-cavity wall thickness (cut boxes inside this body)
        for cavity in cut_boxes:
            cx, cy, cz = cavity["x"], cavity["y"], cavity["z"]
            cw, cd, ch = cavity["width"], cavity["depth"], cavity["height"]
            # Check if cavity overlaps with body in Z
            if cz + ch <= bz or cz >= bz + bh:
                continue
            # Check wall between body face and cavity face
            walls = [
                cx - bx,                          # left wall
                (bx + bw) - (cx + cw),            # right wall
                cy - by,                          # front wall
                (by + bd) - (cy + cd),            # back wall
            ]
            for w in walls:
                if 0 < w < 1000:  # positive and reasonable
                    results.append((w, f"box '{body['id']}' cavity wall near '{cavity['id']}'", "box_wall"))

    # L-bracket intersection: two boxes sharing a face
    for i, b1 in enumerate(box_bodies):
        for j, b2 in enumerate(box_bodies):
            if i >= j:
                continue
            # Check if boxes are adjacent (share a face boundary)
            # Vertical stacking: b2 sits on top of b1
            z1_top = b1["z"] + b1["height"]
            z2_bot = b2["z"]
            if abs(z1_top - z2_bot) < 0.1:
                # Intersection wall = min thickness at junction
                min_thk = min(b1["width"], b2["width"], b1["depth"], b2["depth"])
                results.append((min_thk, f"intersection '{b1['id']}'/'{b2['id']}'", "intersection_wall"))

    return results


def _has_operation(config, op_type):
    """Check if any operation of given type exists."""
    return any(op.get("op") == op_type for op in config.get("operations", []))


def _dist_2d(x1, y1, x2, y2):
    """Euclidean distance in 2D (XY plane)."""
    return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)


def _find_counterbore_ids(config):
    """Return set of IDs that are counterbore features (larger+shallower coaxial cut).

    These should be excluded from DFM-02/03 since they're part of the
    parent bolt hole feature.
    """
    cut_tools = _get_cut_tool_ids(config)
    cut_cyls = [s for s in config.get("shapes", [])
                if s.get("type") == "cylinder" and s.get("id") in cut_tools]
    cb_ids = set()
    for i, c1 in enumerate(cut_cyls):
        p1 = c1.get("position", [0, 0, 0])
        for j, c2 in enumerate(cut_cyls):
            if i >= j:
                continue
            p2 = c2.get("position", [0, 0, 0])
            xy = _dist_2d(
                p1[0] if len(p1) > 0 else 0, p1[1] if len(p1) > 1 else 0,
                p2[0] if len(p2) > 0 else 0, p2[1] if len(p2) > 1 else 0,
            )
            if xy < 0.1:  # coaxial
                r1, r2 = c1.get("radius", 0), c2.get("radius", 0)
                h1, h2 = c1.get("height", 0), c2.get("height", 0)
                # The larger-radius, shorter-height one is the counterbore
                if r1 > r2 and h1 < h2:
                    cb_ids.add(c1.get("id", ""))
                elif r2 > r1 and h2 < h1:
                    cb_ids.add(c2.get("id", ""))
    return cb_ids


# ---------------------------------------------------------------------------
# DFM-01: Minimum wall thickness
# ---------------------------------------------------------------------------

def check_wall_thickness(config, constraints):
    """Check wall thickness between holes and body edges (cylinder + box)."""
    checks = []
    min_wall = constraints["min_wall"]
    holes = _extract_holes(config)
    bodies = _extract_bodies(config)

    # --- Cylinder wall analysis (existing) ---
    outer_cyl = None
    for b in bodies:
        if b["type"] == "cylinder":
            if outer_cyl is None or b["radius"] > outer_cyl["radius"]:
                outer_cyl = b

    if outer_cyl:
        outer_r = outer_cyl["radius"]
        for hole in holes:
            dist_from_center = _dist_2d(hole["x"], hole["y"], outer_cyl["x"], outer_cyl["y"])
            wall = outer_r - dist_from_center - hole["radius"]

            if wall < min_wall and wall >= 0:
                checks.append(DFMCheck(
                    "DFM-01", "error",
                    f"Wall thickness {wall:.1f}mm < min {min_wall}mm at hole '{hole['id']}'",
                    feature=hole["id"],
                    recommendation=f"Increase wall to >= {min_wall}mm or reduce hole diameter",
                ))
            elif wall < min_wall * 1.5 and wall >= min_wall:
                checks.append(DFMCheck(
                    "DFM-01", "warning",
                    f"Wall thickness {wall:.1f}mm is marginal (min {min_wall}mm) at hole '{hole['id']}'",
                    feature=hole["id"],
                    recommendation="Consider increasing wall thickness for safety margin",
                ))

    # --- Box wall analysis (Phase 24) ---
    cut_boxes = _extract_cut_boxes(config)
    box_walls = _analyze_box_walls(bodies, holes, cut_boxes)

    for wall_mm, desc, feat_type in box_walls:
        if wall_mm < min_wall:
            checks.append(DFMCheck(
                "DFM-01", "error",
                f"Wall thickness {wall_mm:.1f}mm < min {min_wall}mm at {desc}",
                feature=feat_type,
                recommendation=f"Increase wall to >= {min_wall}mm",
            ))
        elif wall_mm < min_wall * 1.5:
            checks.append(DFMCheck(
                "DFM-01", "warning",
                f"Wall thickness {wall_mm:.1f}mm is marginal (min {min_wall}mm) at {desc}",
                feature=feat_type,
                recommendation="Consider increasing wall thickness for safety margin",
            ))

    return checks


# ---------------------------------------------------------------------------
# DFM-02: Hole-to-edge minimum distance
# ---------------------------------------------------------------------------

def _is_central_bore(hole, body):
    """Check if hole is coaxial with body center (central bore/through-hole)."""
    return _dist_2d(hole["x"], hole["y"], body["x"], body["y"]) < 0.1


def check_hole_edge_distance(config, constraints):
    """Check that holes are far enough from body edges.

    Skips central bores and counterbore features.
    """
    checks = []
    factor = constraints["hole_edge_factor"]
    holes = _extract_holes(config)
    bodies = _extract_bodies(config)
    cb_ids = _find_counterbore_ids(config)

    outer_cyl = None
    for b in bodies:
        if b["type"] == "cylinder":
            if outer_cyl is None or b["radius"] > outer_cyl["radius"]:
                outer_cyl = b

    if not outer_cyl:
        return checks

    outer_r = outer_cyl["radius"]

    for hole in holes:
        # Skip central bores and counterbores
        if _is_central_bore(hole, outer_cyl):
            continue
        if hole["id"] in cb_ids:
            continue

        min_dist = factor * hole["diameter"]
        dist_from_center = _dist_2d(hole["x"], hole["y"], outer_cyl["x"], outer_cyl["y"])
        edge_dist = outer_r - dist_from_center - hole["radius"]

        if edge_dist < min_dist and edge_dist >= 0:
            checks.append(DFMCheck(
                "DFM-02", "error",
                f"Hole '{hole['id']}' edge distance {edge_dist:.1f}mm "
                f"< required {min_dist:.1f}mm ({factor}x dia {hole['diameter']:.1f}mm)",
                feature=hole["id"],
                recommendation=f"Move hole at least {min_dist:.1f}mm from edge",
            ))

    return checks


# ---------------------------------------------------------------------------
# DFM-03: Hole-to-hole minimum spacing
# ---------------------------------------------------------------------------

def check_hole_spacing(config, constraints):
    """Check minimum spacing between holes.

    Skips counterbore features, coaxial pairs, and central bores.
    """
    checks = []
    factor = constraints["hole_spacing_factor"]
    holes = _extract_holes(config)
    bodies = _extract_bodies(config)
    cb_ids = _find_counterbore_ids(config)

    # Find outer body for central bore detection
    outer_cyl = None
    for b in bodies:
        if b["type"] == "cylinder":
            if outer_cyl is None or b["radius"] > outer_cyl["radius"]:
                outer_cyl = b

    checked = set()
    for i, h1 in enumerate(holes):
        if h1["id"] in cb_ids:
            continue
        for j, h2 in enumerate(holes):
            if i >= j:
                continue
            if h2["id"] in cb_ids:
                continue
            pair_key = (h1["id"], h2["id"])
            if pair_key in checked:
                continue
            checked.add(pair_key)

            # Skip coaxial pairs (counterbore + through-hole)
            if _dist_2d(h1["x"], h1["y"], h2["x"], h2["y"]) < 0.1:
                continue

            # Skip pairs involving central bore
            if outer_cyl and (_is_central_bore(h1, outer_cyl) or _is_central_bore(h2, outer_cyl)):
                continue

            center_dist = _dist_2d(h1["x"], h1["y"], h2["x"], h2["y"])
            edge_gap = center_dist - h1["radius"] - h2["radius"]
            # Use the smaller hole's diameter as reference for peripheral holes
            ref_dia = min(h1["diameter"], h2["diameter"])
            min_spacing = factor * ref_dia

            if edge_gap < min_spacing and edge_gap >= 0:
                checks.append(DFMCheck(
                    "DFM-03", "warning",
                    f"Hole spacing {edge_gap:.1f}mm between '{h1['id']}' and '{h2['id']}' "
                    f"< recommended {min_spacing:.1f}mm ({factor}x dia {ref_dia:.1f}mm)",
                    feature=f"{h1['id']},{h2['id']}",
                    recommendation=f"Increase spacing to >= {min_spacing:.1f}mm",
                ))

    return checks


# ---------------------------------------------------------------------------
# DFM-04: Missing fillet/chamfer on internal corners
# ---------------------------------------------------------------------------

def check_fillet_chamfer(config, constraints):
    """Warn if cut operations exist without fillet/chamfer."""
    checks = []
    has_cuts = any(op.get("op") == "cut" for op in config.get("operations", []))
    has_fillet = _has_operation(config, "fillet")
    has_chamfer = _has_operation(config, "chamfer")

    if has_cuts and not has_fillet and not has_chamfer:
        checks.append(DFMCheck(
            "DFM-04", "warning",
            "No fillet or chamfer operations found — internal corners may cause stress concentration",
            recommendation="Add fillet (R >= 0.5mm) or chamfer to internal corners",
        ))
    elif has_cuts and not has_fillet:
        checks.append(DFMCheck(
            "DFM-04", "info",
            "Chamfer present but no fillet — consider fillets for stress-critical corners",
            recommendation="Fillets distribute stress better than chamfers at internal corners",
        ))

    return checks


# ---------------------------------------------------------------------------
# DFM-05: Drill depth-to-diameter ratio
# ---------------------------------------------------------------------------

def check_drill_ratio(config, constraints):
    """Check drill depth/diameter ratio for holes."""
    checks = []
    max_ratio = constraints["max_drill_ratio"]
    holes = _extract_holes(config)

    for hole in holes:
        if hole["diameter"] <= 0:
            continue
        ratio = hole["height"] / hole["diameter"]
        if ratio > max_ratio:
            checks.append(DFMCheck(
                "DFM-05", "warning",
                f"Drill ratio {ratio:.1f}:1 for '{hole['id']}' exceeds "
                f"max {max_ratio:.0f}:1 (depth={hole['height']:.1f}mm, dia={hole['diameter']:.1f}mm)",
                feature=hole["id"],
                recommendation=f"Reduce depth or increase diameter to achieve <= {max_ratio:.0f}:1 ratio",
            ))

    return checks


# ---------------------------------------------------------------------------
# DFM-06: Undercut detection
# ---------------------------------------------------------------------------

def check_undercut(config, constraints):
    """Detect potential undercuts (internal step-downs + T-slot patterns)."""
    checks = []
    cut_tools = _get_cut_tool_ids(config)

    # --- Coaxial cylinder undercuts ---
    cut_cyls = [s for s in config.get("shapes", [])
                if s.get("type") == "cylinder" and s.get("id") in cut_tools]

    # Build coaxial groups to detect multi-step bores
    coaxial_groups = {}  # key: (x, y) rounded → list of cylinders
    for c in cut_cyls:
        pos = c.get("position", [0, 0, 0])
        cx = round(pos[0] if len(pos) > 0 else 0, 1)
        cy = round(pos[1] if len(pos) > 1 else 0, 1)
        key = (cx, cy)
        coaxial_groups.setdefault(key, []).append(c)

    for key, group in coaxial_groups.items():
        if len(group) < 2:
            continue
        # Sort by radius descending
        group.sort(key=lambda c: c.get("radius", 0), reverse=True)
        radii = [c.get("radius", 0) for c in group]
        unique_radii = list(dict.fromkeys(radii))  # dedupe preserving order

        # Count distinct step-downs (radius decreases)
        step_count = len(unique_radii) - 1 if len(unique_radii) > 1 else 0

        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                c1, c2 = group[i], group[j]
                r1, r2 = c1.get("radius", 0), c2.get("radius", 0)
                if r1 == r2:
                    continue
                larger = c1 if r1 > r2 else c2
                smaller = c1 if r1 < r2 else c2
                is_counterbore = larger.get("height", 0) < smaller.get("height", 0)

                if is_counterbore:
                    severity = "info"
                    msg_prefix = "Counterbore"
                    tool_approach = "axial"
                elif step_count >= 3:
                    severity = "error"
                    msg_prefix = "Multi-step bore undercut"
                    tool_approach = "axial"
                else:
                    severity = "warning"
                    msg_prefix = "Potential undercut"
                    tool_approach = "axial"

                checks.append(DFMCheck(
                    "DFM-06", severity,
                    f"{msg_prefix}: coaxial holes '{larger.get('id')}' "
                    f"(R={larger.get('radius')}mm) and '{smaller.get('id')}' "
                    f"(R={smaller.get('radius')}mm) form internal step"
                    f" (tool_approach={tool_approach})",
                    feature=f"{larger.get('id')},{smaller.get('id')}",
                    recommendation="Verify tool access for internal step — "
                                   "consider through-hole or relief groove"
                                   if not is_counterbore else
                                   "Counterbore depth and clearance are adequate",
                ))

    # --- T-slot detection (cut boxes forming T-profile) ---
    cut_boxes = _extract_cut_boxes(config)
    checks.extend(_detect_t_slot(cut_boxes))

    return checks


def _detect_t_slot(cut_boxes):
    """Detect T-slot patterns: two intersecting cut boxes where one is narrower."""
    checks = []
    for i, b1 in enumerate(cut_boxes):
        for j, b2 in enumerate(cut_boxes):
            if i >= j:
                continue
            # Check XY overlap (boxes intersect)
            x_overlap = (b1["x"] < b2["x"] + b2["width"] and
                         b2["x"] < b1["x"] + b1["width"])
            y_overlap = (b1["y"] < b2["y"] + b2["depth"] and
                         b2["y"] < b1["y"] + b1["depth"])
            z_adjacent = abs((b1["z"] + b1["height"]) - b2["z"]) < 0.5 or \
                         abs((b2["z"] + b2["height"]) - b1["z"]) < 0.5

            if x_overlap and y_overlap and z_adjacent:
                # T-slot: one box significantly narrower than the other
                w1 = min(b1["width"], b1["depth"])
                w2 = min(b2["width"], b2["depth"])
                wider = max(w1, w2)
                narrower = min(w1, w2)
                if wider > 0 and narrower / wider < 0.6:
                    checks.append(DFMCheck(
                        "DFM-06", "warning",
                        f"T-slot pattern: '{b1['id']}' and '{b2['id']}' form "
                        f"undercut profile (width ratio {narrower/wider:.2f})"
                        f" (tool_approach=radial)",
                        feature="t_slot",
                        recommendation="T-slot requires special tooling — "
                                       "verify tool access or use open-side design",
                    ))
    return checks


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run_dfm_check(config):
    """Run all DFM checks and return report dict."""
    mfg = config.get("manufacturing", {})
    process = mfg.get("process", "machining")
    constraints = PROCESS_CONSTRAINTS.get(process, PROCESS_CONSTRAINTS["machining"])

    # Apply user overrides
    min_wall_override = mfg.get("min_wall_override", 0)
    if min_wall_override and min_wall_override > 0:
        constraints = dict(constraints)
        constraints["min_wall"] = min_wall_override

    all_checks = []
    all_checks.extend(check_wall_thickness(config, constraints))
    all_checks.extend(check_hole_edge_distance(config, constraints))
    all_checks.extend(check_hole_spacing(config, constraints))
    all_checks.extend(check_fillet_chamfer(config, constraints))
    all_checks.extend(check_drill_ratio(config, constraints))
    all_checks.extend(check_undercut(config, constraints))

    errors = sum(1 for c in all_checks if c.severity == "error")
    warnings = sum(1 for c in all_checks if c.severity == "warning")
    infos = sum(1 for c in all_checks if c.severity == "info")
    score = max(0, 100 - errors * 15 - warnings * 5)

    return {
        "success": True,
        "process": process,
        "material": mfg.get("material", "unknown"),
        "checks": [c.to_dict() for c in all_checks],
        "summary": {
            "errors": errors,
            "warnings": warnings,
            "info": infos,
            "total": len(all_checks),
        },
        "score": score,
    }


if __name__ == "__main__":
    config = json.load(sys.stdin)
    result = run_dfm_check(config)
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    sys.exit(0 if result["summary"]["errors"] == 0 else 1)
