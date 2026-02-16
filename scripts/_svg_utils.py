"""Shared SVG helpers used across drawing modules."""

import math

DIM_ARROW_L = 2.0
DIM_ARROW_W = 0.7
DIM_COLOR = "#000"


def escape(text):
    """Escape XML special characters."""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def arrow_head(x, y, angle):
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
