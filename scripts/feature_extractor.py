#!/usr/bin/env python3
"""Feature Extractor: enrich dim_intents with value_mm from config/feature_graph.

Given a TOML config (shapes, operations) and a FeatureGraph,
extract actual dimension values and inject them into dim_intents.

Usage (standalone):
    python3 scripts/feature_extractor.py enriched_config.json

Imported by intent_compiler.py during plan compilation.
"""

import math
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))


def _find_shape(config, shape_id):
    """Find shape dict by id."""
    for s in config.get("shapes", []):
        if s.get("id") == shape_id:
            return s
    return None


def _non_cut_cylinders(config):
    """Return cylinders that are NOT cut (i.e., base/fused bodies)."""
    cut_tools = set()
    for op in config.get("operations", []):
        if op.get("op") == "cut":
            cut_tools.add(op.get("tool", ""))
    return [s for s in config.get("shapes", [])
            if s.get("type") == "cylinder" and s.get("id") not in cut_tools]


def _cut_cylinders(config):
    """Return cylinders that ARE cut (holes, bores)."""
    cut_tools = set()
    for op in config.get("operations", []):
        if op.get("op") == "cut":
            cut_tools.add(op.get("tool", ""))
    return [s for s in config.get("shapes", [])
            if s.get("type") == "cylinder" and s.get("id") in cut_tools]


def _base_boxes(config):
    """Return box shapes that are NOT cut."""
    cut_tools = set()
    for op in config.get("operations", []):
        if op.get("op") == "cut":
            cut_tools.add(op.get("tool", ""))
    return [s for s in config.get("shapes", [])
            if s.get("type") == "box" and s.get("id") not in cut_tools]


# ---- Extraction rules per feature ID pattern ----

def _extract_outer_diameter(config, fg):
    """Largest non-cut cylinder radius * 2."""
    cyls = _non_cut_cylinders(config)
    if not cyls:
        return None, "none", "no_non_cut_cylinder"
    largest = max(cyls, key=lambda s: s.get("radius", 0))
    val = largest["radius"] * 2
    return val, "high", f"shapes.{largest['id']}.radius*2"


def _extract_inner_diameter(config, fg):
    """Central bore diameter from feature graph or config."""
    bores = fg.by_type("bore") if fg else []
    if bores:
        return bores[0].diameter, "high", f"fg.bore.{bores[0].id}.diameter"
    # Fallback: look for shape named "bore"
    bore_shape = _find_shape(config, "bore")
    if bore_shape and bore_shape.get("type") == "cylinder":
        val = bore_shape["radius"] * 2
        return val, "high", "shapes.bore.radius*2"
    return None, "none", "not_found"


def _extract_bolt_circle_diameter(config, fg):
    """PCD from bolt_circle group in feature graph."""
    if fg:
        for grp in fg.groups:
            if grp.pattern == "bolt_circle" and grp.pcd:
                return grp.pcd, "high", f"fg.groups.bolt_circle.pcd"
    # Fallback: compute from bolt hole positions
    bolt_shapes = [s for s in config.get("shapes", [])
                   if "bolt" in s.get("id", "").lower() and s.get("type") == "cylinder"]
    if len(bolt_shapes) >= 3:
        positions = [s.get("position", [0, 0, 0]) for s in bolt_shapes]
        cx = sum(p[0] for p in positions) / len(positions)
        cy = sum(p[1] for p in positions) / len(positions)
        radii = [math.hypot(p[0] - cx, p[1] - cy) for p in positions]
        avg_r = sum(radii) / len(radii)
        pcd = round(avg_r * 2, 1)
        return pcd, "medium", "computed_from_bolt_positions"
    return None, "none", "not_found"


def _extract_bolt_hole_diameter(config, fg):
    """First bolt hole diameter from feature graph."""
    if fg:
        holes = fg.by_type("hole")
        bolt_holes = [h for h in holes if "bolt" in h.id.lower()]
        if bolt_holes:
            return bolt_holes[0].diameter, "high", f"fg.hole.{bolt_holes[0].id}.diameter"
        if holes:
            return holes[0].diameter, "medium", f"fg.hole.{holes[0].id}.diameter"
    # Fallback from shapes
    bolt_shapes = [s for s in config.get("shapes", [])
                   if "bolt" in s.get("id", "").lower() and s.get("type") == "cylinder"]
    if bolt_shapes:
        val = bolt_shapes[0].get("radius", 0) * 2
        return val, "high", f"shapes.{bolt_shapes[0]['id']}.radius*2"
    return None, "none", "not_found"


def _extract_bolt_hole_count(config, fg):
    """Number of bolt holes."""
    if fg:
        for grp in fg.groups:
            if grp.pattern == "bolt_circle":
                return grp.count, "high", "fg.groups.bolt_circle.count"
    bolt_shapes = [s for s in config.get("shapes", [])
                   if "bolt" in s.get("id", "").lower() and s.get("type") == "cylinder"]
    if bolt_shapes:
        return len(bolt_shapes), "medium", "shapes.bolt_count"
    return None, "none", "not_found"


def _extract_thickness(config, fg):
    """Base body thickness (cylinder height or box height)."""
    cyls = _non_cut_cylinders(config)
    if cyls:
        base = max(cyls, key=lambda s: s.get("radius", 0))
        return base.get("height", 0), "high", f"shapes.{base['id']}.height"
    boxes = _base_boxes(config)
    if boxes:
        base = max(boxes, key=lambda s: s.get("width", 0) * s.get("length", 0))
        return base.get("height", 0), "high", f"shapes.{base['id']}.height"
    return None, "none", "not_found"


def _extract_total_length(config, fg):
    """Shaft total length: sum of fused cylinder heights along Z axis."""
    cyls = _non_cut_cylinders(config)
    if not cyls:
        return None, "none", "no_cylinders"
    sorted_cyls = sorted(cyls, key=lambda s: s.get("position", [0, 0, 0])[2])
    total = sum(s.get("height", 0) for s in sorted_cyls)
    if total > 0:
        return total, "high", "sum(cylinder.heights)"
    return None, "none", "zero_length"


def _extract_step_diameter(config, fg, step_index):
    """Nth step diameter for shaft (sorted by Z position)."""
    cyls = _non_cut_cylinders(config)
    if not cyls:
        return None, "none", "no_cylinders"
    sorted_cyls = sorted(cyls, key=lambda s: s.get("position", [0, 0, 0])[2])
    if step_index < len(sorted_cyls):
        val = sorted_cyls[step_index]["radius"] * 2
        return val, "high", f"shapes.step[{step_index}].radius*2"
    return None, "none", f"step_{step_index}_not_found"


def _extract_box_dimension(config, fg, dim_key):
    """Box width/height/length from largest base box."""
    boxes = _base_boxes(config)
    if not boxes:
        return None, "none", "no_boxes"
    base = max(boxes, key=lambda s: (s.get("width", 0) * s.get("length", 0)
                                      * s.get("height", 0)))
    val = base.get(dim_key, 0)
    if val > 0:
        return val, "high", f"shapes.{base['id']}.{dim_key}"
    return None, "none", f"box.{dim_key}_zero"


def _extract_chamfer_size(config, fg):
    """Chamfer size from operations."""
    for op in config.get("operations", []):
        if op.get("op") == "chamfer":
            return op.get("size", 0), "high", f"operations.chamfer.size"
    if fg:
        chamfers = fg.by_type("chamfer")
        if chamfers:
            return chamfers[0].size, "high", f"fg.chamfer.{chamfers[0].id}.size"
    return None, "none", "not_found"


def _extract_keyway_width(config, fg):
    """Keyway width from slot feature or box shape."""
    if fg:
        slots = fg.by_type("slot")
        if slots:
            w = slots[0].extra.get("width", 0)
            if w > 0:
                return w, "high", f"fg.slot.{slots[0].id}.width"
    # Look for keyway-named shapes
    for s in config.get("shapes", []):
        if "keyway" in s.get("id", "").lower() and s.get("type") == "box":
            return s.get("width", 0), "medium", f"shapes.{s['id']}.width"
    return None, "none", "not_found"


# ---- Feature ID → extractor dispatch table ----

FEATURE_RULES = {
    # Flange
    "OD":             lambda c, fg: _extract_outer_diameter(c, fg),
    "ID":             lambda c, fg: _extract_inner_diameter(c, fg),
    "PCD":            lambda c, fg: _extract_bolt_circle_diameter(c, fg),
    "BOLT_DIA":       lambda c, fg: _extract_bolt_hole_diameter(c, fg),
    "BOLT_COUNT":     lambda c, fg: _extract_bolt_hole_count(c, fg),
    "THK":            lambda c, fg: _extract_thickness(c, fg),
    # Shaft
    "TOTAL_LENGTH":   lambda c, fg: _extract_total_length(c, fg),
    "OD1":            lambda c, fg: _extract_step_diameter(c, fg, 0),
    "OD2":            lambda c, fg: _extract_step_diameter(c, fg, 1),
    "STEP_DIAMETERS": lambda c, fg: _extract_step_diameter(c, fg, 0),
    "KEYWAY_W":       lambda c, fg: _extract_keyway_width(c, fg),
    "CHAMFER":        lambda c, fg: _extract_chamfer_size(c, fg),
    # Bracket
    "WIDTH":          lambda c, fg: _extract_box_dimension(c, fg, "width"),
    "HEIGHT":         lambda c, fg: _extract_box_dimension(c, fg, "height"),
    "DEPTH":          lambda c, fg: _extract_box_dimension(c, fg, "length"),
    "BASE_W":         lambda c, fg: _extract_box_dimension(c, fg, "width"),
    "WEB_H":          lambda c, fg: _extract_box_dimension(c, fg, "height"),
    "HOLE_DIA":       lambda c, fg: _extract_bolt_hole_diameter(c, fg),
    # Housing
    "BORE_ID":        lambda c, fg: _extract_inner_diameter(c, fg),
    "BEARING_SEAT":   lambda c, fg: _extract_inner_diameter(c, fg),
    "WALL_THK":       lambda c, fg: _extract_thickness(c, fg),
    "BUSHING_DIA":    lambda c, fg: _extract_inner_diameter(c, fg),
}


def extract_values(config, feature_graph, dim_intents):
    """Enrich dim_intents with value_mm, confidence, source, review.

    Args:
        config: full TOML config dict (shapes, operations, drawing)
        feature_graph: FeatureGraph from _feature_inference
        dim_intents: list of dim_intent dicts from plan

    Returns:
        New list of enriched dim_intent dicts (original list unchanged).
    """
    enriched = []
    for intent in dim_intents:
        di = dict(intent)  # shallow copy
        fid = di.get("id", "")
        feature = di.get("feature", fid)

        # Already has value_mm (user override) → keep it
        if di.get("value_mm") is not None:
            di.setdefault("confidence", "high")
            di.setdefault("source", "user_override")
            di.setdefault("review", False)
            enriched.append(di)
            continue

        # Try dispatch table
        extractor = FEATURE_RULES.get(fid)
        if extractor:
            value_mm, confidence, source = extractor(config, feature_graph)
        else:
            value_mm, confidence, source = None, "none", "no_rule"

        di["value_mm"] = value_mm
        di["confidence"] = confidence
        di["source"] = source
        di["review"] = (value_mm is None and di.get("required", False))

        enriched.append(di)

    return enriched


def main():
    """CLI: enrich dim_intents in a config JSON and print result."""
    import json

    if len(sys.argv) < 2:
        print("Usage: python3 feature_extractor.py <config.json>", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1]) as f:
        config = json.load(f)

    plan = config.get("drawing_plan", {})
    dim_intents = plan.get("dim_intents", [])
    if not dim_intents:
        print("No dim_intents in drawing_plan", file=sys.stderr)
        sys.exit(0)

    from _feature_inference import infer_features_from_config
    fg = infer_features_from_config(config)

    enriched = extract_values(config, fg, dim_intents)

    # Print summary
    for di in enriched:
        status = "OK" if di.get("value_mm") is not None else "REVIEW"
        val = di.get("value_mm", "N/A")
        print(f"  [{status}] {di['id']:20s} = {val:>8}  "
              f"({di.get('confidence', '?')}, {di.get('source', '?')})")


if __name__ == "__main__":
    main()
