"""Hand-calculated points catch origin, axis, scale and half-open ROI regressions."""
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))


def test_three_independent_reference_points():
    from mvs_reference_projection import project_point
    assert project_point(0.0, 0.0) == (50.0, 790.0)
    assert project_point(142.0, 0.0) == (1470.0, 790.0)
    assert project_point(0.0, 74.0) == (50.0, 50.0)
    assert project_point(29.0, 24.4) == (340.0, 546.0)
    assert project_point(17.2, 61.3) == pytest.approx((222.0, 177.0))


def test_half_open_regions_include_fractional_pixel_bounds():
    from mvs_reference_projection import feature_region, pixel_bounds
    assert pixel_bounds(feature_region(29, 24.4, 2)) == (310, 516, 370, 576)
    assert pixel_bounds(feature_region(12, 62, 2.75)) == (132, 132, 208, 208)


@pytest.mark.parametrize('point', [(math.nan, 1), (1, math.inf), (-6, 0), (0, 80)])
def test_invalid_coordinates_are_rejected(point):
    from mvs_reference_projection import project_point
    with pytest.raises(ValueError):
        project_point(*point)


@pytest.mark.parametrize('hole', [(0, 0, -1), (0, 0, 8), (1, 1, math.nan)])
def test_invalid_or_outside_roi_is_rejected(hole):
    from mvs_reference_projection import feature_region
    with pytest.raises(ValueError):
        feature_region(*hole)
