"""SVG rendering helpers extracted from generate_drawing.py."""

import math

from _annotation_planner import AnnotationPlanner
from _drawing_constants import (
    PAGE_W,
    PAGE_H,
    MARGIN,
    TITLE_H,
    CELL_W,
    CELL_H,
    EDGE_NAMES,
    LINE_STYLES,
    LINE_CAP,
    LINE_JOIN,
    RENDER_ORDER,
    DIM_LINE_W,
    DIM_COLOR,
    DIM_FONT,
    DIM_FONT_SIZE,
    DIM_GAP,
    DIM_OFFSET,
    DIM_EXT_OVERSHOOT,
    FEAT_DIM_STACK,
    SF_V_HEIGHT,
    SF_BAR_W,
    SF_FONT_SIZE,
    SF_LINE_W,
    SF_LEADER_W,
)
from _svg_utils import escape as _escape, arrow_head as _arrow_head

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
                          style_cfg=None, telemetry=None, dedupe_state=None):
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

    def _record_dim(kind, value_mm, *, detail=None):
        if telemetry is None:
            return
        idx = len(telemetry.setdefault("auto_dimensions", [])) + 1
        dim_id = f"auto_{vname}_{idx:03d}"
        rec = {
            "dim_id": dim_id,
            "source": "auto",
            "view": vname,
            "category": kind,
            "value_mm": round(float(value_mm), 3) if isinstance(value_mm, (int, float)) else value_mm,
            "status": "rendered",
            "drawing_object_id": f"svg:dimensions-{vname}:{dim_id}",
        }
        if detail:
            rec.update(detail)
        telemetry["auto_dimensions"].append(rec)

    def _record_conflict(kind, reason, *, severity="warning", detail=None):
        if telemetry is None:
            return
        rec = {
            "view": vname,
            "category": kind,
            "reason": reason,
            "severity": severity,
        }
        if detail:
            rec.update(detail)
        telemetry.setdefault("conflicts", []).append(rec)

    def _is_redundant_across_views(family, value_mm):
        if not dedupe_state or not dedupe_state.get("enabled", False):
            return False
        if not isinstance(value_mm, (int, float)):
            return False
        base_tol = dedupe_state.get("tol_mm", 0.5)
        tol = max(base_tol, 0.002 * abs(value_mm))
        seen = dedupe_state.setdefault("seen", [])
        for it in seen:
            if it.get("family") != family:
                continue
            if abs(it.get("value_mm", 0.0) - value_mm) <= tol:
                return True
        seen.append({"family": family, "value_mm": value_mm, "view": vname})
        return False

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
        if _is_redundant_across_views("linear_h", width_mm):
            _record_conflict("overall_width", "cross_view_redundant",
                             severity="info", detail={"value_mm": round(width_mm, 3)})
        elif y_dim < cell_bottom:
            out.extend(_dim_horizontal(left, right, bottom, y_dim, width_mm,
                                       tol_text=gen_tol))
            _record_dim("overall_width", width_mm)
            h_stack += 1
        else:
            _record_conflict("overall_width", "cell_bottom_limit",
                             detail={"value_mm": round(width_mm, 3)})

    # Overall height (vertical, right of shape)
    height_mm = (v1 - v0)
    if height_mm > 0.5:
        x_dim = right + eff_dim_offset + eff_feat_stack * v_stack
        if _is_redundant_across_views("linear_v", height_mm):
            _record_conflict("overall_height", "cross_view_redundant",
                             severity="info", detail={"value_mm": round(height_mm, 3)})
        elif x_dim < cell_right:
            out.extend(_dim_vertical(top, bottom, right, x_dim, height_mm,
                                     tol_text=gen_tol))
            _record_dim("overall_height", height_mm)
            v_stack += 1
        else:
            _record_conflict("overall_height", "cell_right_limit",
                             detail={"value_mm": round(height_mm, 3)})

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
        dia_mm = cr * 2
        if _is_redundant_across_views("diameter", dia_mm):
            _record_conflict("hole_diameter", "cross_view_redundant",
                             severity="info", detail={"value_mm": round(dia_mm, 3)})
            continue
        out.extend(_dim_diameter(px, py, r_scaled, cr, angle_deg=leader_angle,
                                 tol_text=hole_tol,
                                 cell_bounds=(cell_x0, cell_y0, cell_right, cell_bottom)))
        _record_dim("hole_diameter", dia_mm, detail={"center_uv": [round(cu, 3), round(cv, 3)]})
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
                    if _is_redundant_across_views("linear_h", dist):
                        _record_conflict("chain_horizontal", "cross_view_redundant",
                                         severity="info", detail={"value_mm": round(dist, 3)})
                        continue
                    out.extend(_dim_horizontal(px1, px2, bottom, y_feat, dist))
                    _record_dim("chain_horizontal", dist)
                h_stack += 1
            else:
                _record_conflict("chain_horizontal", "cell_bottom_limit",
                                 detail={"segments": len(h_segments)})
        elif h_segments:
            _record_conflict("chain_horizontal", "stack_limit",
                             detail={"segments": len(h_segments), "max_stacks": max_h_stacks})

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
                    if _is_redundant_across_views("linear_v", dist):
                        _record_conflict("chain_vertical", "cross_view_redundant",
                                         severity="info", detail={"value_mm": round(dist, 3)})
                        continue
                    out.extend(_dim_vertical(py_top, py_bot, right, x_feat, dist))
                    _record_dim("chain_vertical", dist)
                v_stack += 1
            else:
                _record_conflict("chain_vertical", "cell_right_limit",
                                 detail={"segments": len(v_segments)})
        elif v_segments:
            _record_conflict("chain_vertical", "stack_limit",
                             detail={"segments": len(v_segments), "max_stacks": max_v_stacks})

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
            if _is_redundant_across_views("radius", r):
                _record_conflict("radius", "cross_view_redundant",
                                 severity="info", detail={"value_mm": round(r, 3)})
                continue
            cx_pg, cy_pg = pg(c_u, c_v)
            mx_pg, my_pg = pg(m_u, m_v)
            out.extend(_dim_radius(cx_pg, cy_pg, mx_pg, my_pg, r_scaled, r))
            _record_dim("radius", r, detail={"center_uv": [round(c_u, 3), round(c_v, 3)]})

    out.append('</g>')
    result = '\n'.join(out)
    if return_stacks:
        return result, h_stack, v_stack
    return result
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
