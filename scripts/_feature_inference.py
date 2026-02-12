"""
Feature inference from TOML config — identifies holes, chamfers, fillets,
threads, patterns (bolt circles, linear arrays) for annotation planning.
"""

import math


class Feature:
    """A recognized geometric feature."""

    __slots__ = ("type", "id", "diameter", "depth", "position", "axis",
                 "parent_id", "size", "extra")

    def __init__(self, type, id, *, diameter=None, depth=None, position=None,
                 axis=None, parent_id=None, size=None, extra=None):
        self.type = type          # hole, counterbore, chamfer, fillet, thread, slot, bore, dowel
        self.id = id
        self.diameter = diameter  # mm
        self.depth = depth        # mm
        self.position = position or [0, 0, 0]
        self.axis = axis or [0, 0, 1]
        self.parent_id = parent_id
        self.size = size          # chamfer size, fillet radius, etc.
        self.extra = extra or {}  # thread pitch, label, etc.

    def __repr__(self):
        parts = [f"Feature({self.type!r}, {self.id!r}"]
        if self.diameter:
            parts.append(f"d={self.diameter}")
        if self.position != [0, 0, 0]:
            parts.append(f"pos={self.position}")
        return ", ".join(parts) + ")"


class FeatureGroup:
    """A group of related features (e.g., bolt circle)."""

    __slots__ = ("pattern", "features", "center", "pcd", "axis", "count")

    def __init__(self, pattern, features, *, center=None, pcd=None, axis=None):
        self.pattern = pattern    # bolt_circle, linear_array, counterbore_set
        self.features = features
        self.center = center or [0, 0, 0]
        self.pcd = pcd            # pitch circle diameter
        self.axis = axis or [0, 0, 1]
        self.count = len(features)

    def __repr__(self):
        return f"FeatureGroup({self.pattern!r}, n={self.count}, PCD={self.pcd})"


class FeatureGraph:
    """Collection of inferred features and their groupings."""

    def __init__(self):
        self.features = []
        self.groups = []
        self._by_id = {}

    def add(self, feature):
        self.features.append(feature)
        self._by_id[feature.id] = feature

    def get(self, fid):
        return self._by_id.get(fid)

    def by_type(self, ftype):
        return [f for f in self.features if f.type == ftype]

    def add_group(self, group):
        self.groups.append(group)


def infer_features_from_config(config):
    """Scan config shapes and operations to infer features.

    Identifies:
    - Holes (cylinder + cut operation)
    - Counterbores (larger cylinder at same XY, cut after hole)
    - Chamfers (chamfer operation)
    - Fillets (fillet operation)
    - Threads (drawing.threads config)
    - Bores (large central holes)
    - Slots (box+cylinder cut combinations)
    - Dowels (small holes labeled 'dowel')

    Returns: FeatureGraph
    """
    graph = FeatureGraph()
    shapes = {s["id"]: s for s in config.get("shapes", [])}
    operations = config.get("operations", [])
    drawing = config.get("drawing", {})

    # Track which shapes are cut (subtracted)
    cut_tools = set()
    for op in operations:
        if op.get("op") == "cut":
            cut_tools.add(op.get("tool", ""))

    # Infer holes and bores from cylindrical cuts
    for sid, s in shapes.items():
        if s.get("type") != "cylinder":
            continue
        if sid not in cut_tools:
            continue

        r = s.get("radius", 0)
        h = s.get("height", 0)
        pos = s.get("position", [0, 0, 0])
        d = r * 2

        # Classify
        if "dowel" in sid.lower():
            ftype = "dowel"
        elif "bore" in sid.lower() or (d > 20 and _is_centered(pos)):
            ftype = "bore"
        elif "cb" in sid.lower() or "counterbore" in sid.lower():
            ftype = "counterbore"
        elif "slot" in sid.lower():
            continue  # handled separately
        else:
            ftype = "hole"

        graph.add(Feature(
            type=ftype, id=sid,
            diameter=d, depth=h,
            position=list(pos),
            axis=s.get("direction", [0, 0, 1]),
        ))

    # Link counterbores to their parent holes
    holes = graph.by_type("hole")
    cbs = graph.by_type("counterbore")
    for cb in cbs:
        best_hole = None
        best_dist = float("inf")
        for hole in holes:
            d = _xy_dist(cb.position, hole.position)
            if d < best_dist and d < 2.0:  # within 2mm XY
                best_dist = d
                best_hole = hole
        if best_hole:
            cb.parent_id = best_hole.id

    # Infer chamfers
    for op in operations:
        if op.get("op") == "chamfer":
            graph.add(Feature(
                type="chamfer",
                id=f"chamfer_{op.get('target', 'body')}",
                size=op.get("size", 1.0),
                parent_id=op.get("target"),
            ))

    # Infer fillets
    for op in operations:
        if op.get("op") == "fillet":
            graph.add(Feature(
                type="fillet",
                id=f"fillet_{op.get('target', 'body')}",
                size=op.get("radius", 1.0),
                parent_id=op.get("target"),
            ))

    # Infer threads from drawing config
    for tcfg in drawing.get("threads", []):
        graph.add(Feature(
            type="thread",
            id=f"thread_{tcfg.get('hole_id', 'unknown')}",
            diameter=tcfg.get("diameter"),
            parent_id=tcfg.get("hole_id"),
            extra={
                "pitch": tcfg.get("pitch"),
                "label": tcfg.get("label"),
                "class": tcfg.get("class", "6H"),
            },
        ))

    # Infer slots (box + cylinder end caps fused then cut)
    slot_parts = {}
    for op in operations:
        if op.get("op") == "fuse":
            base_id = op.get("base", "")
            tool_id = op.get("tool", "")
            result_id = op.get("result", "")
            if "slot" in base_id.lower() or "slot" in result_id.lower():
                slot_parts.setdefault(result_id, []).append(base_id)
                slot_parts.setdefault(result_id, []).append(tool_id)
    for slot_id in slot_parts:
        if slot_id in cut_tools:
            # Get approximate slot dimensions from constituent shapes
            parts = slot_parts[slot_id]
            box_shape = None
            for pid in parts:
                if pid in shapes and shapes[pid].get("type") == "box":
                    box_shape = shapes[pid]
                    break
            if box_shape:
                pos = box_shape.get("position", [0, 0, 0])
                graph.add(Feature(
                    type="slot", id=slot_id,
                    position=list(pos),
                    extra={
                        "length": box_shape.get("width", 0) + box_shape.get("length", 0),
                        "width": min(box_shape.get("width", 0), box_shape.get("length", 0)),
                    },
                ))

    # Group features into patterns
    _group_features(graph)

    return graph


def _group_features(graph):
    """Detect bolt circles, linear arrays, and counterbore sets."""

    # Bolt circle detection: N holes at equal angular spacing on a PCD
    holes = graph.by_type("hole")
    if len(holes) >= 3:
        _detect_bolt_circle(graph, holes)

    # Counterbore sets follow their parent holes
    cbs = graph.by_type("counterbore")
    if len(cbs) >= 2:
        parent_holes = [graph.get(cb.parent_id) for cb in cbs if cb.parent_id]
        parent_holes = [h for h in parent_holes if h]
        if parent_holes:
            # Check if parent holes form a bolt circle
            for grp in graph.groups:
                if grp.pattern == "bolt_circle":
                    grp_ids = {f.id for f in grp.features}
                    matching_cbs = [cb for cb in cbs
                                    if cb.parent_id in grp_ids]
                    if matching_cbs:
                        graph.add_group(FeatureGroup(
                            "counterbore_set", matching_cbs,
                            center=grp.center, pcd=grp.pcd,
                        ))


def _detect_bolt_circle(graph, holes):
    """Detect holes arranged on a pitch circle diameter."""
    if len(holes) < 3:
        return

    # Group holes by similar radius (same diameter = same type)
    by_radius = {}
    for h in holes:
        key = round(h.diameter * 2) / 2  # snap to 0.5mm
        by_radius.setdefault(key, []).append(h)

    for d_key, group in by_radius.items():
        if len(group) < 3:
            continue

        # Check if all holes are equidistant from a common center
        positions = [h.position for h in group]
        cx = sum(p[0] for p in positions) / len(positions)
        cy = sum(p[1] for p in positions) / len(positions)

        radii = [math.hypot(p[0] - cx, p[1] - cy) for p in positions]
        if not radii:
            continue

        avg_r = sum(radii) / len(radii)
        if avg_r < 1.0:
            continue  # Too close to center

        # Check consistency (all radii within 5% of average)
        if all(abs(r - avg_r) / avg_r < 0.05 for r in radii):
            # Check equal angular spacing
            angles = sorted(math.atan2(p[1] - cy, p[0] - cx) for p in positions)
            n = len(angles)
            expected_step = 2 * math.pi / n
            equal_spacing = all(
                abs(_angle_diff(angles[(i+1) % n], angles[i]) - expected_step)
                < expected_step * 0.15
                for i in range(n)
            )

            pcd = avg_r * 2
            graph.add_group(FeatureGroup(
                "bolt_circle" if equal_spacing else "hole_pattern",
                group,
                center=[cx, cy, positions[0][2]],
                pcd=round(pcd, 1),
            ))


def _is_centered(pos):
    """Check if position is near the origin in XY."""
    return abs(pos[0]) < 1.0 and abs(pos[1]) < 1.0


def _xy_dist(a, b):
    """2D distance in XY plane."""
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _angle_diff(a, b):
    """Signed angle difference, wrapped to [0, 2π)."""
    d = a - b
    while d < 0:
        d += 2 * math.pi
    while d >= 2 * math.pi:
        d -= 2 * math.pi
    return d


# Self-test
if __name__ == "__main__":
    # Simulate test_flange config
    config = {
        "shapes": [
            {"id": "disc", "type": "cylinder", "radius": 60, "height": 12},
            {"id": "bore", "type": "cylinder", "radius": 15, "height": 16, "position": [0, 0, -2]},
            {"id": "bolt_h1", "type": "cylinder", "radius": 5, "height": 16, "position": [45, 0, -2]},
            {"id": "bolt_h2", "type": "cylinder", "radius": 5, "height": 16, "position": [0, 45, -2]},
            {"id": "bolt_h3", "type": "cylinder", "radius": 5, "height": 16, "position": [-45, 0, -2]},
            {"id": "bolt_h4", "type": "cylinder", "radius": 5, "height": 16, "position": [0, -45, -2]},
            {"id": "cb1", "type": "cylinder", "radius": 9, "height": 6, "position": [45, 0, 8]},
            {"id": "cb2", "type": "cylinder", "radius": 9, "height": 6, "position": [0, 45, 8]},
            {"id": "cb3", "type": "cylinder", "radius": 9, "height": 6, "position": [-45, 0, 8]},
            {"id": "cb4", "type": "cylinder", "radius": 9, "height": 6, "position": [0, -45, 8]},
            {"id": "dowel1", "type": "cylinder", "radius": 3, "height": 16, "position": [35.36, 35.36, -2]},
            {"id": "dowel2", "type": "cylinder", "radius": 3, "height": 16, "position": [-35.36, -35.36, -2]},
        ],
        "operations": [
            {"op": "cut", "base": "disc", "tool": "bore", "result": "body"},
            {"op": "cut", "base": "body", "tool": "bolt_h1", "result": "body"},
            {"op": "cut", "base": "body", "tool": "bolt_h2", "result": "body"},
            {"op": "cut", "base": "body", "tool": "bolt_h3", "result": "body"},
            {"op": "cut", "base": "body", "tool": "bolt_h4", "result": "body"},
            {"op": "cut", "base": "body", "tool": "cb1", "result": "body"},
            {"op": "cut", "base": "body", "tool": "cb2", "result": "body"},
            {"op": "cut", "base": "body", "tool": "cb3", "result": "body"},
            {"op": "cut", "base": "body", "tool": "cb4", "result": "body"},
            {"op": "cut", "base": "body", "tool": "dowel1", "result": "body"},
            {"op": "cut", "base": "body", "tool": "dowel2", "result": "body"},
            {"op": "chamfer", "target": "body", "size": 1.5, "result": "final"},
        ],
        "drawing": {
            "threads": [{"diameter": 10, "pitch": 1.5, "label": "M10x1.5", "hole_id": "bolt_h1"}],
        },
    }

    graph = infer_features_from_config(config)

    print("=== Feature Inference Self-Test ===")
    print(f"\nTotal features: {len(graph.features)}")
    for f in graph.features:
        print(f"  {f}")
    print(f"\nGroups: {len(graph.groups)}")
    for g in graph.groups:
        print(f"  {g}")

    # Verify
    assert len(graph.by_type("hole")) == 4, f"Expected 4 holes, got {len(graph.by_type('hole'))}"
    assert len(graph.by_type("bore")) == 1, "Expected 1 bore"
    assert len(graph.by_type("counterbore")) == 4, "Expected 4 counterbores"
    assert len(graph.by_type("dowel")) == 2, "Expected 2 dowels"
    assert len(graph.by_type("chamfer")) == 1, "Expected 1 chamfer"
    assert len(graph.by_type("thread")) == 1, "Expected 1 thread"

    # Check bolt circle detection
    bolt_circles = [g for g in graph.groups if g.pattern == "bolt_circle"]
    assert len(bolt_circles) >= 1, "Expected at least 1 bolt circle"
    bc = bolt_circles[0]
    assert bc.count == 4, f"Expected 4-hole bolt circle, got {bc.count}"
    assert abs(bc.pcd - 90.0) < 1.0, f"Expected PCD ~90, got {bc.pcd}"
    print(f"\nBolt circle: PCD={bc.pcd}mm, n={bc.count}")

    print("\n=== All tests passed ===")
