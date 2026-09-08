"""Datum frames clear completed dimensions without changing feature anchors."""
import ast
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from _annotation_planner import AnnotationPlanner
from _dim_baseline import render_baseline_dimensions_svg

_generator = Path(__file__).resolve().parents[1] / 'scripts/generate_drawing.py'
_module = ast.parse(_generator.read_text())
_module.body = _module.body[:next(i for i, node in enumerate(_module.body) if isinstance(node, ast.Try))]
_namespace = {'__file__': str(_generator)}
exec(compile(_module, str(_generator), 'exec'), _namespace)
render_datums_svg = _namespace['render_datums_svg']


def frame_edges(frame):
    x, y = float(frame.get('x')), float(frame.get('y'))
    return x, y, x+float(frame.get('width')), y+float(frame.get('height'))


def test_bottom_datum_frame_clears_actual_extension_lines_and_keeps_triangle():
    original = ET.fromstring(render_datums_svg('front', (0, 0, 90, 54), 100, 100, 1))
    planner = AnnotationPlanner()
    planner.register_svg('<g><line x1="76" y1="119" x2="76" y2="160"/>'
                         '<line x1="79" y1="119" x2="79" y2="160"/></g>')
    result = ET.fromstring(render_datums_svg('front', (0, 0, 90, 54), 100, 100, 1,
        annotation_planner=planner, cell_bounds=(30, 60, 170, 180)))
    assert [p.get('points') for p in result.findall('polygon')] == [p.get('points') for p in original.findall('polygon')]
    assert [t.text for t in result.findall('text')] == ['A', 'B']
    frame = result.find('rect')
    x0, y0, x1, y1 = frame_edges(frame)
    assert not any(x0 < x < x1 for x in (76, 79))
    leader = result.find('line')
    assert (float(leader.get('x1')), float(leader.get('y1'))) == (77.5, 129.5)
    assert (float(leader.get('x2')), float(leader.get('y2'))) == ((x0+x1)/2, y0)
    assert 30 <= x0 < x1 <= 170 and 60 <= y0 < y1 <= 180


def test_left_datum_frame_moves_vertically_around_horizontal_dimension():
    planner = AnnotationPlanner()
    planner.register_svg('<line x1="25" y1="110" x2="65" y2="110"/>')
    result = ET.fromstring(render_datums_svg('top', (0, 0, 90, 54), 100, 100, 1,
        annotation_planner=planner, cell_bounds=(30, 60, 170, 180)))
    x0, y0, x1, y1 = frame_edges(result.find('rect'))
    assert not y0 < 110 < y1
    leader = result.find('line')
    assert (float(leader.get('x1')), float(leader.get('y1'))) == (52.5, 110.8)
    assert (float(leader.get('x2')), float(leader.get('y2'))) == (x1, (y0+y1)/2)
    assert result.find('text').text == 'B'


def test_datum_placed_after_baseline_sees_feature_extension_columns():
    planner = AnnotationPlanner()
    baseline = render_baseline_dimensions_svg(
        [dict(position=(21, 27), label='pin-left'), dict(position=(24, 0), label='mount')],
        (0, 0), 'horizontal', (0, 0, 90, 54), 100, 100, 1,
        start_offset=20, annotation_planner=planner, cell_bounds=(30, 60, 170, 180))
    root = ET.fromstring(render_datums_svg('front', (0, 0, 90, 54), 100, 100, 1,
        annotation_planner=planner, cell_bounds=(30, 60, 170, 180)))
    x0, y0, x1, y1 = frame_edges(root.find('rect'))
    for line in ET.fromstring(baseline).findall('.//line'):
        x_a, y_a, x_b, y_b = [float(line.get(k)) for k in ('x1', 'y1', 'x2', 'y2')]
        if x_a == x_b:
            assert not (x0 < x_a < x1 and min(y_a, y_b) < y1 and max(y_a, y_b) > y0)
    assert planner.overlap_score(x0, y0, x1, y1) > 0


def test_unavoidable_datum_overflow_is_retained_and_marked():
    root = ET.fromstring(render_datums_svg('front', (0, 0, 90, 54), 100, 100, 1,
        cell_bounds=(70, 125, 85, 130)))
    assert root.get('data-layout-overflow') == 'true'
    assert [t.text for t in root.findall('text')] == ['A', 'B']
    assert len(root.findall('polygon')) == 2
