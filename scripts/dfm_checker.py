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

RULE_METADATA = {
    "DFM-01": {
        "rule_name": "Minimum wall thickness",
        "severity_map": {"error": "critical", "warning": "major", "info": "info"},
        "impact": "Thin walls can distort, chatter, or break during manufacturing and reduce part robustness.",
        "default_feature_type": "feature",
        "confidence": "high",
    },
    "DFM-02": {
        "rule_name": "Hole-to-edge distance",
        "severity_map": {"error": "critical", "warning": "major", "info": "info"},
        "impact": "Holes too close to an edge can tear out, break through, or force special fixturing.",
        "default_feature_type": "hole",
        "confidence": "high",
    },
    "DFM-03": {
        "rule_name": "Hole spacing",
        "severity_map": {"error": "critical", "warning": "major", "info": "info"},
        "impact": "Tight hole spacing can weaken the ligament between holes and complicate drilling stability.",
        "default_feature_type": "hole_pair",
        "confidence": "high",
    },
    "DFM-04": {
        "rule_name": "Internal corner relief",
        "severity_map": {"error": "major", "warning": "minor", "info": "info"},
        "impact": "Sharp internal corners increase tool load and stress concentration and can shorten tool life.",
        "default_feature_type": "internal_corner",
        "confidence": "medium",
    },
    "DFM-05": {
        "rule_name": "Drill depth ratio",
        "severity_map": {"error": "critical", "warning": "major", "info": "info"},
        "impact": "Excessive drill depth ratios raise drill wander, chip evacuation, and breakage risk.",
        "default_feature_type": "hole",
        "confidence": "high",
    },
    "DFM-06": {
        "rule_name": "Undercut risk",
        "severity_map": {"error": "critical", "warning": "major", "info": "info"},
        "impact": "Undercut-like internal steps may require special tooling or a different process plan.",
        "default_feature_type": "undercut",
        "confidence": "medium",
    },
    "DFM-07": {
        "rule_name": "Minimum tool diameter",
        "severity_map": {"error": "critical", "warning": "major", "info": "info"},
        "impact": "Features smaller than available tooling may be impossible without a different shop capability.",
        "default_feature_type": "hole",
        "confidence": "high",
    },
    "DFM-08": {
        "rule_name": "Maximum drill depth",
        "severity_map": {"error": "critical", "warning": "major", "info": "info"},
        "impact": "Excess drill depth can exceed machine reach and create chip evacuation failures.",
        "default_feature_type": "hole",
        "confidence": "high",
    },
    "DFM-09": {
        "rule_name": "Minimum internal corner radius",
        "severity_map": {"error": "major", "warning": "minor", "info": "info"},
        "impact": "Corner radii below shop capability may require smaller tooling, slower feeds, or manual rework.",
        "default_feature_type": "internal_corner",
        "confidence": "high",
    },
    "DFM-10": {
        "rule_name": "Supported process profile",
        "severity_map": {"error": "major", "warning": "major", "info": "info"},
        "impact": "Unsupported process inputs force the checker to fall back to generic defaults, reducing accuracy.",
        "default_feature_type": None,
        "confidence": "low",
    },
    "DFM-11": {
        "rule_name": "Known material context",
        "severity_map": {"error": "major", "warning": "minor", "info": "info"},
        "impact": "Unknown material context can make wall, corner, and tooling guidance incomplete or conservative.",
        "default_feature_type": None,
        "confidence": "low",
    },
}

LEGACY_SCORE_IMPACT = {
    "error": 15,
    "warning": 5,
    "info": 0,
}


def _profile_process_constraints(config, process):
    """Return DFM constraints from a resolved rule profile, if present."""
    profile = config.get("rule_profile") or {}
    process_pack = profile.get("processes") or {}
    dfm_constraints = process_pack.get("dfm_constraints") or {}
    process_constraints = dfm_constraints.get(process)
    if isinstance(process_constraints, dict):
        return process_constraints
    return None


# ---------------------------------------------------------------------------
# DFMCheck result class
# ---------------------------------------------------------------------------

class DFMCheck:
    """Single DFM check result."""

    def __init__(
        self,
        code,
        severity,
        message,
        feature=None,
        recommendation=None,
        feature_type=None,
        actual_value=None,
        actual_unit=None,
        required_value=None,
        required_unit=None,
        delta=None,
        manufacturability_impact=None,
        confidence=None,
        evidence=None,
        part_id=None,
        part_name=None,
    ):
        self.code = code
        self.severity = severity  # "error" | "warning" | "info"
        self.message = message
        self.feature = feature
        self.recommendation = recommendation
        self.feature_type = feature_type
        self.actual_value = actual_value
        self.actual_unit = actual_unit
        self.required_value = required_value
        self.required_unit = required_unit
        self.delta = delta
        self.manufacturability_impact = manufacturability_impact
        self.confidence = confidence
        self.evidence = evidence
        self.part_id = part_id
        self.part_name = part_name

    def to_dict(self):
        return {k: v for k, v in self.__dict__.items() if v is not None}


def _round_metric(value):
    if isinstance(value, (int, float)):
        return round(float(value), 3)
    return value


def _score_penalty(severity):
    return LEGACY_SCORE_IMPACT.get(severity, 0)


def _severity_to_status(severity):
    if severity == "error":
        return "fail"
    if severity in ("warning", "info"):
        return "warning"
    return "skipped"


def _actionable_severity(check):
    meta = RULE_METADATA.get(check.code, {})
    severity_map = meta.get("severity_map", {})
    return severity_map.get(check.severity, "info")


def _material_name(config):
    manufacturing = config.get("manufacturing") or {}
    material = manufacturing.get("material") or config.get("material")
    if material is None or material == "":
        return "unknown"
    return material


def _part_identity(config):
    part = config.get("part") or {}
    return {
        "part_id": part.get("part_id") or part.get("id"),
        "part_name": config.get("name") or part.get("name"),
    }


def _normalized_evidence(evidence):
    if not isinstance(evidence, dict):
        return evidence
    return {key: _round_metric(value) for key, value in evidence.items()}


def _build_issue(check, config, process):
    meta = RULE_METADATA.get(check.code, {})
    part = _part_identity(config)
    feature_id = check.feature if check.feature not in ("", "unknown") else None
    return {
        "rule_id": check.code,
        "rule_name": meta.get("rule_name", check.code),
        "severity": _actionable_severity(check),
        "status": _severity_to_status(check.severity),
        "part_id": check.part_id if check.part_id is not None else part["part_id"],
        "part_name": check.part_name if check.part_name is not None else part["part_name"],
        "feature_id": feature_id,
        "feature_type": check.feature_type if check.feature_type is not None else meta.get("default_feature_type"),
        "actual_value": _round_metric(check.actual_value),
        "actual_unit": check.actual_unit,
        "required_value": _round_metric(check.required_value),
        "required_unit": check.required_unit,
        "delta": _round_metric(check.delta),
        "process": process,
        "material": _material_name(config),
        "message": check.message,
        "manufacturability_impact": check.manufacturability_impact or meta.get("impact"),
        "suggested_fix": check.recommendation,
        "confidence": check.confidence or meta.get("confidence", "medium"),
        "evidence": _normalized_evidence(check.evidence),
        "score_impact": _score_penalty(check.severity),
    }


def _build_legacy_check(check, issue):
    merged = check.to_dict()
    merged.update({
        "rule_id": issue["rule_id"],
        "rule_name": issue["rule_name"],
        "status": issue["status"],
        "actionable_severity": issue["severity"],
        "part_id": issue["part_id"],
        "part_name": issue["part_name"],
        "feature_id": issue["feature_id"],
        "feature_type": issue["feature_type"],
        "actual_value": issue["actual_value"],
        "actual_unit": issue["actual_unit"],
        "required_value": issue["required_value"],
        "required_unit": issue["required_unit"],
        "delta": issue["delta"],
        "process": issue["process"],
        "material": issue["material"],
        "manufacturability_impact": issue["manufacturability_impact"],
        "suggested_fix": issue["suggested_fix"],
        "confidence": issue["confidence"],
        "evidence": issue["evidence"],
        "score_impact": issue["score_impact"],
    })
    return {k: v for k, v in merged.items() if v is not None}


def _sort_key_for_issue(issue):
    severity_rank = {"critical": 0, "major": 1, "minor": 2, "info": 3}
    rule_id = issue.get("rule_id", "")
    try:
        rule_order = int(rule_id.split("-")[1])
    except (IndexError, ValueError):
        rule_order = 999
    return (
        severity_rank.get(issue.get("severity"), 99),
        -issue.get("score_impact", 0),
        rule_order,
        issue.get("feature_id") or "",
    )


def _summarize_top_fixes(issues):
    top_fixes = []
    seen = set()
    for issue in sorted(issues, key=_sort_key_for_issue):
        suggested_fix = issue.get("suggested_fix")
        if not suggested_fix:
            continue
        dedupe_key = (issue.get("rule_id"), issue.get("feature_id"), suggested_fix)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        top_fixes.append({
            "rule_id": issue.get("rule_id"),
            "severity": issue.get("severity"),
            "feature_id": issue.get("feature_id"),
            "suggested_fix": suggested_fix,
            "score_impact": issue.get("score_impact", 0),
        })
        if len(top_fixes) == 3:
            break
    return top_fixes


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


def _safe_pos(shape):
    """Return normalized [x, y, z] from shape position."""
    pos = shape.get("position") or [0, 0, 0]
    if not isinstance(pos, (list, tuple)):
        return [0, 0, 0]
    return [
        pos[0] if len(pos) > 0 else 0,
        pos[1] if len(pos) > 1 else 0,
        pos[2] if len(pos) > 2 else 0,
    ]


def _box_plan_dims(shape):
    """Return normalized (x_size, y_size) for box-like specs.

    Supports both the canonical FreeCAD `length/width/height` shape schema and
    the legacy DFM `width/depth/height` schema used in some tests/configs.
    """
    x_size = shape.get("length", shape.get("width", 0))
    y_size = shape.get("depth", shape.get("width", 0))
    return x_size, y_size


def _extract_holes(config):
    """Return list of cut cylinders (holes/bores) with position info."""
    cut_tools = _get_cut_tool_ids(config)
    holes = []
    for s in config.get("shapes", []):
        if s.get("type") == "cylinder" and s.get("id") in cut_tools:
            pos = _safe_pos(s)
            holes.append({
                "id": s.get("id", ""),
                "radius": s.get("radius", 0),
                "diameter": s.get("radius", 0) * 2,
                "height": s.get("height", 0),
                "x": pos[0],
                "y": pos[1],
                "z": pos[2],
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
        pos = _safe_pos(s)
        entry = {
            "id": sid,
            "type": stype,
            "x": pos[0],
            "y": pos[1],
            "z": pos[2],
        }
        if stype == "cylinder":
            entry["radius"] = s.get("radius", 0)
            entry["height"] = s.get("height", 0)
        elif stype == "box":
            width, depth = _box_plan_dims(s)
            entry["width"] = width
            entry["depth"] = depth
            entry["height"] = s.get("height", 0)
        bodies.append(entry)
    return bodies


def _extract_cut_boxes(config):
    """Return list of cut boxes (cavities/slots)."""
    cut_tools = _get_cut_tool_ids(config)
    boxes = []
    for s in config.get("shapes", []):
        if s.get("type") == "box" and s.get("id") in cut_tools:
            pos = _safe_pos(s)
            width, depth = _box_plan_dims(s)
            boxes.append({
                "id": s.get("id", ""),
                "width": width,
                "depth": depth,
                "height": s.get("height", 0),
                "x": pos[0],
                "y": pos[1],
                "z": pos[2],
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
        p1 = _safe_pos(c1)
        for j, c2 in enumerate(cut_cyls):
            if i >= j:
                continue
            p2 = _safe_pos(c2)
            xy = _dist_2d(
                p1[0], p1[1],
                p2[0], p2[1],
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
                deficit = min_wall - wall
                checks.append(DFMCheck(
                    "DFM-01", "error",
                    f"Wall thickness {wall:.1f}mm < min {min_wall}mm at hole '{hole['id']}'",
                    feature=hole["id"],
                    recommendation=(
                        f"Increase wall thickness by at least {deficit:.1f} mm by moving hole '{hole['id']}' "
                        f"inward {deficit:.1f} mm, reducing its diameter by {deficit * 2:.1f} mm, "
                        f"or switching to a process/material profile that supports the current {wall:.1f} mm wall."
                    ),
                    feature_type="hole",
                    actual_value=wall,
                    actual_unit="mm",
                    required_value=min_wall,
                    required_unit="mm",
                    delta=wall - min_wall,
                    evidence={
                        "measurement": "wall_thickness",
                        "hole_id": hole["id"],
                        "wall_mm": wall,
                        "threshold_mm": min_wall,
                    },
                ))
            elif wall < min_wall * 1.5 and wall >= min_wall:
                preferred_wall = min_wall * 1.5
                improvement = preferred_wall - wall
                checks.append(DFMCheck(
                    "DFM-01", "warning",
                    f"Wall thickness {wall:.1f}mm is marginal (min {min_wall}mm) at hole '{hole['id']}'",
                    feature=hole["id"],
                    recommendation=(
                        f"Increase wall thickness by at least {improvement:.1f} mm to reach the preferred "
                        f"{preferred_wall:.1f} mm margin, or relax the process/material profile if the current wall is intentional."
                    ),
                    feature_type="hole",
                    actual_value=wall,
                    actual_unit="mm",
                    required_value=preferred_wall,
                    required_unit="mm",
                    delta=wall - preferred_wall,
                    evidence={
                        "measurement": "wall_thickness",
                        "hole_id": hole["id"],
                        "wall_mm": wall,
                        "preferred_wall_mm": preferred_wall,
                    },
                ))

    # --- Box wall analysis (Phase 24) ---
    cut_boxes = _extract_cut_boxes(config)
    box_walls = _analyze_box_walls(bodies, holes, cut_boxes)

    for wall_mm, desc, feat_type in box_walls:
        if wall_mm < min_wall:
            deficit = min_wall - wall_mm
            checks.append(DFMCheck(
                "DFM-01", "error",
                f"Wall thickness {wall_mm:.1f}mm < min {min_wall}mm at {desc}",
                feature=feat_type,
                recommendation=(
                    f"Increase wall thickness by at least {deficit:.1f} mm at {desc}, "
                    f"or adjust the local cut geometry so the remaining wall meets {min_wall:.1f} mm."
                ),
                feature_type=feat_type,
                actual_value=wall_mm,
                actual_unit="mm",
                required_value=min_wall,
                required_unit="mm",
                delta=wall_mm - min_wall,
                evidence={
                    "measurement": "wall_thickness",
                    "wall_mm": wall_mm,
                    "threshold_mm": min_wall,
                    "location": desc,
                },
            ))
        elif wall_mm < min_wall * 1.5:
            preferred_wall = min_wall * 1.5
            improvement = preferred_wall - wall_mm
            checks.append(DFMCheck(
                "DFM-01", "warning",
                f"Wall thickness {wall_mm:.1f}mm is marginal (min {min_wall}mm) at {desc}",
                feature=feat_type,
                recommendation=(
                    f"Increase wall thickness by at least {improvement:.1f} mm at {desc} "
                    f"to reach the preferred {preferred_wall:.1f} mm safety margin."
                ),
                feature_type=feat_type,
                actual_value=wall_mm,
                actual_unit="mm",
                required_value=preferred_wall,
                required_unit="mm",
                delta=wall_mm - preferred_wall,
                evidence={
                    "measurement": "wall_thickness",
                    "wall_mm": wall_mm,
                    "preferred_wall_mm": preferred_wall,
                    "location": desc,
                },
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

    box_bodies = [b for b in bodies if b["type"] == "box"]
    outer_r = outer_cyl["radius"] if outer_cyl else None

    for hole in holes:
        # Skip central bores and counterbores
        if outer_cyl and _is_central_bore(hole, outer_cyl):
            continue
        if hole["id"] in cb_ids:
            continue

        min_dist = factor * hole["diameter"]
        if outer_cyl:
            dist_from_center = _dist_2d(hole["x"], hole["y"], outer_cyl["x"], outer_cyl["y"])
            edge_dist = outer_r - dist_from_center - hole["radius"]

            if edge_dist < min_dist and edge_dist >= 0:
                deficit = min_dist - edge_dist
                checks.append(DFMCheck(
                    "DFM-02", "error",
                    f"Hole '{hole['id']}' edge distance {edge_dist:.1f}mm "
                    f"< required {min_dist:.1f}mm ({factor}x dia {hole['diameter']:.1f}mm)",
                    feature=hole["id"],
                    recommendation=(
                        f"Move hole '{hole['id']}' inward by at least {deficit:.1f} mm to reach the required "
                        f"{min_dist:.1f} mm edge distance, or reduce the hole size and recheck the {factor:.1f}x-dia rule."
                    ),
                    feature_type="hole",
                    actual_value=edge_dist,
                    actual_unit="mm",
                    required_value=min_dist,
                    required_unit="mm",
                    delta=edge_dist - min_dist,
                    evidence={
                        "measurement": "hole_edge_distance",
                        "hole_id": hole["id"],
                        "edge_distance_mm": edge_dist,
                        "required_mm": min_dist,
                        "diameter_mm": hole["diameter"],
                    },
                ))

        for body in box_bodies:
            if not (body["x"] <= hole["x"] <= body["x"] + body["width"]):
                continue
            if not (body["y"] <= hole["y"] <= body["y"] + body["depth"]):
                continue

            edge_dist = min(
                hole["x"] - body["x"] - hole["radius"],
                (body["x"] + body["width"]) - hole["x"] - hole["radius"],
                hole["y"] - body["y"] - hole["radius"],
                (body["y"] + body["depth"]) - hole["y"] - hole["radius"],
            )
            if edge_dist < min_dist and edge_dist >= 0:
                deficit = min_dist - edge_dist
                checks.append(DFMCheck(
                    "DFM-02", "error",
                    f"Hole '{hole['id']}' edge distance {edge_dist:.1f}mm "
                    f"< required {min_dist:.1f}mm ({factor}x dia {hole['diameter']:.1f}mm) in box '{body['id']}'",
                    feature=hole["id"],
                    recommendation=(
                        f"Move hole '{hole['id']}' at least {deficit:.1f} mm away from the nearest box edge in '{body['id']}', "
                        f"or widen the local flange so the edge distance reaches {min_dist:.1f} mm."
                    ),
                    feature_type="hole",
                    actual_value=edge_dist,
                    actual_unit="mm",
                    required_value=min_dist,
                    required_unit="mm",
                    delta=edge_dist - min_dist,
                    evidence={
                        "measurement": "hole_edge_distance",
                        "hole_id": hole["id"],
                        "body_id": body["id"],
                        "edge_distance_mm": edge_dist,
                        "required_mm": min_dist,
                        "diameter_mm": hole["diameter"],
                    },
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
                deficit = min_spacing - edge_gap
                checks.append(DFMCheck(
                    "DFM-03", "warning",
                    f"Hole spacing {edge_gap:.1f}mm between '{h1['id']}' and '{h2['id']}' "
                    f"< recommended {min_spacing:.1f}mm ({factor}x dia {ref_dia:.1f}mm)",
                    feature=f"{h1['id']},{h2['id']}",
                    recommendation=(
                        f"Increase the ligament between holes '{h1['id']}' and '{h2['id']}' by at least {deficit:.1f} mm "
                        f"(for example by moving one center {deficit:.1f} mm farther away or reducing one hole diameter) "
                        f"so spacing reaches {min_spacing:.1f} mm."
                    ),
                    feature_type="hole_pair",
                    actual_value=edge_gap,
                    actual_unit="mm",
                    required_value=min_spacing,
                    required_unit="mm",
                    delta=edge_gap - min_spacing,
                    evidence={
                        "measurement": "hole_spacing",
                        "hole_ids": f"{h1['id']},{h2['id']}",
                        "edge_gap_mm": edge_gap,
                        "required_mm": min_spacing,
                    },
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
            recommendation="Add at least one fillet with R >= 0.5 mm or a chamfer on the internal corners created by the cut features.",
            feature_type="internal_corner",
            actual_value=0,
            actual_unit="count",
            required_value=1,
            required_unit="count",
            delta=-1,
            evidence={
                "measurement": "corner_relief_ops",
                "fillet_count": 0,
                "chamfer_count": 0,
            },
        ))
    elif has_cuts and not has_fillet:
        checks.append(DFMCheck(
            "DFM-04", "info",
            "Chamfer present but no fillet — consider fillets for stress-critical corners",
            recommendation="Add a fillet to the most stress-critical internal corners if fatigue or crack initiation is a concern.",
            feature_type="internal_corner",
            actual_value=0,
            actual_unit="count",
            required_value=1,
            required_unit="count",
            delta=-1,
            evidence={
                "measurement": "fillet_ops",
                "fillet_count": 0,
                "chamfer_count": 1,
            },
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
            max_depth = max_ratio * hole["diameter"]
            depth_reduction = hole["height"] - max_depth
            required_diameter = hole["height"] / max_ratio
            diameter_increase = required_diameter - hole["diameter"]
            checks.append(DFMCheck(
                "DFM-05", "warning",
                f"Drill ratio {ratio:.1f}:1 for '{hole['id']}' exceeds "
                f"max {max_ratio:.0f}:1 (depth={hole['height']:.1f}mm, dia={hole['diameter']:.1f}mm)",
                feature=hole["id"],
                recommendation=(
                    f"Reduce hole depth by at least {depth_reduction:.1f} mm, or increase the diameter by at least "
                    f"{diameter_increase:.1f} mm so hole '{hole['id']}' meets the {max_ratio:.0f}:1 drill ratio limit."
                ),
                feature_type="hole",
                actual_value=ratio,
                actual_unit="ratio",
                required_value=max_ratio,
                required_unit="ratio",
                delta=ratio - max_ratio,
                evidence={
                    "measurement": "drill_ratio",
                    "hole_id": hole["id"],
                    "ratio": ratio,
                    "depth_mm": hole["height"],
                    "diameter_mm": hole["diameter"],
                    "max_depth_mm": max_depth,
                },
            ))

    return checks


# ---------------------------------------------------------------------------
# Tool constraint checks (shop_profile support)
# ---------------------------------------------------------------------------

def check_tool_constraints(config, constraints):
    """Check holes against tool constraints from shop_profile."""
    checks = []
    holes = _extract_holes(config)

    # Min tool diameter check
    min_tool_dia = constraints.get("min_tool_diameter")
    if min_tool_dia:
        for hole in holes:
            if hole["diameter"] > 0 and hole["diameter"] < min_tool_dia:
                deficit = min_tool_dia - hole["diameter"]
                checks.append(DFMCheck(
                    "DFM-07", "error",
                    f"Hole '{hole['id']}' diameter {hole['diameter']:.1f}mm "
                    f"< minimum tool diameter {min_tool_dia:.1f}mm",
                    feature=hole["id"],
                    recommendation=(
                        f"Increase hole '{hole['id']}' diameter by at least {deficit:.1f} mm to reach "
                        f"{min_tool_dia:.1f} mm, or use a shop profile with smaller tooling."
                    ),
                    feature_type="hole",
                    actual_value=hole["diameter"],
                    actual_unit="mm",
                    required_value=min_tool_dia,
                    required_unit="mm",
                    delta=hole["diameter"] - min_tool_dia,
                    evidence={
                        "measurement": "tool_diameter",
                        "hole_id": hole["id"],
                        "diameter_mm": hole["diameter"],
                        "required_mm": min_tool_dia,
                    },
                ))

    # Max drill depth check
    max_drill_depth = constraints.get("max_drill_depth")
    if max_drill_depth:
        for hole in holes:
            if hole["height"] > max_drill_depth:
                excess = hole["height"] - max_drill_depth
                checks.append(DFMCheck(
                    "DFM-08", "error",
                    f"Hole '{hole['id']}' depth {hole['height']:.1f}mm "
                    f"exceeds maximum drill depth {max_drill_depth:.1f}mm",
                    feature=hole["id"],
                    recommendation=(
                        f"Reduce hole '{hole['id']}' depth by at least {excess:.1f} mm to stay within "
                        f"the {max_drill_depth:.1f} mm shop limit, or move the work to a deeper-capacity process."
                    ),
                    feature_type="hole",
                    actual_value=hole["height"],
                    actual_unit="mm",
                    required_value=max_drill_depth,
                    required_unit="mm",
                    delta=hole["height"] - max_drill_depth,
                    evidence={
                        "measurement": "drill_depth",
                        "hole_id": hole["id"],
                        "depth_mm": hole["height"],
                        "required_mm": max_drill_depth,
                    },
                ))

    # Min internal radius check (fillets/chamfers)
    min_internal_radius = constraints.get("min_internal_radius")
    if min_internal_radius:
        # Check fillet/chamfer operations
        for op in config.get("operations", []):
            op_type = op.get("op", op.get("type", ""))
            if op_type in ["fillet", "chamfer"]:
                size_key = "radius" if op_type == "fillet" else "size"
                radius = op.get(size_key, 0)
                if radius > 0 and radius < min_internal_radius:
                    deficit = min_internal_radius - radius
                    checks.append(DFMCheck(
                        "DFM-09", "warning",
                        f"{op_type.capitalize()} '{op.get('id', 'unknown')}' radius {radius:.1f}mm "
                        f"< minimum internal radius {min_internal_radius:.1f}mm",
                        feature=op.get("id", "unknown"),
                        recommendation=(
                            f"Increase the {op_type} size by at least {deficit:.1f} mm so the internal corner reaches "
                            f"{min_internal_radius:.1f} mm."
                        ),
                        feature_type="internal_corner",
                        actual_value=radius,
                        actual_unit="mm",
                        required_value=min_internal_radius,
                        required_unit="mm",
                        delta=radius - min_internal_radius,
                        evidence={
                            "measurement": "internal_corner_radius",
                            "operation_id": op.get("id", "unknown"),
                            "radius_mm": radius,
                            "required_mm": min_internal_radius,
                        },
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
        pos = _safe_pos(c)
        cx = round(pos[0], 1)
        cy = round(pos[1], 1)
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

                step_count_value = max(len(unique_radii) - 1, 0)
                checks.append(DFMCheck(
                    "DFM-06", severity,
                    f"{msg_prefix}: coaxial holes '{larger.get('id')}' "
                    f"(R={larger.get('radius')}mm) and '{smaller.get('id')}' "
                    f"(R={smaller.get('radius')}mm) form internal step"
                    f" (tool_approach={tool_approach})",
                    feature=f"{larger.get('id')},{smaller.get('id')}",
                    recommendation=(
                        "Verify tool access for the internal step and add a relief groove, convert it to a through-feature, "
                        "or split the operation into accessible machining stages."
                        if not is_counterbore else
                        "Counterbore looks intentional; keep enough clearance for the larger tool and verify fastener head access."
                    ),
                    feature_type="undercut",
                    actual_value=step_count_value,
                    actual_unit="count",
                    required_value=0 if not is_counterbore else 1,
                    required_unit="count",
                    delta=step_count_value if not is_counterbore else step_count_value - 1,
                    evidence={
                        "measurement": "coaxial_step_count",
                        "feature_ids": f"{larger.get('id')},{smaller.get('id')}",
                        "step_count": step_count_value,
                        "larger_radius_mm": larger.get("radius"),
                        "smaller_radius_mm": smaller.get("radius"),
                        "tool_approach": tool_approach,
                    },
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
                wider = max(max(w1, w2), 0.001)
                narrower = min(w1, w2)
                ratio = narrower / wider
                if ratio < 0.6:
                    required_width = 0.6 * wider
                    width_deficit = required_width - narrower
                    checks.append(DFMCheck(
                        "DFM-06", "warning",
                        f"T-slot pattern: '{b1['id']}' and '{b2['id']}' form "
                        f"undercut profile (width ratio {ratio:.2f})"
                        f" (tool_approach=radial)",
                        feature="t_slot",
                        recommendation=(
                            f"Increase the narrow slot width by at least {width_deficit:.1f} mm or open one side of the feature "
                            f"so the profile no longer behaves like a T-slot undercut."
                        ),
                        feature_type="t_slot",
                        actual_value=ratio,
                        actual_unit="ratio",
                        required_value=0.6,
                        required_unit="ratio",
                        delta=ratio - 0.6,
                        evidence={
                            "measurement": "t_slot_width_ratio",
                            "feature_ids": f"{b1['id']},{b2['id']}",
                            "width_ratio": ratio,
                            "required_ratio": 0.6,
                            "tool_approach": "radial",
                        },
                    ))
    return checks


def _build_context_checks(config, requested_process, resolved_process):
    checks = []
    supported_processes = sorted(PROCESS_CONSTRAINTS.keys())
    material = _material_name(config)
    process_supported = requested_process in PROCESS_CONSTRAINTS

    if not process_supported:
        checks.append(DFMCheck(
            "DFM-10",
            "info",
            f"Process '{requested_process}' is not in the built-in DFM constraint table; using '{resolved_process}' defaults.",
            recommendation=(
                f"Set manufacturing.process to one of {', '.join(supported_processes)}, or add "
                f"rule_profile.processes.dfm_constraints.{requested_process} so the checker can use process-specific limits."
            ),
            actual_value=requested_process,
            required_value="supported_process_profile",
            manufacturability_impact="Unsupported process inputs reduce the fidelity of the rule thresholds and suggested fixes.",
            confidence="low",
            evidence={
                "supported_processes": ", ".join(supported_processes),
                "fallback_process": resolved_process,
            },
        ))

    if material == "unknown" and not process_supported:
        checks.append(DFMCheck(
            "DFM-11",
            "info",
            "Material is unknown, so material-sensitive DFM guidance may be incomplete.",
            recommendation="Set manufacturing.material to the intended stock or alloy so reviewers can judge whether the current geometry is still appropriate.",
            actual_value="unknown",
            required_value="specified_material",
            manufacturability_impact="Unknown material context weakens confidence in wall, corner, and tooling guidance.",
            confidence="low",
            evidence={
                "measurement": "material_context",
                "material": "unknown",
            },
        ))

    return checks


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run_dfm_check(config):
    """Run all DFM checks and return report dict."""
    mfg = config.get("manufacturing", {})
    requested_process = mfg.get("process", "machining")
    resolved_process = requested_process if requested_process in PROCESS_CONSTRAINTS else "machining"
    constraints = PROCESS_CONSTRAINTS.get(requested_process, PROCESS_CONSTRAINTS["machining"])
    profile_constraints = _profile_process_constraints(config, requested_process)
    if profile_constraints:
        constraints = dict(constraints)
        constraints.update(profile_constraints)
    profile = config.get("shop_profile")

    # Apply shop_profile overrides
    if profile:
        constraints = dict(constraints)  # Make a copy to avoid modifying global
        proc_caps = profile.get("process_capabilities", {}).get(requested_process, {})

        # Override process-specific constraints
        if proc_caps.get("min_wall_thickness_mm"):
            constraints["min_wall"] = proc_caps["min_wall_thickness_mm"]
        if proc_caps.get("max_drill_ratio"):
            constraints["max_drill_ratio"] = proc_caps["max_drill_ratio"]
        if proc_caps.get("hole_edge_factor"):
            constraints["hole_edge_factor"] = proc_caps["hole_edge_factor"]
        if proc_caps.get("hole_spacing_factor"):
            constraints["hole_spacing_factor"] = proc_caps["hole_spacing_factor"]

        # Apply tool constraints (additional checks will be added below)
        tool_constraints = profile.get("tool_constraints", {})
        if tool_constraints.get("min_tool_diameter_mm"):
            constraints["min_tool_diameter"] = tool_constraints["min_tool_diameter_mm"]
        if tool_constraints.get("max_drill_depth_mm"):
            constraints["max_drill_depth"] = tool_constraints["max_drill_depth_mm"]
        if tool_constraints.get("min_internal_radius_mm"):
            constraints["min_internal_radius"] = tool_constraints["min_internal_radius_mm"]

    # Apply user overrides (legacy support - takes precedence over profile)
    min_wall_override = mfg.get("min_wall_override", 0)
    if min_wall_override and min_wall_override > 0:
        constraints = dict(constraints)
        constraints["min_wall"] = min_wall_override

    all_checks = []
    all_checks.extend(_build_context_checks(config, requested_process, resolved_process))
    all_checks.extend(check_wall_thickness(config, constraints))
    all_checks.extend(check_hole_edge_distance(config, constraints))
    all_checks.extend(check_hole_spacing(config, constraints))
    all_checks.extend(check_fillet_chamfer(config, constraints))
    all_checks.extend(check_drill_ratio(config, constraints))
    all_checks.extend(check_undercut(config, constraints))

    # Add tool constraint checks if shop_profile is present
    if profile:
        all_checks.extend(check_tool_constraints(config, constraints))

    issues = [_build_issue(check, config, requested_process) for check in all_checks]
    checks = [_build_legacy_check(check, issue) for check, issue in zip(all_checks, issues)]

    errors = sum(1 for c in all_checks if c.severity == "error")
    warnings = sum(1 for c in all_checks if c.severity == "warning")
    infos = sum(1 for c in all_checks if c.severity == "info")
    score = max(0, 100 - errors * 15 - warnings * 5)
    severity_counts = {"critical": 0, "major": 0, "minor": 0, "info": 0}
    for issue in issues:
        severity_counts[issue["severity"]] = severity_counts.get(issue["severity"], 0) + 1
    score_impact = {
        "error_penalty": errors * LEGACY_SCORE_IMPACT["error"],
        "warning_penalty": warnings * LEGACY_SCORE_IMPACT["warning"],
        "total_penalty": (errors * LEGACY_SCORE_IMPACT["error"]) + (warnings * LEGACY_SCORE_IMPACT["warning"]),
    }

    return {
        "success": True,
        "process": requested_process,
        "resolved_process": resolved_process,
        "material": _material_name(config),
        "rule_profile": {
            "id": (config.get("rule_profile") or {}).get("id"),
            "label": (config.get("rule_profile") or {}).get("label"),
        } if config.get("rule_profile") else None,
        "checks": checks,
        "issues": issues,
        "summary": {
            "errors": errors,
            "warnings": warnings,
            "info": infos,
            "total": len(all_checks),
            "severity_counts": severity_counts,
            "top_fixes": _summarize_top_fixes(issues),
            "score_impact": score_impact,
        },
        "score": score,
    }


if __name__ == "__main__":
    config = json.load(sys.stdin)
    result = run_dfm_check(config)
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    sys.exit(0 if result["summary"]["errors"] == 0 else 1)
