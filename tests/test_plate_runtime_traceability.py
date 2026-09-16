"""Exercise dimension links against real FreeCAD geometry, including bad inputs."""

import json
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

import pytest

from test_intent_compiler import compile_config, mounting_plate


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


def draw(directory, config, *, strict=False, expected_code=0):
    config['export'] = {'directory': str(directory / 'output'), 'formats': ['step']}
    config['manufacturing'] = {'material': 'AL6061'}
    path = directory / 'input.json'
    path.write_text(json.dumps(config))
    command = ['node', 'bin/fcad.js', 'draw', str(path)]
    if strict:
        command.append('--strict-quality')
    result = subprocess.run(command, cwd=ROOT,
                            text=True, capture_output=True)
    assert result.returncode == expected_code, result.stdout + result.stderr
    output = directory / 'output'
    name = config['name']
    trace = json.loads((output / f'{name}_traceability.json').read_text())
    quality = json.loads((output / f'{name}_drawing_quality.json').read_text())
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


def reference_plate():
    return json.loads((ROOT / 'configs/examples/usb_hub_reference_mount.json').read_text())


def test_eight_hole_plate_links_explicit_diameter_groups(drawing_dir):
    config = reference_plate()
    links, quality = draw(drawing_dir, config)
    for dim_id, value in {'WIDTH': 142, 'HEIGHT': 4, 'THK': 4, 'BASE_W': 74}.items():
        assert links[dim_id]['feature_id'] == 'plate'
        assert links[dim_id]['evidence']['model_value_mm'] == value
    expected = {
        'HOLE_DIA': (4, {'hole_H1', 'hole_H2', 'hole_H3', 'hole_H4'},
                     [[29, 24.4], [29, 49.6], [113, 24.4], [113, 49.6]]),
        'PANEL_HOLE_DIA': (5.5, {'hole_P1', 'hole_P2', 'hole_P3', 'hole_P4'},
                           [[12, 12], [12, 62], [130, 12], [130, 62]]),
    }
    for dim_id, (diameter, members, centers) in expected.items():
        link = links[dim_id]
        evidence = link['evidence']
        assert evidence['source'] == 'freecad_runtime'
        assert evidence['model_value_mm'] == diameter
        assert set(evidence['member_feature_ids']) == members
        assert evidence['centers_xy'] == centers
        assert len(set(evidence['face_refs'])) == 4
        assert link['feature_id'] in members
        assert evidence['center_uv'] in centers
        assert link['svg_element_id']
    assert set(links['HOLE_DIA']['evidence']['face_refs']).isdisjoint(
        links['PANEL_HOLE_DIA']['evidence']['face_refs'])
    assert quality['traceability']['coverage_percent'] == 100
    assert quality['status'] == 'pass'


@pytest.mark.parametrize('problem', [
    'unknown_member', 'mixed_members', 'unscoped_group', 'wrong_nominal',
    'missing_hole', 'edge_notch',
])
def test_explicit_groups_do_not_certify_unproven_holes(drawing_dir, problem):
    config = reference_plate()
    hub, panel = config['drawing_plan']['dim_intents']
    expected_missing = 'PANEL_HOLE_DIA'
    if problem == 'unknown_member':
        panel['member_feature_ids'][-1] = 'absent_hole'
    elif problem == 'mixed_members':
        panel['member_feature_ids'][-1] = 'hole_H4'
    elif problem == 'unscoped_group':
        del panel['member_feature_ids']
    elif problem == 'wrong_nominal':
        panel['value_mm'] = 5.6
    elif problem in ('missing_hole', 'edge_notch'):
        config['shapes'][-1]['position'][0] = 200 if problem == 'missing_hole' else 142
    links, quality = draw(drawing_dir, config, strict=True, expected_code=1)
    assert links[expected_missing]['feature_id'] is None
    assert expected_missing in quality['traceability']['unmapped_required_entities']
    assert quality['status'] == 'fail'
    assert links['WIDTH']['feature_id'] == 'plate', 'valid body bounds remain proven'


def test_non_first_group_gets_its_own_rendered_anchor(drawing_dir):
    config = reference_plate()
    config['drawing_plan']['dim_intents'][1]['member_feature_ids'] = ['hole_P4']
    links, quality = draw(drawing_dir, config, strict=True)
    link = links['PANEL_HOLE_DIA']
    assert link['evidence']['center_uv'] == [130, 62]
    assert link['evidence']['member_feature_ids'] == ['hole_P4']
    assert len(link['evidence']['face_refs']) == 1
    assert link['represented_by'] == 'PANEL_HOLE_DIA'
    assert quality['traceability']['coverage_percent'] == 100
    svg = ET.parse(drawing_dir / 'output/usb_hub_reference_adapter_R1_drawing.svg')
    text = svg.find(f'.//{{http://www.w3.org/2000/svg}}text[@id="{link["svg_element_id"]}"]')
    assert text is not None
    assert [float(text.get('data-center-u')), float(text.get('data-center-v'))] == [130, 62]


def test_equal_diameter_subgroups_have_distinct_measured_anchors(drawing_dir):
    config = reference_plate()
    panel = config['drawing_plan']['dim_intents'][1]
    panel['member_feature_ids'] = ['hole_P1', 'hole_P2']
    right = {**panel, 'id': 'PANEL_RIGHT_HOLE_DIA', 'member_feature_ids': ['hole_P3', 'hole_P4']}
    config['drawing_plan']['dim_intents'].append(right)
    links, quality = draw(drawing_dir, config, strict=True)
    left_ev = links['PANEL_HOLE_DIA']['evidence']
    right_ev = links['PANEL_RIGHT_HOLE_DIA']['evidence']
    assert left_ev['center_uv'] in [[12, 12], [12, 62]]
    assert right_ev['center_uv'] in [[130, 12], [130, 62]]
    assert left_ev['centers_xy'] == [[12, 12], [12, 62]]
    assert right_ev['centers_xy'] == [[130, 12], [130, 62]]
    assert len(left_ev['face_refs']) == len(right_ev['face_refs']) == 2
    assert set(left_ev['face_refs']).isdisjoint(right_ev['face_refs'])
    assert links['PANEL_HOLE_DIA']['svg_element_id'] != links['PANEL_RIGHT_HOLE_DIA']['svg_element_id']
    assert quality['traceability']['coverage_percent'] == 100


@pytest.mark.parametrize('missing_hole', [False, True])
def test_group_centers_come_from_complete_native_hole_measurements(drawing_dir, missing_hole):
    config = reference_plate()
    if missing_hole:
        config['shapes'][-1]['position'][0] = 200
    config = compile_config(config)
    script = drawing_dir / 'native_centers.py'
    script.write_text('''import json, sys
import FreeCAD
sys.path.insert(0, %r)
from _shapes import make_shape, boolean_op, get_metadata
from _drawing_traceability import measure_plate_holes, diameter_group_centers
config = json.load(sys.stdin)
shapes = {s['id']: make_shape(s) for s in config['shapes']}
for op in config['operations']:
    shapes[op['result']] = boolean_op(op['op'], shapes[op['base']], shapes[op['tool']])
metadata = get_metadata(shapes[config['final']])
measured = measure_plate_holes(config, metadata)
print(json.dumps({'success': True, 'measured_count': None if measured is None else len(measured),
                  'centers': diameter_group_centers(config, metadata)}))
''' % str(ROOT / 'scripts'))
    node = """import {readFileSync} from 'node:fs';
import {runScript} from './lib/runner.js';
console.log(JSON.stringify(await runScript(process.argv[1], JSON.parse(readFileSync(0, 'utf8')))));
"""
    result = subprocess.run(['node', '--input-type=module', '-e', node,
                             '../' + script.relative_to(ROOT).as_posix()],
                            cwd=ROOT, input=json.dumps(config), text=True, capture_output=True)
    assert result.returncode == 0, result.stdout + result.stderr
    data = json.loads(result.stdout)
    if missing_hole:
        assert data['measured_count'] is None
        assert data['centers'] == {'HOLE_DIA': [], 'PANEL_HOLE_DIA': []}
    else:
        assert data['measured_count'] == 8
        assert data['centers'] == {
            'HOLE_DIA': [[29, 24.4], [29, 49.6], [113, 24.4], [113, 49.6]],
            'PANEL_HOLE_DIA': [[12, 12], [12, 62], [130, 12], [130, 62]],
        }
