"""Plan-driven dimension renderer: supplement auto-dims with plan dim_intents.

No FreeCAD imports — pure SVG generation using constants from generate_drawing.py.
Can be unit-tested independently.
"""

import math
from html import escape
import xml.etree.ElementTree as ET

from svg_common import iter_svg_elements
from _svg_utils import arrow_head as _arrow_head

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
    if best and best_diff <= max(1e-4, abs(target_r) * 1e-6):
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
    offset_mm = p.get("offset_mm", di.get("placement_offset_mm", 0.0))
    angle_deg = p.get("angle_deg", di.get("placement_angle_deg"))
    if not isinstance(offset_mm, (int, float)):
        offset_mm = 0.0
    return {
        "side": str(side).lower() if isinstance(side, str) else None,
        "offset_mm": float(offset_mm),
        "angle_deg": angle_deg if isinstance(angle_deg, (int, float)) else None,
    }


# ---- Dimension renderers ----

def _tolerance_text(di):
    """Carry a supplied tolerance through without inferring a new one."""
    value = di.get("tolerance", di.get("tol_text", ""))
    return str(value) if value is not None else ""


def _dimension_text(di):
    text = _format_value(di["value_mm"])
    tolerance = _tolerance_text(di)
    return text + (" " + tolerance if tolerance else "")


def _render_diameter(di, circles, cx, cy, scale, bcx, bcy,
                     annotation_planner=None, cell_bounds=None):
    """Reuse the coherent leader placement used by automatic dimensions."""
    from _drawing_svg import _dim_diameter

    value_mm = di.get("value_mm")
    if value_mm is None:
        return []
    circle = _find_closest_circle(value_mm, circles, scale)
    if not circle:
        return []
    cu, cv, cr = circle
    plc = _placement_cfg(di)
    angle_deg = plc.get("angle_deg")
    if angle_deg is None:
        angle_deg = _SIDE_TO_ANGLE.get(plc.get("side"), 45.0)
    elements = _dim_diameter(
        cx + (cu - bcx) * scale, cy - (cv - bcy) * scale,
        cr * scale, cr, angle_deg=angle_deg,
        annotation_planner=annotation_planner, cell_bounds=cell_bounds,
        leader_offset_mm=plc.get("offset_mm", 0),
        display_text="Ø" + _dimension_text(di),
    )
    identity = (f'data-dim-id="{escape(str(di.get("id", "")), quote=True)}" '
                f'data-value-mm="{escape(str(value_mm), quote=True)}"')
    return [element.replace("<text ", "<text " + identity + " ", 1)
            if element.startswith("<text ") else element for element in elements]


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
    text = escape(_dimension_text(di))
    dim_id = escape(str(di.get("id", "")), quote=True)
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
    text = escape(_dimension_text(di))
    dim_id = escape(str(di.get("id", "")), quote=True)
    out.append(f'<text x="{tx:.2f}" y="{ty:.2f}" text-anchor="middle" '
               f'font-family="{DIM_FONT}" font-size="{DIM_FONT_SIZE}" '
               f'fill="{DIM_COLOR}" data-dim-id="{dim_id}" '
               f'data-value-mm="{value_mm}" '
               f'transform="rotate(-90,{tx:.2f},{ty:.2f})">{text}</text>')

    return out, v_stack + 1


def _fragment_score(elements, annotation_planner=None, cell_bounds=None):
    """Use the shared page-space SVG bounds for bounded layout candidates."""
    score, overflow = 0.0, 0.0
    tree = ET.fromstring("<svg>" + "".join(elements) + "</svg>")
    for element, _classes, box in iter_svg_elements(tree):
        if box is None:
            return float("inf"), float("inf")
        if cell_bounds:
            x0, y0, x1, y1 = cell_bounds
            overflow += (max(0, x0 - box.x) + max(0, box.x + box.w - x1)
                         + max(0, y0 - box.y) + max(0, box.y + box.h - y1))
        if annotation_planner is not None:
            padding = 0.4 if element.tag.endswith("line") else 0.2
            score += annotation_planner.overlap_score(
                box.x - padding, box.y - padding,
                box.x + box.w + padding, box.y + box.h + padding)
    return score, overflow


def _render_review_marker(di, cx, cy, h_stack, annotation_planner=None,
                          cell_bounds=None):
    """Mark an unresolved intent without pretending its value was rendered."""
    fid = str(di.get("id", "?"))
    text = "[REVIEW: " + fid + "]"
    # Keep identity on a review-specific attribute: dimension-presence QA must
    # not consume this marker as evidence for the unresolved nominal.
    width = len(text) * 2.5 * 0.55
    x, y = cx, cy + 30 + h_stack * 5
    if cell_bounds:
        x0, y0, x1, y1 = cell_bounds
        x = max(x0 + width / 2 + 1, min(cx, x1 - width / 2 - 1))
        candidates = [(x - width / 2, y1 - 5 - row * 4) for row in range(5)]
        if annotation_planner is not None:
            bx, by = annotation_planner.find_best_position(candidates, width, 3)
            x, y = bx + width / 2, by + 2.5
        else:
            y = candidates[0][1] + 2.5
    elements = [f'<text class="review-marker" data-review-dim-id="{escape(fid, quote=True)}" '
                f'x="{x:.2f}" y="{y:.2f}" text-anchor="middle" '
                f'font-family="{DIM_FONT}" font-size="2.5" '
                f'fill="{REVIEW_COLOR}" font-weight="bold">{escape(text)}</text>']
    if annotation_planner is not None:
        annotation_planner.register_svg("".join(elements))
    return elements


def _linear_anchor_reason(di, bounds):
    """Only overall spans with matching measured projection are resolved here.

    Named feature endpoints and datum references are not available to this
    renderer. A numerically coincident auto dimension is not that evidence.
    """
    fid = str(di.get("id", "")).upper()
    if fid not in H_FEATURES and fid not in V_FEATURES:
        return "linear_feature_anchor_unavailable"
    u0, v0, u1, v1 = bounds
    extent = abs(v1 - v0) if fid in V_FEATURES else abs(u1 - u0)
    value = di.get("value_mm")
    if not math.isclose(value, extent, rel_tol=1e-6, abs_tol=1e-4):
        return "linear_value_does_not_match_projected_extent"
    return None


def _place_linear(di, bounds, cx, cy, scale, bcx, bcy, stack, vertical,
                  gap, offset, overshoot, annotation_planner, cell_bounds):
    renderer = _render_linear_v if vertical else _render_linear_h
    rows = range(stack, stack + 6) if annotation_planner is not None else (stack,)
    best = None
    for row in rows:
        elements, next_row = renderer(di, bounds, cx, cy, scale, bcx, bcy, row,
                                     gap=gap, offset=offset, overshoot=overshoot)
        score, overflow = _fragment_score(elements, annotation_planner, cell_bounds)
        if overflow > 1e-6:
            continue
        candidate = (score + (row - stack) * 0.01, elements, next_row)
        if best is None or candidate[0] < best[0]:
            best = candidate
    if best is None:
        return [], stack
    if annotation_planner is not None:
        annotation_planner.register_svg("".join(best[1]))
    return best[1], best[2]


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
    existing_auto_dims=None, dedupe_policy="smart", dedupe_tol_mm=0.5,
    process_groups=None, annotation_planner=None, cell_bounds=None,
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
    out.append(f'<g class="dimensions-{vname} plan-dimensions-{vname}" stroke="{DIM_COLOR}" '
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
        for key in ("tolerance", "tolerance_mm", "tol_text"):
            if key in di:
                rec[key] = di[key]
        if reason:
            rec["reason"] = reason
        if extra and isinstance(extra, dict):
            rec.update(extra)
        telemetry.setdefault("plan_dimensions", []).append(rec)

    # D4 manufacturing: track process group for inter-group gap
    _prev_process_step = None
    opposite_stacks = {"top": 0, "left": 0}

    for di in dim_intents:
        if not _intent_matches_view(di, vname):
            continue

        # D3: skip non-required intents when required_only mode is active
        if required_only and not di.get("required", True):
            _record(di, "skipped_required_only", reason="required_only_mode")
            continue

        # D4: apply extra gap between process groups
        if process_groups and di.get("process_step"):
            cur_step = di["process_step"]
            if _prev_process_step and cur_step != _prev_process_step:
                # Add one extra stack slot between process groups.
                h_stack += 1
                v_stack += 1
            _prev_process_step = cur_step

        style = di.get("style", "linear")
        value_mm = di.get("value_mm")
        fid = str(di.get("id", "")).upper()

        if value_mm is not None and style == "linear" and fid not in DIA_FEATURES:
            anchor_reason = _linear_anchor_reason(di, bounds)
            if anchor_reason:
                out.extend(_render_review_marker(di, cx, cy, h_stack,
                    annotation_planner=annotation_planner, cell_bounds=cell_bounds))
                _record(di, "skipped_no_anchor", reason=anchor_reason)
                continue

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
                out.extend(_render_review_marker(di, cx, cy, h_stack,
                    annotation_planner=annotation_planner, cell_bounds=cell_bounds))
                _record(di, "missing_value", reason="required_dim_missing_value")
            else:
                _record(di, "missing_value_optional", reason="optional_dim_missing_value")
            continue

        # Route by style
        if style == "diameter" or (style == "linear" and fid in DIA_FEATURES):
            if circles:
                elems = _render_diameter(di, circles, cx, cy, scale, bcx, bcy,
                    annotation_planner=annotation_planner, cell_bounds=cell_bounds)
                out.extend(elems)
                if elems:
                    _record(di, "rendered", rendered=True)
                else:
                    _record(di, "skipped_no_anchor", reason="no_matching_circle")
            else:
                _record(di, "skipped_view", reason="diameter_intent_requires_circular_view")
        elif style == "linear":
            vertical = fid in V_FEATURES
            side = _placement_cfg(di).get("side") or ("right" if vertical else "bottom")
            opposite = "left" if vertical else "top"
            on_opposite = side in (("left", "top_left", "bottom_left") if vertical
                                  else ("top", "top_left", "top_right"))
            stack = opposite_stacks[opposite] if on_opposite else (v_stack if vertical else h_stack)
            elems, next_stack = _place_linear(
                di, bounds, cx, cy, scale, bcx, bcy, stack, vertical,
                eff_gap, eff_offset, eff_overshoot, annotation_planner, cell_bounds)
            if elems:
                out.extend(elems)
                if on_opposite:
                    opposite_stacks[opposite] = next_stack
                elif vertical:
                    v_stack = next_stack
                else:
                    h_stack = next_stack
                _record(di, "rendered", rendered=True,
                        extra={"anchor_evidence": "matching_projected_extent"})
            else:
                out.extend(_render_review_marker(di, cx, cy, h_stack,
                    annotation_planner=annotation_planner, cell_bounds=cell_bounds))
                _record(di, "skipped_layout", reason="linear_dimension_outside_cell")
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
