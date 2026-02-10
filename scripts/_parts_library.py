"""
Parametric parts library for FreeCAD automation.
Provides: ball bearing, spur gear, stepped shaft,
          helical gear, disc cam, pulley, coil spring.
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
# Helical Gear (spur gear with helix angle approximation)
# ---------------------------------------------------------------------------

def make_helical_gear(spec):
    """
    Create a helical gear by extruding spur teeth with a twist.

    Required: module, teeth, width
    Optional: bore_d (0), pressure_angle (20), helix_angle (15)
    """
    helix_angle = float(spec.get("helix_angle", 15))

    # Build base spur gear then apply twist via shear
    spur = make_spur_gear(spec)

    if abs(helix_angle) < 0.1:
        return spur

    # Approximate helix by shearing: rotate top face relative to bottom
    # twist_angle = tan(helix_angle) * width / pitch_radius
    mod = float(spec["module"])
    teeth = int(spec["teeth"])
    width = float(spec["width"])
    pitch_r = mod * teeth / 2.0
    twist_deg = math.degrees(math.tan(math.radians(helix_angle)) * width / pitch_r)

    # Apply twist via rotation matrix on a copy
    from FreeCAD import Rotation, Placement
    # Slice into N layers and rotate each
    n_slices = 8
    slices = []
    for i in range(n_slices):
        z0 = width * i / n_slices
        z1 = width * (i + 1) / n_slices
        h = z1 - z0
        # Cut a slice
        cutter = Part.makeBox(pitch_r * 4, pitch_r * 4, h,
                              Vector(-pitch_r * 2, -pitch_r * 2, z0))
        sl = spur.common(cutter)
        # Rotate slice around Z by interpolated angle
        angle_mid = twist_deg * (z0 + h / 2.0) / width
        sl.rotate(Vector(0, 0, 0), Vector(0, 0, 1), angle_mid)
        slices.append(sl)

    result = slices[0]
    for s in slices[1:]:
        result = result.fuse(s)

    # Bore (re-apply since fuse may have closed it)
    bore_d = float(spec.get("bore_d", 0))
    if bore_d > 0:
        bore = Part.makeCylinder(bore_d / 2.0, width * 2, Vector(0, 0, -width / 2))
        result = result.cut(bore)

    return result


# ---------------------------------------------------------------------------
# Disc Cam (eccentric cam with lift profile)
# ---------------------------------------------------------------------------

def _cam_radius(theta, base_radius, max_lift, profile_type):
    """Compute cam radius at angle theta (radians)."""
    # Normalize theta to [0, 2*pi]
    theta = theta % (2.0 * math.pi)
    # Rise from 0 to pi, return from pi to 2*pi
    if theta <= math.pi:
        phase = theta / math.pi  # 0→1
    else:
        phase = (2.0 * math.pi - theta) / math.pi  # 1→0

    if profile_type == "harmonic":
        lift = max_lift * (1.0 - math.cos(math.pi * phase)) / 2.0
    elif profile_type == "cycloidal":
        lift = max_lift * (phase - math.sin(2.0 * math.pi * phase) / (2.0 * math.pi))
    elif profile_type == "dwell":
        # Dwell at max for middle 50%
        if 0.25 <= phase <= 0.75:
            lift = max_lift
        elif phase < 0.25:
            lift = max_lift * (1.0 - math.cos(math.pi * phase / 0.25)) / 2.0
        else:
            lift = max_lift * (1.0 - math.cos(math.pi * (1.0 - phase) / 0.25)) / 2.0
    else:
        lift = max_lift * (1.0 - math.cos(math.pi * phase)) / 2.0

    return base_radius + lift


def make_disc_cam(spec):
    """
    Create a disc cam with configurable lift profile.

    Required: base_radius, max_lift, width
    Optional: bore_d (0), profile_type (harmonic)
    """
    base_radius = float(spec["base_radius"])
    max_lift = float(spec["max_lift"])
    width = float(spec["width"])
    bore_d = float(spec.get("bore_d", 0))
    profile_type = spec.get("profile_type", "harmonic")

    # Generate 2D profile points
    num_pts = 72
    pts = []
    for i in range(num_pts):
        theta = 2.0 * math.pi * i / num_pts
        r = _cam_radius(theta, base_radius, max_lift, profile_type)
        pts.append(Vector(r * math.cos(theta), r * math.sin(theta), 0))

    # Close the wire
    edges = []
    for i in range(len(pts)):
        edges.append(Part.makeLine(pts[i], pts[(i + 1) % len(pts)]))

    wire = Part.Wire(edges)
    face = Part.Face(wire)
    cam = face.extrude(Vector(0, 0, width))

    # Bore
    if bore_d > 0:
        bore = Part.makeCylinder(bore_d / 2.0, width * 2, Vector(0, 0, -width / 2))
        cam = cam.cut(bore)

    return cam


# ---------------------------------------------------------------------------
# Pulley (V-belt pulley with grooves)
# ---------------------------------------------------------------------------

def make_pulley(spec):
    """
    Create a V-belt pulley with V-grooves via revolution.

    Required: pitch_d, width
    Optional: groove_angle (38), groove_depth (5), bore_d (0), num_grooves (1)
    """
    pitch_d = float(spec["pitch_d"])
    width = float(spec["width"])
    groove_angle = float(spec.get("groove_angle", 38))
    groove_depth = float(spec.get("groove_depth", 5))
    bore_d = float(spec.get("bore_d", 0))
    num_grooves = int(spec.get("num_grooves", 1))

    outer_r = pitch_d / 2.0
    hub_r = outer_r - groove_depth - 3  # 3mm wall
    if hub_r < 2:
        hub_r = 2.0

    half_w = width / 2.0
    half_angle = math.radians(groove_angle / 2.0)
    groove_w = 2.0 * groove_depth * math.tan(half_angle)

    # Build revolution profile in XZ plane (X=radius, Z=axial)
    # Profile: hub wall bottom → hub wall top → grooves → hub wall top other side → close
    total_groove_width = num_grooves * groove_w + (num_grooves - 1) * 2.0
    groove_start_z = -total_groove_width / 2.0

    profile_pts = []
    # Start at inner bore, bottom
    profile_pts.append(Vector(hub_r, 0, -half_w))
    profile_pts.append(Vector(outer_r, 0, -half_w))

    # Grooves from left to right
    z = groove_start_z
    for g in range(num_grooves):
        # Left rim
        profile_pts.append(Vector(outer_r, 0, z))
        # V-groove bottom
        groove_bottom_r = outer_r - groove_depth
        profile_pts.append(Vector(groove_bottom_r, 0, z + groove_w / 2.0))
        # Right rim
        profile_pts.append(Vector(outer_r, 0, z + groove_w))
        z += groove_w + 2.0  # 2mm between grooves

    profile_pts.append(Vector(outer_r, 0, half_w))
    profile_pts.append(Vector(hub_r, 0, half_w))
    # Close back to start
    profile_pts.append(Vector(hub_r, 0, -half_w))

    # Build wire
    edges = []
    for i in range(len(profile_pts) - 1):
        edges.append(Part.makeLine(profile_pts[i], profile_pts[i + 1]))
    wire = Part.Wire(edges)
    face = Part.Face(wire)

    # Revolve around Z axis
    pulley = face.revolve(Vector(0, 0, 0), Vector(0, 0, 1), 360)

    # Bore
    if bore_d > 0:
        bore = Part.makeCylinder(bore_d / 2.0, width * 2, Vector(0, 0, -width))
        pulley = pulley.cut(bore)

    return pulley


# ---------------------------------------------------------------------------
# Coil Spring
# ---------------------------------------------------------------------------

def make_coil_spring(spec):
    """
    Create a coil spring using helix + pipe shell.

    Required: wire_d, coil_d, pitch, num_coils
    Optional: end_type (open)
    """
    wire_d = float(spec["wire_d"])
    coil_d = float(spec["coil_d"])
    pitch_val = float(spec["pitch"])
    num_coils = float(spec["num_coils"])
    end_type = spec.get("end_type", "open")

    coil_r = coil_d / 2.0
    wire_r = wire_d / 2.0
    height = pitch_val * num_coils

    # Make helix spine
    helix = Part.makeHelix(pitch_val, height, coil_r)

    # Wire cross-section circle at helix start
    start_pt = helix.Edges[0].Vertexes[0].Point
    # Tangent direction at start for normal plane
    circle = Part.makeCircle(wire_r, start_pt, Vector(0, 0, 1))
    # Actually, align circle normal to helix tangent
    # For simplicity, use Z-normal circle at start — pipe shell handles orientation
    profile_wire = Part.Wire([circle])

    # Sweep along helix
    try:
        mkPipe = Part.BRepOffsetAPI.MakePipeShell(Part.Wire(helix.Edges))
        mkPipe.add(profile_wire)
        mkPipe.build()
        spring = mkPipe.shape()
    except Exception:
        # Fallback: simple sweep
        spring = Part.Wire(helix.Edges).makePipeShell([profile_wire], True, False)

    if end_type == "closed":
        # Add flat end coils (half-pitch at each end)
        # Approximate by adding flat discs at top and bottom
        bottom = Part.makeTorus(coil_r, wire_r, Vector(0, 0, 0))
        top = Part.makeTorus(coil_r, wire_r, Vector(0, 0, height))
        spring = Part.makeCompound([spring, bottom, top])

    return spring


# ---------------------------------------------------------------------------
# Robot Base (industrial pedestal + flange + bolt holes)
# ---------------------------------------------------------------------------

def make_robot_base(spec):
    """
    Industrial robot base with smooth BSpline revolution profile.
    Shape: sharp mounting flange → smooth organic pedestal → top plate.

    Required: diameter, height
    Optional: bolt_count (6), bolt_d (8), cable_hole_d (0)
    """
    d = float(spec.get("diameter", 200))
    h = float(spec.get("height", 50))
    bolt_count = int(spec.get("bolt_count", 6))
    bolt_d = float(spec.get("bolt_d", 8))
    cable_hole_d = float(spec.get("cable_hole_d", d * 0.25))

    r = d / 2.0
    flange_r = r * 1.15
    flange_h = max(8, h * 0.15)
    top_r = r * 0.82
    eps = 0.01

    # --- Profile: sharp flange + BSpline organic body ---
    e_bot = Part.makeLine(Vector(eps, 0, 0), Vector(flange_r, 0, 0))
    e_flange = Part.makeLine(Vector(flange_r, 0, 0), Vector(flange_r, 0, flange_h))

    # Organic body: BSpline from flange top → top surface
    body_pts = [
        Vector(flange_r, 0, flange_h),
        Vector(r * 1.05, 0, flange_h + h * 0.08),
        Vector(r * 0.92, 0, h * 0.35),
        Vector(r * 0.88, 0, h * 0.50),
        Vector(r * 0.93, 0, h * 0.65),
        Vector(r * 1.05, 0, h * 0.78),
        Vector(r * 0.98, 0, h * 0.90),
        Vector(top_r, 0, h),
    ]
    bs = Part.BSplineCurve()
    bs.interpolate(body_pts)
    e_body = bs.toShape()

    # Closing edges
    e_top = Part.makeLine(Vector(top_r, 0, h), Vector(eps, 0, h))
    e_axis = Part.makeLine(Vector(eps, 0, h), Vector(eps, 0, 0))

    wire = Part.Wire([e_bot, e_flange, e_body, e_top, e_axis])
    face = Part.Face(wire)
    base = face.revolve(Vector(0, 0, 0), Vector(0, 0, 1), 360)

    # Bolt holes in flange
    bolt_circle_r = flange_r * 0.82
    for i in range(bolt_count):
        angle = 2.0 * math.pi * i / bolt_count
        x = bolt_circle_r * math.cos(angle)
        y = bolt_circle_r * math.sin(angle)
        hole = Part.makeCylinder(bolt_d / 2.0, flange_h + 2, Vector(x, y, -1))
        base = base.cut(hole)

    # Center cable pass-through
    if cable_hole_d > 0:
        cable = Part.makeCylinder(cable_hole_d / 2.0, h + 2, Vector(0, 0, -1))
        base = base.cut(cable)

    # Edge fillet (best-effort)
    try:
        base = base.makeFillet(2.0, base.Edges)
    except Exception:
        pass

    return base


# ---------------------------------------------------------------------------
# Robot Link (tapered arm segment + motor housing + end flange)
# ---------------------------------------------------------------------------

def make_robot_link(spec):
    """
    Industrial robot arm link using Loft (rounded-rect cross-sections).
    Shape: motor housing → neck taper → body → end cap.
    Non-circular cross-sections for industrial look.
    Oriented along Z axis.

    Required: length, width
    Optional: taper_ratio (0.75), motor_d (auto), wall_thickness (5), bore_d (0)
    """
    from _shapes import _make_rounded_rect_wire

    length = float(spec.get("length", 300))
    width = float(spec.get("width", 80))
    taper = float(spec.get("taper_ratio", 0.75))
    motor_d = float(spec.get("motor_d", 0)) or width * 0.95
    wall = float(spec.get("wall_thickness", 5))
    bore_d = float(spec.get("bore_d", 0))

    # Dimensions
    motor_w = motor_d
    motor_h = motor_d * 0.82
    motor_len = width * 0.45
    tip_w = width * taper
    tip_h = motor_h * taper
    cap_w = tip_w + 6
    cap_h = tip_h + 6

    r = min(width, motor_h) * 0.18
    r_tip = min(tip_w, tip_h) * 0.22

    # --- Loft sections (all rounded_rect, Z=along link axis) ---
    sections = [
        _make_rounded_rect_wire(motor_w, motor_h, r, z=0),
        _make_rounded_rect_wire(motor_w * 0.96, motor_h * 0.94, r, z=motor_len),
        _make_rounded_rect_wire(width * 0.55, motor_h * 0.55, r * 1.2, z=motor_len + width * 0.25),
        _make_rounded_rect_wire(width * 0.48, motor_h * 0.46, r_tip, z=length * 0.45),
        _make_rounded_rect_wire(tip_w * 0.92, tip_h * 0.92, r_tip, z=length * 0.75),
        _make_rounded_rect_wire(cap_w, cap_h, r_tip * 0.8, z=length - 5),
        _make_rounded_rect_wire(cap_w, cap_h, r_tip * 0.8, z=length),
    ]

    link = Part.makeLoft(sections, True, False)

    # --- Shell for hollow interior ---
    try:
        top_face = max(link.Faces, key=lambda f: f.CenterOfMass.z)
        bot_face = min(link.Faces, key=lambda f: f.CenterOfMass.z)
        link = link.makeThickness([top_face, bot_face], -wall, 1e-3)
    except Exception:
        pass

    # --- Asymmetric motor drum (side protrusion on +X) ---
    drum_r = motor_len * 0.38
    drum_depth = width * 0.14
    drum_z = motor_len * 0.25
    try:
        drum = Part.makeCylinder(drum_r, drum_depth,
                                  Vector(motor_w / 2.0 - 2, 0, drum_z),
                                  Vector(1, 0, 0))
        drum_cap = Part.makeSphere(drum_r,
                                    Vector(motor_w / 2.0 - 2 + drum_depth, 0, drum_z))
        drum = drum.fuse(drum_cap)
        link = link.fuse(drum)
    except Exception:
        pass

    # Cable bore
    if bore_d > 0:
        bore = Part.makeCylinder(bore_d / 2.0, length + 10, Vector(0, 0, -5))
        link = link.cut(bore)

    # Edge fillet (best-effort)
    try:
        link = link.makeFillet(1.5, link.Edges)
    except Exception:
        pass

    return link


# ---------------------------------------------------------------------------
# Robot Wrist (compact joint housing with bearing seats)
# ---------------------------------------------------------------------------

def make_robot_wrist(spec):
    """
    Compact robot wrist with smooth BSpline revolution profile.
    Shape: bearing flange → organic body with mid-ring detail → bearing flange.
    Oriented along Z axis.

    Required: diameter, length
    Optional: wall_thickness (4), bore_d (0)
    """
    d = float(spec.get("diameter", 60))
    length = float(spec.get("length", 80))
    wall = float(spec.get("wall_thickness", 4))
    bore_d = float(spec.get("bore_d", 0))

    r = d / 2.0
    flange_r = r + 3
    eps = 0.01

    # BSpline revolution profile: flanges + smooth body with mid-ring
    profile_pts = [
        Vector(flange_r, 0, 0),
        Vector(flange_r, 0, 5),
        Vector(r * 0.92, 0, 8),
        Vector(r * 0.88, 0, length * 0.25),
        Vector(r * 0.92, 0, length * 0.43),
        Vector(r + 1.5, 0, length * 0.50),
        Vector(r * 0.92, 0, length * 0.57),
        Vector(r * 0.88, 0, length * 0.75),
        Vector(r * 0.92, 0, length - 8),
        Vector(flange_r, 0, length - 5),
        Vector(flange_r, 0, length),
    ]
    bs = Part.BSplineCurve()
    bs.interpolate(profile_pts)
    e_body = bs.toShape()

    e_bot = Part.makeLine(Vector(eps, 0, 0), Vector(flange_r, 0, 0))
    e_top = Part.makeLine(Vector(flange_r, 0, length), Vector(eps, 0, length))
    e_axis = Part.makeLine(Vector(eps, 0, length), Vector(eps, 0, 0))

    wire = Part.Wire([e_bot, e_body, e_top, e_axis])
    face = Part.Face(wire)
    result = face.revolve(Vector(0, 0, 0), Vector(0, 0, 1), 360)

    # Hollow out
    inner_r = r - wall
    if inner_r > 2:
        inner = Part.makeCylinder(inner_r, length - 2 * wall,
                                   Vector(0, 0, wall))
        result = result.cut(inner)

    # Cable bore
    if bore_d > 0:
        bore = Part.makeCylinder(bore_d / 2.0, length + 10,
                                  Vector(0, 0, -5))
        result = result.cut(bore)

    # Edge fillet (best-effort)
    try:
        result = result.makeFillet(1.5, result.Edges)
    except Exception:
        pass

    return result


# ---------------------------------------------------------------------------
# Tool Flange (ISO 9409 style mounting plate)
# ---------------------------------------------------------------------------

def make_tool_flange(spec):
    """
    ISO 9409-style tool flange: disc + bolt pattern + pilot bore + alignment pin.

    Required: diameter
    Optional: thickness (12), bolt_count (4), bolt_circle_d (auto),
              bolt_d (6), pilot_d (auto), pin_d (6)
    """
    d = float(spec.get("diameter", 63))
    thickness = float(spec.get("thickness", 12))
    bolt_count = int(spec.get("bolt_count", 4))
    bolt_circle_d = float(spec.get("bolt_circle_d", 0)) or d * 0.78
    bolt_d = float(spec.get("bolt_d", 6))
    pilot_d = float(spec.get("pilot_d", 0)) or d * 0.5
    pin_d = float(spec.get("pin_d", 6))

    r = d / 2.0

    # Main disc
    flange = Part.makeCylinder(r, thickness)

    # Raised center boss
    boss_r = pilot_d / 2.0 + 3
    boss_h = 3
    boss = Part.makeCylinder(boss_r, boss_h, Vector(0, 0, thickness))
    flange = flange.fuse(boss)

    # Pilot bore (center locating hole)
    if pilot_d > 0:
        pilot = Part.makeCylinder(pilot_d / 2.0, thickness + boss_h + 2,
                                   Vector(0, 0, -1))
        flange = flange.cut(pilot)

    # Bolt holes
    bolt_circle_r = bolt_circle_d / 2.0
    for i in range(bolt_count):
        angle = 2.0 * math.pi * i / bolt_count
        x = bolt_circle_r * math.cos(angle)
        y = bolt_circle_r * math.sin(angle)
        hole = Part.makeCylinder(bolt_d / 2.0, thickness + 2, Vector(x, y, -1))
        flange = flange.cut(hole)

    # Alignment pin hole (offset from center)
    if pin_d > 0:
        pin_offset = bolt_circle_r * 0.7
        pin_hole = Part.makeCylinder(pin_d / 2.0, thickness + 2,
                                      Vector(pin_offset, 0, -1))
        flange = flange.cut(pin_hole)

    return flange


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

LIBRARY_DISPATCH = {
    "library/ball_bearing": make_ball_bearing,
    "library/spur_gear": make_spur_gear,
    "library/stepped_shaft": make_stepped_shaft,
    "library/helical_gear": make_helical_gear,
    "library/disc_cam": make_disc_cam,
    "library/pulley": make_pulley,
    "library/coil_spring": make_coil_spring,
    "library/robot_base": make_robot_base,
    "library/robot_link": make_robot_link,
    "library/robot_wrist": make_robot_wrist,
    "library/tool_flange": make_tool_flange,
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
