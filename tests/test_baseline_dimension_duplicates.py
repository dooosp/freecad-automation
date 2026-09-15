"""One baseline coordinate per distinct location and tolerance."""

from pathlib import Path
import sys
import xml.etree.ElementTree as ET

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from _dim_baseline import render_baseline_dimensions_svg


@pytest.mark.parametrize('axis', ['horizontal', 'vertical'])
def test_projected_holes_at_the_same_coordinate_get_one_dimension(axis):
    positions = [(12, 12), (108, 12), (12, 48), (108, 48)]
    features = [{'position': position, 'label': f'hole{i}'} for i, position in enumerate(positions)]
    svg = render_baseline_dimensions_svg(features, (0, 0), axis, (0, 0, 120, 60), 100, 100, 1)
    labels = [t.text for t in ET.fromstring(svg).iter('text')]
    assert labels == (['12', '108'] if axis == 'horizontal' else ['12', '48'])


def test_equal_distances_on_opposite_sides_and_distinct_tolerances_are_preserved():
    features = [{'position': (-12, 0)}, {'position': (12, 0)},
                {'position': (12, 0), 'tolerance': ' ±0.1'}]
    svg = render_baseline_dimensions_svg(features, (0, 0), 'horizontal', (-20, 0, 20, 3), 100, 100, 1)
    assert [t.text for t in ET.fromstring(svg).iter('text')] == ['12', '12', '12 ±0.1']


def test_nearby_but_distinct_coordinates_are_not_merged_by_display_rounding():
    features = [{'position': (12, 0)}, {'position': (12.01, 0)}]
    svg = render_baseline_dimensions_svg(features, (0, 0), 'horizontal', (0, 0, 120, 3), 100, 100, 1)
    assert len(list(ET.fromstring(svg).iter('text'))) == 2
