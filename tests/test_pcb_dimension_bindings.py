"""PCB dimensions retain measured feature endpoints rather than view extents."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from _dim_plan import render_plan_dimensions_svg
from qa_scorer import collect_metrics
import _pcb_drawing_bindings as pcb


def render(binding, intent, circles=None):
    telemetry = {}
    svg, _, _ = render_plan_dimensions_svg(
        [intent], 'top', (0, 0, 145, 98), circles or [], [], 112.5, 73, .5, 0, 0,
        telemetry=telemetry, dedupe_policy='off',
        runtime_linear_bindings={('top', intent['id'], intent['feature']): binding})
    return telemetry, ET.ElementTree(ET.fromstring('<svg xmlns="http://www.w3.org/2000/svg">' + svg + '</svg>'))


def slot():
    return ({'source': 'freecad_runtime', 'status': 'resolved', 'measurement': 'pcb_linear_reference',
             'axis': 'u', 'measured_mm': 18, 'bounds': [60, 42, 78, 42],
             'endpoints_uv_mm': [[60, 42], [78, 42]]},
            {'id': 'CONNECTOR_SLOT_SIZE', 'feature': 'slot', 'view': 'top', 'style': 'linear',
             'value_mm': 18, 'required': True})


def test_horizontal_slot_dimension_uses_its_actual_edge_and_page_anchors():
    binding, intent = slot()
    telemetry, tree = render(binding, intent)
    line = next(e for e in tree.iter() if e.get('data-dimension-line') == 'linear')
    assert abs(float(line.get('x2')) - float(line.get('x1'))) == 9
    assert telemetry['plan_dimensions'][0]['runtime_binding']['page_endpoints_mm'] == [[106.25, 76.5], [115.25, 76.5]]
    assert collect_metrics(tree, {'dim_intents': [intent]})['linear_binding_mismatch'] == 0


def test_shifted_horizontal_reference_cannot_pass_on_correct_label_and_span():
    binding, intent = slot()
    _, tree = render(binding, intent)
    extension = next(e for e in tree.iter() if e.get('data-dimension-extension') == 'linear')
    extension.set('y1', str(float(extension.get('y1')) + 5))
    assert collect_metrics(tree, {'dim_intents': [intent]})['linear_binding_mismatch'] > 0


def test_diameter_uses_verified_feature_center_instead_of_first_same_size_circle():
    binding = {'source': 'freecad_runtime', 'status': 'resolved', 'measurement': 'pcb_hole_diameter',
               'measured_mm': 4, 'circle_uv_mm': [22, 22, 2], 'center_uv': [22, 22]}
    intent = {'id': 'MOUNTING_HOLE_DIA', 'feature': 'hole1,hole2,hole3,hole4', 'style': 'diameter',
              'view': 'top', 'value_mm': 4, 'required': True}
    telemetry, tree = render(binding, intent, [(123, 76, 2), (22, 22, 2)])
    record = telemetry['plan_dimensions'][0]
    assert record['center_uv'] == [22, 22]
    assert record['runtime_binding']['page_center_mm'] == [87.25, 86.5]
    leader = next(e for e in tree.iter() if e.get('data-diameter-leader') == 'true')
    leader.set('x1', str(float(leader.get('x1')) + 20))
    assert collect_metrics(tree, {'dim_intents': [intent]})['linear_binding_mismatch'] > 0


def test_automatic_mixed_chains_are_replaced_only_after_both_runtime_patterns_render():
    drawings = {'top': '<g><text data-auto-chain="horizontal">18</text><text>101</text></g>'}
    telemetry = {'plan_dimensions': [
        {'dim_id': key, 'rendered': True, 'status': 'rendered', 'runtime_binding':
         {'status': 'resolved', 'measurement': 'pcb_linear_reference', 'dimension_kind': kind}}
        for key, kind in [('MOUNTING_HOLE_PATTERN_X', 'hole_pitch_x'), ('MOUNTING_HOLE_PATTERN_Y', 'hole_pitch_y')]],
        'auto_dimensions': [{'view': 'top', 'category': 'chain_horizontal', 'status': 'rendered'}]}
    assert pcb.replace_pcb_auto_chains(drawings, telemetry)
    assert 'data-auto-chain' not in drawings['top']
    assert '<text>101</text>' in drawings['top']
    assert telemetry['auto_dimensions'][0]['status'] == 'replaced'
    drawings['top'] = '<text data-auto-chain="horizontal">18</text>'
    telemetry['plan_dimensions'][1]['rendered'] = False
    assert not pcb.replace_pcb_auto_chains(drawings, telemetry)
    assert '18' in drawings['top']


def test_datum_symbol_and_leader_point_to_measured_feature_and_reject_movement():
    targets = {'B': {'status': 'resolved', 'view': 'top', 'source': 'freecad_runtime',
                     'feature_id': 'hole1', 'geometry_ref': 'final:Edge11', 'point_uv_mm': [22, 22]}}
    svg = pcb.render_pcb_datums('top', [0, 0, 145, 98], 112.5, 73, .5, targets)
    tree = ET.ElementTree(ET.fromstring('<svg xmlns="http://www.w3.org/2000/svg">' + svg + '</svg>'))
    leader = next(e for e in tree.iter() if e.get('data-datum-leader') == 'true')
    assert [float(leader.get('x1')), float(leader.get('y1'))] == [87.25, 86.5]
    assert collect_metrics(tree)['linear_binding_mismatch'] == 0
    leader.set('x1', '76.25')  # Old incorrect left plate boundary.
    assert collect_metrics(tree)['_details']['linear_binding_issues'][0]['reason'] == 'datum_reference_geometry_mismatch'
