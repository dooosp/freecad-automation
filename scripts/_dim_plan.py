"""Plan-driven dimension renderer: supplement auto-dims with plan dim_intents.

No FreeCAD imports — pure SVG generation using constants from generate_drawing.py.
Can be unit-tested independently.
"""

import math
import xml.etree.ElementTree as ET
from html import escape
from _svg_utils import arrow_head as _arrow_head
from svg_common import cell_bbox, elem_bbox_approx, local_tag, svg_contexts

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


def _style_bucket(di, vname=None):
    """Map plan dim_intent to a coarse style bucket for dedupe matching."""
    style = (di.get("style") or "linear").lower()
    fid = (di.get("id") or "").upper()
    if style == "diameter" or fid in DIA_FEATURES:
        return "diameter"
    # In the top view, box width (model Y) is vertical, not model X.
    top_base_width = ((vname or di.get("view")) == "top"
                      and (di.get("feature") == "base_width" or fid == "BASE_W"))
    if style == "linear" and (fid in V_FEATURES or top_base_width):
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
                            dedupe_policy="smart", tol=0.5, vname=None):
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
                    "bucket": _style_bucket(di, vname),
                    "policy": policy,
                    "source": "legacy_values",
                }

    if not existing_auto_dims:
        return None

    bucket = _style_bucket(di, vname)
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

def _render_diameter(di, circles, cx, cy, scale, bcx, bcy,
                     svg_element_id=None, anchor_evidence=None, runtime_binding=None):
    """Render a diameter dimension for a plan intent."""
    value_mm = di.get("value_mm")
    if value_mm is None:
        return []

    circle = (runtime_binding.get('circle_uv_mm') if runtime_binding
              else _find_closest_circle(value_mm, circles, scale))
    if not circle:
        return []

    cu, cv, cr = circle
    if anchor_evidence is not None:
        anchor_evidence.update(center_uv=[cu, cv], svg_element_id=svg_element_id)
    px = cx + (cu - bcx) * scale
    py = cy - (cv - bcy) * scale
    r_scaled = cr * scale
    if runtime_binding:
        runtime_binding.update(page_center_mm=[px, py], page_radius_mm=r_scaled)

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
    identity = (f'data-diameter-leader="true" data-dim-id="{escape(str(di.get("id", "")), quote=True)}" '
                f'data-center-x="{px}" data-center-y="{py}" data-radius-page-mm="{r_scaled}" '
                f'data-scale="{scale}" ' if runtime_binding else '')
    out.append(f'<line {identity}x1="{sx:.2f}" y1="{sy:.2f}" '
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
    identity = (f'id="{svg_element_id}" data-center-u="{cu}" data-center-v="{cv}" '
                if svg_element_id else '')
    if runtime_binding:
        identity += 'data-runtime-diameter="true" '
    out.append(f'<text {identity}x="{tx:.2f}" y="{ty:.2f}" text-anchor="{anchor}" '
               f'font-family="{DIM_FONT}" font-size="{DIM_FONT_SIZE}" '
               f'fill="{DIM_COLOR}" data-dim-id="{dim_id}" '
               f'data-value-mm="{value_mm}">{text}</text>')
    return out


def _fragment_text_boxes(fragment):
    """Measure generated text in page coordinates; None means unverified input."""
    try:
        root = ET.fromstring('<svg>' + fragment + '</svg>')
        contexts = svg_contexts(root)
        return [elem_bbox_approx(elem, contexts) for elem in root.iter()
                if local_tag(elem) == 'text' and ''.join(elem.itertext()).strip()]
    except (ET.ParseError, ValueError):
        return None


def _boxes_intersect(a, b):
    # Layout candidates must be clear, even when a small overlap is below the
    # unchanged QA IoU threshold. This does not alter score/gate policy.
    return (a is not None and b is not None
            and min(a.x + a.w, b.x + b.w) > max(a.x, b.x)
            and min(a.y + a.h, b.y + b.h) > max(a.y, b.y))


def _render_diameter_with_text_clearance(
        di, circles, cx, cy, scale, bcx, bcy, *, vname, obstacles,
        svg_element_id, anchor_evidence, runtime_binding):
    """Try the opposite side hint without detaching any annotation primitive.

    Numeric angles are explicit placement. When the single alternate is not
    provably clear and inside this view, preserve the original for QA/review.
    """
    original = _render_diameter(
        di, circles, cx, cy, scale, bcx, bcy, svg_element_id,
        anchor_evidence, runtime_binding)
    placement = _placement_cfg(di)
    if not original or obstacles is None or placement['angle_deg'] is not None:
        return original
    boxes = _fragment_text_boxes('\n'.join(original))
    if not boxes or not any(_boxes_intersect(box, other)
                            for box in boxes for other in obstacles):
        return original
    alternate = {'top_right': 'top_left', 'top_left': 'top_right',
                 'bottom_right': 'bottom_left', 'bottom_left': 'bottom_right',
                 'right': 'left', 'left': 'right'}.get(placement['side'])
    if alternate is None:
        return original
    # Side names are not symmetric angle pairs (330° versus 230°, for
    # example). Reflect the actual requested angle so the vertical position
    # is preserved instead of moving the label toward other annotations.
    reflected_angle = (180 - _SIDE_TO_ANGLE[placement['side']]) % 360
    candidate_intent = dict(di)
    if isinstance(di.get('placement'), dict):
        candidate_intent['placement'] = {**di['placement'], 'side': alternate,
                                         'angle_deg': reflected_angle}
    else:
        candidate_intent['placement_side'] = alternate
        candidate_intent['placement_angle_deg'] = reflected_angle
    candidate_evidence = {}
    candidate_binding = dict(runtime_binding) if runtime_binding else None
    candidate = _render_diameter(
        candidate_intent, circles, cx, cy, scale, bcx, bcy, svg_element_id,
        candidate_evidence, candidate_binding)
    candidate_root = ET.fromstring('<svg>' + '\n'.join(candidate) + '</svg>')
    candidate_box = elem_bbox_approx(candidate_root)
    try:
        cell = cell_bbox(vname)
    except KeyError:
        return original
    if (candidate_box is None
            or not cell.contains(candidate_box.x, candidate_box.y)
            or not cell.contains(candidate_box.x + candidate_box.w,
                                 candidate_box.y + candidate_box.h)):
        return original
    boxes = _fragment_text_boxes('\n'.join(candidate))
    if boxes is None or any(_boxes_intersect(box, other)
                            for box in boxes for other in obstacles):
        return original
    anchor_evidence.update(candidate_evidence)
    anchor_evidence['placement_adjustment'] = {
        'reason': 'text_overlap', 'requested_side': placement['side'],
        'selected_side': alternate, 'selected_angle_deg': reflected_angle,
    }
    if runtime_binding is not None:
        runtime_binding.update(candidate_binding or {})
    return candidate


def _render_linear_h(di, bounds, cx, cy, scale, bcx, bcy, h_stack,
                     gap=None, offset=None, overshoot=None, runtime_binding=None):
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

    physical_binding = runtime_binding and runtime_binding.get('measurement') == 'pcb_linear_reference'
    anchor_y = top if side_top else bottom
    signed_gap = -_gap if side_top else _gap
    if physical_binding:
        runtime_binding.update(page_endpoints_mm=[[left, anchor_y], [right, anchor_y]],
                               page_extension_gap_y_mm=signed_gap, effective_gap_mm=_gap,
                               placement_side='top' if side_top else 'bottom')

    def extension_attrs(index):
        if not physical_binding:
            return ''
        point = runtime_binding['page_endpoints_mm'][index]
        return (f' data-dimension-extension="linear" data-dim-id="{escape(str(di.get("id", "")), quote=True)}" '
                f'data-endpoint-index="{index}" data-reference-x="{point[0]:.2f}" '
                f'data-reference-y="{point[1]:.2f}" data-gap-y="{signed_gap}"')

    out = []
    # Extension lines
    if side_top:
        end_y = y_dim-_overshoot if physical_binding else y_dim+_overshoot
        out.append(f'<line{extension_attrs(0)} x1="{left:.2f}" y1="{top-_gap:.2f}" '
                   f'x2="{left:.2f}" y2="{end_y:.2f}"/>')
        out.append(f'<line{extension_attrs(1)} x1="{right:.2f}" y1="{top-_gap:.2f}" '
                   f'x2="{right:.2f}" y2="{end_y:.2f}"/>')
    else:
        end_y = y_dim+_overshoot if physical_binding else y_dim-_overshoot
        out.append(f'<line{extension_attrs(0)} x1="{left:.2f}" y1="{bottom+_gap:.2f}" '
                   f'x2="{left:.2f}" y2="{end_y:.2f}"/>')
        out.append(f'<line{extension_attrs(1)} x1="{right:.2f}" y1="{bottom+_gap:.2f}" '
                   f'x2="{right:.2f}" y2="{end_y:.2f}"/>')
    # Dimension line
    reference = (f'data-reference-kind="pcb_linear_reference" data-reference-y="{anchor_y:.2f}" '
                 f'data-reference-x1="{left:.2f}" data-reference-x2="{right:.2f}" ' if physical_binding else '')
    out.append(f'<line {reference}data-dimension-line="linear" data-dim-id="{escape(str(di.get("id", "")), quote=True)}" '
               f'data-scale="{scale}" data-axis="u" x1="{left:.2f}" y1="{y_dim:.2f}" '
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
               f'data-linear-binding="view_extent" data-value-mm="{value_mm}">{text}</text>')

    return out, h_stack + 1


def _render_linear_v(di, bounds, cx, cy, scale, bcx, bcy, v_stack,
                     gap=None, offset=None, overshoot=None, runtime_binding=None):
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

    physical_binding = runtime_binding and runtime_binding.get('measurement') in (
        'standoff_cylindrical_faces', 'pcb_linear_reference', 'final_edge', 'bracket_vertical_reference')
    anchor_x = left if side_left else right
    signed_gap = _gap if side_left else -_gap
    if physical_binding:
        runtime_binding['page_endpoints_mm'] = [[anchor_x, bottom], [anchor_x, top]]
        runtime_binding['page_extension_gap_x_mm'] = signed_gap
        runtime_binding['effective_gap_mm'] = _gap
        runtime_binding['placement_side'] = 'left' if side_left else 'right'

    def extension_attrs(index):
        if not physical_binding:
            return ''
        point = runtime_binding['page_endpoints_mm'][index]
        return (f' data-dimension-extension="linear" data-dim-id="{escape(str(di.get("id", "")), quote=True)}" '
                f'data-endpoint-index="{index}" data-reference-x="{point[0]:.2f}" '
                f'data-reference-y="{point[1]:.2f}" data-gap-x="{signed_gap}"')

    out = []
    # Extension lines
    if side_left:
        out.append(f'<line{extension_attrs(1)} x1="{left+_gap:.2f}" y1="{top:.2f}" '
                   f'x2="{x_dim-_overshoot:.2f}" y2="{top:.2f}"/>')
        out.append(f'<line{extension_attrs(0)} x1="{left+_gap:.2f}" y1="{bottom:.2f}" '
                   f'x2="{x_dim-_overshoot:.2f}" y2="{bottom:.2f}"/>')
    else:
        out.append(f'<line{extension_attrs(1)} x1="{right-_gap:.2f}" y1="{top:.2f}" '
                   f'x2="{x_dim+_overshoot:.2f}" y2="{top:.2f}"/>')
        out.append(f'<line{extension_attrs(0)} x1="{right-_gap:.2f}" y1="{bottom:.2f}" '
                   f'x2="{x_dim+_overshoot:.2f}" y2="{bottom:.2f}"/>')
    # Dimension line
    reference = (f'data-reference-y1="{top:.2f}" data-reference-y2="{bottom:.2f}" '
                 if runtime_binding else '')
    if physical_binding:
        reference += f'data-reference-kind="{runtime_binding["measurement"]}" data-reference-x="{anchor_x:.2f}" '
    out.append(f'<line {reference}data-dimension-line="linear" data-dim-id="{escape(str(di.get("id", "")), quote=True)}" '
               f'data-scale="{scale}" data-axis="v" x1="{x_dim:.2f}" y1="{top:.2f}" '
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
    if (physical_binding and runtime_binding.get('measurement') == 'bracket_vertical_reference'
            and di.get('id') == 'THK' and bottom - top < 2 * DIM_ARROW_L):
        tx = x_dim - 3 if side_left else x_dim + 3
    ty = (top + bottom) / 2
    text = _format_value(value_mm)
    dim_id = di.get("id", "")
    out.append(f'<text x="{tx:.2f}" y="{ty:.2f}" text-anchor="middle" '
               f'font-family="{DIM_FONT}" font-size="{DIM_FONT_SIZE}" '
               f'fill="{DIM_COLOR}" data-dim-id="{dim_id}" '
               f'data-linear-binding="view_extent" data-value-mm="{value_mm}" '
               f'transform="rotate(-90,{tx:.2f},{ty:.2f})">{text}</text>')

    return out, v_stack + 1


def _render_bound_fillet_radius(di, binding, cx, cy, bcx, bcy, scale):
    from _drawing_svg import _dim_radius

    center_u, center_v = binding['center_uv_mm']
    arc_u, arc_v = binding['arc_point_uv_mm']
    center = [cx + (center_u - bcx) * scale, cy - (center_v - bcy) * scale]
    arc = [cx + (arc_u - bcx) * scale, cy - (arc_v - bcy) * scale]
    radius = binding['measured_mm']
    elems = _dim_radius(*center, *arc, radius * scale, radius, inward=True)
    if not elems:
        return []
    binding.update(page_center_mm=center, page_arc_point_mm=arc, page_radius_mm=radius * scale)
    fid = escape(str(di['id']), quote=True)
    elems[0] = elems[0].replace('<line ', f'<line data-dim-id="{fid}" data-radius-leader="true" '
        f'data-center-x="{center[0]}" data-center-y="{center[1]}" data-arc-x="{arc[0]}" data-arc-y="{arc[1]}" '
        f'data-radius-page-mm="{radius * scale}" data-scale="{scale}" ', 1)
    elems[-1] = elems[-1].replace('<text ', f'<text data-dim-id="{fid}" data-runtime-radius="true" '
        f'data-value-mm="{radius}" ', 1)
    return elems


def _render_review_marker(di, cx, cy, h_stack, reason=None, measured_mm=None):
    """Render a red REVIEW marker for missing value_mm."""
    fid = escape(str(di.get("id", "?")), quote=True)
    y = cy + 30 + h_stack * 5
    evidence = (f'data-dim-id="{fid}" data-linear-status="unresolved" '
                f'data-reason="{reason}" data-requested-mm="{di.get("value_mm")}" '
                f'data-measured-mm="{measured_mm}" ' if reason else '')
    return [f'<text {evidence}x="{cx:.2f}" y="{y:.2f}" text-anchor="middle" '
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


def _linear_extent_issue(di, vname, bounds):
    """Only established extent intents may use whole-view bounds.

    A feature name such as ``slot`` does not define an axis or reference pair.
    Reject it even if its requested number happens to equal the view extent.
    The 1e-6 mm check is computational precision, not a manufacturing tolerance.
    """
    fid = str(di.get("id", "")).upper()
    feature = di.get("feature", "")
    extent_features = {"base_length", "base_width", "base_thickness", "thickness",
                       "overall_width", "overall_height", "overall_depth", "total_length"}
    extent_ids = {"WIDTH", "BASE_W", "TOTAL_LENGTH", "DEPTH", "THK", "HEIGHT"}
    known = (feature in extent_features or
             (fid in extent_ids and feature in {"", "plate", "base_plate"}))
    vertical = _style_bucket(di, vname) == "linear_v"
    measured = abs(bounds[3] - bounds[1]) if vertical else abs(bounds[2] - bounds[0])
    if not known:
        return "linear_anchor_unresolved", measured
    value = di.get("value_mm")
    if value is not None and (not isinstance(value, (int, float)) or
                              not math.isfinite(value) or abs(value - measured) > 1e-6):
        return "linear_value_geometry_mismatch", measured
    return None, measured


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
    process_groups=None, runtime_linear_bindings=None, existing_svg=None,
):
    """Render plan-driven dimensions for a specific view.

    Only renders dimensions whose value_mm is NOT already placed by auto-dims.
    Missing value_mm → red REVIEW marker if required.
    style_cfg: optional dict with dim_offset/dim_gap/dim_ext_overshoot overrides.

    telemetry: optional dict sink to collect traceability records.
    existing_svg: generated view/auto annotations; symbolic diameter side hints
      may use their opposite side when the complete annotation fits clearly.

    Returns: (svg_string, new_h_stack, new_v_stack)
    """
    if not dim_intents or vname == "iso":
        return "", h_stack, v_stack
    from _drawing_svg import tag_annotation

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
        if reason:
            rec["reason"] = reason
        if extra and isinstance(extra, dict):
            rec.update(extra)
        telemetry.setdefault("plan_dimensions", []).append(rec)

    def _binding_identity(di, binding):
        # A standalone THK/standoff renderer is also a valid producer boundary;
        # do not depend on an unrelated PCB plan to complete its annotation.
        from _pcb_drawing_bindings import _plan_measurement_identity
        return _plan_measurement_identity({'status': 'rendered', 'rendered': True,
                                          'value_mm': di.get('value_mm'), 'runtime_binding': binding}, {})

    # D4 manufacturing: track process group for inter-group gap
    _prev_process_step = None

    for intent_index, di in enumerate(dim_intents, 1):
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
        fid = di.get("id", "")
        binding = (runtime_linear_bindings or {}).get((vname, fid, di.get("feature", "")))
        linear_bounds = bounds

        # Check the reference before numeric dedupe: an unrelated auto label
        # cannot prove that this feature/axis/reference pair was dimensioned.
        if value_mm is not None and (binding is not None or (style == "linear" and fid not in DIA_FEATURES)):
            if binding is not None:
                measured = binding.get("measured_mm")
                reason = binding.get('reason') or "linear_anchor_unresolved"
                if binding.get("status") == "resolved":
                    linear_bounds = binding.get("bounds", bounds)
                    mismatch = ("radius_value_geometry_mismatch" if binding.get('measurement') == 'bracket_fillet_radius'
                                else "linear_value_geometry_mismatch")
                    reason = (None if isinstance(value_mm, (int, float))
                              and math.isfinite(value_mm) and abs(value_mm - measured) <= 1e-6 else mismatch)
            else:
                reason, measured = _linear_extent_issue(di, vname, bounds)
            if reason:
                out.extend(_render_review_marker(di, cx, cy, h_stack, reason, measured))
                h_stack += 1
                _record(di, "unresolved", reason=reason,
                        extra={"measured_mm": measured, **({"runtime_binding": binding} if binding else {})})
                if telemetry is not None:
                    telemetry.setdefault("conflicts", []).append({
                        "view": vname, "category": "linear_binding", "reason": reason,
                        "severity": "error", "dim_id": fid,
                        "value_mm": value_mm, "measured_mm": measured,
                    })
                continue

        # Skip if already placed by auto-dims (policy-driven)
        dedupe_match = None if binding is not None else _find_auto_dedupe_match(
            di,
            existing_auto_dims=existing_auto_dims,
            existing_values=existing_dim_values,
            dedupe_policy=dedupe_policy,
            tol=dedupe_tol_mm if isinstance(dedupe_tol_mm, (int, float)) else 0.5,
            vname=vname,
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
            if circles:
                anchor_evidence = {}
                # out[0] is this still-open group; the rest are complete SVG
                # primitives, including plan annotations rendered earlier.
                obstacles = (_fragment_text_boxes(existing_svg + '\n' + '\n'.join(out[1:]))
                             if existing_svg is not None else None)
                elems = _render_diameter_with_text_clearance(
                    di, circles, cx, cy, scale, bcx, bcy,
                    vname=vname, obstacles=obstacles,
                    svg_element_id=f"plan_{vname}_{intent_index:03d}",
                    anchor_evidence=anchor_evidence, runtime_binding=binding)
                if binding:
                    elems = tag_annotation(elems, f'plan_{vname}_{intent_index:03d}', ['leader', 'shelf', 'arrow', 'label'],
                                           _binding_identity(di, binding))
                out.extend(elems)
                if elems:
                    _record(di, "rendered", rendered=True,
                            extra={**anchor_evidence, **({'runtime_binding': binding} if binding else {})})
                else:
                    _record(di, "skipped_no_anchor", reason="no_matching_circle")
            else:
                _record(di, "skipped_view", reason="diameter_intent_requires_circular_view")
        elif style == "linear":
            if (binding and binding.get('axis') == 'v') or _style_bucket(di, vname) == "linear_v":
                elems, v_stack = _render_linear_v(
                    di, linear_bounds, cx, cy, scale, bcx, bcy, v_stack,
                    gap=eff_gap, offset=eff_offset, overshoot=eff_overshoot,
                    runtime_binding=binding)
                if binding:
                    elems = tag_annotation(elems, f'plan_{vname}_{intent_index:03d}',
                                           ['extension-b', 'extension-a', 'dimension-line', 'arrow-b', 'arrow-a', 'label'],
                                           _binding_identity(di, binding))
                out.extend(elems)
                if elems:
                    _record(di, "rendered", rendered=True,
                            extra={"runtime_binding": binding} if binding else None)
                else:
                    _record(di, "skipped_layout", reason="vertical_linear_layout_failed")
            else:
                elems, h_stack = _render_linear_h(
                    di, linear_bounds, cx, cy, scale, bcx, bcy, h_stack,
                    gap=eff_gap, offset=eff_offset, overshoot=eff_overshoot, runtime_binding=binding)
                if binding:
                    elems = tag_annotation(elems, f'plan_{vname}_{intent_index:03d}',
                                           ['extension-a', 'extension-b', 'dimension-line', 'arrow-a', 'arrow-b', 'label'],
                                           _binding_identity(di, binding))
                out.extend(elems)
                if elems:
                    _record(di, "rendered", rendered=True,
                            extra={'runtime_binding': binding} if binding else None)
                else:
                    _record(di, "skipped_layout", reason="horizontal_linear_layout_failed")
        elif style == "radius":
            if binding and binding.get('measurement') == 'bracket_fillet_radius':
                elems = _render_bound_fillet_radius(di, binding, cx, cy, bcx, bcy, scale)
                out.extend(elems)
                _record(di, "rendered" if elems else "skipped_layout", rendered=bool(elems),
                        extra={'runtime_binding': binding})
            else:
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
