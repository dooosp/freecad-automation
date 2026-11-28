"""Remove only the same runtime reference measurement, never equal numbers."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from _drawing_svg import render_dimensions_svg
from _dim_plan import render_plan_dimensions_svg
import _pcb_drawing_bindings as pcb


CONTEXT = {'source': 'freecad_runtime', 'model_object_id': 'final',
           'bbox_min_mm': [0, 0, 0], 'bbox_max_mm': [145, 98, 12]}


def scene(length_status='rendered', length_origin=0, body_length=145, general_tolerance=''):
    telemetry = {}
    drawings = {}
    context = {**CONTEXT, 'bbox_max_mm': [body_length, 98, 12]}
    for view, bounds in [('front', (0, 0, body_length, 12)), ('top', (0, 0, body_length, 98)), ('right', (0, 0, 98, 12))]:
        drawings[view] = render_dimensions_svg(view, bounds, [], 112.5, 73, .5,
                                               telemetry=telemetry, model_context=context,
                                               tolerances={'general': general_tolerance})
    intents = []
    bindings = {}
    for dim_id, kind, axis, value, points in [
        ('PLATE_LENGTH', 'plate_length', 'u', 145, [[length_origin, 0, 4], [length_origin+145, 0, 4]]),
        ('PLATE_WIDTH', 'plate_width', 'v', 98, [[0, 0, 4], [0, 98, 4]]),
    ]:
        intents.append({'id': dim_id, 'feature': 'plate', 'view': 'top', 'style': 'linear', 'value_mm': value, 'required': True})
        uv = [p[:2] for p in points]
        bindings[('top', dim_id, 'plate')] = {'source': 'freecad_runtime', 'status': 'resolved',
            'model_object_id': 'final', 'feature_id': 'plate', 'measurement': 'pcb_linear_reference',
            'dimension_kind': kind, 'axis': axis, 'measured_mm': value, 'endpoints_3d_mm': points,
            'endpoints_uv_mm': uv, 'bounds': [*uv[0], *uv[1]],
            'plate_bounds_mm': [length_origin, 0, 0, length_origin+145, 98, 4],
            'reference_refs': [{'feature_id': 'plate', 'geometry_ref': 'final:Edge1', 'kind': 'edge_endpoint'}]*2}
    planned, _, _ = render_plan_dimensions_svg(intents, 'top', (0, 0, 145, 98), [], [], 112.5, 73, .5, 0, 0,
                                               telemetry=telemetry, runtime_linear_bindings=bindings, dedupe_policy='off')
    drawings['top'] += planned
    if length_status != 'rendered':
        telemetry['plan_dimensions'][0].update(status='unresolved', rendered=False)
    return drawings, telemetry


def labels(drawings):
    return [e.text for svg in drawings.values() for e in ET.fromstring('<svg>'+svg+'</svg>').iter('text')]


def test_every_automatic_extent_primitive_has_one_complete_annotation_identity():
    drawings, telemetry = scene()
    root = ET.fromstring('<svg>'+drawings['front']+'</svg>')
    first_id = telemetry['auto_dimensions'][0]['dim_id']
    members = [e for e in root.iter() if e.get('data-annotation-id') == first_id]
    assert len(members) == 6
    assert {e.get('data-annotation-role') for e in members} == {
        'extension-a', 'extension-b', 'dimension-line', 'arrow-a', 'arrow-b', 'label'}


def test_verified_plate_measurements_replace_all_auto_duplicates_but_keep_one_true_total_z():
    drawings, telemetry = scene()
    pcb.deduplicate_pcb_overall_dimensions(drawings, telemetry, CONTEXT)
    actual = labels(drawings)
    assert actual.count('145') == 1
    assert actual.count('98') == 1
    assert actual.count('12') == 1
    assert all(d['rendered'] for d in telemetry['plan_dimensions'])
    removed = [d for d in telemetry['auto_dimensions'] if d.get('status') == 'replaced']
    assert len(removed) == 5
    remaining_ids = {e.get('data-annotation-id') for svg in drawings.values()
                     for e in ET.fromstring('<svg>'+svg+'</svg>').iter()}
    assert not any(d['dim_id'] in remaining_ids for d in removed), 'arrows/extensions must not be orphaned'


@pytest.mark.parametrize('problem', ['unrendered', 'different_reference', 'missing_svg'])
def test_unproven_or_equal_value_different_reference_never_removes_auto145(problem):
    drawings, telemetry = scene(length_status='unresolved' if problem == 'unrendered' else 'rendered',
                                length_origin=10 if problem == 'different_reference' else 0)
    if problem == 'missing_svg':
        import re
        drawings['top'] = re.sub(r'<text\b[^>]*data-dim-id="PLATE_LENGTH"[^>]*>[^<]*</text>', '', drawings['top'])
    pcb.deduplicate_pcb_overall_dimensions(drawings, telemetry, CONTEXT)
    assert sum(d.get('status') == 'rendered' and d.get('value_mm') == 145
               for d in telemetry['auto_dimensions']) == 2


def test_final_body_protrusion_does_not_conflate_overall155_with_plate145():
    drawings, telemetry = scene(body_length=155)
    context = {**CONTEXT, 'bbox_max_mm': [155, 98, 12]}
    pcb.deduplicate_pcb_overall_dimensions(drawings, telemetry, context)
    assert labels(drawings).count('155') == 2
    assert labels(drawings).count('145') == 1


def test_explicit_auto_tolerance_is_not_discarded_for_an_untoleranced_plan():
    drawings, telemetry = scene(general_tolerance='±0.10')
    pcb.deduplicate_pcb_overall_dimensions(drawings, telemetry, CONTEXT)
    assert labels(drawings).count('145') == 3
    assert labels(drawings).count('98') == 3
    assert labels(drawings).count('12') == 1
    assert labels(drawings).count('±0.10') == 5


def test_slot_width_and_standoff_height10_remain_distinct_measurements():
    drawings, telemetry = scene()
    for view, dim_id, feature, measurement, points, bounds in [
        ('top', 'CONNECTOR_SLOT_WIDTH', 'slot', 'pcb_linear_reference', [[60, 42, 4], [60, 52, 4]], [60, 42, 60, 52]),
        ('front', 'STANDOFF_HEIGHT', 'standoff1,standoff2,standoff3,standoff4', 'standoff_cylindrical_faces',
         [[21.5, 18, 4], [21.5, 18, 14]], [21.5, 4, 21.5, 14]),
    ]:
        binding = {'source': 'freecad_runtime', 'status': 'resolved', 'model_object_id': 'final',
                   'feature_id': feature, 'measurement': measurement, 'axis': 'v', 'measured_mm': 10,
                   'endpoints_3d_mm': points, 'bounds': bounds}
        intent = {'id': dim_id, 'feature': feature, 'view': view, 'style': 'linear', 'value_mm': 10, 'required': True}
        svg, _, _ = render_plan_dimensions_svg([intent], view, (0, 0, 145, 98 if view == 'top' else 14),
            [], [], 112.5, 73, .5, 0, 0, telemetry=telemetry, dedupe_policy='off',
            runtime_linear_bindings={(view, dim_id, feature): binding})
        drawings[view] += svg
    pcb.deduplicate_pcb_overall_dimensions(drawings, telemetry, CONTEXT)
    keys = [d['measurement_identity']['data-measurement-key'] for d in telemetry['plan_dimensions'] if d['value_mm'] == 10]
    assert len(keys) == len(set(keys)) == 2
    assert labels(drawings).count('10') == 2


def test_missing_front_total_height_label_cannot_remove_the_valid_right_height():
    import re
    drawings, telemetry = scene()
    front_z = next(d for d in telemetry['auto_dimensions'] if d['view'] == 'front' and d['value_mm'] == 12)
    drawings['front'] = re.sub(r'<text\b[^>]*id="' + front_z['dim_id'] + r'"[^>]*>[^<]*</text>', '', drawings['front'])
    pcb.deduplicate_pcb_overall_dimensions(drawings, telemetry, CONTEXT)
    assert labels(drawings).count('12') == 1
    assert next(d for d in telemetry['auto_dimensions'] if d['view'] == 'right' and d['value_mm'] == 12)['status'] == 'rendered'


def test_standalone_verified_thickness_is_complete_without_a_pcb_plan():
    from test_front_plate_thickness import draw
    from qa_scorer import collect_metrics
    intent, _, tree = draw()
    metrics = collect_metrics(tree, {'dim_intents': [intent]})
    assert metrics['datum_coherence'] is False
    assert metrics['linear_binding_mismatch'] == 0


def test_identity_enrichment_without_pcb_dimensions_is_idempotent_and_does_not_dedupe():
    from test_front_plate_thickness import draw
    from qa_scorer import collect_metrics
    intent, record, tree = draw()
    ET.register_namespace('', 'http://www.w3.org/2000/svg')
    drawings = {'front': ET.tostring(tree.getroot(), encoding='unicode')}
    telemetry = {'plan_dimensions': [record], 'auto_dimensions': []}
    # Exercise the final producer boundary with complete geometry but no identity
    # metadata yet; unrelated dimensions are not required to activate enrichment.
    for element in tree.iter():
        for key in list(element.attrib):
            if key.startswith(('data-measurement-', 'data-model-', 'data-feature-id')):
                element.attrib.pop(key)
    drawings['front'] = ET.tostring(tree.getroot(), encoding='unicode')
    pcb.deduplicate_pcb_overall_dimensions(drawings, telemetry, CONTEXT)
    pcb.deduplicate_pcb_overall_dimensions(drawings, telemetry, CONTEXT)
    after = ET.ElementTree(ET.fromstring(drawings['front']))
    assert collect_metrics(after, {'dim_intents': [intent]})['datum_coherence'] is False
    assert telemetry.get('replacements', []) == []


def test_enriching_an_already_typed_diameter_leader_keeps_valid_unique_xml_attributes():
    from _drawing_svg import tag_annotation
    line = '<line data-center-x="1" data-center-y="2" data-radius-page-mm="3" data-scale="0.5" x1="4" y1="2" x2="8" y2="2"/>'
    metadata = {'data-center-x': 1, 'data-center-y': 2, 'data-radius-page-mm': 3, 'data-scale': .5}
    enriched = tag_annotation([line], 'plan_top_001', ['leader'], metadata)[0]
    root = ET.fromstring(enriched)
    assert root.get('data-center-x') == '1'
    assert root.get('data-annotation-role') == 'leader'


def test_automatic_horizontal_extensions_cross_the_dimension_line_with_geometry_gap_preserved():
    from _drawing_svg import _dim_horizontal
    tree = ET.fromstring('<svg>' + ''.join(_dim_horizontal(10, 70, 100, 108, 120)) + '</svg>')
    extension_a, extension_b, shaft = tree.findall('line')
    assert [float(extension_a.get('x1')), float(extension_b.get('x1'))] == [10, 70]
    for extension in (extension_a, extension_b):
        assert float(extension.get('y1')) == 102, 'preserve the 2 mm geometry clearance'
        assert float(extension.get('y1')) < float(shaft.get('y1')) < float(extension.get('y2'))
