"""
Shape creation and boolean operations for FreeCAD automation.
Supports: Box, Cylinder, Sphere, Cone, Torus + boolean ops + fillet/chamfer.
"""

import FreeCAD
import Part
from FreeCAD import Vector


def make_shape(spec):
    """
    Create a shape from a spec dict.

    Supported types:
      box:      length, width, height
      cylinder: radius, height
      sphere:   radius
      cone:     radius1, radius2, height
      torus:    radius1, radius2

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
    else:
        raise ValueError(f"Unknown shape type: {shape_type}")

    # Apply rotation if specified: [axis_x, axis_y, axis_z, angle_degrees]
    if "rotation" in spec:
        r = spec["rotation"]
        shape.rotate(Vector(*pos), Vector(r[0], r[1], r[2]), r[3])

    return shape


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
