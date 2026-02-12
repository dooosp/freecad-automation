"""
Annotation layout optimizer — collision-free placement of dimensions,
callouts, surface finish symbols, and leaders on drawing views.
"""

import math


class AnnotationItem:
    """A single annotation to be placed on the drawing."""

    __slots__ = ("type", "anchor", "box_w", "box_h", "priority",
                 "view", "label", "feature_ref", "extra")

    # Priority levels (lower = more important, placed first)
    P_CRITICAL = 0     # Dimensions, datums
    P_IMPORTANT = 1    # Fit tolerances, GD&T
    P_STANDARD = 2     # Surface finish, thread callouts
    P_NICE = 3         # General notes, chamfer labels

    def __init__(self, type, anchor, box_w, box_h, *,
                 priority=2, view="front", label="", feature_ref=None,
                 extra=None):
        self.type = type           # dimension, surface_finish, thread, chamfer, gdt, balloon
        self.anchor = anchor       # (x, y) target point on geometry
        self.box_w = box_w         # annotation bounding box width
        self.box_h = box_h         # annotation bounding box height
        self.priority = priority
        self.view = view
        self.label = label
        self.feature_ref = feature_ref
        self.extra = extra or {}


class PlacedAnnotation:
    """Result of layout optimization — annotation with final position."""

    __slots__ = ("item", "x", "y", "leader_path")

    def __init__(self, item, x, y, leader_path=None):
        self.item = item
        self.x = x
        self.y = y
        self.leader_path = leader_path or []  # [(x1,y1), (x2,y2), ...]


def optimize_layout(annotations, clear_zones, view_bounds, planner=None):
    """Place annotations with minimal overlap and clean leader routing.

    Args:
        annotations: list of AnnotationItem
        clear_zones: list of (x_min, y_min, x_max, y_max) — geometry regions to avoid
        view_bounds: (x_min, y_min, x_max, y_max) — usable drawing area
        planner: existing AnnotationPlanner (optional)

    Returns:
        list of PlacedAnnotation
    """
    if not annotations:
        return []

    # Sort by priority (critical first)
    sorted_annots = sorted(annotations, key=lambda a: (a.priority, a.label))

    # Initialize collision tracker
    from generate_drawing import AnnotationPlanner
    if planner is None:
        planner = AnnotationPlanner()

    # Register clear zones as obstacles
    for zone in clear_zones:
        planner.register(*zone)

    placed = []
    vx0, vy0, vx1, vy1 = view_bounds

    for ann in sorted_annots:
        ax, ay = ann.anchor

        # Generate candidate positions based on annotation type
        candidates = _generate_candidates(
            ann, ax, ay, vx0, vy0, vx1, vy1)

        if not candidates:
            continue

        # Pick best position
        best_x, best_y = planner.register_and_pick(
            candidates, ann.box_w, ann.box_h)

        # Route leader line
        leader = route_leader(
            (ax, ay), (best_x + ann.box_w / 2, best_y + ann.box_h / 2),
            planner._boxes)

        placed.append(PlacedAnnotation(ann, best_x, best_y, leader))

    return placed


def align_dimension_rows(h_dims, start_y, spacing=7.0):
    """Align horizontal dimensions in stacked rows.

    Args:
        h_dims: list of (x_left, x_right, value) tuples
        start_y: Y start position for first row
        spacing: vertical spacing between rows

    Returns:
        list of (x_left, x_right, y_dim, value)
    """
    if not h_dims:
        return []

    # Sort by span width (widest first → outermost)
    sorted_dims = sorted(h_dims, key=lambda d: abs(d[1] - d[0]), reverse=True)

    result = []
    for i, (xl, xr, val) in enumerate(sorted_dims):
        y = start_y + i * spacing
        result.append((xl, xr, y, val))

    return result


def align_dimension_cols(v_dims, start_x, spacing=7.0):
    """Align vertical dimensions in stacked columns.

    Args:
        v_dims: list of (y_top, y_bottom, value) tuples
        start_x: X start position for first column
        spacing: horizontal spacing between columns

    Returns:
        list of (y_top, y_bottom, x_dim, value)
    """
    if not v_dims:
        return []

    sorted_dims = sorted(v_dims, key=lambda d: abs(d[1] - d[0]), reverse=True)

    result = []
    for i, (yt, yb, val) in enumerate(sorted_dims):
        x = start_x + i * spacing
        result.append((yt, yb, x, val))

    return result


def route_leader(start, end, obstacles):
    """Route a leader line from start to end, avoiding obstacles.

    Strategy:
    1. Try straight line first
    2. If intersects obstacles, use L-shaped bend
    3. If still blocked, add intermediate waypoint

    Args:
        start: (x, y) — point on geometry
        end: (x, y) — point at annotation
        obstacles: list of (x_min, y_min, x_max, y_max)

    Returns:
        list of (x, y) points forming the leader path
    """
    sx, sy = start
    ex, ey = end

    # Try straight line
    if not _line_intersects_any(sx, sy, ex, ey, obstacles):
        return [(sx, sy), (ex, ey)]

    # L-shaped routing: horizontal then vertical
    mid1 = (ex, sy)
    if (not _line_intersects_any(sx, sy, mid1[0], mid1[1], obstacles) and
            not _line_intersects_any(mid1[0], mid1[1], ex, ey, obstacles)):
        return [(sx, sy), mid1, (ex, ey)]

    # L-shaped routing: vertical then horizontal
    mid2 = (sx, ey)
    if (not _line_intersects_any(sx, sy, mid2[0], mid2[1], obstacles) and
            not _line_intersects_any(mid2[0], mid2[1], ex, ey, obstacles)):
        return [(sx, sy), mid2, (ex, ey)]

    # Fallback: straight line (accept minor overlap)
    return [(sx, sy), (ex, ey)]


def deduplicate_annotations(annotations, tolerance=0.5):
    """Remove duplicate annotations at same position with same value.

    Args:
        annotations: list of AnnotationItem
        tolerance: position tolerance in mm

    Returns:
        deduplicated list
    """
    seen = set()
    result = []
    for ann in annotations:
        key = (round(ann.anchor[0] / tolerance),
               round(ann.anchor[1] / tolerance),
               ann.label)
        if key not in seen:
            seen.add(key)
            result.append(ann)
    return result


def _generate_candidates(ann, ax, ay, vx0, vy0, vx1, vy1):
    """Generate candidate positions for an annotation around its anchor."""
    bw, bh = ann.box_w, ann.box_h

    if ann.type == "dimension":
        # Dimensions go below or to the right of geometry
        d = 8
        return [
            (ax - bw / 2, ay + d),           # below center
            (ax + d, ay - bh / 2),            # right center
            (ax - bw / 2, ay - d - bh),       # above center
            (ax - d - bw, ay - bh / 2),       # left center
        ]

    elif ann.type == "surface_finish":
        d = 15
        return [
            (ax + d, ay - d),                 # top-right
            (ax + d, ay + d * 0.5),            # bottom-right
            (ax - d - bw, ay - d),             # top-left
            (ax - d - bw, ay + d * 0.5),       # bottom-left
        ]

    elif ann.type in ("thread", "chamfer"):
        d = 12
        candidates = []
        for angle_deg in range(30, 360, 45):
            a = math.radians(angle_deg)
            cx = ax + d * math.cos(a) - bw / 2
            cy = ay - d * math.sin(a) - bh / 2
            candidates.append((cx, cy))
        return candidates

    elif ann.type == "balloon":
        d = 20
        return [
            (ax + d, ay - d),
            (ax - d - bw, ay - d),
            (ax + d, ay + d),
            (ax - d - bw, ay + d),
        ]

    else:
        # Generic: 4 corners
        d = 10
        return [
            (ax + d, ay - bh / 2),
            (ax - d - bw, ay - bh / 2),
            (ax - bw / 2, ay + d),
            (ax - bw / 2, ay - d - bh),
        ]


def _line_intersects_any(x1, y1, x2, y2, boxes):
    """Check if a line segment intersects any bounding box."""
    for bx0, by0, bx1, by1 in boxes:
        if _line_intersects_rect(x1, y1, x2, y2, bx0, by0, bx1, by1):
            return True
    return False


def _line_intersects_rect(x1, y1, x2, y2, rx0, ry0, rx1, ry1):
    """Cohen-Sutherland-style check: does line segment intersect rectangle?"""
    # Quick rejection
    if max(x1, x2) < rx0 or min(x1, x2) > rx1:
        return False
    if max(y1, y2) < ry0 or min(y1, y2) > ry1:
        return False

    # Check if either endpoint is inside
    if rx0 <= x1 <= rx1 and ry0 <= y1 <= ry1:
        return True
    if rx0 <= x2 <= rx1 and ry0 <= y2 <= ry1:
        return True

    # Check line intersection with rectangle edges
    edges = [
        (rx0, ry0, rx1, ry0),  # top
        (rx1, ry0, rx1, ry1),  # right
        (rx0, ry1, rx1, ry1),  # bottom
        (rx0, ry0, rx0, ry1),  # left
    ]
    for ex1, ey1, ex2, ey2 in edges:
        if _segments_intersect(x1, y1, x2, y2, ex1, ey1, ex2, ey2):
            return True
    return False


def _segments_intersect(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2):
    """Check if two line segments intersect."""
    d1 = _cross(bx2 - bx1, by2 - by1, ax1 - bx1, ay1 - by1)
    d2 = _cross(bx2 - bx1, by2 - by1, ax2 - bx1, ay2 - by1)
    d3 = _cross(ax2 - ax1, ay2 - ay1, bx1 - ax1, by1 - ay1)
    d4 = _cross(ax2 - ax1, ay2 - ay1, bx2 - ax1, by2 - ay1)

    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True

    return False


def _cross(ux, uy, vx, vy):
    """2D cross product."""
    return ux * vy - uy * vx
