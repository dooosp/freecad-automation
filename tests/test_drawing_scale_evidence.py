"""Scale labels describe measured paper geometry; small plan holes keep anchors."""
import math
import re
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
# This CLI runs stdin/FreeCAD at module scope. Load its definitions only.
_script = Path(__file__).resolve().parents[1] / 'scripts/generate_drawing.py'
_definitions = {'__file__': str(_script)}
exec(compile(_script.read_text().split('# -- Main Pipeline ')[0], str(_script), 'exec'), _definitions)
compose_drawing = _definitions['compose_drawing']
build_layout_report = _definitions['build_layout_report']
resolve_drawing_scale = _definitions['resolve_drawing_scale']
from _drawing_svg import render_view_svg, render_dimensions_svg
from _dim_plan import render_plan_dimensions_svg


@pytest.mark.parametrize('hint', [None, 'auto', 'AUTO', ' auto '])
def test_studio_auto_token_uses_fitted_scale_and_remains_non_explicit(hint):
    bbox = SimpleNamespace(XLength=142, YLength=74, ZLength=4)
    factor = resolve_drawing_scale(hint, bbox)
    assert factor == 0.5
    # Auto can be fit-adjusted without becoming an unmet explicit-scale gate.
    evidence = build_layout_report({}, 0.25, requested_scale=hint, initial_scale=factor)['scale']
    assert evidence['mode'] == 'auto'
    assert evidence['requested'] is None
    assert evidence['requested_factor'] is None
    assert evidence['fit_adjusted'] is True
    assert evidence['explicit_scale_satisfied'] is None


@pytest.mark.parametrize('hint, factor', [('1:1', 1), ('1:2', 0.5), ('2:1', 2), (0.75, 0.75), ('0.75', 0.75)])
def test_explicit_scale_resolution_and_unmet_scale_evidence_are_preserved(hint, factor):
    bbox = SimpleNamespace(XLength=142, YLength=74, ZLength=4)
    assert resolve_drawing_scale(hint, bbox) == factor
    evidence = build_layout_report({}, factor / 2, requested_scale=hint, initial_scale=factor)['scale']
    assert evidence['mode'] == 'explicit'
    assert evidence['requested'] == hint
    assert evidence['requested_factor'] == factor
    assert evidence['explicit_scale_satisfied'] is False


@pytest.mark.parametrize('scale', [1, 0.5, 0.75056023, 1.5])
def test_title_scale_matches_actual_svg_geometry(scale):
    view = render_view_svg('top', {0: [{'pts': [(0, 0), (142, 0)]}]},
                           (0, 0, 142, 74), [], 100, 100, scale)
    svg = compose_drawing({'top': view}, 'scale-test', [], scale, (142, 74, 4))
    root = ET.fromstring(svg)
    ns = {'s': 'http://www.w3.org/2000/svg'}
    texts = list(root.iter('{http://www.w3.org/2000/svg}text'))
    label = texts[next(i for i, node in enumerate(texts) if node.text == 'SCALE') + 1].text
    numerator, denominator = map(float, label.split(':'))
    path = root.find('.//s:g[@id="drawing-view-top"]//s:path', ns)
    points = [tuple(map(float, p.split(','))) for p in re.split('[ML]', path.get('d')) if p]
    measured = abs(points[-1][0] - points[0][0]) / 142
    assert abs(numerator / denominator - measured) < 0.0001, (label, measured)


def test_layout_exposes_explicit_fit_adjustment_and_auto_provenance():
    explicit = build_layout_report({}, 0.75056023, requested_scale='1:1', initial_scale=1)
    evidence = explicit['scale']
    assert evidence['mode'] == 'explicit'
    assert evidence['requested_factor'] == 1
    assert evidence['effective_factor'] == 0.75056023
    assert evidence['fit_adjusted'] is True
    assert evidence['explicit_scale_satisfied'] is False
    automatic = build_layout_report({}, 0.5, initial_scale=1)['scale']
    assert automatic['mode'] == 'auto'
    assert automatic['requested_factor'] is None
    assert automatic['explicit_scale_satisfied'] is None


@pytest.mark.parametrize('scale', [0.5, 0.25])
def test_small_plan_diameter_identifies_real_label_and_leader_anchor(scale):
    telemetry = {}
    bounds, circles = (0, 0, 142, 74), [(12, 12, 2.6), (120, 62, 2.6)]
    render_dimensions_svg('top', bounds, circles, 100, 100, scale, telemetry=telemetry)
    assert not any(d['category'] == 'hole_diameter' for d in telemetry['auto_dimensions'])
    svg, _, _ = render_plan_dimensions_svg(
        [{'id': 'HOLE_DIA', 'feature': 'mounting_hole_diameter', 'view': 'top',
          'style': 'diameter', 'value_mm': 5.2, 'required': True}],
        'top', bounds, circles, [], 100, 100, scale, 0, 0, telemetry=telemetry)
    record = telemetry['plan_dimensions'][0]
    assert record.get('center_uv') == [12, 12]
    assert record.get('svg_element_id')
    root = ET.fromstring(svg)
    label = root.find('text')
    assert label.get('id') == record['svg_element_id']
    assert label.text == 'Ø5.2'
    assert float(label.get('data-center-u')) == 12
    assert float(label.get('data-center-v')) == 12
    leader = root.find('line')
    center = (100 + (12 - 71) * scale, 100 - (12 - 37) * scale)
    assert math.isclose(math.hypot(float(leader.get('x1')) - center[0],
                                  float(leader.get('y1')) - center[1]),
                        2.6 * scale, abs_tol=0.01)
