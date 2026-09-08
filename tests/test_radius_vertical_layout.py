"""Real SVG layout regressions for radius leaders and rotated baseline text."""
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from _annotation_planner import AnnotationPlanner
from _dim_baseline import render_baseline_dimensions_svg
from _drawing_svg import _dim_radius, render_dimensions_svg
from svg_common import iter_svg_elements


def text_bounds(root, label):
    return next(box for element, _classes, box in iter_svg_elements(root)
                if element.tag.rsplit('}', 1)[-1] == 'text' and element.text == label)


def assert_inside(box, bounds):
    x0, y0, x1, y1 = bounds
    assert x0 <= box.x and y0 <= box.y
    assert box.x + box.w <= x1 and box.y + box.h <= y1


def test_vertical_baseline_reports_rotated_text_overflow_and_keeps_tolerance():
    root = ET.fromstring(render_baseline_dimensions_svg(
        [dict(position=(0, 100), label='bore', tolerance=' H7')],
        (0, 0), 'vertical', (0, 0, 10, 100), 100, 50, .1,
        start_offset=20, cell_bounds=(80, 44, 150, 60)))
    box = text_bounds(root, '100 H7')
    assert box.y < 44  # The rotated start-anchored text extends above the cell.
    assert root.get('data-layout-overflow') == 'true'
    assert root.find('.//text').text == '100 H7'


def test_vertical_baseline_avoids_obstacle_at_actual_rotated_label_start():
    planner = AnnotationPlanner()
    planner.register(119, 41, 123, 44)
    root = ET.fromstring(render_baseline_dimensions_svg(
        [dict(position=(0, 100), label='bore', tolerance=' H7')],
        (0, 0), 'vertical', (0, 0, 10, 100), 100, 50, .1,
        annotation_planner=planner, start_offset=20,
        cell_bounds=(80, 20, 160, 80)))
    box = text_bounds(root, '100 H7')
    assert box.x >= 123
    assert_inside(box, (80, 20, 160, 80))


def test_radius_moves_connected_callout_and_keeps_observed_arc_anchor():
    planner = AnnotationPlanner()
    occupied = (59, 43, 76, 52)
    planner.register(*occupied)
    root = ET.fromstring('<g>' + '\n'.join(_dim_radius(
        50, 50, 55, 50, 5, 2.5, annotation_planner=planner,
        cell_bounds=(20, 20, 85, 80))) + '</g>')
    lines = root.findall('.//line')
    assert [float(lines[0].get(k)) for k in ('x1', 'y1')] == [55, 50]
    # The arrow-bearing first segment remains radial to that observed arc point.
    assert float(lines[0].get('y2')) == 50
    assert float(lines[0].get('x2')) > 55
    for current, following in zip(lines, lines[1:]):
        assert current.get('x2') == following.get('x1')
        assert current.get('y2') == following.get('y1')
    for line in lines:
        x1, y1, x2, y2 = [float(line.get(k)) for k in ('x1', 'y1', 'x2', 'y2')]
        for step in range(101):
            t = step / 100
            assert not (occupied[0] < x1+(x2-x1)*t < occupied[2]
                        and occupied[1] < y1+(y2-y1)*t < occupied[3])
    box = text_bounds(root, 'R2.5')
    assert not (box.x < occupied[2] and box.x+box.w > occupied[0]
                and box.y < occupied[3] and box.y+box.h > occupied[1])
    assert_inside(box, (20, 20, 85, 80))
    assert root.find('.//text').text == 'R2.5'


def test_radius_cell_overflow_keeps_radius_and_anchor_visible_to_qa():
    root = ET.fromstring('<g>' + '\n'.join(_dim_radius(
        50, 50, 55, 50, 5, 2.5, cell_bounds=(49, 49, 56, 51))) + '</g>')
    assert root.find('.//text').text == 'R2.5'
    assert root.find('.//*[@data-layout-overflow="true"]') is not None
    first = root.find('.//line')
    assert (float(first.get('x1')), float(first.get('y1'))) == (55, 50)


def test_rendered_radius_is_registered_before_following_annotations():
    planner = AnnotationPlanner()
    root = ET.fromstring(render_dimensions_svg(
        'top', (0, 0, .2, .2), [], 100, 100, 1,
        arcs=[(.1, .1, 3, 3.1, .1, 0)], annotation_planner=planner))
    box = text_bounds(root, 'R3')
    assert planner.overlap_score(box.x, box.y, box.x+box.w, box.y+box.h) > 0


def test_radius_placement_is_deterministic_for_same_obstacles():
    def render():
        planner = AnnotationPlanner()
        planner.register(59, 43, 76, 52)
        return _dim_radius(50, 50, 55, 50, 5, 2.5,
                           annotation_planner=planner, cell_bounds=(20, 20, 85, 80))
    assert render() == render()
