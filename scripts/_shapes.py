"""
Shape creation and boolean operations for FreeCAD automation.
Supports: Box, Cylinder, Sphere, Cone, Torus, Revolution, Extrusion
          + boolean ops + fillet/chamfer + circular pattern + import (STEP/BREP/IGES).
"""

import math
import os
import sys
import hashlib
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


# ---------------------------------------------------------------------------
# Cross-section wire helpers (for Loft / Sweep)
# ---------------------------------------------------------------------------

def _make_rounded_rect_wire(w, h, r, z=0):
    """Rounded rectangle wire in XY plane at height z, centered at origin."""
    hw, hh = w / 2.0, h / 2.0
    r = max(0.1, min(r, hw - 0.1, hh - 0.1))

    edges = []
    # Counterclockwise from top-right arc
    edges.append(Part.makeCircle(r, Vector(hw - r, hh - r, z), Vector(0, 0, 1), 0, 90))
    edges.append(Part.makeLine(Vector(hw - r, hh, z), Vector(-(hw - r), hh, z)))
    edges.append(Part.makeCircle(r, Vector(-(hw - r), hh - r, z), Vector(0, 0, 1), 90, 180))
    edges.append(Part.makeLine(Vector(-hw, hh - r, z), Vector(-hw, -(hh - r), z)))
    edges.append(Part.makeCircle(r, Vector(-(hw - r), -(hh - r), z), Vector(0, 0, 1), 180, 270))
    edges.append(Part.makeLine(Vector(-(hw - r), -hh, z), Vector(hw - r, -hh, z)))
    edges.append(Part.makeCircle(r, Vector(hw - r, -(hh - r), z), Vector(0, 0, 1), 270, 360))
    edges.append(Part.makeLine(Vector(hw, -(hh - r), z), Vector(hw, hh - r, z)))

    return Part.Wire(edges)


def _make_circle_wire(d, z=0):
    """Circle wire in XY plane at height z, centered at origin."""
    edge = Part.makeCircle(d / 2.0, Vector(0, 0, z), Vector(0, 0, 1))
    return Part.Wire([edge])


def _make_ellipse_wire(w, h, z=0):
    """Ellipse wire in XY plane at height z, centered at origin."""
    a, b = w / 2.0, h / 2.0
    n = 48
    pts = [Vector(a * math.cos(2 * math.pi * i / n),
                  b * math.sin(2 * math.pi * i / n), z) for i in range(n)]
    pts.append(pts[0])
    bs = Part.BSplineCurve()
    bs.interpolate(pts)
    return Part.Wire([bs.toShape()])


def _make_section_wire(section):
    """Create a wire from a section definition dict."""
    profile = section.get("profile", "circle")
    z = float(section.get("z", 0))

    if profile == "circle":
        d = float(section.get("diameter", section.get("d", 50)))
        return _make_circle_wire(d, z)
    elif profile == "rounded_rect":
        w = float(section["width"])
        h = float(section["height"])
        r = float(section.get("radius", min(w, h) * 0.1))
        return _make_rounded_rect_wire(w, h, r, z)
    elif profile == "ellipse":
        w = float(section["width"])
        h = float(section["height"])
        return _make_ellipse_wire(w, h, z)
    else:
        raise ValueError(f"Unknown section profile: {profile}")


# ---------------------------------------------------------------------------
# Loft (multiple cross-sections → solid)
# ---------------------------------------------------------------------------

def make_loft(spec):
    """
    Create a loft solid from multiple cross-section profiles.

    Required: sections (list of {z, profile, ...})
    Optional: solid (true), ruled (false)
    """
    sections = spec.get("sections", [])
    if len(sections) < 2:
        raise ValueError("Loft requires at least 2 sections")

    solid = spec.get("solid", True)
    ruled = spec.get("ruled", False)

    wires = []
    for s in sorted(sections, key=lambda x: float(x.get("z", 0))):
        wires.append(_make_section_wire(s))

    return Part.makeLoft(wires, solid, ruled)


# ---------------------------------------------------------------------------
# Sweep (profile along BSpline path)
# ---------------------------------------------------------------------------

def make_sweep(spec):
    """
    Sweep a profile along a BSpline path.

    Required: path (list of [x,y,z] control points)
    Optional: profile ("circle"), profile_d, profile_width, profile_height, profile_radius
    """
    path_pts = [Vector(*p) for p in spec["path"]]
    if len(path_pts) < 2:
        raise ValueError("Sweep path requires at least 2 points")

    bs = Part.BSplineCurve()
    bs.interpolate(path_pts)
    path_wire = Part.Wire([bs.toShape()])

    # Build profile wire at origin (XY plane)
    profile_type = spec.get("profile", "circle")
    if profile_type == "circle":
        d = float(spec.get("profile_d", spec.get("diameter", 20)))
        profile_wire = _make_circle_wire(d, 0)
    elif profile_type == "rounded_rect":
        w = float(spec["profile_width"])
        h = float(spec["profile_height"])
        r = float(spec.get("profile_radius", min(w, h) * 0.1))
        profile_wire = _make_rounded_rect_wire(w, h, r, 0)
    elif profile_type == "ellipse":
        w = float(spec["profile_width"])
        h = float(spec["profile_height"])
        profile_wire = _make_ellipse_wire(w, h, 0)
    else:
        raise ValueError(f"Unknown sweep profile: {profile_type}")

    # Move profile to path start
    profile_wire.translate(path_pts[0])

    # Sweep with Frenet frame
    try:
        return path_wire.makePipeShell([profile_wire], True, True)
    except Exception:
        # Fallback: makePipe with face
        face = Part.Face(profile_wire)
        return path_wire.makePipe(face)


# ---------------------------------------------------------------------------
# Shell (thin-wall from solid)
# ---------------------------------------------------------------------------

def apply_shell(shape, thickness, face_indices=None):
    """
    Create a thin-wall shell from a solid by removing specified faces.

    Args:
        shape: solid Part.Shape
        thickness: wall thickness (mm)
        face_indices: list of face indices (1-based) to remove, or None for top face
    """
    import sys
    if face_indices:
        faces = [shape.Faces[i - 1] for i in face_indices]
    else:
        faces = [max(shape.Faces, key=lambda f: f.CenterOfMass.z)]

    try:
        return shape.makeThickness(faces, -thickness, 1e-3)
    except Exception as e:
        print(f"[freecad] Shell failed: {e}", file=sys.stderr, flush=True)
        return shape


def _fetch_url(url, cache_dir):
    """
    Download a file from URL to cache_dir using SHA256-based filename.
    Returns the local cached filepath. Skips download if cached.
    """
    # Determine extension from URL
    url_path = url.split("?")[0]
    ext = os.path.splitext(url_path)[1].lower()
    if not ext:
        ext = ".step"

    url_hash = hashlib.sha256(url.encode()).hexdigest()[:16]
    cached_path = os.path.join(cache_dir, f"{url_hash}{ext}")

    if os.path.exists(cached_path):
        print(f"[freecad] Import: cache hit {cached_path}", file=sys.stderr, flush=True)
        return cached_path

    os.makedirs(cache_dir, exist_ok=True)

    # Use urllib (available in FreeCAD's bundled Python)
    import urllib.request
    print(f"[freecad] Import: downloading {url}", file=sys.stderr, flush=True)
    urllib.request.urlretrieve(url, cached_path)
    print(f"[freecad] Import: saved to {cached_path}", file=sys.stderr, flush=True)
    return cached_path


def import_shape(spec):
    """
    Import an external CAD file (STEP/BREP/IGES).

    Required (one of):
        file: local file path (absolute, or relative to project root)
        url:  HTTP(S) URL (downloaded and cached in parts/cache/)

    Optional:
        scale: uniform scale factor (default 1.0)
    """
    filepath = spec.get("file")
    url = spec.get("url")

    if not filepath and not url:
        raise ValueError("import shape requires 'file' or 'url'")

    scripts_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(scripts_dir)

    if url and not filepath:
        cache_dir = os.path.join(project_root, "parts", "cache")
        filepath = _fetch_url(url, cache_dir)

    # Resolve relative paths against project root
    if not os.path.isabs(filepath):
        filepath = os.path.join(project_root, filepath)

    if not os.path.isfile(filepath):
        raise FileNotFoundError(f"Import file not found: {filepath}")

    print(f"[freecad] Import: reading {filepath}", file=sys.stderr, flush=True)
    shape = Part.read(filepath)

    # Apply scale if specified
    scale = float(spec.get("scale", 1.0))
    if abs(scale - 1.0) > 1e-9:
        mat = FreeCAD.Matrix()
        mat.scale(scale, scale, scale)
        shape = shape.transformGeometry(mat)

    return shape


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
      loft:       sections [{z, profile, ...}] (+ solid, ruled)
      sweep:      path [[x,y,z],...] + profile/profile_d (+ profile_width/height)
      import:     file or url (STEP/BREP/IGES)

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
    elif shape_type == "loft":
        shape = make_loft(spec)
    elif shape_type == "sweep":
        shape = make_sweep(spec)
    elif shape_type == "import":
        shape = import_shape(spec)
    elif shape_type.startswith("library/"):
        from _parts_library import make_library_part
        shape = make_library_part(spec)
    else:
        raise ValueError(f"Unknown shape type: {shape_type}")

    # Apply position offset for sketch-based/library/loft/sweep/import shapes
    if shape_type in ("revolution", "extrusion", "loft", "sweep", "import") or shape_type.startswith("library/"):
        if pos != [0, 0, 0]:
            shape.translate(Vector(*pos))

    # Apply rotation if specified: [axis_x, axis_y, axis_z, angle_degrees]
    if "rotation" in spec:
        r = spec["rotation"]
        if len(r) >= 4:
            shape.rotate(Vector(*pos), Vector(r[0], r[1], r[2]), r[3])
        elif len(r) == 3:
            # Treat as Euler angles [rx, ry, rz] in degrees
            if r[0] != 0:
                shape.rotate(Vector(*pos), Vector(1, 0, 0), r[0])
            if r[1] != 0:
                shape.rotate(Vector(*pos), Vector(0, 1, 0), r[1])
            if r[2] != 0:
                shape.rotate(Vector(*pos), Vector(0, 0, 1), r[2])

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
