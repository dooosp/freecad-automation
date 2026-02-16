"""Shared drawing constants and pure helpers for drawing generation."""

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


def auto_scale(bbox, cell_w, cell_h):
    """Compute scale factor to fit shape in a view cell."""
    max_dim = max(bbox.XLength, bbox.YLength, bbox.ZLength, 1e-6)
    return min(cell_w, cell_h) * 0.85 / max_dim


def nice_scale(raw):
    """Round to nearest standard engineering scale."""
    standards = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]
    return min(standards, key=lambda s: abs(s - raw))


def _cell_bounds(vname):
    """Return page-space view cell bounds (x0, y0, x1, y1)."""
    if vname not in VIEW_CELLS:
        return None
    cx, cy = VIEW_CELLS[vname]
    return (cx - CELL_W / 2, cy - CELL_H / 2, cx + CELL_W / 2, cy + CELL_H / 2)
