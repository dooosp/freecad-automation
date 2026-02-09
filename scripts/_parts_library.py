"""
Parametric parts library for FreeCAD automation.
Provides: ball bearing, spur gear, stepped shaft.
Each generator returns a Part.Shape (Compound or Solid).
"""

import math
import FreeCAD
import Part
from FreeCAD import Vector


# ---------------------------------------------------------------------------
# Ball Bearing
# ---------------------------------------------------------------------------

def make_ball_bearing(spec):
    """
    Create a ball bearing as a Compound (inner race + outer race + balls).

    Required: inner_d, outer_d, width
    Optional: num_balls (default 8)
    """
    inner_d = float(spec["inner_d"])
    outer_d = float(spec["outer_d"])
    width = float(spec["width"])
    num_balls = int(spec.get("num_balls", 8))

    if inner_d >= outer_d:
        raise ValueError(f"inner_d ({inner_d}) must be < outer_d ({outer_d})")

    radial_space = (outer_d - inner_d) / 2.0
    t = radial_space * 0.3           # race thickness
    ball_r = radial_space * 0.35     # ball radius
    pitch_r = (inner_d + outer_d) / 4.0  # pitch circle radius

    half_w = width / 2.0

    # Inner race: hollow cylinder
    inner_outer_r = inner_d / 2.0 + t
    inner_inner_r = inner_d / 2.0
    inner_race = Part.makeCylinder(inner_outer_r, width, Vector(0, 0, -half_w))
    inner_hole = Part.makeCylinder(inner_inner_r, width, Vector(0, 0, -half_w))
    inner_race = inner_race.cut(inner_hole)

    # Outer race: hollow cylinder
    outer_outer_r = outer_d / 2.0
    outer_inner_r = outer_d / 2.0 - t
    outer_race = Part.makeCylinder(outer_outer_r, width, Vector(0, 0, -half_w))
    outer_hole = Part.makeCylinder(outer_inner_r, width, Vector(0, 0, -half_w))
    outer_race = outer_race.cut(outer_hole)

    # Balls on pitch circle at Z=0
    balls = []
    for i in range(num_balls):
        angle = 2.0 * math.pi * i / num_balls
        cx = pitch_r * math.cos(angle)
        cy = pitch_r * math.sin(angle)
        ball = Part.makeSphere(ball_r, Vector(cx, cy, 0))
        balls.append(ball)

    # Return Compound (no fuse → fast)
    return Part.makeCompound([inner_race, outer_race] + balls)


# ---------------------------------------------------------------------------
# Spur Gear (involute tooth profile)
# ---------------------------------------------------------------------------

def _involute_point(base_r, t):
    """
    Point on involute curve at parameter t (radians).
    Returns (x, y).
    """
    x = base_r * (math.cos(t) + t * math.sin(t))
    y = base_r * (math.sin(t) - t * math.cos(t))
    return (x, y)


def _involute_max_t(base_r, outer_r):
    """Find parameter t where involute reaches outer_r."""
    # r(t) = base_r * sqrt(1 + t^2) = outer_r
    # t = sqrt((outer_r/base_r)^2 - 1)
    ratio = outer_r / base_r
    if ratio <= 1.0:
        return 0.01
    return math.sqrt(ratio * ratio - 1.0)


def _make_single_tooth_wire(module, pitch_r, base_r, outer_r, root_r, tooth_angle):
    """
    Build a closed wire for one gear tooth (2D in XY plane).
    Returns Part.Wire.
    """
    num_pts = 12  # points per involute flank

    # Angular half-thickness at pitch circle
    # tooth thickness at pitch = pi * module / 2
    half_thick_angle = math.pi / (2.0 * (pitch_r / (module / 2.0))) if pitch_r > 0 else 0
    # Simpler: half tooth angle at pitch circle
    half_thick_angle = (math.pi * module / 2.0) / (2.0 * pitch_r)

    t_max = _involute_max_t(base_r, outer_r)

    # Right flank involute (rotated by +half_thick_angle)
    right_pts = []
    for i in range(num_pts + 1):
        t = t_max * i / num_pts
        ix, iy = _involute_point(base_r, t)
        # Rotate by half_thick_angle
        cos_a = math.cos(half_thick_angle)
        sin_a = math.sin(half_thick_angle)
        rx = ix * cos_a - iy * sin_a
        ry = ix * sin_a + iy * cos_a
        right_pts.append(Vector(rx, ry, 0))

    # Left flank involute (mirrored: reflect Y, then no extra rotation needed)
    left_pts = []
    for i in range(num_pts + 1):
        t = t_max * i / num_pts
        ix, iy = _involute_point(base_r, t)
        # Mirror: negate the angle → reflect across X then rotate by -half_thick_angle
        cos_a = math.cos(-half_thick_angle)
        sin_a = math.sin(-half_thick_angle)
        rx = ix * cos_a - (-iy) * sin_a
        ry = ix * sin_a + (-iy) * cos_a
        left_pts.append(Vector(rx, ry, 0))

    # Build edges: root arc → right flank → tip arc → left flank (reversed) → close
    edges = []

    # Root arc: from left_pts[0] to right_pts[0] through root circle
    # Use line segments through root if base_r > root_r
    root_left = left_pts[0]
    root_right = right_pts[0]
    # Connect via root circle point at angle 0
    root_mid = Vector(root_r, 0, 0)

    # If the involute starts above root, drop down to root first
    if base_r > root_r:
        edges.append(Part.makeLine(root_left, Vector(root_r * root_left.x / max(root_left.Length, 1e-9),
                                                       root_r * root_left.y / max(root_left.Length, 1e-9), 0)))
        edges.append(Part.makeLine(edges[-1].Vertexes[-1].Point,
                                    Vector(root_r * root_right.x / max(root_right.Length, 1e-9),
                                           root_r * root_right.y / max(root_right.Length, 1e-9), 0)))
        edges.append(Part.makeLine(edges[-1].Vertexes[-1].Point, root_right))
    else:
        edges.append(Part.makeLine(root_left, root_right))

    # Right flank (root to tip)
    for i in range(len(right_pts) - 1):
        edges.append(Part.makeLine(right_pts[i], right_pts[i + 1]))

    # Tip: line from right tip to left tip
    edges.append(Part.makeLine(right_pts[-1], left_pts[-1]))

    # Left flank (tip to root, reversed)
    for i in range(len(left_pts) - 1, 0, -1):
        edges.append(Part.makeLine(left_pts[i], left_pts[i - 1]))

    wire = Part.Wire(edges)
    return wire


def make_spur_gear(spec):
    """
    Create a spur gear with involute tooth profile.

    Required: module, teeth, width
    Optional: bore_d (default 0), pressure_angle (default 20)
    """
    mod = float(spec["module"])
    teeth = int(spec["teeth"])
    width = float(spec["width"])
    bore_d = float(spec.get("bore_d", 0))
    pressure_angle = float(spec.get("pressure_angle", 20))

    pa_rad = math.radians(pressure_angle)
    pitch_r = mod * teeth / 2.0
    base_r = pitch_r * math.cos(pa_rad)
    outer_r = pitch_r + mod        # addendum = 1 * module
    root_r = pitch_r - 1.25 * mod  # dedendum = 1.25 * module
    if root_r < 0:
        root_r = 0.1

    # Build one tooth as a face, extrude, then circular pattern
    tooth_angle = 2.0 * math.pi / teeth

    wire = _make_single_tooth_wire(mod, pitch_r, base_r, outer_r, root_r, tooth_angle)
    if not wire.isClosed():
        # Force close
        edges = list(wire.Edges)
        p1 = edges[-1].Vertexes[-1].Point
        p2 = edges[0].Vertexes[0].Point
        if p1.distanceToPoint(p2) > 1e-6:
            edges.append(Part.makeLine(p1, p2))
        wire = Part.Wire(edges)

    face = Part.Face(wire)
    tooth_solid = face.extrude(Vector(0, 0, width))

    # Circular pattern: all teeth
    from _shapes import circular_pattern
    all_teeth = circular_pattern(
        tooth_solid, [0, 0, 1], [0, 0, 0], teeth, 360, True
    )

    # Hub cylinder (root circle)
    hub = Part.makeCylinder(root_r, width)
    gear = hub.fuse(all_teeth)

    # Bore
    if bore_d > 0:
        bore = Part.makeCylinder(bore_d / 2.0, width * 2, Vector(0, 0, -width / 2))
        gear = gear.cut(bore)

    return gear


# ---------------------------------------------------------------------------
# Stepped Shaft
# ---------------------------------------------------------------------------

def make_stepped_shaft(spec):
    """
    Create a stepped shaft by stacking cylindrical segments along Z.

    Required: segments (list of {diameter, length})
    Optional: bore_d (default 0), chamfer (default 0)
    """
    segments = spec["segments"]
    bore_d = float(spec.get("bore_d", 0))
    chamfer_size = float(spec.get("chamfer", 0))

    if not segments:
        raise ValueError("stepped_shaft requires at least one segment")

    parts = []
    z_offset = 0.0

    for seg in segments:
        d = float(seg["diameter"])
        length = float(seg["length"])
        cyl = Part.makeCylinder(d / 2.0, length, Vector(0, 0, z_offset))
        parts.append(cyl)
        z_offset += length

    # Fuse all segments
    result = parts[0]
    for p in parts[1:]:
        result = result.fuse(p)

    # Bore
    if bore_d > 0:
        total_length = z_offset
        bore = Part.makeCylinder(bore_d / 2.0, total_length + 2, Vector(0, 0, -1))
        result = result.cut(bore)

    # Chamfer on all edges (best-effort)
    if chamfer_size > 0:
        try:
            result = result.makeChamfer(chamfer_size, result.Edges)
        except Exception:
            pass  # skip if chamfer fails

    return result


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

LIBRARY_DISPATCH = {
    "library/ball_bearing": make_ball_bearing,
    "library/spur_gear": make_spur_gear,
    "library/stepped_shaft": make_stepped_shaft,
}


def make_library_part(spec):
    """
    Dispatch to the appropriate library part generator.
    spec["type"] must start with "library/".
    """
    part_type = spec["type"]
    fn = LIBRARY_DISPATCH.get(part_type)
    if fn is None:
        raise ValueError(f"Unknown library part type: {part_type}")
    return fn(spec)
