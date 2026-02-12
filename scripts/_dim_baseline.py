"""
Baseline and ordinate dimensioning for engineering drawings.
Replaces chain dimensions with datum-referenced dimensions to eliminate
cumulative tolerance stack-up.
"""

import math


# Rendering constants (consistent with generate_drawing.py)
DIM_LINE_W = "0.18"
DIM_FONT_SIZE = "3"
DIM_ARROW_L = 2.0
DIM_ARROW_W = 0.7
DIM_GAP = 2.0
DIM_EXT_OVERSHOOT = 1.5
BASELINE_ROW_SPACING = 5.0  # spacing between baseline dimension rows


def render_baseline_dimensions_svg(features, origin, axis, bounds,
                                   cx, cy, scale, style_cfg=None):
    """Render baseline (datum-referenced) dimensions.

    All dimensions reference a single datum origin, eliminating cumulative
    tolerance stack-up. Used for precision layouts.

    Args:
        features: list of {position, label} dicts — points to dimension
        origin: (u, v) datum origin in model coords
        axis: 'horizontal' or 'vertical'
        bounds: (u0, v0, u1, v1) view bounds
        cx, cy: view center on page
        scale: drawing scale factor
        style_cfg: optional dict with baseline_row_spacing/dim_gap overrides.

    Returns:
        SVG string
    """
    if not features:
        return ""

    _sc = style_cfg or {}
    eff_gap = _sc.get("dim_gap", DIM_GAP)
    eff_row_spacing = _sc.get("baseline_row_spacing",
                              _sc.get("feat_dim_stack", BASELINE_ROW_SPACING))

    u0, v0, u1, v1 = bounds
    bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

    def pg(u, v):
        return cx + (u - bcx) * scale, cy - (v - bcy) * scale

    ox, oy = pg(*origin)
    out = ['<g class="baseline-dimensions">']

    if axis == "horizontal":
        # Sort features by distance from origin along u-axis
        sorted_feats = sorted(features, key=lambda f: abs(f["position"][0] - origin[0]))

        base_y = oy + eff_gap * scale + 10  # start below geometry

        for i, feat in enumerate(sorted_feats):
            fu, fv = feat["position"]
            fx, fy = pg(fu, fv)

            dist = abs(fu - origin[0])
            if dist < 0.1:
                continue  # skip datum itself

            dim_y = base_y + i * eff_row_spacing
            value = f"{dist:.1f}" if dist != int(dist) else f"{int(dist)}"

            # Extension lines (from geometry to dimension line)
            out.append(_ext_line_v(ox, oy, dim_y + 2))
            out.append(_ext_line_v(fx, fy, dim_y + 2))

            # Dimension line
            x_left = min(ox, fx)
            x_right = max(ox, fx)
            out.append(f'<line x1="{x_left:.2f}" y1="{dim_y:.2f}" '
                       f'x2="{x_right:.2f}" y2="{dim_y:.2f}" '
                       f'stroke="#000" stroke-width="{DIM_LINE_W}"/>')

            # Arrows at both ends
            out.append(_arrow_h(x_left, dim_y, "right"))
            out.append(_arrow_h(x_right, dim_y, "left"))

            # Dimension text
            tx = (x_left + x_right) / 2
            ty = dim_y - 1.2
            tol = feat.get("tolerance", "")
            label = f"{value}{tol}" if tol else value
            out.append(f'<text x="{tx:.2f}" y="{ty:.2f}" text-anchor="middle" '
                       f'font-family="sans-serif" font-size="{DIM_FONT_SIZE}" '
                       f'fill="#000">{_escape(label)}</text>')

    elif axis == "vertical":
        sorted_feats = sorted(features, key=lambda f: abs(f["position"][1] - origin[1]))

        base_x = ox + eff_gap * scale + 10

        for i, feat in enumerate(sorted_feats):
            fu, fv = feat["position"]
            fx, fy = pg(fu, fv)

            dist = abs(fv - origin[1])
            if dist < 0.1:
                continue

            dim_x = base_x + i * eff_row_spacing
            value = f"{dist:.1f}" if dist != int(dist) else f"{int(dist)}"

            out.append(_ext_line_h(ox, oy, dim_x + 2))
            out.append(_ext_line_h(fx, fy, dim_x + 2))

            y_top = min(oy, fy)
            y_bot = max(oy, fy)
            out.append(f'<line x1="{dim_x:.2f}" y1="{y_top:.2f}" '
                       f'x2="{dim_x:.2f}" y2="{y_bot:.2f}" '
                       f'stroke="#000" stroke-width="{DIM_LINE_W}"/>')

            out.append(_arrow_v(dim_x, y_top, "down"))
            out.append(_arrow_v(dim_x, y_bot, "up"))

            tx = dim_x + 1.5
            ty = (y_top + y_bot) / 2 + 1
            tol = feat.get("tolerance", "")
            label = f"{value}{tol}" if tol else value
            out.append(f'<text x="{tx:.2f}" y="{ty:.2f}" text-anchor="start" '
                       f'font-family="sans-serif" font-size="{DIM_FONT_SIZE}" '
                       f'fill="#000" transform="rotate(-90,{tx:.2f},{ty:.2f})">'
                       f'{_escape(label)}</text>')

    out.append('</g>')
    return '\n'.join(out)


def render_ordinate_dimensions_svg(features, origin, direction, bounds,
                                   cx, cy, scale):
    """Render ordinate (coordinate) dimensions — table-style distance list.

    Best for hole patterns: shows each hole's distance from origin without
    dimension lines, just extension lines with values at the ends.

    Args:
        features: list of {position, label, diameter} dicts
        origin: (u, v) origin point
        direction: 'horizontal' or 'vertical'
        bounds, cx, cy, scale: view params

    Returns:
        SVG string
    """
    if not features:
        return ""

    u0, v0, u1, v1 = bounds
    bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

    def pg(u, v):
        return cx + (u - bcx) * scale, cy - (v - bcy) * scale

    ox, oy = pg(*origin)
    out = ['<g class="ordinate-dimensions">']

    # Origin marker — small circle
    out.append(f'<circle cx="{ox:.2f}" cy="{oy:.2f}" r="1.5" '
               f'fill="none" stroke="#000" stroke-width="0.25"/>')
    out.append(f'<text x="{ox + 2:.2f}" y="{oy - 2:.2f}" '
               f'font-family="sans-serif" font-size="2.5" '
               f'fill="#000" font-weight="bold">0</text>')

    if direction == "horizontal":
        # Extension lines go down, values at bottom
        ext_y = oy + 15  # below geometry
        sorted_feats = sorted(features, key=lambda f: f["position"][0])

        for feat in sorted_feats:
            fu, fv = feat["position"]
            fx, fy = pg(fu, fv)
            dist = fu - origin[0]
            if abs(dist) < 0.1:
                continue

            value = f"{dist:.1f}" if dist != int(dist) else f"{int(dist)}"

            # Extension line from feature to value position
            out.append(f'<line x1="{fx:.2f}" y1="{fy:.2f}" '
                       f'x2="{fx:.2f}" y2="{ext_y:.2f}" '
                       f'stroke="#000" stroke-width="{DIM_LINE_W}"/>')

            # Value at end of extension
            out.append(f'<text x="{fx:.2f}" y="{ext_y + 3:.2f}" '
                       f'text-anchor="middle" font-family="sans-serif" '
                       f'font-size="{DIM_FONT_SIZE}" fill="#000">'
                       f'{_escape(value)}</text>')

    elif direction == "vertical":
        ext_x = ox + 15
        sorted_feats = sorted(features, key=lambda f: f["position"][1])

        for feat in sorted_feats:
            fu, fv = feat["position"]
            fx, fy = pg(fu, fv)
            dist = fv - origin[1]
            if abs(dist) < 0.1:
                continue

            value = f"{dist:.1f}" if dist != int(dist) else f"{int(dist)}"

            out.append(f'<line x1="{fx:.2f}" y1="{fy:.2f}" '
                       f'x2="{ext_x:.2f}" y2="{fy:.2f}" '
                       f'stroke="#000" stroke-width="{DIM_LINE_W}"/>')

            out.append(f'<text x="{ext_x + 2:.2f}" y="{fy + 1:.2f}" '
                       f'text-anchor="start" font-family="sans-serif" '
                       f'font-size="{DIM_FONT_SIZE}" fill="#000">'
                       f'{_escape(value)}</text>')

    out.append('</g>')
    return '\n'.join(out)


def select_dimension_strategy(feature_graph):
    """Select the best dimensioning strategy based on features.

    Returns: 'chain' | 'baseline' | 'ordinate'

    Rules:
    - Bolt patterns (PCD, linear arrays) → ordinate
    - Sequential features on a shaft → chain
    - Precision layouts with datums → baseline
    """
    if not feature_graph:
        return "chain"

    # Check for bolt circle or hole patterns
    for grp in feature_graph.groups:
        if grp.pattern in ("bolt_circle", "hole_pattern", "linear_array"):
            return "ordinate"

    # Check for datum features → baseline
    holes = feature_graph.by_type("hole")
    bores = feature_graph.by_type("bore")
    if bores and holes:
        return "baseline"

    return "chain"


# -- SVG Helpers ---------------------------------------------------------------

def _arrow_h(x, y, direction):
    """Horizontal arrow head."""
    sign = 1 if direction == "right" else -1
    x2 = x + sign * DIM_ARROW_L
    return (f'<polygon points="{x:.2f},{y:.2f} '
            f'{x2:.2f},{y - DIM_ARROW_W:.2f} '
            f'{x2:.2f},{y + DIM_ARROW_W:.2f}" '
            f'fill="#000"/>')


def _arrow_v(x, y, direction):
    """Vertical arrow head."""
    sign = 1 if direction == "down" else -1
    y2 = y + sign * DIM_ARROW_L
    return (f'<polygon points="{x:.2f},{y:.2f} '
            f'{x - DIM_ARROW_W:.2f},{y2:.2f} '
            f'{x + DIM_ARROW_W:.2f},{y2:.2f}" '
            f'fill="#000"/>')


def _ext_line_v(x, y_start, y_end):
    """Vertical extension line."""
    return (f'<line x1="{x:.2f}" y1="{y_start:.2f}" '
            f'x2="{x:.2f}" y2="{y_end:.2f}" '
            f'stroke="#000" stroke-width="{DIM_LINE_W}"/>')


def _ext_line_h(x_start, y, x_end):
    """Horizontal extension line."""
    return (f'<line x1="{x_start:.2f}" y1="{y:.2f}" '
            f'x2="{x_end:.2f}" y2="{y:.2f}" '
            f'stroke="#000" stroke-width="{DIM_LINE_W}"/>')


def _escape(text):
    """Escape XML special characters."""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
