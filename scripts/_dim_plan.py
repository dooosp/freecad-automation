"""Plan-driven dimension renderer: supplement auto-dims with plan dim_intents.

No FreeCAD imports — pure SVG generation using constants from generate_drawing.py.
Can be unit-tested independently.
"""

import math

# ---- Constants (duplicated from generate_drawing.py to avoid FreeCAD import) ----
DIM_LINE_W = "0.18"
DIM_COLOR = "#000"
DIM_FONT = "sans-serif"
DIM_FONT_SIZE = "3"
DIM_ARROW_L = 2.0
DIM_ARROW_W = 0.7
DIM_GAP = 2.0
DIM_OFFSET = 8.0
DIM_EXT_OVERSHOOT = 1.5
REVIEW_COLOR = "#D00"  # red for review markers


def _arrow_head(x, y, angle):
    """SVG polygon for a filled arrowhead pointing in `angle` radians."""
    ca, sa = math.cos(angle), math.sin(angle)
    bx = x - DIM_ARROW_L * ca
    by = y - DIM_ARROW_L * sa
    lx = bx + DIM_ARROW_W * sa
    ly = by - DIM_ARROW_W * ca
    rx = bx - DIM_ARROW_W * sa
    ry = by + DIM_ARROW_W * ca
    return (f'<polygon points="{x:.2f},{y:.2f} {lx:.2f},{ly:.2f} '
            f'{rx:.2f},{ry:.2f}" fill="{DIM_COLOR}"/>')


def _style_bucket(di):
    """Map plan dim_intent to a coarse style bucket for dedupe matching."""
    style = (di.get("style") or "linear").lower()
    fid = (di.get("id") or "").upper()
    if style == "diameter" or fid in DIA_FEATURES:
        return "diameter"
    if style == "linear" and fid in V_FEATURES:
        return "linear_v"
    if style == "linear":
        return "linear_h"
    if style in ("radius", "callout", "note"):
        return style
    return "other"


def _auto_categories_for_bucket(bucket):
    if bucket == "diameter":
        return {"hole_diameter"}
    if bucket == "linear_h":
        return {"overall_width", "chain_horizontal"}
    if bucket == "linear_v":
        return {"overall_height", "chain_vertical"}
    if bucket == "radius":
        return {"radius"}
    return set()


def _find_auto_dedupe_match(di, existing_auto_dims, existing_values=None,
                            dedupe_policy="smart", tol=0.5):
    """Return dedupe match details if this plan dim duplicates auto dims.

    dedupe_policy:
      - off: never dedupe
      - value_only: value tolerance only
      - smart(default): value + style/category compatibility
    """
    value_mm = di.get("value_mm")
    if value_mm is None:
        return None

    policy = (dedupe_policy or "smart").lower()
    if policy == "off":
        return None

    dyn_tol = max(tol, 0.002 * abs(value_mm))

    # Legacy numeric dedupe fallback (for backward compatibility)
    if not existing_auto_dims and existing_values:
        for ev in existing_values:
            delta = abs(ev - value_mm)
            if delta <= dyn_tol:
                return {
                    "auto_dim_id": None,
                    "auto_category": None,
                    "auto_value_mm": ev,
                    "delta_mm": round(delta, 4),
                    "bucket": _style_bucket(di),
                    "policy": policy,
                    "source": "legacy_values",
                }

    if not existing_auto_dims:
        return None

    bucket = _style_bucket(di)
    allowed = _auto_categories_for_bucket(bucket)

    best = None
    for ad in existing_auto_dims:
        av = ad.get("value_mm")
        if not isinstance(av, (int, float)):
            continue
        cat = ad.get("category")
        if policy == "smart" and allowed and cat not in allowed:
            continue
        delta = abs(av - value_mm)
        if delta <= dyn_tol:
            cand = {
                "auto_dim_id": ad.get("dim_id"),
                "auto_category": cat,
                "auto_value_mm": av,
                "delta_mm": round(delta, 4),
                "bucket": bucket,
                "policy": policy,
                "source": "auto_dimensions",
            }
            if best is None or delta < best["delta_mm"]:
                best = cand

    return best


def _format_value(value_mm):
    """Format dimension value for display."""
    if value_mm == int(value_mm):
        return str(int(value_mm))
    return f"{value_mm:.1f}"


def _find_closest_circle(value_mm, circles, scale):
    """Find circle closest to the given diameter value.

    circles: list of (cu, cv, cr) in model coordinates.
    Returns (px, py, r_scaled) in page coords or None.
    """
    target_r = value_mm / 2
    best = None
    best_diff = float("inf")
    for cu, cv, cr in circles:
        diff = abs(cr - target_r)
        if diff < best_diff:
            best_diff = diff
            best = (cu, cv, cr)
    if best and best_diff < target_r * 0.3:  # within 30%
        return best
    return None


# ---- Placement hints ----

_SIDE_TO_ANGLE = {
    "right": 20.0,
    "top_right": 45.0,
    "top": 70.0,
    "top_left": 120.0,
    "left": 160.0,
    "bottom_left": 230.0,
    "bottom": 290.0,
    "bottom_right": 330.0,
}


def _placement_cfg(di):
    """Extract optional placement hints from dim_intent.

    Supports:
      placement = { side = "...", offset_mm = N, angle_deg = N }
      placement_side / placement_offset_mm / placement_angle_deg
    """
    p = di.get("placement")
    if not isinstance(p, dict):
        p = {}
    side = p.get("side", di.get("placement_side"))
    offset_mm = p.get("offset_mm", di.get("placement_offset_mm"))
    angle_deg = p.get("angle_deg", di.get("placement_angle_deg"))
    return {
        "side": str(side).lower() if isinstance(side, str) else None,
        "offset_mm": offset_mm if isinstance(offset_mm, (int, float)) else None,
        "angle_deg": angle_deg if isinstance(angle_deg, (int, float)) else None,
    }


# ---- Dimension renderers ----

def _render_diameter(di, circles, cx, cy, scale, bcx, bcy):
    """Render a diameter dimension for a plan intent."""
    value_mm = di.get("value_mm")
    if value_mm is None:
        return []

    circle = _find_closest_circle(value_mm, circles, scale)
    if not circle:
        return []

    cu, cv, cr = circle
    px = cx + (cu - bcx) * scale
    py = cy - (cv - bcy) * scale
    r_scaled = cr * scale

    out = []
    plc = _placement_cfg(di)
    angle_deg = plc.get("angle_deg")
    if angle_deg is None and plc.get("side") in _SIDE_TO_ANGLE:
        angle_deg = _SIDE_TO_ANGLE[plc["side"]]
    if angle_deg is None:
        angle_deg = 45.0
    angle = math.radians(angle_deg)
    leader_len = max(min(r_scaled * 0.8, 20), 6)
    if plc.get("offset_mm") is not None:
        leader_len = max(4.0, leader_len + plc["offset_mm"])
    shelf_len = 8

    sx = px + r_scaled * math.cos(angle)
    sy = py - r_scaled * math.sin(angle)
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
    # Arrow
    arr_angle = math.atan2(-(sy - py), sx - px)
    out.append(_arrow_head(sx, sy, arr_angle))
    # Text
    text = f"\u00d8{_format_value(value_mm)}"
    anchor = "start" if shelf_dir >= 0 else "end"
    tx = shx + 0.5 * shelf_dir
    ty = ey - 0.5
    dim_id = di.get("id", "")
    out.append(f'<text x="{tx:.2f}" y="{ty:.2f}" text-anchor="{anchor}" '
               f'font-family="{DIM_FONT}" font-size="{DIM_FONT_SIZE}" '
               f'fill="{DIM_COLOR}" data-dim-id="{dim_id}" '
               f'data-value-mm="{value_mm}">{text}</text>')
    return out


def _render_linear_h(di, bounds, cx, cy, scale, bcx, bcy, h_stack,
                     gap=None, offset=None, overshoot=None):
    """Render a horizontal linear dimension (bottom by default, top optional)."""
    value_mm = di.get("value_mm")
    if value_mm is None:
        return [], h_stack

    _gap = gap if gap is not None else DIM_GAP
    _offset = offset if offset is not None else DIM_OFFSET
    _overshoot = overshoot if overshoot is not None else DIM_EXT_OVERSHOOT

    u0, v0, u1, v1 = bounds
    left = cx + (u0 - bcx) * scale
    right = cx + (u1 - bcx) * scale
    top = cy - (v1 - bcy) * scale
    bottom = cy - (v0 - bcy) * scale

    plc = _placement_cfg(di)
    side = plc.get("side")
    side_top = side in ("top", "top_left", "top_right")
    extra = plc.get("offset_mm", 0.0)
    if side_top:
        y_dim = top - (_gap + _offset + h_stack * _offset + extra)
    else:
        y_dim = bottom + _gap + _offset + h_stack * _offset + extra

    out = []
    # Extension lines
    if side_top:
        out.append(f'<line x1="{left:.2f}" y1="{top-_gap:.2f}" '
                   f'x2="{left:.2f}" y2="{y_dim+_overshoot:.2f}"/>')
        out.append(f'<line x1="{right:.2f}" y1="{top-_gap:.2f}" '
                   f'x2="{right:.2f}" y2="{y_dim+_overshoot:.2f}"/>')
    else:
        out.append(f'<line x1="{left:.2f}" y1="{bottom+_gap:.2f}" '
                   f'x2="{left:.2f}" y2="{y_dim-_overshoot:.2f}"/>')
        out.append(f'<line x1="{right:.2f}" y1="{bottom+_gap:.2f}" '
                   f'x2="{right:.2f}" y2="{y_dim-_overshoot:.2f}"/>')
    # Dimension line
    out.append(f'<line x1="{left:.2f}" y1="{y_dim:.2f}" '
               f'x2="{right:.2f}" y2="{y_dim:.2f}"/>')
    # Arrows
    out.append(_arrow_head(left, y_dim, 0))
    out.append(_arrow_head(right, y_dim, math.pi))
    # Text
    tx = (left + right) / 2
    ty = y_dim - 1.0 if not side_top else y_dim + 3.2
    text = _format_value(value_mm)
    dim_id = di.get("id", "")
    out.append(f'<text x="{tx:.2f}" y="{ty:.2f}" text-anchor="middle" '
               f'font-family="{DIM_FONT}" font-size="{DIM_FONT_SIZE}" '
               f'fill="{DIM_COLOR}" data-dim-id="{dim_id}" '
               f'data-value-mm="{value_mm}">{text}</text>')

    return out, h_stack + 1


def _render_linear_v(di, bounds, cx, cy, scale, bcx, bcy, v_stack,
                     gap=None, offset=None, overshoot=None):
    """Render a vertical linear dimension (right by default, left optional)."""
    value_mm = di.get("value_mm")
    if value_mm is None:
        return [], v_stack

    _gap = gap if gap is not None else DIM_GAP
    _offset = offset if offset is not None else DIM_OFFSET
    _overshoot = overshoot if overshoot is not None else DIM_EXT_OVERSHOOT

    u0, v0, u1, v1 = bounds
    left = cx + (u0 - bcx) * scale
    right = cx + (u1 - bcx) * scale
    top = cy - (v1 - bcy) * scale
    bottom = cy - (v0 - bcy) * scale

    plc = _placement_cfg(di)
    side = plc.get("side")
    side_left = side in ("left", "top_left", "bottom_left")
    extra = plc.get("offset_mm", 0.0)
    if side_left:
        x_dim = left - (_gap + _offset + v_stack * _offset + extra)
    else:
        x_dim = right + _gap + _offset + v_stack * _offset + extra

    out = []
    # Extension lines
    if side_left:
        out.append(f'<line x1="{left+_gap:.2f}" y1="{top:.2f}" '
                   f'x2="{x_dim-_overshoot:.2f}" y2="{top:.2f}"/>')
        out.append(f'<line x1="{left+_gap:.2f}" y1="{bottom:.2f}" '
                   f'x2="{x_dim-_overshoot:.2f}" y2="{bottom:.2f}"/>')
    else:
        out.append(f'<line x1="{right-_gap:.2f}" y1="{top:.2f}" '
                   f'x2="{x_dim+_overshoot:.2f}" y2="{top:.2f}"/>')
        out.append(f'<line x1="{right-_gap:.2f}" y1="{bottom:.2f}" '
                   f'x2="{x_dim+_overshoot:.2f}" y2="{bottom:.2f}"/>')
    # Dimension line
    out.append(f'<line x1="{x_dim:.2f}" y1="{top:.2f}" '
               f'x2="{x_dim:.2f}" y2="{bottom:.2f}"/>')
    # Arrows
    if side_left:
        out.append(_arrow_head(x_dim, top, math.pi / 2))
        out.append(_arrow_head(x_dim, bottom, -math.pi / 2))
    else:
        out.append(_arrow_head(x_dim, top, -math.pi / 2))
        out.append(_arrow_head(x_dim, bottom, math.pi / 2))
    # Text
    tx = x_dim - 1.5 if not side_left else x_dim + 1.5
    ty = (top + bottom) / 2
    text = _format_value(value_mm)
    dim_id = di.get("id", "")
    out.append(f'<text x="{tx:.2f}" y="{ty:.2f}" text-anchor="middle" '
               f'font-family="{DIM_FONT}" font-size="{DIM_FONT_SIZE}" '
               f'fill="{DIM_COLOR}" data-dim-id="{dim_id}" '
               f'data-value-mm="{value_mm}" '
               f'transform="rotate(-90,{tx:.2f},{ty:.2f})">{text}</text>')

    return out, v_stack + 1


def _render_review_marker(di, cx, cy, h_stack):
    """Render a red REVIEW marker for missing value_mm."""
    fid = di.get("id", "?")
    y = cy + 30 + h_stack * 5
    return [f'<text x="{cx:.2f}" y="{y:.2f}" text-anchor="middle" '
            f'font-family="{DIM_FONT}" font-size="2.5" '
            f'fill="{REVIEW_COLOR}" font-weight="bold">'
            f'[REVIEW: {fid}]</text>']


# ---- View-to-feature routing ----

# Feature IDs that map to horizontal dimensions
H_FEATURES = {"OD", "ID", "PCD", "BOLT_DIA", "WIDTH", "BASE_W",
              "TOTAL_LENGTH", "DEPTH", "BORE_ID", "BEARING_SEAT"}
# Feature IDs that map to vertical dimensions
V_FEATURES = {"THK", "HEIGHT", "WEB_H", "WALL_THK"}
# Feature IDs that map to diameter dimensions
DIA_FEATURES = {"OD", "ID", "PCD", "BOLT_DIA", "BORE_ID",
                "BEARING_SEAT", "BUSHING_DIA", "OD1", "OD2",
                "STEP_DIAMETERS", "HOLE_DIA"}


def _intent_matches_view(di, vname):
    """Check if a dim_intent targets this view."""
    target = di.get("view", "")
    if not target:
        return True  # no view constraint → show in any
    return target == vname


def render_plan_dimensions_svg(
    dim_intents, vname, bounds, circles, arcs,
    cx, cy, scale, h_stack, v_stack,
    existing_dim_values=None, required_only=False,
    style_cfg=None, telemetry=None,
    existing_auto_dims=None, dedupe_policy="smart", dedupe_tol_mm=0.5
):
    """Render plan-driven dimensions for a specific view.

    Only renders dimensions whose value_mm is NOT already placed by auto-dims.
    Missing value_mm → red REVIEW marker if required.
    style_cfg: optional dict with dim_offset/dim_gap/dim_ext_overshoot overrides.

    telemetry: optional dict sink to collect traceability records.

    Returns: (svg_string, new_h_stack, new_v_stack)
    """
    if not dim_intents or vname == "iso":
        return "", h_stack, v_stack

    # Effective spacing from style_cfg or module defaults
    _sc = style_cfg or {}
    eff_gap = _sc.get("dim_gap", DIM_GAP)
    eff_offset = _sc.get("dim_offset", DIM_OFFSET)
    eff_overshoot = _sc.get("dim_ext_overshoot", DIM_EXT_OVERSHOOT)

    u0, v0, u1, v1 = bounds
    bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

    out = []
    out.append(f'<g class="plan-dimensions-{vname}" stroke="{DIM_COLOR}" '
               f'stroke-width="{DIM_LINE_W}" fill="none">')

    def _record(di, status, *, reason=None, rendered=False, extra=None):
        if telemetry is None:
            return
        rec = {
            "dim_id": di.get("id", ""),
            "feature": di.get("feature", ""),
            "view": vname,
            "style": di.get("style", "linear"),
            "required": bool(di.get("required", False)),
            "value_mm": di.get("value_mm"),
            "source": "plan",
            "status": status,
            "rendered": bool(rendered),
            "drawing_object_id": (
                f"svg:plan-dimensions-{vname}:{di.get('id', '')}"
                if rendered else None
            ),
        }
        if reason:
            rec["reason"] = reason
        if extra and isinstance(extra, dict):
            rec.update(extra)
        telemetry.setdefault("plan_dimensions", []).append(rec)

    for di in dim_intents:
        if not _intent_matches_view(di, vname):
            continue

        # D3: skip non-required intents when required_only mode is active
        if required_only and not di.get("required", True):
            _record(di, "skipped_required_only", reason="required_only_mode")
            continue

        style = di.get("style", "linear")
        value_mm = di.get("value_mm")
        fid = di.get("id", "")

        # Skip if already placed by auto-dims (policy-driven)
        dedupe_match = _find_auto_dedupe_match(
            di,
            existing_auto_dims=existing_auto_dims,
            existing_values=existing_dim_values,
            dedupe_policy=dedupe_policy,
            tol=dedupe_tol_mm if isinstance(dedupe_tol_mm, (int, float)) else 0.5,
        )
        if dedupe_match:
            _record(
                di, "skipped_duplicate", reason="already_in_auto_dims",
                extra={"dedupe_match": dedupe_match}
            )
            if telemetry is not None:
                telemetry.setdefault("conflicts", []).append({
                    "view": vname,
                    "category": "dedupe",
                    "reason": "plan_dim_skipped_due_to_auto_match",
                    "severity": "info",
                    "dim_id": di.get("id", ""),
                    "auto_dim_id": dedupe_match.get("auto_dim_id"),
                    "delta_mm": dedupe_match.get("delta_mm"),
                })
            continue

        # No value → review marker
        if value_mm is None:
            if di.get("required"):
                out.extend(_render_review_marker(di, cx, cy, h_stack))
                _record(di, "missing_value", reason="required_dim_missing_value")
            else:
                _record(di, "missing_value_optional", reason="optional_dim_missing_value")
            continue

        # Route by style
        if style == "diameter" or (style == "linear" and fid in DIA_FEATURES):
            if vname == "front":
                elems = _render_diameter(di, circles, cx, cy, scale, bcx, bcy)
                out.extend(elems)
                if elems:
                    _record(di, "rendered", rendered=True)
                else:
                    _record(di, "skipped_no_anchor", reason="no_matching_circle")
            else:
                _record(di, "skipped_view", reason="diameter_intent_front_only")
        elif style == "linear":
            if fid in V_FEATURES:
                elems, v_stack = _render_linear_v(
                    di, bounds, cx, cy, scale, bcx, bcy, v_stack,
                    gap=eff_gap, offset=eff_offset, overshoot=eff_overshoot)
                out.extend(elems)
                if elems:
                    _record(di, "rendered", rendered=True)
                else:
                    _record(di, "skipped_layout", reason="vertical_linear_layout_failed")
            else:
                elems, h_stack = _render_linear_h(
                    di, bounds, cx, cy, scale, bcx, bcy, h_stack,
                    gap=eff_gap, offset=eff_offset, overshoot=eff_overshoot)
                out.extend(elems)
                if elems:
                    _record(di, "rendered", rendered=True)
                else:
                    _record(di, "skipped_layout", reason="horizontal_linear_layout_failed")
        elif style == "radius":
            _record(di, "delegated", reason="radius_auto_dim")
        elif style == "callout":
            _record(di, "delegated", reason="callout_renderer")
        elif style == "note":
            _record(di, "delegated", reason="notes_renderer")
        # angular, unknown → skip
        else:
            _record(di, "skipped_style", reason=f"unsupported_style:{style}")

    out.append('</g>')
    result = '\n'.join(out)

    # Empty group check (only <g> and </g>)
    if result.count('\n') <= 1:
        return "", h_stack, v_stack

    return result, h_stack, v_stack
