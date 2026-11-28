"""Exercise dimension links against real FreeCAD geometry, including bad inputs."""

import json
from pathlib import Path
import subprocess
import tempfile
import tomllib
import xml.etree.ElementTree as ET

import pytest

from test_intent_compiler import mounting_plate


ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def drawing_dir():
    available = subprocess.run(
        ['node', '--input-type=module', '-e',
         "import { hasFreeCADRuntime } from './lib/paths.js'; process.exit(hasFreeCADRuntime() ? 0 : 1)"],
        cwd=ROOT, capture_output=True,
    )
    if available.returncode:
        pytest.skip('FreeCAD runtime unavailable')
    parent = ROOT / 'tmp/codex'
    parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='plate-trace-test-', dir=parent) as directory:
        yield Path(directory)


def draw(directory, config):
    config['export'] = {'directory': str(directory / 'output'), 'formats': ['step']}
    config['manufacturing'] = {'material': 'AL6061'}
    path = directory / 'input.json'
    path.write_text(json.dumps(config))
    result = subprocess.run(['node', 'bin/fcad.js', 'draw', str(path)], cwd=ROOT,
                            text=True, capture_output=True)
    assert result.returncode == 0, result.stdout + result.stderr
    output = directory / 'output'
    trace = json.loads((output / 'device_mount_traceability.json').read_text())
    quality = json.loads((output / 'device_mount_drawing_quality.json').read_text())
    return {link['dim_id']: link for link in trace['links']}, quality


@pytest.mark.parametrize('right_x', [108, 100])
def test_plate_dimensions_link_to_runtime_bounds_and_hole_faces(drawing_dir, right_x):
    config = mounting_plate()
    for shape in config['shapes']:
        if shape['id'] in ('hole2', 'hole4'):
            shape['position'][0] = right_x
    links, quality = draw(drawing_dir, config)
    for dim_id, value in {'WIDTH': 120, 'HEIGHT': 3, 'THK': 3, 'BASE_W': 60, 'HOLE_DIA': 4.5}.items():
        link = links[dim_id]
        assert link['feature_id'], dim_id
        assert link['evidence']['source'] == 'freecad_runtime'
        assert link['evidence']['model_value_mm'] == value
        assert link['evidence']['model_object_id'] == 'cut4'
    assert links['WIDTH']['feature_id'] == 'plate'
    evidence = links['HOLE_DIA']['evidence']
    assert set(evidence['member_feature_ids']) == {'hole1', 'hole2', 'hole3', 'hole4'}
    assert len(evidence['face_refs']) == 4
    assert evidence['centers_xy'][1][0] == right_x
    assert quality['dimensions']['coverage_percent'] == 100
    assert quality['traceability']['coverage_percent'] == 100
    svg = ET.parse(drawing_dir / 'output/device_mount_drawing.svg')
    namespace = {'s': 'http://www.w3.org/2000/svg'}
    thickness = svg.find('.//s:text[@data-dim-id="THK"]', namespace)
    datums = svg.find('.//s:g[@class="datums-right"]', namespace)
    frames = datums.findall('s:rect', namespace)
    assert float(thickness.get('x')) > max(float(frame.get('x')) + float(frame.get('width')) for frame in frames), \
        'place thickness beyond the right-view datum frames, not over datum C'


@pytest.mark.parametrize('problem', ['wrong_width', 'mixed_hole_sizes', 'missing_hole', 'edge_notch', 'edge_notch_left', 'invented_web'])
def test_inconsistent_or_unproven_dimensions_stay_unverified(drawing_dir, problem):
    config = mounting_plate()
    expected_missing = 'HOLE_DIA'
    if problem == 'wrong_width':
        config['drawing_plan'] = {'dim_intents': [{'id': 'WIDTH', 'value_mm': 119.8}]}
        expected_missing = 'WIDTH'
    elif problem == 'mixed_hole_sizes':
        config['shapes'][-1]['radius'] = 2.5
    elif problem == 'missing_hole':
        config['shapes'][-1]['position'][0] = 200
    elif problem == 'edge_notch':
        config['shapes'][-1]['position'][0] = 120
    elif problem == 'edge_notch_left':
        config['shapes'][-1]['position'][0] = 0
    else:
        config['drawing_plan'] = {'part_type': 'bracket'}
        expected_missing = 'WEB_H'
    links, quality = draw(drawing_dir, config)
    assert links[expected_missing]['feature_id'] is None
    assert expected_missing in quality['traceability']['unmapped_required_entities']
    assert quality['status'] == 'fail'


@pytest.mark.parametrize('remove_corner', [False, True])
def test_plate_thickness_uses_surviving_final_edge_with_taller_standoff(drawing_dir, remove_corner):
    config = mounting_plate()
    config['shapes'].append({'id': 'standoff', 'type': 'cylinder', 'radius': 3.5,
                             'height': 8, 'position': [18, 18, 3]})
    config['operations'].append({'op': 'fuse', 'base': 'cut4', 'tool': 'standoff', 'result': 'final'})
    config['final'] = 'final'
    if remove_corner:
        config['shapes'].append({'id': 'corner_cut', 'type': 'box', 'length': 2,
                                 'width': 2, 'height': 5, 'position': [119, -1, -1]})
        config['operations'].append({'op': 'cut', 'base': 'final', 'tool': 'corner_cut',
                                     'result': 'final_cut'})
        config['final'] = 'final_cut'
    config['drawing_plan'] = {'part_type': 'generic', 'dim_intents': [
        {'id': 'THK', 'feature': 'plate', 'style': 'linear', 'view': 'front',
         'value_mm': 3, 'required': True},
    ]}
    links, _ = draw(drawing_dir, config)
    link = links['THK']
    if remove_corner:
        assert link['feature_id'] is None
        assert link['rendered'] is False
    else:
        assert link['source'] == 'freecad_runtime'
        assert link['represented_by'] == 'THK'
        assert link['evidence']['model_value_mm'] == 3
        assert link['evidence']['endpoints_3d_mm'] == [[120, 0, 0], [120, 0, 3]]
        assert link['evidence']['edge_ref'].startswith('final:Edge')


@pytest.mark.parametrize('case', ['normal', 'height10', 'wrong_nominal', 'unequal', 'missing', 'trimmed'])
def test_pcb_standoff_group_requires_all_four_complete_runtime_members(drawing_dir, case):
    config = tomllib.loads((ROOT / 'docs/examples/plate-with-holes/config.toml').read_text())
    config['name'] = 'device_mount'
    intent = next(d for d in config['drawing_plan']['dim_intents'] if d['id'] == 'STANDOFF_HEIGHT')
    if case == 'height10':
        for shape in config['shapes']:
            if shape['id'].startswith('standoff'):
                shape['height'] = 10
        intent['value_mm'] = 10
    elif case == 'wrong_nominal':
        intent['value_mm'] = 9
    elif case == 'unequal':
        next(s for s in config['shapes'] if s['id'] == 'standoff4')['height'] = 9
    elif case == 'missing':
        config['operations'] = [op for op in config['operations'] if op.get('tool') != 'standoff4']
    elif case == 'trimmed':
        config['shapes'].append({'id': 'trim', 'type': 'box', 'length': 8, 'width': 8, 'height': 3,
                                 'position': [14, 14, 11]})
        config['operations'].append({'op': 'cut', 'base': 'final', 'tool': 'trim', 'result': 'trimmed'})
    links, _ = draw(drawing_dir, config)
    link = links['STANDOFF_HEIGHT']
    if case in ('normal', 'height10'):
        height = 10 if case == 'height10' else 8
        evidence = link['evidence']
        assert link['source'] == 'freecad_runtime'
        assert evidence['measurement'] == 'standoff_cylindrical_faces'
        assert evidence['member_feature_ids'] == ['standoff1', 'standoff2', 'standoff3', 'standoff4']
        assert len(evidence['members']) == 4
        assert all(m['height_mm'] == height for m in evidence['members'])
        assert evidence['model_value_mm'] == height
        assert evidence['endpoints_3d_mm'] == [[21.5, 18, 4], [21.5, 18, 4 + height]]
        assert evidence['representative_feature_id'] == 'standoff1'
        assert evidence['coincident_member_ids'] == ['standoff1', 'standoff3']
        assert evidence['selected_side'] == 'right'
        assert evidence['projection_group_index'] in (0, 2)
        assert len(evidence['page_endpoints_mm']) == 2
    else:
        assert link['feature_id'] is None, 'one invalid member must not be omitted from the group'
        assert link['rendered'] is False
        dimension_map = json.loads((drawing_dir / 'output/device_mount_dimension_map.json').read_text())
        record = next(d for d in dimension_map['plan_dimensions'] if d['dim_id'] == 'STANDOFF_HEIGHT')
        assert record['reason'] == ('linear_value_geometry_mismatch' if case == 'wrong_nominal'
                                    else 'standoff_group_height_mismatch' if case == 'unequal'
                                    else 'standoff_member_geometry_unresolved')


@pytest.mark.parametrize('case', ['normal', 'moved_slot', 'wrong_position', 'missing_reference', 'mixed_holes', 'missing_slot'])
def test_verified_pcb_references_bind_actual_final_geometry_and_fail_closed(drawing_dir, case):
    config = tomllib.loads((ROOT / 'configs/examples/pcb_mount_plate.toml').read_text())
    config.update(json.loads((ROOT / 'configs/overrides/pcb_mount_plate_verified.json').read_text()))
    config['name'] = 'device_mount'
    position = next(d for d in config['drawing_plan']['dim_intents'] if d['id'] == 'CONNECTOR_SLOT_POSITION')
    if case == 'moved_slot':
        next(s for s in config['shapes'] if s['id'] == 'slot')['position'][1] = 46
        position['value_mm'] = 46
        next(d for d in config['drawing_intent']['required_dimensions'] if d['id'] == 'CONNECTOR_SLOT_POSITION')['value_mm'] = 46
    elif case == 'wrong_position':
        position['value_mm'] = 43
    elif case == 'missing_reference':
        del position['reference']
    elif case == 'mixed_holes':
        next(s for s in config['shapes'] if s['id'] == 'hole4')['radius'] = 2.1
    elif case == 'missing_slot':
        config['operations'] = [op for op in config['operations'] if op.get('tool') != 'slot']
    links, _ = draw(drawing_dir, config)
    if case in ('normal', 'moved_slot'):
        assert len(links) == 10
        assert all(link.get('source') == 'freecad_runtime' and link.get('feature_id') for link in links.values())
        evidence = links['CONNECTOR_SLOT_POSITION']['evidence']
        assert evidence['model_value_mm'] == (46 if case == 'moved_slot' else 42)
        assert evidence['endpoints_3d_mm'][0] == [60, 0, 4]
        assert evidence['endpoints_3d_mm'][1] == [60, 46 if case == 'moved_slot' else 42, 4]
        svg = (drawing_dir / 'output/device_mount_drawing.svg').read_text()
        assert 'baseline-dimensions' not in svg
        assert 'data-auto-chain' not in svg
        assert all(f'data-datum-name="{letter}"' in svg for letter in 'ABC')
    else:
        bad = 'MOUNTING_HOLE_DIA' if case == 'mixed_holes' else 'CONNECTOR_SLOT_POSITION'
        assert links[bad]['feature_id'] is None
        assert links[bad]['rendered'] is False


@pytest.mark.parametrize('missing_named_target', [False, True])
def test_legacy_named_diameters_and_baselines_use_final_visible_geometry(drawing_dir, missing_named_target):
    config = tomllib.loads((ROOT / 'configs/examples/quality_pass_bracket.toml').read_text())
    config['name'] = 'device_mount'
    if missing_named_target:
        config['operations'] = [op for op in config['operations'] if op.get('tool') != 'hole_left']
        config['operations'][0]['base'] = 'plate'
        next(s for s in config['shapes'] if s['id'] == 'hole_right')['radius'] = 3
        next(d for d in config['drawing_plan']['dim_intents'] if d['id'] == 'HOLE_RIGHT_DIA')['value_mm'] = 6
        next(d for d in config['drawing_intent']['required_dimensions'] if d['id'] == 'HOLE_RIGHT_DIA')['value_mm'] = 6
    links, _ = draw(drawing_dir, config)
    output = drawing_dir / 'output'
    dimension_map = json.loads((output / 'device_mount_dimension_map.json').read_text())
    if missing_named_target:
        assert links['HOLE_LEFT_DIA']['feature_id'] is None
        assert links['HOLE_LEFT_DIA']['rendered'] is False
        assert links['HOLE_RIGHT_DIA']['feature_id'] == 'hole_right'
        assert dimension_map['datum_bindings']['B']['status'] == 'unresolved'
    else:
        for dim_id in ('HOLE_LEFT_DIA', 'HOLE_RIGHT_DIA'):
            assert links[dim_id]['evidence']['measurement'] == 'legacy_cylindrical_diameter'
            assert links[dim_id]['evidence']['surface_role'] == 'inward_hole'
        qa = json.loads((output / 'device_mount_drawing_qa.json').read_text())
        assert qa['metrics']['datum_coherence'] is False
        assert qa['metrics']['dim_redundancy'] == 0
        assert all(d['status'] == 'resolved' for d in dimension_map['datum_bindings'].values())
