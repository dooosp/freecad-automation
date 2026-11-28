import subprocess
import hashlib
import json
import tomllib
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
_RUNTIME_AVAILABLE = None


def run_cli(args, check=True):
    completed = subprocess.run(
        ["node", str(ROOT / "bin" / "fcad.js"), *args],
        text=True,
        capture_output=True,
        check=False,
        cwd=ROOT,
    )
    if check and completed.returncode != 0:
        raise AssertionError(f"CLI failed: {completed.stdout}\n{completed.stderr}")
    return completed


def has_freecad_runtime():
    global _RUNTIME_AVAILABLE
    if _RUNTIME_AVAILABLE is not None:
        return _RUNTIME_AVAILABLE

    completed = subprocess.run(
        [
            "node",
            "-e",
            "import { hasFreeCADRuntime } from './lib/paths.js'; console.log(hasFreeCADRuntime() ? 'yes' : 'no');",
        ],
        text=True,
        capture_output=True,
        check=False,
        cwd=ROOT,
    )
    _RUNTIME_AVAILABLE = completed.returncode == 0 and completed.stdout.strip() == "yes"
    return _RUNTIME_AVAILABLE


@pytest.mark.parametrize('case', ['normal', 'changed_radius', 'coplanar_edge', 'wrong_drawing_radius'])
def test_infotainment_after_finishes_are_applied_to_the_declared_edges(tmp_path, case):
    if not has_freecad_runtime():
        pytest.skip('FreeCAD runtime not available')
    config = tomllib.loads((ROOT / 'configs/examples/infotainment_display_bracket_after.toml').read_text())
    stem = config['name'] = f'infotainment_after_finish_{uuid.uuid4().hex[:8]}'
    fillet = next(op for op in config['operations'] if op['op'] == 'fillet')
    if case == 'changed_radius':
        fillet['radius'] = 1.6
    if case == 'coplanar_edge':
        fillet['edge_segments'] = [[[0, 0, 2.6], [24, 0, 2.6]]]
    if case == 'wrong_drawing_radius':
        config['drawing_plan'] = {'dim_intents': [
            {'id': 'FILLET', 'view': 'front', 'required': True, 'value_mm': 1.8}
        ]}
    output = tmp_path / 'out'
    config['export']['directory'] = str(output)
    source = tmp_path / 'input.json'
    source.write_text(json.dumps(config))
    create = run_cli(['create', str(source), '--strict-quality'], check=False)
    if case == 'coplanar_edge':
        assert create.returncode == 1 and 'edge_finish_not_orthogonal' in create.stderr
        draw = run_cli(['draw', str(source), '--strict-quality'], check=False)
        assert draw.returncode == 1 and 'edge_finish_not_orthogonal' in draw.stderr
        assert not (output / f'{stem}.step').exists()
        assert not (output / f'{stem}_drawing.svg').exists()
        return

    assert create.returncode == 0, create.stdout + create.stderr
    roundtrip = json.loads((output / f'{stem}_create_quality.json').read_text())['step_roundtrip']
    assert roundtrip['reimport_attempted'] and roundtrip['reimport_valid']
    draw = run_cli(['draw', str(source), '--bom', '--strict-quality'], check=False)
    plan = json.loads((output / f'{stem}_dimension_map.json').read_text())
    dims = {dim['dim_id']: dim for dim in plan['plan_dimensions']}
    entry = dims['FILLET']
    assert entry['runtime_binding']['measured_mm'] == fillet['radius']
    if case == 'wrong_drawing_radius':
        assert draw.returncode == 1 and entry['reason'] == 'radius_value_geometry_mismatch'
        return
    assert draw.returncode == 0, draw.stdout + draw.stderr
    assert dims['WEB_H']['runtime_binding']['endpoints_3d_mm'] == [[0, 0, 2.6], [0, 0, 40.6]]
    assert entry['rendered'] and entry['view'] == 'front'
    svg = ET.parse(output / f'{stem}_drawing.svg')
    labels = [text.text for text in svg.iter('{http://www.w3.org/2000/svg}text') if text.get('data-dim-id') == 'FILLET']
    assert labels == [f'R{fillet["radius"]:g}']
    thick_label = svg.find('.//{http://www.w3.org/2000/svg}text[@data-dim-id="THK"]')
    thick_line = svg.find('.//{http://www.w3.org/2000/svg}line[@data-dim-id="THK"][@data-dimension-line="linear"]')
    assert abs(float(thick_label.get('x')) - float(thick_line.get('x1'))) == pytest.approx(3)
    quality = json.loads((output / f'{stem}_drawing_quality.json').read_text())
    assert quality['traceability']['coverage_percent'] == 100
    assert quality['views']['generated_count'] == 4
    trace = json.loads((output / f'{stem}_traceability.json').read_text())
    evidence = next(link for link in trace['links'] if link['dim_id'] == 'FILLET')['evidence']
    assert evidence['model_value_mm'] == fillet['radius']
    assert evidence['face_ref'].startswith('body:Face')


@pytest.mark.parametrize('radius, unused', [(0.5, False), (0.75, False), (0.25, False), (0.5, True)])
def test_pcb_slot_corner_relief_is_checked_on_the_final_solid(tmp_path, radius, unused):
    if not has_freecad_runtime():
        pytest.skip('FreeCAD runtime not available')
    config = tomllib.loads((ROOT / 'configs/examples/pcb_mount_plate.toml').read_text())
    config.update(json.loads((ROOT / 'configs/overrides/pcb_mount_plate_verified.json').read_text()))
    slot = next(shape for shape in config['shapes'] if shape['id'] == 'slot')
    slot['side_relief_radius_mm'] = radius
    if unused:
        sharp = {key: value for key, value in slot.items() if key != 'side_relief_radius_mm'}
        sharp['id'] = 'sharp_slot'
        config['shapes'].append(sharp)
        next(op for op in config['operations'] if op.get('tool') == 'slot')['tool'] = sharp['id']
    output_dir = tmp_path / 'out'
    config['export']['directory'] = str(output_dir)
    source = tmp_path / 'pcb.json'
    source.write_text(json.dumps(config))
    manifest = tmp_path / 'dfm.json'
    strict = run_cli(['dfm', str(source), '--strict', '--manifest-out', str(manifest)], check=False)
    expected_warning = unused or radius < 0.5
    assert strict.returncode == int(expected_warning), strict.stdout + strict.stderr
    finding = json.loads(manifest.read_text())['details']['slot_corner_relief']
    if unused:
        assert finding['evidence']['reason_code'] == 'slot_relief_not_in_final'
        assert finding['actual_value'] is None
        return
    assert finding['actual_value'] == radius
    assert finding['required_value'] == 0.5
    assert finding['evidence']['geometry_verification'] == 'measured'
    assert len({corner['face_ref'] for corner in finding['evidence']['corners']}) == 4
    assert finding['evidence']['reason_code'] == (
        'slot_relief_radius_below_minimum' if expected_warning else 'slot_relief_verified'
    )

    run_cli(['draw', str(source), '--bom', '--strict-quality'])
    qa = json.loads((output_dir / 'pcb_mount_plate_drawing_qa.json').read_text())
    assert qa['metrics']['dfm_warning_count'] == int(expected_warning)
    assert qa['details']['slot_corner_relief']['actual_value'] == radius
    trace = json.loads((output_dir / 'pcb_mount_plate_traceability.json').read_text())
    links = {link['dim_id']: link for link in trace['links']}
    for dim_id, nominal in (('CONNECTOR_SLOT_SIZE', 18), ('CONNECTOR_SLOT_WIDTH', 10),
                            ('CONNECTOR_SLOT_POSITION', 42)):
        assert links[dim_id]['evidence']['model_value_mm'] == nominal


@pytest.mark.parametrize('case', ['normal_raw', 'normal_processed', 'overlap_warning', 'overlap_fail_under',
                                 'overlap_processed_warning', 'overlap_processed_fail_under'])
def test_quality_pass_rotated_label_overlap_runtime(tmp_path, case):
    if not has_freecad_runtime():
        pytest.skip('FreeCAD runtime not available')
    config = tomllib.loads((ROOT / 'configs/examples/quality_pass_bracket.toml').read_text())
    output_dir = tmp_path / case
    config['export']['directory'] = str(output_dir)
    if case.startswith('overlap_'):
        right = next(d for d in config['drawing_plan']['dim_intents'] if d['id'] == 'HOLE_RIGHT_DIA')
        right['placement_angle_deg'] = 315
    config_path = tmp_path / f'{case}.json'
    config_path.write_text(json.dumps(config))
    args = ['draw', str(config_path), '--bom']
    if case in ('normal_raw', 'overlap_warning', 'overlap_fail_under'):
        args.append('--raw')
    if not case.endswith('warning'):
        args += ['--fail-under', '100']
    completed = run_cli(args, check=False)
    expected_exit = 1 if case.endswith('fail_under') else 0
    assert completed.returncode == expected_exit, completed.stdout + completed.stderr
    qa = json.loads((output_dir / 'quality_pass_bracket_drawing_qa.json').read_text())
    if case.startswith('normal_'):
        assert qa['score'] == 100
        assert qa['metrics']['text_overlap_pairs'] == 0
        trace = json.loads((output_dir / 'quality_pass_bracket_traceability.json').read_text())
        right = next(link for link in trace['links'] if link['dim_id'] == 'HOLE_RIGHT_DIA')
        assert right['source'] == 'freecad_runtime'
        assert right['feature_id'] == 'hole_right'
        assert right['evidence']['model_value_mm'] == 10
    else:
        assert qa['score'] < 100
        assert any({pair['text1'], pair['text2']} == {'Ø10', '100'}
                   for pair in qa['details']['text_overlaps'])
        assert qa['deductions']['text_overlap_pairs'] < 0
        svg = ET.parse(output_dir / 'quality_pass_bracket_drawing.svg')
        height = next(e for e in svg.iter() if e.tag.endswith('text') and e.text == '100')
        assert float(height.get('x')) == 159
        assert float(height.get('y')) == 73
        assert height.get('transform') == 'rotate(-90,159.00,73.00)'
        if case.endswith('warning'):
            issues = json.loads((output_dir / 'quality_pass_bracket_drawing_qa_issues.json').read_text())
            assert any(issue['rule_id'] == 'text_overlap' for issue in issues['issues'])


def test_cli_create_accepts_canonical_single_part_config(tmp_path):
    if not has_freecad_runtime():
        pytest.skip("FreeCAD runtime not available")

    config_path = tmp_path / "single_part.toml"
    output_dir = tmp_path / "single_out"
    config_path.write_text(
        f"""
name = "cli_single_part"
final = "body_fillet"

[[shapes]]
id = "body"
type = "box"
length = 20
width = 10
height = 5

[[operations]]
op = "fillet"
target = "body"
radius = 0.5
result = "body_fillet"

[export]
formats = ["brep"]
directory = "{output_dir}"
""".strip()
        + "\n",
        encoding="utf-8",
    )

    completed = run_cli(["create", str(config_path)])

    assert completed.returncode == 0
    assert "Model created successfully!" in completed.stdout
    assert (output_dir / "cli_single_part.brep").exists()
    # Report consumers need integrity evidence for the quality JSON, not only
    # a linked pathname to an un-hashed file.
    manifest = json.loads((output_dir / "cli_single_part_manifest.json").read_text())
    quality_path = output_dir / "cli_single_part_create_quality.json"
    entries = [entry for entry in manifest["outputs"]
               if entry["kind"] == "model.create-quality-json"]
    assert len(entries) == 1
    quality_bytes = quality_path.read_bytes()
    assert entries[0]["path"] == str(quality_path)
    assert entries[0]["exists"] is True
    assert entries[0]["sha256"] == hashlib.sha256(quality_bytes).hexdigest()
    assert entries[0]["size_bytes"] == len(quality_bytes)
    assert manifest["linked_artifacts"]["quality_json"] == str(quality_path)


def test_cli_report_unverified_evidence_warns_without_failing_generation(tmp_path):
    if not has_freecad_runtime():
        pytest.skip("FreeCAD runtime not available")
    config_path = tmp_path / "report_without_producers.json"
    output_dir = tmp_path / "report_without_producers"
    config_path.write_text(json.dumps({
        "config_version": 1, "name": "report_without_producers",
        "shapes": [{"id": "plate", "type": "box", "length": 20,
                    "width": 10, "height": 5}],
        "final": "plate", "manufacturing": {"material": "AL6061"},
    }))
    completed = run_cli(["report", str(config_path), "--dfm", "--out-dir", str(output_dir)])
    summary = json.loads((output_dir / "report_without_producers_report_summary.json").read_text())
    manifest = json.loads((output_dir / "report_without_producers_report_manifest.json").read_text())
    assert completed.returncode == 0
    assert summary["overall_status"] == "incomplete"
    assert summary["ready_for_manufacturing_review"] is False
    assert manifest["status"] == "warning"
    assert any("manifest-missing" in warning for warning in manifest["warnings"])
    assert (output_dir / "report_without_producers_report.pdf").exists()


def test_cli_create_accepts_canonical_assembly_config(tmp_path):
    if not has_freecad_runtime():
        pytest.skip("FreeCAD runtime not available")

    config_path = tmp_path / "assembly.toml"
    output_dir = tmp_path / "assembly_out"
    config_path.write_text(
        f"""
name = "cli_minimal_assembly"

[[parts]]
id = "base"
final = "base_body"
  [[parts.shapes]]
  id = "base_body"
  type = "box"
  length = 20
  width = 10
  height = 5

[[parts]]
id = "pin"
final = "pin_body"
  [[parts.shapes]]
  id = "pin_body"
  type = "cylinder"
  radius = 2
  height = 8

[assembly]

  [[assembly.parts]]
  ref = "base"
  position = [0, 0, 0]

  [[assembly.parts]]
  ref = "pin"
  position = [10, 5, 0]

[export]
formats = ["brep"]
directory = "{output_dir}"
""".strip()
        + "\n",
        encoding="utf-8",
    )

    completed = run_cli(["create", str(config_path)])

    assert completed.returncode == 0
    assert "Model created successfully!" in completed.stdout
    assert "Assembly: 2 parts" in completed.stdout
    assert (output_dir / "cli_minimal_assembly.brep").exists()
