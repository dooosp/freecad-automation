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
    Returns: (groups, bounds, circles)
      groups: {group_idx: [{"pts": [(u,v),...], "circ": (cu,cv,r)|None}, ...]}
      bounds: (u_min, v_min, u_max, v_max)
      circles: [(u, v, radius), ...]  — full circles with center and radius
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

            if ctype in ('Line', 'LineSegment'):
                pts = [edge.Vertexes[0].Point, edge.Vertexes[1].Point]
            elif ctype == 'Circle':
                center = edge.Curve.Center
                radius = edge.Curve.Radius
                is_circ = abs(edge.LastParameter - edge.FirstParameter - 2 * math.pi) < 0.01
                pts = list(edge.discretize(30))
            else:
                try:
                    pts = list(edge.discretize(30))
                except Exception:
                    continue

            if pts:
                all_pts.extend(pts)
                raw.append((gi, pts, center, is_circ, radius))

    if not raw:
        return {}, (0, 0, 1, 1), []

    # Determine 2D extraction
    ext = _extract_fn(view_name, all_pts)

    # Pass 2: convert to 2D
    groups = {}
    all_2d = []
    circles = []

    for gi, pts_3d, center_3d, is_circ, radius in raw:
        pts_2d = [ext(p) for p in pts_3d]
        all_2d.extend(pts_2d)
        entry = {"pts": pts_2d}
        if is_circ and center_3d:
            c = ext(center_3d)
            entry["circ"] = (c[0], c[1], radius)
            circles.append((c[0], c[1], radius))
        groups.setdefault(gi, []).append(entry)

    us, vs = zip(*all_2d)
    bounds = (min(us), min(vs), max(us), max(vs))
    return groups, bounds, circles


# -- SVG Rendering -------------------------------------------------------------

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

    # Symmetry axis center lines (if view bounds suggest symmetric shape)
    bw = (u1 - u0) * scale
    bh = (v1 - v0) * scale
    sym_margin = min(CELL_W, CELL_H) * 0.04  # extend beyond shape
    if show_centerlines and bw > 5 and bh > 5:  # only for non-trivial shapes
        mid_u = (u0 + u1) / 2
        mid_v = (v0 + v1) / 2
        px_mid, py_mid = pg(mid_u, mid_v)
        half_w = bw / 2 + sym_margin
        half_h = bh / 2 + sym_margin
        out.append('<g class="symmetry-axes" stroke="#000" stroke-width="0.13" '
                   'fill="none" stroke-dasharray="8,2,1.5,2" '
                   f'stroke-linecap="{LINE_CAP}" opacity="0.5">')
        # Horizontal symmetry axis
        out.append(f'  <line x1="{px_mid-half_w:.2f}" y1="{py_mid:.2f}" '
                   f'x2="{px_mid+half_w:.2f}" y2="{py_mid:.2f}"/>')
        # Vertical symmetry axis
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


def _dim_horizontal(x1, x2, y_base, y_dim, value_mm):
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
    return out


def _dim_vertical(y1, y2, x_base, x_dim, value_mm):
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
    return out


def _dim_diameter(px, py, radius_scaled, radius_mm, angle_deg=45):
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
    # Text
    d_mm = radius_mm * 2
    text = f"\u2300{d_mm:.1f}" if d_mm != int(d_mm) else f"\u2300{int(d_mm)}"
    tx = (ex + shx) / 2
    ty = ey - 1.2
    out.append(f'<text x="{tx:.2f}" y="{ty:.2f}" text-anchor="middle" '
               f'font-family="{DIM_FONT}" font-size="{DIM_FONT_SIZE}" '
               f'fill="{DIM_COLOR}">{text}</text>')
    return out


def render_dimensions_svg(vname, bounds, circles, cx, cy, scale):
    """Generate ISO 129 dimension lines for a view.

    - Bounding dimensions (overall width + height) for front/top/right
    - Hole diameter callouts for circular features
    - ISO view is skipped (no dimensions on pictorial views)
    """
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

    # Overall width (horizontal, below shape)
    width_mm = (u1 - u0)
    if width_mm > 0.5:
        y_dim = bottom + DIM_OFFSET
        out.extend(_dim_horizontal(left, right, bottom, y_dim, width_mm))

    # Overall height (vertical, right of shape)
    height_mm = (v1 - v0)
    if height_mm > 0.5:
        x_dim = right + DIM_OFFSET
        out.extend(_dim_vertical(top, bottom, right, x_dim, height_mm))

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
        out.extend(_dim_diameter(px, py, r_scaled, cr, angle_deg=leader_angle))
        leader_angle += 30  # stagger angles for multiple holes

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
        # Create large cutting box
        half = max(bbox.DiagonalLength, 500)
        cut_plane = Part.makePlane(half * 2, half * 2, base_pt - Vector(half, half, half))
        # Use slice to get cross-section wires
        wires = shape.slice(normal, base_pt.dot(normal))
        if not wires:
            return None
        # Build compound from wires
        section_compound = Part.Compound(wires)
        return (section_compound, view_dir, label)
    except Exception:
        return None


def render_section_svg(label, groups, bounds, circles, cx, cy, scale, shape_bounds):
    """Render section view with hatching and section label.

    Like render_view_svg but adds:
    - 45-degree hatching fill for the sectioned area
    - Section label (e.g., "SECTION A-A")
    """
    out = []
    u0, v0, u1, v1 = bounds
    bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

    def pg(u, v):
        return cx + (u - bcx) * scale, cy - (v - bcy) * scale

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

    # Hatching overlay: bounding rectangle with hatch pattern
    # (simplified: fills the view area with 45-deg hatch; real section
    #  would clip to the cross-section boundary)
    hw = (u1 - u0) * scale
    hh = (v1 - v0) * scale
    hx = cx - hw / 2
    hy = cy - hh / 2
    if hw > 0 and hh > 0:
        out.append(f'<rect x="{hx:.2f}" y="{hy:.2f}" width="{hw:.2f}" height="{hh:.2f}" '
                   f'fill="url(#hatch45)" stroke="none" opacity="0.4"/>')

    # Section label
    lx = cx
    ly = cy - CELL_H / 2 + 8
    out.append(f'<text x="{lx:.1f}" y="{ly:.1f}" font-family="sans-serif" '
               f'font-size="4" font-weight="bold" text-anchor="middle" '
               f'fill="#333">SECTION {label}</text>')

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
    for vname in views_requested:
        if vname not in VIEW_DIRECTIONS:
            log(f"  Skipping unknown view: {vname}")
            continue

        groups, bounds, circles = project_view(
            compound, VIEW_DIRECTIONS[vname], vname)

        if not groups:
            # Fallback: project individual solids
            if hasattr(compound, 'Solids') and compound.Solids:
                log(f"  View '{vname}': empty compound, trying per-solid")
                all_groups, all_circles = {}, []
                all_bounds = [1e9, 1e9, -1e9, -1e9]
                for solid in compound.Solids:
                    sg, sb, sc = project_view(
                        solid, VIEW_DIRECTIONS[vname], vname)
                    for gi, edges in sg.items():
                        all_groups.setdefault(gi, []).extend(edges)
                    all_circles.extend(sc)
                    all_bounds[0] = min(all_bounds[0], sb[0])
                    all_bounds[1] = min(all_bounds[1], sb[1])
                    all_bounds[2] = max(all_bounds[2], sb[2])
                    all_bounds[3] = max(all_bounds[3], sb[3])
                if all_groups:
                    groups = all_groups
                    bounds = tuple(all_bounds)
                    circles = all_circles

        if not groups:
            log(f"  View '{vname}': no edges projected")
            continue

        cx, cy = VIEW_CELLS.get(vname, VIEW_CELLS["front"])
        n_edges = sum(len(v) for v in groups.values())
        log(f"  View '{vname}': {n_edges} edges")

        show_hidden = drawing_cfg.get("style", {}).get("show_hidden", True)
        show_cl = drawing_cfg.get("style", {}).get("show_centerlines", True)
        show_dims = drawing_cfg.get("style", {}).get("show_dimensions", True)
        svg = render_view_svg(vname, groups, bounds, circles, cx, cy, scale,
                              show_hidden=show_hidden, show_centerlines=show_cl)
        # Append dimension lines (front/top/right only)
        if show_dims and vname != "iso":
            dim_svg = render_dimensions_svg(vname, bounds, circles, cx, cy, scale)
            if dim_svg:
                svg += '\n' + dim_svg
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
            sec_groups, sec_bounds, sec_circles = project_view(
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
                log(f"  Section '{sec_label}': {sum(len(v) for v in sec_groups.values())} edges")
            else:
                log(f"  Section '{sec_label}': no edges (empty cross-section)")
        else:
            log(f"  Section: failed to create section on plane {sec_plane}")

    # -- Extract BOM --
    bom = extract_bom(config, parts_metadata) if is_assembly else []

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
