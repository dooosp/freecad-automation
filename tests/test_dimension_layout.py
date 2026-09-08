"""Layout regressions using real SVG renderers, without a CAD runtime."""
import ast
import json
import math
import sys
from pathlib import Path
from types import SimpleNamespace
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from _annotation_planner import AnnotationPlanner
from _drawing_svg import _dim_diameter
from _dim_baseline import render_baseline_dimensions_svg
# Load the real pure renderer definitions without entering stdin/FreeCAD CLI.
_generator = Path(__file__).resolve().parents[1] / "scripts/generate_drawing.py"
_module = ast.parse(_generator.read_text())
_module.body = _module.body[:next(i for i, node in enumerate(_module.body) if isinstance(node, ast.Try))]
_namespace = {"__file__": str(_generator)}
exec(compile(_module, str(_generator), "exec"), _namespace)
compose_drawing = _namespace["compose_drawing"]


def test_registered_svg_respects_nested_transform_and_line_extent():
    planner = AnnotationPlanner()
    planner.register_svg('<g transform="translate(40 20)"><g transform="scale(2)"><line x1="0" y1="0" x2="10" y2="0"/></g></g>')
    assert planner.overlap_score(45, 19.5, 50, 20.5) > 0
    assert planner.overlap_score(5, -1, 10, 1) == 0


def test_diameter_leader_moves_as_unit_around_occupied_text_region():
    planner = AnnotationPlanner()
    planner.register(52, 30, 78, 49)
    svg = ET.fromstring('<g>' + '\n'.join(_dim_diameter(
        50, 50, 5, 5, annotation_planner=planner, cell_bounds=(20, 20, 80, 80))) + '</g>')
    lines = svg.findall('line')
    first, shelf = lines[:2]
    assert math.isclose(math.hypot(float(first.get('x1')) - 50, float(first.get('y1')) - 50), 5, abs_tol=.02)
    assert first.get('x2') == shelf.get('x1') and first.get('y2') == shelf.get('y1')
    text = svg.find('text')
    x, y = float(text.get('x')), float(text.get('y'))
    assert not (52 < x < 78 and 30 < y < 49)
    assert abs(y - (float(shelf.get('y1')) - 1.2)) < .02
    assert text.text == '⌀10'


def test_baseline_coalesces_only_same_projected_endpoint_and_tolerance():
    features = [dict(position=(22, y), label=f'hole-{y}') for y in (0, 10)]
    features += [dict(position=(-22, 0), label='left'), dict(position=(22, 0), label='fit', tolerance=' H7')]
    root = ET.fromstring(render_baseline_dimensions_svg(features, (0, 0), 'horizontal', (-30, 0, 30, 10), 100, 50, 1))
    assert len(root.findall('.//text')) == 3
    ids = [json.loads(g.get('data-feature-ids')) for g in root.findall('g')]
    assert ['hole-0', 'hole-10'] in ids
    assert ['left'] in ids and ['fit'] in ids


def test_baseline_starts_after_occupied_rows_and_reports_overflow_without_dropping():
    planner = AnnotationPlanner()
    planner.register(80, 50, 130, 77)
    features = [dict(position=(20, 0), label='hole')]
    root = ET.fromstring(render_baseline_dimensions_svg(features, (0, 0), 'horizontal', (0, 0, 30, 10), 100, 50, 1,
        annotation_planner=planner, start_offset=20, cell_bounds=(50, 20, 150, 90)))
    assert float(root.find('.//text').get('y')) > 77
    overflow = ET.fromstring(render_baseline_dimensions_svg(features, (0, 0), 'horizontal', (0, 0, 30, 10), 100, 50, 1,
        start_offset=20, cell_bounds=(50, 20, 150, 60)))
    assert overflow.get('data-layout-overflow') == 'true'
    assert overflow.find('.//text').text == '20'


def test_composed_notes_have_explicit_footer_region_before_repair():
    svg = compose_drawing({}, 'fixture', [], 1, SimpleNamespace(XLength=10, YLength=20, ZLength=3), notes_list=['note'] * 5)
    root = ET.fromstring(svg)
    ns = {'s': 'http://www.w3.org/2000/svg'}
    notes = root.find("s:g[@class='general-notes']", ns)
    assert notes.get('data-layout-y-min') == '252'
    assert notes.get('data-layout-y-max') == '272'
    assert notes.get('data-region-bounds') == '19 249 212 25'
    assert [float(t.get('y')) for t in notes.findall('s:text', ns)] == [252, 256, 260, 264, 268, 272]


def test_notes_and_bom_use_separate_footer_columns():
    svg = compose_drawing({}, 'fixture', [{'id': 'part', 'material': 'steel'}], 1,
        SimpleNamespace(XLength=10, YLength=20, ZLength=3), notes_list=['note'])
    root = ET.fromstring(svg)
    ns = {'s': 'http://www.w3.org/2000/svg'}
    notes = root.find("s:g[@class='general-notes']", ns)
    left = float(notes.get('data-layout-x'))
    for line in root.findall('s:line', ns):
        if line.get('y1') == '257':
            assert float(line.get('x2')) < left


def test_diameter_leader_does_not_cross_an_existing_label():
    planner = AnnotationPlanner()
    planner.register(54, 44, 56, 46)
    root = ET.fromstring('<g>' + '\n'.join(_dim_diameter(50, 50, 5, 5,
        annotation_planner=planner, cell_bounds=(20, 20, 80, 80))) + '</g>')
    for line in root.findall('line'):
        x1, y1, x2, y2 = [float(line.get(k)) for k in ('x1', 'y1', 'x2', 'y2')]
        # Sampling here independently demonstrates the witnessed collision.
        for step in range(101):
            t = step / 100
            assert not (54 < x1+(x2-x1)*t < 56 and 44 < y1+(y2-y1)*t < 46)


def test_bbox_footer_metadata_does_not_cover_sheet_label():
    svg = compose_drawing({}, 'fixture', [], 1, SimpleNamespace(XLength=160, YLength=100, ZLength=8))
    root = ET.fromstring(svg)
    texts = [t for t in root.iter() if t.tag.endswith('text')]
    label = next(t for t in texts if t.text == 'SIZE / SHEET')
    bbox = next(t for t in texts if (t.text or '').startswith('BBox:'))
    assert float(bbox.get('x')) > float(label.get('x')) + 20
    assert float(bbox.get('y')) > float(label.get('y'))


def test_datum_letter_fits_its_frame_with_stroke_clearance():
    from svg_common import iter_svg_elements
    for view in ('top', 'front', 'right'):
        root = ET.fromstring(_namespace['render_datums_svg'](view, (0, 0, 100, 50), 100, 100, 1))
        frame = None
        for element, _classes, box in iter_svg_elements(root):
            tag = element.tag.rsplit('}', 1)[-1]
            if tag == 'rect':
                frame = box
            if tag == 'text':
                assert frame is not None
                assert box.y > frame.y + .175
                assert box.y + box.h < frame.y + frame.h - .175
