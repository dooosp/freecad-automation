"""A measured standoff group controls both dimension length and physical target."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from _dim_plan import render_plan_dimensions_svg
from qa_scorer import collect_metrics


FEATURE = 'standoff1,standoff2,standoff3,standoff4'


def render(height=8, nominal=None, status='resolved'):
    nominal = height if nominal is None else nominal
    binding = {'status': status, 'source': 'freecad_runtime', 'feature_id': FEATURE,
               'model_object_id': 'final', 'measurement': 'standoff_cylindrical_faces',
               'measured_mm': height, 'axis': 'v', 'bounds': [21.5, 4, 21.5, 4 + height],
               'endpoints_3d_mm': [[21.5, 18, 4], [21.5, 18, 4 + height]],
               'endpoints_uv_mm': [[21.5, 4], [21.5, 4 + height]]}
    intent = {'id': 'STANDOFF_HEIGHT', 'feature': FEATURE, 'style': 'linear', 'view': 'front',
              'value_mm': nominal, 'required': False, 'placement_side': 'left'}
    telemetry = {}
    svg, _, _ = render_plan_dimensions_svg(
        [intent], 'front', (0, 0, 145, 4 + height), [], [], 112.5, 189, .5, 0, 0,
        runtime_linear_bindings={('front', 'STANDOFF_HEIGHT', FEATURE): binding},
        telemetry=telemetry, dedupe_policy='off')
    tree = ET.ElementTree(ET.fromstring('<svg xmlns="http://www.w3.org/2000/svg">' + svg + '</svg>'))
    return intent, telemetry['plan_dimensions'][0], tree


@pytest.mark.parametrize('height', [8, 10])
def test_standoff_height_uses_verified_vertical_binding_and_exact_page_targets(height):
    intent, record, tree = render(height)
    line = next(e for e in tree.iter() if e.get('data-dimension-line') == 'linear')
    assert line.get('data-axis') == 'v'
    assert abs(float(line.get('y2')) - float(line.get('y1'))) == height / 2
    binding = record['runtime_binding']
    assert binding['page_endpoints_mm'] == [[87, 188 + height / 4], [87, 188 - height / 4]]
    assert binding['page_extension_gap_x_mm'] == 2
    extensions = [e for e in tree.iter() if e.get('data-dimension-extension') == 'linear']
    assert len(extensions) == 2
    assert collect_metrics(tree, {'dim_intents': [intent]})['linear_binding_mismatch'] == 0


def test_wrong_nominal_and_unresolved_group_cannot_render_partial_height():
    for kwargs, reason in [({'nominal': 9}, 'linear_value_geometry_mismatch'),
                           ({'status': 'unresolved'}, 'linear_anchor_unresolved')]:
        _, record, _ = render(**kwargs)
        assert record['rendered'] is False
        assert record['reason'] == reason


@pytest.mark.parametrize('axis', ['x', 'y'])
def test_shifted_extension_target_fails_even_when_dimension_height_is_unchanged(axis):
    intent, _, tree = render()
    extension = next(e for e in tree.iter() if e.get('data-dimension-extension') == 'linear')
    for suffix in ('1', '2'):
        key = axis + suffix
        extension.set(key, str(float(extension.get(key)) + 5))
    issues = collect_metrics(tree, {'dim_intents': [intent]})['_details']['linear_binding_issues']
    assert any(issue['reason'] == 'linear_reference_geometry_mismatch' for issue in issues)


def test_forged_gap_cannot_hide_a_shifted_target_from_qa():
    intent, _, tree = render()
    for extension in [e for e in tree.iter() if e.get('data-dimension-extension') == 'linear']:
        extension.set('x1', str(float(extension.get('x1')) + 3))
        extension.set('data-gap-x', '5')
    issues = collect_metrics(tree, {'dim_intents': [intent]})['_details']['linear_binding_issues']
    assert any(issue['reason'] == 'linear_reference_geometry_mismatch' for issue in issues)
