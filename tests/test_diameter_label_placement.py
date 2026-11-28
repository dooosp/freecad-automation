"""Place complete diameter annotations around existing rendered text."""

import copy
import math
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from _dim_plan import render_plan_dimensions_svg
from svg_common import elem_bbox_approx, svg_contexts


ROTATED_HEIGHT = '''<g class="dimensions-top" font-size="3">
    <text x="159" y="73" text-anchor="middle"
    transform="rotate(-90,159,73)">100</text></g>'''


def tree(fragment):
    return ET.fromstring('<svg>' + fragment + '</svg>')


def boxes_intersect(a, b):
    return (min(a.x + a.w, b.x + b.w) > max(a.x, b.x)
            and min(a.y + a.h, b.y + b.h) > max(a.y, b.y))


def render(obstacles=ROTATED_HEIGHT, *, intent_updates=None, cx=112.5,
           intents=None):
    intent = {'id': 'HOLE_RIGHT_DIA', 'feature': 'hole_right', 'view': 'top',
              'style': 'diameter', 'required': True, 'value_mm': 10,
              'placement_side': 'bottom_right', 'placement_offset_mm': 8,
              **(intent_updates or {})}
    binding = {'status': 'resolved', 'source': 'freecad_runtime',
               'feature_id': 'hole_right', 'model_object_id': 'final',
               'measurement': 'legacy_cylindrical_diameter', 'measured_mm': 10,
               'circle_uv_mm': [125, 70, 5]}
    plan = intents or [intent]
    bindings = {('top', di['id'], di['feature']): copy.deepcopy(binding) for di in plan}
    telemetry = {}
    svg, _, _ = render_plan_dimensions_svg(
        plan, 'top', (0, 0, 160, 100), [(125, 70, 5)], [],
        cx, 73, .5, 0, 0, telemetry=telemetry, dedupe_policy='off',
        runtime_linear_bindings=bindings, existing_svg=obstacles,
    )
    return svg, tree(svg), telemetry


def test_symbolic_side_moves_complete_annotation_clear_of_rotated_height():
    svg, root, telemetry = render()
    label = next(e for e in root.iter('text'))
    height = tree(ROTATED_HEIGHT)
    height_text = next(height.iter('text'))
    assert not boxes_intersect(elem_bbox_approx(label),
                               elem_bbox_approx(height_text, svg_contexts(height)))
    assert label.text == 'Ø10'
    assert label.get('data-feature-id') == 'hole_right'
    assert float(label.get('data-value-mm')) == 10
    assert len(list(root.iter('text'))) == 1
    elements = list(root[0])
    leader, shelf, arrow, _ = elements
    assert len(elements) == 4
    assert leader.get('x2') == shelf.get('x1')
    assert leader.get('y2') == shelf.get('y1') == shelf.get('y2')
    assert float(label.get('y')) == pytest.approx(float(shelf.get('y2')) - .5)
    assert float(label.get('x')) == pytest.approx(float(shelf.get('x2')) - .5)
    start = (float(leader.get('x1')), float(leader.get('y1')))
    assert math.dist(start, (135, 63)) == pytest.approx(2.5, abs=.007)
    arrow_tip = tuple(float(n) for n in arrow.get('points').split()[0].split(','))
    assert arrow_tip == start
    assert telemetry['plan_dimensions'][0]['runtime_binding']['page_center_mm'] == [135, 63]
    assert telemetry['plan_dimensions'][0]['runtime_binding']['measured_mm'] == 10


def test_opposite_candidate_is_a_true_horizontal_reflection_clear_of_datum_triangle():
    _, preferred, _ = render('')
    _, reflected, telemetry = render()
    original_label = next(preferred.iter('text'))
    label = next(reflected.iter('text'))
    assert float(label.get('y')) == float(original_label.get('y'))
    assert float(label.get('x')) == pytest.approx(2 * 135 - float(original_label.get('x')))
    # The actual QP A marker is emitted after plan dimensions. Horizontal
    # reflection must not move the diameter label down into this triangle.
    datum = ET.fromstring('<polygon points="112.5,73 111.5,75 113.5,75"/>')
    assert not boxes_intersect(elem_bbox_approx(label), elem_bbox_approx(datum))
    assert telemetry['plan_dimensions'][0]['placement_adjustment']['selected_angle_deg'] == 210


@pytest.mark.parametrize('updates', [
    {'placement_angle_deg': 315},
    {'placement': {'side': 'bottom_right', 'offset_mm': 8, 'angle_deg': 315}},
])
def test_explicit_angle_preserves_deliberate_overlap_for_qa(updates):
    _, root, _ = render(intent_updates=updates)
    label = next(root.iter('text'))
    height = tree(ROTATED_HEIGHT)
    assert boxes_intersect(elem_bbox_approx(label),
                           elem_bbox_approx(next(height.iter('text')), svg_contexts(height)))
    assert float(label.get('x')) == pytest.approx(155.17)
    assert float(label.get('y')) == pytest.approx(74.17)


def test_unobstructed_preferred_side_is_unchanged():
    _, root, _ = render('')
    label = next(root.iter('text'))
    assert (float(label.get('x')), float(label.get('y'))) == (157.79, 70.75)
    assert label.get('text-anchor') == 'start'


@pytest.mark.parametrize('obstacles', [None, '<g>incomplete'])
def test_missing_or_unverified_context_preserves_the_existing_placement(obstacles):
    _, root, _ = render(obstacles)
    label = next(root.iter('text'))
    assert label.text == 'Ø10'
    assert (float(label.get('x')), float(label.get('y'))) == (157.79, 70.75)


def test_no_clear_candidate_preserves_required_annotation_instead_of_hiding_it():
    obstacle = '<text x="15" y="100" font-size="80">BLOCKED VIEW</text>'
    _, root, _ = render(obstacle)
    label = next(root.iter('text'))
    assert label.text == 'Ø10'
    assert (float(label.get('x')), float(label.get('y'))) == (157.79, 70.75)


def test_candidate_outside_view_cell_is_not_used():
    # Moving the model center left makes the alternate shelf leave the top cell.
    obstacle = '<text x="40" y="73" font-size="8">blocked</text>'
    _, root, _ = render(obstacle, cx=-2.5)
    label = next(root.iter('text'))
    assert (float(label.get('x')), float(label.get('y'))) == (42.79, 70.75)


def test_already_emitted_plan_text_is_an_obstacle_for_the_next_label():
    base = {'feature': 'hole_right', 'view': 'top', 'style': 'diameter',
            'required': True, 'value_mm': 10, 'placement_side': 'bottom_right',
            'placement_offset_mm': 8}
    intents = [{**base, 'id': 'FIRST'}, {**base, 'id': 'SECOND'}]
    _, root, _ = render('', intents=intents)
    labels = list(root.iter('text'))
    assert len(labels) == 2
    assert not boxes_intersect(*(elem_bbox_approx(e) for e in labels))
    assert {e.get('data-dim-id') for e in labels} == {'FIRST', 'SECOND'}
