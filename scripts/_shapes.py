"""
Shape creation and boolean operations for FreeCAD automation.
Supports: Box, Cylinder, Sphere, Cone, Torus, Revolution, Extrusion
          + boolean ops + fillet/chamfer + circular pattern.
"""

import math
import FreeCAD
import Part
from FreeCAD import Vector


# ---------------------------------------------------------------------------
# 2D Profile helpers
# ---------------------------------------------------------------------------

def _map_2d_to_3d(point_2d, plane="xz"):
    """Map a 2D [u, v] coordinate to a 3D Vector based on the working plane."""
    u, v = float(point_2d[0]), float(point_2d[1])
    if plane == "xz":
        return Vector(u, 0, v)
    elif plane == "xy":
        return Vector(u, v, 0)
    elif plane == "yz":
        return Vector(0, u, v)
    else:
        raise ValueError(f"Unknown plane: {plane}")


def _compute_arc_midpoint(start_2d, end_2d, center_2d, clockwise=False):
    """
    Compute the midpoint of an arc defined by center + start/end points.
    Returns a 2D [u, v] midpoint for use with Part.Arc (3-point arc).
    """
    sx, sy = float(start_2d[0]) - float(center_2d[0]), float(start_2d[1]) - float(center_2d[1])
    ex, ey = float(end_2d[0]) - float(center_2d[0]), float(end_2d[1]) - float(center_2d[1])
    r = math.sqrt(sx * sx + sy * sy)
    if r < 1e-9:
        raise ValueError("Arc radius is zero (start == center)")

    angle_start = math.atan2(sy, sx)
    angle_end = math.atan2(ey, ex)

    if clockwise:
        if angle_end >= angle_start:
            angle_end -= 2 * math.pi
    else:
        if angle_end <= angle_start:
            angle_end += 2 * math.pi

    angle_mid = (angle_start + angle_end) / 2.0
    mx = float(center_2d[0]) + r * math.cos(angle_mid)
    my = float(center_2d[1]) + r * math.sin(angle_mid)
    return [mx, my]


def build_profile_wire(segments, start_2d, plane="xz"):
    """
    Build a Part.Face from a 2D profile (list of line/arc segments).

    Args:
        segments: list of dicts with 'type' ('line' or 'arc'), 'to', and for arcs: 'center', 'clockwise'
        start_2d: [u, v] starting point
        plane: working plane ("xz", "xy", "yz")

    Returns:
        Part.Face built from the closed wire.
    """
    edges = []
    current = list(start_2d)

    for seg in segments:
        seg_type = seg["type"].lower()
        to_2d = seg["to"]

        if seg_type == "line":
            p1 = _map_2d_to_3d(current, plane)
            p2 = _map_2d_to_3d(to_2d, plane)
            if p1.distanceToPoint(p2) > 1e-6:
                edges.append(Part.makeLine(p1, p2))

        elif seg_type == "arc":
            center_2d = seg["center"]
            clockwise = seg.get("clockwise", False)
            mid_2d = _compute_arc_midpoint(current, to_2d, center_2d, clockwise)

            p1 = _map_2d_to_3d(current, plane)
            pm = _map_2d_to_3d(mid_2d, plane)
            p2 = _map_2d_to_3d(to_2d, plane)

            # Check collinearity — fallback to line if points are nearly collinear
            v1 = pm - p1
            v2 = p2 - p1
            cross_len = v1.cross(v2).Length
            if cross_len < 1e-6:
                if p1.distanceToPoint(p2) > 1e-6:
                    edges.append(Part.makeLine(p1, p2))
            else:
                arc = Part.Arc(p1, pm, p2)
                edges.append(arc.toShape())
        else:
            raise ValueError(f"Unknown profile segment type: {seg_type}")

        current = list(to_2d)

    # Auto-close: if last point != start, add a closing line
    p_last = _map_2d_to_3d(current, plane)
    p_start = _map_2d_to_3d(start_2d, plane)
    if p_last.distanceToPoint(p_start) > 1e-6:
        edges.append(Part.makeLine(p_last, p_start))

    if not edges:
        raise ValueError("Profile has no edges")

    wire = Part.Wire(edges)
    if not wire.isClosed():
        raise ValueError("Profile wire is not closed")

    return Part.Face(wire)


# ---------------------------------------------------------------------------
# Sketch-based shape creators
# ---------------------------------------------------------------------------

def make_revolution(spec):
    """
    Create a solid of revolution from a 2D profile.

    Required keys:
        profile: list of line/arc segments
        profile_start: [u, v] starting point
    Optional:
        plane: "xz" (default) | "xy" | "yz"
        angle: degrees to revolve (default 360)
        axis: [x, y, z] revolution axis (default [0, 0, 1])
        axis_point: [x, y, z] point on axis (default [0, 0, 0])
    """
    plane = spec.get("plane", "xz")
    face = build_profile_wire(spec["profile"], spec["profile_start"], plane)

    angle = float(spec.get("angle", 360))
    axis = spec.get("axis", [0, 0, 1])
    axis_point = spec.get("axis_point", [0, 0, 0])

    # Validate: profile_start radius must be >= 0
    if plane == "xz" and float(spec["profile_start"][0]) < 0:
        raise ValueError("Revolution profile_start[0] (radius) must be >= 0 on xz plane")

    return face.revolve(Vector(*axis_point), Vector(*axis), angle)


def make_extrusion(spec):
    """
    Create an extruded solid from a 2D profile.

    Required keys:
        profile: list of line/arc segments
        profile_start: [u, v] starting point
        direction: [x, y, z] extrusion vector
    Optional:
        plane: "xy" (default) | "xz" | "yz"
    """
    plane = spec.get("plane", "xy")
    face = build_profile_wire(spec["profile"], spec["profile_start"], plane)

    direction = spec["direction"]
    return face.extrude(Vector(*direction))


def make_shape(spec):
    """
    Create a shape from a spec dict.

    Supported types:
      box:        length, width, height
      cylinder:   radius, height
      sphere:     radius
      cone:       radius1, radius2, height
      torus:      radius1, radius2
      revolution: profile + profile_start (+ plane, angle, axis, axis_point)
      extrusion:  profile + profile_start + direction (+ plane)

    Common optional: position [x,y,z], rotation [ax,ay,az,angle]
    """
    shape_type = spec["type"].lower()
    pos = spec.get("position", [0, 0, 0])

    if shape_type == "box":
        shape = Part.makeBox(
            spec["length"],
            spec["width"],
            spec["height"],
            Vector(*pos),
        )
    elif shape_type == "cylinder":
        shape = Part.makeCylinder(
            spec["radius"],
            spec["height"],
            Vector(*pos),
        )
        # Optional direction
        if "direction" in spec:
            d = spec["direction"]
            shape = Part.makeCylinder(
                spec["radius"],
                spec["height"],
                Vector(*pos),
                Vector(*d),
            )
    elif shape_type == "sphere":
        shape = Part.makeSphere(spec["radius"], Vector(*pos))
    elif shape_type == "cone":
        shape = Part.makeCone(
            spec["radius1"],
            spec["radius2"],
            spec["height"],
            Vector(*pos),
        )
    elif shape_type == "torus":
        shape = Part.makeTorus(
            spec["radius1"],
            spec["radius2"],
            Vector(*pos),
        )
    elif shape_type == "revolution":
        shape = make_revolution(spec)
    elif shape_type == "extrusion":
        shape = make_extrusion(spec)
    elif shape_type.startswith("library/"):
        from _parts_library import make_library_part
        shape = make_library_part(spec)
    else:
        raise ValueError(f"Unknown shape type: {shape_type}")

    # Apply position offset for sketch-based/library shapes
    if shape_type in ("revolution", "extrusion") or shape_type.startswith("library/"):
        if pos != [0, 0, 0]:
            shape.translate(Vector(*pos))

    # Apply rotation if specified: [axis_x, axis_y, axis_z, angle_degrees]
    if "rotation" in spec:
        r = spec["rotation"]
        shape.rotate(Vector(*pos), Vector(r[0], r[1], r[2]), r[3])

    return shape


# ---------------------------------------------------------------------------
# Circular pattern
# ---------------------------------------------------------------------------

def circular_pattern(shape, axis, center, count, total_angle=360, include_original=True):
    """
    Create a circular pattern of a shape.

    Args:
        shape: source Part.Shape
        axis: [x, y, z] rotation axis
        center: [x, y, z] center point
        count: number of copies (including original if include_original=True)
        total_angle: angular span in degrees (default 360)
        include_original: if True, include the original in the pattern (default True)
    """
    if count < 1:
        raise ValueError("circular_pattern count must be >= 1")

    step = float(total_angle) / float(count)
    axis_vec = Vector(*axis)
    center_vec = Vector(*center)

    copies = []
    start_idx = 0 if include_original else 1
    for i in range(start_idx, count):
        c = shape.copy()
        if i > 0:
            c.rotate(center_vec, axis_vec, step * i)
        copies.append(c)

    if not copies:
        raise ValueError("circular_pattern produced no copies")

    result = copies[0]
    for c in copies[1:]:
        result = result.fuse(c)

    return result


def boolean_op(op, base_shape, tool_shape):
    """
    Perform boolean operation.
    op: 'fuse' | 'cut' | 'common'
    """
    if op == "fuse":
        return base_shape.fuse(tool_shape)
    elif op == "cut":
        return base_shape.cut(tool_shape)
    elif op == "common":
        return base_shape.common(tool_shape)
    else:
        raise ValueError(f"Unknown boolean op: {op}")


def apply_fillet(shape, radius, edge_indices=None):
    """
    Apply fillet to shape edges.
    edge_indices: list of edge indices (1-based), or None for all edges.
    When applying to all edges, uses best-effort (skips edges that fail).
    """
    import sys
    edges = shape.Edges
    if edge_indices:
        selected = [edges[i - 1] for i in edge_indices]
    else:
        selected = list(edges)

    # Try all at once first
    try:
        return shape.makeFillet(radius, selected)
    except Exception:
        pass

    # Fallback: apply one edge at a time, skip failures
    current = shape
    applied = 0
    for edge in selected:
        try:
            # Find matching edge in current shape by midpoint proximity
            mid = edge.CenterOfMass
            match = min(current.Edges, key=lambda e: mid.distanceToPoint(e.CenterOfMass))
            candidate = current.makeFillet(radius, [match])
            current = candidate
            applied += 1
        except Exception:
            continue

    print(f"[freecad] Fillet: applied to {applied}/{len(selected)} edges", file=sys.stderr, flush=True)
    return current


def apply_chamfer(shape, size, edge_indices=None):
    """
    Apply chamfer to shape edges.
    edge_indices: list of edge indices (1-based), or None for all edges.
    When applying to all edges, uses best-effort (skips edges that fail).
    """
    import sys
    edges = shape.Edges
    if edge_indices:
        selected = [edges[i - 1] for i in edge_indices]
    else:
        selected = list(edges)

    try:
        return shape.makeChamfer(size, selected)
    except Exception:
        pass

    current = shape
    applied = 0
    for edge in selected:
        try:
            mid = edge.CenterOfMass
            match = min(current.Edges, key=lambda e: mid.distanceToPoint(e.CenterOfMass))
            candidate = current.makeChamfer(size, [match])
            current = candidate
            applied += 1
        except Exception:
            continue

    print(f"[freecad] Chamfer: applied to {applied}/{len(selected)} edges", file=sys.stderr, flush=True)
    return current


def get_metadata(shape):
    """Extract geometric metadata from a shape."""
    bb = shape.BoundBox
    return {
        "volume": round(shape.Volume, 2),
        "area": round(shape.Area, 2),
        "faces": len(shape.Faces),
        "edges": len(shape.Edges),
        "vertices": len(shape.Vertexes),
        "bounding_box": {
            "min": [round(bb.XMin, 2), round(bb.YMin, 2), round(bb.ZMin, 2)],
            "max": [round(bb.XMax, 2), round(bb.YMax, 2), round(bb.ZMax, 2)],
            "size": [round(bb.XLength, 2), round(bb.YLength, 2), round(bb.ZLength, 2)],
        },
    }
