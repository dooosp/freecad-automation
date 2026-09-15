"""Exercise dimension links against real FreeCAD geometry, including bad inputs."""

import json
from pathlib import Path
import subprocess
import tempfile
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
