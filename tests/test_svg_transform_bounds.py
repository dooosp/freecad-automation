"""Keep SVG overlap evidence in the same coordinates as rendered annotations."""

from pathlib import Path
import math
import sys
import xml.etree.ElementTree as ET

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from qa_scorer import detect_dim_overlaps, detect_text_overlaps
from svg_common import elem_bbox_approx, group_center
from svg_repair import repair_text_overlaps


def drawing(contents):
    return ET.ElementTree(ET.fromstring('<svg>' + contents + '</svg>'))


def assert_box(box, values):
    assert (box.x, box.y, box.w, box.h) == pytest.approx(values)


def test_quality_pass_rotated_100_overlaps_diameter_at_existing_threshold():
    tree = drawing('''<text x="159" y="73" font-size="3" text-anchor="middle"
        transform="rotate(-90,159,73)">100</text>
        <text x="157.79" y="75.75" font-size="3">Ø10</text>''')
    overlaps = detect_text_overlaps(tree)
    assert len(overlaps) == 1
    assert {overlaps[0]['text1'], overlaps[0]['text2']} == {'100', 'Ø10'}
    assert overlaps[0]['iou'] == pytest.approx(0.161, abs=0.001)


@pytest.mark.parametrize('angle,expected', [
    (90, (8, 14.5, 12, 11)),
    (-90, (0, 14.5, 12, 11)),
])
def test_rotation_about_text_pivot_transforms_all_box_corners(angle, expected):
    elem = ET.fromstring(f'''<text x="10" y="20" font-size="10"
        text-anchor="middle" transform="rotate({angle},10,20)">AB</text>''')
    assert_box(elem_bbox_approx(elem), expected)


def test_rotation_without_pivot_uses_origin_for_non_right_angle():
    elem = ET.fromstring('<text x="0" y="10" font-size="10" transform="rotate(45)">AB</text>')
    assert_box(elem_bbox_approx(elem), (-12 / math.sqrt(2), 0,
                                      23 / math.sqrt(2), 23 / math.sqrt(2)))


@pytest.mark.parametrize('transform,expected', [
    ('translate(20,30) rotate(90)', (8, 30, 12, 11)),
    ('rotate(90) translate(20 30)', (-42, 20, 12, 11)),
    ('matrix(0 1 -1 0 20 30)', (8, 30, 12, 11)),
    ('translate(2e1 3e1) scale(2 3)', (20, 30, 22, 36)),
    ('skewX(45)', (0, 0, 23, 12)),
    ('skewY(45)', (0, 0, 11, 23)),
])
def test_affine_transform_list_order_and_matrix_forms(transform, expected):
    elem = ET.fromstring(f'<text x="0" y="10" font-size="10" transform="{transform}">AB</text>')
    assert_box(elem_bbox_approx(elem), expected)


@pytest.mark.parametrize('anchor,x', [('start', 60), ('middle', 49), ('end', 38)])
def test_group_bounds_apply_nested_transforms_and_inherited_text_style_once(anchor, x):
    elem = ET.fromstring(f'''<g transform="translate(20 30)" font-size="10"
        text-anchor="{anchor}"><g transform="scale(2)">
        <text x="20" y="20">AB</text></g></g>''')
    assert_box(elem_bbox_approx(elem), (x, 50, 22, 24))
    assert group_center(elem) == pytest.approx((x + 11, 62))


def test_inline_style_overrides_presentation_attributes_and_is_inherited():
    elem = ET.fromstring('''<g font-size="2" text-anchor="start"
        style="font-size:10; text-anchor:end"><text x="20" y="20">AB</text></g>''')
    assert_box(elem_bbox_approx(elem), (9, 10, 11, 12))


def test_qa_combines_ancestor_and_local_transforms():
    tree = drawing('''<g transform="translate(100 50)" font-size="3">
        <g transform="translate(59 23)"><text x="0" y="0" text-anchor="middle"
        transform="rotate(-90)">100</text></g></g>
        <text x="157.79" y="75.75" font-size="3">Ø10</text>''')
    overlaps = detect_text_overlaps(tree)
    assert len(overlaps) == 1
    assert overlaps[0]['iou'] == pytest.approx(0.161, abs=0.001)
    assert overlaps[0]['view'] == 'top'


def test_rotation_away_from_another_text_does_not_create_false_overlap():
    tree = drawing('''<text x="50" y="50" font-size="10" transform="rotate(90)">AB</text>
        <text x="50" y="50" font-size="10">CD</text>''')
    assert detect_text_overlaps(tree) == []


def test_dimension_geometry_comparison_uses_transformed_page_coordinates():
    tree = drawing('''<g class="dimensions-top" transform="translate(100 50)">
        <text x="20" y="20" font-size="10" transform="rotate(-90 20 20)">AB</text></g>
        <g class="hard_visible" transform="translate(100 50)">
        <path d="M 10 9 L 22 20"/></g>''')
    assert detect_dim_overlaps(tree) == 1


def test_repair_does_not_detach_a_bound_dimension_from_its_leader():
    tree = drawing('''<g class="dimensions-top"><text x="159" y="73" font-size="3"
        text-anchor="middle" transform="rotate(-90,159,73)" font-family="monospace">100</text></g>
        <g class="plan-dimensions-top"><line data-diameter-leader="true"
        data-dim-id="HOLE_RIGHT_DIA" x1="136" y1="65" x2="150" y2="76"/>
        <text x="157.79" y="75.75" font-size="3" data-runtime-diameter="true"
        data-dim-id="HOLE_RIGHT_DIA">Ø10</text></g>''')
    before = ET.tostring(tree.getroot())
    result = repair_text_overlaps(tree)
    assert ET.tostring(tree.getroot()) == before
    assert result['summary']['texts_moved'] == 0
    assert len(detect_text_overlaps(tree)) == 1


def test_repair_does_not_detach_an_annotated_auto_label_from_its_baseline():
    tree = drawing('''<g class="dimensions-top">
        <line data-annotation-id="auto_top_002" data-annotation-role="dimension-line"
        x1="161" y1="48" x2="161" y2="98"/>
        <text x="159" y="73" font-size="3" text-anchor="middle"
        transform="rotate(-90,159,73)" font-family="sans-serif"
        data-annotation-id="auto_top_002" data-annotation-role="label"
        data-measurement-key="top:Y:0:100">100</text></g>
        <g class="plan-dimensions-top">
        <line data-diameter-leader="true" data-dim-id="HOLE_RIGHT_DIA"
        x1="136.77" y1="64.77" x2="146.67" y2="74.67"/>
        <text x="155.17" y="74.17" font-size="3" data-runtime-diameter="true"
        data-dim-id="HOLE_RIGHT_DIA">Ø10</text></g>''')
    before = ET.tostring(tree.getroot())
    assert len(detect_text_overlaps(tree)) == 1
    result = repair_text_overlaps(tree)
    assert ET.tostring(tree.getroot()) == before
    assert result['summary']['texts_moved'] == 0
    assert len(detect_text_overlaps(tree)) == 1


def test_movable_transformed_text_shifts_in_page_coordinates_without_changing_pivot():
    tree = drawing('''<g transform="translate(20 30)">
        <text x="30" y="30" font-size="3" transform="rotate(-90 30 30)"
        font-family="monospace">fixed</text>
        <text x="30" y="30" font-size="3" transform="rotate(-90 30 30)">move</text></g>''')
    mover = tree.getroot()[0][1]
    original_transform = mover.get('transform')
    result = repair_text_overlaps(tree, max_iter=1, step_mm=2.5)
    assert result['summary']['texts_moved'] == 1
    # A downward page displacement under -90° rotation is negative local X.
    assert float(mover.get('x')) == pytest.approx(27.5)
    assert float(mover.get('y')) == pytest.approx(30)
    assert mover.get('transform') == original_transform


def test_untransformed_text_box_and_threshold_behavior_are_unchanged():
    elem = ET.fromstring('<text x="50" y="50" font-size="3" text-anchor="middle">123</text>')
    assert_box(elem_bbox_approx(elem), (47.525, 47, 4.95, 3.6))
    assert elem_bbox_approx(elem).w == 3 * 3 * 0.55
    tree = drawing('''<text x="159" y="73" font-size="3" text-anchor="middle">100</text>
        <text x="157.79" y="75.75" font-size="3">Ø10</text>''')
    assert detect_text_overlaps(tree) == []
