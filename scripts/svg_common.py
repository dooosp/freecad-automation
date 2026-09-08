"""SVG drawing post-processing utilities.

Shared by postprocess_svg.py and qa_scorer.py.
All constants are grounded in generate_drawing.py output structure.
"""
import xml.etree.ElementTree as ET
import re
import math
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

ANNOTATION_PREFIXES = (
    "dimensions-", "plan-dimensions-", "datums-", "gdt-", "chamfer-callouts",
    "surface-finish", "thread-callouts", "ordinate-dimensions",
    "baseline-dimensions",
)

TITLEBLOCK_Y = 247.0


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


# Page-space evidence for the SVG subset emitted by this drawing pipeline.
# Keep elem_bbox_approx local: legacy repair callers mutate local coordinates.
_SVG_NUMBER = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?"
_IDENTITY = (1., 0., 0., 1., 0., 0.)
_DRAWABLE = {"text", "line", "polyline", "polygon", "path", "rect", "circle", "ellipse", "use", "image"}


def _number(value, default=None):
    if value is None:
        return default
    if not re.fullmatch(_SVG_NUMBER, str(value).strip()):
        raise ValueError("unsupported or nonfinite numeric attribute")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("nonfinite numeric attribute")
    return number


def _numbers(value):
    value = str(value)
    tokens = re.findall(_SVG_NUMBER, value)
    remainder = re.sub(_SVG_NUMBER, "", value)
    if remainder.strip(" ,\t\r\n"):
        raise ValueError("unsupported numeric list")
    return [_number(token) for token in tokens]


def _multiply(a, b):
    result = (a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
              a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
              a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5])
    if not all(math.isfinite(v) for v in result):
        raise ValueError("nonfinite transform")
    return result


def _transform(value):
    value = value or ""
    matrix, position = _IDENTITY, 0
    for match in re.finditer(r"([A-Za-z]+)\s*\(([^)]*)\)", value):
        if value[position:match.start()].strip(" ,\t\r\n"):
            raise ValueError("unsupported transform")
        name, values = match[1], _numbers(match[2])
        if name == "translate" and len(values) in (1, 2):
            local = (1, 0, 0, 1, values[0], values[1] if len(values) == 2 else 0)
        elif name == "scale" and len(values) in (1, 2):
            local = (values[0], 0, 0, values[-1], 0, 0)
        elif name == "rotate" and len(values) in (1, 3):
            angle = math.radians(values[0])
            cosine, sine = math.cos(angle), math.sin(angle)
            local = (cosine, sine, -sine, cosine, 0, 0)
            if len(values) == 3:
                x, y = values[1:]
                local = _multiply(_multiply((1, 0, 0, 1, x, y), local), (1, 0, 0, 1, -x, -y))
        elif name == "matrix" and len(values) == 6:
            local = tuple(values)
        else:
            raise ValueError("unsupported transform: " + name)
        if local[0]*local[3]-local[1]*local[2] == 0:
            raise ValueError("degenerate transform")
        matrix = _multiply(matrix, local)
        position = match.end()
    if value[position:].strip(" ,\t\r\n"):
        raise ValueError("unsupported transform")
    return matrix


def _point(matrix, point):
    x, y = point
    result = (matrix[0]*x+matrix[2]*y+matrix[4], matrix[1]*x+matrix[3]*y+matrix[5])
    if not all(math.isfinite(v) for v in result):
        raise ValueError("nonfinite page coordinate")
    return result


def _point_bbox(points):
    if not points:
        return None
    xs, ys = zip(*points)
    return BBox(min(xs), min(ys), max(xs)-min(xs), max(ys)-min(ys))


def _rect_points(x, y, width, height):
    if width < 0 or height < 0:
        raise ValueError("negative extent")
    return [(x, y), (x+width, y), (x+width, y+height), (x, y+height)]


def _linear_path(value):
    """Only actual straight SVG segments; curves are not guessed from numbers."""
    tokens = re.findall(r"[A-Za-z]|" + _SVG_NUMBER, value)
    if re.sub(r"[A-Za-z]|" + _SVG_NUMBER, "", value).strip(" ,\t\r\n"):
        raise ValueError("unsupported path syntax")
    current, start, command, points, segments = (0., 0.), None, None, [], []
    index = 0
    while index < len(tokens):
        if tokens[index].isalpha():
            command = tokens[index]
            index += 1
            if command not in "MmLlHhVvZz":
                raise ValueError("curved path unsupported for line collision")
            if command in "Zz":
                if start is None:
                    raise ValueError("path close without start")
                segments.append((current, start)); current = start; command = None
                continue
        if command is None:
            raise ValueError("path command missing")
        count = 1 if command in "HhVv" else 2
        if index+count > len(tokens) or any(t.isalpha() for t in tokens[index:index+count]):
            raise ValueError("incomplete path coordinates")
        values = [_number(t) for t in tokens[index:index+count]]
        index += count
        if command in "Hh":
            target = (values[0] + (current[0] if command == "h" else 0), current[1])
        elif command in "Vv":
            target = (current[0], values[0] + (current[1] if command == "v" else 0))
        else:
            target = tuple(values[i] + (current[i] if command.islower() else 0) for i in (0, 1))
        if command in "Mm":
            start = target; command = "l" if command == "m" else "L"
        else:
            segments.append((current, target))
        points.append(target); current = target
    return points, segments


@dataclass
class SvgElementContext:
    element: object
    classes: frozenset
    bbox: object
    segments: tuple = ()
    text_polygon: tuple = ()
    view_id: str = None
    notes_region: object = None
    unsupported_reason: str = None
    layout_overflow: bool = False


def iter_svg_context(root):
    """Visible leaves, inherited style/classes, page geometry and honest gaps.

    Text bounds remain font-width estimates, not browser glyph measurements.
    Unsupported transforms, curved paths and positioned tspans yield bbox None.
    """
    stylesheet = any(local_tag(elem) == "style" and _text_content(elem).strip() for elem in root.iter())

    def visit(elem, inherited, classes, matrix, view_id, notes_region, reason=None, layout_overflow=False):
        tag = local_tag(elem)
        if tag in {"defs", "style", "metadata", "title", "desc", "clipPath", "mask", "pattern", "marker", "symbol"}:
            return
        styles = dict(inherited)
        styles.update({k: elem.get(k) for k in ("font-size", "text-anchor", "visibility", "clip-path", "mask", "filter") if elem.get(k) is not None})
        own_style = dict(re.findall(r"([\w-]+)\s*:\s*([^;]+)", elem.get("style", "")))
        styles.update(own_style)
        if elem.get("display") == "none" or own_style.get("display") == "none":
            return
        classes = classes | frozenset(elem.get("class", "").split())
        view_id = elem.get("data-view-id", view_id)
        layout_overflow = layout_overflow or elem.get("data-layout-overflow") == "true"
        try:
            matrix = _multiply(matrix, _transform(elem.get("transform")))
            if own_style.get("transform") or any(styles.get(k, "none") != "none" for k in ("clip-path", "mask", "filter")):
                raise ValueError("CSS transform, clipping or filter unsupported")
            if tag == "svg" and elem is not root:
                raise ValueError("nested SVG viewport unsupported")
            if elem.get("data-region-bounds") is not None:
                if matrix[1] != 0 or matrix[2] != 0:
                    raise ValueError("rotated or skewed notes region unsupported")
                bounds = _numbers(elem.get("data-region-bounds"))
                if len(bounds) != 4:
                    raise ValueError("invalid region bounds")
                notes_region = _point_bbox([_point(matrix, p) for p in _rect_points(*bounds)])
        except (ValueError, OverflowError) as error:
            reason = reason or str(error)
        if tag in _DRAWABLE and styles.get("visibility") not in {"hidden", "collapse"}:
            bbox, segments, polygon = None, [], []
            try:
                if reason:
                    raise ValueError(reason)
                get = lambda key, default=0.: _number(elem.get(key), default)
                points = []
                if tag == "text":
                    if any(child.attrib for child in elem) or any(elem.get(k) for k in ("dx", "dy", "textLength", "lengthAdjust", "rotate")):
                        raise ValueError("positioned or styled text runs unsupported")
                    size = _number(styles.get("font-size"), 2.)
                    if size <= 0:
                        raise ValueError("nonpositive font size")
                    width = len(_text_content(elem))*size*.55
                    anchor = styles.get("text-anchor", "start")
                    if anchor not in {"start", "middle", "end"}:
                        raise ValueError("unsupported text anchor")
                    x = get("x") - (width/2 if anchor == "middle" else width if anchor == "end" else 0)
                    points = _rect_points(x, get("y")-size, width, size*1.2)
                    polygon = [_point(matrix, p) for p in points]
                elif tag == "line":
                    points = [(get("x1"), get("y1")), (get("x2"), get("y2"))]
                    segments = [(points[0], points[1])]
                elif tag in {"polyline", "polygon"}:
                    values = _numbers(elem.get("points", ""))
                    if len(values) < 4 or len(values) % 2:
                        raise ValueError("invalid polyline points")
                    points = list(zip(values[::2], values[1::2]))
                    segments = list(zip(points, points[1:]))
                    if tag == "polygon":
                        segments.append((points[-1], points[0]))
                elif tag == "path":
                    points, segments = _linear_path(elem.get("d", ""))
                elif tag == "rect":
                    if get("rx") or get("ry"):
                        raise ValueError("rounded rectangle unsupported for line collision")
                    points = _rect_points(get("x"), get("y"), get("width"), get("height"))
                    segments = list(zip(points, points[1:]+points[:1]))
                elif tag in {"circle", "ellipse"}:
                    rx = get("r") if tag == "circle" else get("rx")
                    ry = get("r") if tag == "circle" else get("ry")
                    points = _rect_points(get("cx")-rx, get("cy")-ry, 2*rx, 2*ry)
                else:
                    raise ValueError("unsupported drawable: " + tag)
                bbox = _point_bbox([_point(matrix, p) for p in points])
                segments = [(_point(matrix, a), _point(matrix, b)) for a, b in segments]
            except (ValueError, OverflowError) as error:
                reason = str(error)
            yield SvgElementContext(elem, classes, bbox, tuple(segments), tuple(polygon), view_id, notes_region, reason, layout_overflow)
        # Text children belong to their text run, not separate drawable leaves.
        if tag != "text":
            for child in elem:
                yield from visit(child, styles, classes, matrix, view_id, notes_region, reason, layout_overflow)
    yield from visit(root, {}, frozenset(), _IDENTITY, None, None,
                     "stylesheet cascade unsupported" if stylesheet else None)


def iter_svg_elements(root):
    """Stable planner API: (element, inherited class tokens, page BBox or None)."""
    for context in iter_svg_context(root):
        yield context.element, context.classes, context.bbox


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
