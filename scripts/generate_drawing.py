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
from _feature_inference import infer_features_from_config
from _view_planner import plan_views
from _general_notes import (build_general_notes, build_revision_table,
                            render_revision_table_svg, render_general_notes_svg,
                            estimate_notes_height)
from _dim_baseline import (render_baseline_dimensions_svg,
                           render_ordinate_dimensions_svg,
                           select_dimension_strategy)
from _gdt_automation import auto_select_datums, auto_assign_gdt, render_gdt_frame_svg

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


# -- Annotation Layout Planner ------------------------------------------------

class AnnotationPlanner:
    """AABB-based collision avoidance for annotation placement.

    Collects bounding boxes of placed annotations (dimensions, datums, labels)
    and helps find positions that minimise overlap.
    """

    def __init__(self):
        self._boxes = []  # [(x_min, y_min, x_max, y_max), ...]

    def register(self, x_min, y_min, x_max, y_max):
        """Register an already-placed annotation bounding box."""
        self._boxes.append((min(x_min, x_max), min(y_min, y_max),
                            max(x_min, x_max), max(y_min, y_max)))

    def overlap_score(self, x_min, y_min, x_max, y_max):
        """Return total overlap area with all registered boxes."""
        bx0, by0 = min(x_min, x_max), min(y_min, y_max)
        bx1, by1 = max(x_min, x_max), max(y_min, y_max)
        total = 0.0
        for ax0, ay0, ax1, ay1 in self._boxes:
            dx = max(0, min(bx1, ax1) - max(bx0, ax0))
            dy = max(0, min(by1, ay1) - max(by0, ay0))
            total += dx * dy
        return total

    def find_best_position(self, candidates, box_w, box_h):
        """Pick candidate (x, y) with least overlap.

        candidates: [(x, y), ...]  — top-left corner of the annotation box
        Returns: (best_x, best_y)
        """
        best, best_score = candidates[0], float('inf')
        for cx, cy in candidates:
            score = self.overlap_score(cx, cy, cx + box_w, cy + box_h)
            if score < best_score:
                best_score = score
                best = (cx, cy)
                if score == 0:
                    break
        return best

    def register_and_pick(self, candidates, box_w, box_h):
        """find_best_position + register the winner. Returns (x, y)."""
        x, y = self.find_best_position(candidates, box_w, box_h)
        self.register(x, y, x + box_w, y + box_h)
        return x, y


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
                    show_hidden=True, show_centerlines=True,
                    simplify_iso=False):
    """Render one view's edges as SVG, centered at (cx, cy) on the page."""
    out = []
    u0, v0, u1, v1 = bounds
    bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

    def pg(u, v):
        return cx + (u - bcx) * scale, cy - (v - bcy) * scale

    # Hidden line groups: 1, 3, 6, 9
    hidden_groups = {1, 3, 6, 9}

    # ISO simplification: limit visible groups to hard+outer only,
    # conditionally include smooth (skip if too many edges)
    ISO_SMOOTH_EDGE_LIMIT = 50
    if simplify_iso:
        iso_skip = {8, 9}  # always skip iso_visible/iso_hidden
        smooth_count = len(groups.get(5, []))
        if smooth_count > ISO_SMOOTH_EDGE_LIMIT:
            iso_skip.add(5)  # skip smooth_visible too for complex parts

    for gi in RENDER_ORDER:
        if gi not in groups:
            continue
        if not show_hidden and gi in hidden_groups:
            continue
        if simplify_iso and gi in iso_skip:
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
    # Clamp arms to cell boundary and deduplicate by center position.
    if circles and show_centerlines:
        cell_x0 = cx - CELL_W / 2 + 3   # inset slightly from cell edge
        cell_x1 = cx + CELL_W / 2 - 3
        cell_y0 = cy - CELL_H / 2 + 3
        cell_y1 = cy + CELL_H / 2 - 3
        max_r_scaled = max(r * scale for _, _, r in circles) if circles else 0
        arm_base = max(max_r_scaled * 1.3, min(CELL_W, CELL_H) * 0.06)

        out.append('<g class="centerlines" stroke="#000" stroke-width="0.18" '
                   'fill="none" stroke-dasharray="8,2,1.5,2" '
                   f'stroke-linecap="{LINE_CAP}" '
                   f'vector-effect="non-scaling-stroke">')
        seen_centers = set()
        for cu, cv, cr in circles:
            # Deduplicate: skip circles with same center (within 0.5mm page)
            key = (round(cu * 2), round(cv * 2))
            if key in seen_centers:
                continue
            seen_centers.add(key)
            px, py = pg(cu, cv)
            arm = max(cr * scale * 1.3, arm_base)
            # Clamp horizontal arm to cell boundary
            x_lo = max(px - arm, cell_x0)
            x_hi = min(px + arm, cell_x1)
            y_lo = max(py - arm, cell_y0)
            y_hi = min(py + arm, cell_y1)
            out.append(f'  <line x1="{x_lo:.2f}" y1="{py:.2f}" '
                       f'x2="{x_hi:.2f}" y2="{py:.2f}"/>')
            out.append(f'  <line x1="{px:.2f}" y1="{y_lo:.2f}" '
                       f'x2="{px:.2f}" y2="{y_hi:.2f}"/>')
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
                       f'stroke-linecap="{LINE_CAP}" opacity="0.5" '
                       f'vector-effect="non-scaling-stroke">')
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

# -- Surface Finish (ISO 1302) -------------------------------------------------
SF_V_HEIGHT = 3.0            # checkmark V height mm
SF_BAR_W = 12.0              # horizontal bar width
SF_FONT_SIZE = "2.5"         # value text size
SF_LINE_W = "0.25"           # symbol stroke
SF_LEADER_W = "0.20"         # leader line stroke

# -- Chamfer Callout -----------------------------------------------------------
CHAMFER_FONT_SIZE = "2.8"
CHAMFER_LINE_W = "0.20"

# -- Thread Callout -------------------------------------------------------------
THREAD_FONT_SIZE = "2.8"
THREAD_LINE_W = "0.20"
THREAD_DASH_CIRCLE_RATIO = 0.85  # inner dashed circle at 85% of nominal diameter


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


def _dim_diameter(px, py, radius_scaled, radius_mm, angle_deg=45, tol_text="",
                  cell_bounds=None):
    """Diameter dimension: leader line from circle + diameter text.

    cell_bounds: (x_min, y_min, x_max, y_max) — if provided, selects best
    angle that keeps leader fully inside the cell.
    """
    out = []
    leader_len = max(min(radius_scaled * 0.8, 20), 6)
    shelf_len = 8

    # If cell bounds given, pick the best angle that stays in bounds
    if cell_bounds:
        bx0, by0, bx1, by1 = cell_bounds
        margin = shelf_len + 4  # text space
        best_angle = math.radians(angle_deg)
        best_score = float('inf')
        for a_deg in range(0, 360, 15):
            a = math.radians(a_deg)
            sx_c = px + radius_scaled * math.cos(a)
            sy_c = py - radius_scaled * math.sin(a)
            ex_c = sx_c + leader_len * math.cos(a)
            ey_c = sy_c - leader_len * math.sin(a)
            s_dir = 1 if math.cos(a) >= 0 else -1
            shx_c = ex_c + s_dir * shelf_len
            # Penalty: how far outside the cell
            overshoot = 0
            for xx in (sx_c, ex_c, shx_c):
                overshoot += max(0, bx0 - xx) + max(0, xx - bx1)
            for yy in (sy_c, ey_c):
                overshoot += max(0, by0 - yy) + max(0, yy - by1)
            # Small bonus for being close to the requested angle
            angle_diff = abs(((a_deg - angle_deg + 180) % 360) - 180)
            score = overshoot * 100 + angle_diff * 0.1
            if score < best_score:
                best_score = score
                best_angle = a
        angle = best_angle
    else:
        angle = math.radians(angle_deg)

    sx = px + radius_scaled * math.cos(angle)
    sy = py - radius_scaled * math.sin(angle)
    ex = sx + leader_len * math.cos(angle)
    ey = sy - leader_len * math.sin(angle)
    # Leader line
    out.append(f'<line x1="{sx:.2f}" y1="{sy:.2f}" '
               f'x2="{ex:.2f}" y2="{ey:.2f}"/>')
    # Horizontal shelf
    shelf_dir = 1 if math.cos(angle) >= 0 else -1
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


def _collect_auto_dim_values(vd):
    """Collect dimension values auto-dims would produce for a view.

    Used to prevent plan-driven dims from duplicating auto-dims.
    """
    u0, v0, u1, v1 = vd["bounds"]
    vals = []
    w, h = u1 - u0, v1 - v0
    if w > 0.5:
        vals.append(w)
    if h > 0.5:
        vals.append(h)
    for cu, cv, cr in vd.get("circles", []):
        vals.append(cr * 2)
    return vals


def render_dimensions_svg(vname, bounds, circles, cx, cy, scale, arcs=None,
                          tolerances=None, return_stacks=False,
                          style_cfg=None):
    """Generate ISO 129 dimension lines for a view.

    - Bounding dimensions (overall width + height) for front/top/right
    - Hole diameter callouts for circular features
    - Feature chain dimensions (hole-to-hole and hole-to-edge positions)
    - Radius dimensions for fillet/round arcs
    - ISO view is skipped (no dimensions on pictorial views)

    tolerances: dict with keys 'general', 'holes', 'shafts' (optional)
    style_cfg: optional dict with dim_offset/feat_dim_stack/dim_gap overrides.
    """
    tolerances = tolerances or {}
    if vname == "iso":
        return ("", 0, 0) if return_stacks else ""

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

    # Effective spacing from style_cfg or module defaults
    _sc = style_cfg or {}
    eff_dim_offset = _sc.get("dim_offset", DIM_OFFSET)
    eff_feat_stack = _sc.get("feat_dim_stack", FEAT_DIM_STACK)

    # Cell boundary limits — keep dimensions within view cell
    cell_bottom = cy + CELL_H / 2 - 2
    cell_right = cx + CELL_W / 2 - 2
    # Max stacking rows/cols that fit within the cell
    max_h_stacks = max(1, int((cell_bottom - bottom - eff_dim_offset) / eff_feat_stack))
    max_v_stacks = max(1, int((cell_right - right - eff_dim_offset) / eff_feat_stack))

    gen_tol = tolerances.get("general", "")
    hole_tol = tolerances.get("holes", "")

    # Overall width (horizontal, below shape)
    width_mm = (u1 - u0)
    if width_mm > 0.5:
        y_dim = bottom + eff_dim_offset + eff_feat_stack * h_stack
        if y_dim < cell_bottom:
            out.extend(_dim_horizontal(left, right, bottom, y_dim, width_mm,
                                       tol_text=gen_tol))
            h_stack += 1

    # Overall height (vertical, right of shape)
    height_mm = (v1 - v0)
    if height_mm > 0.5:
        x_dim = right + eff_dim_offset + eff_feat_stack * v_stack
        if x_dim < cell_right:
            out.extend(_dim_vertical(top, bottom, right, x_dim, height_mm,
                                     tol_text=gen_tol))
            v_stack += 1

    # Hole diameters (deduplicated by radius within tolerance)
    # Clamp leader endpoints within cell boundaries
    cell_x0 = cx - CELL_W / 2 + 2
    cell_y0 = cy - CELL_H / 2 + 2
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
                                 tol_text=hole_tol,
                                 cell_bounds=(cell_x0, cell_y0, cell_right, cell_bottom)))
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

        if h_segments and h_stack < max_h_stacks:
            y_feat = bottom + eff_dim_offset + eff_feat_stack * h_stack
            if y_feat < cell_bottom:
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

        if v_segments and v_stack < max_v_stacks:
            x_feat = right + eff_dim_offset + eff_feat_stack * v_stack
            if x_feat < cell_right:
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
    result = '\n'.join(out)
    if return_stacks:
        return result, h_stack, v_stack
    return result


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


# -- Surface Finish Symbols (ISO 1302) ----------------------------------------

def _render_sf_symbol(x, y, value, machining="required", slots=None):
    """Render ISO 1302 surface finish symbol at (x, y).

    machining: 'required' (double bar), 'prohibited' (circle), 'any' (plain V)
    slots: dict with ISO 1302 fields {a, c, d, e} for extended symbol
      a = Ra value (rendered above bar — overrides 'value' param)
      c = production method (above bar, right of a)
      d = lay direction symbol (below bar, left)
      e = machining allowance (below bar, right)
    Returns list of SVG elements.
    """
    out = []
    slots = slots or {}
    # V-shape: ISO 1302 checkmark with exactly 60° at vertex.
    h = SF_V_HEIGHT
    half_a = math.pi / 6  # 30°
    sin30, cos30 = math.sin(half_a), math.cos(half_a)
    l_left = h * 0.7
    l_right = h * 1.2
    vx1 = x                                       # left tip
    vy1 = y
    vx2 = x + l_left * sin30                      # vertex (bottom of V)
    vy2 = y + l_left * cos30
    vx3 = vx2 + l_right * sin30                   # right tip (top)
    vy3 = vy2 - l_right * cos30

    out.append(f'<polyline points="{vx1:.2f},{vy1:.2f} {vx2:.2f},{vy2:.2f} '
               f'{vx3:.2f},{vy3:.2f}" fill="none" stroke="#000" '
               f'stroke-width="{SF_LINE_W}"/>')

    # Horizontal bar from top of V
    bar_x1 = vx3
    bar_y1 = vy3
    bar_x2 = bar_x1 + SF_BAR_W
    out.append(f'<line x1="{bar_x1:.2f}" y1="{bar_y1:.2f}" '
               f'x2="{bar_x2:.2f}" y2="{bar_y1:.2f}" '
               f'stroke="#000" stroke-width="{SF_LINE_W}"/>')

    if machining == "required":
        out.append(f'<line x1="{bar_x1:.2f}" y1="{bar_y1 - 1.2:.2f}" '
                   f'x2="{bar_x2:.2f}" y2="{bar_y1 - 1.2:.2f}" '
                   f'stroke="#000" stroke-width="{SF_LINE_W}"/>')
    elif machining == "prohibited":
        out.append(f'<circle cx="{vx3:.2f}" cy="{vy3:.2f}" r="1.5" '
                   f'fill="none" stroke="#000" stroke-width="{SF_LINE_W}"/>')

    # Slot a: Ra value (above bar, left)
    a_val = slots.get("a", value)
    tx = bar_x1 + 2
    ty = bar_y1 - 2.0
    out.append(f'<text x="{tx:.2f}" y="{ty:.2f}" text-anchor="start" '
               f'font-family="sans-serif" font-size="{SF_FONT_SIZE}" '
               f'fill="#000">{_escape(a_val)}</text>')

    # Slot c: production method (above bar, right)
    c_val = slots.get("c", "")
    if c_val:
        tx_c = bar_x2 - 1
        out.append(f'<text x="{tx_c:.2f}" y="{ty:.2f}" text-anchor="end" '
                   f'font-family="sans-serif" font-size="2" '
                   f'fill="#000">{_escape(c_val)}</text>')

    # Slot d: lay direction (below bar, left)
    d_val = slots.get("d", "")
    if d_val:
        ty_d = bar_y1 + 3.0
        out.append(f'<text x="{bar_x1 + 2:.2f}" y="{ty_d:.2f}" '
                   f'text-anchor="start" font-family="sans-serif" '
                   f'font-size="2.2" fill="#000">{_escape(d_val)}</text>')

    # Slot e: machining allowance (below bar, right)
    e_val = slots.get("e", "")
    if e_val:
        ty_e = bar_y1 + 3.0
        out.append(f'<text x="{bar_x2 - 1:.2f}" y="{ty_e:.2f}" '
                   f'text-anchor="end" font-family="sans-serif" '
                   f'font-size="2.2" fill="#000">{_escape(e_val)}</text>')

    return out


def render_surface_finish_svg(sf_cfg, view_data, scale, planner=None):
    """Render surface finish annotations: default symbol + face-specific leaders.

    sf_cfg: {default, machining, faces: [{location, value, view}]}
    view_data: {vname: {bounds, cx, cy, ...}}
    planner: AnnotationPlanner for collision-free placement
    """
    if not sf_cfg:
        return ""

    planner = planner or AnnotationPlanner()
    out = ['<g class="surface-finish">']

    default_val = sf_cfg.get("default", "Ra 3.2")
    machining = sf_cfg.get("machining", "any")

    # Default symbol: placed in general note area (above title block, right side)
    tb_y = PAGE_H - MARGIN - TITLE_H
    def_x = PAGE_W - MARGIN - 60
    def_y = tb_y - 8
    out.extend(_render_sf_symbol(def_x, def_y, default_val, machining))
    planner.register(def_x, def_y - 5, def_x + SF_BAR_W + SF_V_HEIGHT, def_y + SF_V_HEIGHT + 2)

    # Face-specific annotations with leader lines
    # Symbol bounding box size (approximate)
    sym_w = SF_V_HEIGHT + SF_BAR_W + 4
    sym_h = SF_V_HEIGHT * 1.5 + 4

    faces = sf_cfg.get("faces", [])
    for face in faces:
        loc = face.get("location", [0, 0])
        value = face.get("value", default_val)
        view = face.get("view", "front")

        if view not in view_data:
            continue

        vd = view_data[view]
        bounds = vd["bounds"]
        cx, cy = vd["cx"], vd["cy"]
        u0, v0, u1, v1 = bounds
        bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

        # Convert location [u, v] to page coords
        target_x = cx + (loc[0] - bcx) * scale
        target_y = cy - (loc[1] - bcy) * scale

        # Generate 4-direction candidates for symbol placement
        d = 15  # leader length
        candidates = [
            (target_x + d,  target_y - d),       # top-right
            (target_x + d,  target_y + d * 0.5),  # bottom-right
            (target_x - d - sym_w, target_y - d),  # top-left
            (target_x - d - sym_w, target_y + d * 0.5),  # bottom-left
        ]
        sym_x, sym_y = planner.register_and_pick(candidates, sym_w, sym_h)

        # Leader line from target to symbol
        out.append(f'<line x1="{target_x:.2f}" y1="{target_y:.2f}" '
                   f'x2="{sym_x:.2f}" y2="{sym_y:.2f}" '
                   f'stroke="#000" stroke-width="{SF_LEADER_W}"/>')
        # Arrow at target
        angle = math.atan2(sym_y - target_y, sym_x - target_x) + math.pi
        out.append(_arrow_head(target_x, target_y, angle))

        # Build ISO 1302 slots dict if extended fields present
        face_slots = {}
        if face.get("a"):
            face_slots["a"] = face["a"]
        if face.get("c"):
            face_slots["c"] = face["c"]
        if face.get("d"):
            face_slots["d"] = face["d"]
        if face.get("e"):
            face_slots["e"] = face["e"]

        out.extend(_render_sf_symbol(sym_x, sym_y, value, machining,
                                     slots=face_slots if face_slots else None))

    out.append('</g>')
    return '\n'.join(out)


# -- Chamfer Callouts ----------------------------------------------------------

def _find_chamfer_ops(config):
    """Scan operations for chamfer ops. Returns [(target, size)]."""
    results = []
    for op in config.get("operations", []):
        if op.get("op") == "chamfer":
            results.append((op.get("target", ""), op.get("size", 1.0)))
    return results


def render_chamfer_callouts_svg(config, chamfer_cfg, bounds, cx, cy, scale,
                                groups=None, planner=None):
    """Render chamfer callouts on the front view.

    chamfer_cfg: {format: 'C'|'angle', show: true}
    Uses chamfer size to estimate actual chamfer edge midpoint instead of
    bounding-box corners.  Falls back to bbox corner if groups are unavailable.
    """
    if not chamfer_cfg or not chamfer_cfg.get("show", True):
        return ""

    chamfer_ops = _find_chamfer_ops(config)
    if not chamfer_ops:
        return ""

    planner = planner or AnnotationPlanner()
    fmt = chamfer_cfg.get("format", "C")
    u0, v0, u1, v1 = bounds
    bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

    def pg(u, v):
        return cx + (u - bcx) * scale, cy - (v - bcy) * scale

    # Pre-compute chamfer edge anchor candidates (4 corners, inward by size)
    def _chamfer_anchors(size):
        """Return page-coord anchors at the midpoint of 45-deg chamfer edges
        at each bbox corner."""
        hs = size / 2.0
        return [
            pg(u1 - hs, v1 - hs),  # top-right
            pg(u0 + hs, v1 - hs),  # top-left
            pg(u1 - hs, v0 + hs),  # bottom-right
            pg(u0 + hs, v0 + hs),  # bottom-left
        ]

    out = ['<g class="chamfer-callouts">']
    shelf_len = 10
    label_box_w = shelf_len + 4
    label_box_h = 6

    for i, (target, size) in enumerate(chamfer_ops):
        if fmt == "C":
            label = f"C{size}"
        else:
            label = f"{size}\u00d745\u00b0"

        # Pick the top-right chamfer edge midpoint as anchor (most conventional)
        anchors = _chamfer_anchors(size)
        anchor_x, anchor_y = anchors[0]  # top-right

        # Generate placement candidates (4 directions from anchor)
        d = 12
        candidates = [
            (anchor_x + d, anchor_y - d - label_box_h),       # top-right of anchor
            (anchor_x + d, anchor_y + 2),                      # bottom-right
            (anchor_x - d - label_box_w, anchor_y - d - label_box_h),  # top-left
            (anchor_x - d - label_box_w, anchor_y + 2),        # bottom-left
        ]
        sym_x, sym_y = planner.register_and_pick(candidates, label_box_w, label_box_h)

        # Leader line from chamfer edge to shelf start
        out.append(f'<line x1="{anchor_x:.2f}" y1="{anchor_y:.2f}" '
                   f'x2="{sym_x:.2f}" y2="{sym_y:.2f}" '
                   f'stroke="#000" stroke-width="{CHAMFER_LINE_W}"/>')
        # Arrow at chamfer edge
        angle = math.atan2(sym_y - anchor_y, sym_x - anchor_x) + math.pi
        out.append(_arrow_head(anchor_x, anchor_y, angle))
        # Horizontal shelf
        shelf_x = sym_x + shelf_len
        out.append(f'<line x1="{sym_x:.2f}" y1="{sym_y:.2f}" '
                   f'x2="{shelf_x:.2f}" y2="{sym_y:.2f}" '
                   f'stroke="#000" stroke-width="{CHAMFER_LINE_W}"/>')
        # Label text
        tx = (sym_x + shelf_x) / 2
        ty = sym_y - 1.2
        out.append(f'<text x="{tx:.2f}" y="{ty:.2f}" text-anchor="middle" '
                   f'font-family="sans-serif" font-size="{CHAMFER_FONT_SIZE}" '
                   f'fill="#000">{_escape(label)}</text>')

    out.append('</g>')
    return '\n'.join(out)


# -- Thread Callouts -----------------------------------------------------------

def render_thread_callouts_svg(threads_cfg, shapes_cfg, bounds, circles,
                                cx, cy, scale, planner=None):
    """Render thread callouts with dashed inner circle + leader + label.

    threads_cfg: [{diameter, pitch, label, hole_id}]
    shapes_cfg: list of shape dicts from config
    planner: AnnotationPlanner for collision-free placement
    """
    if not threads_cfg:
        return ""

    planner = planner or AnnotationPlanner()
    u0, v0, u1, v1 = bounds
    bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

    def pg(u, v):
        return cx + (u - bcx) * scale, cy - (v - bcy) * scale

    # Build shape position lookup by id
    shape_map = {}
    for s in (shapes_cfg or []):
        if "id" in s:
            shape_map[s["id"]] = s

    out = ['<g class="thread-callouts">']

    for ti, tcfg in enumerate(threads_cfg):
        label = tcfg.get("label", f"M{tcfg.get('diameter', 0)}")
        hole_id = tcfg.get("hole_id", "")
        nominal_d = tcfg.get("diameter", 10)
        nominal_r = nominal_d / 2.0

        # Find matching circle by hole_id position+radius, or by radius alone
        target_circle = None
        shape_r = nominal_r
        if hole_id and hole_id in shape_map:
            s = shape_map[hole_id]
            pos = s.get("position", [0, 0, 0])
            shape_r = s.get("radius", nominal_r)
            # Match by radius first (must be close), then nearest position
            candidates = [(cu, cv, cr) for cu, cv, cr in circles
                          if abs(cr - shape_r) < 1.5]
            if candidates:
                # Pick nearest to shape XY position (top view) or XZ (front)
                best_dist = 1e9
                for cu, cv, cr in candidates:
                    # Try all position combos since we don't know the view mapping
                    d = min(math.hypot(cu - pos[0], cv - pos[1]),
                            math.hypot(cu - pos[0], cv - pos[2]),
                            math.hypot(cu + pos[0], cv - pos[1]),
                            math.hypot(cu + pos[0], cv + pos[1]))
                    if d < best_dist:
                        best_dist = d
                        target_circle = (cu, cv, cr)
        if not target_circle:
            # Fallback: match by radius (within tolerance)
            for cu, cv, cr in circles:
                if abs(cr - shape_r) < 1.5:
                    target_circle = (cu, cv, cr)
                    break

        if not target_circle:
            continue

        cu, cv, cr = target_circle
        px, py = pg(cu, cv)
        r_scaled = cr * scale

        # Thin dashed circle at 85% of nominal diameter (thread convention)
        inner_r = r_scaled * THREAD_DASH_CIRCLE_RATIO
        out.append(f'<circle cx="{px:.2f}" cy="{py:.2f}" r="{inner_r:.2f}" '
                   f'fill="none" stroke="#000" stroke-width="0.18" '
                   f'stroke-dasharray="1.5,1"/>')

        # Leader: try multiple angles, pick the one with least collision
        leader_len = max(r_scaled * 1.2, 10)
        shelf_len_t = 12
        box_w_t = shelf_len_t + 4
        box_h_t = 5

        angle_candidates = [math.radians(a) for a in range(20, 340, 30)]
        cands = []
        for a in angle_candidates:
            sx_c = px + r_scaled * math.cos(a)
            sy_c = py - r_scaled * math.sin(a)
            ex_c = sx_c + leader_len * math.cos(a)
            ey_c = sy_c - leader_len * math.sin(a)
            s_dir = 1 if math.cos(a) >= 0 else -1
            bx = ex_c if s_dir > 0 else ex_c - box_w_t
            cands.append((bx, ey_c - box_h_t, a, sx_c, sy_c, ex_c, ey_c, s_dir))

        best_idx = 0
        best_score = float('inf')
        for idx, (bx, by, *_rest) in enumerate(cands):
            sc = planner.overlap_score(bx, by, bx + box_w_t, by + box_h_t)
            if sc < best_score:
                best_score = sc
                best_idx = idx
                if sc == 0:
                    break

        bx, by, angle, sx, sy, ex, ey, shelf_dir = cands[best_idx]
        planner.register(bx, by, bx + box_w_t, by + box_h_t)

        out.append(f'<line x1="{sx:.2f}" y1="{sy:.2f}" '
                   f'x2="{ex:.2f}" y2="{ey:.2f}" '
                   f'stroke="#000" stroke-width="{THREAD_LINE_W}"/>')

        # Arrow at circle edge
        arr_angle = angle + math.pi
        out.append(_arrow_head(sx, sy, arr_angle))

        # Horizontal shelf
        shelf_x = ex + shelf_dir * shelf_len_t
        out.append(f'<line x1="{ex:.2f}" y1="{ey:.2f}" '
                   f'x2="{shelf_x:.2f}" y2="{ey:.2f}" '
                   f'stroke="#000" stroke-width="{THREAD_LINE_W}"/>')

        # Label text
        tx = (ex + shelf_x) / 2
        ty = ey - 1.2
        out.append(f'<text x="{tx:.2f}" y="{ty:.2f}" text-anchor="middle" '
                   f'font-family="sans-serif" font-size="{THREAD_FONT_SIZE}" '
                   f'fill="#000">{_escape(label)}</text>')

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


# -- GD&T Anchor Placement + Leader ----------------------------------------

def _feature_to_page_xy(position, vname, bounds, cx, cy, scale):
    """Convert 3D feature position to 2D page coordinates on a given view.

    Uses VIEW_UV_MAP for front/top/right; returns None for iso.
    """
    if vname not in VIEW_UV_MAP:
        return None
    ax1, s1, ax2, s2 = VIEW_UV_MAP[vname]
    # Map 3D position to projection (u, v) using same logic as _extract_fn
    pos_map = {"x": position[0], "y": position[1], "z": position[2] if len(position) > 2 else 0}
    u = s1 * pos_map[ax1]
    v = s2 * pos_map[ax2]
    # Convert projection coords to page coords (same as render_view_svg pg())
    u0, v0, u1, v1 = bounds
    bcx_v, bcy_v = (u0 + u1) / 2, (v0 + v1) / 2
    px = cx + (u - bcx_v) * scale
    py = cy - (v - bcy_v) * scale
    return px, py


def _render_leader_svg(anchor_x, anchor_y, frame_x, frame_y, frame_w, frame_h):
    """Render a 2-segment orthogonal leader from feature anchor to GD&T frame.

    Leader: anchor → elbow → frame attachment point.
    Frame attachment is at the left-center of the frame.
    """
    # Attachment point: left edge, vertical center of frame
    attach_x = frame_x
    attach_y = frame_y + frame_h / 2

    # Determine elbow position (orthogonal routing)
    # If anchor is to the left of frame, elbow goes horizontal then vertical
    # Otherwise vertical then horizontal
    dx = attach_x - anchor_x
    dy = attach_y - anchor_y

    if abs(dx) > abs(dy):
        # Horizontal-first: anchor → (attach_x, anchor_y) → attach
        elbow_x, elbow_y = attach_x, anchor_y
    else:
        # Vertical-first: anchor → (anchor_x, attach_y) → attach
        elbow_x, elbow_y = anchor_x, attach_y

    out = []
    out.append(f'<g class="gdt-leader" stroke="#000" stroke-width="0.25" fill="none">')
    # Leader line segments
    out.append(f'  <polyline points="{anchor_x:.2f},{anchor_y:.2f} '
               f'{elbow_x:.2f},{elbow_y:.2f} {attach_x:.2f},{attach_y:.2f}"/>')
    # Small filled circle at anchor point (feature indicator)
    out.append(f'  <circle cx="{anchor_x:.2f}" cy="{anchor_y:.2f}" r="0.6" '
               f'fill="#000" stroke="none"/>')
    out.append('</g>')
    return '\n'.join(out)


def _has_valid_anchor(target):
    """Check if target has a meaningful anchor position (not origin fallback)."""
    if not target or not target.get("position"):
        return False
    pos = target["position"]
    # [0,0,0] is the default fallback — not a real feature anchor
    return not (pos[0] == 0 and pos[1] == 0 and (len(pos) < 3 or pos[2] == 0))


def place_gdt_on_view(gdt_entries, view_data, scale, planner=None):
    """Place GD&T frames near their target features with leaders.

    Entries with valid anchors get 8-direction placement near the feature.
    Entries without anchors get stacked in cell bottom-right as fallback.

    Returns list of (gdt_entry, frame_x, frame_y, anchor_x, anchor_y, frame_w, frame_h).
    Uses AnnotationPlanner for collision avoidance.
    """
    if not gdt_entries:
        return []

    vname = "front"  # GD&T is placed on front view
    if vname not in view_data:
        return []

    vd = view_data[vname]
    bounds = vd["bounds"]
    cx, cy = vd["cx"], vd["cy"]
    cell_x0 = cx - CELL_W / 2 + 3
    cell_x1 = cx + CELL_W / 2 - 3
    cell_y0 = cy - CELL_H / 2 + 3
    cell_y1 = cy + CELL_H / 2 - 3

    if planner is None:
        planner = AnnotationPlanner()

    # Separate anchored vs unanchored entries
    anchored = []
    unanchored = []
    for gdt in gdt_entries[:6]:
        if _has_valid_anchor(gdt.get("target")):
            anchored.append(gdt)
        else:
            unanchored.append(gdt)

    placements = []

    # --- Anchored entries: 8-direction placement near feature ---
    for gdt in anchored:
        target = gdt["target"]
        frame_h = 6
        cell_w_f = 12
        n_cells = 2 + len(gdt.get("datum_refs", []))
        frame_w = n_cells * cell_w_f

        anchor = _feature_to_page_xy(
            target["position"], vname, bounds, cx, cy, scale)
        if anchor is None:
            anchor = (cx, cy)
        ax, ay = anchor

        # 8 candidate positions around anchor
        offset = 12  # mm gap between anchor and frame
        diag = offset * 0.7  # diagonal offset
        candidates = [
            (ax + offset, ay - frame_h / 2),              # right
            (ax - offset - frame_w, ay - frame_h / 2),    # left
            (ax - frame_w / 2, ay + offset),               # below
            (ax - frame_w / 2, ay - offset - frame_h),    # above
            (ax + diag, ay + diag),                         # bottom-right
            (ax - diag - frame_w, ay + diag),               # bottom-left
            (ax + diag, ay - diag - frame_h),               # top-right
            (ax - diag - frame_w, ay - diag - frame_h),    # top-left
        ]

        # Filter candidates within cell bounds
        valid = [
            (fx, fy) for fx, fy in candidates
            if (fx >= cell_x0 and fx + frame_w <= cell_x1 and
                fy >= cell_y0 and fy + frame_h <= cell_y1)
        ]
        if not valid:
            valid = candidates

        fx, fy = planner.register_and_pick(valid, frame_w, frame_h)
        placements.append((gdt, fx, fy, ax, ay, frame_w, frame_h))

    # --- Unanchored entries: stack in cell bottom-right ---
    stack_x = cell_x1 - 60  # right side of cell
    stack_y = cell_y1 - 10  # near bottom
    for gi, gdt in enumerate(unanchored):
        frame_h = 6
        cell_w_f = 12
        n_cells = 2 + len(gdt.get("datum_refs", []))
        frame_w = n_cells * cell_w_f

        fx = stack_x
        fy = stack_y - gi * (frame_h + 3)
        # Anchor at cell center (no real feature reference)
        placements.append((gdt, fx, fy, cx, cy, frame_w, frame_h))
        planner.register(fx, fy, fx + frame_w, fy + frame_h)

    return placements


def compose_drawing(views_svg, name, bom, scale, bbox,
                    mates=None, tol_specs=None, meta=None, style_cfg=None,
                    extra_svg="", revisions=None, notes_list=None,
                    gdt_entries=None, feature_graph=None,
                    view_data=None):
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

    # ── General Notes (above legend, in left zone) ──
    # Use enhanced notes if provided, else fallback to basic notes
    if notes_list:
        notes = notes_list
    else:
        notes = []
        tol_note = meta.get("tolerance", "")
        if tol_note:
            notes.append(f"GENERAL TOLERANCES PER {tol_note}")
        notes.append("BREAK ALL SHARP EDGES")
        notes.append("DEBURR ALL EDGES")
        sf_default = meta.get("_sf_default", "")
        if sf_default:
            notes.append(f"UNLESS OTHERWISE SPECIFIED: {sf_default}")

    if notes:
        note_x = tb_x + 4
        notes_h = estimate_notes_height(notes, max_width=lz_w - 8)
        note_y = tb_bottom - 10 - notes_h
        note_svg, _nh = render_general_notes_svg(notes, note_x, note_y, max_width=lz_w - 8)
        if note_svg:
            p.append(note_svg)

    # ── Revision Table (above title block, right side) ──
    if revisions:
        rev_table = build_revision_table(revisions)
        if rev_table:
            rev_h = 5 + len(rev_table) * 5
            rev_x = rz_x
            rev_y = tb_y - rev_h - 2
            rev_svg = render_revision_table_svg(rev_table, rev_x, rev_y, width=rz_w)
            if rev_svg:
                p.append(rev_svg)

    # GD&T symbols — P0-3: feature-anchored placement with leaders
    if gdt_entries and view_data:
        gdt_planner = AnnotationPlanner()
        placements = place_gdt_on_view(gdt_entries, view_data, scale, planner=gdt_planner)
        if placements:
            p.append('<!-- GD&T Auto (anchored) -->')
            for gdt, fx, fy, ax, ay, fw, fh in placements:
                # Render leader line from anchor to frame
                leader_svg = _render_leader_svg(ax, ay, fx, fy, fw, fh)
                p.append(leader_svg)
                # Render GD&T frame
                frame_svg, _ = render_gdt_frame_svg(gdt, fx, fy)
                if frame_svg:
                    p.append(frame_svg)
    elif gdt_entries:
        # Fallback: fixed stack (when view_data not available)
        fcx, fcy = VIEW_CELLS["front"]
        gx = fcx + CELL_W / 2 - 35
        gy = fcy - CELL_H / 2 + 20
        p.append('<!-- GD&T Auto (stack fallback) -->')
        for gi, gdt in enumerate(gdt_entries[:6]):
            frame_svg, (fw, fh) = render_gdt_frame_svg(gdt, gx, gy + gi * 10)
            if frame_svg:
                p.append(frame_svg)

    if mates:
        try:
            from _gdt_symbols import generate_gdt_for_mates
            fcx, fcy = VIEW_CELLS["front"]
            gx = fcx + CELL_W / 2 - 35
            gy = fcy - CELL_H / 2 + 20
            n_auto = len(gdt_entries) if gdt_entries else 0
            frags = generate_gdt_for_mates(
                mates, tolerance_specs=tol_specs or {},
                start_x=gx, start_y=gy + n_auto * 10, spacing=12)
            if frags:
                p.append('<!-- GD&T Mates -->')
                p.extend(frags)
        except Exception:
            pass

    # Extra SVG content (surface finish, chamfer callouts, thread callouts, etc.)
    if extra_svg:
        p.append(extra_svg)

    p.append('</svg>')
    raw_svg = '\n'.join(p)

    # P0-4: Stroke normalizer — enforce consistent line styles per class
    raw_svg = _normalize_strokes(raw_svg)
    return raw_svg


def _normalize_strokes(svg_text):
    """P0-4: Post-processing pass to enforce consistent stroke widths per class.

    Fixes cases where center lines render with wrong thickness (e.g., shaft
    right view center line appearing as thick solid instead of thin chain line).

    Rules enforced:
    - class="centerlines" → stroke-width="0.18", dasharray="8,2,1.5,2"
    - class="symmetry-axes" → stroke-width="0.13", dasharray="8,2,1.5,2"
    - class="hard_hidden"/"outer_hidden"/"smooth_hidden" → stroke-width ≤ 0.30
    """
    import re

    # Centerlines: ensure thin chain line style
    svg_text = re.sub(
        r'(<g\s+class="centerlines"[^>]*?)stroke-width="[^"]*"',
        r'\1stroke-width="0.18"',
        svg_text)

    # Symmetry axes: ensure extra-thin chain line
    svg_text = re.sub(
        r'(<g\s+class="symmetry-axes"[^>]*?)stroke-width="[^"]*"',
        r'\1stroke-width="0.13"',
        svg_text)

    # Hidden lines: cap stroke-width at 0.30 (prevent rendering bugs)
    def _clamp_hidden_width(m):
        prefix = m.group(1)
        width = float(m.group(2))
        clamped = min(width, 0.30)
        return f'{prefix}stroke-width="{clamped}"'

    for cls in ("hard_hidden", "outer_hidden", "smooth_hidden", "iso_hidden"):
        svg_text = re.sub(
            rf'(<g\s+class="{cls}"[^>]*?)stroke-width="([^"]*)"',
            _clamp_hidden_width,
            svg_text)

    return svg_text


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

    # -- Feature Inference & View Planning --
    feature_graph = None
    view_plan = None
    try:
        feature_graph = infer_features_from_config(config)
        view_plan = plan_views(feature_graph, drawing_cfg)
        n_feat = len(feature_graph.features)
        n_grp = len(feature_graph.groups)
        log(f"  Features: {n_feat} detected, {n_grp} groups")
    except Exception as e:
        log(f"  Feature inference skipped: {e}")

    # Determine dimension strategy (plan > config > auto)
    dim_strategy = "chain"
    plan_dim = config.get("drawing_plan", {}).get("dimensioning", {})
    dim_style_cfg = drawing_cfg.get("dimension_style", {})
    if plan_dim.get("scheme"):
        dim_strategy = plan_dim["scheme"]
    elif dim_style_cfg.get("type"):
        dim_strategy = dim_style_cfg["type"]
    elif feature_graph:
        dim_strategy = select_dimension_strategy(feature_graph)
    log(f"  Dimension strategy: {dim_strategy}")

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

    if not view_data:
        respond_error("No views could be projected. Shape may be empty.")

    # -- P0-2: View Fit Hard Clamp (2-pass) --
    # Pass 1: check if any view overflows its cell, reduce scale to tightest fit.
    # Pass 2: verify with reduced scale; apply safety factor if still overflowing.
    VIEW_FIT_MARGIN = 0.88  # 88% of cell = 6% padding each side
    DIM_RESERVE = 12  # mm reserved for dimensions/datums outside shape
    original_scale = scale
    for vn, vd in view_data.items():
        u0, v0, u1, v1 = vd["bounds"]
        avail_w = CELL_W * VIEW_FIT_MARGIN - DIM_RESERVE
        avail_h = CELL_H * VIEW_FIT_MARGIN - DIM_RESERVE
        proj_w = (u1 - u0) * scale
        proj_h = (v1 - v0) * scale
        if proj_w > avail_w or proj_h > avail_h:
            clamp = min(avail_w / max(u1 - u0, 1e-6),
                        avail_h / max(v1 - v0, 1e-6))
            if clamp < scale:
                log(f"  View fit clamp pass-1: {vn} overflow → scale {scale:.3f} → {clamp:.3f}")
                scale = clamp

    # Pass 2: re-verify all views after global scale reduction
    for vn, vd in view_data.items():
        u0, v0, u1, v1 = vd["bounds"]
        avail_w = CELL_W * VIEW_FIT_MARGIN - DIM_RESERVE
        avail_h = CELL_H * VIEW_FIT_MARGIN - DIM_RESERVE
        proj_w = (u1 - u0) * scale
        proj_h = (v1 - v0) * scale
        if proj_w > avail_w or proj_h > avail_h:
            scale *= 0.92
            log(f"  View fit clamp pass-2: {vn} still overflows → scale * 0.92 = {scale:.3f}")
            break  # one additional reduction is enough

    if scale < original_scale * 0.50:
        log(f"  WARNING: scale reduced >50% ({original_scale:.3f} → {scale:.3f}), drawing may look small")

    # -- Render Views (2nd pass) --
    show_hidden = drawing_cfg.get("style", {}).get("show_hidden", True)
    show_cl = drawing_cfg.get("style", {}).get("show_centerlines", True)
    show_dims = drawing_cfg.get("style", {}).get("show_dimensions", True)
    tol_cfg = drawing_cfg.get("tolerances", {})
    # Plan-aware view options (Phase 19)
    plan_view_opts = config.get("drawing_plan", {}).get("views", {}).get("options", {})

    for vname, vd in view_data.items():
        vplan = plan_view_opts.get(vname, {})
        vh = vplan.get("show_hidden", show_hidden)
        vcl = vplan.get("show_centerlines", show_cl)
        # P0-1: ISO view — always hide hidden lines (KS/industrial practice)
        if vname == "iso":
            vh = vplan.get("show_hidden", False)
        is_iso = (vname == "iso")
        svg = render_view_svg(vname, vd["groups"], vd["bounds"], vd["circles"],
                              vd["cx"], vd["cy"], scale,
                              show_hidden=vh, show_centerlines=vcl,
                              simplify_iso=is_iso)
        # Append dimension lines (front/top/right only)
        if show_dims and vname != "iso":
            dim_style_cfg = config.get("drawing_plan", {}).get("style", {})
            dim_result = render_dimensions_svg(
                vname, vd["bounds"], vd["circles"],
                vd["cx"], vd["cy"], scale,
                arcs=vd.get("arcs"), tolerances=tol_cfg,
                return_stacks=True, style_cfg=dim_style_cfg)
            dim_svg, h_stk, v_stk = dim_result
            if dim_svg:
                svg += '\n' + dim_svg
            # Phase 20-A: plan-driven dimensions
            plan_intents = config.get("drawing_plan", {}).get("dim_intents", [])
            if plan_intents:
                try:
                    from _dim_plan import render_plan_dimensions_svg
                    auto_vals = _collect_auto_dim_values(vd)
                    req_only = plan_dim.get("required_only", False)
                    plan_svg, h_stk, v_stk = render_plan_dimensions_svg(
                        plan_intents, vname,
                        vd["bounds"], vd["circles"], vd.get("arcs", []),
                        vd["cx"], vd["cy"], scale, h_stk, v_stk,
                        existing_dim_values=auto_vals,
                        required_only=req_only,
                        style_cfg=dim_style_cfg)
                    if plan_svg:
                        svg += '\n' + plan_svg
                except Exception as e:
                    log(f"  Plan dims skipped ({vname}): {e}")
            datum_svg = render_datums_svg(vname, vd["bounds"], vd["cx"], vd["cy"], scale)
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

    # -- Annotation Planner (collision-free placement for callouts) --
    planner = AnnotationPlanner()
    # Pre-register dimension/datum regions as obstacles for each view
    for vn, vd in view_data.items():
        if vn == "iso":
            continue
        vb = vd["bounds"]
        vcx, vcy = vd["cx"], vd["cy"]
        bu0, bv0, bu1, bv1 = vb
        vbcx, vbcy = (bu0 + bu1) / 2, (bv0 + bv1) / 2
        # View edge region in page coords
        vl = vcx + (bu0 - vbcx) * scale
        vt = vcy - (bv1 - vbcy) * scale
        vr = vcx + (bu1 - vbcx) * scale
        vbot = vcy - (bv0 - vbcy) * scale
        # Register shape region (avoid placing annotations on top of geometry)
        planner.register(vl, vt, vr, vbot)
        # Register dimension zone below/right (DIM_OFFSET + 2 stacks)
        planner.register(vl, vbot + DIM_GAP, vr, vbot + DIM_OFFSET + FEAT_DIM_STACK * 2)
        planner.register(vr + DIM_GAP, vt, vr + DIM_OFFSET + FEAT_DIM_STACK * 2, vbot)

    # -- Surface Finish (ISO 1302) --
    extra_svg_parts = []
    sf_cfg = drawing_cfg.get("surface_finish")
    if sf_cfg:
        sf_svg = render_surface_finish_svg(sf_cfg, view_data, scale, planner=planner)
        if sf_svg:
            extra_svg_parts.append(sf_svg)
            log("  Surface finish: annotations added")

    # -- Chamfer Callouts --
    chamfer_cfg = drawing_cfg.get("chamfer")
    if chamfer_cfg and chamfer_cfg.get("show", True) and "front" in view_data:
        vd = view_data["front"]
        ch_svg = render_chamfer_callouts_svg(
            config, chamfer_cfg, vd["bounds"], vd["cx"], vd["cy"], scale,
            groups=vd.get("groups"), planner=planner)
        if ch_svg:
            views_svg["front"] += '\n' + ch_svg
            log("  Chamfer callouts: added to front view")

    # -- Thread Callouts --
    # Threads are visible as circles in the view perpendicular to the hole axis.
    # For Z-axis holes, that's the top view; try top first, then front.
    threads_cfg = drawing_cfg.get("threads")
    if threads_cfg:
        thread_placed = False
        for tv in ("top", "front", "right"):
            if tv not in view_data:
                continue
            vd = view_data[tv]
            if not vd["circles"]:
                continue
            th_svg = render_thread_callouts_svg(
                threads_cfg, config.get("shapes", []),
                vd["bounds"], vd["circles"], vd["cx"], vd["cy"], scale,
                planner=planner)
            if th_svg and th_svg.strip() != '<g class="thread-callouts">\n</g>':
                views_svg[tv] += '\n' + th_svg
                log(f"  Thread callouts: {len(threads_cfg)} threads on {tv} view")
                thread_placed = True
                break
        if not thread_placed:
            log("  Thread callouts: no matching circles found in any view")

    # -- Baseline/Ordinate Dimensions (if configured) --
    if dim_strategy in ("baseline", "ordinate") and feature_graph:
        for bv in ("front", "top", "right"):
            if bv not in view_data:
                continue
            vd = view_data[bv]
            # Build feature positions for baseline dims
            dim_features = []
            for f in feature_graph.by_type("hole") + feature_graph.by_type("bore"):
                pos = f.position
                if bv == "front":
                    dim_features.append({"position": (pos[0], pos[2] if len(pos) > 2 else 0),
                                         "label": f.id})
                elif bv == "top":
                    dim_features.append({"position": (pos[0], pos[1]),
                                         "label": f.id})
            if not dim_features:
                continue

            origin = (0, 0)
            if dim_strategy == "baseline":
                bl_style = config.get("drawing_plan", {}).get("style", {})
                bl_svg = render_baseline_dimensions_svg(
                    dim_features, origin, "horizontal",
                    vd["bounds"], vd["cx"], vd["cy"], scale,
                    style_cfg=bl_style)
                if bl_svg:
                    views_svg[bv] += '\n' + bl_svg
                    log(f"  Baseline dimensions: added to {bv}")
            elif dim_strategy == "ordinate":
                ord_svg = render_ordinate_dimensions_svg(
                    dim_features, origin, "horizontal",
                    vd["bounds"], vd["cx"], vd["cy"], scale)
                if ord_svg:
                    views_svg[bv] += '\n' + ord_svg
                    log(f"  Ordinate dimensions: added to {bv}")
            break  # Only add to one view

    # -- Auto GD&T --
    gdt_entries = []
    gdt_mode = drawing_cfg.get("gdt", {}).get("mode", "")
    if gdt_mode == "auto" and feature_graph:
        shape_dims = (bbox.XLength, bbox.YLength, bbox.ZLength)
        datums = auto_select_datums(feature_graph, shape_bbox=shape_dims)
        gdt_entries = auto_assign_gdt(feature_graph, datums)
        if gdt_entries:
            log(f"  Auto GD&T: {len(gdt_entries)} tolerances assigned")

    # -- Build Enhanced Notes (plan > auto) --
    plan_notes = config.get("drawing_plan", {}).get("notes", {})
    notes_list = None
    if plan_notes.get("general"):
        notes_list = list(plan_notes["general"])
    elif feature_graph:
        notes_list = build_general_notes(drawing_cfg, feature_graph, ks=True)

    # -- Compose Drawing --
    extra_svg = '\n'.join(extra_svg_parts)
    mates = (config.get("assembly", {}).get("mates", [])
             if is_assembly else [])
    tol_specs = config.get("tolerance", {}).get("specs", {})
    drawing_meta = dict(drawing_cfg.get("meta", {}))
    if sf_cfg:
        drawing_meta["_sf_default"] = sf_cfg.get("default", "")
    drawing_style = drawing_cfg.get("style", {})
    revisions = drawing_cfg.get("revisions", [])
    svg_content = compose_drawing(
        views_svg, model_name, bom, scale, bbox,
        mates=mates, tol_specs=tol_specs,
        meta=drawing_meta, style_cfg=drawing_style,
        extra_svg=extra_svg,
        revisions=revisions, notes_list=notes_list,
        gdt_entries=gdt_entries, feature_graph=feature_graph,
        view_data=view_data)

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
