"""Fixed CAD millimetres to reference pixels; no FreeCAD dependency."""
import math

WIDTH = 1520
HEIGHT = 840
PROFILE = 'coolgear-plate-top/v1'


def project_point(x_mm: float, y_mm: float) -> tuple[float, float]:
    if any(isinstance(v, bool) or not math.isfinite(v) for v in (x_mm, y_mm)):
        raise ValueError('Coordinates must be finite millimetres')
    u, v = 10.0 * (x_mm + 5.0), 10.0 * (79.0 - y_mm)
    if not (0 <= u <= WIDTH and 0 <= v <= HEIGHT):
        raise ValueError('Point lies outside the fixed view')
    return u, v


def feature_region(x_mm: float, y_mm: float, radius_mm: float) -> dict[str, float]:
    if isinstance(radius_mm, bool) or not math.isfinite(radius_mm) or radius_mm <= 0:
        raise ValueError('Hole radius must be positive and finite')
    u, v = project_point(x_mm, y_mm)
    margin = 10.0 * (radius_mm + 1.0)
    region = dict(x_min=(u-margin)/WIDTH, y_min=(v-margin)/HEIGHT,
                  x_max=(u+margin)/WIDTH, y_max=(v+margin)/HEIGHT)
    if not all(0 <= n <= 1 for n in region.values()):
        raise ValueError('ROI lies outside the fixed view')
    return region


def pixel_bounds(region: dict[str, float]) -> tuple[int, int, int, int]:
    """Half-open slice, Python round (nearest, ties-to-even), matching MVS v1."""
    left, top, right, bottom = (round(region[k]*size) for k, size in
                               [('x_min', WIDTH), ('y_min', HEIGHT),
                                ('x_max', WIDTH), ('y_max', HEIGHT)])
    if not (0 <= left < right <= WIDTH and 0 <= top < bottom <= HEIGHT):
        raise ValueError('ROI must have positive pixel area inside the view')
    return left, top, right, bottom
