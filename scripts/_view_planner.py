"""
View planning — selects hidden-line policy, center mark style,
and suggests section/detail views based on feature graph.
"""

import math


class ViewPlan:
    """Plan for which views to render and how."""

    def __init__(self):
        self.views = {}          # vname -> ViewConfig
        self.section_planes = [] # [{plane, offset, label, reason}]
        self.detail_regions = [] # [{center, radius, label, source_view, reason}]

    def set_view(self, vname, *, show_hidden=True, center_marks=None,
                 center_lines=None):
        self.views[vname] = {
            "show_hidden": show_hidden,
            "center_marks": center_marks or [],
            "center_lines": center_lines or [],
        }

    def add_section(self, plane, offset, label, reason=""):
        self.section_planes.append({
            "plane": plane, "offset": offset,
            "label": label, "reason": reason,
        })

    def add_detail(self, center, radius, label, source_view, reason=""):
        self.detail_regions.append({
            "center": center, "radius": radius,
            "label": label, "source_view": source_view,
            "reason": reason,
        })


def plan_views(feature_graph, drawing_cfg):
    """Generate a ViewPlan from features and drawing config.

    Args:
        feature_graph: FeatureGraph from _feature_inference
        drawing_cfg: drawing section of TOML config

    Returns: ViewPlan
    """
    plan = ViewPlan()
    views_requested = drawing_cfg.get("views", ["front", "top", "right", "iso"])
    style = drawing_cfg.get("style", {})
    default_hidden = style.get("show_hidden", True)

    # Analyze features for hidden line decisions
    has_internal = _has_internal_features(feature_graph)
    holes = feature_graph.by_type("hole")
    bores = feature_graph.by_type("bore")
    threads = feature_graph.by_type("thread")

    for vname in views_requested:
        show_hidden = select_hidden_line_policy(
            feature_graph, vname, default=default_hidden)
        marks, lines = select_center_marks(feature_graph, vname)
        plan.set_view(vname,
                      show_hidden=show_hidden,
                      center_marks=marks,
                      center_lines=lines)

    # Auto-suggest sections if not already configured
    if not drawing_cfg.get("section"):
        suggestions = suggest_sections(feature_graph)
        for s in suggestions:
            plan.add_section(**s)

    # Auto-suggest detail views for small features
    if not drawing_cfg.get("detail"):
        details = suggest_details(feature_graph)
        for d in details:
            plan.add_detail(**d)

    return plan


def select_hidden_line_policy(feature_graph, view_name, default=True):
    """Decide whether to show hidden lines for a given view.

    Policy:
    - ISO view: never show hidden (too cluttered)
    - If internal features are only visible in this view: ON
    - If a section view covers the internal features: OFF
    - Simple external parts: OFF for clarity
    """
    if view_name == "iso":
        return False

    # If no internal features, hidden lines add noise
    has_internal = _has_internal_features(feature_graph)
    if not has_internal:
        return False

    # For views that reveal unique internal features, show hidden
    # Front view typically shows Z-axis holes in section
    # Top view shows Z-axis holes as circles (no hidden needed)
    if view_name == "top":
        # Z-axis holes appear as full circles in top view — hidden lines redundant
        z_holes = [f for f in feature_graph.by_type("hole")
                   if _is_z_axis(f.axis)]
        if z_holes and not feature_graph.by_type("slot"):
            return False

    return default


def select_center_marks(feature_graph, view_name):
    """Select center mark style for circular features.

    Returns: (center_marks, center_lines)
    - center_marks: [(u, v)] for small circles (d < 30mm) — cross marks
    - center_lines: [(u, v, radius)] for large circles (d >= 30mm) — long chain lines
    """
    marks = []
    lines = []

    # Only process circles visible in this view
    holes = feature_graph.by_type("hole") + feature_graph.by_type("bore")
    cbs = feature_graph.by_type("counterbore")
    dowels = feature_graph.by_type("dowel")
    all_circular = holes + cbs + dowels

    for f in all_circular:
        pos = _project_to_view(f.position, f.axis, view_name)
        if pos is None:
            continue

        u, v = pos
        d = f.diameter or 10

        if d < 30:
            marks.append((u, v))
        else:
            lines.append((u, v, d / 2))

    # Also add center marks for bolt circle centers
    for grp in feature_graph.groups:
        if grp.pattern == "bolt_circle" and grp.center:
            pos = _project_center_to_view(grp.center, view_name)
            if pos:
                lines.append((pos[0], pos[1], (grp.pcd or 50) / 2))

    return marks, lines


def suggest_sections(feature_graph):
    """Suggest section planes for internal features.

    Rules:
    - Bore or internal cavity → XZ section through center
    - Keyway → YZ section through keyway
    - Complex internal geometry → auto section
    """
    suggestions = []
    bores = feature_graph.by_type("bore")
    label_idx = 0
    labels = "ABCDEFG"

    if bores:
        # Section through center bore
        bore = bores[0]
        suggestions.append({
            "plane": "XZ",
            "offset": bore.position[1] if bore.position else 0.0,
            "label": f"{labels[label_idx]}-{labels[label_idx]}",
            "reason": f"Central bore ⌀{bore.diameter}",
        })
        label_idx += 1

    # Check for keyways or slots
    slots = feature_graph.by_type("slot")
    for slot in slots[:1]:  # max 1 slot section
        suggestions.append({
            "plane": "YZ",
            "offset": slot.position[0] if slot.position else 0.0,
            "label": f"{labels[label_idx]}-{labels[label_idx]}",
            "reason": f"Slot at x={slot.position[0]}",
        })
        label_idx += 1

    return suggestions


def suggest_details(feature_graph):
    """Suggest detail views for small features that need magnification."""
    details = []

    # Chamfers are often hard to see at 1:1 or smaller
    chamfers = feature_graph.by_type("chamfer")
    threads = feature_graph.by_type("thread")

    if chamfers and not threads:
        # Detail around a chamfer edge
        ch = chamfers[0]
        # Find a hole with chamfer nearby
        holes = feature_graph.by_type("hole")
        if holes:
            h = holes[0]
            details.append({
                "center": [h.position[0], h.position[2]],
                "radius": max((h.diameter or 10) * 0.8, 8),
                "label": "Z",
                "source_view": "front",
                "reason": f"Chamfer C{ch.size} detail",
            })

    return details


def _has_internal_features(graph):
    """Check if the part has internal features (bores, keyways, etc.)."""
    return bool(graph.by_type("bore") or graph.by_type("slot"))


def _is_z_axis(axis):
    """Check if axis is along Z (within tolerance)."""
    if not axis:
        return True
    return abs(axis[2]) > 0.9


def _project_to_view(position, axis, view_name):
    """Project a 3D feature position to 2D view coordinates.

    For a Z-axis hole viewed from top: (x, y) → (x, y)
    For a Z-axis hole viewed from front: (x, y, z) → (x, z)
    """
    if not position:
        return None

    x, y, z = position[0], position[1], position[2] if len(position) > 2 else 0
    is_z = _is_z_axis(axis)

    if view_name == "top" and is_z:
        return (x, y)
    elif view_name == "front":
        return (x, z)
    elif view_name == "right":
        return (y, z)
    return None


def _project_center_to_view(center, view_name):
    """Project a center point to view coordinates."""
    if not center:
        return None
    x, y, z = center[0], center[1], center[2] if len(center) > 2 else 0
    if view_name == "top":
        return (x, y)
    elif view_name == "front":
        return (x, z)
    elif view_name == "right":
        return (y, z)
    return None


# Self-test
if __name__ == "__main__":
    from _feature_inference import infer_features_from_config

    config = {
        "shapes": [
            {"id": "disc", "type": "cylinder", "radius": 60, "height": 12},
            {"id": "bore", "type": "cylinder", "radius": 15, "height": 16, "position": [0, 0, -2]},
            {"id": "bolt_h1", "type": "cylinder", "radius": 5, "height": 16, "position": [45, 0, -2]},
            {"id": "bolt_h2", "type": "cylinder", "radius": 5, "height": 16, "position": [0, 45, -2]},
            {"id": "bolt_h3", "type": "cylinder", "radius": 5, "height": 16, "position": [-45, 0, -2]},
            {"id": "bolt_h4", "type": "cylinder", "radius": 5, "height": 16, "position": [0, -45, -2]},
        ],
        "operations": [
            {"op": "cut", "base": "disc", "tool": "bore", "result": "body"},
            {"op": "cut", "base": "body", "tool": "bolt_h1", "result": "body"},
            {"op": "cut", "base": "body", "tool": "bolt_h2", "result": "body"},
            {"op": "cut", "base": "body", "tool": "bolt_h3", "result": "body"},
            {"op": "cut", "base": "body", "tool": "bolt_h4", "result": "body"},
        ],
        "drawing": {
            "views": ["front", "top", "right", "iso"],
            "style": {"show_hidden": True},
        },
    }

    graph = infer_features_from_config(config)
    plan = plan_views(graph, config["drawing"])

    print("=== View Planner Self-Test ===")
    for vn, vc in plan.views.items():
        print(f"  {vn}: hidden={vc['show_hidden']}, "
              f"marks={len(vc['center_marks'])}, "
              f"lines={len(vc['center_lines'])}")

    print(f"\nSuggested sections: {len(plan.section_planes)}")
    for s in plan.section_planes:
        print(f"  {s['label']}: {s['plane']} @ {s['offset']} — {s['reason']}")

    print(f"\nSuggested details: {len(plan.detail_regions)}")
    for d in plan.detail_regions:
        print(f"  {d['label']}: {d['source_view']} — {d['reason']}")

    # Verify: ISO view should have hidden=False
    assert not plan.views.get("iso", {}).get("show_hidden", True), \
        "ISO view should not show hidden lines"

    # Verify: section suggested for bore
    assert len(plan.section_planes) >= 1, "Should suggest section for central bore"

    print("\n=== All tests passed ===")
