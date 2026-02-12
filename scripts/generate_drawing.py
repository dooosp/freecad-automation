"""
Generate engineering drawing (4-view orthographic projection) from model config.
Pipeline: stdin JSON -> 3D build -> TechDraw.projectEx -> ISO 128 SVG -> BOM -> stdout JSON

Uses TechDraw.projectEx() for edge classification into visible/hidden/smooth/iso groups
and renders ISO 128 compliant line styles on A3 landscape layout.
"""

import sys
import os
import math
from datetime import date as _date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _bootstrap import log, read_input, respond, respond_error, init_freecad

# -- A3 Landscape Layout (mm) ------------------------------------------------
PAGE_W, PAGE_H = 420, 297
MARGIN = 15
TITLE_H = 35
DRAW_W = PAGE_W - 2 * MARGIN
DRAW_H = PAGE_H - 2 * MARGIN - TITLE_H
CELL_W, CELL_H = DRAW_W / 2, DRAW_H / 2

# Cell centers for 2x2 view grid (3rd angle projection)
#   [ TOP  ] [ ISO   ]
#   [FRONT ] [ RIGHT ]
VIEW_CELLS = {
    "top":   (MARGIN + CELL_W * 0.5, MARGIN + CELL_H * 0.5),
    "iso":   (MARGIN + CELL_W * 1.5, MARGIN + CELL_H * 0.5),
    "front": (MARGIN + CELL_W * 0.5, MARGIN + CELL_H * 1.5),
    "right": (MARGIN + CELL_W * 1.5, MARGIN + CELL_H * 1.5),
}

VIEW_DIRECTIONS = {
    "front": (0, -1, 0),
    "top":   (0, 0, -1),
    "right": (1, 0, 0),
    "iso":   (1, -1, 1),
}

# -- ISO 128 Line Styles per projectEx group ----------------------------------
# projectEx returns 10 groups: [0]hard_vis [1]hard_hid [2]outer_vis [3]outer_hid
#   [4]- [5]smooth_vis [6]smooth_hid [7]- [8]iso_vis [9]iso_hid
EDGE_NAMES = [
    "hard_visible", "hard_hidden", "outer_visible", "outer_hidden",
    "_4", "smooth_visible", "smooth_hidden", "_7", "iso_visible", "iso_hidden",
]

# group_index -> (stroke-width, color, dash-array|None)
# ISO 128: Thick(0.7) for visible outlines, Thin(0.25-0.35) for hidden/dimensions
LINE_STYLES = {
    0: ("0.7",  "#000", None),          # Hard visible — thick solid
    1: ("0.30", "#000", "4,2"),          # Hard hidden — thin dashed (longer dash)
    2: ("0.50", "#000", None),           # Outer visible — medium solid
    3: ("0.20", "#333", "3,1.5"),        # Outer hidden — thin dashed
    5: ("0.35", "#000", None),           # Smooth visible — medium solid
    6: ("0.20", "#444", "3,1.5"),        # Smooth hidden — thin dashed
    8: ("0.13", "#999", None),           # ISO visible — extra-thin solid
    9: ("0.10", "#bbb", "1.5,1"),        # ISO hidden — extra-thin dashed
}

# Global SVG line attributes for industrial look
LINE_CAP = "round"
LINE_JOIN = "round"

RENDER_ORDER = [9, 6, 3, 1, 8, 5, 2, 0]


# -- Coordinate Extraction (projectEx returns XY-plane shapes, Z=0 always) ----
# projectEx projects 3D shape onto a 2D plane and returns the result in the XY
# plane with Z=0. The mapping from projection (p.x, p.y) to drawing (u, v) is
# view-specific and was empirically determined by logging actual coordinates.
#
# 3rd angle projection ensures:
#   - Front/Top share the same horizontal axis (model X increasing right)
#   - Front/Right share the same vertical axis (model Z increasing up)
#   - Top vertical: model Y increasing up (away from front view)
#   - Right horizontal: model Y increasing right (front of object at left)

VIEW_UV_MAP = {
    "front": ("y", +1, "x", -1),   # projY=modelX -> u, -projX=modelZ -> v
    "top":   ("x", -1, "y", +1),   # -projX=modelX -> u, projY=modelY -> v
    "right": ("y", -1, "x", +1),   # -projY=modelY -> u, projX=modelZ -> v
}


def _extract_fn(view_name, sample_pts=None):
    """Return fn(FreeCAD.Vector) -> (u, v) for the given view.
    u = horizontal, v = vertical (positive = up in drawing).
    projectEx always returns Z=0; real 2D data is in (p.x, p.y)."""
    if view_name in VIEW_UV_MAP:
        ax1, s1, ax2, s2 = VIEW_UV_MAP[view_name]
        return lambda p, _a1=ax1, _s1=s1, _a2=ax2, _s2=s2: (
            _s1 * getattr(p, _a1), _s2 * getattr(p, _a2))
    # Iso and other views: use projection XY directly (Z is always 0)
    return lambda p: (p.x, p.y)


# -- Edge Projection -----------------------------------------------------------

def project_view(shape, direction, view_name):
    """Project shape with TechDraw.projectEx() and classify edges.
    Returns: (groups, bounds, circles, arcs)
      groups: {group_idx: [{"pts": [(u,v),...], "circ": (cu,cv,r)|None}, ...]}
      bounds: (u_min, v_min, u_max, v_max)
      circles: [(u, v, radius), ...]  — full circles with center and radius
      arcs: [(cu, cv, radius, mid_u, mid_v, group_idx), ...]  — partial arcs
    """
    import TechDraw
    from FreeCAD import Vector

    result = TechDraw.projectEx(shape, Vector(*direction))

    # Pass 1: collect raw 3D edge data
    raw = []
    all_pts = []

    for gi, grp in enumerate(result):
        if gi not in LINE_STYLES:
            continue
        if not hasattr(grp, 'Edges') or not grp.Edges:
            continue
        for edge in grp.Edges:
            ctype = type(edge.Curve).__name__
            pts = None
            center = None
            is_circ = False
            radius = 0.0
            arc_mid = None

            if ctype in ('Line', 'LineSegment'):
                pts = [edge.Vertexes[0].Point, edge.Vertexes[1].Point]
            elif ctype == 'Circle':
                center = edge.Curve.Center
                radius = edge.Curve.Radius
                is_circ = abs(edge.LastParameter - edge.FirstParameter - 2 * math.pi) < 0.01
                pts = list(edge.discretize(30))
                if not is_circ:
                    mid_param = (edge.FirstParameter + edge.LastParameter) / 2
                    arc_mid = edge.Curve.value(mid_param)
            else:
                try:
                    pts = list(edge.discretize(30))
                except Exception:
                    continue

            if pts:
                all_pts.extend(pts)
                raw.append((gi, pts, center, is_circ, radius, arc_mid))

    if not raw:
        return {}, (0, 0, 1, 1), [], []

    # Determine 2D extraction
    ext = _extract_fn(view_name, all_pts)

    # Pass 2: convert to 2D
    groups = {}
    all_2d = []
    circles = []
    arcs = []

    for gi, pts_3d, center_3d, is_circ, radius, arc_mid_3d in raw:
        pts_2d = [ext(p) for p in pts_3d]
        all_2d.extend(pts_2d)
        entry = {"pts": pts_2d}
        if is_circ and center_3d:
            c = ext(center_3d)
            entry["circ"] = (c[0], c[1], radius)
            circles.append((c[0], c[1], radius))
        elif arc_mid_3d and center_3d and radius > 0:
            c = ext(center_3d)
            m = ext(arc_mid_3d)
            arcs.append((c[0], c[1], radius, m[0], m[1], gi))
        groups.setdefault(gi, []).append(entry)

    us, vs = zip(*all_2d)
    bounds = (min(us), min(vs), max(us), max(vs))
    return groups, bounds, circles, arcs


# -- SVG Rendering -------------------------------------------------------------

def _detect_symmetry(groups, bounds):
    """Detect horizontal and vertical symmetry of projected view edges.

    Samples visible edge points onto a tolerance grid, mirrors about the
    view center, and checks match ratio.

    Returns: (h_symmetric, v_symmetric)
    """
    u0, v0, u1, v1 = bounds
    u_mid = (u0 + u1) / 2
    v_mid = (v0 + v1) / 2
    max_dim = max(u1 - u0, v1 - v0, 1)
    tol = max_dim * 0.01  # 1% of largest dimension

    # Collect visible edge sample points (skip hidden groups)
    hidden_groups = {1, 3, 6, 9}
    pts = set()
    for gi, edges in groups.items():
        if gi in hidden_groups:
            continue
        for e in edges:
            for u, v in e["pts"]:
                pts.add((round(u / tol), round(v / tol)))

    n = len(pts)
    if n < 10:
        return False, False

    # Horizontal symmetry (mirror about v_mid)
    v_mid_g = v_mid / tol
    h_match = sum(1 for ug, vg in pts if (ug, round(2 * v_mid_g - vg)) in pts)
    h_sym = h_match / n > 0.80

    # Vertical symmetry (mirror about u_mid)
    u_mid_g = u_mid / tol
    v_match = sum(1 for ug, vg in pts if (round(2 * u_mid_g - ug), vg) in pts)
    v_sym = v_match / n > 0.80

    return h_sym, v_sym


def render_view_svg(vname, groups, bounds, circles, cx, cy, scale,
                    show_hidden=True, show_centerlines=True):
    """Render one view's edges as SVG, centered at (cx, cy) on the page."""
    out = []
    u0, v0, u1, v1 = bounds
    bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

    def pg(u, v):
        return cx + (u - bcx) * scale, cy - (v - bcy) * scale

    # Hidden line groups: 1, 3, 6, 9
    hidden_groups = {1, 3, 6, 9}

    for gi in RENDER_ORDER:
        if gi not in groups:
            continue
        if not show_hidden and gi in hidden_groups:
            continue
        w, color, dash = LINE_STYLES[gi]
        attr = (f'stroke="{color}" stroke-width="{w}" fill="none" '
                f'stroke-linecap="{LINE_CAP}" stroke-linejoin="{LINE_JOIN}"')
        if dash:
            attr += f' stroke-dasharray="{dash}"'
        gn = EDGE_NAMES[gi] if gi < len(EDGE_NAMES) else f"g{gi}"
        out.append(f'<g class="{gn}" {attr}>')

        for e in groups[gi]:
            if "circ" in e:
                cu, cv, r = e["circ"]
                px, py = pg(cu, cv)
                out.append(f'  <circle cx="{px:.2f}" cy="{py:.2f}" r="{r*scale:.2f}"/>')
            else:
                pts = e["pts"]
                if len(pts) < 2:
                    continue
                pp = [pg(u, v) for u, v in pts]
                d = f'M{pp[0][0]:.2f},{pp[0][1]:.2f}'
                for x, y in pp[1:]:
                    d += f'L{x:.2f},{y:.2f}'
                out.append(f'  <path d="{d}"/>')

        out.append('</g>')

    # Center lines for circular features (ISO chain line: long-dash-dot)
    # circles = [(cu, cv, radius), ...]
    if circles and show_centerlines:
        max_r_scaled = max(r * scale for _, _, r in circles) if circles else 0
        arm_base = max(max_r_scaled * 1.3, min(CELL_W, CELL_H) * 0.06)

        out.append('<g class="centerlines" stroke="#000" stroke-width="0.18" '
                   'fill="none" stroke-dasharray="8,2,1.5,2" '
                   f'stroke-linecap="{LINE_CAP}">')
        for cu, cv, cr in circles:
            px, py = pg(cu, cv)
            arm = max(cr * scale * 1.3, arm_base)
            out.append(f'  <line x1="{px-arm:.2f}" y1="{py:.2f}" '
                       f'x2="{px+arm:.2f}" y2="{py:.2f}"/>')
            out.append(f'  <line x1="{px:.2f}" y1="{py-arm:.2f}" '
                       f'x2="{px:.2f}" y2="{py+arm:.2f}"/>')
        out.append('</g>')

    # Symmetry axis center lines (only where actual symmetry is detected)
    bw = (u1 - u0) * scale
    bh = (v1 - v0) * scale
    sym_margin = min(CELL_W, CELL_H) * 0.04
    if show_centerlines and bw > 5 and bh > 5 and vname != "iso":
        h_sym, v_sym = _detect_symmetry(groups, bounds)
        if h_sym or v_sym:
            mid_u = (u0 + u1) / 2
            mid_v = (v0 + v1) / 2
            px_mid, py_mid = pg(mid_u, mid_v)
            half_w = bw / 2 + sym_margin
            half_h = bh / 2 + sym_margin
            out.append('<g class="symmetry-axes" stroke="#000" stroke-width="0.13" '
                       'fill="none" stroke-dasharray="8,2,1.5,2" '
                       f'stroke-linecap="{LINE_CAP}" opacity="0.5">')
            if h_sym:
                out.append(f'  <line x1="{px_mid-half_w:.2f}" y1="{py_mid:.2f}" '
                           f'x2="{px_mid+half_w:.2f}" y2="{py_mid:.2f}"/>')
            if v_sym:
                out.append(f'  <line x1="{px_mid:.2f}" y1="{py_mid-half_h:.2f}" '
                           f'x2="{px_mid:.2f}" y2="{py_mid+half_h:.2f}"/>')
            out.append('</g>')

    # View label
    lx = cx - CELL_W / 2 + 3
    ly = cy - CELL_H / 2 + 10
    out.append(f'<text x="{lx:.1f}" y="{ly:.1f}" font-family="monospace" '
               f'font-size="3.5" fill="#666">{vname.upper()}</text>')

    return '\n'.join(out)


# -- Dimension Lines (ISO 129) ------------------------------------------------

# Dimension line constants
DIM_LINE_W = "0.18"          # thin line
DIM_COLOR = "#000"
DIM_FONT = "sans-serif"
DIM_FONT_SIZE = "3"          # mm
DIM_ARROW_L = 2.0            # arrow length mm
DIM_ARROW_W = 0.7            # arrow half-width mm
DIM_GAP = 2.0                # gap between shape edge and extension line start
DIM_OFFSET = 8.0             # distance from shape edge to dimension line
DIM_EXT_OVERSHOOT = 1.5      # extension line past dimension line
FEAT_DIM_STACK = 7.0         # spacing between stacked dimension rows


def _arrow_head(x, y, angle):
    """SVG polygon for a filled arrowhead pointing in `angle` radians."""
    ca, sa = math.cos(angle), math.sin(angle)
    # tip at (x,y), two base corners
    bx = x - DIM_ARROW_L * ca
    by = y - DIM_ARROW_L * sa
    lx = bx + DIM_ARROW_W * sa
    ly = by - DIM_ARROW_W * ca
    rx = bx - DIM_ARROW_W * sa
    ry = by + DIM_ARROW_W * ca
    return (f'<polygon points="{x:.2f},{y:.2f} {lx:.2f},{ly:.2f} '
            f'{rx:.2f},{ry:.2f}" fill="{DIM_COLOR}"/>')


def _dim_horizontal(x1, x2, y_base, y_dim, value_mm, tol_text=""):
    """Horizontal dimension: extension lines + dim line + arrows + text."""
    out = []
    # Extension lines (vertical, from shape to dimension line)
    out.append(f'<line x1="{x1:.2f}" y1="{y_base+DIM_GAP:.2f}" '
               f'x2="{x1:.2f}" y2="{y_dim-DIM_EXT_OVERSHOOT:.2f}"/>')
    out.append(f'<line x1="{x2:.2f}" y1="{y_base+DIM_GAP:.2f}" '
               f'x2="{x2:.2f}" y2="{y_dim-DIM_EXT_OVERSHOOT:.2f}"/>')
    # Dimension line (horizontal)
    out.append(f'<line x1="{x1:.2f}" y1="{y_dim:.2f}" '
               f'x2="{x2:.2f}" y2="{y_dim:.2f}"/>')
    # Arrows
    out.append(_arrow_head(x1, y_dim, 0))           # right-pointing at left end
    out.append(_arrow_head(x2, y_dim, math.pi))      # left-pointing at right end
    # Text (centered above dim line)
    tx = (x1 + x2) / 2
    ty = y_dim - 1.0
    text = f"{value_mm:.1f}" if value_mm != int(value_mm) else f"{int(value_mm)}"
    out.append(f'<text x="{tx:.2f}" y="{ty:.2f}" text-anchor="middle" '
               f'font-family="{DIM_FONT}" font-size="{DIM_FONT_SIZE}" '
               f'fill="{DIM_COLOR}">{text}</text>')
    # Tolerance annotation (smaller, below dimension text)
    if tol_text:
        out.append(f'<text x="{tx:.2f}" y="{ty+3.2:.2f}" text-anchor="middle" '
                   f'font-family="{DIM_FONT}" font-size="2" '
                   f'fill="{DIM_COLOR}">{tol_text}</text>')
    return out


def _dim_vertical(y1, y2, x_base, x_dim, value_mm, tol_text=""):
    """Vertical dimension: extension lines + dim line + arrows + text."""
    out = []
    # Extension lines (horizontal, from shape to dimension line)
    out.append(f'<line x1="{x_base-DIM_GAP:.2f}" y1="{y1:.2f}" '
               f'x2="{x_dim+DIM_EXT_OVERSHOOT:.2f}" y2="{y1:.2f}"/>')
    out.append(f'<line x1="{x_base-DIM_GAP:.2f}" y1="{y2:.2f}" '
               f'x2="{x_dim+DIM_EXT_OVERSHOOT:.2f}" y2="{y2:.2f}"/>')
    # Dimension line (vertical)
    out.append(f'<line x1="{x_dim:.2f}" y1="{y1:.2f}" '
               f'x2="{x_dim:.2f}" y2="{y2:.2f}"/>')
    # Arrows
    out.append(_arrow_head(x_dim, y1, math.pi / 2))      # down at top
    out.append(_arrow_head(x_dim, y2, -math.pi / 2))     # up at bottom
    # Text (rotated, centered beside dim line)
    tx = x_dim - 1.5
    ty = (y1 + y2) / 2
    text = f"{value_mm:.1f}" if value_mm != int(value_mm) else f"{int(value_mm)}"
    out.append(f'<text x="{tx:.2f}" y="{ty:.2f}" text-anchor="middle" '
               f'font-family="{DIM_FONT}" font-size="{DIM_FONT_SIZE}" '
               f'fill="{DIM_COLOR}" '
               f'transform="rotate(-90,{tx:.2f},{ty:.2f})">{text}</text>')
    # Tolerance annotation (smaller, offset along dimension line)
    if tol_text:
        ttx = x_dim - 4.5
        out.append(f'<text x="{ttx:.2f}" y="{ty:.2f}" text-anchor="middle" '
                   f'font-family="{DIM_FONT}" font-size="2" '
                   f'fill="{DIM_COLOR}" '
                   f'transform="rotate(-90,{ttx:.2f},{ty:.2f})">{tol_text}</text>')
    return out


def _dim_diameter(px, py, radius_scaled, radius_mm, angle_deg=45, tol_text=""):
    """Diameter dimension: leader line from circle + diameter text."""
    out = []
    angle = math.radians(angle_deg)
    # Leader line start (on circle edge) and end (outside)
    sx = px + radius_scaled * math.cos(angle)
    sy = py - radius_scaled * math.sin(angle)
    leader_len = max(radius_scaled * 0.8, 6)
    ex = sx + leader_len * math.cos(angle)
    ey = sy - leader_len * math.sin(angle)
    # Leader line
    out.append(f'<line x1="{sx:.2f}" y1="{sy:.2f}" '
               f'x2="{ex:.2f}" y2="{ey:.2f}"/>')
    # Horizontal shelf
    shelf_dir = 1 if math.cos(angle) >= 0 else -1
    shelf_len = 8
    shx = ex + shelf_dir * shelf_len
    out.append(f'<line x1="{ex:.2f}" y1="{ey:.2f}" '
               f'x2="{shx:.2f}" y2="{ey:.2f}"/>')
    # Arrow at circle edge
    out.append(_arrow_head(sx, sy, angle + math.pi))
    # Text (with optional tolerance grade)
    d_mm = radius_mm * 2
    text = f"\u2300{d_mm:.1f}" if d_mm != int(d_mm) else f"\u2300{int(d_mm)}"
    if tol_text:
        text += f" {tol_text}"
    tx = (ex + shx) / 2
    ty = ey - 1.2
    out.append(f'<text x="{tx:.2f}" y="{ty:.2f}" text-anchor="middle" '
               f'font-family="{DIM_FONT}" font-size="{DIM_FONT_SIZE}" '
               f'fill="{DIM_COLOR}">{text}</text>')
    return out


def _dim_radius(cx_pg, cy_pg, mx_pg, my_pg, radius_scaled, radius_mm):
    """Radius dimension: leader from arc surface outward + 'R{value}' text."""
    out = []
    # Direction from center to midpoint (radially outward) in page coords
    dx = mx_pg - cx_pg
    dy = my_pg - cy_pg
    dist = math.hypot(dx, dy)
    if dist < 0.1:
        return out
    ndx, ndy = dx / dist, dy / dist

    # Point on arc surface (page coords)
    ax = cx_pg + ndx * radius_scaled
    ay = cy_pg + ndy * radius_scaled

    # Leader end (outside arc)
    leader_len = max(radius_scaled * 0.6, 5)
    ex = ax + ndx * leader_len
    ey = ay + ndy * leader_len

    # Leader line
    out.append(f'<line x1="{ax:.2f}" y1="{ay:.2f}" '
               f'x2="{ex:.2f}" y2="{ey:.2f}"/>')

    # Arrow at arc surface (pointing toward center)
    arr_angle = math.atan2(-ndy, -ndx)
    out.append(_arrow_head(ax, ay, arr_angle))

    # Text
    text = f"R{radius_mm:.1f}" if radius_mm != int(radius_mm) else f"R{int(radius_mm)}"
    anchor = "start" if ndx >= 0 else "end"
    tx = ex + 1.5 * ndx
    ty = ey + 1.5 * ndy + 1.0
    out.append(f'<text x="{tx:.2f}" y="{ty:.2f}" text-anchor="{anchor}" '
               f'font-family="{DIM_FONT}" font-size="{DIM_FONT_SIZE}" '
               f'fill="{DIM_COLOR}">{text}</text>')
    return out


def render_dimensions_svg(vname, bounds, circles, cx, cy, scale, arcs=None,
                          tolerances=None):
    """Generate ISO 129 dimension lines for a view.

    - Bounding dimensions (overall width + height) for front/top/right
    - Hole diameter callouts for circular features
    - Feature chain dimensions (hole-to-hole and hole-to-edge positions)
    - Radius dimensions for fillet/round arcs
    - ISO view is skipped (no dimensions on pictorial views)

    tolerances: dict with keys 'general', 'holes', 'shafts' (optional)
    """
    tolerances = tolerances or {}
    if vname == "iso":
        return ""

    out = []
    u0, v0, u1, v1 = bounds
    bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

    def pg(u, v):
        return cx + (u - bcx) * scale, cy - (v - bcy) * scale

    # Shape extents in page coordinates
    left, top = pg(u0, v1)      # top-left (v1 is max = top in model)
    right, bottom = pg(u1, v0)  # bottom-right

    out.append(f'<g class="dimensions-{vname}" stroke="{DIM_COLOR}" '
               f'stroke-width="{DIM_LINE_W}" fill="none" '
               f'stroke-linecap="{LINE_CAP}">')

    h_stack = 0  # horizontal dimension rows stacked below shape
    v_stack = 0  # vertical dimension columns stacked right of shape

    gen_tol = tolerances.get("general", "")
    hole_tol = tolerances.get("holes", "")

    # Overall width (horizontal, below shape)
    width_mm = (u1 - u0)
    if width_mm > 0.5:
        y_dim = bottom + DIM_OFFSET + FEAT_DIM_STACK * h_stack
        out.extend(_dim_horizontal(left, right, bottom, y_dim, width_mm,
                                   tol_text=gen_tol))
        h_stack += 1

    # Overall height (vertical, right of shape)
    height_mm = (v1 - v0)
    if height_mm > 0.5:
        x_dim = right + DIM_OFFSET + FEAT_DIM_STACK * v_stack
        out.extend(_dim_vertical(top, bottom, right, x_dim, height_mm,
                                 tol_text=gen_tol))
        v_stack += 1

    # Hole diameters (deduplicated by radius within tolerance)
    seen_radii = []
    leader_angle = 45
    for cu, cv, cr in circles:
        # Skip duplicate radii (same size holes)
        is_dup = any(abs(cr - sr) < 0.1 for sr in seen_radii)
        if is_dup:
            continue
        seen_radii.append(cr)

        px, py = pg(cu, cv)
        r_scaled = cr * scale
        if r_scaled < 1.5:
            continue  # too small to dimension
        out.extend(_dim_diameter(px, py, r_scaled, cr, angle_deg=leader_angle,
                                 tol_text=hole_tol))
        leader_angle += 30  # stagger angles for multiple holes

    # -- Feature chain dimensions (hole positions from edges) --
    if circles:
        # Deduplicate circle u-positions (tolerance 1mm model space)
        unique_cu = []
        for c in sorted(circles, key=lambda c: c[0]):
            if not unique_cu or abs(c[0] - unique_cu[-1]) > 1.0:
                unique_cu.append(c[0])

        # Deduplicate circle v-positions
        unique_cv = []
        for c in sorted(circles, key=lambda c: c[1]):
            if not unique_cv or abs(c[1] - unique_cv[-1]) > 1.0:
                unique_cv.append(c[1])

        # Horizontal chain: left_edge → hole1 → hole2 → ... → right_edge
        chain_u = [u0] + unique_cu + [u1]
        h_segments = []
        for k in range(len(chain_u) - 1):
            dist = chain_u[k + 1] - chain_u[k]
            if dist > 2.0 and abs(dist - width_mm) > 1.0:
                px1, _ = pg(chain_u[k], v0)
                px2, _ = pg(chain_u[k + 1], v0)
                if abs(px2 - px1) >= 8.0:  # min page width for readable text
                    h_segments.append((px1, px2, dist))

        if h_segments:
            y_feat = bottom + DIM_OFFSET + FEAT_DIM_STACK * h_stack
            for px1, px2, dist in h_segments:
                out.extend(_dim_horizontal(px1, px2, bottom, y_feat, dist))
            h_stack += 1

        # Vertical chain: bottom_edge → hole1 → hole2 → ... → top_edge
        chain_v = [v0] + unique_cv + [v1]
        v_segments = []
        for k in range(len(chain_v) - 1):
            dist = chain_v[k + 1] - chain_v[k]
            if dist > 2.0 and abs(dist - height_mm) > 1.0:
                _, py_top = pg(u0, chain_v[k + 1])  # higher v → smaller page y
                _, py_bot = pg(u0, chain_v[k])       # lower v → larger page y
                if abs(py_bot - py_top) >= 8.0:
                    v_segments.append((py_top, py_bot, dist))

        if v_segments:
            x_feat = right + DIM_OFFSET + FEAT_DIM_STACK * v_stack
            for py_top, py_bot, dist in v_segments:
                out.extend(_dim_vertical(py_top, py_bot, right, x_feat, dist))
            v_stack += 1

    # -- Radius dimensions (fillet/round arcs) --
    if arcs:
        hidden_groups = {1, 3, 6, 9}
        seen_r = []
        for c_u, c_v, r, m_u, m_v, gi in arcs:
            if gi in hidden_groups:
                continue
            is_dup = any(abs(r - sr) < 0.1 for sr in seen_r)
            if is_dup:
                continue
            seen_r.append(r)
            r_scaled = r * scale
            if r_scaled < 1.0:
                continue
            cx_pg, cy_pg = pg(c_u, c_v)
            mx_pg, my_pg = pg(m_u, m_v)
            out.extend(_dim_radius(cx_pg, cy_pg, mx_pg, my_pg, r_scaled, r))

    out.append('</g>')
    return '\n'.join(out)


# -- Datum Indicators (ISO 5459) -----------------------------------------------

DATUM_TRI_H = 2.5            # triangle height (perpendicular to edge)
DATUM_TRI_BASE = 3.0         # triangle base width
DATUM_FRAME_S = 4.5          # frame size (square)
DATUM_LEADER_L = 3.0         # leader line length

# Datum assignment per view: (letter, edge, fraction_along_edge)
# A = bottom face (Z=min), B = left face (X=min), C = back face (Y=max)
DATUM_VIEW_MAP = {
    "front": [("A", "bottom", 0.25), ("B", "left", 0.3)],
    "top":   [("B", "left", 0.3),    ("C", "top", 0.25)],
    "right": [("A", "bottom", 0.25), ("C", "left", 0.3)],
}


def render_datums_svg(vname, bounds, cx, cy, scale):
    """Render ISO 5459 datum feature indicators on view edges.

    Places filled triangles with datum letter frames (A, B, C) on
    the primary reference surfaces visible in each orthographic view.
    """
    if vname not in DATUM_VIEW_MAP:
        return ""

    out = []
    u0, v0, u1, v1 = bounds
    bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

    def pg(u, v):
        return cx + (u - bcx) * scale, cy - (v - bcy) * scale

    out.append(f'<g class="datums-{vname}">')

    for letter, edge, frac in DATUM_VIEW_MAP[vname]:
        if edge == "bottom":
            px, py = pg(u0 + (u1 - u0) * frac, v0)
            t1 = (px - DATUM_TRI_BASE / 2, py)
            t2 = (px + DATUM_TRI_BASE / 2, py)
            t3 = (px, py + DATUM_TRI_H)
            fx = px - DATUM_FRAME_S / 2
            fy = py + DATUM_TRI_H + DATUM_LEADER_L
            lx2, ly2 = px, fy  # leader target: top-center of frame
        elif edge == "top":
            px, py = pg(u0 + (u1 - u0) * frac, v1)
            t1 = (px - DATUM_TRI_BASE / 2, py)
            t2 = (px + DATUM_TRI_BASE / 2, py)
            t3 = (px, py - DATUM_TRI_H)
            fx = px - DATUM_FRAME_S / 2
            fy = py - DATUM_TRI_H - DATUM_LEADER_L - DATUM_FRAME_S
            lx2, ly2 = px, fy + DATUM_FRAME_S  # leader target: bottom-center of frame
        elif edge == "left":
            px, py = pg(u0, v0 + (v1 - v0) * frac)
            t1 = (px, py - DATUM_TRI_BASE / 2)
            t2 = (px, py + DATUM_TRI_BASE / 2)
            t3 = (px - DATUM_TRI_H, py)
            fx = px - DATUM_TRI_H - DATUM_LEADER_L - DATUM_FRAME_S
            fy = py - DATUM_FRAME_S / 2
            lx2, ly2 = fx + DATUM_FRAME_S, py  # leader target: right-center of frame
        elif edge == "right":
            px, py = pg(u1, v0 + (v1 - v0) * frac)
            t1 = (px, py - DATUM_TRI_BASE / 2)
            t2 = (px, py + DATUM_TRI_BASE / 2)
            t3 = (px + DATUM_TRI_H, py)
            fx = px + DATUM_TRI_H + DATUM_LEADER_L
            fy = py - DATUM_FRAME_S / 2
            lx2, ly2 = fx, py  # leader target: left-center of frame
        else:
            continue

        # Filled triangle
        out.append(f'  <polygon points="{t1[0]:.2f},{t1[1]:.2f} '
                   f'{t2[0]:.2f},{t2[1]:.2f} {t3[0]:.2f},{t3[1]:.2f}" '
                   f'fill="#000" stroke="#000" stroke-width="0.25"/>')

        # Leader line (triangle apex → frame edge)
        out.append(f'  <line x1="{t3[0]:.2f}" y1="{t3[1]:.2f}" '
                   f'x2="{lx2:.2f}" y2="{ly2:.2f}" '
                   f'stroke="#000" stroke-width="0.3"/>')

        # Frame (square with white fill)
        out.append(f'  <rect x="{fx:.2f}" y="{fy:.2f}" '
                   f'width="{DATUM_FRAME_S}" height="{DATUM_FRAME_S}" '
                   f'fill="white" stroke="#000" stroke-width="0.35"/>')

        # Datum letter
        tx = fx + DATUM_FRAME_S / 2
        ty = fy + DATUM_FRAME_S * 0.72
        out.append(f'  <text x="{tx:.2f}" y="{ty:.2f}" text-anchor="middle" '
                   f'font-family="sans-serif" font-size="3.5" '
                   f'font-weight="bold" fill="#000">{letter}</text>')

    out.append('</g>')
    return '\n'.join(out)


# -- A3 Drawing Composition ---------------------------------------------------

def _render_3rd_angle_symbol(x, y, size=10):
    """Render ISO 128 3rd angle projection symbol (truncated cone + circle)."""
    s = size
    hs = s / 2
    parts = [f'<g class="projection-symbol" transform="translate({x},{y})">']
    # Left: truncated cone (front view)
    parts.append(f'<line x1="0" y1="{-hs}" x2="0" y2="{hs}" '
                 f'stroke="black" stroke-width="0.35"/>')
    parts.append(f'<line x1="0" y1="{-hs*0.4}" x2="{s*0.6}" y2="{-hs}" '
                 f'stroke="black" stroke-width="0.35"/>')
    parts.append(f'<line x1="0" y1="{hs*0.4}" x2="{s*0.6}" y2="{hs}" '
                 f'stroke="black" stroke-width="0.35"/>')
    parts.append(f'<line x1="{s*0.6}" y1="{-hs}" x2="{s*0.6}" y2="{hs}" '
                 f'stroke="black" stroke-width="0.35"/>')
    # Center line through cone
    parts.append(f'<line x1="{-1}" y1="0" x2="{s*0.6+1}" y2="0" '
                 f'stroke="black" stroke-width="0.13" stroke-dasharray="2,1"/>')
    # Right: circle (side view of cone)
    cx_r = s * 0.6 + s * 0.45
    parts.append(f'<circle cx="{cx_r}" cy="0" r="{hs}" '
                 f'fill="none" stroke="black" stroke-width="0.35"/>')
    parts.append(f'<circle cx="{cx_r}" cy="0" r="{hs*0.4}" '
                 f'fill="none" stroke="black" stroke-width="0.35"/>')
    # Center crosshair on circle
    parts.append(f'<line x1="{cx_r-hs-1}" y1="0" x2="{cx_r+hs+1}" y2="0" '
                 f'stroke="black" stroke-width="0.13" stroke-dasharray="2,1"/>')
    parts.append(f'<line x1="{cx_r}" y1="{-hs-1}" x2="{cx_r}" y2="{hs+1}" '
                 f'stroke="black" stroke-width="0.13" stroke-dasharray="2,1"/>')
    parts.append('</g>')
    return '\n'.join(parts)


def _render_hatch_pattern():
    """SVG <defs> for 45-degree cross-hatch pattern (ISO 128 section hatching)."""
    return (
        '<defs>'
        '<pattern id="hatch45" patternUnits="userSpaceOnUse" width="3" height="3" '
        'patternTransform="rotate(45)">'
        '<line x1="0" y1="0" x2="0" y2="3" stroke="#555" stroke-width="0.15"/>'
        '</pattern>'
        '</defs>'
    )


def compose_drawing(views_svg, name, bom, scale, bbox,
                    mates=None, tol_specs=None, meta=None, style_cfg=None):
    """Assemble full A3 landscape SVG with views, ISO 7200 title block, BOM, legend, GD&T."""
    meta = meta or {}
    style_cfg = style_cfg or {}
    p = []
    p.append(f'<svg xmlns="http://www.w3.org/2000/svg" '
             f'width="{PAGE_W}mm" height="{PAGE_H}mm" viewBox="0 0 {PAGE_W} {PAGE_H}">')
    p.append(f'<rect width="{PAGE_W}" height="{PAGE_H}" fill="white"/>')
    p.append(_render_hatch_pattern())

    # ISO 5457 double border
    bw, bh = PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN
    p.append(f'<rect x="{MARGIN}" y="{MARGIN}" width="{bw}" height="{bh}" '
             f'fill="none" stroke="black" stroke-width="0.7"/>')
    p.append(f'<rect x="{MARGIN+1}" y="{MARGIN+1}" width="{bw-2}" height="{bh-2}" '
             f'fill="none" stroke="black" stroke-width="0.35"/>')

    # Cell dividers (lighter, less distracting)
    for _, (ccx, ccy) in VIEW_CELLS.items():
        x0, y0 = ccx - CELL_W / 2, ccy - CELL_H / 2
        p.append(f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{CELL_W:.1f}" '
                 f'height="{CELL_H:.1f}" fill="none" stroke="#ccc" '
                 f'stroke-width="0.15" stroke-dasharray="6,3"/>')

    # View content
    for vn, svg in views_svg.items():
        p.append(f'<!-- {vn.upper()} -->')
        p.append(svg)

    # ── ISO 7200 Title Block ──────────────────────────────────────────────
    tb_y = PAGE_H - MARGIN - TITLE_H
    tb_x = MARGIN
    tb_w = DRAW_W
    tb_h = TITLE_H
    tb_bottom = PAGE_H - MARGIN

    # Title block background
    p.append(f'<rect x="{tb_x}" y="{tb_y}" width="{tb_w}" height="{tb_h}" '
             f'fill="#fafafa" stroke="black" stroke-width="0.5"/>')

    # Layout: left zone (BOM + legend) | right zone (ISO 7200 fields)
    # Right zone width: 170mm (standardized for ISO 7200)
    rz_w = 170
    rz_x = tb_x + tb_w - rz_w
    p.append(f'<line x1="{rz_x}" y1="{tb_y}" x2="{rz_x}" y2="{tb_bottom}" '
             f'stroke="black" stroke-width="0.35"/>')

    # ── Right Zone: ISO 7200 compartments ──
    # 4 rows, 2 columns
    row_h = tb_h / 4
    col_w = rz_w / 2

    sl = f"1:{round(1/scale)}" if scale < 1 else f"{round(scale)}:1"
    dt = _date.today().isoformat()

    fields = [
        # (row, col, label, value)
        (0, 0, "PART NAME",    meta.get("part_name", _escape(name))),
        (0, 1, "DRAWING NO.",  meta.get("drawing_no", "-")),
        (1, 0, "MATERIAL",     meta.get("material", "-")),
        (1, 1, "SCALE",        sl),
        (2, 0, "TOLERANCE",    meta.get("tolerance", "ISO 2768-m")),
        (2, 1, "DATE",         dt),
        (3, 0, "DESIGNED BY",  meta.get("designed_by", "-")),
        (3, 1, "SIZE / SHEET", "A3"),
    ]

    # Draw grid lines
    for row in range(1, 4):
        ry = tb_y + row * row_h
        p.append(f'<line x1="{rz_x}" y1="{ry:.1f}" x2="{tb_x+tb_w}" y2="{ry:.1f}" '
                 f'stroke="black" stroke-width="0.25"/>')
    # Vertical divider in right zone
    col_div_x = rz_x + col_w
    p.append(f'<line x1="{col_div_x:.1f}" y1="{tb_y}" x2="{col_div_x:.1f}" y2="{tb_bottom}" '
             f'stroke="black" stroke-width="0.25"/>')

    # Fill fields
    for row, col, label, value in fields:
        fx = rz_x + col * col_w + 2
        fy = tb_y + row * row_h
        # Label (small, gray)
        p.append(f'<text x="{fx:.1f}" y="{fy+3.5:.1f}" font-family="sans-serif" '
                 f'font-size="2" fill="#888" letter-spacing="0.3">{label}</text>')
        # Value (larger, bold for row 0)
        fw = "bold" if row == 0 else "normal"
        fs = "4.5" if row == 0 else "3.5"
        p.append(f'<text x="{fx:.1f}" y="{fy+row_h-1.5:.1f}" font-family="sans-serif" '
                 f'font-size="{fs}" font-weight="{fw}">{_escape(str(value))}</text>')

    # 3rd Angle Projection symbol (bottom-right corner of title block)
    sym_x = tb_x + tb_w - 18
    sym_y = tb_bottom - row_h / 2
    p.append(_render_3rd_angle_symbol(sym_x, sym_y, size=8))

    # Bounding box info (small text under sheet size)
    bbox_x = col_div_x + 2
    bbox_y = tb_y + 3 * row_h + 3.5
    p.append(f'<text x="{bbox_x:.1f}" y="{bbox_y:.1f}" font-family="monospace" '
             f'font-size="1.8" fill="#999">'
             f'BBox: {bbox.XLength:.0f} x {bbox.YLength:.0f} x {bbox.ZLength:.0f} mm</text>')

    # ── Left Zone: Line Legend + BOM ──────────────────────────────────────
    lz_w = rz_x - tb_x

    # Line legend (bottom of left zone)
    leg_y = tb_bottom - 5
    leg_x = tb_x + 4
    for label, color, w, dash in [("Visible", "#000", "0.7", None),
                                   ("Hidden", "#000", "0.30", "4,2"),
                                   ("Center", "#000", "0.18", "8,2,1.5,2"),
                                   ("Dimension", "#000", "0.18", None)]:
        la = f'stroke="{color}" stroke-width="{w}" stroke-linecap="{LINE_CAP}"'
        if dash:
            la += f' stroke-dasharray="{dash}"'
        p.append(f'<line x1="{leg_x}" y1="{leg_y}" x2="{leg_x+10}" '
                 f'y2="{leg_y}" {la}/>')
        p.append(f'<text x="{leg_x+12}" y="{leg_y+0.8}" font-family="monospace" '
                 f'font-size="2" fill="#666">{label}</text>')
        leg_x += 32

    # BOM table (top of left zone)
    if bom:
        bx = tb_x + 3
        by = tb_y + 2
        rh = 4.2
        # BOM header
        p.append(f'<text x="{bx}" y="{by+3.5}" font-family="sans-serif" '
                 f'font-size="2.5" font-weight="bold" fill="#333">BILL OF MATERIALS</text>')
        # Column headers
        hy = by + 7
        p.append(f'<line x1="{bx}" y1="{hy+1}" x2="{rz_x-3}" y2="{hy+1}" '
                 f'stroke="#ccc" stroke-width="0.2"/>')
        p.append(f'<text x="{bx}" y="{hy}" font-family="monospace" '
                 f'font-size="2" fill="#888" letter-spacing="0.2">'
                 f'{"#":<3}  {"PART":<18} {"MATERIAL":<10} {"QTY":<3}</text>')
        max_rows = min(len(bom), 5)
        for i in range(max_rows):
            item = bom[i]
            ry = hy + (i + 1) * rh
            p.append(f'<text x="{bx}" y="{ry}" font-family="monospace" '
                     f'font-size="2.2">'
                     f'{i+1:<3}  {_escape(item.get("id","?")):<18} '
                     f'{_escape(item.get("material","-")):<10} '
                     f'{item.get("count",1):<3}</text>')
        if len(bom) > 5:
            ry = hy + (max_rows + 1) * rh
            p.append(f'<text x="{bx}" y="{ry}" font-family="monospace" '
                     f'font-size="2" fill="#999">... +{len(bom)-5} more items</text>')

    # GD&T symbols
    if mates:
        try:
            from _gdt_symbols import generate_gdt_for_mates
            fcx, fcy = VIEW_CELLS["front"]
            gx = fcx + CELL_W / 2 - 35
            gy = fcy - CELL_H / 2 + 20
            frags = generate_gdt_for_mates(
                mates, tolerance_specs=tol_specs or {},
                start_x=gx, start_y=gy, spacing=12)
            if frags:
                p.append('<!-- GD&T -->')
                p.extend(frags)
        except Exception:
            pass

    p.append('</svg>')
    return '\n'.join(p)


# -- Helpers -------------------------------------------------------------------

def make_section(shape, plane="XZ", offset=0.0):
    """Cut shape with a plane and return the cross-section wire/face.

    Args:
        shape: Part.Shape to section
        plane: "XZ" (front section) or "YZ" (side section) or "XY" (top section)
        offset: offset along the normal direction (mm)

    Returns: (section_shape, view_direction, label) or None
    """
    import Part
    from FreeCAD import Vector

    bbox = shape.BoundBox
    plane_map = {
        "XZ": (Vector(0, 1, 0), Vector(0, offset or bbox.Center.y, 0), (0, -1, 0), "A-A"),
        "YZ": (Vector(1, 0, 0), Vector(offset or bbox.Center.x, 0, 0), (1, 0, 0), "B-B"),
        "XY": (Vector(0, 0, 1), Vector(0, 0, offset or bbox.Center.z), (0, 0, -1), "C-C"),
    }

    if plane not in plane_map:
        return None

    normal, base_pt, view_dir, label = plane_map[plane]

    try:
        d = base_pt.dot(normal)

        # Try slice on individual solids (filleted shapes may fail as compound)
        all_wires = []
        targets = shape.Solids if hasattr(shape, 'Solids') and shape.Solids else [shape]
        for solid in targets:
            try:
                wires = solid.slice(normal, d)
                if wires:
                    all_wires.extend(wires)
            except Exception:
                # Fallback: use section with a plane face
                try:
                    half = max(bbox.DiagonalLength, 500)
                    plane_face = Part.makePlane(half * 2, half * 2, base_pt, normal)
                    sec = solid.section(plane_face)
                    if sec and sec.Edges:
                        all_wires.append(sec)
                except Exception:
                    pass

        if not all_wires:
            return None
        section_compound = Part.Compound(all_wires)
        return (section_compound, view_dir, label)
    except Exception as exc:
        log(f"  Section: exception: {exc}")
        return None


def _chain_to_closed_paths(segments, tol=0.5):
    """Chain edge segments into closed SVG path strings.

    segments: list of [(x,y), ...] in page coordinates
    Returns: list of closed SVG path data strings (ending with 'Z')
    """
    if not segments:
        return []

    n = len(segments)
    used = [False] * n
    paths = []

    for start in range(n):
        if used[start]:
            continue
        used[start] = True
        chain = list(segments[start])

        for _ in range(n):
            tail = chain[-1]
            head = chain[0]

            # Check if chain is closed
            if len(chain) > 3 and math.hypot(tail[0]-head[0], tail[1]-head[1]) < tol:
                break

            # Find next segment to append
            found = False
            for j in range(n):
                if used[j]:
                    continue
                seg = segments[j]
                s0, s1 = seg[0], seg[-1]

                if math.hypot(tail[0]-s0[0], tail[1]-s0[1]) < tol:
                    chain.extend(seg[1:])
                    used[j] = True
                    found = True
                    break
                elif math.hypot(tail[0]-s1[0], tail[1]-s1[1]) < tol:
                    chain.extend(list(reversed(seg))[1:])
                    used[j] = True
                    found = True
                    break

            if not found:
                break

        if len(chain) >= 3:
            d = f'M{chain[0][0]:.2f},{chain[0][1]:.2f}'
            for x, y in chain[1:]:
                d += f'L{x:.2f},{y:.2f}'
            d += 'Z'
            paths.append(d)

    return paths


def render_section_svg(label, groups, bounds, circles, cx, cy, scale, shape_bounds):
    """Render section view with hatching and section label.

    Like render_view_svg but adds:
    - 45-degree hatching fill clipped to the actual cross-section boundary
    - Section label (e.g., "SECTION A-A")
    """
    out = []
    u0, v0, u1, v1 = bounds
    bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

    def pg(u, v):
        return cx + (u - bcx) * scale, cy - (v - bcy) * scale

    # Collect page-coordinate segments for clip-path while rendering edges
    clip_segments = []

    # Render edges (visible only — sections show cut face outline)
    for gi in [0, 2, 5]:  # visible groups only
        if gi not in groups:
            continue
        w, color, dash = LINE_STYLES[gi]
        attr = (f'stroke="{color}" stroke-width="{w}" fill="none" '
                f'stroke-linecap="{LINE_CAP}" stroke-linejoin="{LINE_JOIN}"')
        gn = EDGE_NAMES[gi] if gi < len(EDGE_NAMES) else f"g{gi}"
        out.append(f'<g class="section-{gn}" {attr}>')

        for e in groups[gi]:
            if "circ" in e:
                cu, cv, r = e["circ"]
                px, py = pg(cu, cv)
                out.append(f'  <circle cx="{px:.2f}" cy="{py:.2f}" r="{r*scale:.2f}"/>')
                # Approximate circle as polygon for clipping
                rs = r * scale
                seg = [(px + rs * math.cos(2 * math.pi * a / 32),
                        py + rs * math.sin(2 * math.pi * a / 32))
                       for a in range(32)]
                clip_segments.append(seg)
            else:
                pts = e["pts"]
                if len(pts) < 2:
                    continue
                pp = [pg(u, v) for u, v in pts]
                d = f'M{pp[0][0]:.2f},{pp[0][1]:.2f}'
                for x, y in pp[1:]:
                    d += f'L{x:.2f},{y:.2f}'
                out.append(f'  <path d="{d}"/>')
                clip_segments.append(pp)

        out.append('</g>')

    # Hatching: chain edges into closed paths, then clip hatch to section boundary
    closed_paths = _chain_to_closed_paths(clip_segments)
    hw = (u1 - u0) * scale + 10
    hh = (v1 - v0) * scale + 10
    hx = cx - hw / 2
    hy = cy - hh / 2

    if closed_paths and hw > 0 and hh > 0:
        clip_id = f'sec-clip-{label.replace("-", "").lower()}'
        out.append(f'<defs><clipPath id="{clip_id}">')
        out.append(f'  <path d="{" ".join(closed_paths)}" clip-rule="evenodd"/>')
        out.append(f'</clipPath></defs>')
        out.append(f'<rect x="{hx:.2f}" y="{hy:.2f}" width="{hw:.2f}" height="{hh:.2f}" '
                   f'fill="url(#hatch45)" stroke="none" opacity="0.4" '
                   f'clip-path="url(#{clip_id})"/>')
    elif hw > 0 and hh > 0:
        # Fallback: bounding rect (if chaining fails)
        out.append(f'<rect x="{hx:.2f}" y="{hy:.2f}" width="{hw:.2f}" height="{hh:.2f}" '
                   f'fill="url(#hatch45)" stroke="none" opacity="0.4"/>')

    # Section label
    lx = cx
    ly = cy - CELL_H / 2 + 8
    out.append(f'<text x="{lx:.1f}" y="{ly:.1f}" font-family="sans-serif" '
               f'font-size="4" font-weight="bold" text-anchor="middle" '
               f'fill="#333">SECTION {label}</text>')

    return '\n'.join(out)


# -- Detail View (ISO enlarged view) ------------------------------------------

def render_detail_svg(label, groups, circles, arcs,
                      detail_center, detail_radius,
                      cx, cy, main_scale, scale_factor,
                      show_hidden=True):
    """Render enlarged detail view within a circular clip boundary.

    Filters edges from the source view that fall within the detail region,
    then renders them at enlarged scale inside a circular clip-path.

    Args:
        label: detail label letter (e.g., "Z")
        groups/circles/arcs: projected edge data from source view
        detail_center: (u, v) center in projected model coordinates
        detail_radius: capture radius in model units
        cx, cy: page center for the detail cell
        main_scale: main drawing scale
        scale_factor: enlargement factor relative to main scale
    """
    out = []
    du, dv = detail_center
    dr = detail_radius
    detail_scale = main_scale * scale_factor

    # Clip radius on page (80% of cell to leave room for label)
    clip_r = min(dr * detail_scale, min(CELL_W, CELL_H) * 0.40)

    # Filter edges within detail region (with 30% margin for partial edges)
    capture_r2 = (dr * 1.3) ** 2

    def in_region(u, v):
        return (u - du) ** 2 + (v - dv) ** 2 <= capture_r2

    filtered_groups = {}
    for gi, edges in groups.items():
        if not show_hidden and gi in {1, 3, 6, 9}:
            continue
        filtered = []
        for e in edges:
            if "circ" in e:
                cu, cv, _r = e["circ"]
                if in_region(cu, cv):
                    filtered.append(e)
            else:
                if any(in_region(u, v) for u, v in e["pts"]):
                    filtered.append(e)
        if filtered:
            filtered_groups[gi] = filtered

    if not filtered_groups:
        return ""

    # Circular clip-path
    clip_id = f"detail-clip-{label.lower()}"
    out.append(f'<defs><clipPath id="{clip_id}">')
    out.append(f'  <circle cx="{cx:.2f}" cy="{cy:.2f}" r="{clip_r:.2f}"/>')
    out.append(f'</clipPath></defs>')

    # Coordinate transform: model (u,v) → page (px,py) centered on detail
    def pg(u, v):
        return cx + (u - du) * detail_scale, cy - (v - dv) * detail_scale

    out.append(f'<g clip-path="url(#{clip_id})">')

    for gi in RENDER_ORDER:
        if gi not in filtered_groups:
            continue
        w, color, dash = LINE_STYLES[gi]
        attr = (f'stroke="{color}" stroke-width="{w}" fill="none" '
                f'stroke-linecap="{LINE_CAP}" stroke-linejoin="{LINE_JOIN}"')
        if dash:
            attr += f' stroke-dasharray="{dash}"'
        gn = EDGE_NAMES[gi] if gi < len(EDGE_NAMES) else f"g{gi}"
        out.append(f'<g class="detail-{gn}" {attr}>')

        for e in filtered_groups[gi]:
            if "circ" in e:
                cu, cv, r = e["circ"]
                px, py = pg(cu, cv)
                out.append(f'  <circle cx="{px:.2f}" cy="{py:.2f}" '
                           f'r="{r * detail_scale:.2f}"/>')
            else:
                pts = e["pts"]
                if len(pts) < 2:
                    continue
                pp = [pg(u, v) for u, v in pts]
                d = f'M{pp[0][0]:.2f},{pp[0][1]:.2f}'
                for x, y in pp[1:]:
                    d += f'L{x:.2f},{y:.2f}'
                out.append(f'  <path d="{d}"/>')

        out.append('</g>')

    out.append('</g>')

    # Circle border (thick)
    out.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{clip_r:.2f}" '
               f'fill="none" stroke="#000" stroke-width="0.5"/>')

    # Label: "DETAIL Z (3:1)"
    sl = f"{scale_factor}:1" if scale_factor >= 1 else f"1:{round(1/scale_factor)}"
    lx = cx
    ly = cy + clip_r + 6
    out.append(f'<text x="{lx:.1f}" y="{ly:.1f}" font-family="sans-serif" '
               f'font-size="4" font-weight="bold" text-anchor="middle" '
               f'fill="#333">DETAIL {label} ({sl})</text>')

    return '\n'.join(out)


def render_detail_indicator_svg(detail_center, detail_radius, label,
                                parent_bounds, parent_cx, parent_cy, scale):
    """Draw detail circle indicator + leader on the parent view."""
    out = []
    u0, v0, u1, v1 = parent_bounds
    bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

    du, dv = detail_center
    px = parent_cx + (du - bcx) * scale
    py = parent_cy - (dv - bcy) * scale
    pr = detail_radius * scale

    out.append('<g class="detail-indicator">')
    # Thin dashed circle on parent view
    out.append(f'  <circle cx="{px:.2f}" cy="{py:.2f}" r="{pr:.2f}" '
               f'fill="none" stroke="#000" stroke-width="0.35" '
               f'stroke-dasharray="4,2"/>')
    # Leader line (45 degrees from circle to label)
    lx = px + pr * 0.707 + 5
    ly = py - pr * 0.707 - 5
    out.append(f'  <line x1="{px + pr * 0.707:.2f}" y1="{py - pr * 0.707:.2f}" '
               f'x2="{lx:.2f}" y2="{ly:.2f}" '
               f'stroke="#000" stroke-width="0.3"/>')
    # Label letter
    out.append(f'  <text x="{lx + 1:.2f}" y="{ly:.2f}" '
               f'font-family="sans-serif" font-size="3.5" '
               f'font-weight="bold" fill="#000">{label}</text>')
    out.append('</g>')

    return '\n'.join(out)


# -- Balloon Numbers (Assembly BOM) -------------------------------------------

BALLOON_R = 3.0            # balloon circle radius (mm on page)
BALLOON_LEADER_LEN = 18.0  # leader line length (mm on page)


def _project_point_to_view(pos_3d, view_name):
    """Project a 3D point to (u, v) in the given orthographic view."""
    x, y, z = pos_3d
    if view_name == "front":
        return (x, z)
    elif view_name == "top":
        return (x, y)
    elif view_name == "right":
        return (-y, z)
    return (x, z)


def render_balloons_svg(bom, assembly_parts, parts_metadata,
                        view_bounds, view_cx, view_cy, scale,
                        view_name="front"):
    """Render BOM item balloons (circle + number + leader) on assembly view.

    Each BOM item gets a filled dot at its projected location, a leader line,
    and a numbered circle (balloon) offset at a staggered angle.
    """
    if not bom or not assembly_parts:
        return ""

    out = []
    u0, v0, u1, v1 = view_bounds
    bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

    def pg(u, v):
        return view_cx + (u - bcx) * scale, view_cy - (v - bcy) * scale

    # Build 3D center for each part (assembly_position + local_bbox_center)
    part_centers = {}
    for ap in assembly_parts:
        ref = ap["ref"]
        pos = ap.get("position", [0, 0, 0])
        meta = parts_metadata.get(ref)
        if meta and "bounding_box" in meta:
            bb = meta["bounding_box"]
            lc = [(bb["min"][j] + bb["max"][j]) / 2 for j in range(3)]
        else:
            lc = [0, 0, 0]
        part_centers[ref] = [pos[j] + lc[j] for j in range(3)]

    out.append('<g class="balloons">')

    n = len(bom)
    angle_step = 360 / max(n, 1)

    for i, item in enumerate(bom):
        ref = item["id"]
        if ref not in part_centers:
            continue

        center_3d = part_centers[ref]
        u, v = _project_point_to_view(center_3d, view_name)
        px, py = pg(u, v)

        # Balloon offset angle (staggered around the part)
        angle = math.radians(30 + i * angle_step)
        bx = px + BALLOON_LEADER_LEN * math.cos(angle)
        by = py - BALLOON_LEADER_LEN * math.sin(angle)

        # Leader line
        out.append(f'  <line x1="{px:.2f}" y1="{py:.2f}" '
                   f'x2="{bx:.2f}" y2="{by:.2f}" '
                   f'stroke="#000" stroke-width="0.3" fill="none"/>')
        # Dot at part location
        out.append(f'  <circle cx="{px:.2f}" cy="{py:.2f}" r="0.8" fill="#000"/>')
        # Balloon circle (white fill)
        out.append(f'  <circle cx="{bx:.2f}" cy="{by:.2f}" r="{BALLOON_R}" '
                   f'stroke="#000" stroke-width="0.35" fill="white"/>')
        # Item number
        out.append(f'  <text x="{bx:.2f}" y="{by + 1.2:.2f}" text-anchor="middle" '
                   f'font-family="sans-serif" font-size="3.5" '
                   f'font-weight="bold" fill="#000">{i + 1}</text>')

    out.append('</g>')
    return '\n'.join(out)


# -- Section Cutting Line (ISO 128) -------------------------------------------

# Section plane → parent view for cutting line display
SECTION_PARENT_MAP = {
    "XZ": "top",     # XZ section: cutting line on top view (horizontal)
    "YZ": "front",   # YZ section: cutting line on front view (vertical)
    "XY": "front",   # XY section: cutting line on front view (horizontal)
}


def render_cutting_line_svg(sec_plane, sec_offset, sec_label,
                            parent_bounds, parent_cx, parent_cy,
                            scale, shape_bbox):
    """Render ISO 128 section cutting line on parent view.

    Draws a chain-thick line across the parent view at the section offset,
    with perpendicular arrows and label letters (A, B, ...) at both ends.
    """
    out = []
    u0, v0, u1, v1 = parent_bounds
    bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

    def pg(u, v):
        return parent_cx + (u - bcx) * scale, parent_cy - (v - bcy) * scale

    overshoot = 3.0 / scale  # extend beyond shape bounds (model coords)

    if sec_plane == "XZ":
        # TOP view: horizontal line at v = y_cut
        cut_pos = sec_offset or shape_bbox.Center.y
        start = pg(u0 - overshoot, cut_pos)
        end = pg(u1 + overshoot, cut_pos)
        arr_angle = math.pi / 2   # arrows point downward (toward front view)
    elif sec_plane == "YZ":
        # FRONT view: vertical line at u = x_cut
        cut_pos = sec_offset or shape_bbox.Center.x
        start = pg(cut_pos, v0 - overshoot)
        end = pg(cut_pos, v1 + overshoot)
        arr_angle = 0              # arrows point rightward
    elif sec_plane == "XY":
        # FRONT view: horizontal line at v = z_cut
        cut_pos = sec_offset or shape_bbox.Center.z
        start = pg(u0 - overshoot, cut_pos)
        end = pg(u1 + overshoot, cut_pos)
        arr_angle = math.pi / 2
    else:
        return ""

    letter = sec_label.split("-")[0] if sec_label else "A"
    sx, sy = start
    ex, ey = end

    # Line direction (normalized)
    dx, dy = ex - sx, ey - sy
    ln = math.hypot(dx, dy)
    if ln < 1:
        return ""
    ndx, ndy = dx / ln, dy / ln

    out.append('<g class="cutting-line">')

    # Main chain-thick line (ISO 128 type G: long-dash-dot)
    out.append(f'  <line x1="{sx:.2f}" y1="{sy:.2f}" '
               f'x2="{ex:.2f}" y2="{ey:.2f}" '
               f'stroke="#000" stroke-width="0.5" '
               f'stroke-dasharray="12,3,2,3" '
               f'stroke-linecap="{LINE_CAP}" fill="none"/>')

    # Thick solid end segments (overwrite chain pattern at line ends)
    end_len = min(4.0, ln * 0.15)
    out.append(f'  <line x1="{sx:.2f}" y1="{sy:.2f}" '
               f'x2="{sx + ndx * end_len:.2f}" y2="{sy + ndy * end_len:.2f}" '
               f'stroke="#000" stroke-width="0.7" fill="none"/>')
    out.append(f'  <line x1="{ex:.2f}" y1="{ey:.2f}" '
               f'x2="{ex - ndx * end_len:.2f}" y2="{ey - ndy * end_len:.2f}" '
               f'stroke="#000" stroke-width="0.7" fill="none"/>')

    # Arrows and labels at both endpoints
    arr_dx = math.cos(arr_angle)
    arr_dy = math.sin(arr_angle)
    arr_len = 5.0
    for px, py in [(sx, sy), (ex, ey)]:
        # Arrow shaft (perpendicular to cutting line)
        ax = px + arr_dx * arr_len
        ay = py + arr_dy * arr_len
        out.append(f'  <line x1="{px:.2f}" y1="{py:.2f}" '
                   f'x2="{ax:.2f}" y2="{ay:.2f}" '
                   f'stroke="#000" stroke-width="0.5" fill="none"/>')
        # Arrowhead at tip
        out.append('  ' + _arrow_head(ax, ay, arr_angle))
        # Label letter beyond arrow
        label_gap = 3.5
        lx = ax + arr_dx * label_gap
        ly = ay + arr_dy * label_gap
        if abs(arr_dy) > 0.5:
            ly += 2.0   # baseline shift for vertical arrows
        else:
            ly += 1.5   # baseline shift for horizontal arrows
        out.append(f'  <text x="{lx:.2f}" y="{ly:.2f}" '
                   f'text-anchor="middle" font-family="sans-serif" '
                   f'font-size="5" font-weight="bold" fill="#000">'
                   f'{letter}</text>')

    out.append('</g>')
    return '\n'.join(out)


def tight_bbox(shape):
    """Compute tight bounding box from actual vertices.
    FreeCAD's BoundBox can be wildly wrong after edge-by-edge fillet."""
    import FreeCAD as _FC
    verts = shape.Vertexes
    if not verts:
        return shape.BoundBox
    xs = [v.Point.x for v in verts]
    ys = [v.Point.y for v in verts]
    zs = [v.Point.z for v in verts]
    return _FC.BoundBox(min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))


def auto_scale(bbox, cell_w, cell_h):
    """Compute scale factor to fit shape in a view cell."""
    max_dim = max(bbox.XLength, bbox.YLength, bbox.ZLength, 1e-6)
    return min(cell_w, cell_h) * 0.85 / max_dim


def nice_scale(raw):
    """Round to nearest standard engineering scale."""
    standards = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]
    return min(standards, key=lambda s: abs(s - raw))


def extract_bom(config, parts_metadata):
    """Extract BOM from config parts + assembly joints."""
    bom = []
    parts_config = {p["id"]: p for p in config.get("parts", [])}
    assembly = config.get("assembly", {})
    joints_by_part = {}
    for j in assembly.get("joints", []):
        joints_by_part[j.get("part", "")] = {
            "id": j.get("id"), "type": j.get("type"), "axis": j.get("axis"),
        }
    for entry in assembly.get("parts", []):
        ref = entry["ref"]
        pc = parts_config.get(ref, {})
        shapes = pc.get("shapes", [])
        material = shapes[0].get("material", "-") if shapes else "-"
        dims = "-"
        meta = parts_metadata.get(entry.get("label", ref)) or parts_metadata.get(ref)
        if meta and "bounding_box" in meta:
            s = meta["bounding_box"].get("size", [0, 0, 0])
            dims = f"{s[0]:.0f}x{s[1]:.0f}x{s[2]:.0f}"
        item = {"id": ref, "material": material, "dimensions": dims, "count": 1}
        joint = joints_by_part.get(ref)
        if joint:
            item["joint"] = joint
        bom.append(item)
    return bom


def _escape(text):
    """Escape XML special characters."""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# -- Main Pipeline -------------------------------------------------------------

try:
    config = read_input()
    model_name = config.get("name", "unnamed")
    drawing_cfg = config.get("drawing", {})
    views_requested = drawing_cfg.get("views", ["front", "top", "right", "iso"])
    scale_hint = drawing_cfg.get("scale")

    log(f"Generating drawing: {model_name}")

    FreeCAD = init_freecad()
    import Part

    # -- Build 3D Model --
    is_assembly = "parts" in config and "assembly" in config

    if is_assembly:
        from _assembly import build_assembly
        doc = FreeCAD.newDocument("DrawingAssembly")
        result = build_assembly(config, doc)
        compound = result["compound"]
        parts_metadata = result["parts_metadata"]
        log(f"  Assembly: {len(result['features'])} parts")
    else:
        from _shapes import (make_shape, boolean_op, apply_fillet,
                             apply_chamfer, apply_shell, circular_pattern,
                             get_metadata)
        doc = FreeCAD.newDocument("DrawingSingle")
        shapes = {}
        for spec in config.get("shapes", []):
            shapes[spec["id"]] = make_shape(spec)
        for op_spec in config.get("operations", []):
            op = op_spec["op"]
            if op in ("fuse", "cut", "common"):
                base = shapes[op_spec["base"]]
                tool_ref = op_spec["tool"]
                tool = (shapes[tool_ref] if isinstance(tool_ref, str)
                        else make_shape(tool_ref))
                shapes[op_spec.get("result", op_spec["base"])] = \
                    boolean_op(op, base, tool)
            elif op == "fillet":
                shapes[op_spec.get("result", op_spec["target"])] = apply_fillet(
                    shapes[op_spec["target"]], op_spec["radius"],
                    op_spec.get("edges"))
            elif op == "chamfer":
                shapes[op_spec.get("result", op_spec["target"])] = apply_chamfer(
                    shapes[op_spec["target"]], op_spec["size"],
                    op_spec.get("edges"))
            elif op == "shell":
                shapes[op_spec.get("result", op_spec["target"])] = apply_shell(
                    shapes[op_spec["target"]], op_spec["thickness"],
                    op_spec.get("faces"))
        final_name = config.get("final", list(shapes.keys())[-1])
        compound = shapes[final_name]
        parts_metadata = {final_name: get_metadata(compound)}
        log(f"  Single part: {final_name}")

    # -- Compute Scale --
    bbox = tight_bbox(compound)
    log(f"  BBox: {bbox.XLength:.1f} x {bbox.YLength:.1f} x {bbox.ZLength:.1f} mm")

    if scale_hint:
        if ":" in str(scale_hint):
            num, den = str(scale_hint).split(":")
            scale = float(num) / float(den)
        else:
            scale = float(scale_hint)
    else:
        raw = auto_scale(bbox, CELL_W, CELL_H)
        scale = nice_scale(raw)

    log(f"  Scale: {scale}")

    # -- Project Views --
    views_svg = {}
    view_data = {}  # bounds/cx/cy per view for cutting line rendering
    for vname in views_requested:
        if vname not in VIEW_DIRECTIONS:
            log(f"  Skipping unknown view: {vname}")
            continue

        groups, bounds, circles, arcs = project_view(
            compound, VIEW_DIRECTIONS[vname], vname)

        if not groups:
            # Fallback: project individual solids
            if hasattr(compound, 'Solids') and compound.Solids:
                log(f"  View '{vname}': empty compound, trying per-solid")
                all_groups, all_circles, all_arcs = {}, [], []
                all_bounds = [1e9, 1e9, -1e9, -1e9]
                for solid in compound.Solids:
                    sg, sb, sc, sa = project_view(
                        solid, VIEW_DIRECTIONS[vname], vname)
                    for gi, edges in sg.items():
                        all_groups.setdefault(gi, []).extend(edges)
                    all_circles.extend(sc)
                    all_arcs.extend(sa)
                    all_bounds[0] = min(all_bounds[0], sb[0])
                    all_bounds[1] = min(all_bounds[1], sb[1])
                    all_bounds[2] = max(all_bounds[2], sb[2])
                    all_bounds[3] = max(all_bounds[3], sb[3])
                if all_groups:
                    groups = all_groups
                    bounds = tuple(all_bounds)
                    circles = all_circles
                    arcs = all_arcs

        if not groups:
            log(f"  View '{vname}': no edges projected")
            continue

        cx, cy = VIEW_CELLS.get(vname, VIEW_CELLS["front"])
        view_data[vname] = {"bounds": bounds, "cx": cx, "cy": cy,
                           "groups": groups, "circles": circles, "arcs": arcs}
        n_edges = sum(len(v) for v in groups.values())
        log(f"  View '{vname}': {n_edges} edges")

        show_hidden = drawing_cfg.get("style", {}).get("show_hidden", True)
        show_cl = drawing_cfg.get("style", {}).get("show_centerlines", True)
        show_dims = drawing_cfg.get("style", {}).get("show_dimensions", True)
        svg = render_view_svg(vname, groups, bounds, circles, cx, cy, scale,
                              show_hidden=show_hidden, show_centerlines=show_cl)
        # Append dimension lines (front/top/right only)
        tol_cfg = drawing_cfg.get("tolerances", {})
        if show_dims and vname != "iso":
            dim_svg = render_dimensions_svg(vname, bounds, circles, cx, cy, scale,
                                           arcs=arcs, tolerances=tol_cfg)
            if dim_svg:
                svg += '\n' + dim_svg
            datum_svg = render_datums_svg(vname, bounds, cx, cy, scale)
            if datum_svg:
                svg += '\n' + datum_svg
        views_svg[vname] = svg

    if not views_svg:
        respond_error("No views could be projected. Shape may be empty.")

    # -- Section View (optional) --
    section_cfg = drawing_cfg.get("section")
    if section_cfg:
        sec_plane = section_cfg.get("plane", "XZ")
        sec_offset = section_cfg.get("offset", 0.0)
        sec_result = make_section(compound, sec_plane, sec_offset)
        if sec_result:
            sec_shape, sec_dir, sec_label = sec_result
            sec_groups, sec_bounds, sec_circles, _sec_arcs = project_view(
                sec_shape, sec_dir, "front")
            if sec_groups:
                # Place section in ISO cell (top-right), replacing ISO if present
                sec_cx, sec_cy = VIEW_CELLS.get("iso", VIEW_CELLS["right"])
                sec_svg = render_section_svg(
                    sec_label, sec_groups, sec_bounds, sec_circles,
                    sec_cx, sec_cy, scale, bounds if 'bounds' in dir() else None)
                views_svg["section"] = sec_svg
                if "iso" in views_svg:
                    del views_svg["iso"]
                # Render cutting line on parent view
                parent_vn = SECTION_PARENT_MAP.get(sec_plane)
                if parent_vn and parent_vn in view_data and parent_vn in views_svg:
                    vd = view_data[parent_vn]
                    cut_svg = render_cutting_line_svg(
                        sec_plane, sec_offset, sec_label,
                        vd["bounds"], vd["cx"], vd["cy"],
                        scale, bbox)
                    if cut_svg:
                        views_svg[parent_vn] += '\n' + cut_svg
                log(f"  Section '{sec_label}': {sum(len(v) for v in sec_groups.values())} edges")
            else:
                log(f"  Section '{sec_label}': no edges (empty cross-section)")
        else:
            log(f"  Section: failed to create section on plane {sec_plane}")

    # -- Detail View (optional, ISO cell when no section) --
    detail_cfg = drawing_cfg.get("detail")
    if detail_cfg and "section" not in views_svg:
        source_vn = detail_cfg.get("source_view", "front")
        if source_vn in view_data:
            vd = view_data[source_vn]
            det_center = detail_cfg.get("center", [0, 0])
            det_radius = detail_cfg.get("radius", 10)
            det_sf = detail_cfg.get("scale_factor", 3)
            det_label = detail_cfg.get("label", "Z")

            det_cx, det_cy = VIEW_CELLS.get("iso", VIEW_CELLS["right"])
            det_svg = render_detail_svg(
                det_label, vd["groups"], vd["circles"], vd.get("arcs", []),
                det_center, det_radius,
                det_cx, det_cy, scale, det_sf,
                show_hidden=drawing_cfg.get("style", {}).get("show_hidden", True))
            if det_svg:
                views_svg["detail"] = det_svg
                if "iso" in views_svg:
                    del views_svg["iso"]
                # Add indicator circle on parent view
                ind_svg = render_detail_indicator_svg(
                    det_center, det_radius, det_label,
                    vd["bounds"], vd["cx"], vd["cy"], scale)
                if ind_svg and source_vn in views_svg:
                    views_svg[source_vn] += '\n' + ind_svg
                log(f"  Detail '{det_label}': scale {det_sf}x in {source_vn} view")

    # -- Extract BOM --
    bom = extract_bom(config, parts_metadata) if is_assembly else []

    # -- Balloon Numbers (assembly only) --
    if is_assembly and bom and "front" in view_data and "front" in views_svg:
        assembly_parts = config.get("assembly", {}).get("parts", [])
        vd = view_data["front"]
        balloon_svg = render_balloons_svg(
            bom, assembly_parts, parts_metadata,
            vd["bounds"], vd["cx"], vd["cy"], scale,
            view_name="front")
        if balloon_svg:
            views_svg["front"] += '\n' + balloon_svg
            log(f"  Balloons: {len(bom)} items on front view")

    # -- Compose Drawing --
    mates = (config.get("assembly", {}).get("mates", [])
             if is_assembly else [])
    tol_specs = config.get("tolerance", {}).get("specs", {})
    drawing_meta = drawing_cfg.get("meta", {})
    drawing_style = drawing_cfg.get("style", {})
    svg_content = compose_drawing(
        views_svg, model_name, bom, scale, bbox,
        mates=mates, tol_specs=tol_specs,
        meta=drawing_meta, style_cfg=drawing_style)

    # -- Save SVG --
    export_dir = config.get("export", {}).get("directory", ".")
    os.makedirs(export_dir, exist_ok=True)
    svg_path = os.path.join(export_dir, f"{model_name}_drawing.svg")
    with open(svg_path, 'w', encoding='utf-8') as f:
        f.write(svg_content)
    svg_size = os.path.getsize(svg_path)
    log(f"  SVG: {svg_path} ({svg_size} bytes)")

    # -- DXF Output (optional) --
    dxf_path = None
    if drawing_cfg.get("dxf"):
        try:
            import TechDraw
            from FreeCAD import Vector
            dxf_str = TechDraw.projectToDXF(compound, Vector(0, -1, 0))
            dxf_path = os.path.join(export_dir, f"{model_name}_front.dxf")
            with open(dxf_path, 'w', encoding='utf-8') as f:
                f.write(dxf_str)
            log(f"  DXF: {dxf_path}")
        except Exception as e:
            log(f"  DXF failed: {e}")

    # -- BOM CSV (optional) --
    bom_csv_path = None
    if drawing_cfg.get("bom_csv") and bom:
        bom_csv_path = os.path.join(export_dir, f"{model_name}_bom.csv")
        with open(bom_csv_path, 'w', encoding='utf-8') as f:
            f.write("Item,Part ID,Material,Dimensions,Count,Joint Type,Joint ID\n")
            for i, item in enumerate(bom):
                joint = item.get("joint", {})
                f.write(f"{i+1},{item['id']},{item.get('material','-')},"
                        f"{item.get('dimensions','-')},{item.get('count',1)},"
                        f"{joint.get('type','')},{joint.get('id','')}\n")
        log(f"  BOM CSV: {bom_csv_path}")

    # -- Response --
    scale_label = f"1:{round(1/scale)}" if scale < 1 else f"{round(scale)}:1"
    response = {
        "success": True,
        "drawing_paths": [
            {"format": "svg", "path": svg_path, "size_bytes": svg_size},
        ],
        "bom": bom,
        "views": list(views_svg.keys()),
        "scale": scale_label,
    }
    if dxf_path:
        response["drawing_paths"].append({
            "format": "dxf", "path": dxf_path,
            "size_bytes": os.path.getsize(dxf_path),
        })
    if bom_csv_path:
        response["drawing_paths"].append({
            "format": "csv", "path": bom_csv_path,
            "size_bytes": os.path.getsize(bom_csv_path),
        })

    respond(response)

except Exception as e:
    import traceback
    respond_error(str(e), traceback.format_exc())
