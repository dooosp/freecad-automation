"""SVG drawing post-processing utilities.

Shared by postprocess_svg.py and qa_scorer.py.
All constants are grounded in generate_drawing.py output structure.
"""
import xml.etree.ElementTree as ET
import re
from dataclasses import dataclass

SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)


# -- Constants ----------------------------------------------------------------

PAGE_W, PAGE_H = 420.0, 297.0

# Cell layout (A3 landscape, generate_drawing.py output)
CELLS = {
    "top":   {"x": 15.0,  "y": 15.0,  "w": 195.0, "h": 116.0},
    "iso":   {"x": 210.0, "y": 15.0,  "w": 195.0, "h": 116.0},
    "front": {"x": 15.0,  "y": 131.0, "w": 195.0, "h": 116.0},
    "right": {"x": 210.0, "y": 131.0, "w": 195.0, "h": 116.0},
}

HIDDEN_CLASSES = frozenset({
    "outer_hidden", "hard_hidden", "smooth_hidden", "iso_hidden",
})

GEOMETRY_CLASSES = frozenset({
    "hard_visible", "outer_visible", "smooth_visible",
    "hard_hidden", "outer_hidden", "smooth_hidden",
    "iso_visible",
    "centerlines", "symmetry-axes",
})


# -- BBox ---------------------------------------------------------------------

@dataclass
class BBox:
    x: float
    y: float
    w: float
    h: float

    def contains(self, px, py):
        return self.x <= px <= self.x + self.w and self.y <= py <= self.y + self.h

    def overlaps(self, other):
        return not (
            self.x + self.w < other.x or other.x + other.w < self.x or
            self.y + self.h < other.y or other.y + other.h < self.y
        )

    def iou(self, other):
        if not self.overlaps(other):
            return 0.0
        ix = max(self.x, other.x)
        iy = max(self.y, other.y)
        ix2 = min(self.x + self.w, other.x + other.w)
        iy2 = min(self.y + self.h, other.y + other.h)
        inter = max(0, ix2 - ix) * max(0, iy2 - iy)
        union = self.area() + other.area() - inter
        return inter / union if union > 0 else 0.0

    def area(self):
        return max(0, self.w) * max(0, self.h)

    def center(self):
        return (self.x + self.w / 2.0, self.y + self.h / 2.0)

    @staticmethod
    def union_all(bboxes):
        bboxes = [b for b in bboxes if b is not None]
        if not bboxes:
            return None
        x = min(b.x for b in bboxes)
        y = min(b.y for b in bboxes)
        x2 = max(b.x + b.w for b in bboxes)
        y2 = max(b.y + b.h for b in bboxes)
        return BBox(x, y, x2 - x, y2 - y)


# -- SVG I/O ------------------------------------------------------------------

def svg_tag(name):
    """Local tag name → qualified name with SVG namespace."""
    return f"{{{SVG_NS}}}{name}"


def local_tag(elem):
    """Element → local tag name (without namespace)."""
    t = elem.tag
    return t.split("}")[-1] if "}" in t else t


def load_svg(path):
    return ET.parse(path)


def write_svg(tree, path):
    root = tree.getroot()
    # Remove explicit xmlns attr to avoid duplication
    # (ET handles namespace via register_namespace)
    if root.get("xmlns"):
        del root.attrib["xmlns"]
    tree.write(path, encoding="unicode", xml_declaration=False)


# -- Cell / view helpers -------------------------------------------------------

def cell_bbox(view_name):
    c = CELLS[view_name]
    return BBox(c["x"], c["y"], c["w"], c["h"])


def classify_by_position(cx, cy):
    """Return view name that contains (cx, cy), or None."""
    for vname, cell in CELLS.items():
        bb = BBox(cell["x"], cell["y"], cell["w"], cell["h"])
        if bb.contains(cx, cy):
            return vname
    return None


# -- Coordinate extraction -----------------------------------------------------

_NUM_RE = re.compile(r"[-+]?\d*\.?\d+")


def path_coords(d):
    """Extract (x,y) pairs from SVG path d attribute (M/L commands)."""
    nums = _NUM_RE.findall(d)
    coords = []
    for i in range(0, len(nums) - 1, 2):
        try:
            coords.append((float(nums[i]), float(nums[i + 1])))
        except ValueError:
            continue
    return coords


def polyline_coords(points_str):
    """Extract (x,y) pairs from polyline points attribute."""
    nums = _NUM_RE.findall(points_str)
    coords = []
    for i in range(0, len(nums) - 1, 2):
        try:
            coords.append((float(nums[i]), float(nums[i + 1])))
        except ValueError:
            continue
    return coords


# -- Bbox approximation --------------------------------------------------------

def _text_content(elem):
    """Get full text content including tspan children."""
    parts = []
    if elem.text:
        parts.append(elem.text)
    for child in elem:
        if child.text:
            parts.append(child.text)
        if child.tail:
            parts.append(child.tail)
    return "".join(parts)


def _get_font_size(elem):
    """Get font-size from element or nearest parent-like hint."""
    fs = elem.get("font-size")
    if fs:
        return float(fs)
    return 2.0  # default


def elem_bbox_approx(elem):
    """Approximate bounding box for an SVG element."""
    tag = local_tag(elem)

    if tag == "path":
        d = elem.get("d", "")
        coords = path_coords(d)
        if not coords:
            return None
        xs = [c[0] for c in coords]
        ys = [c[1] for c in coords]
        return BBox(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))

    elif tag == "circle":
        cx = float(elem.get("cx", 0))
        cy = float(elem.get("cy", 0))
        r = float(elem.get("r", 0))
        return BBox(cx - r, cy - r, 2 * r, 2 * r)

    elif tag == "line":
        x1 = float(elem.get("x1", 0))
        y1 = float(elem.get("y1", 0))
        x2 = float(elem.get("x2", 0))
        y2 = float(elem.get("y2", 0))
        mn_x, mx_x = min(x1, x2), max(x1, x2)
        mn_y, mx_y = min(y1, y2), max(y1, y2)
        return BBox(mn_x, mn_y, mx_x - mn_x, mx_y - mn_y)

    elif tag == "rect":
        x = float(elem.get("x", 0))
        y = float(elem.get("y", 0))
        w = float(elem.get("width", 0))
        h = float(elem.get("height", 0))
        return BBox(x, y, w, h)

    elif tag == "text":
        x = float(elem.get("x", 0))
        y = float(elem.get("y", 0))
        fs = _get_font_size(elem)
        text = _text_content(elem)
        w = len(text) * fs * 0.55
        anchor = elem.get("text-anchor", "start")
        if anchor == "middle":
            x -= w / 2
        elif anchor == "end":
            x -= w
        return BBox(x, y - fs, w, fs * 1.2)

    elif tag == "polyline":
        pts = elem.get("points", "")
        coords = polyline_coords(pts)
        if not coords:
            return None
        xs = [c[0] for c in coords]
        ys = [c[1] for c in coords]
        return BBox(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))

    elif tag == "polygon":
        pts = elem.get("points", "")
        coords = polyline_coords(pts)
        if not coords:
            return None
        xs = [c[0] for c in coords]
        ys = [c[1] for c in coords]
        return BBox(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))

    elif tag == "g":
        child_bbs = [elem_bbox_approx(c) for c in elem]
        return BBox.union_all(child_bbs)

    return None


def group_center(g_elem):
    """Return center of the first drawable child's bbox in a <g>."""
    for child in g_elem:
        bb = elem_bbox_approx(child)
        if bb and bb.area() >= 0:
            return bb.center()
    return None


def count_paths(elem):
    """Count <path> descendants (with or without namespace)."""
    n = 0
    for child in elem.iter():
        if local_tag(child) == "path":
            n += 1
    return n


# -- Float precision -----------------------------------------------------------

_FLOAT_LONG_RE = re.compile(r"\d+\.\d{4,}")


def count_long_floats_in_str(s):
    """Count float values with 4+ decimal places in a string."""
    return len(_FLOAT_LONG_RE.findall(s))


def round_float_str(s, precision=2):
    """Round all floats in a string to given precision."""
    def _round(m):
        return f"{float(m.group()):.{precision}f}"
    return _FLOAT_LONG_RE.sub(_round, s)
