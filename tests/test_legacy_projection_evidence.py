"""Legacy projected dimensions require actual current circle/outline targets."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import _drawing_svg as drawing
from qa_scorer import collect_metrics


CIRCLES = [(30, 30, 3), (30, 30, 4), (125, 70, 5), (125, 70, 6)]
OUTLINE = [(1, 0), (159, 0), (160, 1), (160, 99), (159, 100), (1, 100), (0, 99), (0, 1), (1, 0)]
GROUPS = {0: [{'pts': OUTLINE}] + [{'pts': [], 'circ': c} for c in CIRCLES]}
CONTEXT = {'source': 'freecad_runtime', 'model_object_id': 'final',
           'bbox_min_mm': [0, 0, 0], 'bbox_max_mm': [160, 100, 8]}


def scene():
    telemetry = {}
    geometry = drawing.render_view_svg('top', GROUPS, (0, 0, 160, 100), CIRCLES, 112.5, 73, .5)
    dimensions = drawing.render_dimensions_svg('top', (0, 0, 160, 100), CIRCLES, 112.5, 73, .5,
        telemetry=telemetry, model_context=CONTEXT, geometry_groups=GROUPS)
    tree = ET.ElementTree(ET.fromstring('<svg xmlns="http://www.w3.org/2000/svg"><g class="drawing-view" data-view-id="top">'
                                      + geometry + dimensions + '</g></svg>'))
    return tree, telemetry


def test_nonaligned_hole_centers_use_their_actual_extension_origins():
    tree, telemetry = scene()
    entry = next(d for d in telemetry['auto_dimensions'] if d['category'] == 'chain_horizontal' and d['value_mm'] == 95)
    extensions = [e for e in tree.iter() if e.get('data-annotation-id') == entry['dim_id']
                  and e.get('data-annotation-role', '').startswith('extension-')]
    assert sorted(float(e.get('y1')) for e in extensions) == [65, 85]
    metrics = collect_metrics(tree)
    assert metrics['datum_coherence'] is False


@pytest.mark.parametrize('mutation', ['wrong_target', 'moved_circle', 'missing_circle'])
def test_changed_visible_geometry_or_target_cannot_keep_a_reference_exemption(mutation):
    tree, _ = scene()
    if mutation == 'wrong_target':
        extension = next(e for e in tree.iter() if e.get('data-reference-kind') == 'visible_projection'
                         and e.get('data-annotation-role') == 'extension-a')
        extension.set('x1', str(float(extension.get('x1')) + 8))
    else:
        parents = {child: parent for parent in tree.iter() for child in parent}
        circles = [e for e in tree.iter() if e.tag.endswith('}circle') and e.get('cx') == '87.50' and e.get('r') == '1.50']
        assert circles
        for circle in circles:
            if mutation == 'moved_circle':
                circle.set('cx', '97.50')
            else:
                parents[circle].remove(circle)
    assert collect_metrics(tree)['datum_coherence'] is True


def test_unrelated_unverified_baselines_remain_subject_to_the_original_cluster_rule():
    tree, _ = scene()
    namespace = '{http://www.w3.org/2000/svg}'
    group = ET.SubElement(tree.getroot(), namespace+'g', {'class': 'dimensions-top'})
    for y in [10, 20, 30, 40]:
        ET.SubElement(group, namespace+'line', {'x1': '10', 'x2': '30', 'y1': str(y), 'y2': str(y)})
    assert collect_metrics(tree)['datum_coherence'] is True


def test_verified_baseline_reference_uses_outline_at_hole_y_not_missing_chamfer_corner():
    telemetry = {}
    svg = drawing.render_verified_baseline_dimensions_svg(
        [{'position': (30, 30), 'label': 'hole_left'}, {'position': (125, 70), 'label': 'hole_right'}],
        (0, 0), 'horizontal', (0, 0, 160, 100), 112.5, 73, .5,
        vname='top', geometry_groups=GROUPS, model_context=CONTEXT, telemetry=telemetry)
    assert svg
    root = ET.fromstring(svg)
    extensions = [e for e in root.iter('line') if e.get('data-annotation-role') == 'extension-a']
    assert sorted(float(e.get('y1')) for e in extensions) == [65, 85]


def test_missing_named_hole_does_not_bind_to_another_equal_diameter_circle():
    from _drawing_traceability import resolve_named_top_hole_diameters
    config = {'shapes': [{'id': 'hole_right', 'type': 'cylinder', 'radius': 3, 'position': [125, 70, -2]}],
              'drawing_plan': {'dim_intents': [{'id': 'HOLE_LEFT_DIA', 'feature': 'hole_left', 'style': 'diameter', 'view': 'top', 'value_mm': 6}]},
              'drawing_intent': {'required_dimensions': [{'id': 'HOLE_LEFT_DIA', 'feature': 'hole_left', 'dimension_type': 'diameter'}]}}
    bindings = resolve_named_top_hole_diameters(config, None, 'final', lambda edge: None,
                                               {0: [{'circ': (125, 70, 3)}]})
    binding = bindings[('top', 'HOLE_LEFT_DIA', 'hole_left')]
    assert binding['status'] == 'unresolved'
    assert 'circle_uv_mm' not in binding


def test_complete_verified_baselines_replace_only_horizontal_chain_annotations():
    tree, telemetry = scene()
    svg = drawing.render_verified_baseline_dimensions_svg(
        [{'position': (30, 30)}, {'position': (125, 70)}], (0, 0), 'horizontal', (0, 0, 160, 100),
        112.5, 73, .5, vname='top', geometry_groups=GROUPS, model_context=CONTEXT, telemetry=telemetry)
    tree.getroot().append(ET.fromstring(svg))
    ET.register_namespace('', 'http://www.w3.org/2000/svg')
    drawings = {'top': ET.tostring(tree.getroot(), encoding='unicode')}
    drawing.replace_verified_baseline_chains(drawings, telemetry, 'top')
    assert 'data-auto-chain="horizontal"' not in drawings['top']
    assert 'data-auto-chain="vertical"' in drawings['top']
    assert len([d for d in telemetry['auto_dimensions'] if d['category'] == 'baseline_horizontal']) == 2


def test_outline_proof_uses_finite_edge_not_its_infinite_extension():
    from qa_scorer import _point_on_visible_segment
    assert not _point_on_visible_segment((100.5, 0), (0, 0), (100, 0))


def test_named_hole_route_does_not_capture_an_unrelated_outer_shaft_diameter():
    from _drawing_traceability import resolve_named_top_hole_diameters
    config = {'shapes': [{'id': 'shaft', 'type': 'cylinder', 'radius': 3}],
              'drawing_plan': {'dim_intents': [{'id': 'OD', 'feature': 'shaft', 'style': 'diameter', 'view': 'top', 'value_mm': 6}]},
              'drawing_intent': {'required_dimensions': [{'id': 'OD', 'feature': 'shaft', 'label': 'Outside diameter', 'dimension_type': 'diameter'}]}}
    assert resolve_named_top_hole_diameters(config, None, 'final', lambda edge: None, {}) == {}
